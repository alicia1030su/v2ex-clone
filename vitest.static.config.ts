import { defineConfig } from 'vitest/config';

/**
 * v0.0.8：**纯静态**测试配置（不依赖数据库）
 *
 * 用途：语法护栏、源码结构断言这类「只需要读文件」的测试。
 * 它们**不应该**因为 PostgreSQL 不可用就跑不了 ——
 * 本机 PG 因磁盘 I/O 劣化反复 crash recovery，若静态检查也依赖它，
 * 这些护栏就会「长期红灯 ⇒ 被人忽略」，反而失去价值。
 *
 * 用法：
 *   npx vitest run --config vitest.static.config.ts
 */
export default defineConfig({
  test: {
    include: ['tests/static/**/*.spec.ts', 'tests/v008-observability.spec.ts'],
    environment: 'node',
    globals: false,
    // ⚠️ 刻意**不设** globalSetup / setupFiles ⇒ 不碰数据库
    testTimeout: 30_000,
  },
});
