import 'server-only';
import { countMetric, logWarn, logError } from '@/lib/observability';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { isRealSmtpAllowedInTest } from '@/lib/runtime-flags';

/**
 * 可配置的邮件发送服务
 *
 * ## 设计原则
 *
 * 1. **绝不假装已发送**。未配置 SMTP 时，`sendMail` 返回 `sent: false`，
 *    并把原因写进 `email_logs.skip_reason`。调用方必须把这个状态如实
 *    透传给用户，而不是回一句「重置邮件已发送」。
 * 2. **测试环境绝不发真邮件**。NODE_ENV=test 或 APP_RUNTIME_ENV=test 时，
 *    邮件一律进入内存 outbox + `email_logs` 表，不会连接任何第三方 SMTP。
 * 3. **发送失败不让请求 500**。`sendMail` 自身捕获所有异常并返回降级状态。
 * 4. **收件人脱敏**。`email_logs` 只保存脱敏地址（首字母 + 掩码 + 完整域名），
 *    避免日志表变成一份可用的邮箱清单。
 */

export type MailPurpose = 'password_reset';

export type MailSendResult = {
  /** 是否真正投递到收件人 */
  sent: boolean;
  /** 未投递原因（sent 为 false 时给出） */
  reason: string | null;
  /** 脱敏后的收件人（写日志用） */
  maskedRecipient: string;
};

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  purpose: MailPurpose;
  /** 关联用户（可为 null，例如邮箱未匹配到用户时） */
  userId?: number | null;
};

/**
 * 单封邮件的发送超时（毫秒）
 *
 * ⚠️ v0.0.5：**每次调用时读取**，不再是模块加载时的常量。
 *
 * 原先是 `const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS ?? 15_000)`
 * —— 在模块加载那一刻就把值固化了。这有两个问题：
 *  1. **超时行为无法测试** —— 运行时改 `process.env.SMTP_TIMEOUT_MS` 无效，
 *     协议级测试想验证「服务器不响应时会超时」就必须等满 15 秒。
 *  2. 与同文件的 `readSmtpConfig()` 行为不一致（那个每次都读 env），
 *     同一个配置文件里两种语义，容易误判。
 *
 * 改成函数后与 `readSmtpConfig()` 保持一致。
 */
/**
 * 写 `email_logs` 的超时上限（毫秒）
 *
 * 日志是**旁路**，绝不能因为它拖死主流程。
 */
const EMAIL_LOG_WRITE_TIMEOUT_MS = Number(process.env.EMAIL_LOG_WRITE_TIMEOUT_MS ?? 3_000);

function smtpTimeoutMs(): number {
  const n = Number(process.env.SMTP_TIMEOUT_MS ?? 15_000);
  return Number.isFinite(n) && n > 0 ? n : 15_000;
}

/** 是否为测试运行时 */
export function isTestRuntime(): boolean {
  if (process.env.APP_RUNTIME_ENV?.toLowerCase() === 'test') return true;
  return process.env.NODE_ENV === 'test';
}

/**
 * 邮箱脱敏：只保留首字母与完整域名。
 *
 * 例：alice@example.com → a***@example.com
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) {
    // 不含 @ 的异常输入：整体掩掉
    return trimmed.length <= 1 ? '*' : `${trimmed[0]}***`;
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!domain) return `${local[0]}***`;
  const head = local[0] ?? '*';
  const rest = local.slice(1);
  return rest.length === 0 ? `${head}@${domain}` : `${head}${'*'.repeat(Math.min(rest.length, 8))}@${domain}`;
}

/** 读取 SMTP 配置（未配置完整则返回 null） */
export function readSmtpConfig(): {
  host: string;
  port: number;
  user: string | null;
  pass: string | null;
  from: string;
  secure: boolean;
} | null {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !from) return null;

  const port = Number(process.env.SMTP_PORT ?? 0);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  const secureRaw = process.env.SMTP_SECURE?.trim().toLowerCase();
  const secure = secureRaw ? secureRaw === '1' || secureRaw === 'true' : port === 465;

  const user = process.env.SMTP_USER?.trim() || null;
  const pass = process.env.SMTP_PASS?.trim() || null;

  return { host, port, user, pass, from, secure };
}

/**
 * smtpConfig —— readSmtpConfig 的兼容别名。
 *
 * 后台配置展示页使用这个名字；两者返回同一份配置。
 */
