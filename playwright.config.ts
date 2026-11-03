import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// 加载隔离测试环境配置，使用例能读到与被测服务一致的开关状态
// （dotenv 不覆盖已存在的环境变量）
if (process.env.ENV_FILE) {
  loadEnv({ path: process.env.ENV_FILE, quiet: true });
}
loadEnv({ path: '.env.test', quiet: true });
loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const BASE_URL = process.env.LOCAL_BASE ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  // 把测试环境变量透传给用例进程
  // （DEBUG_ENDPOINT_TOKEN 等由 CI / 本地 shell 注入）
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'zh-CN',
    viewport: { width: 1280, height: 900 },
    // 使用系统已安装的 Edge，避免 chromium 下载依赖
    channel: process.env.BROWSER_CHANNEL ?? 'msedge',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
