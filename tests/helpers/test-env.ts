/**
 * 单元测试环境解析 —— **全仓唯一**的环境真源（v0.0.4 / 问题 A）
 *
 * ## 为什么需要这个模块
 *
 * 修复前，仓库里有**四份各自独立**的环境加载实现
 * （`tests/setup.ts` / `drizzle.config.ts` / `src/db/index.ts` / `scripts/seed.ts`），
 * 逻辑几乎一样但没有共享实现，于是出现了两个高危静默错误：
 *
 *  1. **`.env.test` 从未被加载** —— `tests/setup.ts` 的注释声称「加载 .env.test」，
 *     实际只加载了 `.env.local` + `.env`。于是单元测试默认连到 **5432 开发库**，
 *     并在开发实例上执行 `DROP DATABASE` / `CREATE DATABASE`。
 *  2. **`ENV_FILE` 的 `override: true` 反转了优先级** —— 一旦设置了 `ENV_FILE`，
 *     命令行显式指定的 `DATABASE_URL` 会被**静默忽略**，
 *     表现为「以为在测试库跑、其实跑到别的库」（QA 在 v0.0.4 实测踩到过）。
 *
 * ## 本模块确立的加载优先级（唯一且显式）
 *
 * **逐变量**的级联填充 —— 每个来源只填充**仍然未设置**的变量：
 *
 * | 优先级 | 来源 | 语义 |
 * |---|---|---|
 * | 1（最高） | `process.env`（shell / CI 注入） | **永不被文件覆盖** |
 * | 2 | `ENV_FILE` 指定的文件 | 只填充未设置的变量 |
 * | 3 | `.env.test` | 只填充未设置的变量 |
 * | 4（最低） | `.env`（容器 / 生产） | 只填充未设置的变量 |
 * | — | `.env.local` | **单元测试流程永不加载**（绝不落到开发库） |
 *
 * 关键点：`dotenv` 的**默认行为就是「只填空位」**，
 * 因此本模块**不再使用 `override: true`** —— 这正是 `scripts/env-dump.mjs`
 * 注释里早就写明、但实现从未对齐的期望语义。
 *
 * > **为什么 `.env.test` 与 `ENV_FILE` 不是互斥关系**：级联填充是**逐变量**的。
 * > 若 shell 只设了 `DATABASE_URL`，`.env.test` 里的其余变量（seed 口令、
 * > 限流阈值、调试令牌）仍会被正常加载 —— 这正是「shell 指定库 + 文件补齐其余」
 * > 这一常见用法所期望的行为。
 *
 * ## 父子进程一致性
 *
 * 父进程解析一次 → 规范化 → 写入 `process.env` + `V2EX_DB_FINGERPRINT`，
 * 子进程**只继承、不再解析**。`tests/helpers/local-bin.ts` 在每次 spawn 前
 * 校验指纹，并把守卫预加载进子进程做二次校验。
 *
 * @see docs/TEST_ENV_ISOLATION_v0.0.4.md §3.1 / §3.2 / §3.3 / §3.4
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvFile } from 'dotenv';

/**
 * 仓库根目录（tests/helpers → tests → 仓库根）
 *
 * 用 `import.meta.url` 而不是 `__dirname` —— 本模块同时被
 * vitest（ESM）与 `tsx`（ESM）加载，`__dirname` 在 ESM 下不可用。
 */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 规范化后的测试环境 —— 父进程解析一次，子进程只继承 */
export interface ResolvedTestEnv {
  /** 规范化后的基础连接串（库名为「占位库」，各 spec 用 withDatabase 换成自己的库） */
  databaseUrl: string;
  /** 目标端点 `host:port` */
  endpoint: string;
  /** 目标库名 */
  database: string;
  /** 目标用户名 */
  username: string;
  /** 连接指纹（**不含口令**）—— 用于父子进程一致性校验 */
  fingerprint: string;
  /** 环境来源描述，用于日志 */
  source: string;
}

/** 环境解析的选项 */
export interface ResolveOptions {
  /** 解析基准目录（仓库根） */
  cwd: string;
  /** 解析不出可用连接串时是否抛错。`true` = 绝不回落，直接失败 */
  required: boolean;
}

