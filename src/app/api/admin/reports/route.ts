import { NextResponse } from 'next/server';
import { adminGuard } from '@/lib/admin-guard';
import { db, schema } from '@/db';
import { desc, eq, count } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/reports —— 举报列表
 *
 * 权限：reports.view（moderator / admin）
 * 查询参数：status（pending/accepted/rejected，缺省为 pending）、limit、offset
 */
export async function GET(request: Request) {
  const guard = await adminGuard(request, 'reports.view');
  if (guard.response) return guard.response;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'pending';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const where =
    status === 'pending' || status === 'accepted' || status === 'rejected'
      ? eq(schema.reports.status, status)
      : undefined;

  const items = await db
    .select({
      id: schema.reports.id,
      targetType: schema.reports.targetType,
      targetId: schema.reports.targetId,
      reason: schema.reports.reason,
      status: schema.reports.status,
      reporterId: schema.reports.reporterId,
      handledBy: schema.reports.handledBy,
      handledAt: schema.reports.handledAt,
      handleNote: schema.reports.handleNote,
      createdAt: schema.reports.createdAt,
    })
    .from(schema.reports)
    .where(where)
    .orderBy(desc(schema.reports.id))
    .limit(limit)
    .offset(offset);

  const totalRows = await db.select({ n: count() }).from(schema.reports).where(where);

  return NextResponse.json({
    ok: true,
    total: Number(totalRows[0]?.n ?? 0),
    reports: items,
  });
}
