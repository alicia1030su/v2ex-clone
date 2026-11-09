import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq, inArray, desc } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { attachTags, loadTagNames } from '../src/server/tags';

/**
 * 标签落库的**真实数据库**回归测试（v0.0.14）
 *
 * ## 为什么必须有这一层
 *
 * `normalizeTag` 是纯函数，`tests/tag-normalize.spec.ts` 已覆盖规范化规则。
 * 但「规则对」不等于「落库对」——真实风险全在 SQL 一侧：
 *
 *   · `tags.name` 有唯一索引：两个并发请求同时建同名标签时，
 *     用 `insert ... onConflictDoNothing()` 再回查才不抛唯一约束错；
 *   · `topic_tags` 是复合主键：重复提交必须幂等，不能插出重复行；
 *   · 编辑主题时**不能**把历史标签一起删掉（最容易写错也最难发现）。
 *
 * 这些只有真库能证明。数据库隔离：专用库 `v2ex_v014_tags`，不碰开发库。
 */

const TEST_DB = process.env.V014_TAGS_TEST_DB ?? 'v2ex_v014_tags';

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

async function makeTopic(title: string): Promise<number> {
  const [topic] = await db
    .insert(schema.topics)
    .values({ title, content: 'v0.0.14 标签测试正文（长度足够）', nodeId, authorId })
    .returning({ id: schema.topics.id });
  return topic.id;
}

