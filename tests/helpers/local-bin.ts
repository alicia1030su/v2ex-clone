import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

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
 */
const repoRoot = path.resolve(__dirname, '..', '..');

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

/** 运行本地 drizzle-kit */
export function runDrizzleKit(args: string[], env: NodeJS.ProcessEnv): string {
  const { command, args: binArgs } = resolvePackageBin('drizzle-kit');
  return execFileSync(command, [...binArgs, ...args], {
    encoding: 'utf8',
    env,
    cwd: repoRoot,
  });
}

/** 运行本地 tsx（用于执行 scripts/seed.ts 等脚本） */
export function runTsx(scriptPath: string, env: NodeJS.ProcessEnv): string {
  const { command, args: binArgs } = resolvePackageBin('tsx');
  return execFileSync(command, [...binArgs, scriptPath], {
    encoding: 'utf8',
    env,
    cwd: repoRoot,
  });
}

export { repoRoot };
