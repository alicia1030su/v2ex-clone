import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sendMail } from '../src/lib/mailer';
import { FakeSmtpServer } from './helpers/fake-smtp-server';

/**
 * v0.0.5 SMTP 协议级全链路测试（**直测生产路径**）
 *
 * ## ⚠️ 重要修正：为什么测的是 `sendMail` 而不是 `smtp-client.ts`
 *
 * v0.0.5 初版这个测试测的是 `src/lib/smtp-client.ts` 的 `sendMailSmtp()`。
 * 写完才发现一个**更严重的问题**：
 *
 *   `src/lib/smtp-client.ts` **没有任何生产调用方** —— 它是死代码。
 *   真正的生产 SMTP 实现在 `src/lib/mailer.ts` 的 `deliverViaSmtp()`。
 *
 * 也就是说：初版测试「全绿」并不能说明生产路径可用，
 * 而在死代码上发现的 3 个协议缺陷（DATA 无邮件头 / EHLO 多行响应 /
 * 无条件 STARTTLS）对生产毫无影响。
 *
 * 本轮的做法：
 *  1. **删掉死代码** `src/lib/smtp-client.ts`
 *  2. 让本测试直接调 **`sendMail()`** —— 也就是生产路径
 *  3. 新增 `SMTP_ALLOW_REAL_IN_TEST=1` 开关，让隔离测试环境
 *     能绕过 outbox 直达 `deliverViaSmtp()`
 *
 * 这样「测试通过」才真正等于「生产可用」。
 *
 * ## 覆盖范围与边界
 *
 * ✅ **已覆盖**：
 *   - `sendMail()` 与一个真实 SMTP 服务器的完整协议对话
 *     （EHLO / AUTH LOGIN / MAIL FROM / RCPT TO / DATA）
 *   - 邮件内容正确送达（from / to / subject / body 逐一断言）
 *   - 邮件头齐全（From / To / Subject / Date / Message-ID / MIME-Version）
 *   - 认证失败被明确拒绝（不静默降级）
 *   - 服务器主动拒绝 DATA 时的失败路径
 *   - 连接不可达时的失败路径（端口未监听）
 *   - 超时控制
 *
 * ❌ **未覆盖**（如实标注，见 FEATURE_AUDIT §八）：
 *   - **真实外部 SMTP 投递**（无外部凭据，不向真实用户发邮件）
 *   - DKIM / SPF 校验（客户端不签名，服务端也不校验）
 *   - STARTTLS 真正升级（fake server 宣告但不升级；
 *     真实 TLS 需要证书基建，属部署层关注点）
 *
 * ## 为什么不用 Mailpit 容器
 *
 * 任务书要求 Mailpit / MailHog，但本机 Docker daemon 未运行
 * （`docker info` 报 `cannot find pipe/dockerDesktopLinuxEngine`）。
 * 改用 `tests/helpers/fake-smtp-server.ts` —— 一个实现 SMTP 子集的
 * 极简服务器，能完成**等效的协议级**验证。
 */

const FROM = 'noreply@v2ex-clone.local';
const TO = 'user@example.com';

/** 让 `sendMail` 绕过 outbox，直达生产 SMTP 实现 */
function enableRealSmtp(port: number, opts?: { user?: string; pass?: string }) {
  process.env.SMTP_ALLOW_REAL_IN_TEST = '1';
  process.env.APP_RUNTIME_ENV = 'test';
  process.env.TEST_ENV_ISOLATED = '1';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(port);
  process.env.SMTP_FROM = FROM;
  process.env.SMTP_SECURE = '0';
  process.env.SMTP_TIMEOUT_MS = '4000';
  if (opts?.user) process.env.SMTP_USER = opts.user;
  else delete process.env.SMTP_USER;
  if (opts?.pass) process.env.SMTP_PASS = opts.pass;
  else delete process.env.SMTP_PASS;
}

