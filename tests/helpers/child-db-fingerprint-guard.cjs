/**
 * 子进程数据库指纹校验（**父 → 子**一致性兜底）
 *
 * ## 目的
 *
 * 父进程（vitest）解析一次环境 → 规范化 → 把 `DATABASE_URL` 与
 * `V2EX_DB_FINGERPRINT` 一起写进子进程 env。子进程**只继承，不解析**。
 *
 * 但「只继承」是一句约定，不是强制力 —— 子进程完全可能因为：
 *  - 自己又去读了一遍 `.env.local` / `.env`；
 *  - 某个库的默认行为覆盖了 `DATABASE_URL`；
 *  - 被错误地传了一个不同的库名；
 * 而悄悄连到**另一个库**。这正是 QA 在 v0.0.4 实测踩到的坑：
 * 「以为在测试库跑、其实跑到了别的库」。
 *
 * 本文件以 `NODE_OPTIONS=--require` 的方式**预加载进每个子进程**，
 * 在子进程真正开始工作**之前**校验：
 *
 *   fingerprint(DATABASE_URL) === V2EX_DB_FINGERPRINT ?
 *
 * 不一致 → **立即抛错中止**，让「静默走错库」变成「显式失败」。
 *
 * ## 为什么不校验「口令」
 *
 * 指纹**不含口令**（`host:port/database@user`）——
 * 口令会进日志、会被 CI 打印出来，绝不能进指纹。
 *
 * ## 何时**不**校验
 *
 * - `DATABASE_URL` 为空 → 跳过（有些子进程刻意测试「未配置」的路径）；
 * - `V2EX_DB_FINGERPRINT` 未设置 → 跳过（非测试期的子进程）；
 * - `DATABASE_URL` 不是合法 URL → 跳过（由调用方自己报错）。
 *
 * @see docs/TEST_ENV_ISOLATION_v0.0.4.md §3.4
 */
'use strict';

const FINGERPRINT_ENV_KEY = 'V2EX_DB_FINGERPRINT';

/** 生成不含口令的连接指纹：`host:port/database@user` */
function fingerprintOf(url) {
  const u = new URL(url);
  const port = u.port || '5432';
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const username = decodeURIComponent(u.username);
  return `${u.hostname}:${port}/${database}@${username}`;
}

function main() {
  const rawUrl = process.env.DATABASE_URL;
  const expected = process.env[FINGERPRINT_ENV_KEY];

  // 未设置指纹 → 不在测试期，不校验
  if (!expected) return;
  // 刻意清空 DATABASE_URL 的子进程（如 db-lazy-init 的「未配置」用例）→ 不校验
  if (!rawUrl || rawUrl.trim() === '') return;

  let actual;
  try {
    actual = fingerprintOf(rawUrl);
  } catch {
    // URL 不合法不是本守卫的责任，交给调用方报错
    return;
  }

  if (actual === expected) return;

  throw new Error(
    `数据库目标不一致：父=${expected} 子=${actual}\n` +
      `  子进程继承到的 DATABASE_URL 与父进程计算出的指纹不匹配 ——\n` +
      `  这意味着子进程**没有**使用父进程规范化的连接串（可能自己又读了 env 文件）。\n` +
      `  这类错误会导致「以为在测试库跑、其实跑到了别的库」，必须中止。`,
  );
}

try {
  main();
} catch (err) {
  // 用原始 stderr 输出，避免被任何 stdout 捕获逻辑吞掉
  process.stderr.write(`[db-guard-child] ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
}
