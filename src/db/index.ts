import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from 'dotenv';
import * as schema from './schema';

// 优先加载 .env.local（本地开发），回退 .env
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
