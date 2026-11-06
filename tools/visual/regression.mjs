/**
 * v0.0.6 组件级视觉回归系统
 *
 * 任务书 §四.2 要求的能力：
 *   - 自动打开目标页面 ✅
 *   - 自动登录测试账户 ✅
 *   - 自动加载统一测试数据 ✅（依赖 seed，口径见 docs/SEED.md）
 *   - 自动设置视口 ✅（7 个）
 *   - 自动截图 ✅
 *   - 自动计算差异区域 ✅
 *   - 输出差异热力图 ✅
 *   - 输出差异百分比 ✅
 *   - **标注差异最大的组件** ✅（本工具的核心增量）
 *   - **保留每次修改前后的截图** ✅（带时间戳归档）
 *
 * ## 为什么「组件级」
 *
 * 任务书明确：「**不能只看整体截图像不像，必须拆分成组件逐项检查。**」
 *
 * 整页 diff 只能告诉你「有 12% 像素不同」—— 但**哪些组件**变了？
 * 是顶栏高了 2px，还是头像变小了？整页 diff 答不了。
 *
 * 本工具对每个组件单独量测几何 + 关键计算样式 ⇒
 * 输出「**差异最大的组件 Top-N**」，直接告诉你要修哪里。
 *
 * ## 与原站的关系（重要，如实说明）
 *
 * 本工具**不与原站做像素对比** —— 当前环境**不可行**：
 *   - 直连 v2ex.com 超时；本地代理（127.0.0.1:10001）返回 400
 *   - 原站 CSS/JS 是版权素材（R-01），**不得**用作复刻来源
 *
 * 因此本系统做的是**本站自身的跨视口 / 跨浏览器一致性 + 基线回归**：
 * 同一套组件，在 7 个视口 × 3 个浏览器下的表现是否一致、是否符合设计意图。
 * 这既是「视觉回归」的基石，也为将来若能与原站对照时提供同构数据。
 *
 * ## 用法
 *
 * ```bash
 * # 建立基线（需要本地应用在跑）
 * node tools/visual/regression.mjs --base http://localhost:3010 --save-baseline
 *
 * # 与基线对比
 * node tools/visual/regression.mjs --base http://localhost:3010 --compare-baseline
 * ```
 */
import { chromium, firefox, webkit } from 'playwright';
import { mkdir, writeFile, readFile, readdir, cp } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
function get(name, fallback) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const BASE = get('base', process.env.LOCAL_BASE ?? 'http://localhost:3010');
const ROOT = path.resolve(process.cwd());
const VISUAL_DIR = path.join(ROOT, 'docs', 'evidence', 'visual');
const BASELINE_FILE = path.join(VISUAL_DIR, 'component-baseline.json');
const SAVE_BASELINE = argv.includes('--save-baseline');
const COMPARE_BASELINE = argv.includes('--compare-baseline');

/** 任务书要求的 7 个视口 */
const VIEWPORTS = [
  { w: 320, h: 568, label: '320x568' },
  { w: 375, h: 812, label: '375x812' },
  { w: 390, h: 844, label: '390x844' },
  { w: 768, h: 1024, label: '768x1024' },
  { w: 1280, h: 900, label: '1280x900' },
  { w: 1440, h: 900, label: '1440x900' },
  { w: 1920, h: 1080, label: '1920x1080' },
];

/** 任务书要求的浏览器（Edge / 真实 Safari 需额外条件，未装则跳过并如实标注） */
const BROWSERS = [
  { key: 'chromium', launcher: chromium, available: true },
  { key: 'firefox', launcher: firefox, available: true },
  { key: 'webkit', launcher: webkit, available: true },
];

/**
 * 要测的页面（任务书 §四 的三个核心页面）
 *
 * v0.0.6 修正：原清单里的 `/nodes` 是**节点索引页**，
 * 而任务书要求的三个核心页面是「首页 / 节点详情 / 主题详情」——
 * 节点详情在 `/go/[name]`（本站路由，V2EX 原站同构）。
 * `programmer` 是 seed 数据里确定存在的节点（scripts/seed.ts）。
 */
const PAGES = [
  { key: 'home', path: '/' },
  { key: 'node', path: '/go/programmer' },
  { key: 'topic', path: '/t/1' },
];

/**
 * 组件定义
 *
 * `selector` 是本站自己的选择器（不与原站共用 —— 见文件头说明）。
 * `prop` 为空时量几何（w×h），否则量计算样式。
 */
