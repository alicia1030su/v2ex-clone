import { NextResponse } from 'next/server';
import { db, schema } from '@/db';
import { desc, eq, isNull, sql } from 'drizzle-orm';
import { buildRss, truncate, siteOrigin } from '@/lib/feed-builder';

export const dynamic = 'force-dynamic';

const FEED_LIMIT = 30;

/**
 * GET /api/nodes/[name]/feed —— 节点 RSS 2.0
 *
 * Content-Type: application/rss+xml; charset=utf-8
 *
 * 软删除的主题不会出现在 feed 中。
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
    return NextResponse.json({ ok: false, error: '节点不存在' }, { status: 404 });
  }

  const origin = siteOrigin(request);

  const rows = await db
    .select({
      id: schema.topics.id,
      title: schema.topics.title,
      content: schema.topics.content,
      createdAt: schema.topics.createdAt,
      authorName: schema.users.username,
    })
    .from(schema.topics)
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .where(sql`${schema.topics.deletedAt} IS NULL AND ${schema.topics.nodeId} = ${node.id}`)
    .orderBy(desc(schema.topics.lastReplyAt))
    .limit(FEED_LIMIT);

  const latest = await db
    .select({ t: schema.topics.createdAt })
    .from(schema.topics)
    .where(sql`${schema.topics.deletedAt} IS NULL AND ${schema.topics.nodeId} = ${node.id}`)
    .orderBy(desc(schema.topics.createdAt))
    .limit(1);

  const selfLink = `${origin}/api/nodes/${node.name}/feed`;
  const xml = buildRss({
    title: `${node.title} — V2EX Clone`,
    description: `节点 ${node.name} 的最新主题`,
    link: `${origin}/go/${node.name}`,
    selfLink,
    updatedAt: latest[0]?.t ?? new Date(),
    items: rows.map((r) => ({
      title: r.title,
      link: `${origin}/t/${r.id}`,
      publishedAt: r.createdAt,
      author: r.authorName,
      summary: truncate(r.content, 300),
      id: `${origin}/t/${r.id}`,
    })),
  });

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=120, stale-while-revalidate=300',
    },
  });
}
