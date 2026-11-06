/**
 * V2EX 原站公开页面几何探测（v0.0.7）
 *
 * ## 合规边界（硬约束）
 *
 * - **只读、低频**：每个页面只加载一次，无轮询、无并发抓取。
 * - **只用公开页面**：不登录、不绕过任何访问控制、不抓需登录内容。
 * - **不镜像受保护内容**：只输出**数值测量**（宽高/颜色/字体/间距），
 *   绝不把原站完整 HTML/CSS/JS 或图片写入仓库或 artifact。
 * - **不采集私人数据**：只测布局几何，不读用户主页内容。
 *
 * ## 用法
 *
 *   node tools/visual/v2ex-probe.mjs [--base https://www.v2ex.com]
 *
 * 输出：docs/evidence/visual/v2ex-probe-<stamp>.json
 *   { reachable: boolean, reason?: string, pages: { <key>: { url, values } } }
 *
 * 原站不可达时 reachable=false 并带原因 —— 调用方（CI 判定）据此标记
 * UNVERIFIED，**不得**把「本站回归通过」冒充成「与原站一致」。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const argv = process.argv.slice(2);
const get = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const BASE = get('base', 'https://www.v2ex.com');
const ROOT = path.resolve(process.cwd());
const OUT_DIR = path.join(ROOT, 'docs', 'evidence', 'visual');

/** 与原站对照的组件（与 tools/visual/regression.mjs 同一套口径） */
const COMPONENTS = [
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
  { group: '组件', key: 'avatar', label: '头像', selector: 'img.avatar' },
  { group: '组件', key: 'box_border', label: '盒子边框', selector: '.box', prop: 'border' },
  { group: '组件', key: 'box_bg', label: '盒子背景', selector: '.box', prop: 'backgroundColor' },
  { group: '组件', key: 'cell_pad', label: '单元格内边距', selector: '.cell', prop: 'padding' },
  { group: '组件', key: 'cell_bb', label: '单元格分割线', selector: '.cell', prop: 'borderBottom' },
  { group: '组件', key: 'item_title', label: '主题标题链接', selector: '.item_title a, .topic_link' },
  { group: '组件', key: 'topic_info', label: '主题元信息行', selector: '.topic_info' },
  { group: '组件', key: 'reply_count', label: '回复数', selector: '.count_livid' },
  { group: '组件', key: 'node_fade', label: '节点标签', selector: '.node, .node-nav' },
  { group: '组件', key: 'sidebar_box', label: '侧栏盒子', selector: '#Rightbar .box, .sidebar-combox' },
];

/** 在页面里量测 */
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
      if (!el) { out[c.key] = null; continue; }
      const cs = getComputedStyle(el);
      if (c.prop) { out[c.key] = cs[c.prop] ?? null; }
      else {
        const r = el.getBoundingClientRect();
        out[c.key] = { w: Math.round(r.width), h: Math.round(r.height) };
      }
    }
    return out;
  }, comps);
}

/** 从首页提取一个真实的主题链接（用于主题详情页对照） */
async function findTopicPath(page) {
  try {
    const href = await page.$eval(
      '.item_title a, .topic_link, #Main .cell a[href^="/t/"]',
      (a) => a.getAttribute('href'),
    );
    return href ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const report = {
    base: BASE,
    probedAt: new Date().toISOString(),
    reachable: false,
    reason: null,
    browser: 'chromium',
    viewport: { width: 1280, height: 900 },
    pages: {},
  };

  // ---- 第一步：可达性（DNS + TCP + TLS 一层层报清楚）----
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: report.viewport });
  const page = await ctx.newPage();

  try {
    const resp = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!resp) throw new Error('无响应对象');
    report.reachable = true;
    console.log(`[probe] 原站可达：HTTP ${resp.status()}`);
  } catch (err) {
    report.reason = `连接失败：${err.message.slice(0, 200)}`;
    console.log(`[probe] 原站不可达：${report.reason}`);
    await browser.close();
    mkdirSync(OUT_DIR, { recursive: true });
    const out = path.join(OUT_DIR, `v2ex-probe-${stamp}.json`);
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`[probe] 已记录 UNVERIFIED → ${out}`);
    process.exitCode = 0; // 不可达不是错误，是事实 —— 由调用方标注
    return;
  }

  // ---- 第二步：第一批三个页面（首页 / 节点详情 / 主题详情）----
  const topicPath = await findTopicPath(page);
  const pages = [
    { key: 'home', path: '/' },
    { key: 'node', path: '/go/programmer' },
    ...(topicPath ? [{ key: 'topic', path: topicPath }] : []),
  ];

  for (const pg of pages) {
    try {
      const url = BASE + pg.path;
      const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      // 等布局稳定（不轮询，只等一个固定短时间）
      await page.waitForTimeout(1200);
      const values = await measure(page, COMPONENTS);
      const title = await page.title();
      report.pages[pg.key] = {
        url,
        httpStatus: r?.status() ?? null,
        title: title.slice(0, 120),
        values,
      };
      console.log(`[probe] ${pg.key} ${url} → HTTP ${r?.status()}，${Object.keys(values).length} 项测量`);
    } catch (err) {
      report.pages[pg.key] = { url: BASE + pg.path, error: err.message.slice(0, 200) };
      console.log(`[probe] ${pg.key} 失败：${err.message.slice(0, 120)}`);
    }
  }

  await browser.close();
  mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `v2ex-probe-${stamp}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`[probe] 完成 → ${out}`);
}

main().catch((e) => {
  console.error('[probe] 未处理异常：', e);
  process.exitCode = 1;
});
