import 'server-only';
import { getKV } from './kv';
import { resolveClientIp } from './client-ip';

export type RateLimitResult = {
  ok: boolean;
  count: number;
  limit: number;
  resetAt: number;
  retryAfterSeconds: number;
};

/**
 * 限流用的客户端 IP。
 *
 * 信任边界见 `src/lib/client-ip.ts`：
 * 默认不采信 x-forwarded-for / x-real-ip（可被客户端伪造），
 * 只用 middleware 注入的内部头；显式设置 TRUST_PROXY_HEADERS=1 时才采信代理头。
 */
async function clientIp(): Promise<string> {
  return resolveClientIp();
}

/**
 * 固定窗口限流。生产用 Redis 原子计数，本地无 Redis 时降级到 PostgreSQL。
 * 返回 retryAfterSeconds 供 429 响应头使用。
 */
export async function rateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const kv = await getKV();
  const key = `ratelimit:${scope}:${identifier}`;
  const { count, resetAt } = await kv.incrWindow(key, windowSeconds);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return { ok: count <= limit, count, limit, resetAt, retryAfterSeconds };
}

export async function rateLimitByIp(
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  return rateLimit(scope, await clientIp(), limit, windowSeconds);
}

export async function rateLimitByUser(
  scope: string,
  userId: number,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  return rateLimit(scope, `u${userId}`, limit, windowSeconds);
}
