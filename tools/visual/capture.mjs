/**
 * 视觉对比截图工具（单视口，带页面健康门禁）
 *
 * 用同一浏览器、同一视口、同一缩放、同一字体环境，分别截取原站与本地页面，
 * 供逐像素比对使用。
 *
 * ## v0.0.9 后修（2026-11-08）：这曾是「无 CSS 截图」的主要来源
 *
 * 旧实现：
 * ```js
 * const browser = await chromium.launch({ args: [`--proxy-server=${PROXY}`] });
 * ...
 * await page.goto(url, { waitUntil: 'domcontentloaded' });
 * // 等待 networkidle，失败一律 .catch(() => {}) 吞掉（具体写法见 git 历史）
 * await page.screenshot({ path: file });                        // 照截
 * entry.localStatus = 'ok';                                     // 照报成功
 * ```
 * `--proxy-server` 作用在**整只浏览器**上，本地 `localhost:3000` 的
 * `/_next/static/*` 请求也被送进代理；CSS/JS 取不到时页面就是「无样式 HTML」，
 * 而工具不做任何检查，于是把一张废图记为成功。
 *
 * 现在：
 *   - 原站与本地**分开两个 context**：原站才带代理（且 bypass 本机），本地直连
 *   - 本地页面走 `page-health` 门禁；不通过就**不产出正式截图**（现场图进诊断目录）
 *   - 任一本地页面门禁不通过 ⇒ 退出码非 0
 *
 * 用法:
 *   node tools/visual/capture.mjs                      # 截取全部页面（对比模式）
 *   node tools/visual/capture.mjs --only home          # 只处理 home
 *   node tools/visual/capture.mjs --reference-only     # 只截原站
 *   node tools/visual/capture.mjs --local-only         # 只截本地
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAndVerify, formatChecks } from './lib/page-health.mjs';

const ROOT = path.resolve(process.cwd());
const OUT_DIR = path.join(ROOT, 'docs', 'evidence', 'screenshots');
const REPORT_DIR = path.join(ROOT, 'docs', 'evidence', 'visual');
const HEALTH_DIR = path.join(REPORT_DIR, 'health');
const PROXY = process.env.V2_PROXY ?? 'http://127.0.0.1:10001';
const LOCAL_BASE = process.env.LOCAL_BASE ?? 'http://localhost:3000';
const ORIGIN_BASE = 'https://www.v2ex.com';

/** 固定对照条件：视口 / 缩放 / 字体 / 登录态 */
const VIEWPORT = { width: 1280, height: 900 };
const SCALE = 1;
const COLOR_SCHEME = 'light';
const LOCALE = 'zh-CN';

