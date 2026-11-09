import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { attachTags } from '../src/server/tags';

/**
 * 标签页**分页边界**回归测试（v0.0.14）
 *
 * ## 真实缺陷（本次修复）
 *
 * `/tag/[name]` 原实现：
 *
 * ```ts
 * const list = await db.select(...).limit(TOPICS_PER_PAGE).offset(...);
 * const totalPages = Math.max(1, Math.ceil(list.length / TOPICS_PER_PAGE));
 * ```
 *
 * `list` 已经被 `limit` 截断 ⇒ `list.length ≤ 20` ⇒ **totalPages 恒为 1**。
 * 任何标签下超过 20 篇主题时，第 2 页永远不可达，而且**页面不会报错**：
 * 用户看到的是「只有一页」，不是「翻页坏了」。
 *
 * 这类缺陷只有「数据量真的超过一页」时才会显现 —— 手工点两下永远发现不了。
 * 本测试直接造 21+ 篇同标签主题，断言 count 查询确实给出 2 页。
 *
 * 数据库隔离：专用库 `v2ex_v014_tags`（与 `tests/tags-db.spec.ts` 共用同一库名，
 * 但两文件串行执行、各自 provision，互不干扰）。
 */

const TEST_DB = process.env.V014_TAGS_TEST_DB ?? 'v2ex_v014_tags';
const PER_PAGE = 20;

