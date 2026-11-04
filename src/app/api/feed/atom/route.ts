import { db } from '@/db';
import {
  buildAtom,
  buildFeedEntries,
  resolveBaseUrl,
  toFeedItem,
} from '@/lib/feed-builder';

export const dynamic = 'force-dynamic';

/**
 * GET /api/feed/atom —— 全站 Atom 1.0
 *
 * - 内容来自真实数据库；软删除的主题不出现
 * - Content-Type: application/atom+xml; charset=utf-8
 * - Cache-Control: public, max-age=300
 */
export async function GET(request: Request) {
  const origin = resolveBaseUrl(request.url);

  const entries = await buildFeedEntries(db, { baseUrl: origin });

  const xml = buildAtom({
    title: 'V2EX Clone',
    subtitle: 'V2EX Clone —— 创意工作者社区',
    link: origin,
    selfLink: `${origin}/api/feed/atom`,
    updatedAt: entries.length > 0 ? entries[0].updatedAt : new Date(),
    items: entries.map(toFeedItem),
  });

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
