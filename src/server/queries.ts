import 'server-only';
import { and, desc, eq, ilike, or, sql, count, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@/db';

/** 每页主题数量 —— 原站观察：首页与节点页每页 20 条主题 */
export const TOPICS_PER_PAGE = 20;
/** 每页回复数 —— 原站主题详情页分页每页 20 条回复 */
export const REPLIES_PER_PAGE = 20;

export type TopicListItem = {
  id: number;
  title: string;
  votes: number;
  repliesCount: number;
  createdAt: Date;
  lastReplyAt: Date;
  author: { id: number; username: string; avatar: string | null };
  node: { id: number; name: string; title: string };
  lastReplier: { id: number; username: string } | null;
};

/**
 * 主题排序表达式（v0.0.4）。
 *
 * 单独抽出来是为了让 listTopics 与未来的 /hot、/recent 页面共用同一套
 * 排序口径 —— 避免「首页热门」与「热门页」排序不一致。
 */
function topicOrder(sort: 'latest' | 'hot' | 'created' | undefined) {
  switch (sort) {
    case 'hot':
      return [desc(schema.topics.votes), desc(schema.topics.repliesCount), desc(schema.topics.id)];
    case 'created':
      return [desc(schema.topics.createdAt), desc(schema.topics.id)];
    case 'latest':
    default:
      return [desc(schema.topics.lastReplyAt), desc(schema.topics.id)];
  }
}

export async function listTopics(opts: {
  nodeName?: string;
  nodeId?: number;
  categoryName?: string;
  tab?: string;
  page?: number;
  perPage?: number;
  authorUsername?: string;
  keyword?: string;
  /**
   * 排序方式（v0.0.4 新增）：
   *  - 'latest'（默认）按最后回复时间倒序
   *  - 'hot'    按投票数 + 回复数倒序（原站「热门」）
   *  - 'created'按创建时间倒序（原站「最新」）
   */
  sort?: 'latest' | 'hot' | 'created';
}): Promise<{ items: TopicListItem[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = opts.perPage ?? TOPICS_PER_PAGE;
  const offset = (page - 1) * perPage;

  const conditions = [eq(schema.topics.status, 'published')];

  if (opts.nodeId != null) {
    conditions.push(eq(schema.topics.nodeId, opts.nodeId));
  }
  if (opts.authorUsername) {
    const users = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.username}) = lower(${opts.authorUsername})`)
      .limit(1);
    if (users.length === 0) return { items: [], total: 0 };
    conditions.push(eq(schema.topics.authorId, users[0].id));
  }
  if (opts.keyword) {
    const kw = `%${opts.keyword.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    conditions.push(
      or(
        ilike(schema.topics.title, kw),
        ilike(schema.topics.content, kw),
      )!,
    );
  }

  const where = and(...conditions);

  const rows = await db
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
    .where(where)
    .orderBy(...topicOrder(opts.sort))
    .limit(perPage)
    .offset(offset);

  const totalRows = await db
    .select({ n: count() })
    .from(schema.topics)
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(where);

  const ids = rows.map((r) => r.id);
  let lastRepliers: Map<number, { id: number; username: string }> = new Map();
  if (ids.length > 0) {
    const lastReplies = await db
      .select({
        topicId: schema.replies.topicId,
        id: schema.users.id,
        username: schema.users.username,
        createdAt: schema.replies.createdAt,
      })
      .from(schema.replies)
      .innerJoin(schema.users, eq(schema.users.id, schema.replies.authorId))
      .where(inArray(schema.replies.topicId, ids))
      .orderBy(desc(schema.replies.createdAt), desc(schema.replies.id));

    for (const lr of lastReplies) {
      if (!lastRepliers.has(lr.topicId)) {
        lastRepliers.set(lr.topicId, { id: lr.id, username: lr.username });
      }
    }
  }

  return {
    total: Number(totalRows[0]?.n ?? 0),
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      votes: r.votes,
      repliesCount: r.repliesCount,
      createdAt: r.createdAt,
      lastReplyAt: r.lastReplyAt,
      author: { id: r.authorId, username: r.authorName, avatar: r.authorAvatar },
      node: { id: r.nodeId, name: r.nodeName, title: r.nodeTitle },
      lastReplier: lastRepliers.get(r.id) ?? null,
    })),
  };
}

/** 多节点聚合列表（首页最热 tab 用） */
export async function listTopicsByNodeIds(
  nodeIds: number[],
  page = 1,
  perPage = TOPICS_PER_PAGE,
): Promise<{ items: TopicListItem[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * perPage;
  const where = and(
    eq(schema.topics.status, 'published'),
    inArray(schema.topics.nodeId, nodeIds),
  );

  const rows = await db
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
    .where(where)
    .orderBy(desc(schema.topics.votes), desc(schema.topics.repliesCount), desc(schema.topics.id))
    .limit(perPage)
    .offset(offset);

  const totalRows = await db
    .select({ n: count() })
    .from(schema.topics)
    .where(where);

  return {
    total: Number(totalRows[0]?.n ?? 0),
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      votes: r.votes,
      repliesCount: r.repliesCount,
      createdAt: r.createdAt,
      lastReplyAt: r.lastReplyAt,
      author: { id: r.authorId, username: r.authorName, avatar: r.authorAvatar },
      node: { id: r.nodeId, name: r.nodeName, title: r.nodeTitle },
      lastReplier: null,
    })),
  };
}

