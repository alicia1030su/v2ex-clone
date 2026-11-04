/**
 * 全仓统一的 dotenv 加载语义 —— **产品侧**（v0.0.4 · 问题 A 收尾）
 *
 * ## 为什么要有这个模块
 *
 * 修复前，全仓有 **6 处各自独立** 的 dotenv 加载实现
 * （`src/db/index.ts` / `drizzle.config.ts` / `scripts/seed.ts` /
 *  `scripts/admin-cli.ts` / `scripts/db-admin.mjs` / `tests/setup.ts`），
 * 逻辑几乎一样却没有共享实现，于是出现两个高危静默错误：
 *
 *  1. **`.env.test` 从未被加载** —— 注释声称加载它，实际只加载了 `.env.local`；
 *  2. **`ENV_FILE` 的 `override: true` 反转了优先级** —— 命令行 / CI 显式注入的
 *     `DATABASE_URL` 会被 `ENV_FILE` 文件**静默覆盖**，
 *     表现为「以为在测试库跑、其实跑到别的库」。
 *
 * 本模块确立**产品侧**的加载优先级（唯一且显式）：
 *
 * | 优先级 | 来源 | 语义 |
 * |---|---|---|
 * | 1（最高） | `process.env`（shell / CI / 容器注入） | **永不被文件覆盖** |
 * | 2 | `ENV_FILE` 指定的文件 | 只填充**未设置**的变量 |
 * | 3 | `.env.local`（仅**非测试**运行时） | 只填充未设置的变量 |
 * | 4 | `.env`（容器 / 生产） | 只填充未设置的变量 |
 *
 * ## 与测试侧的差异（唯一一处，且是有意的）
 *
 * 测试侧（`tests/helpers/test-env.ts`）**永不加载 `.env.local`** ——
 * 那会把单元测试导向开发库（5432）。产品侧**必须**加载 `.env.local`，
 * 否则开发者的本地配置直接失效。
 * 因此两者只有「`.env.local` vs `.env.test`」这一行的差别，
 * 其余（shell 最高、`ENV_FILE` 只填空位、父子一致）**完全一致**。
 *
 * ## Next.js 预加载的特例（本模块最关键的一段逻辑）
 *
 * Next.js 在**应用代码执行之前**就通过 `@next/env` 自动加载
 * `.env.{NODE_ENV}.local` / `.env.local` / `.env.{NODE_ENV}` / `.env`，
 * 于是当 `src/db/index.ts` 运行时，`process.env.DATABASE_URL`
 * **已经**被 `.env.local` 占位 —— 若还坚持「只填空位」，`ENV_FILE` 永远赢不了。
 *
 * 但 Next.js 的自动加载**从不覆盖 shell 已注入的变量**
 * （`@next/env` 的 `processEnv()` 只填充 `initialEnv` 里没有的键），
 * 因此「被文件占位的值」与「shell 注入的值」在语义上**可以精确区分**：
 *
 *  - `@next/env` 在加载前会拍下 `initialEnv = { ...process.env }` ——
 *    那是**精确的 shell / CI 快照**；
 *  - 一个变量在 `initialEnv` 里 → 它是 **shell 注入**的 → **绝不覆盖**；
 *  - 一个变量不在 `initialEnv` 里但 `process.env` 里有 → 它是**文件占位**的
 *    → 允许被 `ENV_FILE` 覆盖。
 *
 * ⚠️ 关键实现细节：必须用 `createRequire()` **运行时** require `@next/env`，
 *    **不能**用静态 `import` —— 静态 import 会被 webpack 打包成
 *    **另一个模块实例**，其 `initialEnv` 恒为 `undefined`（已实测）。
 *
 * 在**非 Next 运行时**（脚本、drizzle-kit 子进程）不存在自动加载，
 * `process.env` 全部来自 shell / CI，于是 `ENV_FILE` 严格「只填空位」——
 * 与测试侧语义完全一致。
 *
 * ## 为什么是 `.mjs` 而不是 `.ts`
 *
 * `scripts/db-admin.mjs` 是纯 JS 脚本（由 `scripts/verify.sh` 用 `node` 直接调用，
 * 见 `tests/docker-config.spec.ts` 的断言），**不能 import TS 文件**。
 * 把实现放在 `.mjs` 里，TS 侧直接 import 同一个 `.mjs`，
 * 从根本上避免「两份实现各自漂移」—— 而两份实现正是本轮问题的根源。
 *
 * @see docs/TEST_ENV_ISOLATION_v0.0.4.md §3.1 / §3.2 / §3.3 / §3.4
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parse as parseEnvFile } from 'dotenv';

/** 加载来源标识（用于诊断报告） */
export const ENV_SOURCES = Object.freeze({
  /** 进程环境（shell / CI / 容器注入）—— 最高优先级 */
  PROCESS: 'process.env',
  /** `ENV_FILE` 指定的文件 */
  ENV_FILE: 'ENV_FILE',
  /** 本地开发文件 */
  LOCAL: '.env.local',
  /** 容器 / 生产文件 */
  BASE: '.env',
});

