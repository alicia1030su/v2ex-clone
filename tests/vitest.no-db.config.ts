import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * 无数据库依赖的回归子集（A-01 调试端点隔离 / A-03 埋点重复计数）
 *
 * ## 为什么需要单独一份配置
 *
 * `vitest.config.ts` 的 `setupFiles: ['tests/setup.ts']` 会**探活并连接
 * PostgreSQL**，`globalSetup` 还会建库 / 跑迁移。而这两个回归测试
 * 只碰 `process.env` 与 `node:http`：
 *   · `src/lib/runtime-flags.ts` —— 纯函数；
 *   · `src/instrumentation.ts` + `src/lib/observability.ts` —— 纯 Node，
 *     状态挂在 `globalThis`，不连任何外部服务。
 *
 * 让它们依赖数据库，会导致「本机没起 PG ⇒ 安全回归护栏全红 ⇒ 被忽略」，
 * 正是 `vitest.static.config.ts` 注释里指出的失效模式。
 *
 * 本配置刻意**不设** `setupFiles` / `globalSetup`，因此可在
 * 无 Docker / 无 Redis / 无 PostgreSQL 的环境独立运行。
 * 常规 CI 仍由 `vitest.config.ts`（其 include 覆盖 tests 目录下全部
 * .spec.ts 文件）统一收集，两个文件都会被正常跑到，不需要改主配置。
 *
 * 用法（在仓库根目录）：
 *   npx vitest run --config tests/vitest.no-db.config.ts
 *   npx vitest run --config tests/vitest.no-db.config.ts -t "调试端点开关"
 *   npx vitest run --config tests/vitest.no-db.config.ts -t "instrumentation"
 */
// Vite 7 起 `configLoader: 'native'` 不支持 `__dirname`（会告警），
// 用 `import.meta.dirname`（Node >= 20.11，本项目 engines 要求 >= 22.23.4）。
const ROOT = path.resolve(import.meta.dirname, '..');

export default defineConfig({
  root: ROOT,
  test: {
    include: ['tests/captcha.spec.ts', 'tests/v009-instrumentation-once.spec.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(ROOT, 'src'),
      // server-only 在纯 Node 环境会抛错，沿用项目既有替身
      'server-only': path.resolve(ROOT, 'tests/stubs/server-only.ts'),
    },
  },
});
