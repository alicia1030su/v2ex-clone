import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { getKV } from '@/lib/kv';
import { checkDebugAccess } from '@/lib/debug-auth';

export const dynamic = 'force-dynamic';

/**
 * 调试端点：清空限流计数。
 *
 * 安全要求（修复前缺少鉴权，任何人都能清空全站限流）：
 *  - 必须显式开启 ENABLE_DEBUG_ENDPOINTS=1
 *  - 必须携带有效的 DEBUG_ENDPOINT_TOKEN（请求头 X-Debug-Token 或 Bearer）
 *  - 生产环境即便开启也必须配置令牌，否则一律拒绝
 *
 * 重要（修复前的第二个缺陷）：
 *   限流计数器的存储位置取决于配置 ——
 *     - 配置了 REDIS_URL → 计数在 **Redis** 里
 *     - 未配置 → 降级到 **PostgreSQL** 的 rate_limit_buckets / kv_store 表
 *   原实现只删数据库的表，于是「配了 Redis」时清空限流**静默失效** ——
 *   调试端点返回 200，但配额一点没清。
 *   这会让 E2E 用例在 CI（配了 Redis）里因限流而失败，
 *   而本地（无 Redis）却完全正常 —— 一个典型的「环境差异掩盖缺陷」。
 *
 *   现在改为通过 KV 抽象的 clearAll() 清理当前**实际生效**的后端。
 */
export async function POST(request: Request) {
  const denied = checkDebugAccess(request);
  if (denied) return denied;

  const kv = await getKV();
  await kv.clearAll();

  // PostgreSQL 侧的表也一并清掉。
  // Redis 模式下这两张表本来就没有数据，清了无害；
  // 降级模式下 clearAll 已经清过，再清一次保证幂等。
  await db.execute(sql`DELETE FROM rate_limit_buckets`);
  await db.execute(sql`DELETE FROM kv_store`);

  return NextResponse.json({ ok: true });
}
