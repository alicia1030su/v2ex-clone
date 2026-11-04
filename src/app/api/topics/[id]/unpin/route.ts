import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { unpinTopic, ContentError } from '@/lib/content-service';
import { writeAuditLog, AuditAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/topics/[id]/unpin
 *
 * 取消置顶。
 * 仅 moderator/admin 可执行；每次操作写入 moderation_logs。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  // CSRF 校验（置于鉴权之后）
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const { id } = await params;
  const topicId = Number(id);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }

  if (user.role !== 'moderator' && user.role !== 'admin') {
    return NextResponse.json({ ok: false, error: '权限不足' }, { status: 403 });
  }

  try {
    const result = await unpinTopic(user, topicId);
    await writeAuditLog(user.id, {
      action: AuditAction.TOPIC_UNPIN,
      targetType: 'topic',
      targetId: topicId,
    });
    return NextResponse.json({ ok: true, ...result, message: '主题已取消置顶' });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[topics/unpin] 执行失败:', err);
    return NextResponse.json({ ok: false, error: '操作失败，请重试' }, { status: 500 });
  }
}
