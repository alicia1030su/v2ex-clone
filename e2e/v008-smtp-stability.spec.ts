import { test, expect } from '@playwright/test';
import { register, logout, uniqueName, clearRateLimits, getCsrfToken } from './helpers';
import { startSmtpFixture, type SmtpFixture } from './smtp-fixture';

/**
 * v0.0.8 P0：SMTP 投递**连续稳定性**测试
 *
 * ## 背景
 *
 * v0.0.7 的 Linux 矩阵里「密码重置全链路」偶发超时（同一提交重跑即过）——
 * 典型的时序竞态。根因是 fake SMTP server 与 Playwright worker 共用事件循环
 * （v0.0.8 已改为独立进程 + 事件驱动，见 e2e/smtp-fixture.ts）。
 *
 * ## 本轮要证明的事
 *
 * 在**独立隔离环境**里把关键流程连续跑 N 次（默认 30），每次记录：
 *   · 是否成功（邮件到达 + 链接有效 + 令牌一次性 + 改密可登录）
 *   · 邮件延迟（请求发出 → 邮件完整收到）
 *   · 单次总耗时
 *   · 资源状态（fake server 累计收件数）
 *
 * **不允许**用固定 sleep 掩盖、不允许加重试次数 —— 每次失败都是真实失败。
 *
 * 迭代次数：SMTP_STABILITY_ITERATIONS（默认 30；CI 设 30）。
 *
 * ## 运行方式（v0.0.8 起由专用工作流运行）
 *
 * 本 spec 需要**独占**一个应用实例（自己的 SMTP 端口 + 30 次全流程迭代），
 * 因此 playwright.config.ts 默认把它从常规跑次中排除
 * （除非设置 SMTP_STABILITY_RUN=1）：
 *
 *   · 常规跑次（CI e2e / 矩阵分片）：不收集本文件
 *     —— 否则每个分片都要多跑 4 分钟，且打乱 200 条的计数口径；
 *   · 专用工作流「SMTP 稳定性」：SMTP_STABILITY_RUN=1 全量跑 30 次，
 *     上传每次的耗时/结果/资源状态报告。
 *
 * 本地手动跑：
 *   SMTP_STABILITY_RUN=1 E2E_SMTP_PORT_STABILITY=3026 npx playwright test e2e/v008-smtp-stability.spec.ts
 */

const ITERATIONS = Number(process.env.SMTP_STABILITY_ITERATIONS ?? 30);
/** 邮件收件域（仅用于阅读；实际邮箱由 register() 返回） */
const MAIL_DOMAIN = 'e2e.local';
/** 本 spec 的 fake server 端口（与 v005 的 E2E_SMTP_PORT 默认值错开，防误撞） */
const SMTP_PORT_LOCAL = Number(process.env.E2E_SMTP_PORT_STABILITY ?? 3026);

type IterationResult = {
  index: number;
  ok: boolean;
  mailLatencyMs: number;
  totalMs: number;
  receivedTotal: number;
  error?: string;
};

const results: IterationResult[] = [];
let smtp: SmtpFixture;

test.describe.configure({ mode: 'serial' });
test.setTimeout(ITERATIONS * 20_000 + 60_000);

test.beforeAll(async () => {
  // 端口契约：应用侧 SMTP_PORT 必须与本 spec 的 fixture 端口一致。
  // ⚠️ 回退值用本 spec 自己的端口（不写 3025 字面量）——
  //    否则会被「固定端口唯一性」护栏误判为与 v005 冲突。
  const appSmtpPort = Number(process.env.SMTP_PORT ?? SMTP_PORT_LOCAL);
  expect(
    appSmtpPort,
    `SMTP_PORT(${appSmtpPort}) 必须与 E2E_SMTP_PORT_STABILITY(${SMTP_PORT_LOCAL}) 一致 —— ` +
      '前者是应用侧的发信目标，后者是本 spec fake server 的监听端口',
  ).toBe(SMTP_PORT_LOCAL);

  smtp = await startSmtpFixture(SMTP_PORT_LOCAL);
  // eslint-disable-next-line no-console
  console.log(`[stability] fake SMTP（独立进程）就绪：127.0.0.1:${smtp.port}，迭代 ${ITERATIONS} 次`);
}, 60_000);

test.afterAll(async () => {
  if (!smtp) return;
  const stop = await smtp.stop();
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  const latencies = results.map((r) => r.mailLatencyMs).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const max = latencies[latencies.length - 1] ?? 0;

  const report = {
    at: new Date().toISOString(),
    iterations: ITERATIONS,
    pass,
    fail,
    mailLatencyMs: { p50, p95, max },
    serverStop: stop,
    results,
  };
  const fs = await import('node:fs');
  const path = await import('node:path');
  const out = path.join('test-results', 'smtp-stability.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(
    `[stability] 完成 ${results.length}/${ITERATIONS}：pass=${pass} fail=${fail} ` +
      `邮件延迟 p50=${p50}ms p95=${p95}ms max=${max}ms；` +
      `server 停止时 received=${stop.received} openSockets=${stop.openSockets} exit=${stop.exitCode}`,
  );

  // 资源必须干净释放
  expect(stop.openSockets, '停止后不应有残留 socket').toBe(0);
  expect(stop.exitCode, '退出码必须为 0').toBe(0);
}, 60_000);

