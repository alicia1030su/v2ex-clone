import { NextResponse } from 'next/server';
import { adminGuard } from '@/lib/admin-guard';
import { listAuditLogs } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/logs —— 管理员操作日志
 *
 * 权限：logs.view（moderator / admin）
 * 查询参数：action、targetType、targetId、limit、offset
 */
export async function GET(request: Request) {
  const guard = await adminGuard(request, 'logs.view');
  if (guard.response) return guard.response;

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const targetIdParam = url.searchParams.get('targetId');

  const { total, items } = await listAuditLogs({
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
    action: url.searchParams.get('action') ?? undefined,
    targetType: url.searchParams.get('targetType') ?? undefined,
    targetId: targetIdParam ? Number(targetIdParam) : undefined,
  });

  return NextResponse.json({ ok: true, total, logs: items });
}
