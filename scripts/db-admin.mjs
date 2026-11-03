/**
 * 数据库管理辅助脚本（跨平台）
 *
 * 替代硬编码的 psql.exe 路径：旧版 verify.sh 里写死了
 * /c/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/psql.exe，
 * 在 Linux CI 与其他开发者机器上必然失败。
 *
 * 本脚本直接用 postgres 驱动操作数据库，不依赖任何命令行客户端。
 *
 * 用法：
 *   node scripts/db-admin.mjs create <dbname>
 *   node scripts/db-admin.mjs drop <dbname>
 *   node scripts/db-admin.mjs table-count <dbname>
 *   node scripts/db-admin.mjs marker <dbname>          # 查首次初始化标记
 *
 * 连接来源：
 *   DATABASE_URL —— 被操作库
 *   PG_ADMIN_URL —— 管理员连接（默认由 DATABASE_URL 推导：库名换成 postgres）
 */
import postgres from 'postgres';
import { config } from 'dotenv';

if (process.env.ENV_FILE) {
  config({ path: process.env.ENV_FILE, quiet: true, override: true });
}
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  console.error('DATABASE_URL 未设置');
  process.exit(1);
}

/** 管理员连接串：库名替换为 postgres */
function adminUrl() {
  if (process.env.PG_ADMIN_URL) return process.env.PG_ADMIN_URL;
  const url = new URL(baseUrl);
  url.pathname = '/postgres';
  return url.toString();
}

/** 指定库的连接串 */
function dbUrl(name) {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

const [command, dbName] = process.argv.slice(2);

switch (command) {
  case 'create': {
    if (!dbName) {
      console.error('缺少库名');
      process.exit(1);
    }
    const admin = postgres(adminUrl(), { prepare: false });
    try {
      await admin.unsafe(`CREATE DATABASE ${dbName}`);
      console.log(`created: ${dbName}`);
    } catch (err) {
      // 已存在视为成功（幂等）
      if (err.code === '42P04') {
        console.log(`exists: ${dbName}`);
      } else {
        console.error(String(err));
        process.exit(1);
      }
    } finally {
      await admin.end();
    }
    break;
  }

  case 'drop': {
    if (!dbName) {
      console.error('缺少库名');
      process.exit(1);
    }
    const admin = postgres(adminUrl(), { prepare: false });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
      console.log(`dropped: ${dbName}`);
    } catch (err) {
      console.error(String(err));
      process.exit(1);
    } finally {
      await admin.end();
    }
    break;
  }

  case 'table-count': {
    const client = postgres(dbUrl(dbName), { prepare: false });
    try {
      const rows = await client.unsafe(
        "select count(*)::int as c from information_schema.tables where table_schema='public'",
      );
      console.log(rows[0].c);
    } catch (err) {
      console.error(String(err));
      process.exit(1);
    } finally {
      await client.end();
    }
    break;
  }

  case 'marker': {
    const client = postgres(dbUrl(dbName), { prepare: false });
    try {
      const rows = await client.unsafe(
        "select value from kv_store where key = 'seed:initialized'",
      );
      console.log(rows.length > 0 ? rows[0].value : 'absent');
    } catch (err) {
      console.error(String(err));
      process.exit(1);
    } finally {
      await client.end();
    }
    break;
  }

  case 'db-url': {
    // 输出指定库的连接串 —— 用于把 migrate / seed 指向正确的库
    if (!dbName) {
      console.error('缺少库名');
      process.exit(1);
    }
    console.log(dbUrl(dbName));
    break;
  }

  default:
    console.error(
      '用法: node scripts/db-admin.mjs <create|drop|table-count|marker|db-url> [dbname]',
    );
    process.exit(1);
}
