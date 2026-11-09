import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { attachTags } from '../src/server/tags';
import { buildFeedEntries } from '../src/lib/feed-builder';
import {
  getNodeById,
  getNodeByName,
  getTopicById,
  listHotTopics,
  listNodesByCategory,
  listReplies,
  listTopics,
  listTopicsByNodeIds,
  listTopicsByTag,
} from '../src/server/queries';

/**
 * v0.0.14（P0-1）：**节点 hidden 后，站内所有公共查询必须同时不可见**
 *
 * ## 为什么必须有这一层（真库）
 *
 * P0-1 的缺陷不是「某一条 SQL 写错了」，而是**同一个判据散落在十来个查询里**：
 *
 *   · `getNodeByName()` 没有状态条件 ⇒ `/go/{hidden}` 能正常打开；
 *   · `getTopicById()` 只按 id 查 ⇒ 手输 `/t/{id}` 就能读到隐藏节点下的主题；
 *   · `listReplies()` 只 `from(replies)` ⇒ 回复不依赖主题可见性；
 *   · `listTopics()` / `listHotTopics()` / 标签页 / 搜索 / 关注流 / 会员页
 *     —— 每一条都是自己拼的 where，谁漏一条就漏一整个面。
 *
 * 静态护栏能证明「每个文件都写了那个条件」，但证明不了
 * **条件写在正确的查询上、且真的作用到了 JOIN 出来的 nodes 表**。
 * 例如把 `PUBLIC_NODE_CONDITION` 放进一个不 join nodes 的 count 查询，
 * 静态断言照样全绿，运行时却是 42P01（或更糟：条件被忽略，总数比列表多）。
 * 只有真库能区分这两种情况。
 *
 * ## 为什么每条都要「三态闭环」
 *
 * 只断言「hidden 之后查不到」是**假合格证**：如果这条主题本来就没进结果
 * （排序靠后、分页之外、根本没插进去），那么过滤是否生效都会通过。
 * 因此每条路径都必须先证明 **active 时确实看得到（且不是空数组）**，
 * 再证明 hidden 后看不到，最后证明改回 active 又能看到。
 *
 * 数据库隔离：专用库 `v2ex_v014_nodevis`，不碰开发库（护栏见
 * `tests/helpers/test-db-guard.ts` 的 `ALLOWED_DB_NAMES`）。
 */

const TEST_DB = process.env.V014_NODEVIS_TEST_DB ?? 'v2ex_v014_nodevis';

