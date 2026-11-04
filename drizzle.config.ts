import type { Config } from 'drizzle-kit';
import { loadProductEnv } from './src/lib/env-loader.mjs';

/**
 * drizzle-kit 配置 —— **父子进程一致性的关键**
 *
 * ## 本文件是子进程的入口
 *
 * `drizzle-kit migrate` 是**独立子进程**，由父进程 spawn。
 * 本文件在子进程里执行，因此它是「父子一致性」的**唯一决定点**：
 * 父进程注入的 `DATABASE_URL` 必须**原样**传到子进程，
 * 不能被 `.env.local`（5432 开发库）悄悄改写。
 *
 * ## 修复前的 bug
 *
 * ```ts
 * if (process.env.ENV_FILE) {
 *   config({ path: process.env.ENV_FILE, quiet: true, override: true });
 * }
 * ```
 *
 * `override: true` 让 `ENV_FILE` 指向的文件**无条件覆盖**已存在的变量，
 * 于是父进程显式注入的 `DATABASE_URL` 被**静默忽略** ——
 * 表现为「以为在测试库跑、迁移其实跑到别的库」。
 *
 * QA 已独立实测复现（见 `docs/evidence/ci/test-baseline-v0.0.4.md`）：
 * `ENV_FILE=.env.test DATABASE_URL=.../v2ex_qa_migidem_v004 npx drizzle-kit migrate`
 * → 迁移落到了 `.env.test` 里的 `v2ex_e2e`，目标库**一张表都没有**。
 *
 * ## 现在的语义
 *
 * 委托给**全仓唯一**的实现 `src/lib/env-loader.mjs`：
 * shell / CI 注入 > `ENV_FILE` 文件 > `.env.local` > `.env`，
 * 且文件**只填充未设置的变量**。
 *
 * 于是：
 *  - 父进程注入的 `DATABASE_URL` → 子进程**原样**使用（最高优先级）；
 *  - `ENV_FILE` 指定的测试配置 → 生效（且不会覆盖 shell 注入）；
 *  - 都没有 → 回退 `.env.local` / `.env`（本地开发的常规路径）。
 *
 * 注：drizzle-kit **自己不会**加载任何 env 文件（已实测：
 * 子进程里 `__NEXT_PROCESSED_ENV` 与 `DATABASE_URL` 均为 `undefined`），
 * 因此这里的加载是**唯一**来源。
 */
const report = loadProductEnv({ cwd: process.cwd() });

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: report.databaseUrl ?? 'postgres://postgres:postgres@127.0.0.1:5432/v2ex',
  },
  verbose: true,
  strict: true,
} satisfies Config;
