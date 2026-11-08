import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import {
  buildFeedEntries,
  buildJsonFeed,
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
  const updatedAt = entries.length > 0 ? entries[0].updatedAt : new Date();

  /*
   * v0.0.9 后修（2026-11-08）：支持 `?format=json` 返回 JSON Feed 1.1。
   *
   * 节点页头部的两个 feed 图标需要「RSS + JSON」两种格式，
   * 但此前**只有 RSS 一种真实路由**，JSON 图标指向的是不存在的
   * `/feed/{name}.json`（恒 404）。这里补上 JSON 变体，
   * 让图标指向真实可用的地址，而不是删掉了事。
   */
  const format = new URL(request.url).searchParams.get('format');

  if (format === 'json') {
    const json = buildJsonFeed({
      title: `${node.title} — V2EX Clone`,
      description: `节点 ${node.name} 的最新主题`,
      homePageUrl: `${origin}/go/${node.name}`,
      feedUrl: `${origin}/api/nodes/${node.name}/feed?format=json`,
      updatedAt,
      items: entries.map(toFeedItem),
    });

    return new Response(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/feed+json; charset=utf-8',
        'Cache-Control': 'public, max-age=120, stale-while-revalidate=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const xml = buildRss({
    title: `${node.title} — V2EX Clone`,
    description: `节点 ${node.name} 的最新主题`,
    link: `${origin}/go/${node.name}`,
    selfLink: `${origin}/api/nodes/${node.name}/feed`,
    updatedAt,
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