// 让 `@/db` 的全局连接池指向本测试库（queries.ts 用的是那个全局实例）。
// 必须在**第一次实际发起查询之前**设置：`src/db/index.ts` 的客户端是惰性创建的。
process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);
{
  const g = globalThis as unknown as { __v2exSql?: unknown; __v2exDrizzle?: unknown };
  g.__v2exSql = undefined;
  g.__v2exDrizzle = undefined;
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

let categoryId = 0;
let nodeId = 0;
let authorId = 0;
let topicId = 0;
let replyId = 0;

const NODE_NAME = 'v014visnode';
const NODE_TITLE = 'V014 可见性节点';
const TOPIC_TITLE = 'v014vis uniquetoken 节点可见性探针';
const TAG_NAME = 'v014vistag';

beforeAll(async () => {
  logDbTarget('tests/v014-node-visibility.spec.ts', TEST_DB);

  await provisionTestDatabase({
    file: 'tests/v014-node-visibility.spec.ts',
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
    .values({ name: 'v014viscat', title: 'V014 可见性分类' })
    .returning({ id: schema.categories.id });
  categoryId = cat.id;

  const [node] = await db
    .insert(schema.nodes)
    .values({ name: NODE_NAME, title: NODE_TITLE, categoryId })
    .returning({ id: schema.nodes.id });
  nodeId = node.id;

  const [user] = await db
    .insert(schema.users)
    .values({ username: 'v014visauthor', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  authorId = user.id;

  const [topic] = await db
    .insert(schema.topics)
    .values({
      title: TOPIC_TITLE,
      content: 'v0.0.14 节点可见性真库测试正文（长度足够用于插入）。',
      nodeId,
      authorId,
    })
    .returning({ id: schema.topics.id });
  topicId = topic.id;

  const [reply] = await db
    .insert(schema.replies)
    .values({
      topicId,
      authorId,
      content: 'v0.0.14 节点可见性真库测试回复。',
      floor: 1,
    })
    .returning({ id: schema.replies.id });
  replyId = reply.id;

  await attachTags(topicId, [TAG_NAME]);
}, 300_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  // 签名是（adminUrl, dbName）—— 顺序写反会得到 `Invalid URL` 而不是护栏报错
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
}, 60_000);

/** 改节点状态（三个用例共用，保证前后对照的是同一条数据） */
async function setNodeStatus(status: 'active' | 'hidden' | 'pending'): Promise<void> {
  await db.update(schema.nodes).set({ status }).where(eq(schema.nodes.id, nodeId));
}

/**
 * 逐条公共查询的「可见性快照」。
 *
 * 全部返回布尔值而不是在断言里各写一遍查询 —— 这样 hidden 与 restored
 * 两段可以用**同一个函数**对照，避免「两段断言写的东西不一样」。
 */
async function snapshot() {
  const byNode = await listTopics({ nodeId, perPage: 50 });
  const byKeyword = await listTopics({ keyword: 'v014vis uniquetoken', perPage: 50 });
  const byNodeIds = await listTopicsByNodeIds([nodeId], 1, 50);
  const hot = await listHotTopics(50);
  const byTag = await listTopicsByTag(TAG_NAME, 1, 50);
  const detail = await getTopicById(topicId);
  const replies = await listReplies(topicId, 1, 50);
  const feed = await buildFeedEntries(db, { baseUrl: 'https://example.test', limit: 30 });

  return {
    listTopicsByNode: byNode.total > 0 && byNode.items.some((t) => t.id === topicId),
    listTopicsKeyword: byKeyword.total > 0 && byKeyword.items.some((t) => t.id === topicId),
    listTopicsByNodeIds: byNodeIds.total > 0 && byNodeIds.items.some((t) => t.id === topicId),
    listHotTopics: hot.some((t) => t.id === topicId),
    listTopicsByTag: byTag.total > 0 && byTag.items.some((t) => t.id === topicId),
    getTopicById: detail !== null && detail.id === topicId,
    listReplies: replies.total > 0 && replies.items.some((r) => r.id === replyId),
    feed: feed.some((e) => e.id === topicId),
    /** 节点自身的三个入口（不是主题列表，但同属「公共面」） */
    getNodeByName: (await getNodeByName(NODE_NAME)) !== null,
    getNodeByNameUpperCase: (await getNodeByName(NODE_NAME.toUpperCase())) !== null,
    getNodeById: (await getNodeById(nodeId)) !== null,
    listNodesByCategory: (await listNodesByCategory(categoryId)).some((n) => n.id === nodeId),
  };
}

/** 全部可见时的期望快照 —— 一处定义，正向与「恢复后」共用 */
const ALL_VISIBLE = {
  listTopicsByNode: true,
  listTopicsKeyword: true,
  listTopicsByNodeIds: true,
  listHotTopics: true,
  listTopicsByTag: true,
  getTopicById: true,
  listReplies: true,
  feed: true,
  getNodeByName: true,
  getNodeByNameUpperCase: true,
  getNodeById: true,
  listNodesByCategory: true,
};

describe('hidden 节点：站内公共查询全部不可见（active → hidden → active）', () => {
  it('① active：每条公共路径都能看到（不是空数组冒充可见）', async () => {
    await setNodeStatus('active');

    const visible = await snapshot();
    // 逐键断言（不是 toEqual 整个对象）—— 失败时能直接看出是哪条路径漏了
    for (const [key, expected] of Object.entries(ALL_VISIBLE)) {
      expect(visible[key as keyof typeof visible], `active 时 ${key} 必须可见`).toBe(expected);
    }

    // 额外确认「内容真的取到了」，而不是靠一条宽松的 some() 蒙过去
    const detail = await getTopicById(topicId);
    expect(detail?.title, '详情必须返回真实标题').toBe(TOPIC_TITLE);
    expect(detail?.nodeId, '详情必须保留 nodeId（返回形状不变）').toBe(nodeId);
    expect(detail?.content.length, '详情必须带正文，不能只有 id').toBeGreaterThan(0);

    const byTag = await listTopicsByTag(TAG_NAME, 1, 50);
    expect(byTag.total, '标签页总数必须是独立 count 的真实值').toBe(1);
  });

  it('② hidden：每条公共路径都看不到，且 total 归零（不是只过滤了列表）', async () => {
    await setNodeStatus('hidden');

    // ⚠️ 先证明「数据仍在库里」。
    // 只断言「查不到」有假绿风险：如果写入本身失败了（或测试跑在另一个库上），
    // 那么无论过滤是否生效都会「查不到」。隐藏 ≠ 删除 —— 原始行必须还在。
    const rawTopic = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .where(eq(schema.topics.id, topicId));
    expect(rawTopic, '主题行必须仍在库里（隐藏不是删除）').toHaveLength(1);
    const rawNode = await db
      .select({ status: schema.nodes.status })
      .from(schema.nodes)
      .where(eq(schema.nodes.id, nodeId));
    expect(rawNode[0]?.status, '节点状态确实已改为 hidden').toBe('hidden');
    const rawReplies = await db
      .select({ id: schema.replies.id })
      .from(schema.replies)
      .where(eq(schema.replies.topicId, topicId));
    expect(rawReplies.length, '回复行也必须仍在库里').toBeGreaterThan(0);

    const hidden = await snapshot();
    for (const key of Object.keys(ALL_VISIBLE)) {
      expect(hidden[key as keyof typeof hidden], `hidden 后 ${key} 必须不可见`).toBe(false);
    }

    // total 必须跟着变 0 —— 只过滤 items 会让分页出现「永远打不开的尾页」
    expect((await listTopics({ nodeId, perPage: 50 })).total, 'listTopics total 必须为 0').toBe(0);
    expect(
      (await listTopicsByNodeIds([nodeId], 1, 50)).total,
      'listTopicsByNodeIds 的 count 也必须为 0（它是最容易漏 join 的那条）',
    ).toBe(0);
    expect(
      (await listTopicsByTag(TAG_NAME, 1, 50)).total,
      'listTopicsByTag 的 count 也必须为 0',
    ).toBe(0);
    expect(
      (await listReplies(topicId, 1, 50)).total,
      'listReplies 的 count 也必须为 0（回复不能从隐藏节点主题单独取出）',
    ).toBe(0);

    // 「不存在」的语义：返回 null，而不是抛错或返回空壳
    expect(await getTopicById(topicId), '普通访问者取隐藏节点主题必须是 null').toBeNull();
    expect(await getNodeByName(NODE_NAME), 'hidden 节点按名查必须是 null').toBeNull();
    expect(await getNodeById(nodeId), 'hidden 节点按 id 查必须是 null').toBeNull();
  });

  it('③ pending 同样不可见（不只是 hidden 一个状态）', async () => {
    await setNodeStatus('pending');

    const pending = await snapshot();
    for (const key of Object.keys(ALL_VISIBLE)) {
      expect(pending[key as keyof typeof pending], `pending 后 ${key} 必须不可见`).toBe(false);
    }
  });

  it('④ 授权入口：includeHiddenNode / includeHidden 仍能取到（审核不能被一起挡死）', async () => {
    await setNodeStatus('hidden');

    const topic = await getTopicById(topicId, { includeHiddenNode: true });
    expect(topic, 'staff 审核入口必须仍能打开隐藏节点主题').not.toBeNull();
    expect(topic?.id).toBe(topicId);

    const node = await getNodeByName(NODE_NAME, { includeHidden: true });
    expect(node, '后台审阅入口必须仍能按名取到隐藏节点').not.toBeNull();
    expect(node?.id).toBe(nodeId);

    expect((await getNodeById(nodeId, { includeHidden: true }))?.id).toBe(nodeId);

    // 回复也一样：staff 打开隐藏节点主题时必须有回复可看，
    // 否则审核界面「有正文、零回复」—— 看起来正常，实际无从判断。
    const replies = await listReplies(topicId, 1, 50, { includeHiddenNode: true });
    expect(replies.total, 'staff 视角的回复总数不得为 0').toBeGreaterThan(0);
    expect(replies.items.some((r) => r.id === replyId)).toBe(true);
  });

  it('⑤ 恢复 active：每条路径都能重新看到（证明不是被别的原因挡住）', async () => {
    await setNodeStatus('active');

    const restored = await snapshot();
    for (const [key, expected] of Object.entries(ALL_VISIBLE)) {
      expect(restored[key as keyof typeof restored], `恢复后 ${key} 必须可见`).toBe(expected);
    }
  });

  it('⑥ 分页：标签页总数与 items 同口径，翻到第 2 页不会空转', async () => {
    // 造 21 篇同标签主题（刚好越过一页）—— 可见性条件若只加在列表上，
    // 总数会变成 21 而列表只剩 20 可见，第 2 页永远打不开且**不报错**。
    const inserted = await Promise.all(
      Array.from({ length: 21 }, (_, i) =>
        db
          .insert(schema.topics)
          .values({
            title: `v014vis paging ${i}`,
            content: `第 ${i} 篇正文（长度足够用于插入）。`,
            nodeId,
            authorId,
            lastReplyAt: new Date(Date.UTC(2026, 1, 1, 0, 0, i)),
          })
          .returning({ id: schema.topics.id }),
      ),
    );
    for (const row of inserted) {
      await attachTags(row[0].id, [TAG_NAME]);
    }

    const page1 = await listTopicsByTag(TAG_NAME, 1, 20);
    const page2 = await listTopicsByTag(TAG_NAME, 2, 20);
    expect(page1.total, '总数必须含原有那 1 篇 + 新增 21 篇').toBe(22);
    expect(page1.items, '第 1 页 20 条').toHaveLength(20);
    expect(page2.items, '第 2 页必须能取到剩下的 2 条').toHaveLength(2);

    const ids1 = new Set(page1.items.map((t) => t.id));
    for (const t of page2.items) {
      expect(ids1.has(t.id), '同一主题不得跨页重复').toBe(false);
    }
    expect(ids1.size + page2.items.length, '两页合计必须等于总数（不漏）').toBe(22);

    // hidden 后：列表与 count 一起归零（同口径的关键证据）
    await setNodeStatus('hidden');
    const hiddenPage1 = await listTopicsByTag(TAG_NAME, 1, 20);
    expect(hiddenPage1.total, 'hidden 后总数必须为 0').toBe(0);
    expect(hiddenPage1.items, 'hidden 后列表必须为空').toHaveLength(0);

    await setNodeStatus('active');
  });
});
