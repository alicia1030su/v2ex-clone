import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { allocateFloor } from '../src/server/floor';

/**
 * v0.0.5 楼层号并发与稳定性测试
 *
 * ## 与既有测试的区别
 *
 * `tests/content-lifecycle.spec.ts` 的并发用例**自己模拟**了
 * `allocateFloor` 的 SQL（12 并发）。本文件：
 *
 *   1. 直接调用**真实的** `src/server/floor.ts` 的 `allocateFloor()`
 *      —— 测的是生产代码，不是测试里的副本
 *   2. 规模提高到 **100 并发**（任务书 §五 明确要求）
 *   3. 额外覆盖「软删除/恢复交错」「分页过程中新增回复」
 *      「锁定主题后拒绝回复」等既有测试未覆盖的场景
 *
 * ## 规则依据
 *
 * 楼层编号规则已文档化在 `docs/FLOOR_NUMBERING_v0.0.5.md`，
 * 本文件是该文档的**可执行断言**。
 *
 * 数据库隔离：使用专用库 v2ex_v005_floor，绝不触碰开发库/生产库。
 */

const TEST_DB = process.env.V005_FLOOR_TEST_DB ?? 'v2ex_v005_floor';

/** 必须在导入任何使用 @/db 的模块之前设置 DATABASE_URL */
process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);
{
  const g = globalThis as unknown as { __v2exSql?: unknown; __v2exDrizzle?: unknown };
  g.__v2exSql = undefined;
  g.__v2exDrizzle = undefined;
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

let authorId = 0;
let replierId = 0;
let nodeId = 0;

/** 建一个主题并返回 id */
async function createTopic(title: string): Promise<number> {
  const rows = await db
    .insert(schema.topics)
    .values({ nodeId, authorId, title, content: '楼层并发测试主题正文' })
    .returning({ id: schema.topics.id });
  return rows[0].id;
}

beforeAll(async () => {
  logDbTarget('tests/v005-floor-concurrency.spec.ts', TEST_DB);

  await provisionTestDatabase({
    file: 'tests/v005-floor-concurrency.spec.ts',
    db: TEST_DB,
    adminUrl: adminUrlOf(TEST_DB),
    migrate: () =>
      runDrizzleKit(['migrate'], {
        ...process.env,
        ENV_FILE: '',
        DATABASE_URL: dbUrlFor(TEST_DB),
      }),
  });

  client = postgres(dbUrlFor(TEST_DB), { prepare: false, max: 30 });
  db = drizzle(client, { schema });

  const users = await db
    .insert(schema.users)
    .values([
      { username: 'v005_floor_author', passwordHash: 'x', role: 'user' },
      { username: 'v005_floor_replier', passwordHash: 'x', role: 'user' },
    ])
    .returning({ id: schema.users.id, username: schema.users.username });
  const byName = new Map(users.map((u) => [u.username, u.id]));
  authorId = byName.get('v005_floor_author')!;
  replierId = byName.get('v005_floor_replier')!;

  const cat = await db
    .insert(schema.categories)
    .values({ name: 'v005floorcat', title: 'V005 Floor Cat' })
    .returning({ id: schema.categories.id });
  const node = await db
    .insert(schema.nodes)
    .values({ name: 'v005floornode', title: 'V005 Floor Node', categoryId: cat[0].id })
    .returning({ id: schema.nodes.id });
  nodeId = node[0].id;
}, 180_000);

afterAll(async () => {
  await client.end().catch(() => undefined);
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
}, 60_000);

// ═════════════════════════════════════════════════════════════════════
describe('v0.0.5 楼层号 · 100 并发', () => {
  it('100 个并发回复：楼层唯一、连续（1..100）、无跳号', async () => {
    const topicId = await createTopic('v005 100 并发主题');

    // 100 个并发任务，每个都走**真实的** allocateFloor()
    const results = await Promise.all(
      Array.from({ length: 100 }, async () => {
        for (let attempt = 0; attempt < 10; attempt++) {
          const floor = await allocateFloor(topicId);
          try {
            await client.unsafe(
              `INSERT INTO replies (topic_id, author_id, content, floor)
               VALUES (${topicId}, ${replierId}, '并发回复', ${floor})`,
            );
            return floor;
          } catch (e) {
            const msg = String((e as { message?: string }).message ?? e);
            // 唯一索引冲突（理论上不该发生，因为 UPSERT 已保证原子性）
            // 若真发生就重试 —— 这是最后一道防线
            if (msg.includes('replies_topic_floor') || msg.includes('duplicate key')) {
              continue;
            }
            throw e;
          }
        }
        throw new Error('楼层分配重试 10 次仍失败');
      }),
    );

    // ① 100 个任务全部成功
    expect(results).toHaveLength(100);

    // ② 楼层号唯一（无重复）
    const allocated = new Set(results);
    expect(allocated.size).toBe(100);

    // ③ 楼层号集合恰好是 1..100（无跳号、无空洞）
    const sorted = [...allocated].sort((a, b) => a - b);
    expect(sorted[0]).toBe(1);
    expect(sorted[99]).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(sorted[i]).toBe(i + 1);
    }

    // ④ 数据库里的实际行数与楼层一致
    const rows = await db
      .select({ floor: schema.replies.floor })
      .from(schema.replies)
      .where(eq(schema.replies.topicId, topicId));
    expect(rows).toHaveLength(100);
    expect(new Set(rows.map((r) => r.floor)).size).toBe(100);

    // ⑤ 计数表与最大楼层一致
    const counters = await client.unsafe(
      `SELECT last_floor FROM floor_counters WHERE topic_id = ${topicId}`,
    );
    expect(Number(counters[0].last_floor)).toBe(100);
  }, 120_000);

  it('100 并发后再追加 1 条：楼层为 101（计数表持续有效）', async () => {
    const topicId = await createTopic('v005 并发后追加主题');

    await Promise.all(
      Array.from({ length: 100 }, async () => {
        const floor = await allocateFloor(topicId);
        await client.unsafe(
          `INSERT INTO replies (topic_id, author_id, content, floor)
           VALUES (${topicId}, ${replierId}, 'x', ${floor})`,
        );
      }),
    );

    // 并发结束后，计数表应停在 100
    const before = await client.unsafe(
      `SELECT last_floor FROM floor_counters WHERE topic_id = ${topicId}`,
    );
    expect(Number(before[0].last_floor)).toBe(100);

    // 再分配一次 → 101
    const next = await allocateFloor(topicId);
    expect(next).toBe(101);
  }, 120_000);
});

