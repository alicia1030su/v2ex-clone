import { NextResponse } from 'next/server';
import { db, schema } from '@/db';
import { desc, eq, isNull } from 'drizzle-orm';
import { buildAtom, truncate, siteOrigin } from '@/lib/feed-builder';

export const dynamic = 'force-dynamic';

const FEED_LIMIT = 30;

/**
 * GET /api/feed/atom —— 全站 Atom 1.0
 *
 * Content-Type: application/atom+xml; charset=utf-8
 */
export async function GET(request: Request) {
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
    .where(isNull(schema.topics.deletedAt))
    .orderBy(desc(schema.topics.lastReplyAt))
    .limit(FEED_LIMIT);

  const latest = await db
    .select({ t: schema.topics.createdAt })
    .from(schema.topics)
    .where(isNull(schema.topics.deletedAt))
    .orderBy(desc(schema.topics.createdAt))
    .limit(1);

  const selfLink = `${origin}/api/feed/atom`;
  const xml = buildAtom({
    title: 'V2EX Clone',
    subtitle: 'V2EX Clone —— 创意工作者社区',
    link: origin,
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
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
}
