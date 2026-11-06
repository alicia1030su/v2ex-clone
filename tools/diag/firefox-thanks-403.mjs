/**
 * v0.0.7 诊断：Firefox 下 /api/thanks 返回 403（而非 400）的现场取证
 *
 * 背景：Linux 矩阵 firefox-375x812 分片 199 passed / 1 failed，
 * 唯一失败是「感谢：不能感谢自己的回复」期望 400 实得 403。
 * 403 只可能来自 guardCsrf（业务校验在此之前）。
 *
 * 本脚本在**同一环境**复现该流程，并打印：
 *   1. page.context().cookies()      —— apiPost 看到的 token 来源
 *   2. document.cookie               —— 浏览器实际持有的 token
 *   3. thanks POST 的 status + body  —— 服务端判决
 *   4. 对照组：带/不带 x-csrf-token 的请求分别是什么状态
 */
import { chromium, firefox, webkit } from 'playwright';

const BASE = process.env.LOCAL_BASE ?? 'http://127.0.0.1:3010';
const BROWSER = process.env.DIAG_BROWSER ?? 'firefox';
const VIEWPORT = { width: 375, height: 812 };

const launchers = { chromium, firefox, webkit };

async function main() {
  const browser = await launchers[BROWSER].launch();
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  const log = (...a) => console.log('[diag]', ...a);

  // ---- 1. 注册（与用例同流程：字段名以 SignUpForm 为准）----
  const user = 'diag' + Math.random().toString(36).slice(2, 8);
  log('注册用户', user);
  await page.goto(BASE + '/signup', { waitUntil: 'domcontentloaded' });
  // 等 React hydration 完成（不等会 fill 超时）
  await page.waitForSelector('#username', { state: 'visible', timeout: 20_000 });
  await page.fill('#username', user);
  await page.fill('#email', `${user}@diag.local`);
  await page.fill('#password', 'DiagTest-2026!');
  await page.fill('#confirm', 'DiagTest-2026!');
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/signup'), { timeout: 20_000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1500);
  log('注册后 URL:', page.url());

  // ---- 2. 清理限流（与用例同流程）----
  const token = process.env.DEBUG_ENDPOINT_TOKEN ?? '';
  const clr = await page.request.post(BASE + '/api/debug/reset-rate-limits', {
    headers: { 'x-debug-token': token },
  });
  log('clearRateLimits:', clr.status());

  // ---- 3. 建主题 + 回复（API 路径，确定性最高）----
  const nodesRes = await page.request.get(BASE + '/api/nodes');
  const nodes = await nodesRes.json();
  const nodeId = nodes?.nodes?.[0]?.id ?? nodes?.[0]?.id;
  log('选用节点:', nodeId);

  async function csrfToken() {
    const cs = await ctx.cookies();
    return cs.find((c) => c.name === 'v2_csrf')?.value ?? '';
  }

  const topicRes = await page.request.post(BASE + '/api/topics', {
    data: { nodeId, title: `诊断主题 ${user}`, content: '诊断用正文。' },
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': await csrfToken() },
  });
  const topicJson = await topicRes.json().catch(() => ({}));
  const topicId = topicJson.topicId ?? topicJson.topic?.id ?? null;
  log('建主题:', topicRes.status(), 'topicId=', topicId);

  const replyRes = await page.request.post(BASE + '/api/replies', {
    data: { topicId, content: '诊断用回复。' },
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': await csrfToken() },
  });
  log('建回复:', replyRes.status(), (await replyRes.text()).slice(0, 100));

  // ---- 4. 取证：两处 token 来源 ----
  const ctxCookies = await ctx.cookies();
  const csrfCookies = ctxCookies.filter((c) => c.name === 'v2_csrf');
  const docCookie = await page.evaluate(() => document.cookie);

  log('=== 取证开始 ===');
  log('context cookies 中 v2_csrf 数量:', csrfCookies.length);
  for (const c of csrfCookies) {
    log('  cookie:', JSON.stringify({ name: c.name, value: c.value.slice(0, 12) + '…', domain: c.domain, path: c.path, secure: c.secure, sameSite: c.sameSite }));
  }
  log('document.cookie 含 v2_csrf:', /(^|; )v2_csrf=/.test(docCookie));
  const docMatch = docCookie.match(/(?:^|; )v2_csrf=([^;]*)/);
  log('document.cookie 的 token 前12:', docMatch ? docMatch[1].slice(0, 12) + '…' : '（无）');

  const headerToken = csrfCookies[0]?.value ?? '';
  const docToken = docMatch ? decodeURIComponent(docMatch[1]) : '';
  log('header token === document token ?', headerToken === docToken);

  // ---- 5. 取 replyId 并发起 thanks（对照组）----
  const topicGetRes = await page.request.get(BASE + `/api/topics/${topicId}`);
  const topicData = await topicGetRes.json();
  const replies = topicData?.replies ?? [];
  const replyId = Number(replies[replies.length - 1]?.id ?? 0);
  log('replyId:', replyId, '（回复数', replies.length + '）');

  // 对照组 A：带 context token（与 apiPost 相同行为）
  const a = await page.request.post(BASE + '/api/thanks', {
    data: { replyId },
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': headerToken },
  });
  log('A 带 context token:', a.status(), (await a.text()).slice(0, 120));

  // 对照组 B：带 document token
  if (docToken && docToken !== headerToken) {
    const b = await page.request.post(BASE + '/api/thanks', {
      data: { replyId },
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': docToken },
    });
    log('B 带 document token:', b.status(), (await b.text()).slice(0, 120));
  }

  // 对照组 C：不带 token
  const c = await page.request.post(BASE + '/api/thanks', {
    data: { replyId },
    headers: { 'Content-Type': 'application/json' },
  });
  log('C 不带 token:', c.status(), (await c.text()).slice(0, 120));

  // 对照组 D：页面内 fetch（与 csrfFetch 相同行为）
  const d = await page.evaluate(async (rid) => {
    try {
      const m = document.cookie.match(/(?:^|; )v2_csrf=([^;]*)/);
      const r = await fetch('/api/thanks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': m ? decodeURIComponent(m[1]) : '' },
        body: JSON.stringify({ replyId: rid }),
      });
      return 'HTTP ' + r.status() + ' ' + (await r.text()).slice(0, 120);
    } catch (e) {
      return 'ERR ' + e.message;
    }
  }, replyId);
  log('D 页面内 fetch:', d);

  await browser.close();
}

async function readCookie(page) {
  const cs = await page.context().cookies();
  return cs.find((c) => c.name === 'v2_csrf')?.value ?? '';
}

main().catch((e) => {
  console.error('[diag] 未处理异常：', e);
  process.exit(1);
});
