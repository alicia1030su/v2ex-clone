import { NextResponse } from 'next/server';
import { db, schema } from '@/db';
import { eq, sql } from 'drizzle-orm';
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
  legacyNotFoundResponse,
  legacyRateLimited,
} from '@/lib/legacy-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nodes/show.json —— **V2EX 旧版节点详情端点**
 *
 * ## 契约（2026-11-08 实测）
 *
 * | 请求 | 实测行为 |
 * |---|---|
 * | `?name=programmer` | 200，**单个对象** |
 * | `?name=PROGRAMMER` | 200（名称**大小写不敏感**） |
 * | `?id=300` | 200（支持按 id 查） |
 * | `?name=…&id=…` | 200，**任一命中即可** |
 * | 不存在 / 无参数 | **404** `Object Not Found` |
 *
 * 响应头实测：`application/json;charset=UTF-8`（**无空格**）、
 * `Cache-Control: public, max-age=3600`。
 *
 * 字段与 `/api/topics/show.json` 内嵌的 `node` **完全同构**（16 个键）。
 *
 * 与本项目的差异：`header`/`footer` 恒空串、`aliases` 恒 `[]`
 * （均未建模，给空值而非编造）、头像为确定性占位 data URI、
 * `founder_id` 取 `nodes.created_by`（未记录则为 0）。
 */
export async function GET(request: Request) {
  const rl = await guardLegacyRateLimit('nodes-show');
  if (!rl.ok) return legacyRateLimited(rl);

  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  const idRaw = url.searchParams.get('id');
  const id = idRaw !== null && /^\d+$/.test(idRaw) ? Number(idRaw) : null;

  if (!name && id === null) return legacyNotFoundResponse(rl, 3600);

  const conditions = [];
  if (name) conditions.push(eq(schema.nodes.name, name.toLowerCase()));
  if (id !== null) conditions.push(eq(schema.nodes.id, id));

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
    .where(conditions.length === 1 ? conditions[0] : sql`(${conditions[0]} or ${conditions[1]})`)
    .limit(1);

  const node = rows[0];
  if (!node) return legacyNotFoundResponse(rl, 3600);

  const origin = resolveBaseUrl(request.url);

  // 节点收藏数（原站 stars 语义）
  const starRows = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(schema.collections)
    .where(
      sql`${schema.collections.target} = 'node' and ${schema.collections.nodeId} = ${node.id}`,
    );

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
    stars: Number(starRows[0]?.cnt ?? 0),
    founderId: node.createdBy,
    parentNodeName: node.parentNodeName,
    avatars,
  };

  return new Response(JSON.stringify(toLegacyNode(input, origin)), {
    status: 200,
    headers: legacyJsonHeaders(rl, 3600),
  });
}
