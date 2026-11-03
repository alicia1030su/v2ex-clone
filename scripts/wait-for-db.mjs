/**
 * 数据库就绪探测（容器入口脚本使用）
 *
 * 单独成一个文件而不是塞进 shell 的 node -e 里，原因：
 *  - postgres 是 ESM 包（"type": "module"），在 `node -e` 的 CJS 上下文里
 *    无法用 require() 加载；
 *  - 独立文件可以直接用 import，跨 Node 版本行为一致。
 *
 * 退出码：
 *   0 —— 数据库可用
 *   1 —— 数据库不可用
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL 未设置');
  process.exit(1);
}

const sql = postgres(url, {
  prepare: false,
  connect_timeout: Number(process.env.PROBE_CONNECT_TIMEOUT ?? 3),
  max: 1,
});

try {
  await sql`select 1`;
  await sql.end();
  process.exit(0);
} catch {
  await sql.end().catch(() => undefined);
  process.exit(1);
}
