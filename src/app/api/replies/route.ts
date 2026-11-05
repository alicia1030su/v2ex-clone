import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { rateLimitByUser } from '@/lib/rate-limit';
import { grantCredits, creditAmounts } from '@/lib/credit-service';
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
  //
  // ⚠️ v0.0.4 修复楼层跳号（真实压测发现）。
  //   原实现插入时用 `floor: floor + attempt` —— 但 allocateFloor **本身已经
  //   把计数表递增了**，这里再叠加 attempt 的偏移，导致：
  //     - 实际写入的楼层与计数表脱节（写入值永远比计数表小）
  //     - 计数表落后于实际最大楼层 → 下次分配又拿到已被占用的楼层 → 冲突
  //     - 冲突后 ensureFloorCounter 重置计数表 → 循环
  //   实测：连发 5 条回复得到楼层 26、24、22、20、18（**跳号 5 个**）。
  //
  //   现在：**楼层号只由 allocateFloor 分配一次**，插入严格使用该值；
  //   冲突时重新分配（不复用旧值），不再做 +attempt 偏移。
  let inserted = false;
  let replyFloor = 0;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    const floor = await allocateFloor(topicId);
    try {
      const [reply] = await db
        .insert(schema.replies)
        .values({
          topicId,
          authorId: user.id,
          content,
          floor,
        })
        .returning({ id: schema.replies.id });
      inserted = true;
      replyFloor = floor;

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

      // 回复积分（v0.0.4 补齐闭环）
      //
      // ⚠️ 此前**回复完全不给积分** —— 排行榜页与积分规则页都写着
      // 「发布主题与回复都可以获得积分」，但回复路径没有发放逻辑，
      // 属于文档与实现不一致。额度由 REPLY_CREDITS 配置（默认 2），
      // 幂等键保证同一回复不会重复发放。
      await grantCredits(user.id, {
        type: 'reply_created',
        amount: creditAmounts().reply,
        idempotencyKey: `reply_created:${reply.id}`,
        refType: 'reply',
        refId: reply.id,
        reason: '发布回复',
      });
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
        //
        // 此时把计数表抬到「实际最大楼层」的水位，再重新分配。
        //
        // ⚠️ v0.0.4：**不再**用 `floor + attempt` 做偏移试探 ——
        //   偏移会写入与计数表脱节的楼层号，正是跳号的来源。
        //   现在每轮循环都重新调用 allocateFloor 拿一个权威楼层。
        await ensureFloorCounter(topicId);
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
