import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 密码重置令牌的生成与校验
 *
 * ## 安全模型
 *
 * 1. **只存哈希**：数据库里保存的是 sha256(token)，令牌明文只出现在
 *    找回密码的响应给用户的邮件里。数据库泄露也无法直接用于重置密码。
 * 2. **一次性**：使用后写入 usedAt；重放时 usedAt 非空，直接拒绝。
 * 3. **可撤销**：管理员撤销或用户重新申请时写入 revokedAt。
 * 4. **有期限**：expiresAt 到期即失效（默认 60 分钟）。
 * 5. **常量时间比较**：所有比对走 timingSafeEqual，避免通过响应时间
 *    区分「令牌不存在」与「令牌已过期」等状态。
 */

/** 令牌随机字节数 —— 32 字节 = 256 位熵 */
export const RESET_TOKEN_BYTES = 32;

/** 令牌默认有效期（分钟） */
export const RESET_TOKEN_TTL_MINUTES_DEFAULT = 60;

/** 令牌有效期（毫秒），可用 PASSWORD_RESET_TTL_MINUTES 覆盖 */
export function resetTokenTtlMs(): number {
  const raw = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? RESET_TOKEN_TTL_MINUTES_DEFAULT);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : RESET_TOKEN_TTL_MINUTES_DEFAULT;
  return minutes * 60 * 1000;
}

/**
 * 计算令牌的 sha256 十六进制哈希（落库用）。
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * 生成一次性重置令牌。
 *
 * @returns token —— 明文令牌（只通过邮件等带外渠道交给用户）
 *          tokenHash —— 落库用的 sha256 哈希
 *          expiresAt —— 过期时间
 */
export function generateResetToken(): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = randomBytes(RESET_TOKEN_BYTES).toString('hex');
  return {
    token,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(Date.now() + resetTokenTtlMs()),
  };
}

/**
 * 常量时间比较两个哈希。
 *
 * 长度不同时也不会提前返回 —— 用 0 字节补齐到相同长度后再比较，
 * 避免通过响应耗时区分「长度不对」与「内容不对」。
 */
export function constantTimeHashMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  const len = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  bufA.copy(padA);
  bufB.copy(padB);
  return timingSafeEqual(padA, padB);
}

/**
 * 令牌格式校验。
 *
 * 只接受 32 字节随机数生成的 64 位十六进制串 —— 提前拒绝畸形输入，
 * 避免把异常数据带进数据库查询。
 */
export function isWellFormedResetToken(token: unknown): token is string {
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
}
