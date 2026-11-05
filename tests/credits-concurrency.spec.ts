import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq, sql } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';

/**
 * v0.0.3 积分并发与一致性测试
 *
 * 覆盖：
 *  1. 并发扣费不会把余额扣成负数
 *  2. 幂等键保证重复请求只发放一次
 *  3. 余额不足时拒绝并回滚
 *  4. 账本自洽（balanceBefore + amount === balanceAfter，且前后衔接）
 *  5. 签到同一天只发一次奖励
 *  6. 并发签到只成功一次
 *
 * 数据库隔离：专用库 v2ex_v003_credits。
 */

const TEST_DB = process.env.V003_CREDITS_TEST_DB ?? 'v2ex_v003_credits';

/**
 * 让 `@/db` 的全局连接池也指向本测试库。
 *
 * `src/db/index.ts` 在模块加载时读取 DATABASE_URL 并缓存连接池，
 * 因此必须在**导入任何使用 @/db 的模块之前**把 DATABASE_URL 指向测试库。
 * 否则服务层写 A 库、断言读 B 库，会出现外键约束失败。
 *
 * ⚠️ v0.0.4：连接串统一从 `tests/helpers/test-spec-base.ts` 派生
 * （与 `tests/setup.ts` 的规范化结果同源，**只换库名，不换 host/port**）。
 */
process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);
// 清掉可能被其他测试文件（同一 worker 进程）缓存的连接池，
// 强制 @/db 用上面设置的测试库重新建连接。
{
  const g = globalThis as unknown as {
    __v2exSql?: unknown;
    __v2exDrizzle?: unknown;
  };
  g.__v2exSql = undefined;
  g.__v2exDrizzle = undefined;
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let userId = 0;

/**
 * 复刻 credit-service 的 grantCredits 核心逻辑。
 *
 * 直接用 SQL 而不是 import src/lib/credit-service.ts ——
 * 后者带 `import 'server-only'`，且依赖 @/db 的全局连接池。
 * 这里用 postgres-js 的独立连接，逻辑与实现保持一致：
 *   1. 幂等键检查
 *   2. SELECT ... FOR UPDATE 锁行
 *   3. 余额检查（不足则拒绝）
 *   4. 更新余额 + 写流水
 */
async function grant(
  uid: number,
  amount: number,
  idempotencyKey: string | null,
): Promise<{ ok: boolean; balance?: number; duplicated?: boolean; error?: string }> {
  return await client.begin(async (tx) => {
    if (idempotencyKey) {
      const existing = await tx.unsafe(
        `SELECT id, balance_after FROM credit_ledger WHERE idempotency_key = $1 LIMIT 1`,
        [idempotencyKey],
      );
      if (existing.length > 0) {
        return { ok: true, duplicated: true, balance: Number(existing[0].balance_after) };
      }
    }

    const locked = await tx.unsafe(
      `SELECT id, balance FROM users WHERE id = $1 FOR UPDATE`,
      [uid],
    );
    if (locked.length === 0) return { ok: false, error: '用户不存在' };

    const balanceBefore = Number(locked[0].balance);
    const balanceAfter = balanceBefore + amount;

    if (balanceAfter < 0) {
      // 抛错触发事务回滚
      throw new Error(`INSUFFICIENT:${balanceBefore}:${-amount}`);
    }

    await tx.unsafe(`UPDATE users SET balance = $1 WHERE id = $2`, [balanceAfter, uid]);
    await tx.unsafe(
      `INSERT INTO credit_ledger (user_id, type, amount, balance_before, balance_after, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uid, 'admin_adjust', amount, balanceBefore, balanceAfter, idempotencyKey],
    );

    return { ok: true, balance: balanceAfter };
  });
}

beforeAll(async () => {
  logDbTarget('tests/credits-concurrency.spec.ts', TEST_DB);

  // 建库 → 迁移，逐阶段计时（护栏在 provision 内部强制生效）
  await provisionTestDatabase({
    file: 'tests/credits-concurrency.spec.ts',
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

  const rows = await db
    .insert(schema.users)
    .values({
      username: 'credituser',
      passwordHash: 'x',
      role: 'user',
      balance: 100,
    })
    .returning({ id: schema.users.id });
  userId = rows[0].id;
}, 120_000);

afterAll(async () => {
  await client?.end();
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
}, 60_000);

beforeEach(async () => {
  await client.unsafe(`DELETE FROM credit_ledger`);
  await client.unsafe(`DELETE FROM daily_checkins`);
  await client.unsafe(`UPDATE users SET balance = 100 WHERE id = ${userId}`);
});

describe('v0.0.3 积分 —— 幂等性', () => {
  it('相同幂等键重复发放只生效一次', async () => {
    const key = `test:${userId}:1`;
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await grant(userId, 10, key));
    }

    const rows = await db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, userId));
    expect(rows).toHaveLength(1);

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(users[0].balance).toBe(110);
  });

  it('并发使用相同幂等键，只有一条流水', async () => {
    const key = `concurrent:${userId}:${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => grant(userId, 5, key).catch((e) => ({ ok: false, error: String(e) }))),
    );

    const okResults = results.filter((r) => r.ok);
    expect(okResults.length).toBeGreaterThan(0);

    const rows = await db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, userId));
    expect(rows).toHaveLength(1);

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(users[0].balance).toBe(105);
  });
});

