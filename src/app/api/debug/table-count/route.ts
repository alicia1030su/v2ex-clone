import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
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
 *   · 必须通过 `checkDebugAccess`（需 ENABLE_DEBUG_ENDPOINTS=1
 *     **且**携带有效令牌）—— 生产环境默认 404；
 *   · **只返回行数**，不返回任何行内容、用户数据、连接串；
 *   · 表名走**白名单**（下表），不接受任意表名 ——
 *     否则就等于开放了「探测任意表是否存在」与「统计任意表规模」的能力。
 *
 * ## 白名单
 *
 * 只包含**验证用户行为所需**的表。刻意**不含**
 * `sessions` / `password_reset_tokens` / `login_attempts` ——
 * 它们与业务验收无关，纳入只会扩大暴露面。
 */
const ALLOWED_TABLES = new Set([
  'users',
  'topics',
  'replies',
  'collections',
  'thanks',
  'votes',
  'notifications',
  'credit_ledger',
  'moderation_logs',
  'node_requests',
  'reports',
  'follows',
  'avatars',
]);

export async function GET(request: Request) {
  const denied = checkDebugAccess(request);
  if (denied) return denied;

  const table = new URL(request.url).searchParams.get('table') ?? '';

  if (!ALLOWED_TABLES.has(table)) {
    return NextResponse.json(
      { error: 'unknown table', allowed: [...ALLOWED_TABLES] },
      { status: 400 },
    );
  }

  // 表名来自上面的白名单（不是用户输入），因此拼接是安全的。
  //
  // ⚠️ 必须用 `extractRows` 取行 —— 不同 driver 的 execute 返回结构不同
  // （postgres-js 直接返回行数组；node-postgres 返回 { rows }）。
  // 实测踩到：直接读 `res.rows` ⇒ postgres-js 下拿到 undefined ⇒ 计数恒为 0
  // （而表里明明有 5 行）。
  const res = await db.execute(sql.raw(`select count(*)::int as n from "${table}"`));
  const rows = extractRows<{ n: number }>(res);
  const count = Number(rows[0]?.n ?? 0);

  return NextResponse.json({ ok: true, table, count });
}
