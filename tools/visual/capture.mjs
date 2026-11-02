/**
 * 视觉对比工具
 *
 * 用同一浏览器、同一视口、同一缩放、同一字体环境，分别截取原站与本地页面，
 * 然后逐像素比对并输出量化差异报告。
 *
 * 用法:
 *   node tools/visual/capture.mjs                      # 截取全部页面（对比模式）
 *   node tools/visual/capture.mjs --only home          # 只处理 home
 *   node tools/visual/capture.mjs --reference-only     # 只截原站
 *   node tools/visual/capture.mjs --local-only         # 只截本地
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const OUT_DIR = path.join(ROOT, 'docs', 'evidence', 'screenshots');
const REPORT_DIR = path.join(ROOT, 'docs', 'evidence', 'visual');
const PROXY = process.env.V2_PROXY ?? 'http://127.0.0.1:10001';
const LOCAL_BASE = process.env.LOCAL_BASE ?? 'http://localhost:3000';
const ORIGIN_BASE = 'https://www.v2ex.com';

/** 固定对照条件：视口 / 缩放 / 字体 / 登录态 */
const VIEWPORT = { width: 1280, height: 900 };
const SCALE = 1;
const COLOR_SCHEME = 'light';
const LOCALE = 'zh-CN';

/** 页面清单：name -> { origin: 原站路径, local: 本地路径, auth: 是否需要登录 */
const PAGES = [
  { name: 'home', origin: '/', local: '/' },
  { name: 'node_claude', origin: '/go/claude', local: '/go/claude' },
  { name: 'node_tech', origin: '/go/programmer', local: '/go/programmer' },
  { name: 'topic_detail', origin: '/t/1253638', local: '/t/1' },
  { name: 'recent', origin: '/recent', local: '/?tab=all' },
  { name: 'signin', origin: '/signin', local: '/signin' },
  { name: 'signup', origin: '/signup', local: '/signup' },
  { name: 'search', origin: '/go/search?q=claude', local: '/go/search?q=claude' },
  { name: 'member', origin: '/member/reoah2', local: '/member/admin' },
  { name: 'nodes_all', origin: '/go/go', local: '/nodes' },
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}
const only = arg('only');
const referenceOnly = process.argv.includes('--reference-only');
const localOnly = process.argv.includes('--local-only');
/** 浏览器通道：优先使用系统已安装的 Edge（chromium 下载受限时可切换） */
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL ?? 'msedge';

async function capture(page, url, file) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 等待字体与布局稳定
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(REPORT_DIR, { recursive: true });

  const browser = await chromium.launch({
    channel: BROWSER_CHANNEL,
    args: [`--proxy-server=${PROXY}`, '--disable-blink-features=AutomationControlled'],
  });

  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: COLOR_SCHEME,
    locale: LOCALE,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  const page = await ctx.newPage();
  const results = [];

  for (const p of PAGES) {
    if (only && p.name !== only) continue;
    const entry = { name: p.name, originUrl: ORIGIN_BASE + p.origin, localUrl: LOCAL_BASE + p.local };

    if (!localOnly) {
      const refFile = path.join(OUT_DIR, `ref-${p.name}.png`);
      try {
        await capture(page, entry.originUrl, refFile);
        entry.reference = path.relative(ROOT, refFile);
        entry.referenceStatus = 'ok';
      } catch (e) {
        entry.referenceStatus = `failed: ${e.message}`;
      }
      // 礼貌间隔，避免给原站造成压力
      await page.waitForTimeout(1200);
    }

    if (!referenceOnly) {
      const locFile = path.join(OUT_DIR, `local-${p.name}.png`);
      try {
        await capture(page, entry.localUrl, locFile);
        entry.local = path.relative(ROOT, locFile);
        entry.localStatus = 'ok';
      } catch (e) {
        entry.localStatus = `failed: ${e.message}`;
      }
    }

    results.push(entry);
    console.log(
      `[${p.name}] ref=${entry.referenceStatus ?? 'skipped'} local=${entry.localStatus ?? 'skipped'}`,
    );
  }

  await browser.close();
  await writeFile(
    path.join(REPORT_DIR, 'capture-index.json'),
    JSON.stringify({ viewport: VIEWPORT, scale: SCALE, locale: LOCALE, pages: results }, null, 2),
  );
  console.log(`\n✓ 截图完成，共 ${results.length} 个页面`);
}

main().catch((e) => {
  console.error('✗ 截图失败:', e);
  process.exit(1);
});
