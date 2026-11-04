import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import {
  buildFeedEntries,
  buildRss,
  resolveBaseUrl,
  toFeedItem,
} from '@/lib/feed-builder';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nodes/[name]/feed —— 节点 RSS 2.0
 *
 * - 内容来自真实数据库；软删除的主题不出现
 * - Content-Type: application/rss+xml; charset=utf-8
 * - Cache-Control: public, max-age=120
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const nodeName = String(name ?? '').trim().toLowerCase();

  const nodeRows = await db
    .select({ id: schema.nodes.id, title: schema.nodes.title, name: schema.nodes.name })
    .from(schema.nodes)
    .where(eq(schema.nodes.name, nodeName))
    .limit(1);
  const node = nodeRows[0];

  if (!node) {
    return new Response(
      JSON.stringify({ ok: false, error: '节点不存在' }),
      { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }

  const origin = resolveBaseUrl(request.url);

  const entries = await buildFeedEntries(db, { baseUrl: origin, nodeId: node.id });

  const xml = buildRss({
    title: `${node.title} — V2EX Clone`,
    description: `节点 ${node.name} 的最新主题`,
    link: `${origin}/go/${node.name}`,
    selfLink: `${origin}/api/nodes/${node.name}/feed`,
    updatedAt: entries.length > 0 ? entries[0].updatedAt : new Date(),
    items: entries.map(toFeedItem),
  });

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=120, stale-while-revalidate=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
