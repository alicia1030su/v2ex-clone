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
 * ## 汇总口径（v0.0.6 修正，防误报）
 *
 * 第一次实现把「同浏览器跨视口」与「同视口跨浏览器」混在一起统计
 * ⇒ 报出 55 个「不一致」，其中绝大多数是**响应式的预期差异** —— 那是**误报**。
 *
 * v0.0.6 首轮 63 组合又抓到两类**工具层误报**（不是产品缺陷）：
 *   1. font-family 的跨引擎序列化差异（chromium 带引号 / 另两家不带）
 *   2. rgba alpha 的 8bit 舍入差异（0.227 vs 0.228）
 * 另有三引擎间 1% 左右的**文本高度方差**（字体度量所致，正常）。
 * 现已归一化样式字符串 + 宽度严格 / 高度 2% 容差 / 溢出 ≤1px 视为 0。
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
const SAVE_BASELINE = argv.includes('--save-baseline');
const COMPARE_BASELINE = argv.includes('--compare-baseline');

/**
 * v0.0.8：浏览器时钟锚点（冻结用）
 *
 * 页面里的相对时间文案（src/lib/time.ts 的 relativeTime）用**当前墙上时钟**
 * 计算 ⇒ 同一份种子数据在不同时刻渲染出不同长度的文本 ⇒ 窄视口下换行
 * ⇒ 容器高度变化 ⇒ 视觉基线随时间「漂移」（实测：320x568 视口内容容器
 * 高度差 120px，master 与特性分支**同样失败** ⇒ 与代码改动无关）。
 *
 * 冻结到**种子数据的时间锚点**（与 CI 的 SEED_TIME_ANCHOR 一致），
 * 每次测量基于同一时刻 ⇒ 确定性。
 *
 * 可用环境变量 VISUAL_CLOCK_ANCHOR 覆盖（ISO8601）。
 */
const CLOCK_ANCHOR = new Date(
  process.env.VISUAL_CLOCK_ANCHOR ?? '2026-11-06T04:00:00.000Z',
);

/**
 * v0.0.6：基线**按平台分文件**。
 *
 * ## 为什么必须分平台
 *
 * 首轮远端 CI（Linux）实跑暴露：把 Windows 上生成的基线拿到 Linux 上对比，
 * **WebKit 的移动视口高度差了 39~51px**（node@320: 483 → 522，8%），
 * 而 Chromium 与 Firefox 全部一致。
 *
 * 根因：**字体度量不同** —— Windows 与 Linux 的默认无衬线字体不同
 * （Helvetica Neue → Liberation Sans / DejaVu Sans），
 * 同样的文本会占据不同高度 ⇒ 容器高度随之变化。
 *
 * 这**不是产品缺陷**，是**跨平台基线不可直接复用**。
 * ⇒ 基线必须按平台分别建立与对比：
 *   docs/evidence/visual/component-baseline-<platform>.json
 *
 * 平台标识取 `process.platform`（win32 / linux / darwin），
 * 可用 `--platform=` 覆盖（如在容器里复现另一平台的基线）。
 */
const PLATFORM = get('platform', process.platform);
const BASELINE_FILE = path.join(VISUAL_DIR, `component-baseline-${PLATFORM}.json`);
/** 旧的无平台后缀基线（Windows 首次建立）—— 只读，不再更新 */
const LEGACY_BASELINE_FILE = path.join(VISUAL_DIR, 'component-baseline.json');

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
  { key: 'home', path: '/', waitFor: '#Main' },
  { key: 'node', path: '/go/programmer', waitFor: '#TopicsNode' },
  { key: 'topic', path: '/t/1', waitFor: '#topic-replies' },
];

/**
 * 组件定义
 *
 * `selector` 是本站自己的选择器（不与原站共用 —— 见文件头说明）。
 * `prop` 为空时量几何（w×h），否则量计算样式。
 */
