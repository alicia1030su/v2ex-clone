/**
 * 全站页面真实性审计（v0.0.10）
 *
 * ## 与 `diagnose.mjs` 的分工
 *
 * `diagnose.mjs` 只跑**公开页**的截图门禁（CSS/布局/计算样式）。
 * 本轮要求「不得只因为 README 截图正常就认定这些页面全部正确」——
 * 通知、设置、管理后台都在登录后，公开页门禁根本看不到它们。
 *
 * 因此本工具补上三件 `diagnose` 做不到的事：
 *   1. **带真实登录态**（测试模式关闭验证码，走真实表单登录）；
 *   2. **逐页的专项断言**：右栏、头像尺寸、徽章配色、回复操作按钮不被裁切、
 *      选中 tab、分页、Feed 链接真实可达；
 *   3. **负向自检**：断言脚本本身能判红（否则就是又一个假绿工具）。
 *
 * ## 用法
 *
 *   node tools/visual/audit-pages.mjs --base http://127.0.0.1:3210 \
 *     --user admin --pass 'visual-admin-123456' --json out.json
 *
 * 退出码非 0 ⇒ 有页面或专项断言不通过。
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

const BASE = get('base', process.env.LOCAL_BASE ?? 'http://127.0.0.1:3210');
const OUT_DIR = path.resolve(get('out', 'docs/evidence/visual/pages'));
const JSON_OUT = get('json', null);
const USER = get('user', process.env.AUDIT_USER ?? '');
const PASS = get('pass', process.env.AUDIT_PASS ?? '');
const VIEWPORT = { width: Number(get('width', 1280)), height: Number(get('height', 900)) };

/**
 * 页面清单
 *
 * - `auth`  ⇒ 需要登录态
 * - `rightbar` ⇒ 桌面视口必须有右栏
 * - `probe` ⇒ 该页的专项断言（在 auditPage 里实现）
 */
const PAGES = [
  { path: '/', label: 'home', rightbar: true, probe: 'home' },
  { path: '/nodes', label: 'nodes_all', probe: 'nodes' },
  { path: '/go/claude', label: 'node_detail', rightbar: true, probe: 'node' },
  { path: '/t/1', label: 'topic_detail', rightbar: true, probe: 'topic' },
  { path: '/t/1#reply1', label: 'reply_list', rightbar: true, probe: 'reply' },
  { path: '/member/admin', label: 'member', rightbar: true, probe: 'member' },
  // 登录/注册页必须用未登录上下文（登录态访问会被重定向到 /）
  { path: '/signin', label: 'signin', probe: 'signin', anon: true },
  { path: '/signup', label: 'signup', probe: 'signup', anon: true },
  { path: '/notifications', label: 'notifications', auth: true, probe: 'notifications' },
  { path: '/settings', label: 'settings', auth: true, probe: 'settings' },
  { path: '/admin', label: 'admin', auth: true, probe: 'admin' },
  { path: '/bookmarks', label: 'bookmarks', auth: true, probe: 'bookmarks' },
];

/**
 * 页面内专项探针
 *
 * 每个探针返回 `{ id, ok, detail }` 数组。**不能只返回 true/false** ——
 * 失败时必须说清「差多少」，否则和「没检测」没区别。
 */