/** 页面清单：name -> { origin: 原站路径, local: 本地路径, rightbar: 桌面是否必须有右栏 } */
const PAGES = [
  { name: 'home', origin: '/', local: '/', rightbar: true },
  { name: 'node_claude', origin: '/go/claude', local: '/go/claude', rightbar: true },
  { name: 'topic_detail', origin: '/t/1253638', local: '/t/1', rightbar: true },
  { name: 'recent', origin: '/recent', local: '/?tab=all', rightbar: true },
  { name: 'signin', origin: '/signin', local: '/signin' },
  { name: 'signup', origin: '/signup', local: '/signup' },
  { name: 'search', origin: '/go/search?q=claude', local: '/go/search?q=claude' },
  { name: 'member', origin: '/member/reoah2', local: '/member/admin', rightbar: true },
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(HEALTH_DIR, { recursive: true });

  // 原站 context：唯一允许走代理的地方，且必须 bypass 本机地址
  const refBrowser = !localOnly
    ? await chromium.launch({
        channel: BROWSER_CHANNEL,
        args: ['--disable-blink-features=AutomationControlled'],
      })
    : null;
  const refCtx = refBrowser
    ? await refBrowser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: SCALE,
        colorScheme: COLOR_SCHEME,
        locale: LOCALE,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        proxy: { server: PROXY, bypass: 'localhost,127.0.0.1,::1,0.0.0.0' },
      })
    : null;

  // 本地 context：绝不带代理
  const locBrowser = referenceOnly ? null : await chromium.launch({ channel: BROWSER_CHANNEL });
  const locCtx = locBrowser
    ? await locBrowser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: SCALE,
        colorScheme: COLOR_SCHEME,
        locale: LOCALE,
      })
    : null;
  const locPage = locCtx ? await locCtx.newPage() : null;

  const results = [];
  let invalid = 0;

  for (const p of PAGES) {
    if (only && p.name !== only) continue;
    const entry = { name: p.name, originUrl: ORIGIN_BASE + p.origin, localUrl: LOCAL_BASE + p.local };

    if (!localOnly) {
      const refFile = path.join(OUT_DIR, `ref-${p.name}.png`);
      const refPage = await refCtx.newPage();
      try {
        const r = await loadAndVerify(refPage, entry.originUrl, { expectUrl: null });
        const cssOk = r.checks.find((c) => c.id === 'css.parsed')?.ok;
        if (!r.ok || !cssOk) {
          entry.referenceStatus = `failed: 门禁未通过（${r.checks
            .filter((c) => !c.ok)
            .map((c) => c.id)
            .join(',')}）`;
        } else {
          await refPage.screenshot({ path: refFile, fullPage: false });
          entry.reference = path.relative(ROOT, refFile);
          entry.referenceStatus = 'ok';
        }
      } catch (e) {
        entry.referenceStatus = `failed: ${e.message}`;
      } finally {
        await refPage.close().catch(() => {});
      }
      // 礼貌间隔，避免给原站造成压力
      await new Promise((r) => setTimeout(r, 1200));
    }

    if (!referenceOnly) {
      const locFile = path.join(OUT_DIR, `local-${p.name}.png`);
      const result = await loadAndVerify(locPage, entry.localUrl, {
        expectUrl: p.local.split('?')[0],
        requireRightbar: Boolean(p.rightbar),
      });

      if (result.ok) {
        await locPage.screenshot({ path: locFile, fullPage: false });
        entry.local = path.relative(ROOT, locFile);
        entry.localStatus = 'ok';
      } else {
        const diag = path.join(HEALTH_DIR, `capture-${p.name}-INVALID.png`);
        await locPage.screenshot({ path: diag }).catch(() => {});
        entry.localStatus = 'failed: 页面健康门禁未通过';
        entry.diagnostic = path.relative(ROOT, diag);
        entry.health = {
          ok: false,
          failed: result.checks.filter((c) => !c.ok).map((c) => ({ id: c.id, detail: c.detail })),
        };
        invalid += 1;
        console.log(`\n✗ [${p.name}] 门禁未通过，已拒绝出图：`);
        console.log(formatChecks(result.checks.filter((c) => !c.ok)));
      }
    }

    results.push(entry);
    console.log(`[${p.name}] ref=${entry.referenceStatus ?? 'skipped'} local=${entry.localStatus ?? 'skipped'}`);
  }

  if (refCtx) await refCtx.close().catch(() => {});
  if (refBrowser) await refBrowser.close().catch(() => {});
  if (locCtx) await locCtx.close().catch(() => {});
  if (locBrowser) await locBrowser.close().catch(() => {});

  await writeFile(
    path.join(REPORT_DIR, 'capture-index.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        viewport: VIEWPORT,
        scale: SCALE,
        locale: LOCALE,
        localBase: LOCAL_BASE,
        gate: 'tools/visual/lib/page-health.mjs',
        invalidLocalCaptures: invalid,
        pages: results,
      },
      null,
      2,
    ),
  );

  if (invalid > 0) {
    console.error(`\n✗ ${invalid} 个本地页面未通过健康门禁 —— 截图任务失败（不得用于展示/基线）`);
    process.exit(1);
  }
  console.log(`\n✓ 截图完成，共 ${results.length} 个页面，全部通过健康门禁`);
}

main().catch((e) => {
  console.error('✗ 截图失败:', e);
  process.exit(1);
});
