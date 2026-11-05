import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { voteTopic, unvoteTopic, ContentError } from '@/lib/content-service';
import { guardCommunityAction } from '@/lib/community-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/votes —— 主题投票
 *
 * body: { topicId: number, direction: 'up' | 'down' }
 *
 * 幂等保证：
 *  - votes 表有 (user_id, topic_id) 唯一索引
 *  - 重复同向投票 → 返回 duplicated 语义，票数不变
 *  - 改票 → 按差额 ±2 调整汇总
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;
  // v0.0.5：社区动作频率限制（用户 + IP 双维度）
  const rl = await guardCommunityAction('vote', user?.id ?? null);
  if (rl) return rl;

  const body = (await request.json().catch(() => null)) as {
    topicId?: number;
    direction?: string;
  } | null;

  const topicId = Number(body?.topicId);
  const direction = String(body?.direction ?? '');

  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }
  if (direction !== 'up' && direction !== 'down') {
    return NextResponse.json({ ok: false, error: '投票方向必须是 up 或 down' }, { status: 400 });
  }

  try {
    const result = await voteTopic(user, topicId, direction);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[votes] 投票失败:', err);
    return NextResponse.json({ ok: false, error: '投票失败，请重试' }, { status: 500 });
  }
}

/**
 * DELETE /api/votes —— 取消投票
 * body: { topicId: number }
 */
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;
  // v0.0.5：社区动作频率限制（用户 + IP 双维度）
  const rl = await guardCommunityAction('vote', user?.id ?? null);
  if (rl) return rl;

  const body = (await request.json().catch(() => null)) as { topicId?: number } | null;
  const topicId = Number(body?.topicId);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }

  try {
    const result = await unvoteTopic(user, topicId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[votes] 取消投票失败:', err);
    return NextResponse.json({ ok: false, error: '操作失败，请重试' }, { status: 500 });
  }
}
