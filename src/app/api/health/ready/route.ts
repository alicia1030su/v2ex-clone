import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';

/**
 * 就绪探针（readiness）
 *
 * 语义：**能承接真实流量**才 200 —— 数据库必须可达。
 * Redis 若配置了也应可达；未配置则不参与判定（单库部署合法）。
 *
 * 状态码契约（Docker HEALTHCHECK / 反代健康检查依赖）：
 *   200 = ready（db ok；redis 未配置或 ok）
 *   503 = not ready（db 不可达，或已配置的 redis 不可达）
 *
 * 安全边界（任务书 §六：监控不得泄露敏感信息）：
 *   · 只返回**布尔状态 + 毫秒耗时**，不返回连接串、错误堆栈、
 *     Cookie、令牌、用户数据；
 *   · 不返回数据库/Redis 的版本、库名、IP、端口。
 *
 * 防滥用：结果缓存 2 秒（健康检查的合理精度；Docker 默认 30s 轮询）。
 */

export const dynamic = 'force-dynamic';

const CACHE_MS = 2_000;
let cache: { at: number; body: unknown; status: number } | null = null;

async function checkDb(): Promise<{ ok: boolean; latencyMs: number }> {
  const t0 = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch {
    return { ok: false, latencyMs: Date.now() - t0 };
  }
}

async function checkRedis(): Promise<{ ok: boolean; latencyMs: number; configured: boolean }> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return { ok: true, latencyMs: 0, configured: false };
  const t0 = Date.now();
  // 直连探测（不走 KV 抽象 —— 那层在 Redis 挂了会静默降级到 PG，
  // 运维需要的是「Redis 本身是否活着」的真相）。
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: () => null,
  });
  client.on('error', () => {
    /* 由 ping 结果决定 */
  });
  try {
    await client.connect();
    const pong = await client.ping();
    return { ok: pong === 'PONG', latencyMs: Date.now() - t0, configured: true };
  } catch {
    return { ok: false, latencyMs: Date.now() - t0, configured: true };
  } finally {
    client.disconnect();
  }
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json(cache.body, { status: cache.status });
  }

  const [dbCheck, redisCheck] = await Promise.all([checkDb(), checkRedis()]);
  const ready = dbCheck.ok && redisCheck.ok;

  const body = {
    status: ready ? 'ready' : 'not-ready',
    checks: {
      db: { ok: dbCheck.ok, latencyMs: dbCheck.latencyMs },
      redis: {
        ok: redisCheck.ok,
        latencyMs: redisCheck.latencyMs,
        configured: redisCheck.configured,
      },
    },
  };

  cache = { at: now, body, status: ready ? 200 : 503 };
  return NextResponse.json(body, { status: ready ? 200 : 503 });
}
