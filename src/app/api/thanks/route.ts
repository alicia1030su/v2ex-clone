import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { thankReply, unthankReply, ContentError } from '@/lib/content-service';
import { rateLimitByUser } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/thanks —— 感谢回复
 *
 * body: { replyId: number }
 *
 * 幂等保证：
 *  - thanks 表有 (user_id, reply_id) 唯一索引
 *  - 重复感谢 → duplicated=true，计数不变（不会重复加）
 *  - 不能感谢自己的回复
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as { replyId?: number } | null;
  const replyId = Number(body?.replyId);
  if (!Number.isInteger(replyId) || replyId <= 0) {
    return NextResponse.json({ ok: false, error: '回复 ID 无效' }, { status: 400 });
  }

  const limit = await rateLimitByUser(
    'thanks',
    user.id,
    Number(process.env.RATE_LIMIT_THANKS_MAX ?? 60),
    Number(process.env.RATE_LIMIT_THANKS_WINDOW_SECONDS ?? 300),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `感谢过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const result = await thankReply(user, replyId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[thanks] 感谢失败:', err);
    return NextResponse.json({ ok: false, error: '感谢失败，请重试' }, { status: 500 });
  }
}

/**
 * DELETE /api/thanks —— 取消感谢
 * body: { replyId: number }
 */
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as { replyId?: number } | null;
  const replyId = Number(body?.replyId);
  if (!Number.isInteger(replyId) || replyId <= 0) {
    return NextResponse.json({ ok: false, error: '回复 ID 无效' }, { status: 400 });
  }

  try {
    const result = await unthankReply(user, replyId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[thanks] 取消感谢失败:', err);
    return NextResponse.json({ ok: false, error: '操作失败，请重试' }, { status: 500 });
  }
}
