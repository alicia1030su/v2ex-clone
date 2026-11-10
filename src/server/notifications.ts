import 'server-only';
import { and, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/db';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';

/**
 * 通知的**公共可见性判据**（v0.0.15 P0-1）
 *
 * ## 为什么单独立一个模块
 *
 * v0.0.14 把「非 active 节点的内容不可见」收敛到 `src/lib/node-visibility.ts`，
 * 覆盖了站内页面、站内 API、旧版 API、Feed —— 但**漏了通知收件箱**。
 * 通知的 `message` 是**在写入时**拼好的字符串，里面嵌了主题标题：
 *
 *     `${actor} 回复了你的主题：${topic.title}`
 *     `${actor} 在回复 #${floor} 中提及了你：${topic.title}`
 *
 * 于是节点变成 `hidden`（或主题被软删除）之后：
 *   · 主题页 `/t/{id}` 已经 404 —— 内容确实不可访问；
 *   · 但 `/notifications` 与 `GET /api/notifications` **照常返回那条标题**。
 *
 * 也就是说：**封存动作对公共页面生效了，对通知收件箱没生效。**
 * 而「提及通知」的收件人是**任意被 @ 的第三方**，不是主题作者 ——
 * 这不是「作者本来就知道标题」能解释掉的情形，是真实的跨用户泄露。
 *
 * 同类问题还有**软删除**：主题或回复被删后，通知仍展示其标题并链到 404 页面。
 *
 * ## 判据
 *
 * 一条通知对收件人可见，当且仅当它指向的**主题**仍然公开可见：
 *   ① 通知不指向任何主题（`topicId IS NULL`，系统通知）—— 可见；
 *   ② 否则：主题未被软删除、状态仍为 `published`、所在节点为 `active`；
 *   ③ 且：若通知指向某条**回复**，该回复未被软删除
 *      （否则「X 感谢了你的回复」会链到一个已消失的楼层）。
 *
 * ## 为什么不做「按角色自动切换」
 *
 * 通知收件箱是**私人的**，不存在「审核员需要在这里复核隐藏内容」的场景 ——
 * staff 要复核应该去 `/t/{id}`（那里有显式的 `includeHiddenNode` 入口）。
 * 在这里加角色分支只会让同一份 SQL 在不同上下文语义不同，
 * 正是 `node-visibility.ts` 注释里点名要避免的做法。
 *
 * ## 列表与 count 必须**同口径**
 *
 * 这是 v0.0.14 反复强调的纪律：列表过滤了、总数没过滤，会出现
 * 「显示 0 条、角标却是 5」这类错位。本模块把 join 与 where 都收敛到
 * 两个共享构造器里，list / total / unread 三处**不可能各写一份**。
 */

/**
 * 构造「该通知对收件人可见」的 SQL 条件。
 *
 * ⚠️ 前置条件：调用方**必须**已经 LEFT JOIN 了 topics / nodes / replies。
 * 用 LEFT JOIN 而不是 INNER JOIN —— 否则系统通知（`topicId IS NULL`）
 * 会被内连接直接筛掉，表现为「系统消息全部消失」。
 */
export function visibleNotificationCondition(): SQL | undefined {
  return or(
    // ① 系统通知：**始终可见**
    //
    // ⚠️ 这一条不能省，也不能只写成 `topicId IS NULL`。
    //
    // 实测踩到（本文件第一版）：`/api/admin/reports/[id]/handle` 在
    // `action=accept` 时会把**被举报的主题软删除**，紧随其后给举报人写一条
    // `type='system'` 的通知 —— 而那条通知的 `topicId` 指向的正是刚被删的主题。
    // 于是「只判断主题可见性」的判据会把它一起过滤掉 ⇒
    // **举报人永远收不到「你的举报有结果了」**，而这恰恰是用户最需要的那条反馈。
    //
    // 语义上也不该过滤：系统通知的文案是
    // 「你举报的内容已被处理（备注）」，**不含任何主题内容**，
    // 它只是告诉用户"处理完了"，不构成内容泄露。
    eq(schema.notifications.type, 'system'),
    // ② 不指向任何主题的通知（如节点申请结果）也始终可见
    isNull(schema.notifications.topicId),
    and(
      // ② 主题未被软删除、状态仍是 published
      isNull(schema.topics.deletedAt),
      eq(schema.topics.status, 'published'),
      // ③ 所在节点必须公开可见（全仓唯一判据）
      PUBLIC_NODE_CONDITION,
      // ④ 若指向具体回复，回复也不能是已删除的
      or(isNull(schema.notifications.replyId), isNull(schema.replies.deletedAt)),
    ),
  );
}

/**
 * 带可见性 join 的查询基座。
 *
 * 三处查询（列表 / 总数 / 未读数）都从这里出发 ——
 * 「各写一份 join」正是这个缺陷的成因，不能再用一遍。
 */
function visibleNotificationIds(userId: number) {
  return db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .leftJoin(schema.topics, eq(schema.topics.id, schema.notifications.topicId))
    .leftJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .leftJoin(schema.replies, eq(schema.replies.id, schema.notifications.replyId))
    .where(
      and(eq(schema.notifications.userId, userId), visibleNotificationCondition()),
    );
}

/** 通知列表项（对外形状，字段名与 v0.0.3 起的 API 契约一致） */
export type NotificationItem = {
  id: number;
  type: string;
  actorId: number | null;
  topicId: number | null;
  replyId: number | null;
  message: string;
  read: boolean;
  createdAt: Date;
};

export type RecentNotification = {
  id: number;
  message: string;
  read: boolean;
  createdAt: Date;
  topicId: number | null;
};

export type ListNotificationsResult = {
  items: NotificationItem[];
  /** 可见通知总数（与 items 同口径） */
  total: number;
  /** 可见未读数（与 items 同口径） */
  unread: number;
};

/**
 * 读取某用户的通知：**列表 + 总数 + 未读数**。
 *
 * 总数与未读数在**同一次聚合查询**里算出（`count(*) FILTER`），
 * 从结构上杜绝「两条 SQL 口径不一致」。
 */
export async function listNotificationsForUser(
  userId: number,
  opts: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
): Promise<ListNotificationsResult> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  const visible = inArray(schema.notifications.id, visibleNotificationIds(userId));

  const listWhere = opts.unreadOnly
    ? and(visible, eq(schema.notifications.read, false))
    : visible;

  const items = await db
    .select({
      id: schema.notifications.id,
      type: schema.notifications.type,
      actorId: schema.notifications.actorId,
      topicId: schema.notifications.topicId,
      replyId: schema.notifications.replyId,
      message: schema.notifications.message,
      read: schema.notifications.read,
      createdAt: schema.notifications.createdAt,
    })
    .from(schema.notifications)
    .where(listWhere)
    .orderBy(desc(schema.notifications.id))
    .limit(limit)
    .offset(offset);

  // 总数与未读数在**同一次聚合**里算出（`count(*) FILTER`），
  // 从结构上杜绝「两条 SQL 口径不一致」。
  const statRows = await db
    .select({
      total: count(),
      unread: sql<number>`count(*) filter (where ${schema.notifications.read} = false)`,
    })
    .from(schema.notifications)
    .where(visible);

  const stat = statRows[0] as { total: number; unread: number } | undefined;

  return {
    items: items as NotificationItem[],
    total: Number(stat?.total ?? 0),
    unread: Number(stat?.unread ?? 0),
  };
}

/**
 * 侧栏「最近的通知」—— 与列表**同一口径**。
 *
 * `/notifications` 页面的右栏原本直接查 `notifications` 表，绕过了可见性判据；
 * 那意味着即使列表修好了，右栏仍会显示隐藏节点的标题。
 */
export async function listRecentNotifications(
  userId: number,
  limit = 5,
): Promise<RecentNotification[]> {
  return (await db
    .select({
      id: schema.notifications.id,
      message: schema.notifications.message,
      read: schema.notifications.read,
      createdAt: schema.notifications.createdAt,
      topicId: schema.notifications.topicId,
    })
    .from(schema.notifications)
    .where(inArray(schema.notifications.id, visibleNotificationIds(userId)))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit)) as RecentNotification[];
}