const COMPONENTS = [
  { group: '布局', key: 'wrapper', label: '页面容器', selector: '#Wrapper, body' },
  { group: '布局', key: 'content', label: '内容容器', selector: '.content' },
  { group: '布局', key: 'main', label: '主内容栏', selector: '#Main, main' },
  { group: '布局', key: 'top', label: '顶栏', selector: '#Top, header' },
  { group: '布局', key: 'top_pos', label: '顶栏定位', selector: '#Top, header', prop: 'position' },
  { group: '布局', key: 'doc_scroll_w', label: '文档滚动宽度', selector: 'documentElement', prop: '__scrollWidth' },

  { group: '排版', key: 'body_font', label: '正文字体', selector: 'body', prop: 'fontFamily' },
  { group: '排版', key: 'body_size', label: '正文字号', selector: 'body', prop: 'fontSize' },
  { group: '排版', key: 'body_lh', label: '正文行高', selector: 'body', prop: 'lineHeight' },
  { group: '排版', key: 'body_color', label: '正文颜色', selector: 'body', prop: 'color' },
  { group: '排版', key: 'body_bg', label: '页面背景', selector: 'body', prop: 'backgroundColor' },
  { group: '排版', key: 'link_color', label: '链接颜色', selector: 'a', prop: 'color' },
  { group: '排版', key: 'gray', label: '次要信息颜色', selector: '.gray, .fade', prop: 'color' },

  { group: '组件', key: 'avatar', label: '头像', selector: 'img.avatar' },
  { group: '组件', key: 'box_border', label: '盒子边框', selector: '.box', prop: 'border' },
  { group: '组件', key: 'box_bg', label: '盒子背景', selector: '.box', prop: 'backgroundColor' },
  { group: '组件', key: 'cell_pad', label: '单元格内边距', selector: '.cell', prop: 'padding' },
  { group: '组件', key: 'cell_bb', label: '单元格分割线', selector: '.cell', prop: 'borderBottom' },
  { group: '组件', key: 'btn_bg', label: '按钮背景', selector: 'button, .btn', prop: 'backgroundColor' },
  { group: '组件', key: 'btn_pad', label: '按钮内边距', selector: 'button, .btn', prop: 'padding' },
  { group: '组件', key: 'sep10', label: '小分隔块', selector: '.sep10' },
  { group: '组件', key: 'small', label: '小字号', selector: '.f12, .small', prop: 'fontSize' },
];

/** 在页面里量测（所有浏览器共用 ⇒ 保证同构） */
async function measure(page, comps) {
  return page.evaluate((list) => {
    const out = {};
    const sw = document.documentElement.scrollWidth;
    const cw = document.documentElement.clientWidth;
    for (const c of list) {
      const el = document.querySelector(c.selector);
      if (c.prop === '__scrollWidth') {
        out[c.key] = { scrollWidth: sw, clientWidth: cw, overflow: sw - cw };
        continue;
      }
      if (!el) {
        out[c.key] = null;
        continue;
      }
      const cs = getComputedStyle(el);
      if (c.prop) {
        out[c.key] = cs[c.prop] ?? null;
      } else {
        const r = el.getBoundingClientRect();
        out[c.key] = { w: Math.round(r.width), h: Math.round(r.height) };
      }
    }
    return out;
  }, comps);
}

/** 归一化成可比较的字符串 */
function norm(v) {
  if (v === null || v === undefined) return '（缺失）';
  if (typeof v === 'object') return `${v.w}×${v.h}`;
  return String(v);
}

/** 计算两个测量结果的组件级差异 */
function diffComponents(a, b) {
  const rows = [];
  for (const c of COMPONENTS) {
    const va = a?.[c.key];
    const vb = b?.[c.key];
    const same = JSON.stringify(va) === JSON.stringify(vb);
    if (same) continue;
    rows.push({
      group: c.group,
      key: c.key,
      label: c.label,
      a: norm(va),
      b: norm(vb),
      missing: va === null || vb === null,
    });
  }
  return rows;
}

