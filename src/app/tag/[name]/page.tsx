import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, count, desc, eq } from 'drizzle-orm';
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

  // ⚠️ v0.0.14 重构（同时修掉两个真实缺陷）：
  //
  // ① **分页总数算错**：原实现 `Math.ceil(list.length / TOPICS_PER_PAGE)`，
  //    而 `list` 已被 `.limit(TOPICS_PER_PAGE)` 截断 ⇒ totalPages 恒 ≤ 1，
  //    任何标签下超过 20 篇主题时**第 2 页永远不可达**；
  // ② **一次性拉全量 id**：先查该标签下**所有** topic id 再用 IN 列表过滤，
  //    热门标签会一次拉上万行，且可能撞 PostgreSQL 的绑定参数上限。
  //
  // 现在改为直接 `topic_tags ⋈ topics` 分页查询 + 同条件 count，
  // 与 `listTopics()` 的「先分页取行、再单独 count」口径保持一致。
  const tagWhere = and(
    eq(schema.topicTags.tagId, tagRows[0].id),
    eq(schema.topics.status, 'published'),
  );

  const [list, totalRows] = await Promise.all([
    db
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
      .innerJoin(schema.topicTags, eq(schema.topicTags.topicId, schema.topics.id))
      .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
      .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
      .where(tagWhere)
      // 排序必须确定性：同 lastReplyAt 时用 id 兜底，避免翻页时行漂移
      .orderBy(desc(schema.topics.lastReplyAt), desc(schema.topics.id))
      .limit(TOPICS_PER_PAGE)
      .offset((page - 1) * TOPICS_PER_PAGE),
    db
      .select({ n: count() })
      .from(schema.topics)
      .innerJoin(schema.topicTags, eq(schema.topicTags.topicId, schema.topics.id))
      .where(tagWhere),
  ]);

  const total = Number(totalRows[0]?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / TOPICS_PER_PAGE));

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
