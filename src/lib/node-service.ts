import 'server-only';
import { db, schema } from '@/db';
import { and, eq, isNull, sql, asc, desc, type SQL } from 'drizzle-orm';
import { extractRows } from '@/server/sql-rows';

/**
 * 节点服务层（v0.0.3）
 *
 * 提供节点分类、子节点、面包屑、主题数与最新回复统计 —— 页面与 API 共用同一套逻辑，
 * 避免各处重复查询导致统计口径不一致。
 */

export type NodeWithStats = {
  id: number;
  name: string;
  title: string;
  description: string | null;
  avatar: string | null;
  categoryId: number | null;
  parentId: number | null;
  status: string;
  /** 未删除的主题数（实时统计，不依赖可能滞后的缓存字段） */
  topicsCount: number;
  /** 最新回复时间 */
  lastReplyAt: Date | null;
};

/**
 * 查询节点列表（含统计）。
 *
 * 参数：
 *  - categoryId：只取该分类下的节点
 *  - parentId：只取该父节点下的子节点
 *  - includeHidden：staff 可包含被隐藏的节点
 */
export async function listNodes(opts: {
  categoryId?: number;
  parentId?: number;
  includeHidden?: boolean;
  limit?: number;
  offset?: number;
} = {}): Promise<NodeWithStats[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  // ⚠️ WHERE 条件必须用原生 SQL 片段，不能用 drizzle 的 eq()/and()。
  //
  // 原因：下面的原生 SQL 用 `FROM nodes n` 起了别名，而 drizzle 的 eq()
  // 生成的是 `"nodes"."status" = $1` —— 一旦 FROM 有了别名，
  // PostgreSQL 就不再允许用原表名引用该 FROM 项（错误码 42P01
  // 「对于表 "nodes" 的 FROM 子句项的引用无效」）。
  //
  // v0.0.3 的这个 bug 让 GET /api/nodes 在生产构建下**必然 500**，
  // 但单元测试与 E2E 都没有覆盖该端点，因此长期未被发现。
  const conditions: SQL[] = [];
  if (opts.categoryId !== undefined) {
    conditions.push(sql`n.category_id = ${opts.categoryId}`);
  }
  if (opts.parentId !== undefined) {
    conditions.push(sql`n.parent_id = ${opts.parentId}`);
  }
  if (!opts.includeHidden) {
    conditions.push(sql`n.status = 'active'`);
  }
  const where =
    conditions.length > 0
      ? sql`WHERE ${conditions.reduce((acc, c) => sql`${acc} AND ${c}`)}`
      : sql``;

  // 统计用**聚合 + JOIN**（每张表只扫一次），而不是逐节点的相关子查询。
  //
  // ⚠️ v0.0.4 性能修复（真实压测发现，1000 节点 / 10 万主题 / 100 万回复）：
  //   原实现对**每个节点**执行一次
  //     (SELECT max(r.created_at) FROM replies r JOIN topics t2 ...)
  //   → 200 个节点就是 200 次 JOIN，EXPLAIN 实测 **411ms**。
  //
  //   关键洞察：topics.last_reply_at **本身就是汇总字段**（发/回帖时维护），
  //   节点的「最后回复时间」= 该节点所有主题的 last_reply_at 的最大值 ——
  //   **不需要去 join replies**。
  //   实测：411ms → **40.6ms**（约 10 倍）。
  const rows: Array<Record<string, unknown>> = await db.execute(sql`
    WITH tc AS (
      SELECT node_id, count(*)::int AS topics_count
      FROM topics WHERE deleted_at IS NULL GROUP BY node_id
    ),
    lr AS (
      SELECT node_id, max(last_reply_at) AS last_reply_at
      FROM topics WHERE deleted_at IS NULL GROUP BY node_id
    )
    SELECT
      n.id, n.name, n.title, n.description, n.avatar,
      n.category_id, n.parent_id, n.status,
      COALESCE(tc.topics_count, 0)::int AS topics_count,
      lr.last_reply_at
    FROM nodes n
    LEFT JOIN tc ON tc.node_id = n.id
    LEFT JOIN lr ON lr.node_id = n.id
    ${where}
    ORDER BY n.title ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const list = rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    title: String(r.title),
    description: r.description === null ? null : String(r.description),
    avatar: r.avatar === null ? null : String(r.avatar),
    categoryId: r.category_id === null ? null : Number(r.category_id),
    parentId: r.parent_id === null ? null : Number(r.parent_id),
    status: String(r.status),
    topicsCount: Number(r.topics_count ?? 0),
    lastReplyAt: r.last_reply_at ? new Date(String(r.last_reply_at)) : null,
  }));

  return list;
}

/**
 * 面包屑：从根节点到当前节点的路径。
 *
 * 节点表有 parentId 字段，实现父链可能有环 —— 这里限制最多 10 层，
 * 防止脏数据导致无限循环。
 */
export async function nodeBreadcrumb(nodeId: number): Promise<
  Array<{ id: number; name: string; title: string }>
> {
  const path: Array<{ id: number; name: string; title: string }> = [];
  const seen = new Set<number>();
  // 显式标注类型，断开 currentId ↔ row.parentId 的类型推断循环
  let currentId: number | null = nodeId;

  for (let depth = 0; depth < 10 && currentId !== null; depth++) {
    if (seen.has(currentId)) break; // 环检测
    seen.add(currentId);

    const rows: Array<{
      id: number;
      name: string;
      title: string;
      parentId: number | null;
    }> = await db
      .select({
        id: schema.nodes.id,
        name: schema.nodes.name,
        title: schema.nodes.title,
        parentId: schema.nodes.parentId,
      })
      .from(schema.nodes)
      .where(eq(schema.nodes.id, currentId))
      .limit(1);

    const row: { id: number; name: string; title: string; parentId: number | null } | undefined =
      rows[0];
    if (!row) break;
    path.unshift({ id: row.id, name: row.name, title: row.title });
    currentId = row.parentId;
  }

  return path;
}

/** 查询单个节点（按名称），不含隐藏节点（除非 staff 显式要求） */
export async function getNodeByName(
  name: string,
  includeHidden = false,
): Promise<typeof schema.nodes.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.nodes)
    .where(eq(schema.nodes.name, name.toLowerCase()))
    .limit(1);
  const node = rows[0] ?? null;
  if (!node) return null;
  if (node.status !== 'active' && !includeHidden) return null;
  return node;
}

/**
 * 分类列表（含各分类的节点数）—— 供 `GET /api/nodes?withCategories=true` 使用
 *
 * ## v0.0.14 修复的两个真实缺陷
 *
 * 1. **查询必然 500**：旧实现 `SELECT c.description`，而 `categories` 表
 *    **没有 description 列**（v0.0.1 建表起就没有）。
 *    PostgreSQL 报 42703「column c.description does not exist」⇒
 *    该端点在生产构建下必然 500。因为没有任何前端调用它，长期未被发现。
 *    这里删掉该列；返回结构同步移除 `description`（端点此前 100% 失败，
 *    不存在依赖旧结构的调用方）。
 * 2. **已禁用的分类仍会出现在公共接口里**：v0.0.14 引入 `categories.hidden`，
 *    禁用语义是「公共页面不展示，但数据与节点归属保留」。
 *    因此这里必须 `WHERE c.hidden = false` —— 否则后台点了「禁用」，
 *    `/api/nodes?withCategories=true` 仍会把该分类吐给前端。
 *
 * 排序改为 `sort, id`，与 `/nodes` 页面（`src/server/categories.ts`
 * 的 `listPublicCategories`）保持**同一口径** —— 两处排序不一致会让
 * 「页面上的顺序」与「接口给的顺序」对不上。
 *
 * 需要**含禁用分类**的后台场景请用 `src/server/categories.ts` 的
 * `listAllCategories()`（带 nodesCount，一次聚合查询）。
 */
export async function listCategories() {
  const result = await db.execute(sql`
    SELECT
      c.id, c.name, c.title, c.sort, c.hidden,
      (
        SELECT count(*)::int FROM nodes n
        WHERE n.category_id = c.id AND n.status = 'active'
      ) AS nodes_count
    FROM categories c
    WHERE c.hidden = false
    ORDER BY c.sort ASC, c.id ASC
  `);

  return extractRows<Record<string, unknown>>(result).map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    title: String(r.title),
    sort: Number(r.sort ?? 0),
    hidden: r.hidden === true || r.hidden === 't',
    nodesCount: Number(r.nodes_count ?? 0),
  }));
}

/**
 * 节点收藏统计（某节点被多少用户收藏）。
 */
export async function nodeCollectCount(nodeId: number): Promise<number> {
  const rows: Array<{ n: number }> = await db.execute(sql`
    SELECT count(*)::int AS n FROM collections
    WHERE target = 'node' AND node_id = ${nodeId}
  `);
  return Number(rows[0]?.n ?? 0);
}
