import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canReviewHiddenNodes } from '@/lib/node-visibility';
import { rateLimitSlidingByIp, rateLimitSlidingByUser } from '@/lib/rate-limit';
import { getTopicById } from '@/server/queries';
import { getReplyContext } from '@/server/reply-threads';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; replyId: string }> },
) {
  const { id, replyId: replyIdRaw } = await params;
  const topicId = Number(id);
  const replyId = Number(replyIdRaw);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }
  if (!Number.isInteger(replyId) || replyId <= 0) {
    return NextResponse.json({ ok: false, error: '回复 ID 无效' }, { status: 400 });
  }

  const user = await getSessionUser();
  const includeDeleted = canReviewHiddenNodes(user);
  const contextLimit = user
    ? await rateLimitSlidingByUser(
        'reply_context',
        user.id,
        Number(process.env.RATE_LIMIT_REPLY_CONTEXT_MAX ?? 60),
        60,
      )
    : await rateLimitSlidingByIp(
        'reply_context',
        Number(process.env.RATE_LIMIT_REPLY_CONTEXT_IP_MAX ?? 120),
        60,
      );
  if (!contextLimit.ok) {
    return NextResponse.json(
      { ok: false, error: `请求过于频繁，请 ${contextLimit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(contextLimit.retryAfterSeconds) } },
    );
  }
  const topic = await getTopicById(topicId, {
    includeHiddenNode: includeDeleted,
    includeDeleted,
  });
  if (!topic) {
    return NextResponse.json({ ok: false, error: '主题不存在' }, { status: 404 });
  }

  const url = new URL(request.url);
  const cursor = Number(url.searchParams.get('cursor') ?? 0);
  const context = await getReplyContext(topicId, replyId, {
    includeDeleted,
    childCursor: Number.isInteger(cursor) && cursor > 0 ? cursor : undefined,
  });
  if (!context) {
    return NextResponse.json({ ok: false, error: '回复不存在或不可见' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...context });
}
