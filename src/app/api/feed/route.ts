import { NextResponse } from 'next/server';
import { db, schema } from '@/db';
import { desc, eq, isNull, sql } from 'drizzle-orm';
import {
  buildRss,
  buildAtom,
  buildJsonFeed,
  truncate,
  siteOrigin,
  type FeedItem,
} from '@/lib/feed-builder';

export const dynamic = 'force-dynamic';

const FEED_LIMIT = 30;

/**
 * 读取站点最新主题（真实数据库内容）。
 *
 * 软删除的主题（deleted_at 非空）一律不出现。
 */
async function loadFeedItems(origin: string, nodeId?: number): Promise<FeedItem[]> {
  const rows = await db
    .select({
      id: schema.topics.id,
      title: schema.topics.title,
      content: schema.topics.content,
      createdAt: schema.topics.createdAt,
      lastReplyAt: schema.topics.lastReplyAt,
      authorName: schema.users.username,
      nodeName: schema.nodes.name,
    })
    .from(schema.topics)
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(
      nodeId === undefined
        ? isNull(schema.topics.deletedAt)
        : sql`${schema.topics.deletedAt} IS NULL AND ${schema.topics.nodeId} = ${nodeId}`,
    )
    .orderBy(desc(schema.topics.lastReplyAt))
    .limit(FEED_LIMIT);

  return rows.map((r) => ({
    title: r.title,
    link: `${origin}/t/${r.id}`,
    publishedAt: r.createdAt,
    author: r.authorName,
    summary: truncate(r.content, 300),
    id: `${origin}/t/${r.id}`,
  }));
}

/** 站点最新时间戳（用于 lastBuildDate / updated_at） */
async function feedUpdatedAt(): Promise<Date> {
  const rows = await db
    .select({ t: schema.topics.createdAt })
    .from(schema.topics)
    .where(isNull(schema.topics.deletedAt))
    .orderBy(desc(schema.topics.createdAt))
    .limit(1);
  return rows[0]?.t ?? new Date();
}

/**
 * GET /api/feed —— 全站 RSS 2.0
 *
 * Content-Type: application/rss+xml; charset=utf-8
 */
export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const items = await loadFeedItems(origin);
  const updatedAt = await feedUpdatedAt();
  const selfLink = `${origin}/api/feed`;

  const xml = buildRss({
    title: 'V2EX Clone',
    description: 'V2EX Clone —— 创意工作者社区',
    link: origin,
    selfLink,
    updatedAt,
    items,
  });

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
}
