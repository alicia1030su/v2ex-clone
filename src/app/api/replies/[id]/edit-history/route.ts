import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { canReviewHiddenNodes, isPublicNodeStatus } from '@/lib/node-visibility';
import { isPublicTopicState } from '@/lib/content-visibility';
import { listEditHistory } from '@/lib/content-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/repliess/[id]/edit-history —— 编辑历史
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

  // 回复历史包含完整正文快照：非 staff 必须处于公开主题与公开节点下。
  // 已软删除的回复仍允许作者本人查看自己的历史，保持既有授权语义。
  const rows = await db
    .select({
      authorId: schema.replies.authorId,
      topicStatus: schema.topics.status,
      topicDeletedAt: schema.topics.deletedAt,
      nodeStatus: schema.nodes.status,
    })
    .from(schema.replies)
    .innerJoin(schema.topics, eq(schema.topics.id, schema.replies.topicId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(eq(schema.replies.id, targetId))
    .limit(1);

  if (!rows[0]) {
    return NextResponse.json({ ok: false, error: '内容不存在' }, { status: 404 });
  }
  if (!isStaff) {
    const publicTopic = isPublicTopicState({
      status: rows[0].topicStatus,
      deletedAt: rows[0].topicDeletedAt,
    });
    if (!publicTopic || !isPublicNodeStatus(rows[0].nodeStatus)) {
      return NextResponse.json({ ok: false, error: '内容不存在' }, { status: 404 });
    }
  }

  if (!isStaff && rows[0].authorId !== user.id) {
    return NextResponse.json({ ok: false, error: '权限不足' }, { status: 403 });
  }

  const history = await listEditHistory('reply', targetId);
  return NextResponse.json({ ok: true, history });
}
