import { redirect } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';
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

  /*
   * v0.0.14 P0-1：收藏列表不得展示隐藏节点下的内容。
   *
   * ## 为什么这里用**内存过滤**而不是把条件塞进 leftJoin
   *
   * 本查询一行是「一条收藏」，`collections.target` 决定它指向**主题**还是**节点**，
   * 而 nodes 这个 join 固定挂在 `collections.nodeId` 上 ——
   * 于是同一个 `nodes` 别名在两行里含义不同：
   *   · target='topic' 行：`nodes.*` 是 NULL（topicId 有值，nodeId 为 NULL）
   *   · target='node'  行：`nodes.*` 才是被收藏的节点
   *
   * 若在 join 上写 `nodes.status='active'`，只有「node 收藏」会被过滤，
   * 「topic 收藏」因为 `nodes` 全是 NULL 会被一并删掉 —— 两种收藏一起消失，
   * 这是比泄漏更糟的**功能损坏**。若改成内连接，则主题收藏同样全丢。
   *
   * 正确的做法是**按 target 分别取可见性**，见下面两组查询。
   * 这里不存在分页/计数（页面一次性列出该用户的全部收藏），
   * 因此内存过滤不会造成「总数与行数口径不一致」，也不会把分页翻错。
   */
  // leftJoin 未命中时 topicId / nodeId 为 NULL ⇒ 先剔除再查可见性
  // （`filter` 后的类型收窄不会穿过 `map`，所以显式断言成 number）
  const topicIds: number[] = [];
  const collectedNodeIds: number[] = [];
  for (const r of rows) {
    if (r.target === 'topic' && r.topicId !== null) topicIds.push(r.topicId);
    if (r.target === 'node' && r.nodeId !== null) collectedNodeIds.push(r.nodeId);
  }

  // 主题收藏：只保留「主题所属节点仍 active」的那些
  const visibleTopicIds = new Set<number>();
  if (topicIds.length > 0) {
    const topicNodes = await db
      .select({ topicId: schema.topics.id })
      .from(schema.topics)
      .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
      .where(and(inArray(schema.topics.id, topicIds), PUBLIC_NODE_CONDITION));
    for (const r of topicNodes) visibleTopicIds.add(r.topicId);
  }

  // 节点收藏：只保留仍 active 的节点
  const visibleNodeIds = new Set<number>();
  if (collectedNodeIds.length > 0) {
    const visibleNodes = await db
      .select({ id: schema.nodes.id })
      .from(schema.nodes)
      .where(and(inArray(schema.nodes.id, collectedNodeIds), PUBLIC_NODE_CONDITION));
    for (const r of visibleNodes) visibleNodeIds.add(r.id);
  }

  // 主题已被彻底删除的收藏：topicId 为 NULL（leftJoin 未命中），同样不展示
  const topicRows = rows.filter(
    (r) => r.target === 'topic' && r.topicId !== null && visibleTopicIds.has(r.topicId),
  );
  const nodeRows = rows.filter(
    (r) => r.target === 'node' && r.nodeId !== null && visibleNodeIds.has(r.nodeId),
  );

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
