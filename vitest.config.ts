import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    // 环境变量由 setup.ts 加载（vitest 5 已移除 test.envFile）
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    // ⚠️ v0.0.4：`hookTimeout` 从 30s 提到 120s。
    //
    // 实测根因（2026-11-04，本机 PostgreSQL 55433）：
    //   DROP DATABASE          1.2s
    //   **CREATE DATABASE     38.6s**   ← 瓶颈
    //   drizzle-kit migrate    5.4s
    // 自建库的测试文件在 beforeAll 里要做这三步，30s 阈值必然不够 ——
    // 表现为 4 个文件 hook 超时、28 条用例被跳过。
    //
    // 归因勘误：先前误判为「.env.local → 5432 污染」或「并行 PG 负载」，
    // 但用 ENV_FILE（override: true）指向 55433 后**仍然超时**，
    // 且单独跑 seed-idempotency 也是 32.5s 超时 → 两个假设均被实测推翻。
    //
    // 注：CI 的 PG 是独立 service（5432），CREATE DATABASE 毫秒级，
    // 不会触发这个阈值；提高 hookTimeout 对 CI 无副作用，只解决本机慢盘问题。
    hookTimeout: 120_000,
    // ⚠️ v0.0.4：测试文件**串行**执行。
    //
    // 原因：多个测试文件各自在 beforeAll/afterAll 里
    //   DROP DATABASE → CREATE DATABASE → 跑 drizzle-kit migrate
    //   （seed-idempotency 还要跑 seed 脚本）。
    // 并行执行时这些操作会争抢同一个 PostgreSQL 实例：
    //   - DROP DATABASE 需要等待其他文件的连接释放
    //   - 多个 drizzle-kit migrate 进程互相拖慢
    // 串行换来的是**稳定可复现**的结果 —— 这比并行更重要。
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // server-only 在纯 Node 环境会抛错（它只在 Next.js 编译期有意义），
      // 单元测试中将其映射为空模块。
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
});