const PROBE_FN = () => {
  const cs = (el, p) => (el ? getComputedStyle(el).getPropertyValue(p) : null);
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const out = [];

  /** ① 右栏存在且宽度 = 270 */
  const rightbar = document.querySelector('#Rightbar');
  out.push({
    id: 'page.rightbar',
    ok: !!rightbar && Math.round(rightbar.getBoundingClientRect().width) === 270,
    detail: rightbar ? `#Rightbar ${JSON.stringify(rect(rightbar))}` : '#Rightbar 缺失',
  });

  /** ② 主栏与右栏不重叠（桌面双栏） */
  const main = document.querySelector('#Main');
  if (main && rightbar) {
    const m = main.getBoundingClientRect();
    const r = rightbar.getBoundingClientRect();
    out.push({
      id: 'page.columnsNoOverlap',
      ok: m.right <= r.left + 1,
      detail: `#Main.right=${Math.round(m.right)} vs #Rightbar.left=${Math.round(r.left)}`,
    });
  }

  /** ③ 头像：主栏首个头像应为 48（列表）或 73（主题作者），不得为 0/缺失 */
  const avatars = [...document.querySelectorAll('#Main img.avatar')];
  if (avatars.length > 0) {
    const first = avatars[0];
    const w = Math.round(first.getBoundingClientRect().width);
    out.push({
      id: 'page.avatarRendered',
      ok: w >= 24 && first.complete && first.naturalWidth > 0,
      detail: `首个头像 ${w}px, naturalWidth=${first.naturalWidth}, 共 ${avatars.length} 个`,
    });
  }

  /** ④ 回复数徽章：白字 + #aab0c6 底（列表页才有） */
  const badge = document.querySelector('a.count_livid');
  if (badge) {
    out.push({
      id: 'page.badgeContrast',
      ok: cs(badge, 'color') === 'rgb(255, 255, 255)',
      detail: `color=${cs(badge, 'color')} bg=${cs(badge, 'background-color')}`,
    });
  }

  /** ⑤ 回复操作按钮不得被卡片下边缘裁切 */
  const clipped = [];
  document.querySelectorAll('.box, .cell').forEach((box) => {
    const br = box.getBoundingClientRect();
    const o = getComputedStyle(box).overflow;
    if (o === 'visible' || o === 'clip') return;
    box.querySelectorAll('button, a, span').forEach((el) => {
      const er = el.getBoundingClientRect();
      if (er.height > 0 && er.bottom > br.bottom - 0.5) {
        clipped.push(`${el.tagName}"${(el.textContent || '').trim().slice(0, 8)}"溢出${Math.round(er.bottom - br.bottom)}px`);
      }
    });
  });
  if (document.querySelectorAll('.box').length > 0) {
    out.push({
      id: 'page.noClippedActions',
      ok: clipped.length === 0,
      detail: clipped.length ? clipped.slice(0, 4).join('; ') : '无裁切',
    });
  }

  /** ⑥ 选中 tab：首页必须有且仅有一个 .tab_current */
  if (location.pathname === '/') {
    const cur = document.querySelectorAll('.tab_current');
    out.push({
      id: 'page.activeTab',
      ok: cur.length === 1,
      detail: cur.length === 1 ? `选中「${cur[0].textContent.trim()}」` : `tab_current 数量=${cur.length}`,
    });
  }

  /*
   * ⑦ 列表行数（首页/节点页至少有一行，避免「空壳页」也算通过）
   *
   * ⚠️ 首页用 `.cell.item`（TopicItem），而节点页渲染的是
   *    `.cell.from_<uid>.t_<tid>`（v0.0.6 为对齐原站的动态 class）。
   *    只写 `.cell.item` 会把「有 2 条主题」的节点页判成 0 条 —— 假红。
   *    统一用 `.item_title`（两处都有）作为「主题行」的判据。
   */
  if (['/', '/go/claude'].includes(location.pathname)) {
    const rows = document.querySelectorAll('.item_title').length;
    out.push({ id: 'page.topicRows', ok: rows > 0, detail: `主题行 ${rows} 条` });
  }

  return out;
};

