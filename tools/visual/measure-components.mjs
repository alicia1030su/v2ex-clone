/**
 * v0.0.6 组件级视觉测量
 *
 * 任务书 §四：**「不能只看整体截图像不像，必须拆分成组件逐项检查。」**
 *
 * `tools/visual/measure.mjs` 做的是**页面级**几何量测（整页宽高、主栏宽度）。
 * 本工具进一步：把页面拆成**组件**，逐项量测并输出可对比的数值表。
 *
 * ## 与原站的关系
 *
 * - **原站快照**：`docs/evidence/html/*.html`（v0.0.4 抓取的公开页面）
 * - **本站**：本地运行的应用
 * - 两侧都跑同一套测量脚本 ⇒ 输出**同构**的数值表 ⇒ 直接 diff
 *
 * ## ⚠️ 纪律
 *
 * 本工具**只测量**，不引入任何原站素材。
 * 原站 HTML 仅作为「公开可观察行为的参照」，
 * 其 CSS/JS/图片**不进入**本仓库。
 *
 * ## 用法
 *
 * ```bash
 * # 量本站（需要本地应用在跑）
 * node tools/visual/measure-components.mjs --base http://localhost:3010 --out local.json
 *
 * # 量原站快照（离线，读 docs/evidence/html/）
 * node tools/visual/measure-components.mjs --snapshot docs/evidence/html/index.html --out origin.json
 *
 * # 对比
 * node tools/visual/measure-components.mjs --compare local.json origin.json
 * ```
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
function get(name, fallback) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

/**
 * 组件定义 —— 每个条目是一个「可独立验收的视觉单元」
 *
 * `selector` 同时兼容原站与本站（两侧用同一套选择器 ⇒ 输出同构）。
 * 找不到的元素记 `null`（**不静默跳过** —— 缺失本身就是要报告的差异）。
 */
const COMPONENTS = [
  // ── 布局 ──
  { group: '布局', key: 'wrapper_width', label: '页面整体宽度', selector: '#Wrapper' },
  { group: '布局', key: 'content_width', label: '内容容器宽度', selector: '#Wrapper > .content, .content' },
  { group: '布局', key: 'main_width', label: '主内容栏宽度', selector: '#Main' },
  { group: '布局', key: 'top_height', label: '顶栏高度', selector: '#Top' },
  { group: '布局', key: 'top_position', label: '顶栏定位', selector: '#Top', prop: 'position' },

  // ── 排版 ──
  { group: '排版', key: 'body_font', label: '正文字体', selector: 'body', prop: 'fontFamily' },
  { group: '排版', key: 'body_size', label: '正文字号', selector: 'body', prop: 'fontSize' },
  { group: '排版', key: 'body_lineheight', label: '正文行高', selector: 'body', prop: 'lineHeight' },
  { group: '排版', key: 'body_color', label: '正文颜色', selector: 'body', prop: 'color' },
  { group: '排版', key: 'body_bg', label: '页面背景色', selector: 'body', prop: 'backgroundColor' },
  { group: '排版', key: 'link_color', label: '链接颜色', selector: 'a', prop: 'color' },
  { group: '排版', key: 'topic_title_size', label: '主题标题字号', selector: '.topic_title, .cell.item .title, h1', prop: 'fontSize' },

  // ── 组件 ──
  { group: '组件', key: 'avatar_size', label: '头像尺寸', selector: 'img.avatar' },
  { group: '组件', key: 'box_border', label: '盒子边框', selector: '.box', prop: 'border' },
  { group: '组件', key: 'box_bg', label: '盒子背景', selector: '.box', prop: 'backgroundColor' },
  { group: '组件', key: 'cell_padding', label: '单元格内边距', selector: '.cell', prop: 'padding' },
  { group: '组件', key: 'cell_border_bottom', label: '单元格底部分割线', selector: '.cell', prop: 'borderBottom' },
  { group: '组件', key: 'button_bg', label: '按钮背景', selector: 'button, .btn', prop: 'backgroundColor' },
  { group: '组件', key: 'sep_height', label: '分隔块高度', selector: '.sep10, .sep20' },
  { group: '组件', key: 'gray_color', label: '次要信息颜色', selector: '.gray, .fade', prop: 'color' },
  { group: '组件', key: 'small_size', label: '小字号', selector: '.f12, .small', prop: 'fontSize' },
];

/** 在页面上下文里跑测量（原站快照与本站共用同一段代码 ⇒ 保证同构） */
async function measureInPage(page, components) {
  return page.evaluate((comps) => {
    const out = {};
    for (const c of comps) {
      const el = document.querySelector(c.selector);
      if (!el) {
        out[c.key] = null; // 缺失本身是差异，不静默跳过
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
  }, components);
}

async function main() {
  const base = get('base', '');
  const snapshot = get('snapshot', '');
  const out = get('out', '');
  const compareA = get('compare', '');
  const compareB = get('with', '');

  // ── 对比模式 ──
  if (compareA && compareB) {
    const a = JSON.parse(await readFile(compareA, 'utf8'));
    const b = JSON.parse(await readFile(compareB, 'utf8'));
    console.log('════ 组件级视觉差异 ════\n');
    console.log('组件'.padEnd(22) + '本站'.padEnd(30) + '参照'.padEnd(30) + '差异');
    console.log('─'.repeat(100));
    let diff = 0;
    let same = 0;
    let missing = 0;
    for (const c of COMPONENTS) {
      const va = a.values[c.key];
      const vb = b.values[c.key];
      const sa = va === null ? '（缺失）' : typeof va === 'object' ? `${va.w}×${va.h}` : String(va);
      const sb = vb === null ? '（缺失）' : typeof vb === 'object' ? `${vb.w}×${vb.h}` : String(vb);
      const isSame = JSON.stringify(va) === JSON.stringify(vb);
      if (isSame) {
        same++;
        continue;
      }
      if (va === null || vb === null) missing++;
      else diff++;
      console.log(
        c.label.padEnd(22) +
          sa.slice(0, 28).padEnd(30) +
          sb.slice(0, 28).padEnd(30) +
          (va === null || vb === null ? '⚠️ 一侧缺失' : ''),
      );
    }
    console.log('─'.repeat(100));
    console.log(`\n相同 ${same} 项 / 差异 ${diff} 项 / 缺失 ${missing} 项`);
    if (diff + missing > 0) process.exitCode = 1;
    return;
  }

  if (!base && !snapshot) {
    console.error('需要 --base=<url> 或 --snapshot=<html 文件>');
    console.error('对比模式：--compare <a.json> --with <b.json>');
    process.exit(2);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  if (base) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
  } else {
    // 原站快照：离线加载本地 HTML 文件
    const html = await readFile(path.resolve(snapshot), 'utf8');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
  }

  const values = await measureInPage(page, COMPONENTS);
  await browser.close();

  const result = {
    measuredAt: new Date().toISOString(),
    source: base ? { kind: 'live', base } : { kind: 'snapshot', snapshot },
    viewport: '1280x900',
    values,
  };

  if (out) {
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeFile(path.resolve(out), JSON.stringify(result, null, 2), 'utf8');
    console.log(`已写入 ${out}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  // 缺失项单独提示（这是最容易被忽略的差异）
  const missingKeys = COMPONENTS.filter((c) => values[c.key] === null).map((c) => c.label);
  if (missingKeys.length > 0) {
    console.log(`\n⚠️ ${missingKeys.length} 个组件未找到（缺失本身是差异）：`);
    for (const k of missingKeys) console.log('   -', k);
  }
}

main().catch((err) => {
  console.error('测量失败：', err);
  process.exit(1);
});
