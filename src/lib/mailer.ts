import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { db, schema } from '@/db';
import { eq, and, isNull, lt, sql } from 'drizzle-orm';

/**
 * 邮件服务（v0.0.3）
 *
 * ## 设计原则
 *
 * 1. **未配置 SMTP 时绝不假装已发送**。
 *    `deliverMail()` 返回 `{ delivered: false, reason }`，
 *    调用方据此显示「邮件服务未配置」的真实状态。
 * 2. **测试环境绝不向真实第三方发信**。
 *    NODE_ENV=test 或 APP_RUNTIME_ENV=test 时，只写入本地 outbox
 *    （email_logs 表 + 进程内数组），供测试断言。
 * 3. **收件人脱敏存储** —— email_logs 只保存脱敏地址与域，
 *    不保存完整邮箱（减少 PII 落库）。
 */

export type MailPurpose = 'password_reset';

export type MailResult =
  | { delivered: true; messageId: string }
  | { delivered: false; reason: string };

/** SMTP 配置（从环境变量读取） */
export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
  /** 未配置时为 null */
} | null;

export function smtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER?.trim() ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || '',
    secure: process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true',
  };
}

/** 是否处于测试环境（禁止真实发信） */
export function isTestEnv(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.APP_RUNTIME_ENV === 'test' ||
    process.env.SMTP_DISABLED === '1'
  );
}

/** 脱敏邮箱：只保留首字母与域名 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const name = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = name.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(name.length - 1, 1))}@${domain}`;
}

/** 进程内 outbox（测试用） */
export const outbox: Array<{
  to: string;
  subject: string;
  body: string;
  at: Date;
}> = [];

/**
 * 发送一封邮件。
 *
 * 未配置 SMTP 或处于测试环境 → 不发送，返回明确的未送达原因。
 */
export async function deliverMail(opts: {
  to: string;
  subject: string;
  body: string;
  purpose: MailPurpose;
  userId?: number;
}): Promise<MailResult> {
  const masked = maskEmail(opts.to);

  // 记录日志（无论是否送达）
  const log = async (delivered: boolean, skipReason: string | null, messageId?: string) => {
    try {
      await db.insert(schema.emailLogs).values({
        recipientMasked: masked,
        purpose: opts.purpose,
        delivered,
        skipReason,
        userId: opts.userId ?? null,
      });
    } catch (err) {
      console.error('[mailer] 写入邮件日志失败', err);
    }
    void messageId;
  };

  if (isTestEnv()) {
    // 测试环境：只进本地 outbox，绝不触碰真实 SMTP 服务器
    outbox.push({ to: opts.to, subject: opts.subject, body: opts.body, at: new Date() });
    await log(false, 'test-env-no-delivery');
    return { delivered: false, reason: '测试环境不发送真实邮件（已进入本地 outbox）' };
  }

  const cfg = smtpConfig();
  if (!cfg) {
    await log(false, 'smtp-not-configured');
    return { delivered: false, reason: '邮件服务未配置（SMTP_HOST 未设置）' };
  }

  try {
    const { sendMailSmtp } = await import('@/lib/smtp-client');
    const result = await sendMailSmtp({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user || undefined,
      pass: cfg.pass || undefined,
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      body: opts.body,
      secure: cfg.secure,
    });

    if (!result.ok) {
      await log(false, 'send-failed');
      return { delivered: false, reason: `邮件发送失败：${result.error}` };
    }
    await log(true, null, result.messageId);
    return { delivered: true, messageId: result.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[mailer] 发送失败:', message);
    await log(false, 'send-failed');
    return { delivered: false, reason: `邮件发送失败：${message}` };
  }
}

/**
 * 生成密码重置令牌。
 *
 * - 明文令牌只返回一次，数据库只存 sha256 哈希
 * - 有效期由 PASSWORD_RESET_TTL_MINUTES 控制，默认 60 分钟
 */
export async function createResetToken(
  userId: number,
  requestIp?: string,
): Promise<{ token: string; expiresAt: Date }> {
  const ttlMinutes = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 60);
  const ttl = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 60;

  // 先撤销该用户此前所有未使用令牌（保证只有最新令牌有效）
  await db
    .update(schema.passwordResetTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.passwordResetTokens.userId, userId),
        isNull(schema.passwordResetTokens.usedAt),
        isNull(schema.passwordResetTokens.revokedAt),
      ),
    );

  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000);

  await db.insert(schema.passwordResetTokens).values({
    userId,
    tokenHash,
    expiresAt,
    requestIp: requestIp ?? null,
  });

  return { token, expiresAt };
}

/** 令牌哈希（sha256 十六进制） */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 校验并消费一个重置令牌。
 *
 * 校验顺序：存在 → 未撤销 → 未使用 → 未过期。
 * 消费用 `UPDATE ... WHERE used_at IS NULL` 保证**并发下只有一个请求能成功**。
 */
export async function consumeResetToken(
  token: string,
): Promise<{ ok: true; userId: number } | { ok: false; reason: string }> {
  if (!token || token.length < 32) {
    return { ok: false, reason: '令牌无效' };
  }
  const tokenHash = hashToken(token);

  const rows = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.tokenHash, tokenHash))
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, reason: '令牌无效或已失效' };
  if (row.revokedAt) return { ok: false, reason: '令牌已被撤销，请重新申请' };
  if (row.usedAt) return { ok: false, reason: '令牌已被使用，请重新申请' };
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: '令牌已过期，请重新申请' };
  }

  // 原子消费：只有把 used_at 从 NULL 改成非 NULL 的那个请求才能成功
  const consumed = await db
    .update(schema.passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.passwordResetTokens.id, row.id),
        isNull(schema.passwordResetTokens.usedAt),
        isNull(schema.passwordResetTokens.revokedAt),
      ),
    )
    .returning({ id: schema.passwordResetTokens.id });

  if (consumed.length === 0) {
    return { ok: false, reason: '令牌已被使用，请重新申请' };
  }

  return { ok: true, userId: row.userId };
}

/** 撤销某用户所有未使用的重置令牌 */
export async function revokeUserTokens(userId: number): Promise<void> {
  await db
    .update(schema.passwordResetTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.passwordResetTokens.userId, userId),
        isNull(schema.passwordResetTokens.usedAt),
        isNull(schema.passwordResetTokens.revokedAt),
      ),
    );
}

/** 清理过期令牌（可由运维定时调用） */
export async function purgeExpiredTokens(): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM password_reset_tokens
    WHERE expires_at < now() - interval '7 days'
  `);
  void res;
  const rows = await db
    .select({ id: schema.passwordResetTokens.id })
    .from(schema.passwordResetTokens)
    .where(lt(schema.passwordResetTokens.expiresAt, new Date(Date.now() - 7 * 86400_000)));
  return rows.length;
}
