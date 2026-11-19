import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { adminGuard } from '@/lib/admin-guard';
import { metricsSnapshot } from '@/lib/observability';
import { extractRows } from '@/server/sql-rows';

/**
 * GET /api/admin/ops —— 运维总览（任务书 §六）
 *
 * 权限：**ops.view（仅 admin）**
 *
 * ⚠️ v0.0.17：原为 `config.view`（moderator / admin）。
 *    运维总览含**进程内指标、依赖健康、磁盘容量、错误路由分布** ——
 *    属基础设施面而非内容治理面，且可被用来试探系统边界 ⇒ 收紧为 admin-only。
 *
 * 汇总内容：
 *   · 数据库 / Redis 可用性 + 延迟
 *   · 关键接口错误率（进程内计数窗口）
 *   · 异常限流统计（按 scope）
 *   · SMTP 投递成功 / 失败统计
 *   · 慢请求列表（超过阈值）
 *   · 磁盘可用空间（容器内可见时）
 *
 * ## ⚠️ 口径（v0.0.17 新增，必须与界面同时呈现）
 *
 * 本接口的**计数类**指标来自 `src/lib/observability.ts`，存储在**进程内**
 * （`globalThis`）。这带来两个必须说清的限制：
 *
 *   1. **只覆盖本进程**：若以多副本 / 多进程（cluster、PM2、k8s replicas）
 *      部署，每个实例各自计数，**本接口返回的不是集群总量**；
 *   2. **累加窗口是「进程启动至今」**：重启即清零，没有历史时间序列。
 *
 * 因此响应里**显式**带 `scope` 字段（`process` + `instanceId` + `startedAt`
 * + `uptimeSeconds`），并附 `warnings` 文案 —— 让界面**没有机会**把
 * 「本进程计数」呈现成「全站总量」。这不是注释，是接口契约：
 * 前端若忽略 `scope`，测试会判红。
 *
 * 与之相对，`dependencies`（DB / Redis ping 与延迟）、`disk`、
 * `postgres`（连接数与状态）都是**每次请求实时测量**的，不存在累计口径问题。
 *
 * ## 安全边界
 *
 *   · 只返回**计数与布尔状态**，不返回连接串、版本明细、用户数据；
 *   · 慢请求只给**路由名**（不含参数、不含用户标识）；
 *   · 磁盘信息只给可用比例（不含挂载点路径细节）。
 */

export const dynamic = 'force-dynamic';

/**
 * 进程身份 —— 用于让运维界面能区分「这是哪个实例」
 *
 * ⚠️ 为什么需要：只看 `requests=12345` 无法判断它是本进程的还是集群的。
 * 带上 instanceId / pid / startedAt / uptimeSeconds 之后，
 * 「重启后计数归零」「多副本时每台数字不同」这两件事才**可被观测**。
 *
 * 不返回主机名与 IP：那属于基础设施敏感信息，对判断口径没有帮助。
 */
const PROCESS_STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000));

function instanceId(): string {
  // 只用 pid + 启动时间派生，不含主机信息
  const seed = `${process.pid}-${PROCESS_STARTED_AT.toISOString()}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `p${h.toString(36)}`;
}

/**
 * PostgreSQL 连接与状态（实时查询，非累计）
 *
 * 只用 `pg_stat_activity` 的**聚合值**：连接数按状态分组。
 * 不返回 `query` / `client_addr` / `usename` —— 那些会泄露用户与语句内容。
 */
async function checkPostgresDetail(): Promise<
  | { ok: true; total: number; active: number; idle: number; idleInTransaction: number; maxConnections: number }
  | { ok: false; reason: string }
> {
  try {
    const res = await db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE state = 'active')::int AS active,
        count(*) FILTER (WHERE state = 'idle')::int AS idle,
        count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_tx,
        current_setting('max_connections')::int AS max_conn
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);
    // ⚠️ 用仓库统一的 `extractRows`：postgres-js 直接返回行数组，
    //    直读 `res.rows` 会得到 undefined（本仓已记录过这个坑）。
    const rows = extractRows<Record<string, unknown>>(res);
    const r = rows[0];
    if (!r) return { ok: false, reason: 'no_rows' };
    return {
      ok: true,
      total: Number(r.total ?? 0),
      active: Number(r.active ?? 0),
      idle: Number(r.idle ?? 0),
      idleInTransaction: Number(r.idle_in_tx ?? 0),
      maxConnections: Number(r.max_conn ?? 0),
    };
  } catch {
    return { ok: false, reason: 'query_failed' };
  }
}

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
  const guard = await adminGuard(request, 'ops.view');
  if (guard.response) return guard.response;

  const [dbCheck, redisCheck, disk, pgDetail] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkDisk(),
    checkPostgresDetail(),
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

  /**
   * ⚠️ 备份状态：**没有真实数据源**（v0.0.17 实测）
   *
   * `backup.sh` 在**宿主机**上执行，产物落在宿主机的 `deploy/backups/`；
   * 应用容器内看不到该目录（compose 未挂载），也没有任何「最近一次备份
   * 成功时间」的落盘记录。
   *
   * ⇒ 这里**显式返回 `available: false` 与原因**，而不是编一个
   *   「上次备份：刚刚成功」。界面必须据此显示「无数据源」，不得展示假状态。
   */
  const backup = {
    available: false as const,
    reason: 'no_data_source' as const,
    detail:
      '备份由宿主机 deploy/backup.sh 执行，产物在宿主机目录；应用容器内不可见，' +
      '且没有「最近成功时间」落盘记录。故本面板不展示备份状态。',
  };

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    /**
     * 指标口径（**接口契约**，前端必须据此措辞）
     * - scope = process ⇒ 计数只覆盖本进程，不是集群总量
     * - window = since-start ⇒ 累加窗口是「进程启动至今」，重启清零
     */
    scope: {
      metrics: 'process' as const,
      window: 'since-start' as const,
      instanceId: instanceId(),
      pid: process.pid,
      startedAt: PROCESS_STARTED_AT.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      /**
       * 是否可能为多实例部署 —— 由环境变量显式声明，**不猜测**。
       * 未声明时返回 null（未知），界面据此提示「多副本时请逐实例核对」。
       */
      replicasDeclared: process.env.APP_REPLICAS ? Number(process.env.APP_REPLICAS) : null,
    },
    warnings: [
      '本面板的请求/状态码/错误计数来自**当前进程**，不是集群总量。',
      '多副本部署时，每个实例各自计数；请逐实例查看。',
      '计数窗口为「进程启动至今」，进程重启即归零。',
    ],
    dependencies: {
      db: dbCheck,
      redis: redisCheck,
      postgres: pgDetail,
    },
    backup,
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
