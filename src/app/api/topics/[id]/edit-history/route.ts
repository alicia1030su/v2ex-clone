import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { canReviewHiddenNodes, isPublicNodeStatus } from '@/lib/node-visibility';
import { listEditHistory } from '@/lib/content-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/topicss/[id]/edit-history —— 编辑历史
 *
 * 仅内容作者本人或 moderator/admin 可查看。
 * 编辑历史包含编辑前后的完整内容快照，属于敏感信息。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ ok: false, error: 'ID 无效' }, { status: 400 });
  }

  const isStaff = canReviewHiddenNodes(user);

  // 确认内容归属与可见性；隐藏节点下的历史快照只对 staff 开放。
  const rows = await db
    .select({
      authorId: schema.topics.authorId,
      nodeStatus: schema.nodes.status,
    })
    .from(schema.topics)
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(eq(schema.topics.id, targetId))
    .limit(1);

  if (!rows[0]) {
    return NextResponse.json({ ok: false, error: '内容不存在' }, { status: 404 });
  }
  if (!isStaff && !isPublicNodeStatus(rows[0].nodeStatus)) {
    return NextResponse.json({ ok: false, error: '内容不存在' }, { status: 404 });
  }

  if (!isStaff && rows[0].authorId !== user.id) {
    return NextResponse.json({ ok: false, error: '权限不足' }, { status: 403 });
  }

  const history = await listEditHistory('topic', targetId);
  return NextResponse.json({ ok: true, history });
}