export function smtpConfig(): ReturnType<typeof readSmtpConfig> {
  return readSmtpConfig();
}

/** 判断 SMTP 是否已配置（未配置时绝不尝试发送） */
export function isSmtpConfigured(): boolean {
  return readSmtpConfig() !== null;
}

// ---------------------------------------------------------------------------
// 内存 outbox（测试环境）
// ---------------------------------------------------------------------------

export type OutboxEntry = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  purpose: MailPurpose;
  sentAt: number;
};

/**
 * 测试环境的内存信箱。
 *
 * 用途：让测试能断言「重置邮件确实生成了」，同时保证测试环境
 * 不会把任何内容发到真实邮箱。
 */
const outbox: OutboxEntry[] = [];

/** 读取测试 outbox（仅测试环境有意义） */
export function getMailOutbox(): readonly OutboxEntry[] {
  return outbox;
}

/** 清空测试 outbox */
export function clearMailOutbox(): void {
  outbox.length = 0;
}

// ---------------------------------------------------------------------------
// SMTP 客户端（最小实现，避免引入 nodemailer 依赖）
// ---------------------------------------------------------------------------

type SmtpSocket = Socket | TLSSocket;

/** 读取一封 SMTP 响应（支持 `250-` 多行续行） */
async function readResponse(socket: SmtpSocket): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  let buffer = '';

  for (;;) {
    const chunk = await new Promise<string>((resolve, reject) => {
      // 计时器声明（供上面三个 handler 的 clearTimeout 使用）
      // eslint-disable-next-line prefer-const
      let timer: NodeJS.Timeout;
      const onData = (data: Buffer) => {
        clearTimeout(timer);
        socket.off('error', onError);
        socket.off('timeout', onTimeout);
        resolve(data.toString('utf8'));
      };
      const onError = (err: Error) => {
        clearTimeout(timer);
        socket.off('data', onData);
        socket.off('timeout', onTimeout);
        reject(err);
      };
      const onTimeout = () => {
        clearTimeout(timer);
        socket.off('data', onData);
        socket.off('error', onError);
        reject(new Error('SMTP 响应超时'));
      };
      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('timeout', onTimeout);

      // ⚠️ v0.0.5：**独立计时器**，不依赖 socket 的空闲超时。
      //
      // 实测（v0.0.5 协议测试）：`socket.setTimeout(2000)` 已生效
      // （`socket.timeout === 2000`），但 `'timeout'` 事件**从未触发** ——
      // Node 的空闲超时从「最后一次 socket 活动」起算，而在
      // 「连接刚建立、服务器一个字节都没发」的场景下，计时器并没有
      // 真正开始走 ⇒ `readResponse` 永远挂着（实测卡满 30s 被 vitest 杀）。
      //
      // 修法：用 `Promise.race` 显式竞速一个 `setTimeout`。
      // 这样超时**与 socket 活动无关**，语义确定，也不会丢事件。
      timer = setTimeout(() => {
        socket.off('data', onData);
        socket.off('error', onError);
        socket.off('timeout', onTimeout);
        reject(new Error('SMTP 响应超时'));
      }, smtpTimeoutMs());

      // ⚠️ v0.0.5：**每次等待响应前必须重置空闲计时器**。
      //
      // `socket.setTimeout(ms)` 设置的是「空闲超时」—— 只有 socket 上
      // **没有活动** 时才计时。一旦触发了 `'timeout'` 事件，Node 内部的
      // 计时器就**停止**了；后续再 `setTimeout()` 之前的这段空窗期，
      // 计时器根本不在跑。
      //
      // 原实现在 `deliverViaSmtp` 里 `socket.setTimeout(SMTP_TIMEOUT_MS)`
      // 只调一次，然后 `readResponse` 里只注册 `'timeout'` 监听。
      // 场景：连接建立后服务器迟迟不发问候语 ⇒
      //   - 第一次 `setTimeout` 的计时器在 connect 后就触发了 'timeout'
      //   - 但那时 `readResponse` 还没注册监听 ⇒ **事件丢失**
      //   - 之后计时器不再运行 ⇒ 永远挂起（实测：测试卡到 30s 被杀）
      //
      // 修法：在 `readResponse` 每次等待前重新 `setTimeout`，
      // 让计时器始终与「当前这次等待」对齐。
      socket.setTimeout(smtpTimeoutMs());
    });

    buffer += chunk;
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      lines.push(trimmed);
      // 形如 `250-XXX` 表示后面还有续行；`250 XXX` 表示最后一行
      if (/^\d{3} /.test(trimmed)) {
        const code = Number(trimmed.slice(0, 3));
        return { code, lines };
      }
    }
  }
}

