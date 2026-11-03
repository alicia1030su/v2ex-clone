import { config as loadEnv } from 'dotenv';

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
    // override:true —— 首个文件（ENV_FILE）必须能覆盖 shell 中已有的同名变量
    loadEnv({ path: f, quiet: true, override: f === process.env.ENV_FILE });
  }

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
