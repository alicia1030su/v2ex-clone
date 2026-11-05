/**
 * 测试库生命周期封装 —— **阶段耗时日志**的唯一出口（v0.0.4 / 问题 B）
 *
 * ## 为什么要有阶段耗时日志
 *
 * 历史上出现过一次「`CREATE DATABASE` 38.6s」的观测值，被误判成
 * 「数据目录 1.4GB → 复制模板库 → 逐文件 fsync → 必然很慢」，
 * 由此推导出一整套错误结论（换盘、装 Docker、改 `fsync=off`）。
 *
 * 事后实测证明：**38.6s 是 PG 处于 crash recovery / I/O 积压态时的观测值**，
 * 稳态只要 **2.0~2.3 秒**。数据目录大小**根本不是瓶颈**。
 *
 * 阶段日志的价值就在这里：它让「PG 未进入稳态」与「真超时」**可区分** ——
 * 一个文件的 `createMs` 突然 30s+，而同批文件都是 2s 量级，
 * 说明那一时刻 PG 进入了积压态，**该文件其余耗时数字均不可采信**，
 * 这是**环境问题**，不是产品缺陷。
 *
 * ## 日志格式（单行 JSON，便于 grep 与归档）
 *
 * ```
 * [db-phase] {"file":"tests/seed-idempotency.spec.ts","db":"v2ex_seedtest",
 *   "endpoint":"127.0.0.1:55440","dropMs":1204,"createMs":2130,"migrateMs":5380,
 *   "seedMs":4120,"totalMs":12834}
 * ```
 *
 * @see docs/TEST_ENV_ISOLATION_v0.0.4.md §4.5 / §4.7.1 判据 D
 */
import postgres from 'postgres';
import { assertSafeTestTarget } from './test-db-guard';
import { emitPhaseLog, emitChildTargetLog } from './test-db-log';
import type { DbPhaseTiming } from './test-db-log';

export type { DbPhaseTiming };
export { emitPhaseLog, emitChildTargetLog };

/** `provisionTestDatabase` 的参数 */
export interface ProvisionOptions {
  /** 测试文件名（用于日志） */
  file: string;
  /** 目标库名 */
  db: string;
  /** 管理连接串（库名为 `postgres`） */
  adminUrl: string;
  /** 跑迁移（通常是 `runDrizzleKit(['migrate'], childEnv)`） */
  migrate: () => void;
  /** 跑种子数据（可选） */
  seed?: () => void;
}

