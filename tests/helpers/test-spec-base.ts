/**
 * 规格文件的统一入口 —— 消除各 spec 内重复的 `testDatabaseUrl()` 实现（v0.0.4 / T03）
 *
 * ## 为什么需要这个模块
 *
 * 修复前，**10 个建库 spec 各自复制**了一份几乎一样的 `testDatabaseUrl()`：
 *
 * ```ts
 * function testDatabaseUrl(): string {
 *   const base = process.env.DATABASE_URL;   // ← 来自 .env.local → 5432
 *   const url = new URL(base);
 *   url.pathname = `/${TEST_DB}`;              // ← 只换库名，不换 host:port
 *   return url.toString();
 * }
 * ```
 *
 * 这份重复实现是问题 A 的**传播载体** —— 每个文件都自己解析一次连接串，
 * 于是「父进程算好的目标」与「各文件各自算的目标」可能不一致。
 *
 * 现在：所有连接串都从**同一个已规范化的基础连接串**派生
 * （`tests/helpers/test-env.ts` 的 `getResolvedTestEnv()`），
 * 因此**必然**指向同一个 PG 实例、同一套凭据。
 *
 * @see docs/TEST_ENV_ISOLATION_v0.0.4.md §3.4 / T03
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema';
import { adminUrlFor, fingerprintOf, getResolvedTestEnv, testDatabaseUrl } from './test-env';

/** 规格文件所需的连接串与客户端 */
export interface TestDbHandles {
  /** 指向本 spec 专用库的连接串 */
  url: string;
  /** 指向管理库（`postgres`）的连接串 */
  adminUrl: string;
  /** 独立 postgres 客户端（只连专用库） */
  client: ReturnType<typeof postgres>;
  /** drizzle 实例（绑定上面的 client） */
  db: ReturnType<typeof drizzle<typeof schema>>;
}

/**
 * 取得本 spec 专用库的连接串
 *
 * **只换库名**，host / port / 凭据全部继承自父进程规范化后的基础连接串。
 */
export function dbUrlFor(testDb: string): string {
  return testDatabaseUrl(testDb);
}

/** 取得管理库连接串（`DROP DATABASE` / `CREATE DATABASE` 的落点） */
export function adminUrlOf(testDb: string): string {
  return adminUrlFor(testDb);
}

/**
 * 打印本 spec 的数据库目标（供人工核验父子一致性）
 *
 * 与 `tests/setup.ts` 的 `[db-target]` 行、`local-bin.ts` 的 `[db-child]` 行
 * 合起来构成完整的一致性证据链：
 *
 * ```
 * [db-target] file=tests/seed-idempotency.spec.ts host:port=127.0.0.1:55440 db=v2ex_seedtest fp=127.0.0.1:55440/v2ex_seedtest@v2ex
 * [db-child]  {"tool":"drizzle-kit","args":["migrate"],"endpoint":"127.0.0.1:55440","db":"v2ex_seedtest","fp":"127.0.0.1:55440/v2ex_seedtest@v2ex"}
 * ```
 *
 * 两行的 `endpoint` / `db` / `fp` **必须逐字相同**。
 */
export function logDbTarget(file: string, testDb: string): void {
  const resolved = getResolvedTestEnv();
  const endpoint = resolved.endpoint;
  const fp = fingerprintOf(dbUrlFor(testDb));
  console.log(
    `[db-target] file=${file} host:port=${endpoint} db=${testDb} fp=${fp}`,
  );
}

/**
 * 创建一个只连专用库的独立客户端 + drizzle 实例
 *
 * 与 `src/db` 的全局连接池**完全隔离** —— 测试绝不触碰开发库或生产库。
 */
export function createTestClient(
  testDb: string,
  options: { max?: number } = {},
): TestDbHandles {
  const url = dbUrlFor(testDb);
  const client = postgres(url, { prepare: false, max: options.max ?? 10 });
  const db = drizzle(client, { schema });
  return { url, adminUrl: adminUrlOf(testDb), client, db };
}
