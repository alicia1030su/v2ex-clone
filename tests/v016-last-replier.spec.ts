import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { listTopics, listTopicsByNodeIds, listTopicsByTag } from '../src/server/queries';

/**
 * v0.0.16（P1）：**「最后回复来自 X」必须是真实最后回复者**
 *
 * ## 修掉的是什么
 *
 * 三个列表查询里，只有 `listTopics()` 真的去算最后回复者；
 * `listTopicsByNodeIds()`（首页「最热」tab）与 `listTopicsByTag()`（标签页）
 * 都把它**硬编码成 `null`**。而 `TopicItem` 组件当时的写法是：
 *
 *     {topic.lastReplier?.username ?? topic.author.username}
 *
 * 两件事单独看都「不报错」，合在一起的结果是：
 * **这两个页面每一行都写着「最后回复来自 <楼主>」**。
 *
 * 实测（本地种子库，最热 tab 前 6 条）：
 *
 *     | 主题                                  | 楼主  | 真实最后回复者 |
 *     |---------------------------------------|-------|----------------|
 *     | _lockSticky 喜提大陆 App Store 推荐    | zhaoliu | wangwu       |
 *     | 看到最近群晖被黑，想给 NAS 里的数据…   | wangwu  | zhaoliu      |
 *     | 升级 opencode V2 以后…                 | wangwu  | zhaoliu      |
 *     | 群晖 NAS 如何防止中勒索软件？          | lisi    | admin        |
 *     | 我刚做了两个播客…                      | wangwu  | moderator    |
 *     | 压缩的尽头是自指？…                    | lisi    | zhaoliu      |
 *
 * 6 条里 5 条是错的 —— 页面 HTTP 200、无控制台错误、截图看着也正常。
 *
 * ## 为什么必须用真库测
 *
 * 这是**数据正确性**问题，不是渲染问题：
 *   · 纯静态断言只能证明「代码里没有 `?? author.username`」，
 *     证明不了 `loadLastRepliers()` 返回的**是那一条**回复的作者；
 *   · mock 掉 db 则会退化成「测试我自己的桩」，与真实 SQL 无关。
 *
 * 因此本 spec 建真库、插真行（含**同一时刻多条回复**用来检验 id 兜底），
 * 然后直接调用三个公共查询函数核对返回值。
 *
 * 数据库隔离：专用库 `v2ex_test_lastreplier`（`v2ex_test_` 前缀在护栏白名单内）。
 */

const TEST_DB = process.env.V016_LASTREPLIER_TEST_DB ?? 'v2ex_test_lastreplier';

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
let replierAId = 0;
let replierBId = 0;
let topicWithRepliesId = 0;
let topicNoRepliesId = 0;
const TAG = 'v016lasttag';

