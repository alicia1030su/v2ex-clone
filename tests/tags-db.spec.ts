import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq, inArray, desc } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { attachTags, detachTags, loadTagNames } from '../src/server/tags';

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

/*
 * ⚠️ 这里**刻意不显式传 hook timeout**（走 `vitest.config.ts` 的 120_000）。
 *
 * 本文件一度写成 `}, 300_000)` —— 那是为绕过本机 PG 的 I/O 积压态
 * （实测 createMs 曾达 233~289s）。但那个理由经不起推敲：
 *   ① 那种极慢是**整台实例**的问题，同一时段**所有** DB spec 都会超时，
 *      单独给一个文件放宽只能让它「比别人晚红」，不产生任何真实覆盖；
 *   ② 显式 timeout 会**覆盖**全局 hookTimeout（不是取较大值），
 *      于是把 CI 的最坏用时可观测值从 2 分钟放大到 5 分钟。
 * 实测（本机正常态）：totalMs=5523（createMs=2835 / migrateMs=2569），峰值 createMs=6998，相对 120s 有 7 倍以上余量。
 * ⇒ 若将来真在本机撞到 hook timeout，正确动作是看 `[db-phase]` 输出的
 *    `createMs` / `migrateMs` 判断环境，而不是把这里的数字调大。
 */
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
});

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

// ─────────────────────────────────────────────────────────────────────
// v0.0.14 P0-2：**总量**上限（不是单次输入上限）
// ─────────────────────────────────────────────────────────────────────

/** 数某主题的关联行数（**直接查库**，不信函数返回值） */
async function countLinks(topicId: number): Promise<number> {
  const rows = await db
    .select({ tagId: schema.topicTags.tagId })
    .from(schema.topicTags)
    .where(eq(schema.topicTags.topicId, topicId));
  return rows.length;
}

