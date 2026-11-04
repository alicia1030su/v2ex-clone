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
  'tablet-768': { width: 768, height: 1024 },
  'mobile-375': { width: 375, height: 812 },
};

// v0.0.4：覆盖任务要求的 13 类页面。
// origin = 原站路径；local = 本地对应路径。
// 需要登录的页面（通知/收藏/账户设置/后台）用 requiresAuth 标记，
// 由 main() 注入会话 cookie 后再采集 —— 游客态与登录态是两套布局，
// 不做区分的对比没有意义。
const PAGES = [
  { name: 'home', origin: '/', local: '/' },
  // ⚠️ 原站的 /hot 与 /nodes 都**需要登录**（实测 302 → /signin），
  //    我们无权访问他人账号 —— 因此这两页**没有原站对照**，
  //    本地映射到首页/节点列表页并如实标注。
  //    （原站的 /go/go 是「Go 编程语言」节点页，不是节点列表页；
  //      之前误用作对照对象，已更正。）
  { name: 'hot', origin: '/hot', local: '/', requiresAuth: true },
  { name: 'nodes_all', origin: '/nodes', local: '/nodes', requiresAuth: true },
  { name: 'node_detail', origin: '/go/claude', local: '/go/claude' },
  { name: 'topic_detail', origin: '/t/1253638', local: '/t/1' },
  { name: 'reply_list', origin: '/t/1253638#reply1', local: '/t/1#reply1' },
  { name: 'member', origin: '/member/reoah2', local: '/member/admin' },
  { name: 'signin', origin: '/signin', local: '/signin' },
  { name: 'signup', origin: '/signup', local: '/signup' },
  { name: 'search', origin: '/go/search?q=claude', local: '/go/search?q=claude' },
  { name: 'about', origin: '/about', local: '/about' },
  { name: 'faq', origin: '/faq', local: '/faq' },
  // 以下需要登录态
  // 原站路径经实际探测确认（2026-11-04）：
  //   /hot /notifications /bookmarks /settings /dashboard → 302（需登录）
  //   /my/bookmarks /my/settings /my/panel                → 404（不存在，别再猜）
  { name: 'notifications', origin: '/notifications', local: '/notifications', requiresAuth: true },
  { name: 'bookmarks', origin: '/bookmarks', local: '/bookmarks', requiresAuth: true },
  { name: 'settings', origin: '/settings', local: '/settings', requiresAuth: true },
  { name: 'dashboard', origin: '/dashboard', local: '/notifications', requiresAuth: true },
  // ⚠️ 原站的管理后台只有管理员可访问，本项目**无权访问**（也不应尝试绕过）。
  //    /admin 是本项目的独立实现，因此没有原站对照 —— 这一点会在
  //    VISUAL_DIFF_REPORT 里明确标注为「独立实现，无原站对照」。
  { name: 'admin', origin: null, local: '/admin', requiresAuth: true },
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}
const only = arg('only');
const onlyViewport = arg('viewport');
const referenceOnly = process.argv.includes('--reference-only');
const localOnly = process.argv.includes('--local-only');

/**
 * 在本地站点真实登录，取得会话 cookie。
 *
 * 只对**本地**站点做（APP_RUNTIME_ENV=test + TEST_ENV_ISOLATED=1 时
 * 登录不校验验证码，因此可自动化）。
 * 原站侧不做任何登录 —— 我们无权访问他人账号，也不应尝试绕过。
 */
async function loginLocal(page) {
  const user = process.env.VISUAL_LOGIN_USER ?? 'admin';
  const pass = process.env.VISUAL_LOGIN_PASSWORD ?? '';
  if (!pass) {
    console.log('  [warn] 未提供 VISUAL_LOGIN_PASSWORD，跳过登录（需要登录的页面会采到游客态）');
    return false;
  }
  try {
    await page.goto(LOCAL_BASE + '/signin', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.fill('#username', user);
    await page.fill('#password', pass);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30000 }),
      page.click('button[type="submit"]'),
    ]);
    return true;
  } catch (e) {
    console.log(`  [warn] 本地登录失败：${e.message}`);
    return false;
  }
}

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
      args: [
        // ⚠️ 只有采集**原站**时才需要代理；
        //    本地站点走代理会不稳定（实测浏览器 Page crashed）。
        ...(localOnly ? [] : [`--proxy-server=${PROXY}`]),
        '--disable-blink-features=AutomationControlled',
      ],
    });
    // 需要登录的页面（通知/收藏/设置/后台）在游客态会被重定向到首页，
    // 采到的就不是目标页面了 —— 用真实登录拿会话 cookie。
    const needAuth = PAGES.some((p) => p.requiresAuth) && !only;

    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      colorScheme: 'light',
      locale: 'zh-CN',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();

    // 登录态：需要登录的页面（通知/收藏/设置/后台）在游客态会被重定向到首页，
    // 采到的就不是目标页面了。这里用**真实登录**拿会话 cookie 注入。
    // 注意：原站不登录（我们无权访问他人账号），故原站侧这些页面标为
    // 'no-auth-reference' —— 只采本地登录态，并如实标注没有原站对照。
    if (needAuth) {
      await loginLocal(page);
    }

    for (const p of PAGES) {
      if (only && p.name !== only) continue;
      const entry = {
        viewport: vpName,
        name: p.name,
        originUrl: p.origin ? ORIGIN_BASE + p.origin : null,
        localUrl: LOCAL_BASE + p.local,
      };

      if (!localOnly && p.origin) {
        if (p.requiresAuth) {
          // 原站的需登录页面：需要他人账号，本项目**无权访问**，
          // 因此不采集原站对照 —— 如实标注，而不是拿游客态冒充。
          entry.referenceStatus = 'no-auth-reference';
        } else {
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
      } else if (!p.origin) {
        // 本项目独立实现，原站无对应页面
        entry.referenceStatus = 'no-origin-equivalent';
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
      for (const r of results) {
        const prev = byKey.get(key(r));
        if (!prev) {
          byKey.set(key(r), r);
          continue;
        }
        // 只覆盖本次**实际采集到**的部分：
        // --reference-only 不该抹掉上次的本地截图，反之亦然。
        byKey.set(key(r), {
          ...prev,
          ...r,
          reference: r.reference ?? prev.reference,
          local: r.local ?? prev.local,
          referenceStatus: r.referenceStatus ?? prev.referenceStatus,
          localStatus: r.localStatus ?? prev.localStatus,
        });
      }
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
