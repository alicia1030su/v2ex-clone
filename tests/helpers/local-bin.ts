import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitChildTargetLog } from './test-db-log';
import { fingerprintOf, getResolvedTestEnv, withDatabase } from './test-env';

/**
 * 跨平台定位 node_modules/.bin 下的本地可执行文件。
 *
 * 为什么不用 `npx`：
 *  - `npx` 在 Windows 上是 `npx.cmd`，POSIX 上是 shell 脚本；
 *    `execFileSync('npx', ...)` 在 Windows 下会 ENOENT。
 *  - `npx` 还会尝试联网解析包名，不适合在 CI 里做确定性调用。
 *
 * 做法：直接从磁盘读包的 package.json 的 bin 字段（不走 require.resolve，
 * 因为部分包的 exports 字段没有导出 ./package.json 子路径），
 * 再用当前 node 解释器执行入口文件。这样 Windows / Linux / macOS 行为一致。
 *
 * 用 `import.meta.url` 而不是 `__dirname` —— 本模块被 vitest 与 tsx
 * 以 ESM 方式加载，`__dirname` 在 ESM 下不可用。
 */
const helpersDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(helpersDir, '..', '..');

/** 子进程指纹校验守卫（预加载文件） */
const childGuardPath = path.join(helpersDir, 'child-db-fingerprint-guard.cjs');

function resolvePackageBin(pkgName: string): { command: string; args: string[] } {
  const pkgJsonPath = path.join(repoRoot, 'node_modules', pkgName, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`找不到 ${pkgName}（${pkgJsonPath}）。请先执行 npm ci。`);
  }
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[pkgName];
  if (!bin) {
    throw new Error(`无法从 ${pkgName}/package.json 解析 bin 入口`);
  }
  const entry = path.resolve(path.dirname(pkgJsonPath), bin);
  if (!existsSync(entry)) {
    throw new Error(`找不到 ${pkgName} 的可执行入口: ${entry}`);
  }
  return { command: process.execPath, args: [entry] };
}

/**
 * 构造子进程环境变量，并**校验父子进程指纹一致**（§3.4）
 *
 * 核心机制：**父进程解析一次 → 规范化 → 写入 process.env → 子进程只继承，不解析**。
 *
 * 这里做两层保障：
 *  1. **父侧预校验** —— 子进程 env 里的 `DATABASE_URL` 算出的指纹必须
 *     等于父进程写入的指纹，不等直接抛错（不等真正 spawn）；
 *  2. **子侧强制校验** —— 通过 `NODE_OPTIONS=--require` 把
 *     `child-db-fingerprint-guard.cjs` 预加载进子进程，
 *     子进程在**自己开始工作之前**再校验一次。
 *
 * 第 2 层是关键：它能拦住「子进程自己又去读了一遍 .env.local」
 * 这类**父侧看不见**的走偏。
 *
 * @param dbName 子进程要操作的库名；不传则沿用父进程的库名
 * @throws 指纹与父进程不一致时抛错
 */
export function buildChildEnv(dbName?: string | null): NodeJS.ProcessEnv {
  const resolved = getResolvedTestEnv();

  const childUrl = dbName ? withDatabase(resolved.databaseUrl, dbName) : resolved.databaseUrl;
  const childFingerprint = fingerprintOf(childUrl);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // 清空 ENV_FILE —— 子进程**只继承**父进程算好的 DATABASE_URL，
    // 绝不允许自己再去解析 env 文件（那正是「父子走散」的根源）。
    ENV_FILE: '',
    DATABASE_URL: childUrl,
    // 父进程写入的指纹 —— 子进程据此校验
    V2EX_DB_FINGERPRINT: childFingerprint,
  };

  // ── 父侧预校验（兜底）─────────────────────────────────────────
  const parentFingerprint = fingerprintOf(env.DATABASE_URL!);
  if (parentFingerprint !== childFingerprint) {
    throw new Error(
      `数据库目标不一致：父=${resolved.fingerprint} 子=${parentFingerprint}`,
    );
  }

  // ── 子侧强制校验：预加载守卫 ──────────────────────────────────
  env.NODE_OPTIONS = mergeNodeOptions(env.NODE_OPTIONS, childGuardPath);

  return env;
}

/** 把 `--require <守卫>` 追加到已有的 NODE_OPTIONS（不覆盖用户已有设置） */
function mergeNodeOptions(existing: string | undefined, guardPath: string): string {
  const requireFlag = `--require ${guardPath}`;
  if (!existing || existing.trim() === '') return requireFlag;
  if (existing.includes(guardPath)) return existing;
  return `${existing} ${requireFlag}`;
}

/** 运行本地 drizzle-kit */
export function runDrizzleKit(args: string[], env: NodeJS.ProcessEnv): string {
  const { command, args: binArgs } = resolvePackageBin('drizzle-kit');
  logChildTarget('drizzle-kit', args, env);
  return execFileSync(command, [...binArgs, ...args], {
    encoding: 'utf8',
    env,
    cwd: repoRoot,
  });
}

/** 运行本地 tsx（用于执行 scripts/seed.ts 等脚本） */
export function runTsx(scriptPath: string, env: NodeJS.ProcessEnv): string {
  const { command, args: binArgs } = resolvePackageBin('tsx');
  logChildTarget('tsx', [scriptPath], env);
  return execFileSync(command, [...binArgs, scriptPath], {
    encoding: 'utf8',
    env,
    cwd: repoRoot,
  });
}

/**
 * 打印子进程目标日志（§4.5）
 *
 * 这一行与父进程的 `[db-target]` 行合起来，就是「父子进程目标一致性」的
 * **人工可核验证据**：两行的 `endpoint` / `db` / `fp` 必须完全一致。
 */
function logChildTarget(tool: string, args: string[], env: NodeJS.ProcessEnv): void {
  const url = env.DATABASE_URL;
  if (!url) return;
  const u = new URL(url);
  const endpoint = `${u.hostname}:${u.port || '5432'}`;
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  // 指纹必须由**子进程自己的 DATABASE_URL** 算出 ——
  // 这样它与子进程实际连的库严格对应，也与父进程写入 V2EX_DB_FINGERPRINT 的值一致。
  const fp = fingerprintOf(url);
  emitChildTargetLog(tool, args, endpoint, db, fp);
}

export { repoRoot };
