import { db } from '@/db';
import { feedCachedResponse } from '@/lib/feed-cache';
import {
  buildFeedEntries,
  buildJsonFeed,
  resolveBaseUrl,
  toFeedItem,
} from '@/lib/feed-builder';

export const dynamic = 'force-dynamic';

/**
 * GET /api/feed/json —— JSON Feed 1.1
 *
 * - 内容来自真实数据库；软删除的主题不出现
 * - Content-Type: application/feed+json; charset=utf-8
 * - Cache-Control: public, max-age=300
 */
export async function GET(request: Request) {
  const origin = resolveBaseUrl(request.url);

  const entries = await buildFeedEntries(db, { baseUrl: origin });

  const json = buildJsonFeed({
    title: 'V2EX Clone',
    description: 'V2EX Clone —— 创意工作者社区',
    homePageUrl: origin,
    feedUrl: `${origin}/api/feed/json`,
    updatedAt: entries.length > 0 ? entries[0].updatedAt : new Date(),
    items: entries.map(toFeedItem),
  });

  return feedCachedResponse(request, json, {
    'Content-Type': 'application/feed+json; charset=utf-8',
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    'X-Content-Type-Options': 'nosniff',
  });
}
