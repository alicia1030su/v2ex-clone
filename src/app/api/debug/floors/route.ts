import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { checkDebugAccess } from '@/lib/debug-auth';

export const dynamic = 'force-dynamic';

/**
 * 调试辅助接口：返回指定主题的所有楼层号。
 * 用于验证并发回复不产生重复楼层。
 *
 * 安全要求：与 reset-rate-limits 相同 —— 需显式开启 + 令牌鉴权。
 */
export async function GET(request: Request) {
  const denied = checkDebugAccess(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const topicId = Number(url.searchParams.get('topicId') ?? 0);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ error: 'invalid topicId' }, { status: 400 });
  }

  const rows = await db
    .select({ floor: schema.replies.floor })
    .from(schema.replies)
    .where(eq(schema.replies.topicId, topicId))
    .orderBy(schema.replies.floor);

  return NextResponse.json({ floors: rows.map((r) => r.floor) });
}
