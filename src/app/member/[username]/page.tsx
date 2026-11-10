import { MAX_PAGE, parsePageParam } from '@/lib/page-param';
import { avatarUrl } from '@/components/Avatar';
import { notFound } from 'next/navigation';
import { and, eq, desc } from 'drizzle-orm';
import { db, schema } from '@/db';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';
import { getUserByUsername, listTopics, TOPICS_PER_PAGE } from '@/server/queries';
import { formatDate, fullTimestamp } from '@/lib/time';
import { stripMarkdown } from '@/lib/markdown';
import { getSessionUser } from '@/lib/auth';
import { getFollowState } from '@/lib/follow-service';
import TopicItem from '@/components/TopicItem';
import PageNav from '@/components/PageNav';
import FollowButton from '@/components/FollowButton';
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
  const page = parsePageParam(p);

  const user = await getUserByUsername(username);
  if (!user) notFound();

  // v0.0.4：关注状态由服务端算好传入 —— 首屏即正确，无闪烁，
  // 也不需要客户端再发一次请求去猜「我有没有关注他」。
  const viewer = await getSessionUser();
  const followState = await getFollowState(viewer?.id ?? null, user.id);

  const { items, total } = await listTopics({
    authorUsername: user.username,
    page,
    perPage: TOPICS_PER_PAGE,
  });
  const totalPages = Math.min(MAX_PAGE, Math.max(1, Math.ceil(total / TOPICS_PER_PAGE)));

  // v0.0.14 P0-1：会员页「最近的回复」原先只 join topics ——
  // 隐藏节点下主题的**回复正文片段**会直接显示在会员主页上，
  // 而点击标题却 404。现在补 join nodes + 节点可见性条件：
  // 回复这一层自身就必须能判定可见性，不能指望调用方先查主题。
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
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(and(eq(schema.replies.authorId, user.id), PUBLIC_NODE_CONDITION))
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
          {/* v0.0.4：关注入口（R-24）—— 关注/取消关注都走真实 UI 点击流 */}
          {/*
           * v0.0.16：必须按「是否展示」条件渲染。
           *
           * `FollowButton` 在两种情况下返回 `null`：
           *   ① 访客（`currentUserId === null`）；
           *   ② 看自己的主页（不能关注自己）。
           * 若外层 cell 无条件渲染，这两类访客都会在右栏看到一个
           * **空的 20px cell**（实测 member 页报 `270x20` 空 cell）。
           * 结构探针的 emptyCells 专门抓这个 —— 空盒子不报错，只多一条空白。
           */}
          {viewer && viewer.id !== user.id ? (
            <div className="cell">
              <FollowButton
                userId={user.id}
                username={user.username}
                currentUserId={viewer.id}
                initiallyFollowing={followState.isFollowing}
                initialFollowersCount={followState.followersCount}
              />
            </div>
          ) : null}
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
