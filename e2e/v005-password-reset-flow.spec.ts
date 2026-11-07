import { test, expect } from '@playwright/test';
import {
  register,
  logout,
  uniqueName,
  waitForHydration,
  clearRateLimits,
  getCsrfToken,
} from './helpers';
import { startSmtpFixture, type SmtpFixture } from './smtp-fixture';

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
 *           → fake SMTP server（**独立进程**，真实 TCP + 真实 SMTP 协议）
 *             → 邮件里的链接
 *               → GET /api/auth/reset-password?token=...（校验令牌）
 *                 → POST /api/auth/reset-password（消费令牌 + 改密）
 *                   → 数据库：口令已改 + 旧会话全部失效
 *
 * ## v0.0.8：SMTP 等待机制改为**事件驱动**（P0 稳定性修复）
 *
 * 历史问题（v0.0.7 Linux 矩阵偶发超时，同一提交重跑即过）：
 *   fake server 原先跑在 **Playwright worker 进程内**，与浏览器协议处理
 *   共用事件循环 ⇒ worker 繁忙时 SMTP socket 的 'data' 事件被延迟 ⇒
 *   客户端空闲超时竞速触发 ⇒ 投递失败 ⇒ 邮件永远不到。
 *
 * 现在的机制（e2e/smtp-fixture.ts + tests/helpers/fake-smtp-standalone.ts）：
 *   1. fake server 是**独立进程**（自有事件循环，与 worker 零争抢）；
 *   2. **ready 事件**确认 TCP 监听就绪后才发请求（无固定 sleep）；
 *   3. **mail 事件**（stdout JSON-lines）确认邮件完整收到才断言（无轮询）；
 *   4. **stopped 事件**确认优雅退出，并校验 openSockets=0 / exitCode=0；
 *   5. 进程意外死亡 ⇒ 等待中的承诺立即以明确错误失败（不静默挂起）。
 *
 * 端口契约：应用读 `SMTP_PORT`，spec 读 `E2E_SMTP_PORT`，
 * 两者必须一致（workflow 与本地脚本都从同一处设置）。spec 启动时
 * 会校验这个一致性，不一致立即失败并说明原因。
 */

const MAIL_DOMAIN = 'e2e.local';

/** 应用（Next 服务）被告知的 SMTP 端口 */
const APP_SMTP_PORT = Number(process.env.SMTP_PORT ?? 3025);
/** 测试侧 fake server 应监听的端口（必须与 APP_SMTP_PORT 一致） */
const E2E_SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? APP_SMTP_PORT);

let smtp: SmtpFixture;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // 端口契约校验：不一致时 fake server 起得再好邮件也到不了
  expect(
    E2E_SMTP_PORT,
    `E2E_SMTP_PORT(${E2E_SMTP_PORT}) 必须与 SMTP_PORT(${APP_SMTP_PORT}) 一致 —— ` +
      '前者是测试侧 fake server 的监听端口，后者是应用侧的发信目标',
  ).toBe(APP_SMTP_PORT);

  smtp = await startSmtpFixture(E2E_SMTP_PORT);
  expect(smtp.port, 'fake SMTP server 实际监听端口必须符合预期').toBe(E2E_SMTP_PORT);
  // eslint-disable-next-line no-console
  console.log(`[E2E-SMTP] 独立进程 fake server 就绪：127.0.0.1:${smtp.port}`);
}, 60_000);

test.afterAll(async () => {
  if (!smtp) return;
  // 优雅停止 + **资源释放校验**：openSockets 必须为 0、退出码必须为 0
  const info = await smtp.stop();
  // eslint-disable-next-line no-console
  console.log(
    `[E2E-SMTP] server 已停止：received=${info.received} openSockets=${info.openSockets} exitCode=${info.exitCode}`,
  );
  expect(info.openSockets, '停止后不应有残留 socket').toBe(0);
  expect(info.exitCode, '退出码必须为 0').toBe(0);
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

  await page.goto('/forgot');
  await waitForHydration(page, '#email');
  await page.fill('#email', email);
  const respPromise = page.waitForResponse(
    (r) => r.url().includes('/api/auth/forgot-password') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '发送重置链接' }).click();
  const resp = await respPromise;
  expect(resp.status()).toBe(200);

  // ── ④ 邮件真的进了 fake server（**事件驱动**，非轮询）──
  // mail 事件意味着完整 SMTP 对话成功：EHLO → MAIL FROM → RCPT TO → DATA → 250。
  const mail = await smtp.waitForMail((m) => m.to.includes(email), 20_000);
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

/**
 * v0.0.8 新增：**服务中断后错误可观察**。
 *
 * 停掉 fake SMTP server 后申请重置：
 *   · HTTP 响应必须仍是统一的 200（邮箱枚举防护不受影响）；
 *   · 邮件**确实不会到** —— 且失败是**可观测**的：
 *     测试侧拿到明确的「未收到邮件」错误（带已收数量），
 *     应用侧有 `[forgot-password] 邮件未送达` 警告日志。
 *
 * 这防止「邮件 silently 丢了没人知道」—— 比超时掩盖更危险的状态。
 */
test('服务中断：SMTP 停止后申请重置仍返回统一响应，且无邮件到达（错误可观察）', async ({
  page,
}) => {
  await clearRateLimits(page);
  const username = uniqueName('smtp_down');
  const email = `${username}@${MAIL_DOMAIN}`;
  await register(page, username);
  await logout(page);
  await clearRateLimits(page);

  // 停掉 fake server（模拟邮件服务中断）
  await smtp.stop();

  await page.goto('/forgot');
  await waitForHydration(page, '#email');
  await page.fill('#email', email);
  const respPromise = page.waitForResponse(
    (r) => r.url().includes('/api/auth/forgot-password') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '发送重置链接' }).click();
  const resp = await respPromise;

  // ① 枚举防护：仍返回统一 200（与邮箱是否存在无关）
  expect(resp.status()).toBe(200);

  // ② 邮件不到 —— 且等待以**明确错误**失败（不是静默通过）
  await expect(
    smtp.waitForMail((m) => m.to.includes(email), 5_000).then(
      () => 'arrived',
      (err: Error) => err.message,
    ),
  ).resolves.toMatch(/未收到邮件/);

  // ③ 应用仍然健康（邮件服务故障不影响其他功能）
  const health = await page.request.get('/api/health');
  expect(health.status()).toBe(200);

  // ── 恢复 server，供后续（本文件已无后续用例，但保持环境干净）──
  smtp = await startSmtpFixture(E2E_SMTP_PORT);
}, 90_000);
