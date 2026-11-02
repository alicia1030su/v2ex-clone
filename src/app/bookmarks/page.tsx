import { redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { relativeTime } from '@/lib/time';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

export default async function BookmarksPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin?next=%2Fbookmarks');

  const rows = await db
    .select({
      id: schema.collections.id,
      target: schema.collections.target,
      createdAt: schema.collections.createdAt,
      topicId: schema.topics.id,
      topicTitle: schema.topics.title,
      topicReplies: schema.topics.repliesCount,
      nodeId: schema.nodes.id,
      nodeName: schema.nodes.name,
      nodeTitle: schema.nodes.title,
    })
    .from(schema.collections)
    .leftJoin(schema.topics, eq(schema.topics.id, schema.collections.topicId))
    .leftJoin(schema.nodes, eq(schema.nodes.id, schema.collections.nodeId))
    .where(eq(schema.collections.userId, user.id))
    .orderBy(desc(schema.collections.createdAt));

  const topicRows = rows.filter((r) => r.target === 'topic');
  const nodeRows = rows.filter((r) => r.target === 'node');

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>我的收藏</strong>
            <div className="sep5" />
            <span className="fade">收藏的主题 {topicRows.length} 个，节点 {nodeRows.length} 个</span>
          </div>
        </div>
      }
    >
      <div className="box">
        <div className="cell">
          <strong>收藏的主题</strong>
        </div>
        {topicRows.length === 0 ? (
          <div className="cell">
            <span className="fade">还没有收藏任何主题</span>
          </div>
        ) : (
          topicRows.map((r) => (
            <div key={r.id} className="cell">
              <div className="fr f12 gray">{relativeTime(r.createdAt)}</div>
              <a href={`/t/${r.topicId}`}>{r.topicTitle}</a>{' '}
              <span className="f12 gray">({r.topicReplies} 回复)</span>
            </div>
          ))
        )}
      </div>

      <div className="sep20" />
      <div className="box">
        <div className="cell">
          <strong>收藏的节点</strong>
        </div>
        {nodeRows.length === 0 ? (
          <div className="cell">
            <span className="fade">还没有收藏任何节点</span>
          </div>
        ) : (
          nodeRows.map((r) => (
            <div key={r.id} className="cell">
              <div className="fr f12 gray">{relativeTime(r.createdAt)}</div>
              <a href={`/go/${r.nodeName}`}>{r.nodeTitle}</a>{' '}
              <span className="f12 gray">({r.nodeName})</span>
            </div>
          ))
        )}
      </div>
    </Wrapper>
  );
}
