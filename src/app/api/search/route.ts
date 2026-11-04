import { NextResponse } from 'next/server';
import { db, schema } from '@/db';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/** 分页上限 —— 防止一次性拉取过多数据 */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export type SearchSort = 'relevance' | 'createdAt' | 'repliesCount';

/**
 * GET /api/search —— 搜索主题
 *
 * 查询参数：
 *  - q：关键词（为空返回空结果，不报错）
 *  - nodeId：按节点过滤
 *  - authorId：按作者过滤
 *  - sort：relevance（默认）| createdAt | repliesCount
 *  - page：从 1 开始
 *  - limit：每页条数，最大 100
 *  - since / until：ISO 时间戳，按创建时间范围过滤
 *
 * ## SQL 安全
 *
 * 关键词通过 drizzle 的 `sql` 模板参数化传入（`${keyword}` 会被转成
 * 占位符 $1），**绝不拼接进 SQL 字符串** —— 因此 `'; DROP TABLE topics; --`
 * 之类的输入只会作为普通文本参与匹配。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const keyword = (url.searchParams.get('q') ?? '').trim();
  const nodeIdParam = url.searchParams.get('nodeId');
  const authorIdParam = url.searchParams.get('authorId');
  const sinceParam = url.searchParams.get('since');
  const untilParam = url.searchParams.get('until');
  const sortParam = url.searchParams.get('sort') ?? 'relevance';

  const page = Math.max(Number(url.searchParams.get('page') ?? 1) || 1, 1);
  const rawLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  // 分页上限钳制
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const offset = (page - 1) * limit;

  const sort: SearchSort =
    sortParam === 'createdAt' || sortParam === 'repliesCount'
      ? sortParam
      : 'relevance';

  // 关键词为空 → 返回空结果（不查库）
  if (!keyword) {
    return NextResponse.json({
      ok: true,
      total: 0,
      page,
      limit,
      results: [],
      sort,
    });
  }

  const conditions: SQL[] = [isNull(schema.topics.deletedAt)];

  if (nodeIdParam !== null && nodeIdParam !== '') {
    const nodeId = Number(nodeIdParam);
    if (Number.isInteger(nodeId) && nodeId > 0) {
      conditions.push(eq(schema.topics.nodeId, nodeId));
    }
  }
  if (authorIdParam !== null && authorIdParam !== '') {
    const authorId = Number(authorIdParam);
    if (Number.isInteger(authorId) && authorId > 0) {
      conditions.push(eq(schema.topics.authorId, authorId));
    }
  }
  if (sinceParam) {
    const d = new Date(sinceParam);
    if (!Number.isNaN(d.getTime())) {
      conditions.push(sql`${schema.topics.createdAt} >= ${d.toISOString()}`);
    }
  }
  if (untilParam) {
    const d = new Date(untilParam);
    if (!Number.isNaN(d.getTime())) {
      conditions.push(sql`${schema.topics.createdAt} <= ${d.toISOString()}`);
    }
  }

  // 关键词匹配：标题权重更高，内容次之 —— 用 ILIKE 参数化匹配
  const pattern = `%${keyword.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  conditions.push(
    sql`(${schema.topics.title} ILIKE ${pattern} ESCAPE '\\' OR ${schema.topics.content} ILIKE ${pattern} ESCAPE '\\')`,
  );

  const where = and(...conditions);

  // 排序
  const orderBy =
    sort === 'createdAt'
      ? desc(schema.topics.createdAt)
      : sort === 'repliesCount'
        ? desc(schema.topics.repliesCount)
        : // relevance：标题命中排在前面，其次按回复数与时间
          [desc(sql`(CASE WHEN ${schema.topics.title} ILIKE ${pattern} ESCAPE '\\' THEN 2 ELSE 1 END)`), desc(schema.topics.repliesCount), desc(schema.topics.createdAt)];

  const rows = await db
    .select({
      id: schema.topics.id,
      title: schema.topics.title,
      content: schema.topics.content,
      nodeId: schema.topics.nodeId,
      nodeName: schema.nodes.name,
      nodeTitle: schema.nodes.title,
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
    .orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy]))
    .limit(limit)
    .offset(offset);

  const countRows = await db
    .select({ id: schema.topics.id })
    .from(schema.topics)
    .where(where);

  const total = countRows.length;

  return NextResponse.json({
    ok: true,
    total,
    page,
    limit,
    totalPages: Math.max(Math.ceil(total / limit), 1),
    sort,
    results: rows.map((r) => ({
      id: r.id,
      title: r.title,
      excerpt: r.content.slice(0, 200),
      node: { id: r.nodeId, name: r.nodeName, title: r.nodeTitle },
      author: { id: r.authorId, username: r.authorName },
      repliesCount: r.repliesCount,
      votes: r.votes,
      createdAt: r.createdAt,
      lastReplyAt: r.lastReplyAt,
    })),
  });
}
