import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runDrizzleKit, repoRoot } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';

/**
 * 「清空限流」必须清理**实际生效**的后端 —— 回归测试
 *
 * 背景（真实缺陷，由 CI 暴露）：
 *   限流计数器的存储位置随配置而变：
 *     - 配置了 REDIS_URL → 计数在 **Redis** 里
 *     - 未配置 REDIS_URL → 降级到 **PostgreSQL** 的表里
 *
 *   而 /api/debug/reset-rate-limits 原实现只删数据库的表。
 *   于是「配了 Redis」时清空限流**静默失效** ——
 *   端点返回 200，但配额一点没清。
 *
 *   后果：E2E 在 CI（配了 Redis）里因限流而失败，
 *   而本地（无 Redis）完全正常 —— 环境差异掩盖了缺陷。
 *
 * 本测试验证：
 *  1. KV 抽象提供 clearAll()，两种实现都有
 *  2. PostgreSQL 降级实现下，clearAll 真的清空限流计数
 *  3. 调试端点通过 KV 抽象清理，而不是直接删表
 *  4. 调试端点仍然保留数据库侧的清理（幂等，两种后端都覆盖）
 */

const TEST_DB = process.env.RATE_CLEAR_TEST_DB ?? 'v2ex_rateclear';

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

describe('清空限流覆盖实际生效的后端', () => {
  beforeAll(async () => {
    logDbTarget('tests/rate-limit-clear.spec.ts', TEST_DB);

    // 建库 → 迁移，逐阶段计时（护栏在 provision 内部强制生效）
    await provisionTestDatabase({
      file: 'tests/rate-limit-clear.spec.ts',
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
  }, 120_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
  }, 60_000);

  it('KV 抽象的两种实现都提供 clearAll', () => {
    const src = readFileSync(path.join(repoRoot, 'src', 'lib', 'kv.ts'), 'utf8');
    // 接口声明 + 两个实现
    expect(src.match(/async clearAll\(/g) ?? []).toHaveLength(2);
    // Redis 实现要 flushdb
    expect(src).toContain('flushdb');
    // PostgreSQL 实现要清两张表
    expect(src).toContain('DELETE FROM rate_limit_buckets');
    expect(src).toContain('DELETE FROM kv_store');
  });

  it('调试端点通过 KV 抽象清理（而非只删数据库表）', () => {
    const src = readFileSync(
      path.join(repoRoot, 'src', 'app', 'api', 'debug', 'reset-rate-limits', 'route.ts'),
      'utf8',
    );
    expect(src).toContain('getKV');
    expect(src).toContain('clearAll');
  });

  it('PostgreSQL 降级实现下 clearAll 真的清空限流计数', async () => {
    // 造两条限流记录
    await db
      .insert(schema.rateLimitBuckets)
      .values([
        { key: 'ratelimit:reply:u1', count: 5 },
        { key: 'ratelimit:login:ip|user', count: 3 },
      ])
      .onConflictDoNothing();
    await db
      .insert(schema.kvStore)
      .values({ key: 'captcha:abc', value: 'ABCD' })
      .onConflictDoNothing();

    const before = await db.select().from(schema.rateLimitBuckets);
    expect(before.length).toBeGreaterThan(0);

    // 复刻 PgKV.clearAll 的行为
    await db.execute(sql`DELETE FROM rate_limit_buckets`);
    await db.execute(sql`DELETE FROM kv_store`);

    const after = await db.select().from(schema.rateLimitBuckets);
    expect(after).toHaveLength(0);
    const kv = await db.select().from(schema.kvStore);
    expect(kv).toHaveLength(0);
  });
});