/** 模板搜索顺序：优先设计文档 Q6 裁决的 `tests/env/`，回退到仓库根 */
const TEMPLATE_CANDIDATES = [
  path.join('tests', 'env', '.env.test.example'),
  '.env.test.example',
] as const;

/** 固定的本机测试口令（仅用于本机隔离实例，与任何真实凭据无交集） */
const LOCAL_ONLY_TEST_PASSWORD = 'v2ex_test_password_local_only';

/** 固定的本机测试会话密钥（同上，仅限本机） */
const LOCAL_ONLY_TEST_SESSION_SECRET = 'test-only-session-secret-not-for-production-use-0000';

/** 模板占位符 → 本机固定值的替换表 */
const PLACEHOLDER_SUBSTITUTIONS: Record<string, string> = {
  __TEST_DB_PASSWORD__: process.env.TEST_DB_PASSWORD ?? LOCAL_ONLY_TEST_PASSWORD,
  __TEST_DB_HOST__: process.env.TEST_DB_HOST ?? '127.0.0.1',
  __TEST_DB_PORT__: process.env.TEST_DB_PORT ?? '55440',
  __TEST_DB_NAME__: process.env.TEST_DB_NAME ?? 'v2ex_test_base',
  __TEST_SESSION_SECRET__: LOCAL_ONLY_TEST_SESSION_SECRET,
};

/**
 * 生成**不含口令**的连接指纹：`host:port/database@username`
 *
 * 口令绝不进入指纹 —— 指纹会出现在日志里。
 */
export function fingerprintOf(url: string): string {
  const u = new URL(url);
  const port = u.port || '5432';
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const username = decodeURIComponent(u.username);
  return `${u.hostname}:${port}/${database}@${username}`;
}

