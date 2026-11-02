import { avatarUrl } from '@/components/Avatar';
import { notFound } from 'next/navigation';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getUserByUsername, listTopics, TOPICS_PER_PAGE } from '@/server/queries';
import { formatDate, fullTimestamp } from '@/lib/time';
import { stripMarkdown } from '@/lib/markdown';
import TopicItem from '@/components/TopicItem';
import PageNav from '@/components/PageNav';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { username } = await params;
  const { p } = await searchParams;
  const page = Math.max(1, Number(p ?? 1) || 1);

  const user = await getUserByUsername(username);
  if (!user) notFound();

  const { items, total } = await listTopics({
    authorUsername: user.username,
    page,
    perPage: TOPICS_PER_PAGE,
  });
  const totalPages = Math.max(1, Math.ceil(total / TOPICS_PER_PAGE));

  const replyRows = await db
    .select({
      id: schema.replies.id,
      topicId: schema.replies.topicId,
      content: schema.replies.content,
      createdAt: schema.replies.createdAt,
      topicTitle: schema.topics.title,
    })
    .from(schema.replies)
    .innerJoin(schema.topics, eq(schema.topics.id, schema.replies.topicId))
    .where(eq(schema.replies.authorId, user.id))
    .orderBy(desc(schema.replies.createdAt))
    .limit(10);

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell page-content-header">
            <img
              src={avatarUrl({ id: user.id, username: user.username, avatar: user.avatar }, 64)}
              alt={user.username}
              width={64}
              height={64}
            />
            <div>
              <h2>{user.username}</h2>
              <div className="info">
                <span className="f12 gray">
                  {user.role !== 'user' ? (
                    <span className="badge pro">{user.role === 'admin' ? '管理员' : '版主'}</span>
                  ) : null}{' '}
                  UID {user.id} · 加入于 {formatDate(user.createdAt)}
                </span>
              </div>
              {user.tagline ? <div className="f12 gray">{user.tagline}</div> : null}
            </div>
          </div>
          <div className="cell">
            <span className="f12 gray">积分</span>
            <div className="f16">{user.balance}</div>
          </div>
          {user.bio ? (
            <div className="cell">
              <span className="f12 gray">简介</span>
              <div>{user.bio}</div>
            </div>
          ) : null}
          {user.location ? (
            <div className="cell">
              <span className="f12 gray">所在地</span>
              <div>{user.location}</div>
            </div>
          ) : null}
          {user.url ? (
            <div className="cell">
              <span className="f12 gray">个人主页</span>
              <div>
                <a href={user.url} rel="nofollow noopener noreferrer" target="_blank">
                  {user.url}
                </a>
              </div>
            </div>
          ) : null}
        </div>
      }
    >
      <div className="box">
        <div className="cell">
          <strong>{user.username}</strong> 发起的主题
        </div>
        {items.length === 0 ? (
          <div className="cell">
            <span className="fade">该用户还没有发起过主题</span>
          </div>
        ) : (
          items.map((t) => <TopicItem key={t.id} topic={t} />)
        )}
        {totalPages > 1 ? (
          <div className="cell">
            <PageNav
              page={page}
              totalPages={totalPages}
              basePath={`/member/${user.username}`}
            />
          </div>
        ) : null}
      </div>

      <div className="sep20" />
      <div className="box">
        <div className="cell">
          <strong>{user.username}</strong> 最近的回复
        </div>
        {replyRows.length === 0 ? (
          <div className="cell">
            <span className="fade">该用户还没有回复过</span>
          </div>
        ) : (
          replyRows.map((r) => (
            <div key={r.id} className="cell">
              <div className="f12 gray" title={fullTimestamp(r.createdAt)}>
                {r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : ''}
              </div>
              <div>
                <a href={`/t/${r.topicId}#reply${r.id}`}>{r.topicTitle}</a>
              </div>
              <div className="f12 fade">{stripMarkdown(r.content, 120)}</div>
            </div>
          ))
        )}
      </div>
    </Wrapper>
  );
}