/** 取连接串的端点 */
function endpointOf(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}`;
}

/** 高精度计时器（毫秒，保留小数） */
function nowMs(): number {
  return Number(process.hrtime.bigint() / 1_000n) / 1000;
}

/**
 * 打印父子进程一致性日志
 *
 * 子进程（`drizzle-kit migrate` / `tsx scripts/seed.ts`）的实际目标，
 * 与父进程（测试文件）的目标**逐字比对**即可确认一致。
 *
 * 实现见 `tests/helpers/test-db-log.ts` —— 独立成叶子模块是为了让
 * `local-bin.ts` 与本模块都只依赖它，依赖图保持**无环**。
 */

/**
 * 删除测试库（**必须先过护栏**）
 *
 * @throws 护栏拒绝时抛错 —— 在发出任何 SQL 之前
 */
export async function dropTestDatabase(adminUrl: string, dbName: string): Promise<void> {
  assertSafeTestTarget(adminUrl, dbName);

  const admin = postgres(adminUrl, { prepare: false });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    // 等待目录项真正从 pg_database 消失 —— 否则紧随其后的 CREATE
    // 会撞上「数据库已存在」（SQLSTATE 42P04）。
    await waitForDatabaseGone(admin, dbName, 5_000);
  } finally {
    await admin.end().catch(() => undefined);
  }
}

/**
 * 等待数据库在 `pg_database` 目录里**真正消失**
 *
 * ## 为什么需要这一步（实测踩到的真实坑）
 *
 * PostgreSQL 的 `DROP DATABASE` 是**异步**的：语句返回时，
 * 目录删除已提交，但 `pg_database` 里的目录项**可能还残留一小段时间**。
 * 紧接着执行 `CREATE DATABASE <同名>` 会报：
 *
 * ```
 * 错误: 重复键违反唯一约束 "pg_database_datname_index"
 * 键值 "(datname)=(v2ex_admintest)" 已经存在
 * ```
 *
 * 实测复现：把 DROP 与 CREATE 放在**两条并发连接**上（模拟前一个 spec 的
 * `afterAll` 与本 spec 的 `beforeAll` 重叠），8 次里有 1~2 次失败。
 *
 * 这个失败是**时序问题**，不是产品缺陷 —— 但它会让测试**随机失败**，
 * 比稳定失败更糟糕。因此这里显式等待目录项消失，并在必要时重试。
 *
 * @param timeoutMs 最长等待时间（默认 5000ms）
 * @returns 是否在超时前消失
 */
async function waitForDatabaseGone(
  client: ReturnType<typeof postgres>,
  dbName: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await client.unsafe<{ n: number }[]>(
      'SELECT count(*)::int AS n FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (Number(rows[0]?.n ?? 0) === 0) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * 创建测试库（**必须先过护栏**）
 *
 * @throws 护栏拒绝时抛错 —— 在发出任何 SQL 之前
 */
export async function createTestDatabase(
  adminUrl: string,
  dbName: string,
  template?: string,
): Promise<void> {
  assertSafeTestTarget(adminUrl, dbName);

  const admin = postgres(adminUrl, { prepare: false });
  try {
    const templateClause = template ? ` TEMPLATE "${template}"` : '';

    // CREATE 与 DROP 存在时序竞争：若同名库的目录项还没从 pg_database 里消失，
    // CREATE 会报「数据库已存在」（SQLSTATE 42P04 = duplicate_database）。
    // 最多重试 3 次：每次都先等目录项消失、再 DROP、再 CREATE。
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await admin.unsafe(`CREATE DATABASE "${dbName}"${templateClause}`);
        return;
      } catch (err) {
        lastError = err;
        // 42P04 = duplicate_database；42P01 = duplicate_table 等一并视为「已存在」
        const code = typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
        if (code !== '42P04') throw err;

        // 已存在 → 强制 DROP（清掉可能残留的连接），等目录项消失，再重试。
        await admin
          .unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
          .catch(() => undefined);
        await waitForDatabaseGone(admin, dbName, 5_000);
      }
    }
    throw lastError;
  } finally {
    await admin.end().catch(() => undefined);
  }
}

/**
 * 执行完整的建库流程：DROP → CREATE → migrate（→ seed），逐阶段计时
 *
 * 任一阶段失败都会抛错，并在错误信息里带上**已耗时**与**失败阶段名**，
 * 便于区分「环境问题」与「产品缺陷」。
 */
export async function provisionTestDatabase(
  options: ProvisionOptions,
): Promise<DbPhaseTiming> {
  const { file, db, adminUrl, migrate, seed } = options;
  const endpoint = endpointOf(adminUrl);

  // 护栏：连库之前先确认目标安全
  assertSafeTestTarget(adminUrl, db);

  const startedAt = nowMs();

  // ── 阶段 1：DROP ───────────────────────────────────────────────
  const dropStart = nowMs();
  try {
    await dropTestDatabase(adminUrl, db);
  } catch (err) {
    throw wrapPhaseError('drop', err, nowMs() - startedAt);
  }
  const dropMs = Math.round(nowMs() - dropStart);

  // ── 阶段 2：CREATE ─────────────────────────────────────────────
  const createStart = nowMs();
  try {
    await createTestDatabase(adminUrl, db);
  } catch (err) {
    throw wrapPhaseError('create', err, nowMs() - startedAt);
  }
  const createMs = Math.round(nowMs() - createStart);

  // ── 阶段 3：migrate ────────────────────────────────────────────
  const migrateStart = nowMs();
  try {
    migrate();
  } catch (err) {
    throw wrapPhaseError('migrate', err, nowMs() - startedAt);
  }
  const migrateMs = Math.round(nowMs() - migrateStart);

  // ── 阶段 4：seed（可选）────────────────────────────────────────
  let seedMs: number | undefined;
  if (seed) {
    const seedStart = nowMs();
    try {
      seed();
    } catch (err) {
      throw wrapPhaseError('seed', err, nowMs() - startedAt);
    }
    seedMs = Math.round(nowMs() - seedStart);
  }

  const totalMs = Math.round(nowMs() - startedAt);

  const timing: DbPhaseTiming = {
    file,
    db,
    endpoint,
    dropMs,
    createMs,
    migrateMs,
    ...(seedMs === undefined ? {} : { seedMs }),
    totalMs,
  };
  emitPhaseLog(timing);
  return timing;
}

/**
 * 把阶段失败包装成带阶段名与已耗时的错误
 *
 * 错误信息里**明确区分**「环境问题」与「产品缺陷」：
 * 建库阶段（DROP / CREATE）失败几乎总是环境问题；
 * migrate / seed 失败才可能是产品缺陷。
 */
function wrapPhaseError(phase: string, err: unknown, elapsedMs: number): Error {
  const original = err instanceof Error ? err : new Error(String(err));
  const isEnvironmentPhase = phase === 'drop' || phase === 'create';
  const hint = isEnvironmentPhase
    ? '这通常是**环境问题**（PG 未就绪 / 处于 crash recovery / I/O 积压态），不是产品缺陷。\n' +
      '  排查：pg_isready 看端点；grep 日志里的 "syncing data directory" / "redo" 段；\n' +
      '  空库建删往返应 < 10s（稳态实测 2.0~2.3s）。'
    : '这可能是**产品缺陷**，也可能是环境问题 —— 请结合本文件的阶段耗时判断。';

  const wrapped = new Error(
    `[db-lifecycle] 阶段 ${phase} 失败（已耗时 ${Math.round(elapsedMs)}ms）：${original.message}\n` +
      `  ${hint}`,
  );
  wrapped.cause = original;
  return wrapped;
}
