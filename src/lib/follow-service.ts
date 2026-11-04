import 'server-only';
import { db, schema } from '@/db';
import { and, count, eq } from 'drizzle-orm';

/**
 * 关注关系查询（v0.0.4）
 *
 * 页面与 API 共用同一套查询逻辑 —— 避免各处自行拼 SQL 导致口径不一致
 * （「我是否关注了这个人」与「这个人有多少关注者」必须来自同一次查询口径）。
 */
export type FollowState = {
  /** 当前登录者是否关注了目标用户 */
  isFollowing: boolean;
  /** 目标用户的关注者总数 */
  followersCount: number;
};

/**
 * 查询「我 → 目标用户」的关注状态与目标用户的关注者总数。
 *
 * @param viewerId 当前登录用户 id；未登录时传 null
 * @param targetId 目标用户 id
 */
export async function getFollowState(
  viewerId: number | null,
  targetId: number,
): Promise<FollowState> {
  const [countRows, followingRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.follows)
      .where(eq(schema.follows.followingId, targetId)),
    viewerId === null
      ? Promise.resolve([])
      : db
          .select({ id: schema.follows.id })
          .from(schema.follows)
          .where(
            and(
              eq(schema.follows.followerId, viewerId),
              eq(schema.follows.followingId, targetId),
            ),
          )
          .limit(1),
  ]);

  return {
    isFollowing: followingRows.length > 0,
    followersCount: Number(countRows[0]?.n ?? 0),
  };
}

/**
 * 查询「我关注的人」列表（用于 /following 页面）。
 *
 * 返回目标用户的基本资料与关注时间。
 */
export async function listFollowing(
  viewerId: number,
  limit = 100,
): Promise<
  Array<{
    id: number;
    username: string;
    avatar: string | null;
    tagline: string | null;
    followedAt: Date;
  }>
> {
  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
      tagline: schema.users.tagline,
      followedAt: schema.follows.createdAt,
    })
    .from(schema.follows)
    .innerJoin(schema.users, eq(schema.users.id, schema.follows.followingId))
    .where(eq(schema.follows.followerId, viewerId))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows;
}