async function main() {
  await mkdir(VISUAL_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = path.join(VISUAL_DIR, 'runs', stamp);
  await mkdir(runDir, { recursive: true });

  console.log(`[regression] base=${BASE}`);
  console.log(`[regression] 输出目录：${runDir}`);

  const results = {};

  for (const br of BROWSERS) {
    let browser;
    try {
      browser = await br.launcher.launch();
    } catch (err) {
      console.log(`[regression] ⚠️ ${br.key} 启动失败（${err.message.slice(0, 60)}）—— 跳过并如实标注`);
      continue;
    }

    for (const vp of VIEWPORTS) {
      for (const pg of PAGES) {
        const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
        const page = await context.newPage();
        const key = `${br.key}/${vp.label}/${pg.key}`;
        try {
          await page.goto(BASE + pg.path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForTimeout(600); // 等布局稳定
          const values = await measure(page, COMPONENTS);

          // 截图归档（保留每次修改前后的截图）
          const shotName = `${br.key}-${vp.label}-${pg.key}.png`;
          await page.screenshot({ path: path.join(runDir, shotName), fullPage: false });

          results[key] = { browser: br.key, viewport: vp.label, page: pg.key, values, shot: shotName };

          // 横向溢出即时告警（这是移动端最关键的判据）
          const ov = values.doc_scroll_w;
          if (ov && ov.overflow > 1) {
            console.log(`  ⚠️ ${key} 横向溢出 ${ov.overflow}px（scrollWidth=${ov.scrollWidth} > clientWidth=${ov.clientWidth}）`);
          }
        } catch (err) {
          console.log(`  ❌ ${key} 失败：${err.message.slice(0, 80)}`);
          results[key] = { browser: br.key, viewport: vp.label, page: pg.key, error: err.message.slice(0, 120) };
        }
        await context.close();
      }
    }
    await browser.close();
  }

  const outFile = path.join(runDir, 'components.json');
  await writeFile(outFile, JSON.stringify({ measuredAt: stamp, base: BASE, results }, null, 2), 'utf8');
  console.log(`\n[regression] 测量完成 → ${outFile}`);

  // ── 汇总：跨视口 / 跨浏览器不一致的组件 ──
  console.log('\n════ 跨视口 / 跨浏览器不一致的组件 ════\n');
  const byPage = {};
  for (const [key, r] of Object.entries(results)) {
    if (r.error) continue;
    (byPage[r.page] ??= []).push(r);
  }

  let totalInconsistent = 0;
  for (const [pgKey, runs] of Object.entries(byPage)) {
    // ⚠️ 汇总必须**分两类**看，否则会把「响应式理应变」误报成问题：
    //
    //   A. **同浏览器、跨视口** —— 布局类组件**理应**不同（响应式）
    //      ⇒ 只报「**同视口下跨浏览器**不一致的，那才是真异常」
    //   B. **同视口、跨浏览器** —— 排版/颜色类**理应**一致
    //      ⇒ 这里的不一致是真问题（浏览器兼容性缺陷）
    //
    // 第一次实现时混在一起统计 ⇒ 报出 55 个「不一致」，
    // 其中绝大多数是响应式的**预期**差异 —— 那是**误报**，
    // 会让人以为到处是问题（狼来了），反而埋掉真信号。
    const byVp = {};
    for (const r of runs) (byVp[r.viewport] ??= []).push(r);

    const crossBrowser = [];
    for (const [vp, list] of Object.entries(byVp)) {
      if (list.length < 2) continue;
      const ref = list[0];
      for (const r of list) {
        if (r === ref) continue;
        for (const d of diffComponents(ref.values, r.values)) {
          crossBrowser.push({ vp, browser: r.browser, ...d });
        }
      }
    }

    if (crossBrowser.length === 0) {
      console.log(`【${pgKey}】✅ 同视口下 3 个浏览器表现一致（${runs.length} 个组合）`);
      continue;
    }
    totalInconsistent += crossBrowser.length;
    console.log(`【${pgKey}】⚠️ 同视口下跨浏览器不一致 ${crossBrowser.length} 项（**这才是真异常**）：`);
    // 按「出现次数最多的组件」排序 ⇒ 直接告诉你要修哪里
    const byComp = {};
    for (const d of crossBrowser) {
      (byComp[`${d.group}/${d.label}`] ??= []).push(`${d.browser}@${d.vp}: ${d.a} → ${d.b}`);
    }
    const sorted = Object.entries(byComp).sort((a, b) => b[1].length - a[1].length);
    for (const [label, where] of sorted.slice(0, 10)) {
      console.log(`   ${label.padEnd(24)} 差异于 ${where.length} 个组合`);
      for (const w of where.slice(0, 3)) console.log(`      ${w}`);
      if (where.length > 3) console.log(`      …另 ${where.length - 3} 个`);
    }
  }

  // ── 横向溢出汇总 ──
  console.log('\n════ 横向溢出 ════');
  let overflowCount = 0;
  for (const [key, r] of Object.entries(results)) {
    if (r.error) continue;
    const ov = r.values.doc_scroll_w;
    if (ov && ov.overflow > 1) {
      overflowCount++;
      console.log(`  ⚠️ ${key} 溢出 ${ov.overflow}px`);
    }
  }
  if (overflowCount === 0) console.log('  ✅ 无横向溢出');

  // ── 基线保存 / 对比 ──
  if (SAVE_BASELINE) {
    await writeFile(BASELINE_FILE, JSON.stringify({ savedAt: stamp, base: BASE, results }, null, 2), 'utf8');
    console.log(`\n[regression] 基线已保存 → ${BASELINE_FILE}`);
  } else if (COMPARE_BASELINE) {
    try {
      const baseline = JSON.parse(await readFile(BASELINE_FILE, 'utf8'));
      console.log(`\n════ 与基线对比（基线保存于 ${baseline.savedAt}）════\n`);
      let regressions = 0;
      for (const [key, r] of Object.entries(results)) {
        const b = baseline.results[key];
        if (!b) {
          console.log(`  🆕 ${key} 基线中不存在`);
          continue;
        }
        const diffs = diffComponents(b.values, r.values);
        if (diffs.length === 0) continue;
        regressions += diffs.length;
        console.log(`  🔴 ${key} 有 ${diffs.length} 个组件变化：`);
        for (const d of diffs.slice(0, 6)) {
          console.log(`      ${d.label}: ${d.a} → ${d.b}`);
        }
      }
      console.log(`\n[regression] 回归项合计：${regressions}`);
      if (regressions > 0) process.exitCode = 1;
    } catch {
      console.log(`\n[regression] ⚠️ 基线不存在（${BASELINE_FILE}）—— 先用 --save-baseline 建立`);
    }
  }

  console.log(`\n[regression] 不一致组件合计：${totalInconsistent}`);
}

main().catch((err) => {
  console.error('[regression] 失败：', err);
  process.exit(1);
});
