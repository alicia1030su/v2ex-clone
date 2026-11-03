import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from 'dotenv';
import * as schema from './schema';

// 环境文件加载顺序：
//  1. ENV_FILE 指定的文件（用于隔离测试环境，如 .env.test）
//  2. .env.local（本地开发）
//  3. .env（容器 / 生产）
// dotenv 不会覆盖已存在的环境变量，因此 CI 中用环境变量注入的配置优先。
// ENV_FILE 指定的文件用 override:true —— Next.js 在应用代码之前已自动
// 加载了 .env / .env.production / .env.local，DATABASE_URL 等变量已被占位；
// dotenv 默认不覆盖已有值，不加 override 的话 ENV_FILE 永远不生效。
const ENV_FILE = process.env.ENV_FILE;
if (ENV_FILE) {
  config({ path: ENV_FILE, quiet: true, override: true });
}
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

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
