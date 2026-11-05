/**
 * 数据库生命周期日志 —— 单行 JSON 输出的唯一出口（v0.0.4 / §4.5）
 *
 * ## 为什么单独成文件
 *
 * `local-bin.ts`（子进程 spawn 出口）与 `test-db-lifecycle.ts`（建库编排）
 * **都需要**打印结构化日志。若把日志函数放在其中一个里，另一个就得 import 它，
 * 而两者之间已经存在依赖（lifecycle → local-bin）—— 那会形成**循环依赖**。
 *
 * 把日志抽到独立的叶子模块，两个模块都只依赖它，依赖图保持**无环**。
 *
 * @see docs/TEST_ENV_ISOLATION_v0.0.4.md §4.5
 */

/** 各阶段耗时（毫秒） */
export interface DbPhaseTiming {
  /** 调用方传入的测试文件名 */
  file: string;
  /** 目标库名 */
  db: string;
  /** 目标端点 `host:port` */
  endpoint: string;
  /** DROP 阶段耗时（ms） */
  dropMs: number;
  /** CREATE 阶段耗时（ms） */
  createMs: number;
  /** migrate 阶段耗时（ms） */
  migrateMs: number;
  /** seed 阶段耗时（ms，未跑 seed 时为 undefined） */
  seedMs?: number;
  /** 全流程总耗时（ms） */
  totalMs: number;
}

/** 打印结构化阶段日志（单行 JSON，便于 grep / jq 解析） */
export function emitPhaseLog(timing: DbPhaseTiming): void {
  console.log(`[db-phase] ${JSON.stringify(timing)}`);
}

/**
 * 打印子进程目标日志
 *
 * 子进程（`drizzle-kit migrate` / `tsx scripts/seed.ts`）的实际目标，
 * 与父进程（测试文件）的目标**逐字比对**即可确认一致。
 */
export function emitChildTargetLog(
  tool: string,
  args: string[],
  endpoint: string,
  db: string,
  fingerprint: string,
): void {
  console.log(
    `[db-child] ${JSON.stringify({ tool, args, endpoint, db, fp: fingerprint })}`,
  );
}
