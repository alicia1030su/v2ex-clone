/**
 * `src/lib/env-loader.mjs` 的 TypeScript 类型门面
 *
 * 为什么要单独一个 `.d.mts`：
 *  - 实现放在 `.mjs` 里，是因为 `scripts/db-admin.mjs`（纯 JS 脚本，
 *    由 `scripts/verify.sh` 用 `node` 直接调用）**不能 import TS 文件**；
 *  - 而 TS 侧需要类型提示 —— `.mjs` 里的 JSDoc 类型在
 *    `moduleResolution: bundler` 下**不会**被 TS 自动识别为导出类型，
 *    因此这里手写一份与实现**一一对应**的类型声明。
 *
 * ⚠️ 两份声明必须同步修改 —— 类型不一致会在编译期暴露，
 *    但语义漂移不会。本文件只声明**类型**，不含任何运行时逻辑。
 */

/** 加载来源标识（用于诊断报告） */
export declare const ENV_SOURCES: Readonly<{
  /** 进程环境（shell / CI / 容器注入）—— 最高优先级 */
  PROCESS: 'process.env';
  /** `ENV_FILE` 指定的文件 */
  ENV_FILE: 'ENV_FILE';
  /** 本地开发文件 */
  LOCAL: '.env.local';
  /** 容器 / 生产文件 */
  BASE: '.env';
}>;

/** 覆盖判定的上下文 */
export interface EnvDecisionContext {
  /** 是否处于 Next.js 运行时 */
  nextRuntime: boolean;
  /** Next 自动加载前的 shell 快照（不可用时为 `null`） */
  shellSnapshot: Record<string, string> | null;
  /** Next 自动加载的占位值表 */
  autoValues: Record<string, string>;
  /** **按 shell 环境**判定的测试运行时（不看文件） */
  shellTestRuntime: boolean;
  /** 测试运行时是否仍允许覆盖 */
  allowOverrideInTest: boolean;
}

/** 加载报告 */
export interface EnvReport {
  /** `ENV_FILE` 解析出的绝对路径（未指定时为 `null`） */
  envFile: string | null;
  /** 实际读取过的文件列表（按优先级顺序） */
  loadedFiles: string[];
  /** 被**填充**的变量（原本未设置） */
  appliedKeys: string[];
  /** 被**覆盖**的变量（原本是 Next 自动加载的占位值） */
  overriddenKeys: string[];
  /** 最终的 `DATABASE_URL` */
  databaseUrl: string | null;
  /** 最终连接串的端点 `host:port` */
  endpoint: string | null;
  /** 最终连接串的库名 */
  database: string | null;
  /** 最终 `DATABASE_URL` 的来源 */
  source: string;
  /** 是否处于 Next.js 运行时 */
  nextRuntime: boolean;
  /** **按 shell 环境**判定的测试运行时 */
  shellTestRuntime: boolean;
  /** 加载完成后的有效测试运行时（含文件带来的 `APP_RUNTIME_ENV`） */
  testRuntime: boolean;
}

/** 读取并解析一个 env 文件（**不写入 process.env**） */
export declare function readEnvFile(
  filePath: string,
): Record<string, string> | null;

/** 复刻 `@next/env` 的自动加载清单（**顺序即优先级**） */
export declare function nextAutoLoadFiles(cwd: string): string[];

/** 重建「Next.js 会自动加载成什么值」 */
export declare function computeAutoLoadedValues(
  cwd: string,
): Record<string, string>;

/** 当前进程是否处于「Next.js 已自动加载过 env 文件」的运行时 */
export declare function isNextRuntime(): boolean;

/** 当前进程是否为「测试运行时」 */
export declare function isTestRuntime(): boolean;

/** 取「Next.js 自动加载前的 shell 快照」 */
export declare function getShellSnapshot(): Record<string, string> | null;

/** 取连接串的端点 / 库名（**不含口令**） */
export declare function describeTarget(
  url: string | undefined,
): { endpoint: string | null; database: string | null };

/** 某个变量当前是否允许被 `ENV_FILE` 覆盖 */
export declare function canOverrideByEnvFile(
  key: string,
  context: EnvDecisionContext,
): boolean;

/** 产品侧的统一环境加载入口 */
export declare function loadProductEnv(options?: {
  /** 解析基准目录（仓库根），默认 `process.cwd()` */
  cwd?: string;
  /** 环境文件变量名，默认 `ENV_FILE` */
  envFileVar?: string;
  /** 是否允许加载 `.env.local`，默认 `true` */
  allowLocalFile?: boolean;
  /** `ENV_FILE` 指向的文件不存在时是否抛错，默认 `true` */
  requireEnvFile?: boolean;
  /** 测试运行时是否仍允许覆盖，默认 `false` */
  allowOverrideInTest?: boolean;
}): EnvReport;
