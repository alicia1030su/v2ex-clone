import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.LOCAL_BASE ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
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
