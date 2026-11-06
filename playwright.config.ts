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

/**
 * v0.0.5 多浏览器 × 多视口（任务书 §九）
 *
 * ## 为什么要分两组 project
 *
 * - **`core`**（默认）：Chromium 单浏览器 × 1280×900 —— CI 全量跑这套。
 *   若把三浏览器 × 五视口全放进 CI，用例数会从 184 涨到 2000+，
 *   CI 时间与不稳定性都会失控。
 * - **跨浏览器 × 跨视口**（`E2E_CROSS=1` 启用）：专项验证。
 *   覆盖「移动端不能只是缩小桌面页面」这类问题。
 *
 * ## 视口清单（任务书 §九要求）
 *
 * | 视口 | 尺寸 | 设备类型 |
 * |---|---|---|
 * | iPhone SE | 375×812 | 移动 |
 * | iPhone 12 | 390×844 | 移动 |
 * | iPad | 768×1024 | 平板 |
 * | 桌面 | 1280×900 | 桌面 |
 * | 桌面宽 | 1920×1080 | 桌面宽 |
 *
 * ## 浏览器清单
 *
 * - **Chromium** —— Chrome/Edge 内核
 * - **Firefox** —— Gecko 内核
 * - **WebKit** —— Safari 内核
 *   ⚠️ **WebKit ≠ 真实 Safari**：Playwright 的 WebKit 是 WebKit 的**移植构建**，
 *   与 macOS 上 Safari 的版本、渲染细节、系统集成都不同。
 *   结论**不能**直接外推到「真实 Safari 没问题」。
 */
const CROSS_BROWSERS = ['chromium', 'firefox', 'webkit'] as const;

const CROSS_VIEWPORTS = [
  { name: '375x812', width: 375, height: 812, isMobile: true },
  { name: '390x844', width: 390, height: 844, isMobile: true },
  { name: '768x1024', width: 768, height: 1024, isMobile: false },
  { name: '1280x900', width: 1280, height: 900, isMobile: false },
  { name: '1920x1080', width: 1920, height: 1080, isMobile: false },
] as const;

/** 跨浏览器 × 跨视口是否启用 */
const enableCross = process.env.E2E_CROSS === '1';

const projects: Array<{
  name: string;
  use: Record<string, unknown>;
}> = [
  {
    // ── 核心项目（CI 全量）──
    name: 'core',
    use: {
      ...devices['Desktop Chrome'],
      // 浏览器渠道：
      //  - CI / Linux 上用 Playwright 自带的 chromium
      //  - 本机 Windows 默认用已安装的系统 Edge，避免额外下载浏览器
      // 可用 BROWSER_CHANNEL 环境变量覆盖。
      channel: process.env.BROWSER_CHANNEL || (process.env.CI ? 'chromium' : 'msedge'),
    },
  },
];

if (enableCross) {
  for (const browser of CROSS_BROWSERS) {
    for (const vp of CROSS_VIEWPORTS) {
      projects.push({
        name: `${browser}-${vp.name}`,
        use: {
          ...devices['Desktop Chrome'],
          browserName: browser,
          // ⚠️ 不能用 `channel` —— channel 只对 chromium 有效，
          //    对 firefox / webkit 指定 channel 会报「未知 channel」。
          channel: undefined,
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.isMobile,
          hasTouch: vp.isMobile,
          // 移动端用 2x DPR（贴近真实手机）
          ...(vp.isMobile ? { deviceScaleFactor: 2 } : {}),
        },
      });
    }
  }
}

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // worker 是独立进程，需要显式透传环境变量（见 e2e/global-setup.ts）
  globalSetup: './e2e/global-setup.ts',
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
  },
  projects,
});