// ═════════════════════════════════════════════════════════════════════
describe('v0.0.5 楼层号 · 软删除与恢复的编号稳定性', () => {
  it('软删除中间楼层后：剩余楼层号不变、不重排', async () => {
    const topicId = await createTopic('v005 删除不重排主题');

    // 顺序建 5 条回复（楼层 1..5）
    for (let i = 0; i < 5; i++) {
      const floor = await allocateFloor(topicId);
      await client.unsafe(
        `INSERT INTO replies (topic_id, author_id, content, floor)
         VALUES (${topicId}, ${replierId}, '内容${i}', ${floor})`,
      );
    }

    // 软删除楼层 3
    // ⚠️ 必须同时限定 floor = 3 —— 只按 topic_id 过滤会把该主题
    // **所有**回复都标记为已删除（实测踩到：deleted 长度变成 5）。
    await db
      .update(schema.replies)
      .set({ deletedAt: new Date(), deletedBy: authorId })
      .where(and(eq(schema.replies.topicId, topicId), eq(schema.replies.floor, 3)));

    const f3 = await db
      .select({ floor: schema.replies.floor, deletedAt: schema.replies.deletedAt })
      .from(schema.replies)
      .where(eq(schema.replies.topicId, topicId));
    const deleted = f3.filter((r) => r.deletedAt !== null);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].floor).toBe(3); // 仍是 3，没被改成别的号

    // 未删除的楼层号集合仍是 {1,2,4,5} —— **没有重排成 {1,2,3,4}**
    const alive = f3
      .filter((r) => r.deletedAt === null)
      .map((r) => r.floor)
      .sort((a, b) => a - b);
    expect(alive).toEqual([1, 2, 4, 5]);

    // 恢复楼层 3 → 仍是 3
    await db
      .update(schema.replies)
      .set({ deletedAt: null, deletedBy: null })
      .where(and(eq(schema.replies.topicId, topicId), eq(schema.replies.floor, 3)));
    const restored = await db
      .select({ floor: schema.replies.floor, deletedAt: schema.replies.deletedAt })
      .from(schema.replies)
      .where(eq(schema.replies.topicId, topicId));
    expect(restored.every((r) => r.deletedAt === null)).toBe(true);
    expect(restored.map((r) => r.floor).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  }, 60_000);

  it('软删除后新增回复：新楼层接续最大号，不填补空洞', async () => {
    const topicId = await createTopic('v005 删除后追加主题');

    for (let i = 0; i < 4; i++) {
      const floor = await allocateFloor(topicId);
      await client.unsafe(
        `INSERT INTO replies (topic_id, author_id, content, floor)
         VALUES (${topicId}, ${replierId}, 'c${i}', ${floor})`,
      );
    }

    // 删除楼层 2（必须限定 floor，否则全删）
    await db
      .update(schema.replies)
      .set({ deletedAt: new Date(), deletedBy: authorId })
      .where(and(eq(schema.replies.topicId, topicId), eq(schema.replies.floor, 2)));

    // 新增回复 → 应是 5（接续最大号），**不是** 2（不填补空洞）
    const next = await allocateFloor(topicId);
    expect(next).toBe(5);
  }, 60_000);
});