process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);
{
  const g = globalThis as unknown as { __v2exSql?: unknown; __v2exDrizzle?: unknown };
  g.__v2exSql = undefined;
  g.__v2exDrizzle = undefined;
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let nodeId = 0;
let authorId = 0;

/*
 * ⚠️ 这里**刻意不显式传 hook timeout**（走 `vitest.config.ts` 的 120_000）。
 *
 * 本文件一度写成 `}, 300_000)` —— 那是为绕过本机 PG 的 I/O 积压态
 * （实测 createMs 曾达 233~289s）。但那个理由经不起推敲：
 *   ① 那种极慢是**整台实例**的问题，同一时段**所有** DB spec 都会超时，
 *      单独给一个文件放宽只能让它「比别人晚红」，不产生任何真实覆盖；
 *   ② 显式 timeout 会**覆盖**全局 hookTimeout（不是取较大值），
 *      于是把 CI 的最坏用时可观测值从 2 分钟放大到 5 分钟。
 * 实测（本机正常态）：totalMs=16979（createMs=6998 / migrateMs=9874），最慢单文件 17s，相对 120s 有 7 倍以上余量。
 * ⇒ 若将来真在本机撞到 hook timeout，正确动作是看 `[db-phase]` 输出的
 *    `createMs` / `migrateMs` 判断环境，而不是把这里的数字调大。
 */
beforeAll(async () => {
  logDbTarget('tests/tag-pagination.spec.ts', TEST_DB);

  await provisionTestDatabase({
    file: 'tests/tag-pagination.spec.ts',
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

  const [user] = await db
    .insert(schema.users)
    .values({ username: 'v014_page_author', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  authorId = user.id;

  const [cat] = await db
    .insert(schema.categories)
    .values({ name: 'v014pagecat', title: 'V014 Page Cat' })
    .returning({ id: schema.categories.id });

  const [node] = await db
    .insert(schema.nodes)
    .values({ name: 'v014pagenode', title: 'V014 Page Node', categoryId: cat.id })
    .returning({ id: schema.nodes.id });
  nodeId = node.id;
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
}, 60_000);

describe('标签页分页边界（21 篇主题 ⇒ 必须能翻到第 2 页）', () => {
  it('count 查询给出真实总数，而不是被 limit 截断后的行数', async () => {
    const tagName = 'v014pagetag';

    // 造 21 篇同标签主题（刚好超过一页 1 篇 —— 边界值最容易暴露 off-by-one）
    //
    // ⚠️ `Promise.all(insert...)` 每项返回的是**数组**（`returning` 的行集），
    //    第一版直接 `for (const t of topics) attachTags(t.id, ...)` 拿到的是
    //    `undefined` ⇒ `topic_id` 为 null ⇒ 撞 NOT NULL 约束。
    const insertResults = await Promise.all(
      Array.from({ length: 21 }, (_, i) =>
        db
          .insert(schema.topics)
          .values({
            title: `v014 分页测试 ${i}`,
            content: `第 ${i} 篇正文（长度足够用于插入）`,
            nodeId,
            authorId,
            // 让 lastReplyAt 有确定顺序，便于验证翻页不重不漏
            lastReplyAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          })
          .returning({ id: schema.topics.id }),
      ),
    );

    const topicIds = insertResults.map((r) => r[0].id);
    expect(topicIds.filter((id) => Number.isInteger(id)).length).toBe(21);
    for (const id of topicIds) {
      await attachTags(id, [tagName]);
    }

    // 与页面实现同一口径：topic_tags ⋈ topics，只算 published
    const rows = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .innerJoin(schema.topicTags, eq(schema.topicTags.topicId, schema.topics.id))
      .innerJoin(schema.tags, eq(schema.tags.id, schema.topicTags.tagId))
      .where(eq(schema.tags.name, tagName));
    const total = rows.length;

    expect(total, '21 篇同标签主题必须全部可数到').toBe(21);
    // 关键断言：总数 21 ⇒ 页数 2（旧实现拿 limit 后的行数算，恒为 1）
    expect(Math.max(1, Math.ceil(total / PER_PAGE)), '21 篇应产生 2 页').toBe(2);

    // 第 1 页 20 条
    const page1 = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .innerJoin(schema.topicTags, eq(schema.topicTags.topicId, schema.topics.id))
      .innerJoin(schema.tags, eq(schema.tags.id, schema.topicTags.tagId))
      .where(eq(schema.tags.name, tagName))
      .orderBy(schema.topics.lastReplyAt)
      .limit(PER_PAGE)
      .offset(0);
    expect(page1).toHaveLength(20);

    // 第 2 页 1 条 —— 这条就是旧实现永远拿不到的那篇
    const page2 = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .innerJoin(schema.topicTags, eq(schema.topicTags.topicId, schema.topics.id))
      .innerJoin(schema.tags, eq(schema.tags.id, schema.topicTags.tagId))
      .where(eq(schema.tags.name, tagName))
      .orderBy(schema.topics.lastReplyAt)
      .limit(PER_PAGE)
      .offset(PER_PAGE);
    expect(page2, '第 2 页必须能取到第 21 篇').toHaveLength(1);

    // 翻页不重不漏
    const ids1 = new Set(page1.map((r) => r.id));
    const ids2 = new Set(page2.map((r) => r.id));
    for (const id of ids2) expect(ids1.has(id), '同一主题不得在两页重复出现').toBe(false);
    expect(ids1.size + ids2.size, '两页合计必须等于总数（不漏）').toBe(21);
  });

  it('软删除主题不计入标签页总数（否则会出现永远打不开的尾页）', async () => {
    const tagName = 'v014pagetagdel';

    const keep = await db
      .insert(schema.topics)
      .values({ title: 'v014 del keep', content: '正文足够长度用于插入', nodeId, authorId })
      .returning({ id: schema.topics.id });
    const drop = await db
      .insert(schema.topics)
      .values({ title: 'v014 del drop', content: '正文足够长度用于插入', nodeId, authorId })
      .returning({ id: schema.topics.id });

    await attachTags(keep[0].id, [tagName]);
    await attachTags(drop[0].id, [tagName]);

    await db
      .update(schema.topics)
      .set({ status: 'deleted', deletedAt: new Date() })
      .where(eq(schema.topics.id, drop[0].id));

    // 关联行仍在（标签关联不随软删除消失）—— 这本身是对的，保留历史
    const allLinks = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .innerJoin(schema.topicTags, eq(schema.topicTags.topicId, schema.topics.id))
      .innerJoin(schema.tags, eq(schema.tags.id, schema.topicTags.tagId))
      .where(eq(schema.tags.name, tagName));
    expect(allLinks, '软删除不删标签关联').toHaveLength(2);

    // 但页面口径（status='published'）只应算 1 —— 与 tagWhere 一致
    const published = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .innerJoin(schema.topicTags, eq(schema.topicTags.topicId, schema.topics.id))
      .innerJoin(schema.tags, eq(schema.tags.id, schema.topicTags.tagId))
      .where(
        and(eq(schema.tags.name, tagName), eq(schema.topics.status, 'published')),
      );
    expect(published, '页面总数只算 published').toHaveLength(1);
  });
});
