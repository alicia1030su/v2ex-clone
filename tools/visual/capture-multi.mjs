/**
 * 多视口视觉对比工具
 *
 * 在多个视口下分别抓取原站与本地截图：
 *   - desktop-1280  1280 × 900   （基准桌面）
 *   - desktop-1920  1920 × 1080  （宽屏）
 *   - mobile-375    375 × 812    （移动端）
 *
 * 与 capture.mjs 的区别：
 *   - 支持多视口
 *   - 输出到视口子目录，便于逐视口比对
 *
 * 用法:
 *   node tools/visual/capture-multi.mjs
 *   node tools/visual/capture-multi.mjs --only home --viewport desktop-1280
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const OUT_DIR = path.join(ROOT, 'docs', 'evidence', 'screenshots');
const PROXY = process.env.V2_PROXY ?? 'http://127.0.0.1:10001';
const LOCAL_BASE = process.env.LOCAL_BASE ?? 'http://localhost:3000';
const ORIGIN_BASE = 'https://www.v2ex.com';
const CHANNEL = process.env.BROWSER_CHANNEL ?? 'msedge';

export const VIEWPORTS = {
  'desktop-1280': { width: 1280, height: 900 },
  'desktop-1920': { width: 1920, height: 1080 },
  'mobile-375': { width: 375, height: 812 },
};

const PAGES = [
  { name: 'home', origin: '/', local: '/' },
  { name: 'node_claude', origin: '/go/claude', local: '/go/claude' },
  { name: 'topic_detail', origin: '/t/1253638', local: '/t/1' },
  { name: 'signin', origin: '/signin', local: '/signin' },
  { name: 'signup', origin: '/signup', local: '/signup' },
  { name: 'search', origin: '/go/search?q=claude', local: '/go/search?q=claude' },
  { name: 'member', origin: '/member/reoah2', local: '/member/admin' },
  { name: 'nodes_all', origin: '/go/go', local: '/nodes' },
  { name: 'about', origin: '/about', local: '/about' },
  { name: 'faq', origin: '/faq', local: '/faq' },
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}
const only = arg('only');
const onlyViewport = arg('viewport');
const referenceOnly = process.argv.includes('--reference-only');
const localOnly = process.argv.includes('--local-only');

async function capture(page, url, file) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: file, fullPage: false });
}

async function main() {
  const results = [];

  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    if (onlyViewport && vpName !== onlyViewport) continue;
    const vpDir = path.join(OUT_DIR, vpName);
    await mkdir(vpDir, { recursive: true });

    const browser = await chromium.launch({
      channel: CHANNEL,
      args: [`--proxy-server=${PROXY}`, '--disable-blink-features=AutomationControlled'],
    });
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      colorScheme: 'light',
      locale: 'zh-CN',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();

    for (const p of PAGES) {
      if (only && p.name !== only) continue;
      const entry = {
        viewport: vpName,
        name: p.name,
        originUrl: ORIGIN_BASE + p.origin,
        localUrl: LOCAL_BASE + p.local,
      };

      if (!localOnly) {
        const refFile = path.join(vpDir, `ref-${p.name}.png`);
        try {
          await capture(page, entry.originUrl, refFile);
          entry.reference = path.relative(ROOT, refFile);
          entry.referenceStatus = 'ok';
        } catch (e) {
          entry.referenceStatus = `failed: ${e.message}`;
        }
        await page.waitForTimeout(1200);
      }

      if (!referenceOnly) {
        const locFile = path.join(vpDir, `local-${p.name}.png`);
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
        `[${vpName}] ${p.name.padEnd(14)} ref=${(entry.referenceStatus ?? 'skip').padEnd(4)} local=${entry.localStatus ?? 'skip'}`,
      );
    }

    await browser.close();
  }

  // 合并索引：分视口运行时不能覆盖其他视口的结果
  const out = path.join(OUT_DIR, 'capture-multi-index.json');
  let merged = results;
  if (existsSync(out)) {
    try {
      const prev = JSON.parse(await readFile(out, 'utf8'));
      const prevPages = prev.pages ?? [];
      const key = (p) => `${p.viewport}|${p.name}`;
      const byKey = new Map(prevPages.map((p) => [key(p), p]));
      for (const r of results) byKey.set(key(r), r);
      merged = [...byKey.values()];
    } catch {
      merged = results;
    }
  }
  await writeFile(out, JSON.stringify({ viewports: VIEWPORTS, pages: merged }, null, 2));
  console.log(`\n✓ 多视口截图完成，共 ${results.length} 张，索引: ${path.relative(ROOT, out)}`);
}

main().catch((e) => {
  console.error('✗ 多视口截图失败:', e);
  process.exit(1);
});
