import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { adminGuard } from '@/lib/admin-guard';
import { metricsSnapshot } from '@/lib/observability';

/**
 * GET /api/admin/ops —— 运维总览（任务书 §六）
 *
 * 权限：config.view（moderator / admin）
 *
 * 汇总内容：
 *   · 数据库 / Redis 可用性 + 延迟
 *   · 关键接口错误率（进程内计数窗口）
 *   · 异常限流统计（按 scope）
 *   · SMTP 投递成功 / 失败统计
 *   · 慢请求列表（超过阈值）
 *   · 磁盘可用空间（容器内可见时）
 *
 * ## 安全边界
 *
 *   · 只返回**计数与布尔状态**，不返回连接串、版本明细、用户数据；
 *   · 慢请求只给**路由名**（不含参数、不含用户标识）；
 *   · 磁盘信息只给可用比例（不含挂载点路径细节）。
 */

export const dynamic = 'force-dynamic';

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
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: () => null,
    });
    client.on('error', () => {
      /* 由 ping 结果决定 */
    });
    await client.connect();
    const pong = await client.ping();
    const ok = pong === 'PONG';
    client.disconnect();
    return { ok, latencyMs: Date.now() - t0, configured: true };
  } catch {
    return { ok: false, latencyMs: Date.now() - t0, configured: true };
  }
}

/** 磁盘可用比例（容器内 statfs 不可用时返回 null） */
async function checkDisk(): Promise<{ ok: boolean; freeRatio: number | null } | null> {
  try {
    const fs = await import('node:fs/promises');
    const stats = await fs.statfs('/');
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    if (!total) return null;
    return { ok: true, freeRatio: Number((free / total).toFixed(4)) };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const guard = await adminGuard(request, 'config.view');
  if (guard.response) return guard.response;

  const [dbCheck, redisCheck, disk] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkDisk(),
  ]);
  const snap = metricsSnapshot();
  const c = snap.counters;

  /** 从计数里挑出某个前缀的全部键 */
  const byPrefix = (prefix: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(c)) {
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    }
    return out;
  };

  const mailOk = c['mail.delivery.ok'] ?? 0;
  const mailFailed = c['mail.delivery.failed'] ?? 0;

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    dependencies: {
      db: dbCheck,
      redis: redisCheck,
    },
    disk,
    mail: {
      delivered: mailOk,
      failed: mailFailed,
      byPurpose: {
        ok: byPrefix('mail.delivery.ok.'),
        failed: byPrefix('mail.delivery.failed.'),
      },
    },
    rateLimit: {
      checks: c['ratelimit.check'] ?? 0,
      blocked: c['ratelimit.blocked'] ?? 0,
      byScope: byPrefix('ratelimit.blocked.'),
    },
    events: byPrefix('event.'),
    errors: byPrefix('log.error'),
    // ⚠️ v0.0.8：API 请求统计（middleware 埋点 ⇒ 覆盖全部 API）
    api: {
      requests: c['api.request'] ?? 0,
      byStatus: byPrefix('api.status.'),
      errors5xx: c['api.error.5xx'] ?? 0,
      errors4xx: c['api.error.4xx'] ?? 0,
      error5xxByRoute: byPrefix('api.error.5xx.'),
      error4xxByRoute: byPrefix('api.error.4xx.'),
    },
    slowRequests: snap.slowRequests.slice(-20),
  });
}
