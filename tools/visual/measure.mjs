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
import { loadAndVerify } from './lib/page-health.mjs';

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
  /*
   * ⚠️ 这里**不允许**把等待失败静默吞掉。
   *
   * 原站页面常挂着长期未完成的第三方请求（广告 / 统计），`networkidle`
   * 未必能静默 —— 但「没静默」这件事本身必须**被记录**，否则量出来的
   * 几何到底是在一张稳定页面上取的、还是在半加载页面上取的，无从判断。
   * 所以：超时不抛死，但把 `_networkIdle=false` 写进测量结果，可审计。
   */
  let networkIdle = true;
  try {
    await page.waitForLoadState('networkidle', { timeout: 30000 });
  } catch {
    networkIdle = false;
  }
  try {
    await page.evaluate(() => document.fonts?.ready);
  } catch {
    /* 字体 API 不存在时不影响测量 */
  }
  await page.waitForTimeout(500);
  const data = await page.evaluate(MEASURE, TARGETS);
  data._networkIdle = networkIdle;
  return data;
}

/**
 * 本地页面必须在**样式已生效**的前提下才测量。
 *
 * 否则量到的「本地几何」是「无 CSS 的 HTML 流」，
 * 拿它和原站比出来的 Δx/Δy 全是假的 —— 表格看起来精确到像素，
 * 实际是拿一张废页面在算偏差。
 */
async function measureLocalVerified(page, url) {
  const r = await loadAndVerify(page, url, { expectUrl: new URL(url).pathname, requireRightbar: false });
  const failed = r.checks.filter((c) => !c.ok && c.severity === 'blocker');
  if (!r.ok) {
    return { error: `健康门禁未通过：${failed.map((c) => c.id).join(',')}`, checks: failed };
  }
  return page.evaluate(MEASURE, TARGETS);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  /**
   * 原站与本地**分开两只浏览器**。
   *
   * 旧实现只有一只、且无条件带 `--proxy-server` ⇒ 本地页面的
   * `/_next/static/*` 也被送进代理，量出来的几何是无样式 HTML 的几何。
   */
  const refBrowser = await chromium.launch({
    ...(USE_SYSTEM_BROWSER ? { channel: CHANNEL } : {}),
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const refCtx = await refBrowser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    proxy: { server: PROXY, bypass: 'localhost,127.0.0.1,::1,0.0.0.0' },
  });
  const locBrowser = await chromium.launch({
    ...(USE_SYSTEM_BROWSER ? { channel: CHANNEL } : {}),
  });
  const locCtx = await locBrowser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  });

  const page = await refCtx.newPage();
  const locPage = await locCtx.newPage();
  let invalid = 0;

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
      loc = await measureLocalVerified(locPage, LOCAL_BASE + p.local);
    } catch (e) {
      loc = { error: e.message };
    }
    if (loc?.error) {
      invalid += 1;
      console.log(`  ✗ 本地测量无效：${loc.error}（该项不作为对比依据）`);
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

  await refCtx.close().catch(() => {});
  await refBrowser.close().catch(() => {});
  await locCtx.close().catch(() => {});
  await locBrowser.close().catch(() => {});
  const outFile = path.join(OUT_DIR, `layout-measurements-${VIEWPORT_LABEL}.json`);
  await writeFile(
    outFile,
    JSON.stringify(
      {
        viewport: VIEWPORT,
        generatedAt: new Date().toISOString(),
        // 无效条目数 > 0 时，deltas 不完整，不得据此下「还原度」结论
        invalidLocalMeasurements: invalid,
        report,
      },
      null,
      2,
    ),
  );
  console.log(`\n✓ 布局测量: ${path.relative(ROOT, outFile)}`);
  if (invalid > 0) {
    console.error(`✗ ${invalid} 个本地页面测量无效（健康门禁未通过）`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('✗ 测量失败:', e);
  process.exit(1);
});
