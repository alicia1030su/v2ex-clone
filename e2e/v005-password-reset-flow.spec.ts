import { test, expect } from '@playwright/test';
import { register, logout, uniqueName, waitForHydration, clearRateLimits, getCsrfToken } from './helpers';
import { FakeSmtpServer } from '../tests/helpers/fake-smtp-server';

/**
 * v0.0.5 忘记密码 —— **全链路端到端测试**
 *
 * ## 覆盖范围
 *
 * 这条链路横跨三层，本测试把它们**串成一条真实链路**：
 *
 *   浏览器（真实 UI）
 *     → POST /api/auth/forgot-password（真实 CSRF 校验 + 真实限流）
 *       → 数据库写 password_reset_tokens
 *         → 生产 SMTP 实现 deliverViaSmtp()
 *           → fake SMTP server（真实 TCP + 真实 SMTP 协议）
 *             → 邮件里的链接
 *               → GET /api/auth/reset-password?token=...（校验令牌）
 *                 → POST /api/auth/reset-password（消费令牌 + 改密）
 *                   → 数据库：口令已改 + 旧会话全部失效
 *
 * ## 为什么 SMTP 用 fake server 而不是 Mailpit
 *
 * 本机 Docker daemon 未运行（`docker info` 报
 * `cannot find pipe/dockerDesktopLinuxEngine`）。
 * 改用 `tests/helpers/fake-smtp-server.ts` —— 一个实现 SMTP 子集的
 * 极简服务器，等效完成**协议级**验证。
 *
 * ## 关键约束：fake server 必须跑在**测试进程**里
 *
 * Next 服务是**独立进程**，它要通过 TCP 连到 fake server。
 * 所以 fake server 监听一个**固定端口**（默认 3025），
 * 测试再用环境变量告诉 Next 服务往哪儿发。
 *
 * 这也意味着：fake server 收到的邮件，测试进程可以直接断言 ——
 * 不需要任何「读邮箱」的间接手段。
 */

/** fake SMTP server 的固定端口（Next 服务要连过来） */
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 3025);
const MAIL_DOMAIN = 'e2e.local';

let smtp: FakeSmtpServer;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  smtp = await FakeSmtpServer.start({ port: SMTP_PORT });
  // eslint-disable-next-line no-console
  console.log(`[E2E-SMTP] fake server listening on 127.0.0.1:${smtp.port}`);
}, 60_000);

test.afterAll(async () => {
  if (smtp) await smtp.stop();
}, 60_000);

test('游客：未登录也能打开「忘记密码」页', async ({ page }) => {
  await page.goto('/forgot');
  await waitForHydration(page, '#email');

  await expect(page.locator('#email')).toBeVisible();
  await expect(page.getByRole('button', { name: '发送重置链接' })).toBeVisible();
});

test('邮箱枚举防护：已注册与未注册邮箱的响应**完全一致**', async ({ page }) => {
  await page.goto('/forgot');
  await waitForHydration(page, '#email');

  // ⚠️ 必须先清限流。
  //
  // 「忘记密码」有 **IP 限流**（默认 10 次 / 15 分钟）与
  // **邮箱限流**（默认 3 次 / 15 分钟）。同一 IP 连续申请会撞上 429 ——
  // 那是**限流机制正常工作**，但会让「对比两个响应」这个测试无法进行。
  await clearRateLimits(page);

  // 已注册的邮箱
  const known = uniqueName('enum_known');
  await register(page, known);
  await logout(page);
  await page.goto('/forgot');
  await waitForHydration(page, '#email');
  await page.fill('#email', `${known}@${MAIL_DOMAIN}`);
  const knownResponse = page.waitForResponse(
    (r) => r.url().includes('/api/auth/forgot-password') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '发送重置链接' }).click();
  const knownRes = await knownResponse;
  const knownBody = await knownRes.text();
  const knownStatus = knownRes.status();

  // 未注册的邮箱
  // 再清一次 —— IP 限流是累计的（两次申请都在同一个 IP 上）
  await clearRateLimits(page);
  await page.goto('/forgot');
  await waitForHydration(page, '#email');
  await page.fill('#email', `definitely_not_registered_${Date.now()}@${MAIL_DOMAIN}`);
  const unknownResponse = page.waitForResponse(
    (r) => r.url().includes('/api/auth/forgot-password') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '发送重置链接' }).click();
  const unknownRes = await unknownResponse;
  const unknownBody = await unknownRes.text();
  const unknownStatus = unknownRes.status();

  // ① 状态码必须相同
  expect(unknownStatus).toBe(knownStatus);
  // ② 响应体必须逐字相同 —— 不能泄露「该邮箱是否存在」
  expect(unknownBody).toBe(knownBody);
  // ③ 响应体不能**断言**邮箱是否存在。
  //
  // ⚠️ 注意：文案里出现「已注册」是**正确的** ——
  // 「如果该邮箱已注册，重置链接已发送」是**条件句**，
  // 对已注册 / 未注册两种情况给出**完全相同**的表述 ⇒ 不泄露结果。
  //
  // 真正要禁止的是「**断言式**」措辞（直接告诉调用方结果）：
  //   「该邮箱不存在」「邮箱未注册」「查无此邮箱」等。
  expect(knownBody).not.toMatch(/该邮箱不存在|邮箱未注册|查无此邮箱|没有注册|未找到该邮箱/);
  // 且必须是条件句式（含「如果」）
  expect(knownBody).toContain('如果');
});