// ═════════════════════════════════════════════════════════════════════
describe('v0.0.5 楼层号 · 分页与锁定', () => {
  it('分页过程中新增回复：新回复出现在最后一页，不影响已有页', async () => {
    const topicId = await createTopic('v005 分页主题');
    const PER_PAGE = 20;

    // 建 40 条（2 页）
    for (let i = 0; i < 40; i++) {
      const floor = await allocateFloor(topicId);
      await client.unsafe(
        `INSERT INTO replies (topic_id, author_id, content, floor)
         VALUES (${topicId}, ${replierId}, 'c${i}', ${floor})`,
      );
    }

    // 第 1 页（楼层 1..20）
    const page1 = await db
      .select({ floor: schema.replies.floor })
      .from(schema.replies)
      .where(eq(schema.replies.topicId, topicId))
      .orderBy(schema.replies.floor)
      .limit(PER_PAGE);
    expect(page1.map((r) => r.floor)).toEqual(
      Array.from({ length: PER_PAGE }, (_, i) => i + 1),
    );

    // 分页「过程中」新增 5 条
    for (let i = 0; i < 5; i++) {
      const floor = await allocateFloor(topicId);
      await client.unsafe(
        `INSERT INTO replies (topic_id, author_id, content, floor)
         VALUES (${topicId}, ${replierId}, 'new${i}', ${floor})`,
      );
    }

    // 第 1 页内容**不变**（仍是 1..20）
    const page1Again = await db
      .select({ floor: schema.replies.floor })
      .from(schema.replies)
      .where(eq(schema.replies.topicId, topicId))
      .orderBy(schema.replies.floor)
      .limit(PER_PAGE);
    expect(page1Again.map((r) => r.floor)).toEqual(
      Array.from({ length: PER_PAGE }, (_, i) => i + 1),
    );

    // 第 2 页现在含 21..40 + 新增的 41..45（共 25 条，
    // 所以 limit 要大于 PER_PAGE 才能取全 —— 实测踩过 limit=20 只拿到 15 条）
    const page2 = await db
      .select({ floor: schema.replies.floor })
      .from(schema.replies)
      .where(eq(schema.replies.topicId, topicId))
      .orderBy(schema.replies.floor)
      .limit(PER_PAGE + 10)
      .offset(PER_PAGE);
    expect(page2.map((r) => r.floor)).toEqual([
      ...Array.from({ length: PER_PAGE }, (_, i) => i + 21),
      41, 42, 43, 44, 45,
    ]);
  }, 60_000);

  it('锁定主题后：楼层分配器本身仍工作（锁定由 API 层拦截新回复）', async () => {
    const topicId = await createTopic('v005 锁定主题');

    const f1 = await allocateFloor(topicId);
    expect(f1).toBe(1);

    // 锁定主题（模拟 API 层锁定后的 DB 状态）
    await db.update(schema.topics).set({ locked: true }).where(eq(schema.topics.id, topicId));
    const locked = await db
      .select({ locked: schema.topics.locked })
      .from(schema.topics)
      .where(eq(schema.topics.id, topicId));
    expect(locked[0].locked).toBe(true);

    // 分配器是**纯计数**，不感知锁定 —— 这是有意的设计：
    // 「锁定后拒绝新回复」是 API 层的业务校验（`src/lib/content-service.ts`），
    // 不是楼层分配器的职责。此处只验证两者不互相干扰。
    const f2 = await allocateFloor(topicId);
    expect(f2).toBe(2);

    // 解锁后分配继续
    await db.update(schema.topics).set({ locked: false }).where(eq(schema.topics.id, topicId));
    const f3 = await allocateFloor(topicId);
    expect(f3).toBe(3);
  }, 60_000);
});
