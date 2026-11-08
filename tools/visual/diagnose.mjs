/**
 * 页面健康诊断（CLI）
 *
 * 用途：在指定 URL 上跑一遍 `page-health` 门禁，输出结构化证据 + 真实截图。
 * 这是「截图是否有效」的**取证工具**，不是装饰品：
 * 退出码非 0 表示该页面**不能**被用作展示截图或视觉基线。
 *
 * 用法:
 *   node tools/visual/diagnose.mjs --base http://localhost:3210 --page /
 *   node tools/visual/diagnose.mjs --base http://localhost:3210 --page / --proxy http://127.0.0.1:10001
 *   node tools/visual/diagnose.mjs --base http://localhost:3210 --all --json out.json
 *
 * 关键设计：**代理必须显式 bypass localhost**
 * 2026-11-08 的 README 无样式事故就是 `--proxy-server` 未 bypass localhost 造成的。
 * 本工具保留 `--proxy` 参数是为了**复现**该故障，而不是为了正常截图。
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAndVerify, formatChecks } from './lib/page-health.mjs';

const argv = process.argv.slice(2);
const get = (name, fallback = null) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`) || argv.some((a) => a.startsWith(`--${name}=`));

const BASE = get('base', process.env.LOCAL_BASE ?? 'http://localhost:3210');
const OUT_DIR = path.resolve(get('out', 'docs/evidence/visual/health'));
const PROXY = get('proxy', null);
const JSON_OUT = get('json', null);
const VIEWPORT = {
  width: Number(get('width', 1280)),
  height: Number(get('height', 900)),
};

/** 诊断页面的默认清单（与 README 展示页一致） */
const DEFAULT_PAGES = [
  { path: '/', label: 'home', requireRightbar: true },
  { path: '/nodes', label: 'nodes_all', requireRightbar: false },
  { path: '/go/claude', label: 'node_detail', requireRightbar: true },
  { path: '/t/1', label: 'topic_detail', requireRightbar: true },
  { path: '/member/admin', label: 'member', requireRightbar: true },
  { path: '/signin', label: 'signin', requireRightbar: false },
];

const pages = has('all')
  ? DEFAULT_PAGES
  : (() => {
      const p = get('page', '/');
      // 默认标签要可读：'/' → home，'/t/1' → t_1（而不是把路径清洗成下划线）
      const fallback = p === '/' ? 'home' : p.replace(/^\//, '').replace(/\W+/g, '_');
      return [{ path: p, label: get('label', fallback), requireRightbar: has('require-rightbar') }];
    })();

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const launchArgs = ['--disable-blink-features=AutomationControlled'];
  /**
   * 只有显式传 --proxy 才启用代理；默认**必须** bypass 本地地址。
   *
   * `--proxy-strict` 是**故障复现开关**：完全照搬旧工具的做法
   * （裸 `--proxy-server`，不设 bypass、不走 Playwright proxy 选项），
   * 用来证明「强制代理会让 localhost 的 CSS/JS 取不到」。
   * 正常截图**不得**使用它。
   */
  const STRICT = has('proxy-strict');
  const proxyOpt = PROXY && !STRICT
    ? { server: PROXY, bypass: 'localhost,127.0.0.1,::1,0.0.0.0' }
    : undefined;
  if (PROXY) launchArgs.push(`--proxy-server=${PROXY}`);

  const browser = await chromium.launch({ args: launchArgs });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'zh-CN',
    proxy: proxyOpt,
  });
  const page = await ctx.newPage();

  const results = [];
  let failed = 0;

  for (const p of pages) {
    const url = BASE + p.path;
    const shot = path.join(OUT_DIR, `${p.label}.png`);
    const result = await loadAndVerify(page, url, {
      expectUrl: p.path.split('?')[0],
      requireRightbar: p.requireRightbar && VIEWPORT.width >= 1000,
    });

    // 无论通过与否都留一张现场图 —— 失败时这就是诊断证据
    await page.screenshot({ path: shot, fullPage: false });

    const entry = {
      label: p.label,
      path: p.path,
      url,
      ok: result.ok,
      screenshot: path.relative(process.cwd(), shot),
      navigationError: result.navigationError,
      checks: result.checks,
      evidence: result.evidence
        ? {
            url: result.evidence.url,
            title: result.evidence.title,
            counts: result.evidence.counts,
            bodyFont: result.evidence.bodyFont,
            wrappers: result.evidence.wrappers,
            styles: result.evidence.styles,
            firstTopic: result.evidence.firstTopic,
            horizontalOverflow: result.evidence.horizontalOverflow,
            styleSheets: result.evidence.styleSheets,
            brokenImages: result.evidence.brokenImages,
          }
        : null,
      network: {
        responses: result.state.responses.length,
        failures: result.state.requestFailures,
        css: result.state.responses
          .filter((r) => r.resourceType === 'stylesheet')
          .map((r) => ({ status: r.status, url: r.url })),
        jsCount: result.state.responses.filter((r) => r.resourceType === 'script').length,
        jsFailed: result.state.responses.filter((r) => r.resourceType === 'script' && r.status >= 400)
          .length,
        staticFailed: result.state.responses.filter(
          (r) => r.url.includes('/_next/static/') && r.status >= 400,
        ).length,
        consoleErrors: result.state.consoleErrors,
        pageErrors: result.state.pageErrors,
      },
      stability: result.stability,
    };
    results.push(entry);

    console.log(`\n══════ ${p.label} · ${url} ══════`);
    if (entry.navigationError) console.log(`✗ 导航失败：${entry.navigationError}`);
    console.log(formatChecks(result.checks));
    console.log(`→ 结论：${result.ok ? '✓ 截图有效' : '✗ 截图无效（禁止用于展示/基线）'}`);

    if (!result.ok) failed += 1;
  }

  await browser.close();

  if (JSON_OUT) {
    await writeFile(JSON_OUT, JSON.stringify({ base: BASE, viewport: VIEWPORT, proxy: PROXY, results }, null, 2));
    console.log(`\n证据已写入 ${JSON_OUT}`);
  }

  if (failed > 0) {
    console.error(`\n✗ ${failed}/${results.length} 个页面未通过健康门禁`);
    process.exit(1);
  }
  console.log(`\n✓ ${results.length} 个页面全部通过健康门禁`);
}

main().catch((e) => {
  console.error('✗ 诊断失败:', e);
  process.exit(1);
});
