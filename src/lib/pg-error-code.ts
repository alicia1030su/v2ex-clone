/**
 * 从任意错误对象里取 PostgreSQL 错误码（v0.0.5）
 *
 * ## 为什么需要这个 helper
 *
 * Drizzle ORM 会把 postgres.js 的原始错误包在 `DrizzleQueryError.cause` 里：
 *
 *     err.code        // undefined
 *     err.cause.code  // '23505'（唯一约束冲突）等
 *
 * 直接读 `err.code` **永远取不到** —— 这是 v0.0.5 实测踩到的坑：
 * 举报 API 因此把「重复举报」当成未知错误抛出去 ⇒ 客户端收到 500
 * ⇒ 用户看到「网络错误」而不是「已举报过，正在处理中」。
 *
 * 同时下潜两层（`code` 与 `cause.code`）覆盖两种包裹形态。
 */

/** 任意形状的错误对象 */
type ErrorLike = { code?: unknown; cause?: unknown } | null | undefined;

/** 安全取字符串字段 */
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * 取 PostgreSQL 错误码（SQLSTATE），取不到返回 undefined。
 *
 * 查找顺序：
 *   1. `err.code`
 *   2. `err.cause.code`
 *   3. `err.cause.cause.code`（部分驱动会多层包装）
 */
export function pgErrorCodeOf(err: unknown): string | undefined {
  const direct = str((err as ErrorLike)?.code);
  if (direct) return direct;

  const cause1 = (err as ErrorLike)?.cause as ErrorLike;
  const c1 = str(cause1?.code);
  if (c1) return c1;

  const cause2 = cause1?.cause as ErrorLike;
  const c2 = str(cause2?.code);
  if (c2) return c2;

  return undefined;
}
