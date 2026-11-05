/**
 * 布局差异量化分析
 *
 * 像素级 diff 无法区分「样式差异」与「内容差异」（原站真实数据 vs 本地 seed 数据）。
 * 本工具改用 DOM 几何量测：在同一视口下测量原站与本地页面的关键元素
 * 位置与尺寸，输出可直接对比的数值表格。
 *
 * 用法: node tools/visual/measure.mjs [--only home]
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const OUT_DIR = path.join(ROOT, 'docs', 'evidence', 'visual');
const PROXY = process.env.V2_PROXY ?? 'http://127.0.0.1:10001';
const LOCAL_BASE = process.env.LOCAL_BASE ?? 'http://localhost:3000';
const ORIGIN_BASE = 'https://www.v2ex.com';
const CHANNEL = process.env.BROWSER_CHANNEL ?? 'msedge';
/** 是否使用系统安装的浏览器（msedge/chrome）；未安装则回退到 Playwright 自带 Chromium */
const USE_SYSTEM_BROWSER = process.env.BROWSER_CHANNEL !== 'chromium';

const VIEWPORT = {
  width: Number(process.env.VIEWPORT_WIDTH ?? 1280),
  height: Number(process.env.VIEWPORT_HEIGHT ?? 900),
};
const VIEWPORT_LABEL = process.env.VIEWPORT_LABEL ?? `${VIEWPORT.width}x${VIEWPORT.height}`;

const PAGES = [
  { name: 'home', origin: '/', local: '/' },
  { name: 'node_claude', origin: '/go/claude', local: '/go/claude' },
  { name: 'topic_detail', origin: '/t/1253638', local: '/t/1' },
  { name: 'signin', origin: '/signin', local: '/signin' },
  { name: 'signup', origin: '/signup', local: '/signup' },
  { name: 'member', origin: '/member/reoah2', local: '/member/admin' },
];

/** 待测量的选择器与标签 */
const TARGETS = [
  { key: 'top', sel: '#Top' },
  { key: 'logo', sel: '#Logo' },
  { key: 'search', sel: '#search-container' },
  { key: 'wrapper_content', sel: '#Wrapper > .content' },
  { key: 'main', sel: '#Main' },
  { key: 'rightbar', sel: '#Rightbar' },
  { key: 'first_box', sel: '#Main .box' },
  { key: 'first_topic_item', sel: '#Main .cell.item' },
  { key: 'topic_title', sel: '#Main .item_title' },
  { key: 'topic_info', sel: '#Main .topic_info' },
  { key: 'reply_count', sel: '#Main .count_livid' },
  { key: 'side_bar_box', sel: '#Rightbar .box' },
];

/** 在页面内执行的几何测量脚本 */
const MEASURE = (targets) => {
  const out = {};
  for (const t of targets) {
    const el = document.querySelector(t.sel);
    if (!el) {
      out[t.key] = null;
      continue;
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[t.key] = {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      fontWeight: cs.fontWeight,
      color: cs.color,
      background: cs.backgroundColor,
      borderRadius: cs.borderRadius,
      padding: cs.padding,
      margin: cs.margin,
      borderBottom: cs.borderBottomWidth + ' ' + cs.borderBottomStyle + ' ' + cs.borderBottomColor,
      boxShadow: cs.boxShadow === 'none' ? 'none' : 'yes',
    };
  }
  // 额外：文档与 body 度量
  const body = document.body;
  const bcs = getComputedStyle(body);
  out._body = {
    fontFamily: bcs.fontFamily,
    fontSize: bcs.fontSize,
    background: bcs.backgroundColor,
    minWidth: bcs.minWidth,
  };
  out._document = {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    // 横向溢出检测 —— 窄屏下出现横向滚动条是明确的布局缺陷
    horizontalOverflow:
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };

  // —— 主题列表密度（每条主题的垂直间距）
  const items = Array.from(document.querySelectorAll('#Main .cell.item'));
  if (items.length >= 2) {
    const gaps = [];
    for (let i = 1; i < items.length; i++) {
      gaps.push(
        Math.round(items[i].getBoundingClientRect().top - items[i - 1].getBoundingClientRect().top),
      );
    }
    out._density = {
      itemCount: items.length,
      avgItemHeight: Math.round(
        items.reduce((s, el) => s + el.getBoundingClientRect().height, 0) / items.length,
      ),
      avgGap: Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length),
    };
  } else {
    out._density = { itemCount: items.length, avgItemHeight: null, avgGap: null };
  }

  // —— 左右栏比例
  const mainEl = document.querySelector('#Main');
  const rightEl = document.querySelector('#Rightbar');
  if (mainEl && rightEl) {
    const mw = mainEl.getBoundingClientRect().width;
    const rw = rightEl.getBoundingClientRect().width;
    out._columns = {
      mainWidth: Math.round(mw),
      rightbarWidth: Math.round(rw),
      ratio: mw > 0 ? Math.round((rw / mw) * 1000) / 1000 : null,
    };
  } else {
    out._columns = { mainWidth: null, rightbarWidth: null, ratio: null };
  }

  return out;
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}
const only = arg('only');

async function measurePage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(500);
  return page.evaluate(MEASURE, TARGETS);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    ...(USE_SYSTEM_BROWSER ? { channel: CHANNEL } : {}),
    args: [`--proxy-server=${PROXY}`],
  });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  const report = [];

  for (const p of PAGES) {
    if (only && p.name !== only) continue;

    let ref = null;
    let loc = null;
    try {
      ref = await measurePage(page, ORIGIN_BASE + p.origin);
    } catch (e) {
      ref = { error: e.message };
    }
    await page.waitForTimeout(1000);
    try {
      loc = await measurePage(page, LOCAL_BASE + p.local);
    } catch (e) {
      loc = { error: e.message };
    }

    const keys = [...TARGETS.map((t) => t.key), '_body', '_document'];
    const rows = keys.map((k) => ({
      key: k,
      reference: ref?.[k] ?? null,
      local: loc?.[k] ?? null,
    }));

    // 计算几何偏差（仅当两边都有值）
    const deltas = [];
    for (const t of TARGETS) {
      const r = ref?.[t.key];
      const l = loc?.[t.key];
      if (!r || !l) continue;
      deltas.push({
        key: t.key,
        dx: l.x - r.x,
        dy: l.y - r.y,
        dw: l.w - r.w,
        dh: l.h - r.h,
      });
    }

    report.push({ name: p.name, rows, deltas });
    console.log(`\n[${p.name}]`);
    for (const d of deltas) {
      const flag =
        Math.abs(d.dx) > 3 || Math.abs(d.dy) > 3 || Math.abs(d.dw) > 3 || Math.abs(d.dh) > 3
          ? '  ← 偏差'
          : '';
      console.log(
        `  ${d.key.padEnd(20)} Δx=${String(d.dx).padStart(5)} Δy=${String(d.dy).padStart(5)} ` +
          `Δw=${String(d.dw).padStart(5)} Δh=${String(d.dh).padStart(5)}${flag}`,
      );
    }
    await page.waitForTimeout(800);
  }

  await browser.close();
  const outFile = path.join(OUT_DIR, `layout-measurements-${VIEWPORT_LABEL}.json`);
  await writeFile(
    outFile,
    JSON.stringify({ viewport: VIEWPORT, generatedAt: new Date().toISOString(), report }, null, 2),
  );
  console.log(`\n✓ 布局测量: ${path.relative(ROOT, outFile)}`);
}

main().catch((e) => {
  console.error('✗ 测量失败:', e);
  process.exit(1);
});
