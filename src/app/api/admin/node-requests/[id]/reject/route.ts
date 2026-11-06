import { NextResponse } from 'next/server';
import { adminGuardWrite } from '@/lib/admin-guard';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { writeAuditLog, AuditAction } from '@/lib/audit';
import { guardCommunityAction } from '@/lib/community-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/node-requests/[id]/reject —— 拒绝节点创建申请
 *
 * 权限：nodes.approve（moderator / admin）
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await adminGuardWrite(request, 'nodes.approve');
  if (guard.response) return guard.response;
  // v0.0.5：管理动作频率限制 —— 防脚本批量滥用（封号 / 改角色 / 调积分…）
  const rl = await guardCommunityAction('admin_action', guard.user?.id ?? null);
  if (rl) return rl;
  const actor = guard.user;

  const { id } = await params;
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ ok: false, error: '申请 ID 无效' }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(schema.nodeRequests)
    .where(eq(schema.nodeRequests.id, requestId))
    .limit(1);
  const req = rows[0];
  if (!req) {
    return NextResponse.json({ ok: false, error: '申请不存在' }, { status: 404 });
  }
  if (req.status !== 'pending') {
    return NextResponse.json({ ok: false, error: '该申请已处理' }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as { note?: string } | null;

  await db
    .update(schema.nodeRequests)
    .set({
      status: 'rejected',
      handledBy: actor.id,
      handledAt: new Date(),
    })
    .where(eq(schema.nodeRequests.id, requestId));

  await writeAuditLog(actor.id, {
    action: AuditAction.NODE_REQUEST_REJECT,
    targetType: 'node_request',
    targetId: requestId,
    reason: body?.note ?? null,
  });

  return NextResponse.json({ ok: true, requestId, status: 'rejected' });
}
