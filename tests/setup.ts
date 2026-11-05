/**
 * 单元测试前置准备 —— **全仓唯一**的环境入口（v0.0.4 / 问题 A）
 *
 * ## 修复了什么
 *
 * **修复前**：本文件注释声称「加载 .env.test」，实际只加载了 `.env.local` + `.env`。
 * 于是单元测试默认连到 **5432 开发库**，并在开发实例上执行
 * `DROP DATABASE` / `CREATE DATABASE` —— 这是**开发库污染 + 误删**，
 * 而不是「超时」问题。
 *
 * **修复后**：
 *  1. 走统一解析器 `tests/helpers/test-env.ts`，加载优先级唯一且显式：
 *     `process.env`（shell / CI） > `ENV_FILE` > `.env.test` > `.env`；
 *     **`.env.local` 在单元测试流程中永不加载**；
 *  2. `ENV_FILE` 的 `override: true` **被移除** —— shell 显式设置的
 *     `DATABASE_URL` 永远赢（这正是 `scripts/env-dump.mjs` 注释里
 *     早就写明、但实现从未对齐的期望语义）；
 *  3. 解析结果写回 `process.env` 并附上 `V2EX_DB_FINGERPRINT`，
 *     子进程只继承、不再解析；
 *  4. 清空 `ENV_FILE` —— 父进程已规范化完毕，后续任何模块
 *     （含 `src/db/index.ts`）都不应再自行解析 env 文件；
 *  5. 打印**脱敏**指纹 `[db-target]`，供人工核验父子一致性；
 *  6. 探活一次（§4.7.1 判据 C），把「PG 未就绪」与「产品缺陷」区分开。
 *
 * @see docs/TEST_ENV_ISOLATION_v0.0.4.md §3.1 / §3.2 / §3.4 / §3.6 / §4.7.1
 */
import postgres from 'postgres';
import { getResolvedTestEnv, withAdminDatabase } from './helpers/test-env';

// ── 解析一次，进程内缓存 ────────────────────────────────────────────
const resolved = getResolvedTestEnv();

// ── 写回规范化结果 + 指纹（子进程只继承，不再解析）──────────────────
process.env.DATABASE_URL = resolved.databaseUrl;
process.env.V2EX_DB_FINGERPRINT = resolved.fingerprint;

// ── 清空 ENV_FILE ──────────────────────────────────────────────────
// 父进程已把环境**规范化**完毕。若 ENV_FILE 仍在，后续被 import 的模块
// （如 `src/db/index.ts`，它对 ENV_FILE 用了 override:true）会**重新解析**
// env 文件并**覆盖**我们刚写好的 DATABASE_URL —— 那正是「父子走散」的机制。
// 清空它，让「父进程规范化 → 子进程继承」成为唯一事实。
process.env.ENV_FILE = '';

// ── 打印脱敏指纹（口令绝不进日志）──────────────────────────────────
console.log(
  `[db-target] file=tests/setup.ts host:port=${resolved.endpoint} ` +
    `db=${resolved.database} fp=${resolved.fingerprint} source=${resolved.source}`,
);

/**
 * 探活（§4.7.1 判据 C）—— 每个测试文件开始时执行一次
 *
 * 目的：把「PG 未就绪」与「产品缺陷」**在测试开始前**区分开。
 * 若 PG 已被回收或尚未就绪，这里会抛出明确的「PG 未就绪」错误，
 * 而不是让后续几百条用例报一堆看不懂的连接错误。
 *
 * 探活连的是**管理库**（`postgres`）—— 它在任何 PG 实例上都必然存在，
 * 因此探活本身不依赖「基础连接串里的库名是否已建好」。
 */
async function probeDatabase(): Promise<void> {
  const probe = postgres(withAdminDatabase(resolved.databaseUrl), {
    prepare: false,
    connect_timeout: 3,
    max: 1,
  });
  try {
    await probe.unsafe('select 1');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const [host, port] = resolved.endpoint.split(':');
    throw new Error(
      `[db-setup] PG 未就绪（${resolved.endpoint}）：${reason}\n` +
        `  这是**环境问题**，不是产品缺陷。排查：\n` +
        `    1) pg_isready -h ${host} -p ${port}\n` +
        `    2) 实例是否在运行：bash tests/helpers/start-test-pg.sh status\n` +
        `    3) 若实例在跑但仍不可用，检查它是否处于 crash recovery / I/O 积压态\n` +
        `       （日志里的 "syncing data directory" / "redo" 段）—— 那种状态下测得的\n` +
        `       任何耗时数字都不可采信。`,
    );
  } finally {
    await probe.end().catch(() => undefined);
  }
}

await probeDatabase();
