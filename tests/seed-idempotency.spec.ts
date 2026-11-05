import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq, sql as dsql } from 'drizzle-orm';
import { verifyPassword, hashPassword } from '../src/lib/password';
import { runDrizzleKit, runTsx } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';

/**
 * Seed 只初始化、不修改已有账号 —— 回归测试（P0-1）
 *
 * 背景：
 *  早期版本的 scripts/seed.ts 在账号已存在时会 UPDATE passwordHash 与 role。
 *  这意味着「重新部署容器」会静默重置管理员口令、「用户自行改密」会被改回，
 *  属于凭据被静默篡改。
 *
 * 本测试验证：
 *  1. seed 跑第二遍后，已存在账号的 passwordHash **逐字节不变**
 *  2. seed 跑第二遍后，已存在账号的 role 不变
 *  3. 用户改密后跑 seed，新口令依然有效
 *  4. 已有 admin 被降级后，seed 不会把它「纠正」回去
 *  5. seed 缺少 SEED_ADMIN_PASSWORD 时，已存在管理员**不阻塞**启动
 *     （惰性口令解析 —— 重新部署不需要再注入初始口令）
 *  6. 多次 seed 不会产生重复账号 / 重复主题
 *
 * 数据库隔离（关键）：
 *  本测试**不导入** src/db（那会绑定开发库 DATABASE_URL），而是自建一个
 *  只连接专用库 v2ex_seedtest 的客户端。测试绝不触碰开发库或生产库。
 *  连接串由 tests/helpers/test-spec-base.ts 从**父进程规范化后的基础连接串**
 *  派生（只换库名，不换 host/port）—— 绝不使用各文件内重复的实现。
 */

const TEST_DB = process.env.SEED_TEST_DB ?? 'v2ex_seedtest';

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

function runSeed(env: Record<string, string>): string {
  return runTsx('scripts/seed.ts', {
    ...process.env,
    // 清空 ENV_FILE：避免继承 .env.test 的配置
    ENV_FILE: '',
    DATABASE_URL: dbUrlFor(TEST_DB),
    SEED_ADMIN_USERNAME: 'seedadmin',
    SEED_ADMIN_EMAIL: 'seedadmin@test.local',
    SEED_ADMIN_PASSWORD: 'seed-admin-password-99999',
    SEED_DEMO_USERS: '0',
    APP_RUNTIME_ENV: 'test',
    NODE_ENV: 'test',
    ...env,
  });
}

describe('seed 只初始化不修改已有账号（P0-1）', () => {
  beforeAll(async () => {
    logDbTarget('tests/seed-idempotency.spec.ts', TEST_DB);

    // 建库 → 迁移，逐阶段计时（护栏在 provision 内部强制生效）
    await provisionTestDatabase({
      file: 'tests/seed-idempotency.spec.ts',
      db: TEST_DB,
      adminUrl: adminUrlOf(TEST_DB),
      migrate: () =>
        runDrizzleKit(['migrate'], {
          ...process.env,
          ENV_FILE: '',
          DATABASE_URL: dbUrlFor(TEST_DB),
        }),
    });

    // 自建客户端 —— 只连专用库
    client = postgres(dbUrlFor(TEST_DB), { prepare: false });
    db = drizzle(client, { schema });
  }, 120_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
  }, 60_000);

  it('第一次 seed 创建管理员', async () => {
    runSeed({});
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, 'seedadmin'))
      .limit(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('admin');
    expect(verifyPassword('seed-admin-password-99999', rows[0].passwordHash)).toBe(true);
  });

  it('第二次 seed 不改变 passwordHash（逐字节一致）', async () => {
    const before = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, 'seedadmin'))
      .limit(1);
    expect(before).toHaveLength(1);

    runSeed({});

    const after = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, 'seedadmin'))
      .limit(1);
    expect(after).toHaveLength(1);
    // 口令哈希必须原封不动 —— 这是「不修改」的核心断言
    expect(after[0].passwordHash).toBe(before[0].passwordHash);
  });

  it('第二次 seed 不改变 role', async () => {
    const before = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.username, 'seedadmin'))
      .limit(1);

    runSeed({});

    const after = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.username, 'seedadmin'))
      .limit(1);
    expect(after[0].role).toBe(before[0].role);
  });

  it('用户自行改密后跑 seed，新口令依然有效', async () => {
    // 模拟用户改密
    await db
      .update(schema.users)
      .set({ passwordHash: hashPassword('user-chosen-password-123') })
      .where(eq(schema.users.username, 'seedadmin'));

    // 跑 seed，模拟重新部署
    runSeed({});

    const after = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, 'seedadmin'))
      .limit(1);
    // 用户自己设的口令没有被 seed 改回初始口令
    expect(verifyPassword('user-chosen-password-123', after[0].passwordHash)).toBe(true);
    expect(verifyPassword('seed-admin-password-99999', after[0].passwordHash)).toBe(false);
  });

  it('已有 admin 被降级后，seed 不会把它「纠正」回 admin', async () => {
    // 模拟人为降级（应走授权流程，不应由 seed 覆盖）
    await db
      .update(schema.users)
      .set({ role: 'moderator' })
      .where(eq(schema.users.username, 'seedadmin'));

    runSeed({});

    const after = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.username, 'seedadmin'))
      .limit(1);
    expect(after[0].role).toBe('moderator');
  });

  it('已存在管理员时，缺少 SEED_ADMIN_PASSWORD 不阻塞 seed', async () => {
    // 重新部署场景：运维通常不会再次注入初始口令。
    // 由于口令惰性解析（仅创建时才需要），此时 seed 必须正常完成。
    const out = runSeed({ SEED_ADMIN_PASSWORD: '' });
    expect(out).toContain('seed 完成');
  });

  it('seed 不会创建重复账号', async () => {
    const rows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, 'seedadmin'));
    expect(rows).toHaveLength(1);
  });

  it('多次 seed 不产生重复主题', async () => {
    const count = async () => {
      const r = await db.select({ c: dsql<number>`count(*)` }).from(schema.topics);
      return Number(r[0].c);
    };
    const before = await count();
    runSeed({});
    runSeed({});
    expect(await count()).toBe(before);
  });
});