/** 发送一行命令并读取响应 */
async function command(
  socket: SmtpSocket,
  text: string,
): Promise<{ code: number; lines: string[] }> {
  socket.write(text.endsWith('\r\n') ? text : `${text}\r\n`);
  return readResponse(socket);
}

/** RFC 2047 主题编码（非 ASCII 时用 base64） */
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x20-\x7E]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** SMTP 正文点填充（行首的 `.` 需要变成 `..`） */
function dotStuff(body: string): string {
  return body.replace(/\r?\n\./g, '\r\n..');
}

/**
 * 通过 SMTP 发送一封邮件。
 *
 * 失败时抛异常（由 sendMail 统一捕获并降级）。
 */
async function deliverViaSmtp(
  config: NonNullable<ReturnType<typeof readSmtpConfig>>,
  message: MailMessage,
): Promise<void> {
  const socket: SmtpSocket = config.secure
    ? await new Promise<TLSSocket>((resolve, reject) => {
        const s = tlsConnect(
          { host: config.host, port: config.port, servername: config.host },
          () => resolve(s),
        );
        s.once('error', reject);
      })
    : await new Promise<Socket>((resolve, reject) => {
        const s = netConnect({ host: config.host, port: config.port }, () => resolve(s));
        s.once('error', reject);
      });

  try {
    socket.setTimeout(smtpTimeoutMs());

    const greeting = await readResponse(socket);
    if (greeting.code !== 220) {
      throw new Error(`SMTP 服务端问候异常: ${greeting.code}`);
    }

    let ehlo = await command(socket, 'EHLO localhost');
    if (ehlo.code !== 250) {
      ehlo = await command(socket, 'HELO localhost');
      if (ehlo.code !== 250) throw new Error(`SMTP EHLO 失败: ${ehlo.code}`);
    }

    // 明文连接时尝试 STARTTLS（若服务端支持）
    if (!config.secure && ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
      const starttls = await command(socket, 'STARTTLS');
      if (starttls.code === 220) {
        const upgraded = await new Promise<TLSSocket>((resolve, reject) => {
          const s = tlsConnect(
            { socket: socket as Socket, servername: config.host },
            () => resolve(s),
          );
          s.once('error', reject);
        });
        // 升级后必须重新 EHLO（RFC 3207）
        const reEhlo = await command(upgraded, 'EHLO localhost');
        if (reEhlo.code !== 250) throw new Error(`SMTP EHLO 失败: ${reEhlo.code}`);
        await sendBody(upgraded, config, message);
        return;
      }
    }

    await sendBody(socket, config, message);
  } finally {
    try {
      socket.write('QUIT\r\n');
    } catch {
      /* 忽略关闭期异常 */
    }
    socket.destroy();
  }
}