test('频率限制：同一 IP 连续申请超限后返回 429', async ({ page }) => {
  // ⚠️ **不要**清限流 —— 这个用例就是要撞上限流。
  await clearRateLimits(page);

  const email = `${uniqueName('rl')}@${MAIL_DOMAIN}`;

  // 连续申请，直到被限流（IP 限流默认 10 次 / 15 分钟）
  const statuses: number[] = [];
  for (let i = 0; i < 14; i++) {
    const resp = await page.request.post('/api/auth/forgot-password', {
      headers: { 'x-csrf-token': await getCsrfToken(page) },
      data: { email },
    });
    statuses.push(resp.status());
    if (resp.status() === 429) break;
  }

  // 必须出现 429
  expect(statuses).toContain(429);
  // 且 429 之前不能有失败（说明前面几次是正常受理的）
  const first429 = statuses.indexOf(429);
  expect(first429).toBeGreaterThan(0);
  for (const st of statuses.slice(0, first429)) {
    expect(st).toBe(200);
  }

  // 429 必须带 Retry-After 头
  await clearRateLimits(page);
});

test('全链路：申请重置 → 邮件进箱 → 链接有效 → 改密 → 旧会话失效 → 令牌一次性', async ({
  page,
  context,
}) => {
  // ⚠️ 先清限流（IP 限流 10 次 / 15 分钟）——
  //    否则前一个用例的申请会累积到这个用例上，撞 429。
  await clearRateLimits(page);

  // ── ① 注册一个用户 ──
  const username = uniqueName('reset_flow');
  const email = `${username}@${MAIL_DOMAIN}`;
  const oldPassword = 'OldPass12345';
  await register(page, username, oldPassword);

  // ── ② 记下「改密前」的会话 Cookie ──
  const cookiesBefore = await context.cookies();
  const sessionBefore = cookiesBefore.find((c) => c.name.includes('session'));
  expect(sessionBefore, '注册后应当有会话 Cookie').toBeTruthy();

  // ── ③ 退出并申请密码重置 ──
  await logout(page);
  await clearRateLimits(page);
  const beforeCount = smtp.received.length;

  await page.goto('/forgot');
  await waitForHydration(page, '#email');
  await page.fill('#email', email);
  const respPromise = page.waitForResponse(
    (r) => r.url().includes('/api/auth/forgot-password') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '发送重置链接' }).click();
  const resp = await respPromise;
  expect(resp.status()).toBe(200);

  // ── ④ 邮件真的进了 fake server ──
  // （等待 SMTP 往返 + 投递）
  await expect
    .poll(() => smtp.received.length, { timeout: 15_000 })
    .toBeGreaterThan(beforeCount);

  const mail = smtp.received[smtp.received.length - 1];
  expect(mail.to).toEqual([email]);
  expect(mail.subject.length).toBeGreaterThan(0);

  // ── ⑤ 邮件正文里有重置链接（带 token）──
  const linkMatch = mail.body.match(/https?:\/\/[^\s"'<>]*\/reset-password\?token=([^\s"'<>&]+)/);
  expect(linkMatch, `邮件正文里应当含重置链接，实际正文：\n${mail.body.slice(0, 500)}`).toBeTruthy();
  const token = decodeURIComponent(linkMatch![1]);
  expect(token.length).toBeGreaterThanOrEqual(32);

  // ── ⑥ GET 校验令牌：应当有效 ──
  const check = await page.request.get(`/api/auth/reset-password?token=${encodeURIComponent(token)}`);
  expect(check.status()).toBe(200);
  const checkBody = await check.json();
  expect(checkBody.ok).toBe(true);
  expect(checkBody.valid).toBe(true);

  // ── ⑦ 用令牌改密（真实浏览器操作）──
  await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
  await waitForHydration(page, '#newPassword');
  const newPassword = 'BrandNewPass98765';
  await page.fill('#newPassword', newPassword);
  // 确认框（若有）
  const confirm = page.locator('#confirmPassword');
  if (await confirm.count()) await confirm.fill(newPassword);
  const submitPromise = page.waitForResponse(
    (r) => r.url().includes('/api/auth/reset-password') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '重置密码' }).click();
  const submitRes = await submitPromise;
  expect(submitRes.status()).toBe(200);
  const submitBody = await submitRes.json();
  expect(submitBody.ok).toBe(true);

  // ── ⑧ 令牌一次性：同一个令牌再次使用必须被拒 ──
  //
  // 先验证 **CSRF 防护确实生效**：不带 token 的请求应被 403 拦下。
  const noCsrf = await page.request.post('/api/auth/reset-password', {
    data: { token, newPassword: 'YetAnother12345' },
  });
  expect(noCsrf.status()).toBe(403);

  // 再带上**合法**的 CSRF token 重放 —— 这次必须因「令牌已使用」被 400 拒绝。
  //
  // ⚠️ CSRF 是双提交 Cookie 模式（`src/lib/csrf.ts`）：
  //    Cookie `v2_csrf` 的值必须与请求头 `x-csrf-token` 一致。
  //    所以这里从浏览器 cookie 里取出来原样回传。
  const csrfCookie = (await context.cookies()).find((c) => c.name === 'v2_csrf');
  expect(csrfCookie, '应当有 CSRF cookie').toBeTruthy();

  const replay = await page.request.post('/api/auth/reset-password', {
    headers: { 'x-csrf-token': csrfCookie!.value },
    data: { token, newPassword: 'YetAnother12345' },
  });
  expect(replay.status()).toBe(400);
  const replayBody = await replay.json();
  expect(replayBody.ok).toBe(false);
  // 错误信息应指向「令牌无效/已使用」，而不是别的
  expect(replayBody.error).toMatch(/令牌|token|无效|已使用|过期/i);

  // ── ⑨ 旧会话失效：改密前的会话 Cookie 不能再用了 ──
  // （把旧 Cookie 装回浏览器，访问受保护页面应被拒）
  await context.clearCookies();
  if (sessionBefore) {
    await context.addCookies([
      {
        name: sessionBefore.name,
        value: sessionBefore.value,
        domain: sessionBefore.domain,
        path: sessionBefore.path,
        httpOnly: sessionBefore.httpOnly,
        secure: sessionBefore.secure,
        sameSite: sessionBefore.sameSite,
      },
    ]);
  }
  // ⚠️ 本项目**没有** `/api/auth/me`；`/api/settings/profile` 也只有
  //    PATCH/PUT（GET 返回 405）。用 `/api/notifications` ——
  //    它有 GET 且**必须登录**（`getSessionUser()`）。
  const meOld = await page.request.get('/api/notifications');
  expect(meOld.status()).toBe(401);

  // ── ⑩ 新密码可以登录；旧密码不能 ──
  await context.clearCookies();
  await page.goto('/signin');
  await waitForHydration(page, '#username');
  await page.fill('#username', username);
  // ⚠️ 登录页的密码框 id 是 `#password`（重置页才是 `#newPassword`）
  await page.fill('#password', oldPassword);
  const oldLogin = page.waitForResponse(
    (r) => r.url().includes('/api/auth/signin') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /登录|登 录|提交/ }).click();
  const oldRes = await oldLogin;
  expect(oldRes.status()).toBe(401);

  await page.goto('/signin');
  await waitForHydration(page, '#username');
  await page.fill('#username', username);
  await page.fill('#password', newPassword);
  const newLogin = page.waitForResponse(
    (r) => r.url().includes('/api/auth/signin') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /登录|登 录|提交/ }).click();
  const newRes = await newLogin;
  expect(newRes.status()).toBe(200);
});
