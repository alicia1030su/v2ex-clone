/**
 * 多视口截图工具（带页面健康门禁）
 *
 * 在多个视口下分别抓取原站与本地截图：
 *   - desktop-1280  1280 × 900   （基准桌面）
 *   - desktop-1920  1920 × 1080  （宽屏）
 *   - tablet-768    768 × 1024
 *   - mobile-375    375 × 812    （移动端）
 *
 * ## v0.0.9 后修（2026-11-08）：不再产出「假成功」截图
 *
 * 事故：README 首页截图完全没有 CSS（默认蓝链接、内容堆左上角、双栏消失），
 * 而本工具当时把它记为 `localStatus: "ok"`。
 *
 * 三个缺陷：
 *   1. **代理施加在整只浏览器上**。默认模式（同时采原站与本地）给浏览器加
 *      `--proxy-server`，本地页面同样被代理。代码注释里其实早就写过
 *      「本地站点走代理会不稳定（实测浏览器 Page crashed）」，
 *      但只有 `--local-only` 才跳过 —— 默认模式仍然中招。
 *   2. `capture()` 把 `waitForLoadState` 的失败 `.catch(() => {})` 吞掉，
 *      然后照截图、照打印成功。
 *   3. 从不检查 CSS 是否真的加载、布局是否真的是双栏。
 *
 * 现在：
 *   - 原站与本地**用两个独立 browser context**：原站才带代理（且 bypass 本机），
 *     本地永远直连
 *   - 每次截本地页面前跑 `page-health` 门禁；**门禁不通过就不产出正式截图**，
 *     现场图只写到 `docs/evidence/visual/health/` 作诊断证据
 *   - 任一本地页面门禁不通过 ⇒ 进程退出码非 0
 *
 * 用法:
 *   node tools/visual/capture-multi.mjs                       # 全部视口 + 全部页面
 *   node tools/visual/capture-multi.mjs --viewport desktop-1280 --only home
 *   node tools/visual/capture-multi.mjs --local-only          # 只采本地（不需要代理）
 *   node tools/visual/capture-multi.mjs --reference-only      # 只采原站
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadAndVerify, formatChecks } from './lib/page-health.mjs';

const ROOT = path.resolve(process.cwd());
const OUT_DIR = path.join(ROOT, 'docs', 'evidence', 'screenshots');
const HEALTH_DIR = path.join(ROOT, 'docs', 'evidence', 'visual', 'health');
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

/**
 * 页面清单。`rightbar: true` 表示该页在桌面视口必须有右侧栏。
 *
 * 原站路径经实际探测确认（2026-11-04）：
 *   /hot /notifications /bookmarks /settings /dashboard → 302（需登录）
 *   /my/bookmarks /my/settings /my/panel                → 404（不存在，别再猜）
 * 原站需要登录的页面没有对照图；本项目**无权访问他人账号**，
 * 因此这些页面如实标注，而不是拿游客态冒充。
 *
 * ⚠️ v0.0.9：「原站要登录」与「本地要登录」是**两件事**，必须分开标。
 *   原先只有一个 `requiresAuth`，把它同时用在两侧 ⇒ `/hot`（本地映射到公开的 `/`）
 *   和 `/nodes`（本站公开页）也被当成「需登录」而整页跳过，
 *   于是 `local-nodes_all.png` 永远是上一轮的旧图，README 却在引用它。
 *   `originAuth`  = 原站该路径 302 到 /signin ⇒ 没有对照图，只记 no-auth-reference
 *   `localAuth`   = 本站该路径需要登录态     ⇒ 未登录时才跳过
 */
