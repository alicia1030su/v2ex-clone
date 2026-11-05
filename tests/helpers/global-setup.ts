/**
 * Vitest 全局前置 —— **只跑一次**（v0.0.4）
 *
 * ## 为什么需要它
 *
 * `tests/setup.ts` 是 **setupFiles** —— 它对**每个**测试文件都执行一遍。
 * 若把「确保基础库存在且已迁移」放在那里，就会有 **15 个测试文件各跑一次**
 * `drizzle-kit migrate`，既慢又在 Windows 上把 PG 的连接数打满
 * （实测表现为 `CONNECT_TIMEOUT` —— 那**不是** PG 未就绪，是连接被抢占）。
 *
 * 拆成两层：
 *  - **globalSetup（本文件）**：整个 vitest 进程**只跑一次** ——
 *    建基础库 + 跑迁移；
 *  - **setupFiles（`tests/setup.ts`）**：每个文件一次，但只做**轻量**的事 ——
 *    解析环境、写回规范化结果、探活。
 *
 * ## 为什么基础库需要迁移
 *
 * 有**两类**用例直接用**基础库**（不是各自的专属库）：
 *
 *  1. `tests/captcha.spec.ts` —— 验证码答案存在服务端 KV。
 *    `src/lib/kv.ts` 在 `REDIS_URL` 为空时**降级到 PostgreSQL**，
 *    用 `kv_store` / `rate_limit_buckets` 两张表。本机没有 Redis → 走 PG 降级。
 *  2. `tests/db-lazy-init.spec.ts` 的「生产模式下反复查询」用例 ——
 *    对基础库跑 `select 1`。
 *
 * 基础库没迁移 → 这两类用例会因「表不存在 / 库不存在」而失败 ——
 * 而那**不是**它们要验证的东西，是**环境准备不足**。
 *
 * @see docs/TEST_ENV_ISOLATION_v0.0.4.md §4.5 / §4.6
 */
import postgres from 'postgres';
import { getResolvedTestEnv, withAdminDatabase } from './test-env';
import { assertDatabaseAllowed } from './test-db-guard';
import { runDrizzleKit, buildChildEnv } from './local-bin';

/** 确保基础库存在（幂等） */
async function ensureBaseDatabaseExists(): Promise<boolean> {
  const resolved = getResolvedTestEnv();

  // 基础库必须在护栏允许清单内 —— 否则（例如指向开发库）直接中止，
  // 绝不「顺手」在开发库上建表。
  assertDatabaseAllowed(resolved.database);

  const admin = postgres(withAdminDatabase(resolved.databaseUrl), {
    prepare: false,
    max: 1,
  });
  let exists = false;
  try {
    const rows = await admin.unsafe<{ n: number }[]>(
      'SELECT count(*)::int AS n FROM pg_database WHERE datname = $1',
      [resolved.database],
    );
    exists = Number(rows[0]?.n ?? 0) > 0;
  } finally {
    await admin.end().catch(() => undefined);
  }

  if (exists) return false;

  const creator = postgres(withAdminDatabase(resolved.databaseUrl), {
    prepare: false,
    max: 1,
  });
  try {
    await creator.unsafe(`CREATE DATABASE "${resolved.database}"`);
    console.log(`[db-setup] 已创建基础库 ${resolved.database}`);
    return true;
  } finally {
    await creator.end().catch(() => undefined);
  }
}

/** 基础库是否已迁移（判据：存在 drizzle.__drizzle_migrations 表） */
async function isBaseDatabaseMigrated(): Promise<boolean> {
  const resolved = getResolvedTestEnv();
  const client = postgres(resolved.databaseUrl, { prepare: false, max: 1 });
  try {
    const rows = await client.unsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'drizzle' AND c.relname = '__drizzle_migrations'`,
    );
    return Number(rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function setup(): Promise<void> {
  const resolved = getResolvedTestEnv();
  console.log(
    `[db-setup] globalSetup：host:port=${resolved.endpoint} db=${resolved.database} ` +
      `fp=${resolved.fingerprint} source=${resolved.source}`,
  );

  await ensureBaseDatabaseExists();

  if (await isBaseDatabaseMigrated()) {
    console.log(`[db-setup] 基础库 ${resolved.database} 已迁移，跳过`);
    return;
  }

  // 迁移幂等：已迁移过则 drizzle-kit 直接跳过
  runDrizzleKit(['migrate'], buildChildEnv());
  console.log(`[db-setup] 基础库 ${resolved.database} 已迁移`);
}

export async function teardown(): Promise<void> {
  // 刻意**不删**基础库 —— 它是隔离实例上的常驻库，跨轮次复用可省掉重复迁移。
  // 彻底清理用：bash tests/helpers/start-test-pg.sh cleanup
}
