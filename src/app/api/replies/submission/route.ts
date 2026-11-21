import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import {
  loadOwnedReplyByClientRequest,
  serializeCreatedReply,
} from '@/server/reply-submissions';

export const dynamic = 'force-dynamic';

const CLIENT_REQUEST_RE = /^[A-Za-z0-9_-]{16,64}$/;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }
  const url = new URL(request.url);
  const topicId = Number(url.searchParams.get('topicId') ?? 0);
  const clientRequestId = (url.searchParams.get('clientRequestId') ?? '').trim();
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }
  if (!CLIENT_REQUEST_RE.test(clientRequestId)) {
    return NextResponse.json({ ok: false, error: '请求标识无效' }, { status: 400 });
  }
  const existing = await loadOwnedReplyByClientRequest(user.id, topicId, clientRequestId);
  if (existing?.conflict) {
    return NextResponse.json({ ok: false, error: '请求标识已用于其它主题' }, { status: 409 });
  }
  if (!existing) {
    return NextResponse.json({ ok: true, found: false });
  }
  const reply = await serializeCreatedReply(existing.id);
  return NextResponse.json({ ok: true, found: true, reply });
}
