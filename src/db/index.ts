import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from 'dotenv';
import * as schema from './schema';

// 环境文件加载顺序：
//  1. ENV_FILE 指定的文件（用于隔离测试环境，如 .env.test）
//  2. .env.local（本地开发）
//  3. .env（容器 / 生产）
// dotenv 不会覆盖已存在的环境变量，因此 CI 中用环境变量注入的配置优先。
const ENV_FILE = process.env.ENV_FILE;
if (ENV_FILE) {
  config({ path: ENV_FILE, quiet: true });
}
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const globalForDb = globalThis as unknown as {
  __v2exSql?: ReturnType<typeof postgres>;
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

export const sql = globalForDb.__v2exSql ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__v2exSql = sql;
}

export const db = drizzle(sql, { schema });
export { schema };