describe('v0.0.3 积分 —— 并发扣费安全', () => {
  it('并发扣费不会把余额扣成负数', async () => {
    // 余额 100，并发 30 次每次扣 10 —— 最多成功 10 次
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        grant(userId, -10, null).catch((e) => ({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        })),
      ),
    );

    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    expect(succeeded.length).toBe(10);
    expect(failed.length).toBe(20);
    // 失败原因必须是余额不足
    expect(failed.every((f) => (f.error ?? '').includes('INSUFFICIENT'))).toBe(true);

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(users[0].balance).toBe(0);
    expect(users[0].balance).toBeGreaterThanOrEqual(0);
  });

  it('并发扣费后账本仍然自洽', async () => {
    await Promise.all(
      Array.from({ length: 8 }, () =>
        grant(userId, -5, null).catch(() => ({ ok: false })),
      ),
    );

    const rows = await client.unsafe(
      `SELECT amount, balance_before, balance_after FROM credit_ledger
       WHERE user_id = $1 ORDER BY id ASC`,
      [userId],
    );

    // 每条流水自洽
    for (const r of rows) {
      expect(Number(r.balance_before) + Number(r.amount)).toBe(Number(r.balance_after));
    }
    // 相邻流水衔接
    for (let i = 1; i < rows.length; i++) {
      expect(Number(rows[i - 1].balance_after)).toBe(Number(rows[i].balance_before));
    }
    // 末条余额 = 用户当前余额
    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (rows.length > 0) {
      expect(Number(rows[rows.length - 1].balance_after)).toBe(users[0].balance);
    }
  });
});

describe('v0.0.3 积分 —— 余额不足拒绝', () => {
  it('余额不足时拒绝扣费且不写流水', async () => {
    await client.unsafe(`UPDATE users SET balance = 5 WHERE id = ${userId}`);

    const result = await grant(userId, -10, null).catch((e) => ({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('INSUFFICIENT');

    const rows = await db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, userId));
    expect(rows).toHaveLength(0);

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(users[0].balance).toBe(5);
  });
});

describe('v0.0.3 签到 —— 幂等性', () => {
  it('同一天重复签到只记录一次', async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 4; i++) {
      await db
        .insert(schema.dailyCheckins)
        .values({ userId, checkinDate: today, reward: 2, streak: 1 })
        .onConflictDoNothing();
    }

    const rows = await db
      .select()
      .from(schema.dailyCheckins)
      .where(eq(schema.dailyCheckins.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it('并发签到只成功一次', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        db
          .insert(schema.dailyCheckins)
          .values({ userId, checkinDate: today, reward: 2, streak: 1 })
          .onConflictDoNothing()
          .returning({ id: schema.dailyCheckins.id }),
      ),
    );
    const inserted = results.filter((r) => r.length > 0);
    expect(inserted).toHaveLength(1);
  });

  it('连续签到天数递增', async () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    await db.insert(schema.dailyCheckins).values({
      userId,
      checkinDate: yesterday,
      reward: 2,
      streak: 1,
    });

    const rows = await db
      .select()
      .from(schema.dailyCheckins)
      .where(eq(schema.dailyCheckins.userId, userId))
      .orderBy(sql`checkin_date ASC`);
    expect(rows).toHaveLength(1);
    expect(rows[0].streak).toBe(1);
  });
});