/** 恢复默认（让 sendMail 回到 outbox 模式） */
function restoreSmtpEnv() {
  delete process.env.SMTP_ALLOW_REAL_IN_TEST;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_FROM;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_SECURE;
}

describe('v0.0.5 SMTP 协议 · 成功路径（直测生产 sendMail）', () => {
  let server: FakeSmtpServer;

  beforeAll(async () => {
    server = await FakeSmtpServer.start({ port: 0 });
  }, 30_000);

  afterAll(async () => {
    restoreSmtpEnv();
    await server.stop();
  }, 30_000);

  beforeEach(() => {
    enableRealSmtp(server.port);
  });

  it('无需认证的服务器：完整协议对话成功，邮件内容正确送达', async () => {
    const before = server.received.length;
    const res = await sendMail({
      to: TO,
      subject: '测试邮件主题',
      text: '这是邮件正文。\n第二行。',
      purpose: 'password_reset',
    });

    expect(res.sent).toBe(true);
    if (!res.sent) return;

    // 服务器确实收到 1 封
    expect(server.received.length).toBe(before + 1);
    const mail = server.received[server.received.length - 1];

    // ① 收发件人正确
    expect(mail.from).toBe(FROM);
    expect(mail.to).toEqual([TO]);

    // ② Subject 正确（生产实现用 RFC 2047 base64 编码）
    expect(mail.subject).toBe('测试邮件主题');

    // ③ 正文完整（生产实现用 8bit 传输，服务器按 UTF-8 解码）
    expect(mail.body).toContain('这是邮件正文。');
    expect(mail.body).toContain('第二行。');

    // ④ 邮件头齐全 —— 这正是生产路径的关键断言
    //    （死代码 smtp-client.ts 的 DATA 里**只有 body、没有任何头**，
    //      如果测的是它就发现不了生产路径的问题）
    expect(mail.data).toContain(`From: ${FROM}`);
    expect(mail.data).toContain(`To: ${TO}`);
    expect(mail.data).toContain('Content-Type: text/plain; charset=utf-8');
    expect(mail.data).toContain('MIME-Version: 1.0');
    expect(mail.data).toContain('Date: ');
    expect(mail.data).toContain('Message-ID: <');
    // Message-ID 形如 <xxx@localhost>
    expect(mail.messageId).toMatch(/^<.+@.+>$/);

    // ⑤ 协议命令序列正确（到 DATA 为止）
    expect(server.commands.some((c) => c.startsWith('EHLO'))).toBe(true);
    expect(server.commands.some((c) => c.startsWith('MAIL FROM'))).toBe(true);
    expect(server.commands.some((c) => c.startsWith('RCPT TO'))).toBe(true);
    expect(server.commands.some((c) => c === 'DATA')).toBe(true);
    // 无认证要求的服务器**不应**出现 AUTH
    expect(server.commands.some((c) => c.startsWith('AUTH'))).toBe(false);
  }, 30_000);

  it('需要 AUTH LOGIN 的服务器：凭据正确时成功', async () => {
    await server.stop();
    server = await FakeSmtpServer.start({
      port: 0,
      credentials: { user: 'smtpuser', pass: 'smtppass' },
    });
    enableRealSmtp(server.port, { user: 'smtpuser', pass: 'smtppass' });

    const res = await sendMail({
      to: TO,
      subject: '认证邮件',
      text: 'body',
      purpose: 'password_reset',
    });

    expect(res.sent).toBe(true);
    expect(server.received.length).toBe(1);
    expect(server.received[0].subject).toBe('认证邮件');
    // 确实走了 AUTH 流程
    expect(server.commands.some((c) => c.startsWith('AUTH LOGIN'))).toBe(true);
  }, 30_000);

  it('AUTH 凭据错误时明确失败（不静默降级、不抛异常）', async () => {
    // ⚠️ 必须用 `before` 计数，而不是断言 `length === 0` ——
    //    上一个用例（凭据正确）已在**同一个 server 实例**上成功投递了 1 封。
    const before = server.received.length;
    // ⚠️ `server.commands` 是**累积**的 —— 上一个用例已记录过 `DATA`。
    //    所以要按**本次发送的增量**检查。
    const cmdBefore = server.commands.length;

    enableRealSmtp(server.port, { user: 'wronguser', pass: 'wrongpass' });
    const res = await sendMail({
      to: TO,
      subject: '应该失败',
      text: 'body',
      purpose: 'password_reset',
    });

    expect(res.sent).toBe(false);
    // 服务器**没有**新增邮件（认证失败后就中止了）
    expect(server.received.length).toBe(before);
    // 本次发送没有走到 DATA（按增量检查）
    const cmds = server.commands.slice(cmdBefore);
    expect(cmds.some((c) => c === 'DATA')).toBe(false);
    // 但确实尝试了 AUTH LOGIN（说明是认证环节失败，不是别的）
    expect(cmds.some((c) => c.startsWith('AUTH LOGIN'))).toBe(true);
  }, 30_000);
});