/** 取连接串的 `host:port` 端点 */
export function endpointOf(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}`;
}

/** 取连接串的库名 */
export function databaseOf(url: string): string {
  const u = new URL(url);
  return decodeURIComponent(u.pathname.replace(/^\//, ''));
}

/**
 * 把连接串的库名换成目标库（**只换库名，不换 host/port/凭据**）
 *
 * 这是「父进程规范化 → 子进程继承」的关键工具：
 * 所有 spec 的专用库都由基础连接串派生，因此**必然**指向同一个 PG 实例。
 */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/**
 * 把连接串的库名换成管理库（`postgres`）
 *
 * `DROP DATABASE` / `CREATE DATABASE` 只能在管理库上执行。
 */
export function withAdminDatabase(url: string): string {
  return withDatabase(url, 'postgres');
}

/**
 * 统一的环境解析器
 *
 * 全部方法均为**静态**的 —— 本模块在进程内是单例，
 * 因此 `tests/setup.ts` 与各个 spec 拿到的必然是同一份结果。
 */
export class TestEnvResolver {
  /** 解析结果缓存 —— 保证进程内只有一份真源 */
  private static cached: ResolvedTestEnv | null = null;

  /**
   * 解析测试环境
   *
   * @throws 当 `required=true` 且解析不出可用连接串时抛错
   *         （**绝不回落**到 `.env.local` —— 那会把测试导向开发库）
   */
  static resolve(options: ResolveOptions): ResolvedTestEnv {
    if (TestEnvResolver.cached) return TestEnvResolver.cached;

    const resolved = TestEnvResolver.resolveUncached(options);
    TestEnvResolver.cached = resolved;
    return resolved;
  }

  /** 清空缓存（仅测试用） */
  static reset(): void {
    TestEnvResolver.cached = null;
  }

  /** 真正执行解析（不走缓存） */
  private static resolveUncached(options: ResolveOptions): ResolvedTestEnv {
    const cwd = options.cwd;

    // ── 优先级 1：process.env（shell / CI 注入）—— 永不被文件覆盖 ──────
    // 先记下 shell 是否给了 DATABASE_URL，之后用于判断「来源」。
    const shellDatabaseUrl = process.env.DATABASE_URL?.trim();

    // ── 优先级 2：ENV_FILE 指定的文件 ──────────────────────────────
    const envFile = process.env.ENV_FILE?.trim();
    if (envFile) {
      const envFilePath = path.resolve(cwd, envFile);
      if (!existsSync(envFilePath)) {
        throw new Error(
          `[db-setup] ENV_FILE 指向的文件不存在：${envFilePath}\n` +
            `  ENV_FILE 只允许指向**存在的**环境文件（只填充未设置的变量，不覆盖 shell 变量）。`,
        );
      }
      TestEnvResolver.loadFile(envFilePath);
    }

    // ── 优先级 3：.env.test（缺失则从模板生成）──────────────────────
    const testEnvPath = path.resolve(cwd, '.env.test');
    if (!existsSync(testEnvPath)) {
      TestEnvResolver.ensureLocalEnvFile(cwd);
    }
    if (existsSync(testEnvPath)) {
      TestEnvResolver.loadFile(testEnvPath);
    }

    // ── 优先级 4：.env（容器 / 生产）────────────────────────────────
    const prodEnvPath = path.resolve(cwd, '.env');
    if (existsSync(prodEnvPath)) {
      TestEnvResolver.loadFile(prodEnvPath);
    }

    // ── 绝不加载 .env.local ─────────────────────────────────────────
    // 说明：`.env.local` 指向开发库（5432），在单元测试流程中加载它
    // 就是问题 A 的根因。这里**刻意不读**，即使它存在。

    // ── 汇总 DATABASE_URL ─────────────────────────────────────────
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      if (!options.required) {
        throw new Error('[db-setup] 无法解析测试数据库连接串（且 required=false）。');
      }
      throw new Error(
        `[db-setup] 无法解析测试数据库连接串 —— **绝不回落 .env.local**（那会把单元测试导向开发库）。\n` +
          `  排查：\n` +
          `    1) 设置环境变量 DATABASE_URL（优先级最高，shell 永远赢）\n` +
          `    2) 或提供 .env.test（可从模板生成：tests/env/.env.test.example）\n` +
          `    3) 或设置 ENV_FILE=<某个环境文件>\n` +
          `  本机隔离实例：bash tests/helpers/start-test-pg.sh start`,
      );
    }

    // 来源判定：shell 优先；否则看是哪个文件带来的
    const source = shellDatabaseUrl
      ? 'process.env'
      : envFile
        ? `ENV_FILE:${envFile}`
        : '.env.test';

    return TestEnvResolver.describe(databaseUrl, source, options);
  }

  /** 组装 ResolvedTestEnv 并做安全校验 */
  private static describe(
    url: string,
    source: string,
    options: ResolveOptions,
  ): ResolvedTestEnv {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`[db-setup] DATABASE_URL 不是合法 URL（来源：${source}）：${url}`);
    }

    const resolved: ResolvedTestEnv = {
      databaseUrl: url,
      endpoint: `${parsed.hostname}:${parsed.port || '5432'}`,
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      username: decodeURIComponent(parsed.username),
      fingerprint: fingerprintOf(url),
      source,
    };

    if (options.required && !resolved.database) {
      throw new Error(
        `[db-setup] DATABASE_URL 没有指定数据库名（来源：${source}）。` +
          `请写成 postgres://user:pass@host:port/<库名>。`,
      );
    }

    // ── 额外保险（§3.6）：单元测试绝不能落到开发实例 ──────────────
    TestEnvResolver.assertNotDevInstance(resolved);

    return resolved;
  }

  /**
   * 额外保险：若解析结果（来自**文件**而非 shell）指向 `.env.local` 里的开发端点，
   * 直接抛错中止 —— 这条不依赖白名单配置，任何配置失误都能兜住。
   *
   * CI 例外：CI 的端点同样是 5432，但那里没有 `.env.local` 文件，
   * 且 CI 的来源是 `process.env`（shell 注入），不会被这条规则命中。
   */
  private static assertNotDevInstance(resolved: ResolvedTestEnv): void {
    if (resolved.source === 'process.env') return;
    if (process.env.CI) return;

    const localEnvPath = path.resolve(repoRoot, '.env.local');
    if (!existsSync(localEnvPath)) return;

    const localParsed = TestEnvResolver.readEnvFile(localEnvPath);
    const localUrl = localParsed.DATABASE_URL;
    if (!localUrl) return;

    let localEndpoint: string;
    try {
      localEndpoint = endpointOf(localUrl);
    } catch {
      return;
    }
    if (localEndpoint !== resolved.endpoint) return;

    throw new Error(
      `[db-setup] 检测到单元测试试图使用开发实例端点 ${resolved.endpoint}（来源：${resolved.source}）。\n` +
        `  单元测试必须指向**隔离测试实例**（本机默认 127.0.0.1:55440），\n` +
        `  绝不允许在开发库上执行 DROP DATABASE / CREATE DATABASE。\n` +
        `  启动隔离实例：bash tests/helpers/start-test-pg.sh start`,
    );
  }

  /**
   * 读取一个 env 文件（**只填充未设置的变量**，绝不覆盖已有值）
   *
   * 与 `dotenv` 默认行为一致 —— 这里是显式封装，便于将来统一审计。
   */
  static loadFile(filePath: string): Record<string, string> {
    if (!existsSync(filePath)) return {};
    loadEnvFile({ path: filePath, quiet: true });
    return TestEnvResolver.readEnvFile(filePath);
  }

  /** 纯读取 env 文件内容（不写入 process.env） */
  static readEnvFile(filePath: string): Record<string, string> {
    if (!existsSync(filePath)) return {};
    const result: Record<string, string> = {};
    const content = readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      const hashIdx = value.indexOf(' #');
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      if (key) result[key] = value;
    }
    return result;
  }

  /**
   * `.env.test` 缺失时，从模板生成本地副本（**幂等**）
   *
   * - `.env.test` 已存在 → **不覆盖**（尊重本地已有配置）
   * - 不存在 → 复制模板并把占位符换成本机固定测试值
   * - CI 环境 → **不生成**（CI 的变量由 env 注入，不需要文件）
   *
   * 生成的文件落在仓库根 `.env.test`，已被 `.gitignore` 覆盖。
   */
  static ensureLocalEnvFile(cwd: string): void {
    const target = path.resolve(cwd, '.env.test');
    if (existsSync(target)) return;
    if (process.env.CI) return;

    for (const candidate of TEMPLATE_CANDIDATES) {
      const templatePath = path.resolve(cwd, candidate);
      if (!existsSync(templatePath)) continue;

      let rendered = readFileSync(templatePath, 'utf8');
      for (const [placeholder, value] of Object.entries(PLACEHOLDER_SUBSTITUTIONS)) {
        rendered = rendered.split(placeholder).join(value);
      }

      const header =
        '# ---------------------------------------------------------------------------\n' +
        '# 本文件由 tests/helpers/test-env.ts 从模板**自动生成**（仅本机测试用）。\n' +
        '# ⚠️ 仅用于本机隔离测试实例，禁止用于生产 / 开发环境。\n' +
        '# 如需修改，请直接编辑本文件；模板见 tests/env/.env.test.example。\n' +
        '# ---------------------------------------------------------------------------\n';

      writeFileSync(target, header + rendered, 'utf8');
      console.warn(
        `[db-setup] 已从模板生成本地 .env.test（口令来源：${
          process.env.TEST_DB_PASSWORD ? '环境变量 TEST_DB_PASSWORD' : '本机固定测试口令'
        }）。该文件已被 .gitignore 忽略，不会入库。`,
      );
      return;
    }
  }
}

/**
 * 取进程内已解析的测试环境
 *
 * 若尚未解析则立即解析（`required=true`）—— 供 helper 与 spec 统一使用。
 */
export function getResolvedTestEnv(): ResolvedTestEnv {
  return TestEnvResolver.resolve({ cwd: repoRoot, required: true });
}

/** 指向指定测试库的连接串（**只换库名**，host/port/凭据全部继承基础连接串） */
export function testDatabaseUrl(database: string): string {
  return withDatabase(getResolvedTestEnv().databaseUrl, database);
}

/** 指向指定测试库的**管理**连接串（库名换成 `postgres`） */
export function adminUrlFor(database: string): string {
  return withAdminDatabase(getResolvedTestEnv().databaseUrl);
}
