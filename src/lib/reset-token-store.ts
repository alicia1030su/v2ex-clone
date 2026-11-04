import 'server-only';
import { db, schema } from '@/db';
import { eq, and, isNull, sql } from 'drizzle-orm';
import {
  generateResetToken,
  hashResetToken,
  isWellFormedResetToken,
  resetTokenTtlMs,
} from '@/lib/reset-token';

/**
 * 密码重置令牌的持久化层
 *
 * 与 `src/lib/reset-token.ts`（纯函数：生成/哈希/常量时间比较）分离，
 * 这里只负责数据库读写。
 *
 * ## 一次性消费的实现
 *
 * 消费用 `UPDATE ... WHERE used_at IS NULL AND revoked_at IS NULL RETURNING`：
 * 并发下只有一个请求能把 used_at 从 NULL 改成非 NULL，
 * 其余请求的 returning 为空 —— 天然防重放，无需额外的锁。
 */

/**
 * 为用户创建重置令牌。
 *
 * 创建前先撤销该用户此前所有未使用令牌 —— 保证只有最新令牌有效。
 */
export async function createResetToken(
  userId: number,
  requestIp?: string,
): Promise<{ token: string; tokenHash: string; expiresAt: Date }> {
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

  const { token, tokenHash, expiresAt } = generateResetToken();

  await db.insert(schema.passwordResetTokens).values({
    userId,
    tokenHash,
    expiresAt,
    requestIp: requestIp ?? null,
  });

  return { token, tokenHash, expiresAt };
}

/** 令牌哈希（sha256 十六进制）—— 与 reset-token.ts 的 hashResetToken 等价 */
export function hashToken(token: string): string {
  return hashResetToken(token);
}

/**
 * 校验并消费一个重置令牌。
 *
 * 校验顺序：格式 → 存在 → 未撤销 → 未使用 → 未过期。
 */
export async function consumeResetToken(
  token: string,
): Promise<{ ok: true; userId: number } | { ok: false; reason: string }> {
  if (!isWellFormedResetToken(token)) {
    return { ok: false, reason: '令牌无效' };
  }

  const tokenHash = hashResetToken(token);

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

  // 原子消费 —— 并发下只有一个请求能成功
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

/** 查询令牌状态（不消费） */
export async function inspectResetToken(
  token: string,
): Promise<
  | { ok: true; userId: number; expiresAt: Date }
  | { ok: false; reason: string }
> {
  if (!isWellFormedResetToken(token)) {
    return { ok: false, reason: '重置链接无效' };
  }
  const rows = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.tokenHash, hashResetToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, reason: '重置链接无效' };
  if (row.revokedAt) return { ok: false, reason: '重置链接已被撤销' };
  if (row.usedAt) return { ok: false, reason: '重置链接已被使用' };
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: '重置链接已过期' };
  }
  return { ok: true, userId: row.userId, expiresAt: row.expiresAt };
}

/** 清理过期令牌（保留 7 天用于审计） */
export async function purgeExpiredTokens(): Promise<number> {
  await db.execute(sql`
    DELETE FROM password_reset_tokens
    WHERE expires_at < now() - interval '7 days'
  `);
  const rows = await db
    .select({ id: schema.passwordResetTokens.id })
    .from(schema.passwordResetTokens)
    .where(
      sql`expires_at < now() - interval '7 days'`,
    );
  return rows.length;
}

export { resetTokenTtlMs };
