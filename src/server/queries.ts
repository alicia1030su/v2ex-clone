import 'server-only';
import { and, desc, eq, ilike, or, sql, count, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@/db';
import { extractRows } from '@/server/sql-rows';
import { PUBLIC_NODE_CONDITION, isPublicNodeStatus } from '@/lib/node-visibility';

/**
 * 站内页面 / 站内 API 的**公共**读取层。
 *
 * ## 节点可见性（v0.0.14 P0-1）
 *
 * 节点状态（`pending` / `hidden`）在 v0.0.13 只被**旧版 API 与 Feed** 尊重，
 * 站内页面与站内 API 完全没有过滤 —— 同一个隐藏节点下的主题在
 * `/api/topics/show.json` 里看不到，却能通过 `/tag/x`、`/go/search`、
 * `/api/search`、`/following`、`/bookmarks`、`/member/x`、
 * `/t/{id}`（直接输入 URL）看到。也就是说**隐藏节点对普通用户仍可读**。
 *
 * 修复口径：本模块所有面向**公共访问者**的查询都带 `PUBLIC_NODE_CONDITION`
 * （定义在 `src/lib/node-visibility.ts`，全仓唯一），并且**列表与 count 用同一个
 * where** —— 否则会出现「列表隐藏了、总数没隐藏」的分页错位。
 *
 * 需要跨过该口径的只有两类**显式**例外：
 *  - 详情页 / 详情 API 的审核入口：`opts.includeHiddenNode`
 *    （调用方用 `canReviewHiddenNodes(user)` 决定，不在这里猜角色）；
 *  - 节点查询的 `opts.includeHidden`：给后台审核用。
 *
 * 不要在这里引入「按 viewer 角色自动切换过滤」的隐式分支 ——
 * 那会让同一份 SQL 在不同上下文语义不同，正是本缺陷的成因。
 */

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
 * 主题列表查询的统一返回形状。
 *
 * 用具名类型而不是在签名里内联对象字面量，是为了让「列表 + 独立总数」
 * 这件事只有一个声明处：所有公共列表（首页 / 节点页 / 标签页 / 会员页）
 * 必须同时给出 `total`，任何一处漏掉 `total` 都会立刻类型报错。
 */
export type TopicListResult = { items: TopicListItem[]; total: number };

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

/**
 * 批量取「每个主题的最后回复者」—— 一页 20 个主题各取 1 行。
 *
 * ## v0.0.16 修掉的两个真实问题（都有实测证据）
 *
 * ### ① 读放大：按页取 20 条，却按帖读全量
 *
 * 修复前的写法是把这一页 20 个主题的**全部回复**（不限条数）都查出来，
 * 再在 JS 里按 `createdAt` 倒序取「每个主题的第一条」。
 *
 * 实测（`v2ex_v016_loadtest`：2000 主题 / 22990 回复，其中 1 个长帖 2990 回复）：
 *
 *     Sort ... rows=3190      ← 为 20 个「最后回复者」读了 3190 行
 *
 * 代价与本页最长帖的回复数成正比：首页出现一个 3000 楼的帖子就多读 3000 行，
 * 5 万楼就是 5 万行。
 *
 * 修法：`LATERAL (... LIMIT 1)` —— 每个主题只取 1 行。
 * 同一数据集实测 **rows=20**，代价从「与本页最长帖回复数成正比」
 * 变成「与主题数成正比」。
 *
 * ⚠️ 不用 `DISTINCT ON (topic_id)`：它仍要把 3190 行排完序再取唯一值
 *    （实测 rows 仍是 3190，只是输出 20 行），读放大没有消失。
 *
 * ### ② 数据错误：「最热」tab 的最后回复者是**假的**
 *
 * `listTopicsByNodeIds()`（首页「最热」tab）此前把 `lastReplier` 硬编码为 `null`，
 * 而 `TopicItem` 在 `lastReplier === null` 时**回退成作者名**：
 *
 *     {topic.lastReplier?.username ?? topic.author.username}
 *
 * 于是「最热」tab 上每一行都写着 `最后回复来自 <楼主>` —— 一个看起来完全正常、
 * 但**内容是错的**的字段。实测该 tab 前 6 条里有 **5 条**真实最后回复者 ≠ 楼主
 * （例如 `群晖 NAS 如何防止中勒索软件？` 楼主 `lisi`，真实最后回复者 `admin`）。
 *
 * 修复方式不是「把 null 藏起来」，而是**两处列表都算真实值**：
 * 本函数抽出共享实现，`listTopics` 与 `listTopicsByNodeIds` 都调用它。
 * 组件侧只在**确实没有回复**时不渲染该片段（见 `TopicItem`）。
 */
async function loadLastRepliers(ids: number[]): Promise<Map<number, { id: number; username: string }>> {
  const out = new Map<number, { id: number; username: string }>();
  if (ids.length === 0) return out;

  const lastRows = await db.execute(sql`
    SELECT t.id AS topic_id, u.id AS user_id, u.username
    FROM topics t
    CROSS JOIN LATERAL (
      SELECT r.author_id
      FROM replies r
      WHERE r.topic_id = t.id
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 1
    ) lr
    JOIN users u ON u.id = lr.author_id
    WHERE t.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);

  for (const lr of extractRows<{ topic_id: number; user_id: number; username: string }>(lastRows)) {
    out.set(Number(lr.topic_id), { id: Number(lr.user_id), username: lr.username });
  }
  return out;
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
}): Promise<TopicListResult> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = opts.perPage ?? TOPICS_PER_PAGE;
  const offset = (page - 1) * perPage;

  const conditions = [
    eq(schema.topics.status, 'published'),
    // 隐藏 / 待审节点下的主题不进入公共列表（v0.0.14 P0-1）。
    // 列表查询与下面的 count 查询共用同一个 `where`，两者天然同口径。
    PUBLIC_NODE_CONDITION,
  ];

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
  const lastRepliers = await loadLastRepliers(ids);

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
): Promise<TopicListResult> {
  const offset = (Math.max(1, page) - 1) * perPage;
  const where = and(
    eq(schema.topics.status, 'published'),
    inArray(schema.topics.nodeId, nodeIds),
    // v0.0.14 P0-1：即使调用方把隐藏节点的 id 传进来（例如首页 tab 的
    // 节点名集合里混进了一个已被删除/隐藏的节点），也不得返回其主题。
    PUBLIC_NODE_CONDITION,
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

  // ⚠️ count 必须 join 与列表**同样的表**。
  // 原实现只 `from(topics)`，一旦 where 引用 `nodes.status`（v0.0.14 P0-1）
  // PostgreSQL 会直接报 42P01「缺少 FROM 子句项」—— 首页「最热」tab 恒 500。
  const totalRows = await db
    .select({ n: count() })
    .from(schema.topics)
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(where);

  const ids = rows.map((r) => r.id);
  // v0.0.16：这里此前恒为 `null`，而 TopicItem 会回退成作者名 ⇒
  // 「最热」tab 的「最后回复来自」全部显示楼主（实测 6 条里 5 条是错的）。
  const lastRepliers = await loadLastRepliers(ids);

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

/**
 * 按节点名查询节点。
 *
 * ⚠️ v0.0.14 P0-1：**必须**默认过滤非 active 状态。
 *
 * 这是 `/go/[name]` 能打开隐藏节点的根因：本函数原先
 * `where(eq(nodes.name, name))` 完全没有状态条件，于是
 * `/go/被隐藏的节点` 照常渲染节点头部与主题列表，
 * 连 `/go/{name}` 的 feed 图标都指向可用订阅源。
 *
 * 节点名统一 `.toLowerCase()`，与 `src/lib/node-service.ts` 的同名函数
 * 保持同一口径（Node 名在库里是小写，用户输入可能带大写）。
 *
 * @param opts.includeHidden 显式放行（审核/后台入口用），默认 `false`
 */
export async function getNodeByName(
  name: string,
  opts: { includeHidden?: boolean } = {},
) {
  const conditions = [eq(schema.nodes.name, name.toLowerCase())];
  if (!opts.includeHidden) {
    conditions.push(PUBLIC_NODE_CONDITION);
  }
  const rows = await db
    .select()
    .from(schema.nodes)
    .where(and(...conditions))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 按 id 查询节点（同样默认过滤非 active 状态，见 `getNodeByName` 的说明）。
 */
export async function getNodeById(id: number, opts: { includeHidden?: boolean } = {}) {
  const conditions = [eq(schema.nodes.id, id)];
  if (!opts.includeHidden) {
    conditions.push(PUBLIC_NODE_CONDITION);
  }
  const rows = await db
    .select()
    .from(schema.nodes)
    .where(and(...conditions))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 公共分类列表（`/nodes`、`/go/new`、`/api/nodes?withCategories=true`）。
 *
 * v0.0.14：`categories.hidden = true` 的分类**必须**过滤掉 ——
 * 「禁用」的语义是「公共页面不展示，数据与节点归属保留」。
 * 若这里不过滤，后台点了禁用之后分类仍会在节点目录里出现，
 * 管理员会以为按钮没生效（而数据库里明明已经改了）。
 *
 * 后台需要含禁用分类的完整列表，请用 `src/server/categories.ts`
 * 的 `listAllCategories()`（带 nodesCount）。
 */
export async function listCategories() {
  return db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.hidden, false))
    .orderBy(schema.categories.sort, schema.categories.id);
}

/**
 * 按分类列出节点。
 *
 * v0.0.14 P0-1：隐藏 / 待审节点不得出现在公共节点目录（`/nodes`、`/go/new`）。
 * 过滤用 `PUBLIC_NODE_CONDITION`（而不是这里再写一份状态字面量）。
 *
 * 需要包含隐藏节点的调用方（后台审核）应改用
 * `src/lib/node-service.ts` 的 `listNodes({ includeHidden: true })`。
 */
export async function listNodesByCategory(categoryId?: number) {
  const conditions = [PUBLIC_NODE_CONDITION];
  if (categoryId != null) {
    conditions.push(eq(schema.nodes.categoryId, categoryId));
  }
  return db
    .select()
    .from(schema.nodes)
    .where(and(...conditions))
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

/**
 * 按 id 查询主题（保留 topics 行的完整形状）。
 *
 * v0.0.14 P0-1：节点被转为 pending / hidden 后，其主题**对普通访问者不再存在**。
 *
 * 为什么不用 `PUBLIC_NODE_CONDITION` 直接过滤：这里是「已拿到具体 id，
 * 需要判断该行是否可见」的**单行**场景 —— 用 join + 内存判定可以区分
 * 「主题不存在」与「主题存在但节点不可见」，两者对外都表现为 `null`
 * （不泄露「这里曾有内容」），但审核入口需要一个可显式放行的开关。
 *
 * @param opts.includeHiddenNode 授权审核入口（moderator / admin）显式放行。
 *   调用方必须用 `canReviewHiddenNodes(user)` 判定后传入，不要在 SQL 层猜角色。
 */
export async function getTopicById(
  id: number,
  opts: { includeHiddenNode?: boolean } = {},
): Promise<typeof schema.topics.$inferSelect | null> {
  const rows = await db
    .select({ topic: schema.topics, nodeStatus: schema.nodes.status })
    .from(schema.topics)
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(eq(schema.topics.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  // 返回对象形状与改造前**逐字段相同**（仍是 topics 行），调用方无需改动。
  if (!isPublicNodeStatus(row.nodeStatus) && !opts.includeHiddenNode) return null;
  return row.topic;
}

/**
 * 列出主题的回复（分页）。
 *
 * v0.0.3：**默认过滤掉软删除的回复** —— 已删除内容不得通过普通页面泄露。
 * 管理员/作者可通过 includeDeleted 显式查看（带删除标记）。
 *
 * v0.0.14 P0-1：**结构上**保证回复不能从隐藏节点的主题里单独取出。
 *
 * 原实现只 `from(replies).innerJoin(users)`，可见性完全依赖调用方
 * 「先查主题、再决定是否查回复」。只要有一条调用路径跳过那一步
 * （或主题在两步之间被隐藏），回复就照常返回 —— 这不是假设，而是真实缺口：
 * 会员页「最近的回复」就是这样直接按 author_id 取回复的。
 *
 * 现在回复查询自身 `innerJoin(topics)` + `innerJoin(nodes)` 并带
 * `PUBLIC_NODE_CONDITION`，可见性成为**查询自身的属性**，不依赖调用方纪律。
 *
 * @param opts.includeHiddenNode 授权审核入口（moderator / admin）显式放行。
 *   ⚠️ 必须由调用方用 `canReviewHiddenNodes(user)` 判定后传入 ——
 *   否则 staff 打开「隐藏节点下的主题」时会看到正文却**一条回复都没有**，
 *   审核界面直接残废（这本身也是一种「看起来正常的错误」）。
 */
export async function listReplies(
  topicId: number,
  page = 1,
  perPage = REPLIES_PER_PAGE,
  opts: { includeDeleted?: boolean; includeHiddenNode?: boolean } = {},
) {
  const offset = (Math.max(1, page) - 1) * perPage;
  const conditions = [eq(schema.replies.topicId, topicId)];
  if (!opts.includeHiddenNode) {
    conditions.push(PUBLIC_NODE_CONDITION);
  }
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
    .innerJoin(schema.topics, eq(schema.topics.id, schema.replies.topicId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(and(...conditions))
    .orderBy(schema.replies.floor)
    .limit(perPage)
    .offset(offset);

  // ⚠️ total 与 items 必须**同口径**。
  // 原实现的 total 只按 topicId 统计（含已删除回复），items 却排除已删除 ——
  // 那个不一致在 v0.0.3 起就存在，但它与「节点可见性」无关，本轮**不改**
  // （改了会让「回复被删后总条数不变」这个既有行为变化）。
  // 唯一必须保证的是：total 也带节点可见性条件，否则隐藏后 items 空、total 非零。
  const totalConditions = [eq(schema.replies.topicId, topicId)];
  if (!opts.includeHiddenNode) {
    totalConditions.push(PUBLIC_NODE_CONDITION);
  }
  const totalRows = await db
    .select({ n: count() })
    .from(schema.replies)
    .innerJoin(schema.topics, eq(schema.topics.id, schema.replies.topicId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(and(...totalConditions));

  return { items: rows, total: Number(totalRows[0]?.n ?? 0) };
}

/**
 * 站内「今日热议」侧栏（`HotTopics` 组件）。
 *
 * v0.0.14 P0-1：原实现只 join users，没有任何节点状态条件 ——
 * 隐藏节点的标题、作者、投票数会直接出现在**每个页面**的右栏。
 */
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
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(and(eq(schema.topics.status, 'published'), PUBLIC_NODE_CONDITION))
    .orderBy(desc(schema.topics.votes), desc(schema.topics.repliesCount))
    .limit(limit);
  return rows;
}

/**
 * 标签页（`/tag/[name]`）的主题列表。
 *
 * v0.0.14 P0-1：把原先**写在页面里**的查询搬到这里，理由不是「代码好看」：
 *
 *  1. 页面里的内联查询没有节点可见性条件，于是「隐藏节点的主题」
 *     仍能从标签页读到（与所有其它列表口径不一致）；
 *  2. 内联查询**无法被真库测试直接调用** —— 只能在浏览器里点，
 *     而这类缺陷恰恰是「点不出来」的（要看的是「不该出现的东西没出现」）。
 *
 * 条件：`tags ⋈ topic_tags ⋈ topics ⋈ users ⋈ nodes`，
 * 只取 `published` 且节点 `active`。
 *
 * `items` 形状与 `listTopics()` 的 `TopicListItem` **完全一致**，
 * 因此页面可以直接交给同一个 `TopicItem` 组件渲染；
 * `lastReplier` 沿用页面原行为（标签页不展示最后回复者）置 `null`。
 */
export async function listTopicsByTag(
  tagName: string,
  page = 1,
  perPage = TOPICS_PER_PAGE,
): Promise<TopicListResult> {
  const pageSafe = Math.max(1, page);
  const offset = (pageSafe - 1) * perPage;

  const where = and(
    eq(schema.tags.name, tagName),
    eq(schema.topics.status, 'published'),
    PUBLIC_NODE_CONDITION,
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
    .innerJoin(schema.topicTags, eq(schema.topicTags.topicId, schema.topics.id))
    .innerJoin(schema.tags, eq(schema.tags.id, schema.topicTags.tagId))
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(where)
    // 排序必须确定性：同 lastReplyAt 时用 id 兜底，避免翻页时行漂移
    .orderBy(desc(schema.topics.lastReplyAt), desc(schema.topics.id))
    .limit(perPage)
    .offset(offset);

  // v0.0.16：与首页 / 最热 tab 统一口径 —— 标签页同样给出**真实**最后回复者。
  // 此前这里是硬编码 `null`，而 TopicItem 会回退成作者名 ⇒ 标签页的名称也是假的。
  const lastRepliers = await loadLastRepliers(rows.map((r) => r.id));

  // 独立 count —— 不能用 `rows.length`（v0.0.14 已修过的真实缺陷：
  // rows 已被 limit 截断 ⇒ totalPages 恒为 1，第 2 页永远不可达）
  //
  // ⚠️ join 集合必须与列表查询**逐个相同**（含 users）。
  // 少一个 innerJoin 就少一层过滤：今天因为外键必然存在而结果相同，
  // 但任何一次「列表加了 join 忘了改 count」都会让总数与行数悄悄分叉。
  const totalRows = await db
    .select({ n: count() })
    .from(schema.topics)
    .innerJoin(schema.topicTags, eq(schema.topicTags.topicId, schema.topics.id))
    .innerJoin(schema.tags, eq(schema.tags.id, schema.topicTags.tagId))
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
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
      lastReplier: lastRepliers.get(r.id) ?? null,
    })),
  };
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
  /*
   * ⚠️ 必须**整体** try/catch —— 页脚不能因为缓存不可用而把整页打成 5xx。
   *
   * 这是 CI 实测抓到的真实回归（R-17a「Redis 中断与恢复」）：
   * 第一版直接 `await kv.get(...)`，Redis 被 stop 之后 ioredis 抛
   *   Error: Connection is closed.
   * 而这个函数在 **Footer（每个页面都渲染）** 里被调用 ⇒ 任何页面都 500。
   *
   * 项目的既有契约是「Redis 缺失/不可用时降级到 PostgreSQL，语义等价」
   * （见 `src/lib/kv.ts` 头注释）；本函数属于**展示型**统计，连降级都不必，
   * 直接回退到「当前在线数」即可 —— 显示上仍然正确，只是峰值不增长。
   */
  try {
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
  } catch {
    // 缓存不可用 ⇒ 如实回退到当前在线数（不虚增、不崩溃、不记假值）
    return current;
  }
}