const COMPONENTS = [
  // ⚠️ v0.0.6：`.content` 会同时匹配 `#Top > .content`（顶栏容器）与
  //   `#Wrapper > .content`（页面主容器）—— `querySelector` 取**文档序第一个**，
  //   而顶栏在 DOM 里更靠前 ⇒ Firefox/WebKit 测到的是**顶栏**（304×74）
  //   而不是主容器（280×102）⇒ 被误判成「跨浏览器不一致 180 项」。
  //   ⇒ 用 `#Wrapper > .content` 精确指向页面主容器。
  { group: '布局', key: 'wrapper', label: '页面容器', selector: '#Wrapper, body' },
  { group: '布局', key: 'content', label: '内容容器', selector: '#Wrapper > .content' },
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
    // ⚠️ v0.0.6：Firefox 的**经典滚动条**会占掉 body 的宽度
    //   （实测 @320：documentElement.clientWidth 三引擎都是 320，
    //     但 body.clientWidth 在 Firefox 是 304、其余是 320）。
    //   ⇒ 量 body 子元素的宽度时，**减去该差额**做归一化，
    //     否则跨引擎比较会得到纯滚动条差异的假异常。
    const bodyW = document.body ? document.body.clientWidth : cw;
    const scrollbarW = Math.max(0, cw - bodyW);
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
        // ⚠️ body 自身**不能**减（它的宽度就是 clientWidth 减去滚动条），
        //   否则会减两次（实测 @320：Firefox 320 → 288）。
        const isBody = el === document.body || el === document.documentElement;
        const inBody = !isBody && document.body.contains(el);
        out[c.key] = {
          w: Math.round(r.width - (inBody ? scrollbarW : 0)),
          h: Math.round(r.height),
        };
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

/**
 * v0.0.6：归一化计算样式值，消除**跨引擎序列化差异**造成的误报。
 *
 * 实测踩到（2026-11-06 首轮 63 组合）：
 *   1. **font-family**：chromium 序列化为 `"Helvetica Neue", "Luxi Sans", …`（带引号），
 *      firefox / webkit 为 `Helvetica Neue, Luxi Sans, …`（不带引号）——
 *      **同一个计算值**，字符串比较却判「不一致」。
 *   2. **rgba alpha 舍入**：CSS 声明 `rgba(128,128,128,0.228)`，
 *      chromium 序列化为 `0.227`、firefox 为 `0.228` ——
 *      两者都是 8bit 量化（0.228×255=58.14→58/255=0.2275）的正确舍入。
 *   这两类占首轮「跨浏览器不一致」的大多数，是**工具误报**，不是产品缺陷。
 */
function normStyle(v) {
  if (typeof v !== 'string') return v;
  let out = v;
  // font-family（含逗号的字符串）：去引号 + 统一逗号间距
  if (v.includes(',')) {
    out = v
      .replace(/["']/g, '')
      .replace(/\s*,\s*/g, ',')
      .replace(/\s+/g, ' ')
      .trim();
  }
  // 颜色：alpha 按 8bit 量化后保留 3 位小数。
  // ⚠️ 必须处理**内嵌**的 rgba() —— border 简写形如
  //    `1px solid rgba(128, 128, 128, 0.227)`（前缀 + 颜色），
  //    只匹配整串会漏掉它（实测：7 个视口 × 3 页全部误报）。
  out = out.replace(/rgba?\(([^)]+)\)/g, (m, inner) => {
    const parts = inner.split(',').map((s) => s.trim());
    if (parts.length === 4) {
      const a = Math.round(parseFloat(parts[3]) * 255) / 255;
      return `rgba(${parts[0]},${parts[1]},${parts[2]},${a.toFixed(3)})`;
    }
    if (parts.length === 3) return `rgb(${parts.join(',')})`;
    return m;
  });
  return out;
}

/**
 * v0.0.6：几何相等判定（跨引擎）。
 *
 * - **宽度**：严格（≤1px）—— 布局宽度是确定性的，差异即真缺陷。
 *   ⚠️ 例外：**Firefox 的经典滚动条会占掉 body 的 16px**
 *   （实测 @320：`documentElement.clientWidth` 三引擎都是 320，
 *     但 `body.clientWidth` 在 Firefox 是 304、其余是 320），
 *   ⇒ 用 body 的宽度做跨引擎比较会得到**纯滚动条差异**的假异常。
 *   处置：宽度比较时**把 body 的宽度按滚动条占位归一化**
 *   （减去 `innerWidth - body.clientWidth` 的差额）。
 * - **高度**：4% 容差（下限 1px）—— 文本行高受**字体度量**影响，
 *   同一页面在三引擎间相差 1% 左右是**正常引擎方差**；
 *   更极端时（长标题换行点不同）实测可达 3.7%（node@390：
 *   chromium 标题换 2 行 / FF·WebKit 换 3 行 ⇒ 差 17px）——
 *   全部标红会「狼来了」埋掉真信号。
 *   **宽度永远严格**（≤1px）：布局宽度是确定性的，宽度差异即真缺陷。
 * - **溢出量**（doc_scroll_w）：≤1px 视为 0（与「横向溢出汇总」口径一致）。
 */
function valueEqual(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  if (typeof a === 'object' && typeof b === 'object') {
    if ('overflow' in a && 'overflow' in b) {
      const oa = a.overflow > 1 ? a.overflow : 0;
      const ob = b.overflow > 1 ? b.overflow : 0;
      return oa === ob;
    }
    if (Math.abs(a.w - b.w) > 1) return false;
    const hTol = Math.max(1, Math.round(Math.max(a.h, b.h) * 0.04));
    return Math.abs(a.h - b.h) <= hTol;
  }
  return normStyle(a) === normStyle(b);
}

/** 计算两个测量结果的组件级差异 */
function diffComponents(a, b) {
  const rows = [];
  for (const c of COMPONENTS) {
    const va = a?.[c.key];
    const vb = b?.[c.key];
    if (valueEqual(va, vb)) continue;
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

  // ── 决定本次测量用的时钟锚点 ──
  //
  // v0.0.8：相对时间文案在 **Server Component** 里渲染（用 Node 时钟），
  // 同一份种子数据在不同时刻渲染出**不同长度**的文本 ⇒ 窄视口换行 ⇒
  // 容器高度变化 ⇒ 基线随时间漂移（实测 320x568 视口差 120px；
  // master 与特性分支**同样失败** ⇒ 与代码改动无关）。
  //
  // 锚点优先级：
  //   1. VISUAL_CLOCK_ANCHOR（环境变量，最高优先级）
  //   2. 基线文件里的 clockAnchor（对比模式 ⇒ 与基线同一时刻 ⇒ 必然自洽）
  //   3. SEED_TIME_ANCHOR（与种子数据同刻 ⇒ 相对时间恒为「刚刚」）
  //   4. 真实当前时刻（无锚点 ⇒ 旧行为；仅当既无基线也无锚点时）
  //
  // ⚠️ 关键：**应用侧**必须用同一个锚点（APP_NOW），
  //    否则浏览器冻结了、服务器没冻结，测的仍是真实时钟下的渲染。
  let clockAnchorIso = process.env.VISUAL_CLOCK_ANCHOR?.trim() ?? '';
  let baseline = null;
  if (!clockAnchorIso && COMPARE_BASELINE) {
    try {
      const raw = JSON.parse(await readFile(BASELINE_FILE, 'utf8'));
      baseline = raw;
      clockAnchorIso = typeof raw.clockAnchor === 'string' ? raw.clockAnchor : '';
    } catch {
      /* 基线不存在 ⇒ 后面会按「缺基线」处理 */
    }
  }
  if (!clockAnchorIso) {
    clockAnchorIso = process.env.SEED_TIME_ANCHOR?.trim() ?? '';
  }
  const clockAnchor = clockAnchorIso ? new Date(clockAnchorIso) : null;
  const clockAnchorValid = clockAnchor && !Number.isNaN(clockAnchor.getTime());
  if (clockAnchorIso && !clockAnchorValid) {
    console.error(
      `[regression] 时钟锚点不合法：${clockAnchorIso}（应为 ISO8601）—— 已回退真实时钟`,
    );
  }
  console.log(
    `[regression] 时钟锚点：${
      clockAnchorValid ? clockAnchor.toISOString() : '（真实时钟 —— 基线会漂移！）'
    }`,
  );

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
          // ⚠️ v0.0.8：冻结浏览器时钟 —— 否则相对时间文案会随墙上时钟漂移。
          //
          // 现象（实测）：页面主题列表显示「8 小时前 / 1 天前」（src/lib/time.ts
          // 的 relativeTime 用 `new Date()`）。基线保存于 11-06 12:30，
          // 11-07 再跑时同一批数据变成「1 天前」⇒ 文本更长、在 320px 窄视口
          // 换行 ⇒ 容器高度变化 120px ⇒ 视觉回归**误报**。
          // （master 上同样失败 ⇒ 与任何代码改动无关，是基线的时间炸弹。）
          //
          // 冻结到 seed 的时间锚点 ⇒ 每次测量基于同一时刻 ⇒ 确定性。
          await page.clock.setFixedTime(new Date(CLOCK_ANCHOR));
          await page.goto(BASE + pg.path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          // ⚠️ v0.0.6：不能只靠固定等待 —— WebKit 在 320px 的 /go/programmer
          //   上渲染更慢，600ms 时 `#Main` / `.content` 还没出现 ⇒
          //   测出来是一堆 null ⇒ 被误判成「跨浏览器不一致 200+ 项」。
          // 改为**等关键元素出现**（首页/节点页/主题页的关键容器各不相同）。
          await page
            .waitForFunction(
              (sel) => {
                const el = document.querySelector(sel);
                if (!el) return false;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              },
              pg.waitFor,
              { timeout: 15_000 },
            )
            .catch(() => {
              /* 超时也要继续 —— 缺失本身就是要报告的事实 */
            });
          // 再给一点点布局稳定时间（字体度量/图片加载）
          await page.waitForTimeout(300);
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
    await writeFile(
      BASELINE_FILE,
      JSON.stringify(
        {
          savedAt: stamp,
          // v0.0.8：把本次使用的时钟锚点写进基线 ⇒
          // 后续对比时用**同一个锚点**测量 ⇒ 基线不会随时间漂移。
          clockAnchor: clockAnchorValid ? clockAnchor.toISOString() : null,
          base: BASE,
          platform: PLATFORM,
          results,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`\n[regression] 基线已保存（平台 ${PLATFORM}）→ ${BASELINE_FILE}`);
    if (!clockAnchorValid) {
      console.log(
        '[regression] ⚠️ 本次未使用固定时钟锚点 —— 基线会随墙上时钟漂移（建议设置 VISUAL_CLOCK_ANCHOR 或 SEED_TIME_ANCHOR）',
      );
    }
  } else if (COMPARE_BASELINE) {
    try {
      const baseline = JSON.parse(await readFile(BASELINE_FILE, 'utf8'));
      console.log(`\n════ 与基线对比（平台 ${PLATFORM}，基线保存于 ${baseline.savedAt}）════\n`);
      // v0.0.8：基线自带锚点但本次没用 ⇒ 明确提示（否则对比结果无意义）
      if (baseline.clockAnchor && !clockAnchorValid) {
        console.log(
          `[regression] ⚠️ 基线带时钟锚点（${baseline.clockAnchor}），但本次测量未冻结时钟 ⇒ 对比结果不可信`,
        );
      }
      let regressions = 0;
      const missingKeys = [];
      for (const [key, r] of Object.entries(results)) {
        const b = baseline.results[key];
        if (!b) {
          // v0.0.6：**新增组合也算失败** —— 基线缺项意味着「这个组合从未被审查过」，
          // 静默跳过会让未审查的页面混进「已验证」里。
          missingKeys.push(key);
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
      if (missingKeys.length > 0) {
        // v0.0.6：基线缺项必须失败（不得静默跳过未审查的组合）
        console.log(`[regression] 基线缺项：${missingKeys.length} 个组合不在基线中`);
        for (const k of missingKeys) console.log(`      ${k}`);
        process.exitCode = 1;
      }
      if (regressions > 0) process.exitCode = 1;
    } catch {
      // v0.0.6：基线文件不存在 ⇒ **失败**，不是警告 ——
      // 「没有基线」与「基线全部一致」是两回事，混淆会让 CI 绿灯
      // 掩盖「从未做过视觉验证」这个事实。
      //
      // 额外提示：可能是「旧的无平台后缀基线」——它只在 Windows 上有效
      // （字体度量不同 ⇒ Linux 上的高度本就不同，跨平台对比必然报差异）。
      let legacyExists = false;
      try {
        await readFile(LEGACY_BASELINE_FILE, 'utf8');
        legacyExists = true;
      } catch {
        /* 不存在 */
      }
      console.log(`\n[regression] ⚠️ 基线不存在（${BASELINE_FILE}）—— 先用 --save-baseline 建立`);
      if (legacyExists) {
        console.log(
          `[regression] ⚠️ 检测到旧基线 ${path.basename(LEGACY_BASELINE_FILE)}` +
            `（无平台后缀）——它**只在其建立时的平台有效**（字体度量不同 ⇒ 跨平台对比必然报差异）。` +
            `\n[regression]    请在本平台重新建立：node tools/visual/regression.mjs --base <url> --save-baseline`,
        );
      }
      process.exitCode = 1;
    }
  }

  console.log(`\n[regression] 不一致组件合计：${totalInconsistent}`);
}

main().catch((err) => {
  console.error('[regression] 失败：', err);
  process.exit(1);
});