describe('attachTags：总量上限 5（真实数据库，反复编辑不能累加）', () => {
  it('先 attach 3 个、再 attach 5 个 ⇒ 总量仍是 5（不是 8）', async () => {
    const topicId = await makeTopic('v014 total cap');

    const first = await attachTags(topicId, ['c1a', 'c1b', 'c1c']);
    expect(first).toEqual(['c1a', 'c1b', 'c1c']);
    expect(await countLinks(topicId)).toBe(3);

    // 再提交 5 个：只剩 2 个额度 ⇒ 只接受前 2 个新标签
    const second = await attachTags(topicId, ['c2a', 'c2b', 'c2c', 'c2d', 'c2e']);
    expect(second, '返回值只含额度内的项').toEqual(['c2a', 'c2b']);

    expect(await countLinks(topicId), '关联行数必须仍是 5').toBe(5);
    expect(await loadTagNames(topicId)).toHaveLength(5);
    expect(await loadTagNames(topicId)).toEqual(['c1a', 'c1b', 'c1c', 'c2a', 'c2b']);
  });

  it('满额后继续 attach 不改变任何东西（幂等且不抛错）', async () => {
    const topicId = await makeTopic('v014 cap full');
    await attachTags(topicId, ['f1', 'f2', 'f3', 'f4', 'f5']);
    expect(await countLinks(topicId)).toBe(5);

    const applied = await attachTags(topicId, ['f6', 'f7']);
    expect(applied, '满额后没有新标签生效').toEqual([]);
    expect(await countLinks(topicId)).toBe(5);
    expect(await loadTagNames(topicId)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
  });

  it('同一批标签重复 attach 5 次 ⇒ 关联数不变（复合主键幂等）', async () => {
    const topicId = await makeTopic('v014 idem repeated');
    const batch = ['r1', 'r2', 'r3'];

    for (let i = 0; i < 5; i += 1) {
      const applied = await attachTags(topicId, batch);
      expect(applied, `第 ${i + 1} 次提交返回值应稳定`).toEqual(batch);
    }

    expect(await countLinks(topicId)).toBe(3);
    expect(await loadTagNames(topicId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('已存在的标签**不占**新额度（3 + 4 里含 1 个旧的 ⇒ 结果 5 个而不是 4 个）', async () => {
    const topicId = await makeTopic('v014 existing no quota');
    await attachTags(topicId, ['a', 'b']);
    expect(await countLinks(topicId)).toBe(2);

    // 'a' 已存在（不占额度），剩下 3 个都是新的 ⇒ 2 + 3 = 5，正好装满
    const applied = await attachTags(topicId, ['a', 'c', 'd', 'e']);
    expect(applied).toEqual(['a', 'c', 'd', 'e']);

    expect(await loadTagNames(topicId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(await countLinks(topicId)).toBe(5);
  });

  it('并发写同一主题：两批各 3 个 ⇒ 总量必须 ≤ 5（真实并发，不是顺序调用）', async () => {
    const topicId = await makeTopic('v014 concurrent cap');

    // 关键：**真的是并发**。两个事务都先 `SELECT ... FOR UPDATE` 锁主题行，
    // 后到的那一个必须等前一个提交后重新读已有标签，才可能算对剩余额度。
    // 如果去掉 FOR UPDATE，两边都会读到"已有 0 个" ⇒ 各自写 3 个 ⇒ 6 个。
    const [left, right] = await Promise.all([
      attachTags(topicId, ['p1', 'p2', 'p3']),
      attachTags(topicId, ['p4', 'p5', 'p6']),
    ]);

    const total = await countLinks(topicId);
    expect(total, `两个并发事务写入后总量必须 ≤ 5，实际 ${total}`).toBeLessThanOrEqual(5);
    expect(total).toBe(5);

    const names = await loadTagNames(topicId);
    expect(names).toHaveLength(5);
    // 两个调用的返回值之和不能超过 5（各自回显自己"实际生效"的部分）
    expect(left.length + right.length).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────
// v0.0.14：**移除**语义（只删关联，不删标签本体）
// ─────────────────────────────────────────────────────────────────────

describe('detachTags：移除标签（幂等 / 只影响本主题 / 释放额度）', () => {
  it('移除 1 个后长度 4；再 attach 2 个 ⇒ 长度仍 5（只收得下 1 个）', async () => {
    const topicId = await makeTopic('v014 detach basic');
    await attachTags(topicId, ['d1', 'd2', 'd3', 'd4', 'd5']);
    expect(await loadTagNames(topicId)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);

    const removed = await detachTags(topicId, ['d2']);
    expect(removed).toEqual(['d2']);
    expect(await loadTagNames(topicId)).toHaveLength(4);
    expect(await loadTagNames(topicId)).toEqual(['d1', 'd3', 'd4', 'd5']);

    // 额度只腾出 1 个 ⇒ 提交 2 个时只接受 1 个，总量仍是 5（上限没有被移除破坏）
    const applied = await attachTags(topicId, ['d6', 'd7']);
    expect(applied).toEqual(['d6']);
    expect(await countLinks(topicId)).toBe(5);
    expect(await loadTagNames(topicId)).toEqual(['d1', 'd3', 'd4', 'd5', 'd6']);
  });

  it('移除 2 个后追加 2 个 ⇒ 长度仍 5（额度确实被释放，不是「只能删不能加」）', async () => {
    const topicId = await makeTopic('v014 detach quota release');
    await attachTags(topicId, ['q1', 'q2', 'q3', 'q4', 'q5']);

    expect(await detachTags(topicId, ['q1', 'q2'])).toEqual(['q1', 'q2']);
    expect(await loadTagNames(topicId)).toHaveLength(3);

    const applied = await attachTags(topicId, ['q6', 'q7']);
    expect(applied, '腾出的 2 个额度必须能用掉').toEqual(['q6', 'q7']);
    expect(await countLinks(topicId)).toBe(5);
    expect(await loadTagNames(topicId)).toEqual(['q3', 'q4', 'q5', 'q6', 'q7']);
  });

  it('移除不存在的标签：幂等、不报错、返回空', async () => {
    const topicId = await makeTopic('v014 detach missing');
    await attachTags(topicId, ['m1', 'm2']);

    const first = await detachTags(topicId, ['never-existed']);
    expect(first).toEqual([]);
    const second = await detachTags(topicId, ['never-existed']);
    expect(second).toEqual([]);

    // 重复移除同一个已删掉的标签也不报错
    expect(await detachTags(topicId, ['m1'])).toEqual(['m1']);
    expect(await detachTags(topicId, ['m1'])).toEqual([]);
    expect(await loadTagNames(topicId)).toEqual(['m2']);
  });

  it('移除只影响本主题：其它主题的同名标签必须还在', async () => {
    const keep = await makeTopic('v014 detach keep');
    const drop = await makeTopic('v014 detach drop');
    await attachTags(keep, ['shared2']);
    await attachTags(drop, ['shared2']);

    expect(await detachTags(drop, ['shared2'])).toEqual(['shared2']);

    expect(await loadTagNames(drop)).toEqual([]);
    expect(await loadTagNames(keep), '不得替别的主题做决定').toEqual(['shared2']);

    // 标签本体（`tags` 行）也不能被删掉 —— 否则 keep 的关联会变成孤儿
    const tagRows = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(eq(schema.tags.name, 'shared2'));
    expect(tagRows, '标签本体必须保留').toHaveLength(1);
  });

  it('移除命名与写入同一套规范化（`#React` 能删掉 `react`）', async () => {
    const topicId = await makeTopic('v014 detach normalize');
    await attachTags(topicId, ['React']);
    expect(await loadTagNames(topicId)).toEqual(['react']);

    expect(await detachTags(topicId, ['  #REACT  '])).toEqual(['react']);
    expect(await loadTagNames(topicId)).toEqual([]);
  });

  it('移除与追加可以先后发生（先腾额度再加，等价于 API 的处理顺序）', async () => {
    const topicId = await makeTopic('v014 detach then attach');
    await attachTags(topicId, ['x1', 'x2', 'x3', 'x4', 'x5']);

    await detachTags(topicId, ['x1']);
    const applied = await attachTags(topicId, ['x6']);

    expect(applied).toEqual(['x6']);
    expect(await countLinks(topicId)).toBe(5);
    expect(await loadTagNames(topicId)).toContain('x6');
    expect(await loadTagNames(topicId)).not.toContain('x1');
  });
});

describe('不存在的主题：返回空结果，不抛外键/数据库错误', () => {
  it('attachTags(id=999999) ⇒ []（不抛外键错）', async () => {
    await expect(attachTags(999_999, ['ghost'])).resolves.toEqual([]);

    // 也不能顺手建出一个孤儿标签（`tags` 行只应在关联成功时产生）
    const ghost = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(eq(schema.tags.name, 'ghost'));
    expect(ghost, '主题不存在时不得留下无主标签').toHaveLength(0);
  });

  it('detachTags(id=999999) ⇒ []', async () => {
    await expect(detachTags(999_999, ['ghost'])).resolves.toEqual([]);
  });

  it('loadTagNames(id=999999) ⇒ []', async () => {
    await expect(loadTagNames(999_999)).resolves.toEqual([]);
  });

  it('非法 id（0 / 负数 / 小数 / undefined）一律返回 []', async () => {
    expect(await detachTags(0, ['react'])).toEqual([]);
    expect(await detachTags(-1, ['react'])).toEqual([]);
    expect(await detachTags(1.5, ['react'])).toEqual([]);
    expect(await detachTags(undefined as unknown as number, ['react'])).toEqual([]);
  });
});