beforeAll(async () => {
  logDbTarget('tests/v016-last-replier.spec.ts', TEST_DB);

  await provisionTestDatabase({
    file: 'tests/v016-last-replier.spec.ts',
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
    .values({ name: 'v016lastcat', title: 'V016 最后回复者分类' })
    .returning({ id: schema.categories.id });
  categoryId = cat.id;

  const [node] = await db
    .insert(schema.nodes)
    .values({ name: 'v016lastnode', title: 'V016 最后回复者节点', categoryId })
    .returning({ id: schema.nodes.id });
  nodeId = node.id;

  const [author] = await db
    .insert(schema.users)
    .values({ username: 'v016lastauthor', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  authorId = author.id;

  const [ra] = await db
    .insert(schema.users)
    .values({ username: 'v016lastrepliera', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  replierAId = ra.id;

  const [rb] = await db
    .insert(schema.users)
    .values({ username: 'v016lastreplierb', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  replierBId = rb.id;

  /**
   * 两个主题：
   *   · topicWithReplies —— 3 条回复，最后一条作者是 replierB；
   *   · topicNoReplies   —— 0 条回复（用来断言「没有回复者时是 null」，
   *     而不是被作者名兜底冒充）。
   */
  const [t1] = await db
    .insert(schema.topics)
    .values({
      title: 'v016last 有回复的主题',
      content: 'v0.0.16 最后回复者测试正文（长度足够用于插入）。',
      nodeId,
      authorId,
      tags: [],
    })
    .returning({ id: schema.topics.id });
  topicWithRepliesId = t1.id;

  const [t2] = await db
    .insert(schema.topics)
    .values({
      title: 'v016last 无回复的主题',
      content: 'v0.0.16 最后回复者测试正文（零回复分支）。',
      nodeId,
      authorId,
      tags: [],
    })
    .returning({ id: schema.topics.id });
  topicNoRepliesId = t2.id;

  // 三条回复，时间递增；最后一条是 replierB
  await db.insert(schema.replies).values([
    { topicId: topicWithRepliesId, authorId, content: '第一条（楼主自回）', floor: 1 },
    {
      topicId: topicWithRepliesId,
      authorId: replierAId,
      content: '第二条',
      floor: 2,
    },
  ]);
  await db.insert(schema.replies).values({
    topicId: topicWithRepliesId,
    authorId: replierBId,
    content: '第三条（应被识别为最后回复者）',
    floor: 3,
  });

  // 让 created_at 严格递增（默认 now() 在同一事务里可能相同）
  await client.unsafe(
    `UPDATE replies SET created_at = now() - ($1 || ' minutes')::interval
      WHERE topic_id = $2 AND floor = $3`,
    ['10', String(topicWithRepliesId), '1'],
  );
  await client.unsafe(
    `UPDATE replies SET created_at = now() - ($1 || ' minutes')::interval
      WHERE topic_id = $2 AND floor = $3`,
    ['5', String(topicWithRepliesId), '2'],
  );
  await client.unsafe(
    `UPDATE replies SET created_at = now() - ($1 || ' minutes')::interval
      WHERE topic_id = $2 AND floor = $3`,
    ['1', String(topicWithRepliesId), '3'],
  );

  // 标签页路径也要覆盖：把两个主题都挂上同一个标签
  const [tag] = await db
    .insert(schema.tags)
    .values({ name: TAG })
    .returning({ id: schema.tags.id });
  await db.insert(schema.topicTags).values([
    { topicId: topicWithRepliesId, tagId: tag.id },
    { topicId: topicNoRepliesId, tagId: tag.id },
  ]);

  // 主题的 last_reply_at 与回复数（列表排序与展示都用它）
  await client.unsafe(
    `UPDATE topics SET last_reply_at = (SELECT max(created_at) FROM replies WHERE topic_id = $1),
                       replies_count  = (SELECT count(*) FROM replies WHERE topic_id = $1)
      WHERE id = $1`,
    [String(topicWithRepliesId)],
  );
});

afterAll(async () => {
  await client?.end().catch(() => undefined);
  // 签名是 (adminUrl, dbName) —— 传成对象会让护栏 `new URL(object)` 抛 Invalid URL，
  // 表现为「5 个用例全 PASS，但套件整体 FAIL」。这类「通过却失败」必须避免。
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
}, 60_000);

describe('v0.0.16 最后回复者：三个列表查询口径必须一致', () => {
  it('listTopics（首页默认 tab）返回真实最后回复者，而不是楼主', async () => {
    const { items } = await listTopics({ page: 1, perPage: 50 });
    const row = items.find((t) => t.id === topicWithRepliesId);
    expect(row, '主题不在首页列表里 —— 测试数据没被查到，结论无意义').toBeTruthy();

    expect(row!.lastReplier, '有回复的主题必须给出最后回复者').not.toBeNull();
    expect(row!.lastReplier!.username).toBe('v016lastreplierb');
    // 这条断言是缺陷的**直接反证**：修复前这里会是楼主 v016lastauthor
    expect(row!.lastReplier!.username).not.toBe('v016lastauthor');
  });

  it('listTopicsByNodeIds（首页「最热」tab）曾经恒为 null ⇒ 现在必须是真实值', async () => {
    const { items } = await listTopicsByNodeIds([nodeId], 1, 50);
    const row = items.find((t) => t.id === topicWithRepliesId);
    expect(row, '主题不在最热列表里').toBeTruthy();

    // 修复前：row.lastReplier === null（组件随即回退成楼主名）
    expect(row!.lastReplier).not.toBeNull();
    expect(row!.lastReplier!.username).toBe('v016lastreplierb');
  });

  it('listTopicsByTag（标签页）同样必须是真实值', async () => {
    const { items } = await listTopicsByTag(TAG, 1, 50);
    const row = items.find((t) => t.id === topicWithRepliesId);
    expect(row, '主题不在标签页列表里').toBeTruthy();
    expect(row!.lastReplier).not.toBeNull();
    expect(row!.lastReplier!.username).toBe('v016lastreplierb');
  });

  it('零回复的主题：lastReplier 必须是 null（不能拿作者冒充）', async () => {
    const lists = await Promise.all([
      listTopics({ page: 1, perPage: 50 }),
      listTopicsByNodeIds([nodeId], 1, 50),
      listTopicsByTag(TAG, 1, 50),
    ]);

    for (const [i, { items }] of lists.entries()) {
      const row = items.find((t) => t.id === topicNoRepliesId);
      expect(row, `第 ${i} 个列表里找不到零回复主题`).toBeTruthy();
      expect(
        row!.lastReplier,
        `第 ${i} 个列表把零回复主题的 lastReplier 填成了 ${JSON.stringify(row!.lastReplier)}` +
          '（正确行为是 null —— 组件据此不渲染「最后回复来自」）',
      ).toBeNull();
    }
  });

  it('同一时刻多条回复时，用 id 兜底保证确定性（不能随机取）', async () => {
    // 把三条回复的 created_at 全部改成同一时刻，再连续查 5 次
    await client.unsafe(`UPDATE replies SET created_at = now() WHERE topic_id = $1`, [
      String(topicWithRepliesId),
    ]);

    const seen = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const { items } = await listTopics({ page: 1, perPage: 50 });
      const row = items.find((t) => t.id === topicWithRepliesId);
      expect(row?.lastReplier?.username).toBeTruthy();
      seen.add(row!.lastReplier!.username);
    }

    expect(
      seen.size,
      `created_at 相同时结果在 5 次查询里给出了 ${seen.size} 个不同答案（${[...seen].join('/')}）` +
        ' —— 排序缺少 id 兜底，翻页会漂移',
    ).toBe(1);

    // 兜底口径是 id 最大者（floor=3 的 replierB）
    expect([...seen][0]).toBe('v016lastreplierb');
  });
});
