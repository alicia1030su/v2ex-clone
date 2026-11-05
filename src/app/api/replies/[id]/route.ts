import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import {
  editReply,
  softDeleteReply,
  ContentError,
} from '@/lib/content-service';
import { writeAuditLog, AuditAction } from '@/lib/audit';
import { guardCommunityAction } from '@/lib/community-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/replies/[id] —— 编辑回复
 *
 * 权限：作者本人（受编辑时限）或 moderator/admin。
 * 每次编辑写入 edit_history（不可变快照）。
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
  const rl = await guardCommunityAction('reply_mutation', user?.id ?? null);
  if (rl) return rl;

  const { id } = await params;
  const replyId = Number(id);
  if (!Number.isInteger(replyId) || replyId <= 0) {
    return NextResponse.json({ ok: false, error: '回复 ID 无效' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { content?: string } | null;
  if (!body || body.content === undefined) {
    return NextResponse.json({ ok: false, error: '没有需要修改的内容' }, { status: 400 });
  }

  try {
    const result = await editReply(user, replyId, { content: body.content });

    // v0.0.5：补写**操作审计**（同主题编辑 —— 详见该文件的注释）
    await writeAuditLog(user.id, {
      action: AuditAction.REPLY_EDIT,
      targetType: 'reply',
      targetId: replyId,
      reason: '编辑回复正文',
    });

    return NextResponse.json({ ok: true, reply: result });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[replies] 编辑失败:', err);
    return NextResponse.json({ ok: false, error: '编辑失败，请重试' }, { status: 500 });
  }
}

/**
 * DELETE /api/replies/[id] —— 软删除回复
 *
 * 内容保留在库中（可恢复），同时同步主题的 replies_count，
 * 保证计数与「实际未删除回复数」始终一致。
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
  const rl = await guardCommunityAction('reply_mutation', user?.id ?? null);
  if (rl) return rl;

  const { id } = await params;
  const replyId = Number(id);
  if (!Number.isInteger(replyId) || replyId <= 0) {
    return NextResponse.json({ ok: false, error: '回复 ID 无效' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  const reason = typeof body?.reason === 'string' ? body.reason : undefined;

  try {
    const result = await softDeleteReply(user, replyId, reason);
    await writeAuditLog(user.id, {
      action: AuditAction.REPLY_DELETE,
      targetType: 'reply',
      targetId: replyId,
      reason: reason ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[replies] 删除失败:', err);
    return NextResponse.json({ ok: false, error: '删除失败，请重试' }, { status: 500 });
  }
}
