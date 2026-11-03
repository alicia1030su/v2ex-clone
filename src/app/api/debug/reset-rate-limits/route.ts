import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { checkDebugAccess } from '@/lib/debug-auth';

export const dynamic = 'force-dynamic';

/**
 * 调试端点：清空限流计数。
 *
 * 安全要求（修复前缺少鉴权，任何人都能清空全站限流）：
 *  - 必须显式开启 ENABLE_DEBUG_ENDPOINTS=1
 *  - 必须携带有效的 DEBUG_ENDPOINT_TOKEN（请求头 X-Debug-Token 或 Bearer）
 *  - 生产环境即便开启也必须配置令牌，否则一律拒绝
 */
export async function POST(request: Request) {
  const denied = checkDebugAccess(request);
  if (denied) return denied;

  await db.execute(sql`DELETE FROM rate_limit_buckets`);
  await db.execute(sql`DELETE FROM kv_store`);
  return NextResponse.json({ ok: true });
}
