import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { rateLimitByUser } from '@/lib/rate-limit';
import { grantCredits, creditAmounts } from '@/lib/credit-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  // CSRF 校验（置于鉴权之后：未登录请求直接 401，不泄露端点存在性）
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as {
    nodeId?: number;
    title?: string;
    content?: string;
  } | null;

  const nodeId = Number(body?.nodeId ?? 0);
  const title = (body?.title ?? '').trim();
  const content = (body?.content ?? '').trim();

  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return NextResponse.json({ ok: false, error: '请选择节点' }, { status: 400 });
  }
  if (title.length < 4 || title.length > 128) {
    return NextResponse.json({ ok: false, error: '标题长度需在 4-128 之间' }, { status: 400 });
  }
  if (content.length < 10 || content.length > 50000) {
    return NextResponse.json({ ok: false, error: '正文长度需在 10-50000 之间' }, { status: 400 });
  }

  const limit = await rateLimitByUser(
    'post',
    user.id,
    Number(process.env.RATE_LIMIT_POST_MAX ?? 5),
    Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `发帖过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const nodeRows = await db
    .select({ id: schema.nodes.id, status: schema.nodes.status })
    .from(schema.nodes)
    .where(eq(schema.nodes.id, nodeId))
    .limit(1);
  const node = nodeRows[0];
  if (!node) {
    return NextResponse.json({ ok: false, error: '节点不存在' }, { status: 404 });
  }
  if (node.status !== 'active') {
    return NextResponse.json({ ok: false, error: '该节点不可发布主题' }, { status: 403 });
  }

  const [topic] = await db
    .insert(schema.topics)
    .values({
      title,
      content,
      nodeId,
      authorId: user.id,
    })
    .returning({ id: schema.topics.id });

  await db
    .update(schema.nodes)
    .set({ topicsCount: sql`${schema.nodes.topicsCount} + 1` })
    .where(eq(schema.nodes.id, nodeId));

  // 发布主题给作者加积分
  //
  // ⚠️ v0.0.4 修复（真实缺陷，验收清单 D-06 / B-06）：
  //   原实现直接 `UPDATE users SET balance = balance + 10` ——
  //   **绕过了 credit_ledger 账本**，导致「余额」与「账本累计」永远对不上：
  //   余额多出 10，但账本里没有对应流水。
  //   后果：积分流水页面看不到发帖记录，账本自洽性无法验证，
  //   而且积分额度无法通过环境变量配置（硬编码 10）。
  //
  //   现在改走 grantCredits：
  //   - 写入 credit_ledger 流水（余额与账本永远自洽）
  //   - 额度可配置（TOPIC_CREDITS，默认 5 —— 与 deploy/.env.example 一致）
  //   - 幂等键保证同一主题不会重复发放
  await grantCredits(user.id, {
    type: 'topic_created',
    amount: creditAmounts().topic,
    idempotencyKey: `topic_created:${topic.id}`,
    refType: 'topic',
    refId: topic.id,
    reason: '发布主题',
  });

  return NextResponse.json({ ok: true, redirect: `/t/${topic.id}` }, { status: 201 });
}
