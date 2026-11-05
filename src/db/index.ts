import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { loadProductEnv } from '../lib/env-loader.mjs';

/**
 * 环境加载 —— 委托给**全仓唯一**的实现 `src/lib/env-loader.mjs`
 *
 * 优先级（产品侧）：
 *   1. `process.env`（shell / CI / 容器注入）—— **永不被文件覆盖**
 *   2. `ENV_FILE` 指定的文件 —— 只填充**未设置**的变量
 *   3. `.env.local`（仅非测试运行时）—— 只填充未设置的变量
 *   4. `.env`（容器 / 生产）—— 只填充未设置的变量
 *
 * ## 为什么这里需要「override」而其他地方不需要
 *
 * Next.js 在**应用代码执行之前**就通过 `@next/env` 自动加载
 * `.env.{NODE_ENV}.local` / `.env.local` / `.env.{NODE_ENV}` / `.env`，
 * 于是本模块运行时 `process.env.DATABASE_URL` **已经**被 `.env.local` 占位。
 * 若还坚持「只填空位」，`ENV_FILE` 就永远赢不了 ——
 * 这正是 v0.0.4 之前「`ENV_FILE` 从未生效」的根因。
 *
 * ## 但 override 的对象必须**收紧**
 *
 * 修复前的写法是 `config({ path: ENV_FILE, override: true })` ——
 * **无条件覆盖**，于是命令行 / CI 显式注入的 `DATABASE_URL`
 * 会被 `ENV_FILE` 文件**静默覆盖**，表现为「以为在测试库跑、其实跑到别的库」。
 *
 * 现在把 override 的判定收紧为：
 * **只有「Next 自动加载的占位值」才允许被 `ENV_FILE` 覆盖，
 *   shell / CI 注入的值绝不覆盖。**
 *
 * 判定的可靠依据是 `@next/env` 拍下的 `initialEnv` ——
 * 那是 Next 加载任何 env 文件**之前**的 `process.env` 精确快照，
 * 因此能干净地区分「shell 注入」与「文件占位」。
 *
 * 详见 `src/lib/env-loader.mjs` 的文档注释（含实测结论）。
 */
loadProductEnv({ cwd: process.cwd() });

const globalForDb = globalThis as unknown as {
  __v2exSql?: ReturnType<typeof postgres>;
  __v2exDrizzle?: ReturnType<typeof drizzle<typeof schema>>;
};

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill in the connection string.',
    );
  }
  return postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
}

/**
 * 惰性数据库客户端（P0-4）
 *
 * 修复前的问题：
 *   `export const sql = createClient()` 在**模块加载时**就创建连接池。
 *   而 `next build` 会导入全部路由模块 —— 构建期并没有数据库，
 *   于是构建直接失败：
 *     Error: DATABASE_URL is not set.
 *     [Error: Failed to collect page data for /api/auth/signout]
 *   这让 Dockerfile 的 builder 阶段（无数据库）根本无法构建镜像。
 *
 * 修复方式：
 *   用 Proxy 把客户端改成**惰性创建** —— 只有真正调用数据库 API 时
 *   才创建连接池。导入模块本身不再需要 DATABASE_URL。
 *
 *   注意：本项目所有页面都是 `dynamic = 'force-dynamic'`，
 *   构建期不会真的查库，因此惰性化后构建不需要任何数据库连接。
 *
 * 缓存策略（重要）：
 *   客户端与 drizzle 实例**始终**缓存在 globalThis 上。
 *   若只在非生产环境缓存，生产环境每次访问 db.xxx 都会新建一个
 *   postgres 连接池 —— 几十个请求就能耗尽连接，表现为
 *   响应急剧变慢、并发用例随机失败。
 *   globalThis 缓存在开发环境还能跨 HMR 复用同一连接池。
 */
function getClient(): ReturnType<typeof postgres> {
  if (!globalForDb.__v2exSql) {
    globalForDb.__v2exSql = createClient();
  }
  return globalForDb.__v2exSql;
}

function getDrizzle(): ReturnType<typeof drizzle<typeof schema>> {
  if (!globalForDb.__v2exDrizzle) {
    globalForDb.__v2exDrizzle = drizzle(getClient(), { schema });
  }
  return globalForDb.__v2exDrizzle;
}

/**
 * postgres 客户端的惰性代理。
 *
 * - `sql\`select ...\`` —— apply 陷阱转发给真实客户端
 * - `sql.end()` —— get 陷阱取到真实方法并绑定
 */
export const sql = new Proxy({} as ReturnType<typeof postgres>, {
  get(_target, prop) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
  apply(_target, _thisArg, args) {
    const client = getClient() as unknown as (...a: unknown[]) => unknown;
    return client(...args);
  },
}) as ReturnType<typeof postgres>;

/**
 * drizzle 实例的惰性代理。
 *
 * `db.select()` / `db.insert()` / `db.execute()` 等都在 get 陷阱里
 * 转发到真实的 drizzle 实例，方法用 bind 绑定，保证 `this` 正确。
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    const instance = getDrizzle() as unknown as Record<string | symbol, unknown>;
    const value = instance[prop];
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(instance)
      : value;
  },
}) as ReturnType<typeof drizzle<typeof schema>>;

export { schema };