beforeAll(async () => {
  logDbTarget('tests/tags-db.spec.ts', TEST_DB);

  await provisionTestDatabase({
    file: 'tests/tags-db.spec.ts',
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
    .values({ username: 'v014_tag_author', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  authorId = user.id;

  const [cat] = await db
    .insert(schema.categories)
    .values({ name: 'v014cat', title: 'V014 Cat' })
    .returning({ id: schema.categories.id });

  const [node] = await db
    .insert(schema.nodes)
    .values({ name: 'v014node', title: 'V014 Node', categoryId: cat.id })
    .returning({ id: schema.nodes.id });
  nodeId = node.id;
}, 300_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  // 签名是（adminUrl, dbName）—— 顺序写反会得到 `Invalid URL` 而不是护栏报错
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
});

describe('attachTags：真实落库', () => {
  it('规范化后写入，并可从 loadTagNames 读回', async () => {
    const topicId = await makeTopic('v014 tags basic');
    const applied = await attachTags(topicId, ['  React ', '#next.js', '前端']);

    expect(applied).toEqual(['react', 'next.js', '前端']);
    // 码点序：`next.js`(n) < `react`(r) < `前端`(U+524D)
    // ⚠️ 这里刻意不用 localeCompare 的直觉序 —— 它依赖 ICU/locale，
    //    本机会把「前端」排在拉丁字母之前，CI 容器里可能相反。
    expect(await loadTagNames(topicId)).toEqual(['next.js', 'react', '前端']);
  });

  it('重复调用幂等：不产生重复标签行，也不报唯一约束错', async () => {
    const topicId = await makeTopic('v014 tags idempotent');
    await attachTags(topicId, ['react', 'react', 'React']);

    const links = await db
      .select({ tagId: schema.topicTags.tagId })
      .from(schema.topicTags)
      .where(eq(schema.topicTags.topicId, topicId));
    expect(links).toHaveLength(1);

    // 再调一次：仍然只有 1 行（复合主键 onConflictDoNothing 生效）
    const applied = await attachTags(topicId, ['react']);
    expect(applied).toEqual(['react']);
    const again = await db
      .select({ tagId: schema.topicTags.tagId })
      .from(schema.topicTags)
      .where(eq(schema.topicTags.topicId, topicId));
    expect(again).toHaveLength(1);
  });

  it('全局标签表不重复建同名标签（多主题共用同一个 tag 行）', async () => {
    const t1 = await makeTopic('v014 tags shared 1');
    const t2 = await makeTopic('v014 tags shared 2');
    await attachTags(t1, ['shared']);
    await attachTags(t2, ['shared']);

    const rows = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(eq(schema.tags.name, 'shared'));
    expect(rows).toHaveLength(1);
  });

  it('追加语义：再次 attach 只加新标签，不删旧标签', async () => {
    const topicId = await makeTopic('v014 tags append');
    await attachTags(topicId, ['a1', 'b1']);
    expect(await loadTagNames(topicId)).toEqual(['a1', 'b1']);

    await attachTags(topicId, ['c1']);
    // 编辑正文时传新标签，历史标签必须保留 —— 这是最容易写错的点
    expect(await loadTagNames(topicId)).toEqual(['a1', 'b1', 'c1']);
  });

  it('非法 topicId 不抛数据库错误（前置校验，不把 SQL 报错泄漏给调用方）', async () => {
    // 真实触发路径：`Promise.all(insert...)` 返回的是行集数组，误取 `.id`
    // 会得到 undefined；旧实现直接进 SQL ⇒ NOT NULL 约束错误。
    expect(await attachTags(undefined as unknown as number, ['react'])).toEqual([]);
    expect(await attachTags(0, ['react'])).toEqual([]);
    expect(await attachTags(-1, ['react'])).toEqual([]);
    expect(await attachTags(1.5, ['react'])).toEqual([]);
  });

  it('非法/空输入不写任何行（调用方据此跳过）', async () => {
    const topicId = await makeTopic('v014 tags empty');
    expect(await attachTags(topicId, '')).toEqual([]);
    expect(await attachTags(topicId, ['🔥', '!!!'])).toEqual([]);

    const links = await db
      .select({ tagId: schema.topicTags.tagId })
      .from(schema.topicTags)
      .where(eq(schema.topicTags.topicId, topicId));
    expect(links).toHaveLength(0);
  });

  it('超过 5 个只落前 5 个（与纯函数层同一上限）', async () => {
    const topicId = await makeTopic('v014 tags limit');
    const applied = await attachTags(
      topicId,
      Array.from({ length: 9 }, (_, i) => `limit${i}`),
    );
    expect(applied).toHaveLength(5);
    expect(await loadTagNames(topicId)).toHaveLength(5);
  });

  it('大小写不同写法收敛到同一个标签行（不分裂）', async () => {
    const t1 = await makeTopic('v014 tags case 1');
    const t2 = await makeTopic('v014 tags case 2');
    await attachTags(t1, ['CaseTest']);
    await attachTags(t2, ['casetest']);

    const rows = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(eq(schema.tags.name, 'casetest'));
    expect(rows, 'CaseTest 与 casetest 必须收敛为同一行').toHaveLength(1);
  });

  it('并发写同名标签不冲突（真实并发，不是顺序调用）', async () => {
    const topics = await Promise.all([
      makeTopic('v014 tags conc 1'),
      makeTopic('v014 tags conc 2'),
      makeTopic('v014 tags conc 3'),
    ]);

    await Promise.all(topics.map((id) => attachTags(id, ['concurrent'])));

    const tagRows = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(eq(schema.tags.name, 'concurrent'));
    expect(tagRows, '并发建同名标签必须只留一行').toHaveLength(1);

    const links = await db
      .select({ topicId: schema.topicTags.topicId })
      .from(schema.topicTags)
      .where(eq(schema.topicTags.tagId, tagRows[0].id));
    expect(links.map((l) => l.topicId).sort()).toEqual([...topics].sort());
  });
});

describe('loadTagNames：顺序稳定', () => {
  it('按名称升序，两次读取结果一致', async () => {
    const topicId = await makeTopic('v014 tags order');
    await attachTags(topicId, ['zeta', 'alpha', 'mu']);

    const first = await loadTagNames(topicId);
    const second = await loadTagNames(topicId);
    expect(first).toEqual(['alpha', 'mu', 'zeta']);
    expect(second).toEqual(first);
  });
});