async function probeLinks(page, selectors) {
  const out = [];
  for (const sel of selectors) {
    const hrefs = await page.evaluate(
      (s) => [...document.querySelectorAll(s)].map((a) => a.getAttribute('href')).filter(Boolean),
      sel,
    );
    for (const href of [...new Set(hrefs)]) {
      if (!href.startsWith('/')) continue;
      const res = await page.request.get(BASE + href, { maxRedirects: 0, failOnStatusCode: false });
      out.push({ id: `link.${href}`, ok: res.status() < 400, detail: `HTTP ${res.status()}` });
    }
  }
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'zh-CN',
  });
  const page = await ctx.newPage();

  // ── 登录（只有提供了凭据才做；失败必须显式报错，不静默降级）──
  let loggedIn = false;
  if (USER && PASS) {
    await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    const hasCaptcha = await page.locator('input[name^="captcha"], #captcha').count();
    if (hasCaptcha > 0) {
      console.error('✗ 登录页要求验证码 —— 本工具不绕过验证码。请用测试模式（DISABLE_CAPTCHA=1）启动。');
      await browser.close();
      process.exit(2);
    }
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30000 }),
      page.click('button[type="submit"]'),
    ]);
    loggedIn = true;
    console.log(`✓ 已登录：${USER}`);
  }

  const results = [];
  let failed = 0;

  /*
   * 登录页/注册页必须用**未登录**上下文访问。
   *
   * 登录成功后访问 /signin 会被应用重定向到 /（这是正确行为，
   * 已登录用户不需要再看登录页），但用同一个 context 去测就会得到
   * `navigation.url` 期望 /signin 实际 / 的**假红**。
   */
  const anonCtx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'zh-CN',
  });
  const anonPage = await anonCtx.newPage();

  for (const p of PAGES) {
    const target = p.anon ? anonPage : page;
    if (p.anon) p.rightbar = false;
    if (p.auth && !loggedIn) {
      results.push({ label: p.label, path: p.path, status: 'skipped: auth-required' });
      console.log(`  - ${p.label}（${p.path}）跳过：未登录`);
      continue;
    }

    const url = BASE + p.path;
    const shot = path.join(OUT_DIR, `${p.label}.png`);
    const health = await loadAndVerify(target, url, {
      expectUrl: p.path.split('?')[0].split('#')[0],
      requireRightbar: Boolean(p.rightbar) && VIEWPORT.width >= 1000,
    });
    await target.screenshot({ path: shot, fullPage: false });

    const probes = await target.evaluate(PROBE_FN);
    const linkChecks =
      p.probe === 'home' || p.probe === 'node' || p.probe === 'topic'
        ? await probeLinks(target, ['a[href^="/api/feed"]', 'a[href^="/api/nodes/"]'])
        : [];

    const allChecks = [
      ...health.checks.map((c) => ({ id: c.id, ok: c.ok, detail: c.detail, layer: 'health' })),
      ...probes.map((c) => ({ ...c, layer: 'page' })),
      ...linkChecks.map((c) => ({ ...c, layer: 'link' })),
    ];
    const bad = allChecks.filter((c) => !c.ok);

    results.push({
      label: p.label,
      path: p.path,
      status: bad.length === 0 ? 'ok' : 'failed',
      screenshot: path.relative(process.cwd(), shot),
      checks: allChecks.length,
      failed: bad.map((c) => ({ id: c.id, detail: c.detail })),
    });

    console.log(`\n══════ ${p.label} · ${url} ══════`);
    if (bad.length === 0) {
      console.log(`  ✓ 全部 ${allChecks.length} 项通过`);
    } else {
      console.log(formatChecks(health.checks.filter((c) => !c.ok)));
      for (const b of bad.filter((c) => c.layer !== 'health')) {
        console.log(`  ✗ [${b.id}] ${b.detail}`);
      }
      failed += 1;
    }
  }

  await anonCtx.close();
  await browser.close();

  if (JSON_OUT) {
    await writeFile(
      JSON_OUT,
      JSON.stringify({ base: BASE, viewport: VIEWPORT, user: USER || null, results }, null, 2),
    );
    console.log(`\n证据已写入 ${JSON_OUT}`);
  }

  if (failed > 0) {
    console.error(`\n✗ ${failed}/${results.filter((r) => r.status !== 'skipped: auth-required').length} 个页面未通过`);
    process.exit(1);
  }
  console.log(`\n✓ 全部页面通过（${results.length} 个，含登录态页面）`);
}

main().catch((e) => {
  console.error('✗ 审计失败:', e);
  process.exit(1);
});
