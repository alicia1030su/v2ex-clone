import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { TOPICS_PER_PAGE } from '@/server/queries';
import TopicItem from '@/components/TopicItem';
import PageNav from '@/components/PageNav';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

/**
 * 标签页 —— 对应原站主题详情中的 /tag/{name} 链接
 */
export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { name } = await params;
  const { p } = await searchParams;
  const page = Math.max(1, Number(p ?? 1) || 1);
  const tagName = decodeURIComponent(name);

  const tagRows = await db
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.name, tagName))
    .limit(1);
  if (!tagRows[0]) notFound();

  const topicIds = await db
    .select({ topicId: schema.topicTags.topicId })
    .from(schema.topicTags)
    .where(eq(schema.topicTags.tagId, tagRows[0].id));

  const ids = topicIds.map((t) => t.topicId);
  const list = ids.length
    ? await db
        .select({
          id: schema.topics.id,
          title: schema.topics.title,
          votes: schema.topics.votes,
          repliesCount: schema.topics.repliesCount,
          createdAt: schema.topics.createdAt,
          lastReplyAt: schema.topics.lastReplyAt,
          authorId: schema.users.id,
          authorName: schema.users.username,
          authorAvatar: schema.users.avatar,
          nodeId: schema.nodes.id,
          nodeName: schema.nodes.name,
          nodeTitle: schema.nodes.title,
        })
        .from(schema.topics)
        .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
        .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
        .where(
          and(
            eq(schema.topics.status, 'published'),
            inArray(schema.topics.id, ids),
          ),
        )
        .orderBy(desc(schema.topics.lastReplyAt))
        .limit(TOPICS_PER_PAGE)
        .offset((page - 1) * TOPICS_PER_PAGE)
    : [];

  const totalPages = Math.max(1, Math.ceil(list.length / TOPICS_PER_PAGE));

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>标签</strong>
            <div className="sep5" />
            <span className="fade">{tagName}</span>
          </div>
        </div>
      }
    >
      <div className="box">
        <div className="cell">
          <strong>标签：{tagName}</strong>
        </div>
        {list.length === 0 ? (
          <div className="cell">
            <span className="fade">该标签下暂无主题</span>
          </div>
        ) : (
          list.map((t) => (
            <TopicItem
              key={t.id}
              topic={{
                id: t.id,
                title: t.title,
                votes: t.votes,
                repliesCount: t.repliesCount,
                createdAt: t.createdAt,
                lastReplyAt: t.lastReplyAt,
                author: { id: t.authorId, username: t.authorName, avatar: t.authorAvatar },
                node: { id: t.nodeId, name: t.nodeName, title: t.nodeTitle },
                lastReplier: null,
              }}
            />
          ))
        )}
        {totalPages > 1 ? (
          <div className="cell">
            <PageNav
              page={page}
              totalPages={totalPages}
              basePath={`/tag/${encodeURIComponent(tagName)}`}
            />
          </div>
        ) : null}
      </div>
    </Wrapper>
  );
}