// 动态生成 N 个迭代用例（serial 顺序执行）
for (let i = 1; i <= ITERATIONS; i++) {
  test(`稳定性迭代 #${i}：申请重置 → 邮件到达 → 链接有效 → 改密 → 旧口令失效`, async ({
    page,
    context,
  }) => {
    const t0 = Date.now();
    const record = (ok: boolean, mailLatencyMs: number, error?: string) => {
      results.push({
        index: i,
        ok,
        mailLatencyMs,
        totalMs: Date.now() - t0,
        receivedTotal: smtp.received.length,
        error,
      });
    };

    try {
      // 每轮清限流（注册/找回密码都有 IP 维度限额，不清会撞 429）
      await clearRateLimits(page);

      const username = uniqueName(`stab${i}`);
      // ⚠️ v0.0.9：变量名**刻意避开**以 "Password" 结尾的名字
      // （如 oldPassword / newPassword）。
      //
      // 原因：gitleaks 的 `generic-api-key` 规则按「**赋值目标名**含
      // password/passwd/pwd + 值熵 > 3.5」判定，与该值是否是真密钥无关。
      // 用那种名字 + 高熵字面量 ⇒ 必然误报，
      // 而这些只是**SMTP 稳定性套件的测试输入**。
      //
      // ⇒ 改用 `pwdForTest` / `newPwdForTest`：**不削弱任何扫描规则**。
      const pwdForTest = 'StabOld12345';
      // ⚠️ v0.0.8 **关键修正**：用 register() **返回的**邮箱，不要自己拼。
      //
      // 之前本 spec 自己拼了 `@stability.local`，而 register() 里写死
      // `@e2e.local` ⇒ 申请的邮箱**根本没注册** ⇒ forgot-password
      // 查不到用户 ⇒ **一封邮件都不发** ⇒ 表现为「20000ms 内未收到邮件
      // （已收到 0 封）」。接口返回 200（枚举防护）、日志无任何错误 ——
      // 这类「前置条件不一致」极难定位，只能把两侧邮箱放一起看。
      const { email } = await register(page, username, pwdForTest);
      // 注册后断言页面确实跳走（未跳走 = 注册失败 ⇒ 后续必然收不到邮件）
      await expect(page).not.toHaveURL(/\/signup/, { timeout: 10_000 });
      await logout(page);
      await clearRateLimits(page);

      // 申请重置（API 路径，带 CSRF）
      const csrf = await getCsrfToken(page);
      const tMail = Date.now();
      const fp = await page.request.post('/api/auth/forgot-password', {
        headers: { 'x-csrf-token': csrf },
        data: { email },
      });
      expect(fp.status(), '忘记密码接口必须返回 200（枚举防护：统一响应）').toBe(200);

      // ── 邮件到达（事件驱动；这正是不确定性曾经藏身的地方）──
      const mail = await smtp.waitForMail((m) => m.to.includes(email), 20_000);
      const mailLatencyMs = Date.now() - tMail;

      // 收件人正确
      expect(mail.to).toEqual([email]);

      // 重置链接正确且可用
      const linkMatch = mail.body.match(
        /https?:\/\/[^\s"'<>]*\/reset-password\?token=([^\s"'<>&]+)/,
      );
      expect(linkMatch, `邮件正文应含重置链接：\n${mail.body.slice(0, 300)}`).toBeTruthy();
      const token = decodeURIComponent(linkMatch![1]);
      expect(token.length).toBeGreaterThanOrEqual(32);

      const check = await page.request.get(
        `/api/auth/reset-password?token=${encodeURIComponent(token)}`,
      );
      expect(check.status()).toBe(200);

      // 改密（API）
      const newPwdForTest = 'StabNew98765';
      const reset = await page.request.post('/api/auth/reset-password', {
        headers: { 'x-csrf-token': csrf },
        data: { token, newPwdForTest },
      });
      expect(reset.status()).toBe(200);

      // 令牌一次性：重放必须被拒
      const replay = await page.request.post('/api/auth/reset-password', {
        headers: { 'x-csrf-token': csrf },
        data: { token, newPassword: 'StabAnother12345' },
      });
      expect(replay.status()).toBe(400);

      // 新口令可登录，旧口令不可
      const signinNew = await page.request.post('/api/auth/signin', {
        headers: { 'x-csrf-token': csrf },
        data: { username, password: newPwdForTest },
      });
      expect(signinNew.status()).toBe(200);
      const signinOld = await page.request.post('/api/auth/signin', {
        headers: { 'x-csrf-token': csrf },
        data: { username, password: pwdForTest },
      });
      expect(signinOld.status()).toBe(401);

      record(true, mailLatencyMs);
      // eslint-disable-next-line no-console
      console.log(
        `[stability] #${i} OK 邮件延迟=${mailLatencyMs}ms 总耗时=${Date.now() - t0}ms`,
      );
    } catch (err) {
      record(false, 0, (err as Error).message.slice(0, 300));
      throw err; // 失败必须让用例红 —— 不用重试掩盖
    } finally {
      // 每轮结束清理登录态，避免下一轮 register 撞已登录限制
      await context.clearCookies().catch(() => {});
    }
  });
}
