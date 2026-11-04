import { NextResponse } from 'next/server';
import { adminGuard } from '@/lib/admin-guard';
import { db, schema } from '@/db';
import { desc, eq, count } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/node-requests —— 节点创建申请列表
 *
 * 权限：nodes.approve（moderator / admin）
 */
export async function GET(request: Request) {
  const guard = await adminGuard(request, 'nodes.approve');
  if (guard.response) return guard.response;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'pending';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const where =
    status === 'pending' || status === 'approved' || status === 'rejected'
      ? eq(schema.nodeRequests.status, status)
      : undefined;

  const items = await db
    .select()
    .from(schema.nodeRequests)
    .where(where)
    .orderBy(desc(schema.nodeRequests.id))
    .limit(limit)
    .offset(offset);

  const totalRows = await db.select({ n: count() }).from(schema.nodeRequests).where(where);

  return NextResponse.json({
    ok: true,
    total: Number(totalRows[0]?.n ?? 0),
    requests: items,
  });
}
