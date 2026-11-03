import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';

if (process.env.ENV_FILE) {
  config({ path: process.env.ENV_FILE, quiet: true, override: true });
}
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

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
