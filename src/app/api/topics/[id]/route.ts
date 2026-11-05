import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq, and } from 'drizzle-orm';
import {
  editTopic,
  softDeleteTopic,
  getTopicDetail,
  ContentError,
} from '@/lib/content-service';
import { writeAuditLog, AuditAction } from '@/lib/audit';
import { guardCommunityAction } from '@/lib/community-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/topics/[id] —— 主题详情（含回复列表）
 *
 * 软删除处理：已删除主题对普通访问者返回 404（表现得像不存在），
 * 仅 staff 或作者本人可用 ?includeDeleted=true 看到，并带 deleted 标记。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const topicId = Number(id);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }

  const user = await getSessionUser();
  const url = new URL(request.url);
  const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
  const replyLimit = Number(url.searchParams.get('replyLimit') ?? 100);
  const replyOffset = Number(url.searchParams.get('replyOffset') ?? 0);

  const { topic, replies, replyTotal } = await getTopicDetail(topicId, user, {
    includeDeleted,
    replyLimit: Number.isFinite(replyLimit) ? replyLimit : 100,
    replyOffset: Number.isFinite(replyOffset) ? replyOffset : 0,
  });

  if (!topic) {
    return NextResponse.json({ ok: false, error: '主题不存在' }, { status: 404 });
  }

  // 取作者信息
  const authorRows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
    })
    .from(schema.users)
    .where(eq(schema.users.id, topic.authorId))
    .limit(1);

  // 取当前用户的投票与感谢状态
  let myVote: string | null = null;
  const myThanks: number[] = [];
  if (user) {
    const voteRows = await db
      .select({ direction: schema.votes.direction })
      .from(schema.votes)
      .where(
        and(eq(schema.votes.userId, user.id), eq(schema.votes.topicId, topicId)),
      )
      .limit(1);
    myVote = voteRows[0]?.direction ?? null;

    const thanksRows = await db
      .select({ replyId: schema.thanks.replyId })
      .from(schema.thanks)
      .where(eq(schema.thanks.userId, user.id))
      .limit(500);
    myThanks.push(...thanksRows.map((r) => r.replyId));
  }

  return NextResponse.json({
    ok: true,
    topic: {
      id: topic.id,
      title: topic.title,
      content: topic.content,
      nodeId: topic.nodeId,
      authorId: topic.authorId,
      author: authorRows[0] ?? null,
      status: topic.status,
      repliesCount: topic.repliesCount,
      views: topic.views,
      votes: topic.votes,
      locked: topic.locked,
      pinned: topic.pinned,
      edited: topic.editCount > 0,
      editCount: topic.editCount,
      editedAt: topic.editedAt,
      deleted: topic.deletedAt !== null,
      deletedAt: topic.deletedAt,
      deletedReason: topic.deletedReason,
      lastReplyAt: topic.lastReplyAt,
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt,
    },
    replies: replies.map((r) => ({
      id: r.id,
      topicId: r.topicId,
      authorId: r.authorId,
      content: r.content,
      floor: r.floor,
      thanks: r.thanks,
      quoteId: r.quoteId,
      edited: r.editCount > 0,
      editCount: r.editCount,
      editedAt: r.editedAt,
      deleted: r.deletedAt !== null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    replyTotal,
    myVote,
    myThanks,
  });
}

/**
 * PUT /api/topics/[id] —— 编辑主题
 *
 * 权限：作者本人（受编辑时限）或 moderator/admin。
 * 每次编辑写入 edit_history。
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;
  // v0.0.5：社区动作频率限制（用户 + IP 双维度）
  const rl = await guardCommunityAction('topic_mutation', user?.id ?? null);
  if (rl) return rl;

  const { id } = await params;
  const topicId = Number(id);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    title?: string;
    content?: string;
  } | null;

  if (!body || (body.title === undefined && body.content === undefined)) {
    return NextResponse.json({ ok: false, error: '没有需要修改的内容' }, { status: 400 });
  }

  try {
    const result = await editTopic(user, topicId, {
      title: body.title,
      content: body.content,
    });

    // v0.0.5：补写**操作审计**。
    //
    // ⚠️ `editTopic()` 只写 `edit_history`（内容快照，不可变）——
    //    那是「内容改了什么」，**不是**「谁在什么时候改的」。
    //    任务书 §十一 要求「重要行为审计」；
    //    `AuditAction.TOPIC_EDIT` 此前**定义了却从未被调用**。
    await writeAuditLog(user.id, {
      action: AuditAction.TOPIC_EDIT,
      targetType: 'topic',
      targetId: topicId,
      reason: body.title !== undefined ? '编辑标题' : '编辑正文',
    });

    return NextResponse.json({ ok: true, topic: result });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[topics] 编辑失败:', err);
    return NextResponse.json({ ok: false, error: '编辑失败，请重试' }, { status: 500 });
  }
}

/**
 * DELETE /api/topics/[id] —— 软删除主题
 *
 * 内容保留在库中（可恢复），但普通列表与详情一律不可见。
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;
  // v0.0.5：社区动作频率限制（用户 + IP 双维度）
  const rl = await guardCommunityAction('topic_mutation', user?.id ?? null);
  if (rl) return rl;

  const { id } = await params;
  const topicId = Number(id);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  const reason = typeof body?.reason === 'string' ? body.reason : undefined;

  try {
    const result = await softDeleteTopic(user, topicId, reason);
    // 记录审计（作者自删与管理删除都记录，便于追溯）
    await writeAuditLog(user.id, {
      action: AuditAction.TOPIC_DELETE,
      targetType: 'topic',
      targetId: topicId,
      reason: reason ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[topics] 删除失败:', err);
    return NextResponse.json({ ok: false, error: '删除失败，请重试' }, { status: 500 });
  }
}
