import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { listFollowing } from '@/lib/follow-service';
import { relativeTime, fullTimestamp } from '@/lib/time';
import { stripMarkdown } from '@/lib/markdown';
import { avatarUrl } from '@/components/Avatar';
import Wrapper from '@/components/Wrapper';

/**
 * 关注动态页（v0.0.4）
 *
 * 展示两件事：
 *  1. **我关注的人**（`follows` 表）—— 可直接跳到对方主页
 *  2. **我关注的人发布的主题**（`GET /api/users/follows/topics` 的等价服务端查询）
 *
 * ## 为什么要有这个页面
 *
 * v0.0.4 之前关注功能**完全没有前端**：后端 API 齐全，
 * 但没有任何页面能查看「我关注了谁」或「我关注的人发了什么」。
 * 用户关注了一个用户之后，**无处可去** —— 关注变成了单向的、无反馈的操作。
 * 这个页面补上了闭环。
 *
 * ## 数据一致性
 *
 * 与 `GET /api/users/follows/topics` 使用**同一套 SQL 口径**
 * （子查询 `author_id IN (SELECT following_id FROM follows WHERE follower_id = ?)`），
 * 保证「页面看到的」与「API 返回的」是同一批数据。
 */
export const dynamic = 'force-dynamic';

const TOPICS_PER_FOLLOW_PAGE = 30;

export default async function FollowingPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/signin?next=%2Ffollowing');

  const { p } = await searchParams;
  const page = Math.max(1, Number(p ?? 1) || 1);
  const offset = (page - 1) * TOPICS_PER_FOLLOW_PAGE;

  // 我关注的人
  const followingUsers = await listFollowing(user.id, 200);

  // 我关注的人发布的主题
  const topicRows = await db
    .select({
      id: schema.topics.id,
      title: schema.topics.title,
      content: schema.topics.content,
      nodeName: schema.nodes.name,
      nodeTitle: schema.nodes.title,
      authorId: schema.users.id,
      authorName: schema.users.username,
      authorAvatar: schema.users.avatar,
      repliesCount: schema.topics.repliesCount,
      votes: schema.topics.votes,
      createdAt: schema.topics.createdAt,
      lastReplyAt: schema.topics.lastReplyAt,
    })
    .from(schema.topics)
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(
      sql`${schema.topics.deletedAt} IS NULL AND ${schema.topics.authorId} IN (
        SELECT following_id FROM follows WHERE follower_id = ${user.id}
      )`,
    )
    .orderBy(desc(schema.topics.lastReplyAt))
    .limit(TOPICS_PER_FOLLOW_PAGE)
    .offset(offset);

  const totalRows = await db.execute(sql`
    SELECT count(*)::int AS n FROM topics
    WHERE deleted_at IS NULL AND author_id IN (
      SELECT following_id FROM follows WHERE follower_id = ${user.id}
    )
  `);
  const total = Number((totalRows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / TOPICS_PER_FOLLOW_PAGE));

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>我的关注</strong>
            <div className="sep5" />
            <span className="fade">
              已关注 {followingUsers.length} 位用户
            </span>
          </div>
          {followingUsers.length > 0 ? (
            <div className="cell">
              <strong>关注的人</strong>
              <div className="sep5" />
              {followingUsers.map((u) => (
                <div key={u.id} className="sep5">
                  <Link href={`/member/${u.username}`}>
                    <img
                      src={avatarUrl(
                        { id: u.id, username: u.username, avatar: u.avatar },
                        24,
                      )}
                      className="avatar"
                      width={24}
                      height={24}
                      alt={u.username}
                      data-uid={u.id}
                      style={{ marginRight: 6, verticalAlign: 'middle' }}
                    />
                    {u.username}
                  </Link>
                  <div className="f12 gray" title={fullTimestamp(u.followedAt)}>
                    关注于 {relativeTime(u.followedAt)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="cell">
              <span className="fade">
                还没有关注任何人。到
                <Link href="/nodes"> 节点页 </Link>
                或任意
                <Link href="/member/admin"> 会员主页 </Link>
                点击「关注」即可。
              </span>
            </div>
          )}
        </div>
      }
    >
      <div className="box">
        <div className="cell">
          <strong>我关注的人发布的主题</strong>
        </div>
        {topicRows.length === 0 ? (
          <div className="cell">
            <span className="fade">你关注的人还没有发布主题</span>
          </div>
        ) : (
          topicRows.map((t) => (
            <div key={t.id} className="cell item">
              <table cellPadding={0} cellSpacing={0} border={0} width="100%">
                <tr>
                  <td width={48} valign="top" align="center">
                    <Link href={`/member/${t.authorName}`}>
                      <img
                        src={avatarUrl(
                          {
                            id: t.authorId,
                            username: t.authorName,
                            avatar: t.authorAvatar,
                          },
                          48,
                        )}
                        className="avatar"
                        width={48}
                        height={48}
                        alt={t.authorName}
                        data-uid={t.authorId}
                      />
                    </Link>
                  </td>
                  <td width={10} />
                  <td width="auto" valign="middle">
                    <span className="item_title">
                      <Link
                        href={`/t/${t.id}#reply${t.repliesCount}`}
                        className="topic-link"
                        id={`topic-link-${t.id}`}
                      >
                        {t.title}
                      </Link>
                    </span>
                    <div className="sep5" />
                    <div className="f12 fade">{stripMarkdown(t.content, 100)}</div>
                    <span className="topic_info">
                      <Link href={`/go/${t.nodeName}`} className="node">
                        {t.nodeTitle}
                      </Link>{' '}
                      ·{' '}
                      <strong>
                        <Link href={`/member/${t.authorName}`}>{t.authorName}</Link>
                      </strong>{' '}
                      · <span title={fullTimestamp(t.createdAt)}>{relativeTime(t.createdAt)}</span>
                    </span>
                  </td>
                  <td width={70} align="right" valign="middle">
                    <Link href={`/t/${t.id}#reply${t.repliesCount}`} className="count_livid">
                      {t.repliesCount}
                    </Link>
                  </td>
                </tr>
              </table>
            </div>
          ))
        )}
        {totalPages > 1 ? (
          <div className="cell ps_container">
            <div style={{ textAlign: 'center' }}>
              {page > 1 ? (
                <Link href={`/following?p=${page - 1}`} className="page_normal">
                  ‹ 上一页
                </Link>
              ) : (
                <span className="page_normal" style={{ opacity: 0.45 }}>
                  ‹ 上一页
                </span>
              )}{' '}
              <span className="page_current">{page}</span>{' '}
              {page < totalPages ? (
                <Link href={`/following?p=${page + 1}`} className="page_normal">
                  下一页 ›
                </Link>
              ) : (
                <span className="page_normal" style={{ opacity: 0.45 }}>
                  下一页 ›
                </span>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Wrapper>
  );
}