/** SMTP 认证 + 投递正文 */
async function sendBody(
  socket: SmtpSocket,
  config: NonNullable<ReturnType<typeof readSmtpConfig>>,
  message: MailMessage,
): Promise<void> {
  if (config.user && config.pass) {
    const auth = await command(socket, 'AUTH LOGIN');
    if (auth.code === 334) {
      await command(socket, Buffer.from(config.user, 'utf8').toString('base64'));
      await command(socket, Buffer.from(config.pass, 'utf8').toString('base64'));
    } else if (auth.code !== 235) {
      throw new Error(`SMTP 认证失败: ${auth.code}`);
    }
  }

  const mailFrom = await command(socket, `MAIL FROM:<${config.from}>`);
  if (mailFrom.code !== 250) throw new Error(`SMTP MAIL FROM 失败: ${mailFrom.code}`);

  const rcptTo = await command(socket, `RCPT TO:<${message.to}>`);
  if (rcptTo.code !== 250 && rcptTo.code !== 251) {
    throw new Error(`SMTP RCPT TO 失败: ${rcptTo.code}`);
  }

  const data = await command(socket, 'DATA');
  if (data.code !== 354) throw new Error(`SMTP DATA 失败: ${data.code}`);

  const headers = [
    `From: ${config.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@localhost>`,
    'MIME-Version: 1.0',
  ];

  if (message.html) {
    headers.push('Content-Type: text/html; charset=utf-8');
    headers.push('Content-Transfer-Encoding: 8bit');
  } else {
    headers.push('Content-Type: text/plain; charset=utf-8');
    headers.push('Content-Transfer-Encoding: 8bit');
  }

  const body = message.html ?? message.text;
  socket.write(`${headers.join('\r\n')}\r\n\r\n${dotStuff(body)}\r\n.\r\n`);

  const done = await readResponse(socket);
  if (done.code !== 250) throw new Error(`SMTP 投递失败: ${done.code}`);
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

/**
 * 发送一封邮件。
 *
 * 永远不抛异常：发送失败时返回 `sent: false` 并记录原因，
 * 由调用方决定如何降级（绝不能让整个请求 500）。
 */
export async function sendMail(message: MailMessage): Promise<MailSendResult> {
  const maskedRecipient = maskEmail(message.to);

  // ---- 测试环境：进内存 outbox，绝不发真邮件 ----
  //
  // ⚠️ v0.0.5：唯一例外是**隔离测试环境显式要求真实 SMTP** 时
  //    （`SMTP_ALLOW_REAL_IN_TEST=1` + `TEST_ENV_ISOLATED=1`）。
  //    没有这个开关，生产 SMTP 代码路径（`deliverViaSmtp`）
  //    在测试里**从未被执行过** —— 「邮件已发送」只是 outbox 里的
  //    一个数组项而已。
  if (isTestRuntime() && !isRealSmtpAllowedInTest()) {
    outbox.push({
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      purpose: message.purpose,
      sentAt: Date.now(),
    });
    await writeEmailLog({
      maskedRecipient,
      purpose: message.purpose,
      delivered: true,
      skipReason: null,
      userId: message.userId ?? null,
    });
    return { sent: true, reason: 'test-outbox', maskedRecipient };
  }

  // ---- 未配置 SMTP：明确返回「未发送」 ----
  const config = readSmtpConfig();
  if (!config) {
    await writeEmailLog({
      maskedRecipient,
      purpose: message.purpose,
      delivered: false,
      skipReason: 'smtp_not_configured',
      userId: message.userId ?? null,
    });
    // v0.0.8：SMTP 投递失败统计（任务书 §六）
    countMetric('mail.delivery.failed');
    countMetric(`mail.delivery.failed.${message.purpose}`);
    logWarn('mail_delivery_failed', {
      reason: 'smtp_not_configured',
      purpose: message.purpose,
      recipient: maskedRecipient,
    });
    return { sent: false, reason: 'smtp_not_configured', maskedRecipient };
  }

  // ---- 真实发送（失败也要降级，不能 500） ----
  try {
    await deliverViaSmtp(config, message);
    await writeEmailLog({
      maskedRecipient,
      purpose: message.purpose,
      delivered: true,
      skipReason: null,
      userId: message.userId ?? null,
    });
    countMetric('mail.delivery.ok');
    countMetric(`mail.delivery.ok.${message.purpose}`);
    return { sent: true, reason: null, maskedRecipient };
  } catch (error) {
    const reason = `smtp_error:${error instanceof Error ? error.message : 'unknown'}`;
    await writeEmailLog({
      maskedRecipient,
      purpose: message.purpose,
      delivered: false,
      skipReason: reason.slice(0, 128),
      userId: message.userId ?? null,
    });
    // v0.0.8：SMTP 投递失败统计（任务书 §六）
    countMetric('mail.delivery.failed');
    countMetric(`mail.delivery.failed.${message.purpose}`);
    logError(
      'mail_delivery_failed',
      { reason: 'smtp_error', purpose: message.purpose, recipient: maskedRecipient },
      reason.slice(0, 200),
    );
    return { sent: false, reason, maskedRecipient };
  }
}

/**
 * 写入 email_logs。
 *
 * 日志写入本身也不能让请求失败 —— 失败时静默忽略（邮件状态仍如实返回）。
 */
async function writeEmailLog(entry: {
  maskedRecipient: string;
  purpose: MailPurpose;
  delivered: boolean;
  skipReason: string | null;
  userId: number | null;
}): Promise<void> {
  // ⚠️ v0.0.5：日志写入必须有**超时保护**。
  //
  // 原来的 try/catch 只防「抛异常」，**防不住「挂起」** ——
  // 数据库不可用（PG 在 recovery / 连接池耗尽 / 网络分区）时，
  // `await db.insert(...)` 会**无限期等待**，整个 `sendMail()` 跟着挂死。
  //
  // 实测（v0.0.5 SMTP 协议测试）：
  //   - SMTP 侧超时计时器**正常触发**（日志确认 timer FIRED）
  //   - 但 `sendMail` 仍未返回，卡满 30s 被 vitest 杀
  //   - 原因就在这里 —— 超时后 `sendMail` 的 catch 分支要写 `email_logs`，
  //     而那次写入正撞上数据库不可用 ⇒ 永久挂起。
  //
  // 真实影响：**数据库故障时，「忘记密码」请求会永远不返回** ——
  // 用户看到的是无限 loading，而不是错误提示。这是必须修的产品级缺陷。
  //
  // 修法：给日志写入加超时竞速，超时后放弃写日志（主流程继续）。
  await writeEmailLogDetached(entry);
}

/**
 * 把一次挂起的数据库写入**彻底断开**（超时后调用）
 *
 * ## 为什么需要它
 *
 * 上一版的超时保护用 `Promise.race` —— 主流程确实不等了，
 * 但那次 `db.insert()` 仍在**后台挂着**，占着连接池的一个连接。
 * postgres.js 的连接会一直等 PG 响应 ⇒
 *  - 连接池被逐步耗尽
 *  - **进程无法退出**（vitest / Node 都会等这些 pending 句柄）
 *
 * 实测症状：`sendMail` 的超时逻辑已正常触发（日志确认 timer FIRED），
 * 但测试进程仍卡满 30 秒被 vitest 杀掉 —— 卡的不是邮件逻辑，
 * 而是那条挂起的数据库写入。
 *
 * ## 修法
 *
 * 用**独立的一次性客户端**写日志，超时后 `end()` 掉它 ——
 * 断开连接会立即让那条查询失败（而不是永远挂着）。
 * 代价：每次写日志多一次连接（`max: 1`）——
 * 但日志是低频旁路，且只在**主流程已经决定要写**时才发生。
 */
async function writeEmailLogDetached(entry: {
  maskedRecipient: string;
  purpose: MailPurpose;
  delivered: boolean;
  skipReason: string | null;
  userId: number | null;
}): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;

  let client: ReturnType<typeof postgres> | null = null;
  try {
    client = postgres(url, {
      prepare: false,
      max: 1,
      connect_timeout: 5,
      idle_timeout: 5,
    });

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('email_logs 写入超时')),
        EMAIL_LOG_WRITE_TIMEOUT_MS,
      );
      if (typeof timer.unref === 'function') timer.unref();
    });

    try {
      await Promise.race([
        client`
          INSERT INTO email_logs
            (recipient_masked, purpose, delivered, skip_reason, user_id, created_at)
          VALUES
            (${entry.maskedRecipient}, ${entry.purpose}, ${entry.delivered},
             ${entry.skipReason}, ${entry.userId}, now())
        `,
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    /* 日志失败不影响主流程 */
  } finally {
    // ⚠️ 关键：**主动断开**。不这么做，挂起的查询会一直占着连接，
    //    让进程无法退出（实测卡满 30s）。
    if (client) {
      await client.end({ timeout: 1 }).catch(() => undefined);
    }
  }
}

/**
 * 构造密码重置邮件内容。
 */
export function buildPasswordResetEmail(params: {
  username: string;
  resetUrl: string;
  ttlMinutes: number;
}): { subject: string; text: string; html: string } {
  const { username, resetUrl, ttlMinutes } = params;
  const subject = `重置你的 V2EX Clone 密码`;
  const text = [
    `你好 ${username}：`,
    '',
    '我们收到了重置你账号密码的请求。',
    `请在 ${ttlMinutes} 分钟内打开以下链接完成重置：`,
    resetUrl,
    '',
    '如果这不是你本人的操作，请忽略这封邮件，你的密码不会被更改。',
  ].join('\n');

  const html = [
    `<p>你好 ${escapeHtml(username)}：</p>`,
    '<p>我们收到了重置你账号密码的请求。</p>',
    `<p>请在 ${ttlMinutes} 分钟内打开以下链接完成重置：<br />` +
      `<a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>`,
    '<p>如果这不是你本人的操作，请忽略这封邮件，你的密码不会被更改。</p>',
  ].join('');

  return { subject, text, html };
}

/** HTML 转义（邮件正文里插入用户名 / URL 时使用） */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