export async function getNodeByName(name: string) {
  const rows = await db
    .select()
    .from(schema.nodes)
    .where(eq(schema.nodes.name, name))
    .limit(1);
  return rows[0] ?? null;
}

export async function getNodeById(id: number) {
  const rows = await db.select().from(schema.nodes).where(eq(schema.nodes.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listCategories() {
  return db
    .select()
    .from(schema.categories)
    .orderBy(schema.categories.sort, schema.categories.id);
}

export async function listNodesByCategory(categoryId?: number) {
  if (categoryId == null) {
    return db.select().from(schema.nodes).orderBy(schema.nodes.name);
  }
  return db
    .select()
    .from(schema.nodes)
    .where(eq(schema.nodes.categoryId, categoryId))
    .orderBy(schema.nodes.name);
}

export async function getUserByUsername(username: string) {
  const rows = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.username}) = lower(${username})`)
    .limit(1);
  return rows[0] ?? null;
}

export async function getTopicById(id: number) {
  const rows = await db.select().from(schema.topics).where(eq(schema.topics.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * 列出主题的回复（分页）。
 *
 * v0.0.3：**默认过滤掉软删除的回复** —— 已删除内容不得通过普通页面泄露。
 * 管理员/作者可通过 includeDeleted 显式查看（带删除标记）。
 */
export async function listReplies(
  topicId: number,
  page = 1,
  perPage = REPLIES_PER_PAGE,
  opts: { includeDeleted?: boolean } = {},
) {
  const offset = (Math.max(1, page) - 1) * perPage;
  const conditions = [eq(schema.replies.topicId, topicId)];
  if (!opts.includeDeleted) {
    conditions.push(isNull(schema.replies.deletedAt));
  }
  const rows = await db
    .select({
      id: schema.replies.id,
      floor: schema.replies.floor,
      content: schema.replies.content,
      thanks: schema.replies.thanks,
      quoteId: schema.replies.quoteId,
      createdAt: schema.replies.createdAt,
      editedAt: schema.replies.editedAt,
      editCount: schema.replies.editCount,
      deletedAt: schema.replies.deletedAt,
      userId: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
      role: schema.users.role,
    })
    .from(schema.replies)
    .innerJoin(schema.users, eq(schema.users.id, schema.replies.authorId))
    .where(and(...conditions))
    .orderBy(schema.replies.floor)
    .limit(perPage)
    .offset(offset);

  const totalRows = await db
    .select({ n: count() })
    .from(schema.replies)
    .where(eq(schema.replies.topicId, topicId));

  return { items: rows, total: Number(totalRows[0]?.n ?? 0) };
}

export async function listHotTopics(limit = 10) {
  const rows = await db
    .select({
      id: schema.topics.id,
      title: schema.topics.title,
      authorId: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
    })
    .from(schema.topics)
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .where(eq(schema.topics.status, 'published'))
    .orderBy(desc(schema.topics.votes), desc(schema.topics.repliesCount))
    .limit(limit);
  return rows;
}

export async function getUnreadNotificationCount(userId: number) {
  const rows = await db
    .select({ n: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.read, false)));
  return Number(rows[0]?.n ?? 0);
}

/**
 * 在线人数
 *
 * 原站显示实时在线人数与历史最高记录。
 * 本项目用最近 15 分钟内有活动（登录/发帖/回复）的用户数近似，
 * 统计自真实数据库，不是静态假数据。
 */
export async function getOnlineCount(): Promise<number> {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const rows = await db
    .select({ n: count() })
    .from(schema.users)
    // drizzle 的 sql 模板不接受 Date 实例，需传 ISO 字符串
    .where(sql`${schema.users.lastActiveAt} > ${since.toISOString()}`);
  return Number(rows[0]?.n ?? 0);
}

/**
 * 历史最高在线记录
 *
 * v0.0.10 修复：页脚原先写 `{online} + 3835` —— 那个 **3835 是硬编码常数**，
 * 直接把原站的「最高记录」搬了过来。后果：
 *   ① 显示的是**原站的数据**，与本实例无关；
 *   ② 它是「当前在线 + 常数」，于是「最高记录」会跟着在线人数上涨而虚增，
 *      永远大于当前在线，看起来像真的，但其实没有任何记录语义。
 *
 * 改为**真的记录**：每次调用把当前在线数写入 KV（只在新高时覆盖），
 * 返回 `max(当前, 历史高点)`。存储走既有 KV 抽象（Redis / PG 降级两套后端
 * 语义一致），因此在没有 Redis 的部署上同样有效。
 *
 * 注意 read-then-write 不是原子操作：并发下偶尔会少记一个峰值，但**不会虚增**，
 * 且「最高记录」本身是展示型指标 —— 用 KV 的 get/set 已足够，不值得为它引入锁。
 */
const PEAK_ONLINE_KEY = 'stats:peak_online';

export async function getOnlinePeak(current: number): Promise<number> {
  const { getKV } = await import('@/lib/kv');
  const kv = await getKV();
  const raw = await kv.get(PEAK_ONLINE_KEY);
  const stored = Number(raw ?? 0);
  const peak = Math.max(current, Number.isFinite(stored) ? stored : 0);
  if (peak > stored) {
    // 峰值没有过期时间 —— 它是累计记录，不该因为一段时间没人访问就被清掉
    await kv.set(PEAK_ONLINE_KEY, String(peak));
  }
  return peak;
}
