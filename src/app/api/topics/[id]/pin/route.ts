import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { pinTopic, ContentError } from '@/lib/content-service';
import { writeAuditLog, AuditAction } from '@/lib/audit';
import { guardCommunityAction } from '@/lib/community-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/topics/[id]/pin
 *
 * 置顶主题：在节点列表中优先展示。
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
  // v0.0.5：社区动作频率限制（用户 + IP 双维度）
  const rl = await guardCommunityAction('moderation', user?.id ?? null);
  if (rl) return rl;

  const { id } = await params;
  const topicId = Number(id);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }

  if (user.role !== 'moderator' && user.role !== 'admin') {
    return NextResponse.json({ ok: false, error: '权限不足' }, { status: 403 });
  }

  try {
    const result = await pinTopic(user, topicId);
    await writeAuditLog(user.id, {
      action: AuditAction.TOPIC_PIN,
      targetType: 'topic',
      targetId: topicId,
    });
    return NextResponse.json({ ok: true, ...result, message: '主题已置顶' });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[topics/pin] 执行失败:', err);
    return NextResponse.json({ ok: false, error: '操作失败，请重试' }, { status: 500 });
  }
}