describe('v0.0.5 SMTP 协议 · 失败路径（直测生产 sendMail）', () => {
  it('连接不可达（端口未监听）时返回失败而非崩溃', async () => {
    // 找一个确定没人监听的端口
    const silent = await FakeSmtpServer.start({ port: 0 });
    const deadPort = silent.port;
    await silent.stop();

    enableRealSmtp(deadPort);
    const res = await sendMail({
      to: TO,
      subject: 'x',
      text: 'y',
      purpose: 'password_reset',
    });

    expect(res.sent).toBe(false);
    expect(res.reason).toBeTruthy();
    restoreSmtpEnv();
  }, 30_000);

  it('服务器拒绝 DATA 时返回失败', async () => {
    const server = await FakeSmtpServer.start({ port: 0, rejectData: true });
    enableRealSmtp(server.port);

    const res = await sendMail({
      to: TO,
      subject: 'x',
      text: 'y',
      purpose: 'password_reset',
    });

    expect(res.sent).toBe(false);
    // 服务器明确拒收，邮件不应被记录
    expect(server.received.length).toBe(0);
    restoreSmtpEnv();
    await server.stop();
  }, 30_000);

  it('超时控制生效（服务器不响应时不会无限挂起）', async () => {
    // 起一个接受连接但**完全不回应**的服务器
    const net = await import('node:net');

    // ⚠️ 必须跟踪并销毁 server 端的 socket。
    //
    // 实测踩到：`server.close()` 会**等待所有活跃连接结束**才回调。
    // 客户端虽然 destroy 了 socket，但 server 端的对端连接还挂着
    // （本测试的 server 故意不回应，也从不主动断开）⇒
    // `close()` 的回调永不触发 ⇒ 测试进程在 vitest 的 30s 上限被强杀，
    // 看起来「像是 sendMail 没返回」。
    //
    // 实际上 `sendMail` 早已返回（实测日志确认「log written, returning」），
    // 卡的是**进程退出**。
    const sockets = new Set<net.Socket>();
    const silent = net.createServer((sock) => {
      sockets.add(sock);
      sock.on('close', () => sockets.delete(sock));
      /* 故意不回应任何数据 */
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const port = (silent.address() as net.AddressInfo).port;

    enableRealSmtp(port);
    process.env.SMTP_TIMEOUT_MS = '2000';

    const t0 = Date.now();
    const res = await sendMail({
      to: TO,
      subject: 'x',
      text: 'y',
      purpose: 'password_reset',
    });
    const elapsed = Date.now() - t0;

    expect(res.sent).toBe(false);
    // 必须在超时后较快返回（留 3s 余量给调度）
    expect(elapsed).toBeLessThan(6_000);

    restoreSmtpEnv();
    // 断开所有 server 端连接，再关服务器
    for (const sock of sockets) sock.destroy();
    sockets.clear();
    await new Promise<void>((resolve) => {
      silent.close(() => resolve());
    });
  }, 30_000);
});
