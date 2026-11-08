/**
 * 截图门禁的负向测试（Negative Tests）
 *
 * ## 为什么必须有这个文件
 *
 * 「门禁能通过」不等于「门禁能拦住坏页面」。
 * 2026-11-08 的 README 无样式事故里，截图工具对**无 CSS 的页面照样打印成功**，
 * 于是坏图进了 README，而回归测试 63/63 全绿 —— 一套永远说 OK 的门禁，
 * 与没有门禁等价。
 *
 * 本脚本刻意把页面**弄坏**，然后断言门禁必须判红：
 *
 *   A. 拦截全部 CSS        → 必须失败（css.requests=css.parsed=0，且出现默认蓝链接）
 *   B. 拦截 /_next/static  → 必须失败（静态资源失败 + 无样式）
 *   C. 导航到错误路由      → 必须失败（最终 URL 与预期不符）
 *   D. 站点整体 404        → 必须失败（导航错误）
 *
 * 每个场景都断言「整体判红」**且**「对应的具体检查项判红」——
 * 只断言整体失败会被无关的失败掩盖（假阳性通过），必须精确到 check id。
 *
 * 用法:
 *   node tools/visual/negative-tests.mjs --base http://127.0.0.1:3210
 *
 * 退出码 0 = 门禁确实能拦住全部四类坏页面。
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAndVerify } from './lib/page-health.mjs';

const argv = process.argv.slice(2);
const get = (name, fallback = null) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const BASE = get('base', process.env.LOCAL_BASE ?? 'http://localhost:3210');
const OUT_DIR = path.resolve(get('out', 'docs/evidence/visual/negative'));
const VIEWPORT = { width: 1280, height: 900 };

/** 场景定义：setup 返回是否安装成功，forbidden 是「必须判红的 check id」 */
const SCENARIOS = [
  {
    id: 'no-css',
    title: '拦截全部 CSS（模拟样式表 404 / 取不到）',
    forbidden: ['css.requests', 'css.parsed', 'design.wrapperBg', 'design.noUaLinks'],
    async setup(page) {
      await page.route('**/*.css', (route) => route.abort('failed'));
    },
  },
  {
    id: 'no-static',
    title: '拦截 /_next/static/**（模拟静态资源整体不可用）',
    forbidden: ['static.noFailures', 'design.wrapperBg', 'design.noUaLinks'],
    async setup(page) {
      await page.route('**/_next/static/**', (route) => route.abort('failed'));
    },
  },
  {
    id: 'wrong-route',
    title: '导航到错误路由（模拟登录墙/重定向/白屏重定向）',
    forbidden: ['navigation.url'],
    expectUrl: '/',
    async setup(page) {
      // 访问 / 却被服务端重定向到 /signin
      await page.route(`${BASE}/`, (route) =>
        route.fulfill({ status: 302, headers: { location: `${BASE}/signin` } }),
      );
    },
  },
  {
    id: 'site-404',
    title: '站点整体不可用（模拟 502/404 错误页）',
    forbidden: ['navigation.load'],
    async setup(page) {
      await page.route(`${BASE}/`, (route) =>
        route.fulfill({
          status: 502,
          contentType: 'text/html',
          body: '<html><body><h1>502 Bad Gateway</h1></body></html>',
        }),
      );
    },
  },
  {
    id: 'not-two-column',
    title: '桌面双栏被压成单栏（模拟 CSS 只加载了一半 / 布局塌陷）',
    forbidden: ['design.twoColumn'],
    async setup(page) {
      // 只破坏右栏定位，其余样式保持 —— 这正是「部分 CSS 失效」的真实形态
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
          const bar = document.querySelector('#Rightbar');
          if (!bar) return;
          const s = document.createElement('style');
          s.textContent = '#Rightbar{float:none!important;width:auto!important;margin:0!important}';
          document.head.appendChild(s);
        });
      });
    },
  },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const results = [];
  let broken = 0;

  for (const sc of SCENARIOS) {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: 'light',
      locale: 'zh-CN',
    });
    const page = await ctx.newPage();
    await sc.setup(page);

    const result = await loadAndVerify(page, `${BASE}/`, {
      expectUrl: sc.expectUrl ?? '/',
      requireRightbar: true,
    });

    const shot = path.join(OUT_DIR, `${sc.id}.png`);
    await page.screenshot({ path: shot }).catch(() => {});

    const failedIds = result.checks.filter((c) => !c.ok).map((c) => c.id);
    const missing = sc.forbidden.filter((id) => !failedIds.includes(id));
    const caught = !result.ok;
    const ok = caught && missing.length === 0;
    if (!ok) broken += 1;

    results.push({
      id: sc.id,
      title: sc.title,
      gateRejected: caught,
      requiredFailedChecks: sc.forbidden,
      failedChecks: failedIds,
      missing,
      ok,
    });

    console.log(`\n──────── ${sc.id} · ${sc.title} ────────`);
    console.log(`  门禁整体判定：${caught ? '✗ 已拒绝（预期）' : '✓ 通过（**预期应拒绝**）'}`);
    console.log(`  失败项：${failedIds.length ? failedIds.join(', ') : '（无）'}`);
    if (missing.length) console.log(`  ✗ 未按预期判红的检查项：${missing.join(', ')}`);
    console.log(`  → ${ok ? '✓ 负向测试通过' : '✗ 负向测试失败（门禁存在漏洞）'}`);

    await ctx.close();
  }

  await browser.close();
  await writeFile(
    path.join(OUT_DIR, 'negative-tests.json'),
    JSON.stringify({ base: BASE, viewport: VIEWPORT, results }, null, 2),
  );

  console.log(`\n════ 汇总：${results.length} 个坏页面场景，${results.length - broken} 个被正确拒绝 ════`);
  if (broken > 0) {
    console.error(`✗ ${broken} 个场景门禁未能按预期判红`);
    process.exit(1);
  }
  console.log('✓ 全部门禁负向测试通过');
}

main().catch((e) => {
  console.error('✗ 负向测试执行失败:', e);
  process.exit(1);
});
