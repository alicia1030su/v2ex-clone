import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

export const dynamic = 'force-dynamic';

/**
 * 调试端点：清空限流计数。
 * 仅在非生产环境暴露，供 E2E 测试在用例之间重置配额。
 */
export async function POST() {
  // 仅在非生产环境，或显式开启 ENABLE_DEBUG_ENDPOINTS=1 时暴露
  const enabled =
    process.env.NODE_ENV !== 'production' || process.env.ENABLE_DEBUG_ENDPOINTS === '1';
  if (!enabled) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  await db.execute(sql`DELETE FROM rate_limit_buckets`);
  await db.execute(sql`DELETE FROM kv_store`);
  return NextResponse.json({ ok: true });
}
