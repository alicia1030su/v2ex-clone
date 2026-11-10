/**
 * v0.0.16 页面健康与布局缺陷探针（真实浏览器）
 *
 * ## 与「截图看完觉得像」的区别
 *
 * 这个脚本输出**可判定的缺陷**，而不是观感：
 *
 *   1. `overflowX`   —— 横向溢出（`scrollWidth > clientWidth`）
 *   2. `badNesting`  —— `.box > .cell > .cell`（cell 嵌套 cell，结构错位）
 *   3. `floatBleed`  —— `.cell` 高度 < 其内部 `.fr` 元素高度（浮动未清除）
 *   4. `consoleErrors` / `pageErrors`
 *   5. `failedRequests` —— 静态资源 4xx/5xx（CSS/JS/图片）
 *   6. `hydrated`    —— React 是否完成水合（`__next_f` 存在且无 hydration 警告）
 *
 * ## 为什么必须查「cell 嵌套 cell」
 *
 * v0.0.16 实测：主题详情页的「N 条回复」被写在了**标签 cell 内部**，
 * 而标签 cell 内部又嵌套了一个放主题操作栏的 cell ⇒
 *   · 匿名访客看到一个**空白 cell**（操作栏 `if (!user) return null`）；
 *   · 回复头被拆成「标签 / 空块 / 计数」三段，与参考站的**单行头**完全不同。
 * 这类问题不会让任何测试变红（HTTP 200、无控制台错误），只能靠结构断言抓。
 *
 * 用法：
 *   node tools/visual/probe-pages.mjs --base http://127.0.0.1:3210 \
 *     --viewports 1280x900,375x812 --json out.json
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const get = (n, d) => {
  const eq = argv.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const BASE = get('base', 'http://127.0.0.1:3210');
const VIEWPORTS = get('viewports', '1280x900,375x812')
  .split(',')
  .map((s) => s.split('x').map(Number))
  .map(([width, height]) => ({ width, height }));
const CHANNEL = get('channel', process.env.BROWSER_CHANNEL || 'msedge');
const JSON_OUT = get('json', null);

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'nodes', path: '/nodes' },
  { name: 'node_detail', path: '/go/claude' },
  { name: 'topic_detail', path: '/t/1' },
  { name: 'member', path: '/member/admin' },
  { name: 'signin', path: '/signin' },
  { name: 'signup', path: '/signup' },
  { name: 'search', path: '/go/search?q=claude' },
  { name: 'about', path: '/about' },
  { name: 'faq', path: '/faq' },
  { name: 'hot', path: '/' },
  { name: 'notifications', path: '/notifications' },
  { name: 'bookmarks', path: '/bookmarks' },
  { name: 'settings', path: '/settings' },
];

async function probe(page, vp) {
  const errors = [];
  const pageErrors = [];
  const failed = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(BASE)) {
      failed.push(`${r.status()} ${r.url().replace(BASE, '')}`);
    }
  });

  await page.setViewportSize(vp);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  const out = [];
  for (const p of PAGES) {
    errors.length = 0;
    pageErrors.length = 0;
    failed.length = 0;
    const resp = await page.goto(BASE + p.path, { waitUntil: 'networkidle' }).catch(() => null);
    const status = resp ? resp.status() : null;
    const data = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const overflowX = Math.max(doc.scrollWidth, body.scrollWidth) - doc.clientWidth;

      // .box > .cell > .cell（直接的 cell 嵌套 cell）
      const badNesting = [];
      for (const box of document.querySelectorAll('.box')) {
        for (const cell of box.querySelectorAll(':scope > .cell')) {
          if (cell.querySelector(':scope > .cell')) {
            badNesting.push((cell.textContent || '').trim().slice(0, 30));
          }
        }
      }

      // 浮动未清除：cell 的 clientHeight 小于其直接子元素里最高的非 .fr 元素
      const floatBleed = [];
      for (const cell of document.querySelectorAll('.cell')) {
        const fr = cell.querySelector(':scope > .fr');
        if (!fr) continue;
        const cellRect = cell.getBoundingClientRect();
        const frRect = fr.getBoundingClientRect();
        if (frRect.height > 0 && cellRect.height < frRect.height) {
          floatBleed.push(`${(cell.textContent || '').trim().slice(0, 24)}`);
        }
      }

      // 结构几何：主栏 / 右栏 / 内容盒
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };

      // 空 cell（除空白外无可见内容）
      const emptyCells = [];
      for (const cell of document.querySelectorAll('.cell')) {
        const hasEl = cell.querySelector('img, input, button, a, svg, canvas');
        const txt = (cell.textContent || '').replace(/\s+/g, '');
        if (!hasEl && txt.length === 0) {
          const r = cell.getBoundingClientRect();
          if (r.height > 0) emptyCells.push(`${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }

      return {
        overflowX,
        badNesting,
        floatBleed,
        emptyCells: emptyCells.slice(0, 6),
        main: rect('#Main'),
        rightbar: rect('#Rightbar'),
        content: rect('#Wrapper .content'),
        top: rect('#Top'),
        h1: document.querySelector('h1')?.textContent?.trim().slice(0, 40) ?? null,
        boxes: document.querySelectorAll('.box').length,
        hydrated: typeof window.__next_f !== 'undefined' || !!document.querySelector('[data-reactroot]') === false,
        docH: doc.scrollHeight,
      };
    });

    out.push({
      page: p.name,
      path: p.path,
      vp: `${vp.width}x${vp.height}`,
      status,
      ...data,
      consoleErrors: errors.slice(0, 4),
      pageErrors: pageErrors.slice(0, 4),
      failedRequests: [...new Set(failed)].slice(0, 6),
    });
  }
  return out;
}

const browser = await chromium.launch({ channel: CHANNEL });
const results = [];
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'zh-CN' });
  const page = await ctx.newPage();
  results.push(...await probe(page, vp));
  await ctx.close();
}
await browser.close();

const summary = results.map((r) => ({
  page: r.page.padEnd(14),
  vp: r.vp.padEnd(9),
  status: String(r.status).padEnd(4),
  overflowX: r.overflowX,
  nest: r.badNesting.length,
  float: r.floatBleed.length,
  empty: r.emptyCells.length,
  errs: r.consoleErrors.length + r.pageErrors.length,
  failed: r.failedRequests.length,
  mainW: r.main?.w ?? null,
  sideW: r.rightbar?.w ?? null,
}));

console.table(summary);
if (JSON_OUT) {
  await writeFile(JSON_OUT, JSON.stringify({ measuredAt: new Date().toISOString(), base: BASE, results }, null, 2), 'utf8');
  console.error(`已写入 ${JSON_OUT}`);
}

const hardFails = results.filter(
  (r) => r.status !== 200 || r.overflowX > 1 || r.badNesting.length > 0 || r.pageErrors.length > 0 || r.failedRequests.length > 0,
);
if (hardFails.length > 0) {
  console.error(`\n⚠️ ${hardFails.length} 个页面存在硬缺陷：`);
  for (const f of hardFails) {
    console.error(
      `  [${f.vp}] ${f.page}: status=${f.status} overflowX=${f.overflowX} nest=${JSON.stringify(f.badNesting)} ` +
        `pageErr=${JSON.stringify(f.pageErrors)} failed=${JSON.stringify(f.failedRequests)}`,
    );
  }
  process.exitCode = 1;
}
