import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';
import { getSessionUser } from '@/lib/auth';
import { guardCommunityAction } from '@/lib/community-rate-limit';

export const dynamic = 'force-dynamic';

/** 收藏 / 取消收藏 主题或节点 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  // CSRF 校验（置于鉴权之后：未登录请求直接 401，不泄露端点存在性）
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;
  // v0.0.5：社区动作频率限制（用户 + IP 双维度）
  const rl = await guardCommunityAction('collection', user?.id ?? null);
  if (rl) return rl;

  const body = (await request.json().catch(() => null)) as {
    target?: 'topic' | 'node';
    id?: number;
    action?: 'add' | 'remove';
  } | null;

  const target = body?.target;
  const id = Number(body?.id ?? 0);
  const action = body?.action ?? 'add';

  if ((target !== 'topic' && target !== 'node') || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: '参数无效' }, { status: 400 });
  }

  // ── 目标存在性 + 可见性校验（v0.0.14 P0-1）────────────────────
  //
  // 收藏是一个**写入**动作，但它的错误语义会泄露信息：
  // 若只校验「行存在」，用户就能通过「收藏成功 / 失败」探测出
  // 隐藏节点及其主题的存在性。因此这里统一要求目标**对公共访问者可见**，
  // 不可见一律按「不存在」返回 404 —— 与详情页的 notFound 口径一致。
  //
  // 校验用 **join 一次查完**（不是先查 topic 再查 node 的 N+1）：
  //   target='topic' ⇒ topics ⋈ nodes，节点必须 active；
  //   target='node'  ⇒ nodes，节点本身必须 active。
  if (target === 'topic') {
    const exists = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
      .where(and(eq(schema.topics.id, id), PUBLIC_NODE_CONDITION))
      .limit(1);
    if (!exists.length) {
      return NextResponse.json({ ok: false, error: '主题不存在' }, { status: 404 });
    }
  } else {
    const exists = await db
      .select({ id: schema.nodes.id })
      .from(schema.nodes)
      .where(and(eq(schema.nodes.id, id), PUBLIC_NODE_CONDITION))
      .limit(1);
    if (!exists.length) {
      return NextResponse.json({ ok: false, error: '节点不存在' }, { status: 404 });
    }
  }

  if (action === 'remove') {
    await db
      .delete(schema.collections)
      .where(
        and(
          eq(schema.collections.userId, user.id),
          target === 'topic'
            ? eq(schema.collections.topicId, id)
            : eq(schema.collections.nodeId, id),
        ),
      );
    return NextResponse.json({ ok: true, collected: false });
  }

  await db
    .insert(schema.collections)
    .values({
      userId: user.id,
      target,
      topicId: target === 'topic' ? id : null,
      nodeId: target === 'node' ? id : null,
    })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true, collected: true });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, items: [] });

  const url = new URL(request.url);
  const target = url.searchParams.get('target') as 'topic' | 'node' | null;
  const id = Number(url.searchParams.get('id') ?? 0);

  if (!target || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, items: [] });
  }

  const rows = await db
    .select({ id: schema.collections.id })
    .from(schema.collections)
    .where(
      and(
        eq(schema.collections.userId, user.id),
        target === 'topic'
          ? eq(schema.collections.topicId, id)
          : eq(schema.collections.nodeId, id),
      ),
    );

  return NextResponse.json({ ok: true, items: rows.map((r) => r.id) });
}
