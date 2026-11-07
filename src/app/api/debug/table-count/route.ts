import { NextResponse } from 'next/server';
import { count } from 'drizzle-orm';
import { db, schema } from '@/db';
import { checkDebugAccess } from '@/lib/debug-auth';
import { extractRows } from '@/server/sql-rows';

export const dynamic = 'force-dynamic';

/**
 * 调试端点：读取指定表的**行数**（v0.0.9 新增）
 *
 * ## 为什么需要它
 *
 * 任务书 §五 要求「每项操作必须验证**真实数据库变化**，而不只是 HTTP 200」。
 * 既有 E2E 大多只断言 UI 文本或元素可见 —— 无法区分
 * 「数据真的落库了」与「接口返回了 200 但什么都没写」。
 *
 * 本端点提供**行数读数**，让 E2E 可以断言
 * 「操作前 N → 操作后 N+1」⇒ 证明数据确实落库。
 *
 * ## 安全边界
 *
 *   · 必须通过 `checkDebugAccess`（需 ENABLE_DEBUG_EXPOINTS=1
 *     **且**携带有效令牌）—— 生产环境默认 404；
 *   · **只返回行数**，不返回任何行内容、用户数据、连接串；
 *   · 表名走**白名单**（下表），不接受任意表名 ——
 *     否则就等于开放了「探测任意表是否存在」与「统计任意表规模」的能力。
 *
 * ## ⚠️ 为什么用 drizzle 查询构造器而不是原始 SQL 拼接（v0.0.9 CI 实测教训）
 *
 * 初版是**直接拼接表名执行原始 SQL**，被本仓的**安全守卫**
 * `tests/v005-security-audit.spec.ts`（「没有未经参数化的 SQL 拼接」）
 * 直接判红 —— CI 失败。
 *
 * 该守卫的立场是对的：原始 SQL 拼接是**未经参数化的 SQL 拼接**，
 * 即便表名来自白名单，也属于「靠约束而非靠机制保证安全」的做法。
 *
 * 现在改为**用 drizzle 的查询构造器**逐表映射 —— 表名在**编译期**就
 * 固定成 schema 引用，**根本不存在运行时拼接** ⇒ 天然参数化，
 * 且守卫通过。
 *
 * ## 白名单
 *
 * 只包含**验证用户行为所需**的表。刻意**不含**
 * `sessions` / `password_reset_tokens` / `login_attempts` ——
 * 它们与业务验收无关，纳入只会扩大暴露面。
 */
const ALLOWED_TABLES = {
  users: schema.users,
  topics: schema.topics,
  replies: schema.replies,
  collections: schema.collections,
  thanks: schema.thanks,
  votes: schema.votes,
  notifications: schema.notifications,
  credit_ledger: schema.creditLedger,
  moderation_logs: schema.moderationLogs,
  node_requests: schema.nodeRequests,
  reports: schema.reports,
  follows: schema.follows,
  avatars: schema.avatars,
} as const;

type AllowedTable = keyof typeof ALLOWED_TABLES;

export async function GET(request: Request) {
  const denied = checkDebugAccess(request);
  if (denied) return denied;

  const requested = new URL(request.url).searchParams.get('table') ?? '';

  if (!(requested in ALLOWED_TABLES)) {
    return NextResponse.json(
      { error: 'unknown table', allowed: Object.keys(ALLOWED_TABLES) },
      { status: 400 },
    );
  }

  const table = requested as AllowedTable;
  const rows = extractRows<{ n: number }>(
    await db.select({ n: count() }).from(ALLOWED_TABLES[table]),
  );

  return NextResponse.json({ ok: true, table, count: Number(rows[0]?.n ?? 0) });
}
