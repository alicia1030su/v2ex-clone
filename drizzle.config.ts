import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/v2ex',
  },
  verbose: true,
  strict: true,
} satisfies Config;
