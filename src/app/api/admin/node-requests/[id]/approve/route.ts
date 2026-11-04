import { NextResponse } from 'next/server';
import { adminGuardWrite } from '@/lib/admin-guard';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { writeAuditLog, AuditAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/node-requests/[id]/approve —— 批准节点创建申请
 *
 * 权限：nodes.approve（moderator / admin）
 * 批准时**真正创建节点**，并回填 node_requests.approved_node_id
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await adminGuardWrite(request, 'nodes.approve');
  if (guard.response) return guard.response;
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

  let nodeId = 0;
  await db.transaction(async (tx) => {
    // 节点名唯一 —— 冲突时整个事务回滚
    const created = await tx
      .insert(schema.nodes)
      .values({
        name: req.name,
        title: req.title,
        description: req.description,
        categoryId: req.categoryId,
        createdBy: actor.id,
        status: 'active',
      })
      .returning({ id: schema.nodes.id });
    nodeId = created[0].id;

    await tx
      .update(schema.nodeRequests)
      .set({
        status: 'approved',
        handledBy: actor.id,
        handledAt: new Date(),
        approvedNodeId: nodeId,
      })
      .where(eq(schema.nodeRequests.id, requestId));
  });

  await writeAuditLog(actor.id, {
    action: AuditAction.NODE_REQUEST_APPROVE,
    targetType: 'node_request',
    targetId: requestId,
    reason: body?.note ?? `创建节点 ${req.name}`,
  });

  return NextResponse.json({ ok: true, requestId, nodeId });
}
