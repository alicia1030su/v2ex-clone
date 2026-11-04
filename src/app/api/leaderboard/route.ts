import { NextResponse } from 'next/server';
import { leaderboard } from '@/lib/credit-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/leaderboard —— 积分排行榜与活跃度统计
 *
 * 查询参数：limit（默认 50，最大 200）、offset
 *
 * 响应包含每位用户的：用户名、头像、积分余额、发帖数、回复数、被感谢数。
 * 被封禁/禁用的用户不参与排行。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);

  const rows = await leaderboard({
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  return NextResponse.json({
    ok: true,
    leaderboard: rows.map((r, i) => ({
      rank: offset + i + 1,
      id: r.id,
      username: r.username,
      avatar: r.avatar,
      balance: r.balance,
      createdAt: r.createdAt,
      lastActiveAt: r.lastActiveAt,
      topics: r.stats.topics,
      replies: r.stats.replies,
      thanksReceived: r.stats.thanksReceived,
    })),
  });
}
