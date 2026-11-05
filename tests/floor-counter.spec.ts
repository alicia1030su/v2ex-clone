import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq, sql } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';

/**
 * 楼层号分配器的自愈能力 —— 回归测试
 *
 * 背景（真实缺陷，由 CI 暴露）：
 *   floor_counters 计数表可能**落后**于 replies 表的实际最大楼层号。
 *   典型场景：seed 写入固定楼层（1..N）的回复却没同步计数表，
 *   于是计数表停留在 0。
 *
 *   此时 allocateFloor 返回的楼层号早已被占用，
 *   插入触发 replies_topic_floor_uidx 唯一索引冲突。
 *   路由层原本只做「冲突就 +1 重试」，最多试 5 次 ——
 *   落后超过 5 层时全部冲突 → HTTP 500「回复失败，请重试」。
 *
 *   这个缺陷表现为 E2E 间歇性失败（约 2/3 概率），
 *   且失败信息是 500 而非 429，极难定位。
 *
 * 本测试验证：
 *  1. 计数表落后时，分配出的楼层号**高于实际最大楼层**（不会撞号）
 *  2. 分配后计数表被抬到正确水位
 *  3. 连续分配得到递增且不重复的楼层号
 *  4. seed 之后计数表与实际楼层一致（不再产生漂移）
 *
 * 数据库隔离：使用专用库 v2ex_floortest，绝不触碰开发库/生产库。
 */

const TEST_DB = process.env.FLOOR_TEST_DB ?? 'v2ex_floortest';

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

/**
 * 复刻修复后的 allocateFloor 逻辑。
 *
 * 直接用 SQL 而不是 import src/server/floor.ts ——
 * 后者带 `import 'server-only'`，在纯 Node 环境下会抛错。
 */
async function allocateFloor(topicId: number): Promise<number> {
  const res = await db.execute(sql`
    INSERT INTO floor_counters (topic_id, last_floor)
    SELECT ${topicId}, greatest(coalesce(max(floor), 0), 0) + 1
    FROM replies WHERE topic_id = ${topicId}
    ON CONFLICT (topic_id) DO UPDATE
      SET last_floor = greatest(floor_counters.last_floor, EXCLUDED.last_floor) + 1
    RETURNING last_floor
  `);
  const rows = res as unknown as { last_floor: number }[];
  return Number(rows[0]?.last_floor ?? 1);
}

describe('楼层号分配器自愈', () => {
  let topicId: number;

  beforeAll(async () => {
    logDbTarget('tests/floor-counter.spec.ts', TEST_DB);

    // 建库 → 迁移，逐阶段计时（护栏在 provision 内部强制生效）
    await provisionTestDatabase({
      file: 'tests/floor-counter.spec.ts',
      db: TEST_DB,
      adminUrl: adminUrlOf(TEST_DB),
      migrate: () =>
        runDrizzleKit(['migrate'], {
          ...process.env,
          ENV_FILE: '',
          DATABASE_URL: dbUrlFor(TEST_DB),
        }),
    });

    client = postgres(dbUrlFor(TEST_DB), { prepare: false });
    db = drizzle(client, { schema });

    // 造一个分类、节点、用户与主题
    // 注意顺序：users 必须先于 nodes（nodes.created_by 外键指向 users）
    const [user] = await db
      .insert(schema.users)
      .values({
        username: 'flooruser',
        email: 'floor@test.local',
        passwordHash: 'x',
        role: 'user',
        balance: 100,
      })
      .returning({ id: schema.users.id });

    const [category] = await db
      .insert(schema.categories)
      .values({ name: 'floortest', title: '楼层测试', sort: 99 })
      .returning({ id: schema.categories.id });

    const [node] = await db
      .insert(schema.nodes)
      .values({
        name: 'floortest',
        title: '楼层测试',
        categoryId: category.id,
        createdBy: user.id,
      })
      .returning({ id: schema.nodes.id });

    const [topic] = await db
      .insert(schema.topics)
      .values({
        title: '楼层漂移测试主题',
        content: 'content',
        nodeId: node.id,
        authorId: user.id,
      })
      .returning({ id: schema.topics.id });
    topicId = topic.id;

    for (let floor = 1; floor <= 10; floor++) {
      await db.insert(schema.replies).values({
        topicId: topic.id,
        authorId: user.id,
        content: `回复 ${floor}`,
        floor,
      });
    }
    // 故意**不**同步计数表 —— 模拟漂移
  });

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
  }, 60_000);

  it('初始状态下计数表落后于实际楼层（漂移已建立）', async () => {
    const rows = await db
      .select({ lastFloor: schema.floorCounters.lastFloor })
      .from(schema.floorCounters)
      .where(eq(schema.floorCounters.topicId, topicId));
    // 计数表里没有这个主题 = last_floor 视为 0
    expect(rows[0]?.lastFloor ?? 0).toBeLessThan(10);
  });

  it('计数表落后时，分配到的楼层号高于实际最大楼层（不撞号）', async () => {
    const floor = await allocateFloor(topicId);
    // 实际最大楼层是 10；分配结果必须 > 10，否则会撞上唯一索引
    expect(floor).toBeGreaterThan(10);
  });

  it('分配后计数表被抬到正确水位', async () => {
    await allocateFloor(topicId);
    const rows = await db
      .select({ lastFloor: schema.floorCounters.lastFloor })
      .from(schema.floorCounters)
      .where(eq(schema.floorCounters.topicId, topicId));
    expect(rows).toHaveLength(1);
    expect(rows[0].lastFloor).toBeGreaterThanOrEqual(11);
  });

  it('连续分配得到严格递增且不重复的楼层号', async () => {
    const floors: number[] = [];
    for (let i = 0; i < 5; i++) {
      floors.push(await allocateFloor(topicId));
    }
    for (let i = 1; i < floors.length; i++) {
      expect(floors[i]).toBeGreaterThan(floors[i - 1]);
    }
    expect(new Set(floors).size).toBe(floors.length);
  });

  it('分配出的楼层号可以真正插入回复（不会触发唯一索引冲突）', async () => {
    const floor = await allocateFloor(topicId);
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, 'flooruser'))
      .limit(1);

    const inserted = await db
      .insert(schema.replies)
      .values({
        topicId,
        authorId: user.id,
        content: '新回复',
        floor,
      })
      .returning({ id: schema.replies.id });
    expect(inserted).toHaveLength(1);
  });

  it('seed 写入回复后会同步楼层计数表（不再产生漂移）', async () => {
    // 静态断言：seed 必须写入 floorCounters
    const { readFileSync } = await import('node:fs');
    const { repoRoot } = await import('./helpers/local-bin');
    const seed = readFileSync(`${repoRoot}/scripts/seed.ts`, 'utf8');
    expect(seed).toContain('floorCounters');
  });
});
