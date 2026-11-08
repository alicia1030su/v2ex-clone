import { db, schema } from '@/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { avatarUrl } from '@/components/Avatar';
import {
  NODE_AVATAR_SIZES,
  toLegacyNode,
  type LegacyNodeInput,
} from '@/lib/legacy-topic-api';
import { resolveBaseUrl } from '@/lib/feed-builder';
import {
  guardLegacyRateLimit,
  legacyJsonHeaders,
  legacyRateLimited,
} from '@/lib/legacy-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nodes/all.json —— **V2EX 旧版「全部节点」端点**
 *
 * ## 契约（2026-11-08 实测）
 *
 * - 200，**数组**，形状与 `/api/nodes/show.json` 的单个对象同构（16 个键）
 * - 实测原站返回 **1380** 条（本项目节点数远小于此，返回库内全部 active 节点）
 * - 响应头：`application/json;charset=UTF-8`、
 *   `Cache-Control: public, max-age=7200`（2 小时，长于单节点）
 * - 排序：原站按 id 升序（首项 `babel`/id=1）
 *
 * ## 与站内 `/api/nodes` 的区别
 *
 * 站内端点返回 `{ok:true,nodes:[…]}` 包裹并带统计；本端点是**裸数组**，
 * 字段名逐字对齐旧版 API。两者服务不同客户端，**不合并**。
 *
 * 本项目无节点审核以外的大量节点，因此不分页（原站也不分页）。
 */
export async function GET(request: Request) {
  const rl = await guardLegacyRateLimit('nodes-all');
  if (!rl.ok) return legacyRateLimited(rl);

  const origin = resolveBaseUrl(request.url);

  const parentName = sql<string | null>`(select pn.name from nodes pn where pn.id = ${schema.nodes.parentId})`;

  const rows = await db
    .select({
      id: schema.nodes.id,
      name: schema.nodes.name,
      title: schema.nodes.title,
      topicsCount: schema.nodes.topicsCount,
      avatar: schema.nodes.avatar,
      createdBy: schema.nodes.createdBy,
      parentNodeName: parentName,
    })
    .from(schema.nodes)
    // 只暴露可用节点（pending/hidden 不进公开 API）
    .where(eq(schema.nodes.status, 'active'))
    .orderBy(asc(schema.nodes.id));

  // 一次性取回全部节点的收藏数（避免 N+1）
  const starRows = await db
    .select({ nodeId: schema.collections.nodeId, cnt: sql<number>`count(*)::int` })
    .from(schema.collections)
    .where(eq(schema.collections.target, 'node'))
    .groupBy(schema.collections.nodeId);

  const stars = new Map<number, number>();
  for (const row of starRows) {
    if (row.nodeId !== null) stars.set(row.nodeId, Number(row.cnt));
  }

  const payload = rows.map((node) => {
    const avatars = {} as Record<keyof typeof NODE_AVATAR_SIZES, string>;
    for (const [key, size] of Object.entries(NODE_AVATAR_SIZES)) {
      avatars[key as keyof typeof NODE_AVATAR_SIZES] = avatarUrl(
        { id: node.id, username: node.name, avatar: node.avatar },
        size,
      );
    }
    const input: LegacyNodeInput = {
      id: node.id,
      name: node.name,
      title: node.title,
      topicsCount: node.topicsCount,
      stars: stars.get(node.id) ?? 0,
      founderId: node.createdBy,
      parentNodeName: node.parentNodeName,
      avatars,
    };
    return toLegacyNode(input, origin);
  });

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: legacyJsonHeaders(rl, 7200),
  });
}
