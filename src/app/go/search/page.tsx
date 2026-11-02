import Link from 'next/link';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { listTopics, TOPICS_PER_PAGE } from '@/server/queries';
import TopicItem from '@/components/TopicItem';
import PageNav from '@/components/PageNav';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? '').trim();
  const page = Math.max(1, Number(params.p ?? 1) || 1);

  const topicResult = q
    ? await listTopics({ keyword: q, page, perPage: TOPICS_PER_PAGE })
    : { items: [], total: 0 };

  const nodeResult = q
    ? await db
        .select()
        .from(schema.nodes)
        .where(
          or(ilike(schema.nodes.title, `%${q}%`), ilike(schema.nodes.name, `%${q}%`))!,
        )
        .limit(20)
    : [];

  const memberResult = q
    ? await db
        .select({ id: schema.users.id, username: schema.users.username, avatar: schema.users.avatar })
        .from(schema.users)
        .where(ilike(schema.users.username, `%${q}%`))
        .limit(20)
    : [];

  const totalPages = Math.max(1, Math.ceil(topicResult.total / TOPICS_PER_PAGE));

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>搜索</strong>
            <div className="sep5" />
            <span className="fade">
              {q ? `关键词「${q}」` : '请输入关键词'}
              {q ? `，找到 ${topicResult.total} 个主题` : ''}
            </span>
          </div>
        </div>
      }
    >
      <div className="box">
        <div className="cell">
          <strong>搜索结果</strong>
        </div>

        {nodeResult.length > 0 ? (
          <>
            <div className="cell section">节点</div>
            {nodeResult.map((n) => (
              <div key={n.id} className="cell">
                <a href={`/go/${n.name}`}>{n.title}</a>{' '}
                <span className="f12 gray">({n.name})</span>
              </div>
            ))}
          </>
        ) : null}

        {memberResult.length > 0 ? (
          <>
            <div className="cell section">会员</div>
            {memberResult.map((m) => (
              <div key={m.id} className="cell">
                <a href={`/member/${m.username}`}>{m.username}</a>
              </div>
            ))}
          </>
        ) : null}

        {q ? (
          <>
            <div className="cell section">主题</div>
            {topicResult.items.length === 0 ? (
              <div className="cell">
                <span className="fade">没有找到相关主题</span>
              </div>
            ) : (
              topicResult.items.map((t) => <TopicItem key={t.id} topic={t} />)
            )}
            {totalPages > 1 ? (
              <div className="cell">
                <PageNav
                  page={page}
                  totalPages={totalPages}
                  basePath="/go/search"
                  tab={`q=${encodeURIComponent(q)}`}
                />
              </div>
            ) : null}
          </>
        ) : (
          <div className="cell">
            <span className="fade">请在顶部搜索框输入关键词</span>
          </div>
        )}
      </div>
    </Wrapper>
  );
}
