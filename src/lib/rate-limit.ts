import 'server-only';
import { headers } from 'next/headers';
import { getKV } from './kv';

export type RateLimitResult = {
  ok: boolean;
  count: number;
  limit: number;
  resetAt: number;
  retryAfterSeconds: number;
};

async function clientIp(): Promise<string> {
  const hdrs = await headers();
  return (
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    hdrs.get('x-real-ip') ??
    '127.0.0.1'
  );
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
