import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { restoreReply, ContentError } from '@/lib/content-service';
import { writeAuditLog, AuditAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/replies/[id]/restore —— 恢复被软删除的回复
 *
 * 仅 moderator/admin 可执行；写入 moderation_logs。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const { id } = await params;
  const replyId = Number(id);
  if (!Number.isInteger(replyId) || replyId <= 0) {
    return NextResponse.json({ ok: false, error: '回复 ID 无效' }, { status: 400 });
  }

  try {
    const result = await restoreReply(user, replyId);
    await writeAuditLog(user.id, {
      action: AuditAction.REPLY_RESTORE,
      targetType: 'reply',
      targetId: replyId,
    });
    return NextResponse.json({ ok: true, ...result, message: '回复已恢复' });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[replies/restore] 执行失败:', err);
    return NextResponse.json({ ok: false, error: '操作失败，请重试' }, { status: 500 });
  }
}
