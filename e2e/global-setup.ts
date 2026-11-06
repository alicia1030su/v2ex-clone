import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 同步 seed 账号口令（测试环境专用）
 *
 * 失败**不阻断** E2E —— 顶多是 seed 账号登录失败，
 * 其余用例仍应跑完（便于一次看到全部失败，而不是卡在第一个）。
 */
async function syncSeedCredentials(): Promise<void> {
  // ⚠️ 本文件是 ESM —— `__dirname` **不可用**（实测踩到：
  //    `ReferenceError: __dirname is not defined` 让整个 E2E 11 秒就退出）。
  //    用 `import.meta.url` 反推目录。
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = path.join(here, '..', 'scripts', 'reset-test-credentials.ts');

  // ⚠️ Windows 上 `npx` 是 `npx.cmd` —— 直接 spawn `npx` 会报
  //    `spawnSync npx ENOENT`（实测踩到，报错完全不指向「PATH 没 .cmd 后缀」）。
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  try {
    execFileSync(npxCmd, ['tsx', script], {
      stdio: 'inherit',
      env: process.env,
      cwd: path.join(here, '..'),
      timeout: 60_000,
    });
  } catch (err) {
    console.warn(
      '[global-setup] seed 口令同步失败（不阻断）：',
      (err as Error).message.slice(0, 200),
    );
  }
}

/**
 * Playwright 全局前置
 *
 * 关键点：Playwright 的 worker 是**独立进程**，不继承配置文件模块里
 * 通过 dotenv 写入的 process.env。因此必须在 globalSetup 中加载，
 * 该函数返回的 env 会被 Playwright 显式传给每个 worker。
 *
 * 没有这一步，用例里读到的 `process.env.SEED_DEMO_PASSWORD` 会是 undefined，
 * 导致「seed 用强口令、测试用弱口令」的两边对不上，登录全部失败。
 */
export default async function globalSetup() {
  const files = [
    process.env.ENV_FILE,
    '.env.test',
    '.env.local',
    '.env',
  ].filter(Boolean) as string[];

  for (const f of files) {
    // ⚠️ v0.0.5：`override` 恒为 **false** —— 与 `src/lib/env-loader.mjs`
    //    的语义**严格一致**（shell 注入 > ENV_FILE 文件 > .env.local > .env）。
    //
    //    原实现写的是 `override: f === process.env.ENV_FILE`（ENV_FILE 覆盖 shell）——
    //    这与 env-loader 的优先级**正好相反**，导致一个**极难定位**的缺陷：
    //
    //    实测（远端 CI E2E 失败 → 本地复现 → 逐层下钻）：
    //      · shell 注入   `DEBUG_ENDPOINT_TOKEN=ci-debug-token-not-for-production`
    //      · 服务端进程   （next start，继承 shell）→ `ci-debug-token-not-for-production`
    //      · 测试 worker  （global-setup 用 override:true 加载 .env.test）
    //                    → `test-debug-token-local-only`   ← **被覆盖了**
    //
    //    ⇒ 两边令牌不一致 ⇒ `clearRateLimits()` 拿到 **401**
    //      ⇒ **限流根本没被清** ⇒ 后续请求累积到阈值 ⇒ **429**
    //
    //    而 429 的报错**完全指不到**「令牌不一致」这个真正原因 ——
    //    它只会在几秒后说「 forgot-password 返回 429」。
    //
    //    `drizzle.config.ts` 顶部的长注释早已明确：
    //    「父进程注入的 DATABASE_URL → 子进程**原样**使用（**最高优先级**）」。
    //    global-setup 是同一个道理的另一个实例，本轮把它对齐。
    loadEnv({ path: f, quiet: true, override: false });
  }

  // ⚠️ v0.0.5：同步 seed 账号的口令。
  //
  // `scripts/seed.ts` 的设计是「**首次初始化**」—— 已存在的账号
  // **只读不修改**（这是正确的生产语义：不能因为重新部署就静默
  // 篡改管理员口令 / 把用户改密改回 / 把提权账号降级）。
  //
  // 但在**测试环境**下它必然导致：
  //   - 本地 E2E 库是历次 seed 累积的
  //   - `lisi` 的口令是**第一次 seed 时**的值
  //   - 测试进程读的是**当前**的 `SEED_DEMO_PASSWORD`
  //   - 两者不一致 ⇒ `login()` 永远 401「用户名或密码不正确」
  //
  // 而这个报错**完全指不到真正的原因**（实测连续踩了 3 次）。
  // CI 每次都是全新数据库 ⇒ 从不暴露 ⇒ 「本地红 / CI 绿」的诡异现象。
  //
  // 修法：测试环境启动前把**种子账号**的口令同步为当前 env 的值。
  // 该脚本自带安全门（必须 `APP_RUNTIME_ENV=test` + `TEST_ENV_ISOLATED=1`，
  // 只改种子账号、**不改角色**、每次写审计），生产环境误调用无效。
  await syncSeedCredentials();

  // 显式声明需要透传给 worker 的变量
  const passthrough = [
    'ENV_FILE',
    'APP_RUNTIME_ENV',
    'TEST_ENV_ISOLATED',
    'DISABLE_CAPTCHA',
    'ENABLE_DEBUG_ENDPOINTS',
    'DEBUG_ENDPOINT_TOKEN',
    'SEED_ADMIN_PASSWORD',
    'SEED_ADMIN_USERNAME',
    'SEED_DEMO_PASSWORD',
    'DATABASE_URL',
    'SESSION_SECRET',
    'REDIS_URL',
  ];

  const env: Record<string, string> = {};
  for (const key of passthrough) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }

  return env;
}
