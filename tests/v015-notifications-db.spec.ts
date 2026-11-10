import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { listNotificationsForUser, listRecentNotifications } from '../src/server/notifications';

/**
 * 通知可见性的**真实数据库**回归测试（v0.0.15 P0-1）
 *
 * ## 这条缺陷是怎么发现的
 *
 * v0.0.14 的发布后独立验收里，通知只有一条 WARN（"需第二用户"），
 * 于是通知从未被端到端证明过。本轮做真实双用户验收时顺着看通知查询，
 * 发现 `GET /api/notifications` 与 `/notifications` 页面**都没有 join
 * topics / nodes** —— 而通知的 `message` 是在**写入时**拼好的字符串，
 * 里面嵌了主题标题：
 *
 *     `${actor} 回复了你的主题：${topic.title}`
 *     `${actor} 在回复 #${floor} 中提及了你：${topic.title}`
 *
 * 于是节点变成 `hidden`（或主题被软删除）之后：
 *   · 主题页 `/t/{id}` 已经 404 —— 封存动作对公共页面生效了；
 *   · 通知收件箱却照常返回那条标题 —— **封存对收件箱没生效**。
 *
 * 更严重的是「提及通知」的收件人是**任意被 @ 的第三方**，
 * 不是主题作者 —— 这不是「作者本来就知道标题」能解释掉的情形。
 *
 * ## 为什么必须有真库测试
 *
 * E2E 能证明「用户看不到」，但它跑得慢、且只覆盖一条路径。
 * 这里的价值是把**判据本身**（`visibleNotificationCondition`）按组合矩阵钉死：
 * 隐藏节点 / 悬空主题 / 软删主题 / 软删回复 / 正常主题 / 系统通知，
 * 六种情形一次算清，并逐个断言 total / unread 与列表**同口径**。
 *
 * 数据库隔离：专用库 `v2ex_v015_notif`，不碰开发库。
 */

const TEST_DB = process.env.V015_NOTIF_TEST_DB ?? 'v2ex_v015_notif';

