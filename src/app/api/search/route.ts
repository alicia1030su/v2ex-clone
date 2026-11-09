import { NextResponse } from 'next/server';
import { db, schema } from '@/db';
import { and, count, desc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';
import { buildSearchPatterns, buildAndSearchPatterns } from '@/lib/search-tokenize';

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
 *  - limit：每页条数，最大 100（超出被钳制）
 *  - since / until：ISO 时间戳，按创建时间范围过滤
 *
 * ## SQL 安全
 *
 * 关键词通过 drizzle 的 `sql` 模板参数化传入（`${pattern}` 会被转成
 * 占位符 $1），**绝不拼接进 SQL 字符串** —— 因此 `'; DROP TABLE topics; --`
 * 之类的输入只会作为普通文本参与匹配。
 *
 * LIKE 元字符（`%` `_` `\`）也会被转义，避免用户输入的 `%` 变成通配符
 * 从而扫全表。
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
  // 分页上限钳制：limit 最大 100，超出则钳到 100
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const offset = (page - 1) * limit;

  const sort: SearchSort =
    sortParam === 'createdAt' || sortParam === 'repliesCount'
      ? sortParam
      : 'relevance';

  // 关键词为空 → 返回空结果（不报错，也不查库）
  if (!keyword) {
    return NextResponse.json({
      ok: true,
      total: 0,
      page,
      limit,
      totalPages: 1,
      sort,
      results: [],
    });
  }

  const conditions: SQL[] = [
    // 软删除的主题不出现（deleted_at 非空 或 status = 'deleted'）
    isNull(schema.topics.deletedAt),
    ne(schema.topics.status, 'deleted'),
    // v0.0.14 P0-1：隐藏 / 待审节点下的主题同样不出现。
    // 两个查询（列表与 count）都已 join nodes，因此这里可以安全引用 `nodes.status`。
    PUBLIC_NODE_CONDITION,
  ];

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
      conditions.push(sql`${schema.topics.createdAt} >= ${d}`);
    }
  }
  if (untilParam) {
    const d = new Date(untilParam);
    if (!Number.isNaN(d.getTime())) {
      conditions.push(sql`${schema.topics.createdAt} <= ${d}`);
    }
  }

  // ── 关键词匹配（v0.0.5：两阶段中文分词搜索）────────────────────
  //
  // ## 为什么要两阶段
  //
  // 实测（`scripts/perf/search-benchmark.ts`，5000 主题规模）：
  //
  // | 策略 | 召回行数 | P50 | P95 |
  // |---|---|---|---|
  // | ILIKE 整串（v0.0.4 现状） | 60 | **1ms** | 15ms |
  // | bigram **OR**（任一 token 命中） | **5000**（严重假阳性） | 1ms | 1ms |
  // | bigram **AND**（全部 token 命中） | **60**（精度正确） | 15ms | 17ms |
  //
  // bigram OR 的假阳性不可接受（搜「数据库性能优化」会把只含「优化」的
  // 文档全部召回）；bigram AND 精度正确但比整串慢（P50 15ms vs 1ms）。
  //
  // **最终策略**：
  //  1. **先跑 ILIKE 整串** —— 快、命中 trigram 索引
  //  2. **结果为空时回退 bigram AND** —— 慢一点，但能召回「词序被打散」
  //     的中文文档（如「优化…数据库性能」）
  //
  // 这样既不劣化 v0.0.4 的性能，又能提升中文召回。
  //
  // ⚠️ 所有模式都**参数化**传入（drizzle `sql` 模板），
  //    且 LIKE 元字符已转义 ⇒ 无 SQL 注入、无全表扫描。
  const exactPatterns = buildSearchPatterns(keyword);
  const andPatterns = buildAndSearchPatterns(keyword);
  if (exactPatterns.length === 0) {
    // 无法分词（输入全是符号）⇒ 视为无结果
    return NextResponse.json({
      ok: true,
      total: 0,
      page,
      limit,
      items: [],
    });
  }

  // ── 阶段 1：整串匹配（快）──
  const exactConditions = exactPatterns.map(
    (pat) =>
      sql`(${schema.topics.title} ILIKE ${pat} ESCAPE '\\' OR ${schema.topics.content} ILIKE ${pat} ESCAPE '\\')`,
  );
  const exactKeyword = sql`(${exactConditions.reduce((a, b) => sql`(${a} OR ${b})`)})`;
  conditions.push(exactKeyword);

  // 排序用的「标题命中」模式：取**整串**（命中标题 ⇒ 强匹配，排前面）
  const titlePattern = exactPatterns[0];

  const where = and(...conditions);

  // 排序
  const orderBy =
    sort === 'createdAt'
      ? [desc(schema.topics.createdAt), desc(schema.topics.id)]
      : sort === 'repliesCount'
        ? [desc(schema.topics.repliesCount), desc(schema.topics.id)]
        : // relevance：标题命中排在前面，其次按回复数与时间
          [
            desc(
              sql`(CASE WHEN ${schema.topics.title} ILIKE ${titlePattern} ESCAPE '\\' THEN 2 ELSE 1 END)`,
            ),
            desc(schema.topics.repliesCount),
            desc(schema.topics.createdAt),
            desc(schema.topics.id),
          ];

  // ── 阶段 2：结果为空时回退 bigram AND ──────────────────────
  //
  // 中文关键词若在文档里**词序被打散**（「优化…数据库性能」），
  // 阶段 1 的整串匹配会漏掉它们。
  //
  // 实测依据：bigram AND 的召回精度与整串持平（60 行 vs 60 行），
  // 只是慢一点（P50 15ms vs 1ms）——
  // 所以只在**整串完全没结果**时才回退，正常查询路径不受影响。
  //
  // ⚠️ 回退只在「含 CJK 的关键词」时才有意义 ——
  //    纯 ASCII 关键词的 andPatterns 就是整串本身（重复查一次没意义）。
  const fallbackConditions = andPatterns.map(
    (pat) =>
      sql`(${schema.topics.title} ILIKE ${pat} ESCAPE '\\' OR ${schema.topics.content} ILIKE ${pat} ESCAPE '\\')`,
  );
  const hasFallback =
    andPatterns.length > 0 &&
    // AND 语义与整串不同（纯 ASCII 时两者相同 ⇒ 无需回退）
    andPatterns.length !== exactPatterns.length;

  const baseWhere = and(
    ...conditions.slice(0, -1), // 去掉阶段 1 的关键词条件
    ...(hasFallback
      ? []
      : [exactKeyword]),
  );

  const runQuery = async (whereCond: ReturnType<typeof and>) => {
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
      .where(whereCond)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const countRows = await db
      .select({ n: count() })
      .from(schema.topics)
      .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
      .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
      .where(whereCond);

    return { rows, total: Number(countRows[0]?.n ?? 0) };
  };

  // 阶段 1
  let { rows, total } = await runQuery(where);

  // 阶段 2：整串无结果 ⇒ 回退 bigram AND
  if (total === 0 && hasFallback) {
    const andKeyword = sql`(${fallbackConditions.reduce((a, b) => sql`(${a} AND ${b})`)})`;
    const fallbackWhere = and(baseWhere, andKeyword);
    const fallbackResult = await runQuery(fallbackWhere);
    if (fallbackResult.total > 0) {
      rows = fallbackResult.rows;
      total = fallbackResult.total;
    }
  }

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