/** Next.js 自动加载完成后写入的标记（见 `@next/env` 的 `processEnv()`） */
const NEXT_PROCESSED_ENV_FLAG = '__NEXT_PROCESSED_ENV';

/**
 * 读取并解析一个 env 文件（**不写入 process.env**）
 *
 * @param {string} filePath 文件路径
 * @returns {Record<string, string> | null} 解析结果；文件不存在时返回 `null`
 */
export function readEnvFile(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return parseEnvFile(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 复刻 `@next/env` 的自动加载清单（**顺序即优先级**）
 *
 * 与 `@next/env` 的 `loadEnvConfig()` 完全一致：
 *   test        → `.env.test.local`, `.env.test`
 *   development → `.env.development.local`, `.env.local`, `.env.development`, `.env`
 *   production  → `.env.production.local`, `.env.local`, `.env.production`, `.env`
 *
 * @param {string} cwd 仓库根目录
 * @returns {string[]} 相对路径列表
 */
export function nextAutoLoadFiles(cwd) {
  const mode =
    process.env.NODE_ENV === 'test'
      ? 'test'
      : process.env.NODE_ENV === 'production'
        ? 'production'
        : 'development';

  if (mode === 'test') return ['.env.test.local', '.env.test'];
  if (mode === 'production') {
    return ['.env.production.local', '.env.local', '.env.production', '.env'];
  }
  return ['.env.development.local', '.env.local', '.env.development', '.env'];
}

/**
 * 重建「Next.js 会自动加载成什么值」
 *
 * 规则与 `@next/env` 的 `processEnv()` 一致：
 * 按清单顺序遍历，**只填充尚未被前面文件占位的键**。
 *
 * 注意：`@next/env` 还会做变量插值（`${VAR}`），这里不做 ——
 * 本仓库的所有 env 文件都没有使用插值语法，故无实际差异。
 *
 * @param {string} cwd 仓库根目录
 * @returns {Record<string, string>} 键值表
 */
export function computeAutoLoadedValues(cwd) {
  const values = Object.create(null);
  for (const relative of nextAutoLoadFiles(cwd)) {
    const parsed = readEnvFile(path.resolve(cwd, relative));
    if (!parsed) continue;
    for (const [key, value] of Object.entries(parsed)) {
      if (values[key] === undefined) values[key] = value;
    }
  }
  return values;
}

/**
 * 当前进程是否处于「Next.js 已自动加载过 env 文件」的运行时
 *
 * `@next/env` 在加载完成后会写入 `__NEXT_PROCESSED_ENV=true`；
 * 普通 Node 进程（脚本 / drizzle-kit 子进程 / vitest）不会有这个标记。
 *
 * @returns {boolean}
 */
export function isNextRuntime() {
  return process.env[NEXT_PROCESSED_ENV_FLAG] === 'true';
}

/**
 * 当前进程是否为「测试运行时」
 *
 * 测试运行时**不加载 `.env.local`** —— 那是开发者的本地配置，
 * 加载它会把测试导向开发库。
 *
 * @returns {boolean}
 */
export function isTestRuntime() {
  return (
    process.env.NODE_ENV === 'test' || process.env.APP_RUNTIME_ENV === 'test'
  );
}

/**
 * 取「Next.js 自动加载前的 shell 快照」
 *
 * 这是**精确区分「shell 注入」与「文件占位」**的唯一可靠依据：
 * `@next/env` 在加载任何 env 文件之前会执行
 * `initialEnv = { ...process.env }`，那份快照就是 shell / CI 的原样。
 *
 * ⚠️ 必须用 `createRequire()` **运行时** require ——
 *    静态 `import '@next/env'` 会被 webpack 打包成另一个模块实例，
 *    其 `initialEnv` 恒为 `undefined`（已实测，见本文档顶部说明）。
 *
 * @returns {Record<string, string> | null} 快照；不可用时返回 `null`
 */
export function getShellSnapshot() {
  try {
    // 从 cwd 解析，保证拿到的是 Next 自己加载时用的**同一个模块实例**
    // （Node 的模块缓存按解析后的绝对路径索引）。
    const requireFromCwd = createRequire(path.join(process.cwd(), '__env_loader__.js'));
    const nextEnv = requireFromCwd('@next/env');
    const snapshot = nextEnv?.initialEnv;
    if (!snapshot || typeof snapshot !== 'object') return null;
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * 取连接串的端点 / 库名（**不含口令**）—— 供诊断报告使用
 *
 * @param {string | undefined} url 连接串
 * @returns {{ endpoint: string | null, database: string | null }}
 */
export function describeTarget(url) {
  if (!url) return { endpoint: null, database: null };
  try {
    const parsed = new URL(url);
    return {
      endpoint: `${parsed.hostname}:${parsed.port || '5432'}`,
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    };
  } catch {
    return { endpoint: null, database: null };
  }
}

/**
 * **核心判定**：某个变量当前是否允许被 `ENV_FILE` 覆盖
 *
 * 这是本模块最关键的一段逻辑，判定依据分四层（自上而下短路）：
 *
 *  1. **测试运行时 → 不覆盖**
 *     测试环境的数据库连接**靠环境变量注入**，不靠 env 文件。
 *     若在测试运行时允许文件覆盖，就会把测试重新导向某个「看起来对」的库，
 *     表现为「以为在测试库跑、其实跑到别的库」——
 *     这正是 v0.0.4 问题 A / B / C 的共同技术根。
 *
 *  2. **非 Next 运行时 → 不覆盖**
 *     脚本（seed / admin-cli / db-admin）与 drizzle-kit 子进程里，
 *     `process.env` **全部**来自 shell / CI 注入，
 *     不存在「Next 自动加载的占位值」这种东西 → 一律不覆盖。
 *     这与测试侧（`tests/helpers/test-env.ts`）的语义**完全一致**。
 *
 *  3. **Next 运行时 + shell 快照里没有该键 → 允许覆盖**
 *     该键不是 shell 注入的，只可能是 Next 从 `.env*` 文件占位的 → 可覆盖。
 *
 *  4. **Next 运行时 + 拿不到 shell 快照 → 退化为「占位值比对」**
 *     当前值必须**恰好等于**按 Next 同样规则算出来的占位值，才允许覆盖；
 *     不相等说明它来自别处（shell / 运行时注入）→ 不覆盖。
 *
 * @param {string} key 变量名
 * @param {EnvDecisionContext} context 判定上下文
 * @returns {boolean}
 */
export function canOverrideByEnvFile(key, context) {
  // ① 测试运行时 —— 绝不覆盖
  if (context.shellTestRuntime && !context.allowOverrideInTest) return false;

  // ② 非 Next 运行时 —— 绝不覆盖（process.env 全部来自 shell / CI）
  if (!context.nextRuntime) return false;

  // ③ Next 运行时 + 精确的 shell 快照
  if (context.shellSnapshot) {
    return context.shellSnapshot[key] === undefined;
  }

  // ④ Next 运行时但拿不到 shell 快照 —— 退化为占位值比对
  const placeholder = context.autoValues[key];
  if (placeholder === undefined) return false;
  return process.env[key] === placeholder;
}

/**
 * 覆盖判定的上下文
 *
 * @typedef {object} EnvDecisionContext
 * @property {boolean} nextRuntime 是否处于 Next.js 运行时
 * @property {Record<string, string> | null} shellSnapshot Next 自动加载前的 shell 快照
 * @property {Record<string, string>} autoValues Next 自动加载的占位值表
 * @property {boolean} shellTestRuntime **按 shell 环境**判定的测试运行时（不看文件）
 * @property {boolean} allowOverrideInTest 测试运行时是否仍允许覆盖
 */

/**
 * 加载报告
 *
 * @typedef {object} EnvReport
 * @property {string | null} envFile `ENV_FILE` 解析出的绝对路径（未指定时为 `null`）
 * @property {string[]} loadedFiles 实际读取过的文件列表（按优先级顺序）
 * @property {string[]} appliedKeys 被**填充**的变量（原本未设置）
 * @property {string[]} overriddenKeys 被**覆盖**的变量（原本是 Next 自动加载的占位值）
 * @property {string | null} databaseUrl 最终的 `DATABASE_URL`
 * @property {string | null} endpoint 最终连接串的端点 `host:port`
 * @property {string | null} database 最终连接串的库名
 * @property {string} source 最终 `DATABASE_URL` 的来源
 * @property {boolean} nextRuntime 是否处于 Next.js 运行时
 * @property {boolean} shellTestRuntime **按 shell 环境**判定的测试运行时
 * @property {boolean} testRuntime 加载完成后的有效测试运行时（含文件带来的 `APP_RUNTIME_ENV`）
 */

/**
 * 把一个 env 文件应用到 `process.env`
 *
 * @param {string} filePath 文件绝对路径
 * @param {object} context 判定上下文 + 诊断报告
 * @param {boolean} context.allowOverride 该文件**是否**有权覆盖既有值。
 *   - `ENV_FILE` → `true`（但仍受 `canOverrideByEnvFile` 的收紧判定约束）
 *   - `.env.local` / `.env` → `false`（**永不覆盖**任何已存在的值）
 */
function applyEnvFile(filePath, context) {
  const parsed = readEnvFile(filePath);
  if (!parsed) return;

  for (const [key, value] of Object.entries(parsed)) {
    const current = process.env[key];

    // ① 未设置 —— 直接填充（这是「只填空位」的主路径）
    if (current === undefined) {
      process.env[key] = value;
      context.report.appliedKeys.push(`${key} ← ${filePath}`);
      continue;
    }

    // ② 已设置 —— 只有「有权覆盖」且「允许覆盖」时才覆盖。
    //
    //    ⚠️ `.env.local` / `.env` 的 `allowOverride` 恒为 `false` ——
    //    它们**永远**只能填空位。否则会出现「ENV_FILE 填好的值又被
    //    `.env.local` 改回 5432」这种更隐蔽的走偏。
    if (!context.allowOverride) continue;
    if (!canOverrideByEnvFile(key, context)) continue;

    process.env[key] = value;
    context.report.overriddenKeys.push(`${key} ← ${filePath}`);
  }
}

/**
 * 产品侧的统一环境加载入口
 *
 * **幂等**：进程内只真正解析一次 —— 重复调用直接返回首次的结果。
 * 这让多个入口（`src/db/index.ts` / `scripts/seed.ts` / `scripts/admin-cli.ts`）
 * 可以各自安全地调用它，不会互相干扰。
 *
 * @param {object} [options]
 * @param {string} [options.cwd] 仓库根目录，默认 `process.cwd()`
 * @param {string} [options.envFileVar] 环境文件变量名，默认 `ENV_FILE`
 * @param {boolean} [options.allowLocalFile] 是否允许加载 `.env.local`，默认 `true`
 * @param {boolean} [options.requireEnvFile] `ENV_FILE` 指向的文件不存在时是否抛错，默认 `true`
 * @param {boolean} [options.allowOverrideInTest] 测试运行时是否仍允许覆盖，默认 `false`
 * @returns {EnvReport} 加载报告
 */
export function loadProductEnv(options = {}) {
  if (cachedReport) return cachedReport;
  cachedReport = resolveProductEnv(options);
  return cachedReport;
}

/**
 * 清空缓存（仅供测试使用）
 */
export function resetProductEnvCache() {
  cachedReport = null;
}

/** 进程内缓存的加载报告 —— 保证「进程内只有一份真源」 */
let cachedReport = null;

/**
 * 真正执行解析（不走缓存）
 *
 * @param {object} [options]
 * @returns {EnvReport} 加载报告
 */
function resolveProductEnv(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const envFileVar = options.envFileVar ?? 'ENV_FILE';
  const allowLocalFile = options.allowLocalFile !== false;
  const requireEnvFile = options.requireEnvFile !== false;
  const allowOverrideInTest = options.allowOverrideInTest === true;

  /** 加载前的 shell 判定 —— **只看 shell，不看文件** */
  const shellTestRuntime = isTestRuntime();
  const nextRuntime = isNextRuntime();
  const shellSnapshot = nextRuntime ? getShellSnapshot() : null;
  const autoValues = nextRuntime ? computeAutoLoadedValues(cwd) : Object.create(null);

  const context = {
    nextRuntime,
    shellSnapshot,
    autoValues,
    shellTestRuntime,
    allowOverrideInTest,
    report: {
      envFile: null,
      loadedFiles: [],
      appliedKeys: [],
      overriddenKeys: [],
      databaseUrl: null,
      endpoint: null,
      database: null,
      source: ENV_SOURCES.PROCESS,
      nextRuntime,
      shellTestRuntime,
      testRuntime: false,
    },
  };

  // ── 优先级 2：ENV_FILE 指定的文件 ───────────────────────────────
  //
  // ⚠️ 空串（`ENV_FILE=''`）必须保持 **falsy** 语义 ——
  //    子进程用 `ENV_FILE: ''` 表示「不要再解析任何 env 文件，只继承父进程的
  //    DATABASE_URL」。这是 `tests/helpers/local-bin.ts` 的既有契约。
  const rawEnvFile = process.env[envFileVar];
  const envFile =
    typeof rawEnvFile === 'string' && rawEnvFile.trim() !== ''
      ? rawEnvFile.trim()
      : null;

  if (envFile) {
    const envFilePath = path.resolve(cwd, envFile);
    if (!existsSync(envFilePath)) {
      if (requireEnvFile) {
        throw new Error(
          `[env-loader] ENV_FILE 指向的文件不存在：${envFilePath}\n` +
            `  ENV_FILE 只允许指向**存在的**环境文件（只填充未设置的变量，不覆盖 shell 变量）。`,
        );
      }
    } else {
      context.report.envFile = envFilePath;
      context.report.loadedFiles.push(envFilePath);
      applyEnvFile(envFilePath, { ...context, allowOverride: true });
    }
  }

  // ── 有效测试运行时判定（必须在 ENV_FILE 之后）──────────────────
  //
  // `ENV_FILE=.env.test` 会把 `APP_RUNTIME_ENV` 设成 `test`，
  // 因此判定放在 ENV_FILE 之后 —— 这样「显式指向测试配置」就等于
  // 「整个进程按测试语义运行」，`.env.local` 绝不参与。
  //
  // 注意：这只影响「要不要加载 .env.local」，
  // **不影响**上面 ENV_FILE 的覆盖判定 —— 覆盖判定用的是
  // `shellTestRuntime`（纯 shell 判定），否则 `ENV_FILE=.env.test`
  // 在 `next dev` 下就永远赢不了 `.env.local` 的占位值。
  context.report.testRuntime = isTestRuntime();

  // ── 优先级 3：.env.local（仅非测试运行时）────────────────────────
  if (allowLocalFile && !context.report.testRuntime) {
    const localPath = path.resolve(cwd, '.env.local');
    if (existsSync(localPath)) {
      context.report.loadedFiles.push(localPath);
      applyEnvFile(localPath, { ...context, allowOverride: false });
    }
  }

  // ── 优先级 4：.env（容器 / 生产）───────────────────────────────
  const basePath = path.resolve(cwd, '.env');
  if (existsSync(basePath)) {
    context.report.loadedFiles.push(basePath);
    applyEnvFile(basePath, { ...context, allowOverride: false });
  }

  // ── 诊断信息 ───────────────────────────────────────────────────
  context.report.databaseUrl = process.env.DATABASE_URL ?? null;
  const target = describeTarget(context.report.databaseUrl);
  context.report.endpoint = target.endpoint;
  context.report.database = target.database;
  context.report.source = describeSource(context.report, cwd);

  return context.report;
}

/**
 * 判断 `DATABASE_URL` 最终来自哪个来源（用于诊断报告）
 *
 * @param {EnvReport} report 加载报告
 * @param {string} cwd 仓库根目录
 * @returns {string}
 */
function describeSource(report, cwd) {
  const url = process.env.DATABASE_URL;
  if (!url) return 'none';

  if (report.envFile) {
    const parsed = readEnvFile(report.envFile);
    if (parsed && parsed.DATABASE_URL === url) {
      return `${ENV_SOURCES.ENV_FILE}:${report.envFile}`;
    }
  }

  const local = readEnvFile(path.resolve(cwd, '.env.local'));
  if (local && local.DATABASE_URL === url) {
    return ENV_SOURCES.LOCAL;
  }

  const base = readEnvFile(path.resolve(cwd, '.env'));
  if (base && base.DATABASE_URL === url) {
    return ENV_SOURCES.BASE;
  }

  return ENV_SOURCES.PROCESS;
}
