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
    hookTimeout: 30_000,
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
