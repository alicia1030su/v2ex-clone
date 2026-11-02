import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { rateLimitByUser } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

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
  await db
    .update(schema.users)
    .set({ balance: sql`${schema.users.balance} + 10` })
    .where(eq(schema.users.id, user.id));

  return NextResponse.json({ ok: true, redirect: `/t/${topic.id}` }, { status: 201 });
}
