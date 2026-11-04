import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    // 环境变量由 setup.ts 加载（vitest 5 已移除 test.envFile）
    setupFiles: ['tests/setup.ts'],
    // 全局前置 —— **整个进程只跑一次**：
    // 建基础库 + 跑迁移（幂等）。
    //
    // 为什么不在 setupFiles 里做：setupFiles 对**每个**测试文件都执行，
    // 15 个文件各跑一次 drizzle-kit migrate 会打满 PG 连接数
    // （Windows 上表现为 CONNECT_TIMEOUT —— 那不是 PG 未就绪）。
    // 详见 tests/helpers/global-setup.ts 的注释。
    globalSetup: ['tests/helpers/global-setup.ts'],
    testTimeout: 30_000,
    // ⚠️ v0.0.4：`hookTimeout` = 120_000 —— 这是**宽松保险**，不是性能修复。
    //
    // ── 归因勘误（重要 —— 不要被历史结论误导）──────────────────────
    //
    // 本文件此前写着「CREATE DATABASE 38.6s ← 瓶颈」，并据此推断
    // 「数据目录 1.4GB → 复制模板库 → 逐文件 fsync → 必然很慢」。
    // **该归因已被实测推翻三次**，最终结论是：
    //
    //   • 38.6s 是 **PG 处于 crash recovery / I/O 积压态**时的观测值，
    //     **不是**稳态。PG 日志实测有 60~70 秒的逐目录 fsync 段，
    //     紧接着就是「redo 开始 / redo done」—— 那一刻磁盘队列还在积压。
    //   • **稳态下 `CREATE DATABASE` 只要 2.0~2.3 秒**
    //     （主理人实测三次：2277 / 1978 / 2243 ms）。
    //   • **数据目录大小根本不是瓶颈**：
    //     `CREATE DATABASE` 复制的是 `template1`（实测 298 文件 / 7.5MB），
    //     与 1.4GB 总目录无关；那 891MB 的 `v2ex_loadtest` 压测库
    //     **不在 template1 里**，也不参与建库的文件复制。
    //
    // 因此：**不需要**换盘、装 Docker、改 `fsync=off`。
    // 本机改用**独立隔离实例**（tests/helpers/start-test-pg.sh，端口 55440）
    // 的目的是**隔离性 + 可复现性**，**不是**提速。
    //
    // 120_000 这个值的定位：稳态全流程（建库 ~2s + migrate ~5s + seed）
    // 应 < 30s，120s 有充足余量，**用它兜住异常态而不是掩盖真问题**。
    // 真正的判据是 `tests/helpers/test-db-lifecycle.ts` 输出的
    // `[db-phase]` 阶段耗时日志：某个文件 `createMs` 突然 30s+
    // 说明 PG 进入了积压态 —— 那是**环境问题**，不是产品缺陷。
    //
    // ⚠️ **不要为了让测试变绿而调大这个值**。
    // 任何阶段耗时超标都应先走 §4.7 的排查流程（区分「PG 未就绪」与「真超时」）。
    //
    // 注：CI 的 PG 是独立 service（5432），CREATE DATABASE 毫秒级，
    // 不会触发这个阈值；提高 hookTimeout 对 CI 无副作用。
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
