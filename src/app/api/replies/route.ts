import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { rateLimitByUser } from '@/lib/rate-limit';
import { allocateFloor, ensureFloorCounter } from '@/server/floor';
import { sanitizeRedirect } from '@/lib/redirect';
import { getFormData } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  // CSRF 校验（置于鉴权之后：未登录请求直接 401，不泄露端点存在性）
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

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
    redirect = sanitizeRedirect(body?.redirect);
  } else {
    // 复用 CSRF 校验时已解析的表单数据（Request body 只能读取一次）
    const form = await getFormData(request);
    topicId = Number(form?.get('topicId') ?? 0);
    content = String(form?.get('content') ?? '').trim();
    redirect = sanitizeRedirect(form?.get('redirect'));
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
  let floor = await allocateFloor(topicId);

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
        // 楼层冲突。
        //
        // 计数器与实际楼层不一致时（历史数据导入、seed 写入固定楼层、
        // 计数器表落后），连续 5 个候选楼层可能**全部**已被占用。
        // 此时重新按「实际最大楼层 + 1」分配，而不是继续 +1 试探。
        await ensureFloorCounter(topicId);
        const retryFloor = await allocateFloor(topicId);
        if (retryFloor <= floor + attempt) {
          // 计数表没能抬高水位（并发下被别的请求抢走了），
          // 退回到继续 +1 试探。
          continue;
        }
        // 抬高水位后从新楼层重新开始尝试
        floor = retryFloor;
        attempt = -1; // 下一轮循环 attempt++ 后为 0
        continue;
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
