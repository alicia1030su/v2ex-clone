import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { rateLimitByUser } from '@/lib/rate-limit';
import { allocateFloor } from '@/server/floor';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const ct = request.headers.get('content-type') ?? '';
  let topicId = 0;
  let content = '';
  let redirect = '/';

  if (ct.includes('application/json')) {
    const body = (await request.json().catch(() => null)) as {
      topicId?: number;
      content?: string;
      redirect?: string;
    } | null;
    topicId = Number(body?.topicId ?? 0);
    content = (body?.content ?? '').trim();
    redirect = body?.redirect ?? '/';
  } else {
    const form = await request.formData();
    topicId = Number(form.get('topicId') ?? 0);
    content = String(form.get('content') ?? '').trim();
    redirect = String(form.get('redirect') ?? '/');
  }

  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }
  if (content.length < 2) {
    return NextResponse.json({ ok: false, error: '回复内容太短' }, { status: 400 });
  }
  if (content.length > 20000) {
    return NextResponse.json({ ok: false, error: '回复内容过长' }, { status: 400 });
  }

  // 资源存在性校验放在限流之前：
  // 对不存在/已锁定主题的请求不应消耗限流配额。
  const topics = await db
    .select()
    .from(schema.topics)
    .where(eq(schema.topics.id, topicId))
    .limit(1);
  const topic = topics[0];
  if (!topic || topic.status === 'deleted') {
    return NextResponse.json({ ok: false, error: '主题不存在' }, { status: 404 });
  }
  if (topic.locked) {
    return NextResponse.json({ ok: false, error: '该主题已锁定，无法回复' }, { status: 403 });
  }

  const limit = await rateLimitByUser(
    'reply',
    user.id,
    Number(process.env.RATE_LIMIT_REPLY_MAX ?? 20),
    Number(process.env.RATE_LIMIT_REPLY_WINDOW_SECONDS ?? 120),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `回复过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  // 分配楼层号：使用独立计数表的原子 UPSERT，避免并发冲突
  const floor = await allocateFloor(topicId);

  let inserted = false;
  let replyFloor = floor;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    try {
      const [reply] = await db
        .insert(schema.replies)
        .values({
          topicId,
          authorId: user.id,
          content,
          floor: floor + attempt,
        })
        .returning({ id: schema.replies.id });
      inserted = true;
      replyFloor = floor + attempt;

      await db
        .update(schema.topics)
        .set({
          repliesCount: sql`${schema.topics.repliesCount} + 1`,
          lastReplyAt: new Date(),
        })
        .where(eq(schema.topics.id, topicId));

      // 通知主题作者
      if (topic.authorId !== user.id) {
        await db.insert(schema.notifications).values({
          userId: topic.authorId,
          type: 'reply',
          actorId: user.id,
          topicId,
          replyId: reply.id,
          message: `${user.username} 回复了你的主题：${topic.title}`,
        });
      }
    } catch (err) {
      // drizzle 会把 Postgres 错误包在 cause 中，需同时检查两层
      const e = err as {
        code?: string;
        constraint_name?: string;
        message?: string;
        cause?: { code?: string; constraint_name?: string; message?: string };
      };
      const code = e.code ?? e.cause?.code;
      const constraint = e.constraint_name ?? e.cause?.constraint_name;
      if (code === '23505' || constraint?.includes('replies_topic_floor')) {
        continue; // 楼层冲突，重试下一个楼层
      }
      console.error('[replies] 插入失败:', {
        code,
        constraint,
        message: e.message ?? e.cause?.message,
        topicId,
        floor: floor + attempt,
        authorId: user.id,
      });
      throw err;
    }
  }

  if (!inserted) {
    return NextResponse.json({ ok: false, error: '回复失败，请重试' }, { status: 500 });
  }

  if (ct.includes('application/json')) {
    return NextResponse.json({ ok: true, redirect });
  }
  return NextResponse.redirect(new URL(redirect, request.url), { status: 303 });
}
