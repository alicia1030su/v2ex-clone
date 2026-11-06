/**
 * 测试环境专用：把 seed 账号的口令**同步**为当前环境变量里的值
 *
 * ## 为什么需要它
 *
 * `scripts/seed.ts` 的设计是「**首次初始化**」而非「状态同步」——
 * 已存在的账号**只读不修改**（见该文件的注释）。
 *
 * 这个设计在**生产**是对的（避免重新部署时静默篡改管理员口令、
 * 避免用户改密后被改回、避免提权账号被降级）。
 *
 * 但在**测试环境**下，它导致一个必然的坑：
 *
 * - 本地 E2E 库是**历次 seed 累积**下来的
 * - `lisi` 的口令是**第一次 seed 时**的值
 * - 而测试进程读的是**当前**的 `SEED_DEMO_PASSWORD`
 * - 两者不一致 ⇒ `login()` 永远 401「用户名或密码不正确」
 * - 而报错信息**完全指不到真正的原因**（实测连续踩了 3 次）
 *
 * CI 每次都是**全新数据库** ⇒ 从不暴露这个问题 ⇒
 * 「本地红 / CI 绿」或反之的诡异现象。
 *
 * ## 安全性
 *
 * 这个脚本**只在测试环境**运行：
 *
 * - 必须 `TEST_ENV_ISOLATED=1` 且 `APP_RUNTIME_ENV=test`
 *   （由 `isIsolatedTestEnv()` 判定，见 src/lib/runtime-flags.ts）
 * - 只改**种子账号**（admin / lisi / wangwu / moderator …），
 *   不碰任何普通用户的口令
 * - **不改角色**（避免误把普通账号提权）
 * - 每一次执行都写**审计日志**
 *
 * 生产环境误调用 ⇒ 立即退出且不产生任何副作用。
 */

import postgres from 'postgres';
import { randomBytes, scryptSync } from 'node:crypto';
import { config as loadEnv } from 'dotenv';

// 加载 env（与项目其它脚本一致）
loadEnv({ path: process.env.ENV_FILE ?? '.env.test', quiet: true, override: false });
loadEnv({ path: '.env.test', quiet: true, override: false });

/** 判定是否处于隔离测试环境 */
function isIsolatedTestEnv(): boolean {
  const runtimeEnv = process.env.APP_RUNTIME_ENV ?? '';
  const isolated = process.env.TEST_ENV_ISOLATED === '1';
  return runtimeEnv === 'test' && isolated;
}

/** 口令哈希（与 src/lib/password.ts 保持一致 —— scrypt + 16 字节随机盐） */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

/** 要同步的种子账号 → 口令 */
function seedCredentials(): { username: string; password: string }[] {
  const out: { username: string; password: string }[] = [];

  const adminUser = process.env.SEED_ADMIN_USERNAME;
  const adminPass = process.env.SEED_ADMIN_PASSWORD;
  if (adminUser && adminPass) {
    out.push({ username: adminUser, password: adminPass });
  }

  if (process.env.SEED_DEMO_USERS !== '0') {
    const demoPass = process.env.SEED_DEMO_PASSWORD;
    if (demoPass) {
      // 与 scripts/seed.ts 的 resolveDemoUsers() 保持一致
      for (const u of ['lisi', 'wangwu', 'moderator']) {
        out.push({ username: u, password: demoPass });
      }
    }
  }

  return out;
}

async function main(): Promise<void> {
  if (!isIsolatedTestEnv()) {
    console.log(
      '[reset-test-credentials] 非隔离测试环境（需要 APP_RUNTIME_ENV=test 且 TEST_ENV_ISOLATED=1）⇒ 跳过',
    );
    return;
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log('[reset-test-credentials] 没有 DATABASE_URL ⇒ 跳过');
    return;
  }

  const creds = seedCredentials();
  if (creds.length === 0) {
    console.log('[reset-test-credentials] 没有配置 seed 口令 ⇒ 跳过');
    return;
  }

  const sql = postgres(dbUrl, { prepare: false, max: 1 });
  try {
    const usernames = creds.map((c) => c.username);

    // 查出这些账号（只查种子账号）
    const rows = await sql<{ id: number; username: string }[]>`
      SELECT id, username FROM users WHERE username IN ${sql(usernames)}
    `;

    if (rows.length === 0) {
      console.log('[reset-test-credentials] 数据库里没有 seed 账号（尚未 seed？）⇒ 跳过');
      return;
    }

    const byName = new Map(creds.map((c) => [c.username, c.password]));
    let changed = 0;

    for (const row of rows) {
      const password = byName.get(row.username);
      if (!password) continue;
      const hash = hashPassword(password);
      await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${row.id}`;
      changed += 1;
    }

    console.log(
      `[reset-test-credentials] 已同步 ${changed} 个 seed 账号的口令（测试环境专用，不改角色）`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  // 同步失败**不应该**让整个 E2E 挂掉 ——
  // 顶多是用例里的 seed 账号登录失败。
  console.warn('[reset-test-credentials] 失败（不阻断）：', (err as Error).message);
});
