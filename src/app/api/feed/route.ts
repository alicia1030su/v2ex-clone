import { db } from '@/db';
import {
  buildFeedEntries,
  buildRss,
  resolveBaseUrl,
  toFeedItem,
} from '@/lib/feed-builder';

export const dynamic = 'force-dynamic';

/**
 * GET /api/feed —— 全站 RSS 2.0
 *
 * - 内容来自真实数据库（topics + users + nodes），软删除主题不出现
 * - Content-Type: application/rss+xml; charset=utf-8
 * - Cache-Control: public, max-age=300
 */
export async function GET(request: Request) {
  const origin = resolveBaseUrl(request.url);

  const entries = await buildFeedEntries(db, { baseUrl: origin });

  const xml = buildRss({
    title: 'V2EX Clone',
    description: 'V2EX Clone —— 创意工作者社区',
    link: origin,
    selfLink: `${origin}/api/feed`,
    updatedAt: entries.length > 0 ? entries[0].updatedAt : new Date(),
    items: entries.map(toFeedItem),
  });

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
