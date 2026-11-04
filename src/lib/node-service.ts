import 'server-only';
import { db, schema } from '@/db';
import { and, eq, isNull, sql, asc, desc, type SQL } from 'drizzle-orm';

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

  // 用子查询聚合统计，避免 N+1 查询
  const rows: Array<Record<string, unknown>> = await db.execute(sql`
    SELECT
      n.id, n.name, n.title, n.description, n.avatar,
      n.category_id, n.parent_id, n.status,
      (
        SELECT count(*)::int FROM topics t
        WHERE t.node_id = n.id AND t.deleted_at IS NULL
      ) AS topics_count,
      (
        SELECT max(r.created_at) FROM replies r
        JOIN topics t2 ON t2.id = r.topic_id
        WHERE t2.node_id = n.id AND r.deleted_at IS NULL AND t2.deleted_at IS NULL
      ) AS last_reply_at
    FROM nodes n
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

/** 分类列表（含各分类的节点数） */
export async function listCategories() {
  const rows: Array<Record<string, unknown>> = await db.execute(sql`
    SELECT
      c.id, c.name, c.title, c.description,
      (
        SELECT count(*)::int FROM nodes n
        WHERE n.category_id = c.id AND n.status = 'active'
      ) AS nodes_count
    FROM categories c
    ORDER BY c.title ASC
  `);

  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    title: String(r.title),
    description: r.description === null ? null : String(r.description),
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
