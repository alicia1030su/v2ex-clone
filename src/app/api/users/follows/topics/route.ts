import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/follows/topics —— 我关注用户发布的主题列表
 *
 * 查询参数：limit（默认 30，最大 100）、offset
 */
export async function GET(request: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit') ?? 30);
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 30, 1),
    100,
  );
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  // 被关注用户发布的主题
  //
  // v0.0.14 P0-1：隐藏 / 待审节点下的主题不得出现（与 `/following` 页面同口径）。
  // 注意 total 原来是一段独立原生 SQL，只算 `deleted_at IS NULL AND author_id IN (...)`
  // —— 列表加了节点条件后若不同步修 total，分页会立刻错位（总数比可见行多）。
  const where = and(
    sql`${schema.topics.deletedAt} IS NULL`,
    sql`${schema.topics.authorId} IN (
      SELECT following_id FROM follows WHERE follower_id = ${user.id}
    )`,
    PUBLIC_NODE_CONDITION,
  );

  const rows = await db
    .select({
      id: schema.topics.id,
      title: schema.topics.title,
      content: schema.topics.content,
      nodeId: schema.topics.nodeId,
      nodeName: schema.nodes.name,
      authorId: schema.topics.authorId,
      authorName: schema.users.username,
      repliesCount: schema.topics.repliesCount,
      votes: schema.topics.votes,
      createdAt: schema.topics.createdAt,
      lastReplyAt: schema.topics.lastReplyAt,
    })
    .from(schema.topics)
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(where)
    .orderBy(desc(schema.topics.lastReplyAt))
    .limit(limit)
    .offset(offset);

  const totalRows = await db
    .select({ n: count() })
    .from(schema.topics)
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(where);

  return NextResponse.json({
    ok: true,
    total: Number(totalRows[0]?.n ?? 0),
    topics: rows.map((r) => ({
      id: r.id,
      title: r.title,
      excerpt: r.content.slice(0, 200),
      node: { id: r.nodeId, name: r.nodeName },
      author: { id: r.authorId, username: r.authorName },
      repliesCount: r.repliesCount,
      votes: r.votes,
      createdAt: r.createdAt,
      lastReplyAt: r.lastReplyAt,
    })),
  });
}
