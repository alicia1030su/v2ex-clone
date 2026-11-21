import 'server-only';
import { countMetric } from '@/lib/observability';
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
  const ok = count <= limit;
  // v0.0.8：异常限流统计（任务书 §六）
  // 埋点放在**这里**而不是各个路由 —— 所有限流都经过这一个函数，
  // 覆盖完整且不会漏（新增路由自动被统计）。
  countMetric('ratelimit.check');
  if (!ok) {
    countMetric('ratelimit.blocked');
    countMetric(`ratelimit.blocked.${scope}`);
  }
  return { ok, count, limit, resetAt, retryAfterSeconds };
}

/**
 * v0.0.19：滑动窗口限流。
 *
 * 与固定窗口的区别：不会在整分钟/整小时边界出现“双倍突发”。
 * 每次命中都保留精确时间戳，只统计最近 windowSeconds 内的请求。
 */
export async function rateLimitSliding(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const kv = await getKV();
  const key = `ratelimit-sliding:${scope}:${identifier}`;
  const { count, resetAt } = await kv.slidingWindow(key, windowSeconds);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  const ok = count <= limit;
  countMetric('ratelimit.sliding.check');
  if (!ok) {
    countMetric('ratelimit.blocked');
    countMetric(`ratelimit.blocked.${scope}`);
  }
  return { ok, count, limit, resetAt, retryAfterSeconds };
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

export async function rateLimitSlidingByUser(
  scope: string,
  userId: number,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  return rateLimitSliding(scope, `u${userId}`, limit, windowSeconds);
}

export async function rateLimitSlidingByIp(
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  return rateLimitSliding(scope, await clientIp(), limit, windowSeconds);
}