const PAGES = [
  { name: 'home', origin: '/', local: '/', rightbar: true },
  { name: 'hot', origin: '/hot', local: '/', originAuth: true, rightbar: true },
  { name: 'nodes_all', origin: '/nodes', local: '/nodes', originAuth: true },
  { name: 'node_detail', origin: '/go/programmer', local: '/go/programmer', rightbar: true },
  { name: 'node_claude', origin: '/go/claude', local: '/go/claude', rightbar: true },
  { name: 'topic_detail', origin: '/t/1253638', local: '/t/1', rightbar: true },
  { name: 'reply_list', origin: '/t/1253638#reply1', local: '/t/1#reply1', rightbar: true },
  { name: 'member', origin: '/member/reoah2', local: '/member/admin', rightbar: true },
  { name: 'signin', origin: '/signin', local: '/signin' },
  { name: 'signup', origin: '/signup', local: '/signup' },
  { name: 'search', origin: '/go/search?q=claude', local: '/go/search?q=claude' },
  { name: 'about', origin: '/about', local: '/about' },
  { name: 'faq', origin: '/faq', local: '/faq' },
  { name: 'notifications', origin: '/notifications', local: '/notifications', originAuth: true, localAuth: true },
  { name: 'bookmarks', origin: '/bookmarks', local: '/bookmarks', originAuth: true, localAuth: true },
  { name: 'settings', origin: '/settings', local: '/settings', originAuth: true, localAuth: true },
  { name: 'dashboard', origin: '/dashboard', local: '/notifications', originAuth: true, localAuth: true },
  // 原站管理后台只有管理员可访问，本项目无权访问 —— 独立实现，无原站对照
  { name: 'admin', origin: null, local: '/admin', localAuth: true },
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
 * 本地登录。
 *
 * ⚠️ 生产模式下 /signin **强制验证码**（`isCaptchaDisabled()` 只在
 * `APP_RUNTIME_ENV=test` 且 `TEST_ENV_ISOLATED=1` 时放开）。
 * 本工具**不尝试绕过验证码**：拿不到登录态就如实跳过，
 * 需要登录的页面记 `skipped: auth-required`。
 */
async function loginLocal(page) {
  const user = process.env.VISUAL_LOGIN_USER ?? 'admin';
  const pass = process.env.VISUAL_LOGIN_PASSWORD ?? '';
  if (!pass) {
    console.log('  [info] 未提供 VISUAL_LOGIN_PASSWORD，需登录页面将被跳过');
    return false;
  }
  try {
    await page.goto(`${LOCAL_BASE}/signin`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.fill('#username', user);
    await page.fill('#password', pass);

    if (await page.locator('#captcha, input[name="captcha"]').first().count()) {
      console.log('  [info] 登录页要求验证码 —— 不绕过，跳过登录态采集');
      return false;
    }
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

async function main() {
  await mkdir(HEALTH_DIR, { recursive: true });
  const results = [];
  let invalid = 0;

  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    if (onlyViewport && vpName !== onlyViewport) continue;
    const vpDir = path.join(OUT_DIR, vpName);
    await mkdir(vpDir, { recursive: true });
    const isDesktop = viewport.width >= 1000;

    // ── 原站 context：唯一允许走代理的地方，并显式 bypass 本机地址 ──
    const refBrowser = !localOnly
      ? await chromium.launch({
          channel: CHANNEL,
          args: ['--disable-blink-features=AutomationControlled'],
        })
      : null;
    const refCtx = refBrowser
      ? await refBrowser.newContext({
          viewport,
          deviceScaleFactor: 1,
          colorScheme: 'light',
          locale: 'zh-CN',
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          proxy: { server: PROXY, bypass: 'localhost,127.0.0.1,::1,0.0.0.0' },
        })
      : null;

    // ── 本地 context：**绝不带代理** ──
    const locBrowser = referenceOnly ? null : await chromium.launch({ channel: CHANNEL });
    const locCtx = locBrowser
      ? await locBrowser.newContext({
          viewport,
          deviceScaleFactor: 1,
          colorScheme: 'light',
          locale: 'zh-CN',
        })
      : null;
    const locPage = locCtx ? await locCtx.newPage() : null;

    /*
     * 登录状态要**显式记住**。
     *
     * 原先只判断 `locPage` 是否存在 ⇒ 没登录也照样去抓 /notifications，
     * 被重定向到 /signin 后 URL 断言失败，把「未登录」误报成「页面坏」。
     * 未登录时正确行为是**跳过**并如实标注，而不是让截图任务红掉。
     */
    let loggedIn = false;
    if (locPage && PAGES.some((p) => p.localAuth) && !only) {
      loggedIn = await loginLocal(locPage);
    }

    for (const p of PAGES) {
      if (only && p.name !== only) continue;
      const entry = {
        viewport: vpName,
        name: p.name,
        originUrl: p.origin ? ORIGIN_BASE + p.origin : null,
        localUrl: LOCAL_BASE + p.local,
      };

      // ── 原站对照 ──
      if (!localOnly && p.origin) {
        if (p.originAuth) {
          entry.referenceStatus = 'no-auth-reference';
        } else {
          const refFile = path.join(vpDir, `ref-${p.name}.png`);
          const refPage = await refCtx.newPage();
          try {
            // 原站不受本站设计约束，但仍须确认它自己加载出了样式 ——
            // 否则这张「对照图」本身就是废的。
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
      } else if (!p.origin) {
        entry.referenceStatus = 'no-origin-equivalent';
      }

      // ── 本地 ──
      if (!referenceOnly) {
        if (p.localAuth && !loggedIn) {
          entry.localStatus = 'skipped: auth-required';
        } else {
          const locFile = path.join(vpDir, `local-${p.name}.png`);
          const result = await loadAndVerify(locPage, entry.localUrl, {
            expectUrl: p.local.split('?')[0].split('#')[0],
            requireRightbar: Boolean(p.rightbar) && isDesktop,
          });

          if (result.ok) {
            await locPage.screenshot({ path: locFile, fullPage: false });
            entry.local = path.relative(ROOT, locFile);
            entry.localStatus = 'ok';
            entry.health = { ok: true, checks: result.checks.length };
          } else {
            // 门禁不通过：**不写正式截图**，现场图只留在诊断目录
            const diag = path.join(HEALTH_DIR, `${vpName}-${p.name}-INVALID.png`);
            await locPage.screenshot({ path: diag }).catch(() => {});
            entry.localStatus = 'failed: 页面健康门禁未通过';
            entry.diagnostic = path.relative(ROOT, diag);
            entry.health = {
              ok: false,
              failed: result.checks
                .filter((c) => !c.ok)
                .map((c) => ({ id: c.id, detail: c.detail })),
            };
            invalid += 1;
            console.log(`\n✗ [${vpName}/${p.name}] 门禁未通过，已拒绝出图：`);
            console.log(formatChecks(result.checks.filter((c) => !c.ok)));
          }
        }
      }

      results.push(entry);
      console.log(
        `[${vpName}] ${p.name.padEnd(14)} ref=${(entry.referenceStatus ?? 'skip').padEnd(4)} local=${entry.localStatus ?? 'skip'}`,
      );
    }

    if (refCtx) await refCtx.close().catch(() => {});
    if (refBrowser) await refBrowser.close().catch(() => {});
    if (locCtx) await locCtx.close().catch(() => {});
    if (locBrowser) await locBrowser.close().catch(() => {});
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
        const prevEntry = byKey.get(key(r));
        if (!prevEntry) {
          byKey.set(key(r), r);
          continue;
        }
        // 只覆盖本次**实际采集到**的部分：
        // --reference-only 不该抹掉上次的本地截图，反之亦然。
        byKey.set(key(r), {
          ...prevEntry,
          ...r,
          reference: r.reference ?? prevEntry.reference,
          local: r.local ?? prevEntry.local,
          referenceStatus: r.referenceStatus ?? prevEntry.referenceStatus,
          localStatus: r.localStatus ?? prevEntry.localStatus,
        });
      }
      merged = [...byKey.values()];
    } catch {
      merged = results;
    }
  }

  await writeFile(
    out,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        localBase: LOCAL_BASE,
        viewports: VIEWPORTS,
        // 门禁口径：真实截图必须通过 page-health 的全部 blocker 检查
        gate: 'tools/visual/lib/page-health.mjs',
        invalidLocalCaptures: invalid,
        pages: merged,
      },
      null,
      2,
    ),
  );

  console.log(`\n索引已写入 ${path.relative(ROOT, out)}`);
  if (invalid > 0) {
    console.error(`\n✗ ${invalid} 个本地页面未通过健康门禁 —— 截图任务失败（不得用于展示/基线）`);
    process.exit(1);
  }
  console.log(`✓ 多视口截图完成，共 ${results.length} 张，全部通过健康门禁`);
}

main().catch((e) => {
  console.error('✗ 多视口截图失败:', e);
  process.exit(1);
});