process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);
{
  const g = globalThis as unknown as { __v2exSql?: unknown; __v2exDrizzle?: unknown };
  g.__v2exSql = undefined;
  g.__v2exDrizzle = undefined;
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

let activeNodeId = 0;
let hiddenNodeId = 0;
let pendingNodeId = 0;
let authorId = 0;
let actorId = 0;

/**
 * 造一条通知并返回 { notificationId, topicId, replyId }
 *
 * 刻意用**直接插入**而不是走 HTTP：本测试要验证的是**读取侧**的可见性判据，
 * 写入侧由 E2E 覆盖。直接插入才能精确构造"主题属于 hidden 节点"
 * 这类经由 HTTP 无法稳定复现的状态。
 */
async function makeNotification(opts: {
  userId: number;
  type: 'reply' | 'mention' | 'topic_thanks' | 'system';
  nodeId?: number | null;
  topicDeleted?: boolean;
  replyDeleted?: boolean;
  withReply?: boolean;
  withTopic?: boolean;
  read?: boolean;
}): Promise<{ id: number; topicId: number | null; replyId: number | null }> {
  let topicId: number | null = null;
  let replyId: number | null = null;

  if (opts.withTopic !== false) {
    const [topic] = await db
      .insert(schema.topics)
      .values({
        title: `v015 通知可见性主题 ${Math.random().toString(36).slice(2, 8)}`,
        content: 'v0.0.15 通知可见性真库测试正文（长度足够）',
        nodeId: opts.nodeId ?? activeNodeId,
        authorId,
        ...(opts.topicDeleted ? { deletedAt: new Date(), status: 'deleted' as const } : {}),
      })
      .returning({ id: schema.topics.id });
    topicId = topic.id;

    if (opts.withReply !== false) {
      const [reply] = await db
        .insert(schema.replies)
        .values({
          topicId,
          authorId,
          content: 'v0.0.15 通知可见性回复正文',
          floor: Math.floor(Math.random() * 100000) + 1,
          ...(opts.replyDeleted ? { deletedAt: new Date() } : {}),
        })
        .returning({ id: schema.replies.id });
      replyId = reply.id;
    }
  }

  const [row] = await db
    .insert(schema.notifications)
    .values({
      userId: opts.userId,
      type: opts.type,
      actorId,
      topicId,
      replyId,
      message: `测试通知：${opts.type}`,
      read: opts.read ?? false,
    })
    .returning({ id: schema.notifications.id });

  return { id: row.id, topicId, replyId };
}

beforeAll(async () => {
  logDbTarget('tests/v015-notifications-db.spec.ts', TEST_DB);

  await provisionTestDatabase({
    file: 'tests/v015-notifications-db.spec.ts',
    db: TEST_DB,
    adminUrl: adminUrlOf(TEST_DB),
    migrate: () =>
      runDrizzleKit(['migrate'], {
        ...process.env,
        ENV_FILE: '',
        DATABASE_URL: dbUrlFor(TEST_DB),
      }),
  });

  client = postgres(dbUrlFor(TEST_DB), { prepare: false, max: 10 });
  db = drizzle(client, { schema });

  const [cat] = await db
    .insert(schema.categories)
    .values({ name: 'v015notifcat', title: 'V015 通知分类' })
    .returning({ id: schema.categories.id });

  const mkNode = async (name: string, status: 'active' | 'hidden' | 'pending') => {
    const [n] = await db
      .insert(schema.nodes)
      .values({ name, title: name, categoryId: cat.id, status })
      .returning({ id: schema.nodes.id });
    return n.id;
  };

  activeNodeId = await mkNode('v015notifactive', 'active');
  hiddenNodeId = await mkNode('v015notifhidden', 'hidden');
  pendingNodeId = await mkNode('v015notifpending', 'pending');

  const [author] = await db
    .insert(schema.users)
    .values({ username: 'v015_notif_author', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  authorId = author.id;

  const [actor] = await db
    .insert(schema.users)
    .values({ username: 'v015_notif_actor', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  actorId = actor.id;
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
});

describe('通知可见性：隐藏节点 / 软删除一律不出现在收件箱', () => {
  it('active 节点下的通知可见（基线 —— 否则后面的"不可见"没有鉴别力）', async () => {
    const n = await makeNotification({ userId: authorId, type: 'reply' });
    const res = await listNotificationsForUser(authorId, { limit: 100 });
    expect(
      res.items.some((x) => x.id === n.id),
      'active 节点下的通知必须可见，否则本文件全部断言都失去意义',
    ).toBe(true);
  });

  it('hidden 节点下的通知不可见（message 里嵌了主题标题，属于跨用户泄露）', async () => {
    const n = await makeNotification({
      userId: authorId,
      type: 'mention',
      nodeId: hiddenNodeId,
    });
    const res = await listNotificationsForUser(authorId, { limit: 100 });
    expect(
      res.items.some((x) => x.id === n.id),
      'hidden 节点下的通知不得出现在收件箱（否则 hidden 对收件箱不生效）',
    ).toBe(false);
  });

  it('pending 节点下的通知同样不可见（与 active 以外的所有状态一致）', async () => {
    const n = await makeNotification({
      userId: authorId,
      type: 'reply',
      nodeId: pendingNodeId,
    });
    const res = await listNotificationsForUser(authorId, { limit: 100 });
    expect(res.items.some((x) => x.id === n.id)).toBe(false);
  });

  it('主题被软删除后通知不可见（否则把已删内容带回可见面）', async () => {
    const n = await makeNotification({
      userId: authorId,
      type: 'reply',
      topicDeleted: true,
    });
    const res = await listNotificationsForUser(authorId, { limit: 100 });
    expect(res.items.some((x) => x.id === n.id)).toBe(false);
  });

  it('回复被软删除后通知不可见（否则链到已消失的楼层）', async () => {
    const n = await makeNotification({
      userId: authorId,
      type: 'topic_thanks',
      replyDeleted: true,
    });
    const res = await listNotificationsForUser(authorId, { limit: 100 });
    expect(res.items.some((x) => x.id === n.id)).toBe(false);
  });

  it('系统通知（topicId 为 null）**始终可见** —— 它不指向任何主题内容', async () => {
    const n = await makeNotification({
      userId: authorId,
      type: 'system',
      withTopic: false,
    });
    const res = await listNotificationsForUser(authorId, { limit: 100 });
    expect(
      res.items.some((x) => x.id === n.id),
      '系统通知不指向主题，不能被可见性判据误杀（内连接会犯这个错）',
    ).toBe(true);
  });

  it('系统通知**带 topicId** 时仍然可见 —— 即使在主题已被删的情况下', async () => {
    // ⚠️ 这是本文件第一版**漏掉**的真实场景，也是那一版修复引入的回归：
    //    `/api/admin/reports/[id]/handle` 在 `action=accept` 时会先把
    //    **被举报的主题软删除**，然后才写一条 `type='system'` 的通知 ——
    //    而那条通知的 topicId 指向的正是刚被删掉的主题。
    //    「只判断主题可见性」的判据会把它一起过滤掉 ⇒
    //    **举报人永远收不到「你的举报有结果了」**。
    //    语义上它也不该被过滤：文案里不含任何主题内容。
    const n = await makeNotification({
      userId: authorId,
      type: 'system',
      topicDeleted: true,
    });
    const res = await listNotificationsForUser(authorId, { limit: 100 });
    expect(
      res.items.some((x) => x.id === n.id),
      '系统通知即使指向已删主题也必须可见 —— 否则举报人收不到处理结果',
    ).toBe(true);
  });

  it('系统通知带 topicId 且节点 hidden 时仍然可见', async () => {
    const n = await makeNotification({
      userId: authorId,
      type: 'system',
      nodeId: hiddenNodeId,
    });
    const res = await listNotificationsForUser(authorId, { limit: 100 });
    expect(
      res.items.some((x) => x.id === n.id),
      '系统通知不含主题内容，不应因节点 hidden 而丢失（否则用户永远不知道处理结果）',
    ).toBe(true);
  });

  it('隐藏节点的通知**数据未被删除** —— 节点恢复 active 后重新可见', async () => {
    const n = await makeNotification({
      userId: authorId,
      type: 'mention',
      nodeId: hiddenNodeId,
    });

    const before = await listNotificationsForUser(authorId, { limit: 100 });
    expect(before.items.some((x) => x.id === n.id)).toBe(false);

    // 把节点改回 active
    await db
      .update(schema.nodes)
      .set({ status: 'active' })
      .where(eq(schema.nodes.id, hiddenNodeId));

    const after = await listNotificationsForUser(authorId, { limit: 100 });
    expect(
      after.items.some((x) => x.id === n.id),
      '节点恢复后通知应重新可见 —— 说明这是读取时过滤，不是把数据删了',
    ).toBe(true);

    // 改回 hidden，避免污染后续用例
    await db
      .update(schema.nodes)
      .set({ status: 'hidden' })
      .where(eq(schema.nodes.id, hiddenNodeId));
  });
});

describe('通知可见性：total / unread 必须与列表**同口径**', () => {
  it('total 等于当前用户可见通知条数', async () => {
    const res = await listNotificationsForUser(authorId, { limit: 100 });
    expect(
      res.total,
      'total 必须等于可见条数（否则会出现「列表 0 条、角标 5 条」）',
    ).toBe(res.items.length);
  });

  it('unread 等于可见且未读的条数', async () => {
    const res = await listNotificationsForUser(authorId, { limit: 100 });
    expect(res.unread).toBe(res.items.filter((n) => !n.read).length);
  });

  it('unreadOnly=true 时 items 只含未读，且 unread 不变', async () => {
    const all = await listNotificationsForUser(authorId, { limit: 100 });
    const onlyUnread = await listNotificationsForUser(authorId, {
      limit: 100,
      unreadOnly: true,
    });
    expect(onlyUnread.items.every((n) => !n.read)).toBe(true);
    expect(onlyUnread.items.length).toBe(all.unread);
    expect(onlyUnread.unread, 'unread 不应因过滤条件而改变').toBe(all.unread);
  });

  it('分页（limit/offset）不改变 total / unread', async () => {
    const full = await listNotificationsForUser(authorId, { limit: 100 });
    const page = await listNotificationsForUser(authorId, { limit: 1, offset: 0 });
    expect(page.total).toBe(full.total);
    expect(page.unread).toBe(full.unread);
    expect(page.items.length).toBeLessThanOrEqual(1);
  });

  it('limit 被钳制在 1..100（不得被超大值击穿）', async () => {
    const res = await listNotificationsForUser(authorId, { limit: 99999 });
    expect(res.items.length).toBeLessThanOrEqual(100);
  });
});

describe('通知可见性：用户隔离', () => {
  it('A 的通知不会出现在 B 的收件箱（即使同属一个主题）', async () => {
    const forAuthor = await makeNotification({ userId: authorId, type: 'reply' });
    const res = await listNotificationsForUser(actorId, { limit: 100 });
    expect(
      res.items.some((x) => x.id === forAuthor.id),
      '通知必须按收件人隔离 —— 这是最基础的隐私边界',
    ).toBe(false);
  });
});

describe('通知可见性：侧栏「最近的通知」同样受判据约束', () => {
  it('隐藏节点的通知不出现在 recent 列表（右栏曾是独立泄露路径）', async () => {
    const hidden = await makeNotification({
      userId: authorId,
      type: 'mention',
      nodeId: hiddenNodeId,
    });
    const active = await makeNotification({ userId: authorId, type: 'reply' });

    const recent = await listRecentNotifications(authorId, 50);
    expect(
      recent.some((x) => x.id === hidden.id),
      '侧栏是**独立查询**，若不加同一判据，即使列表修好了右栏仍会泄露',
    ).toBe(false);
    expect(recent.some((x) => x.id === active.id)).toBe(true);
  });

  it('recent 的条数受 limit 约束', async () => {
    const recent = await listRecentNotifications(authorId, 2);
    expect(recent.length).toBeLessThanOrEqual(2);
  });
});
