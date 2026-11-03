import postgres from 'postgres';
import net from 'node:net';

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 10 });

// ---------- A9: 连接池断线重连 ----------
console.log('===== PROBE A9: 连接池断线与恢复 =====');
const rows = await sql`SELECT 1 as x`;
console.log('初始查询 OK:', rows[0].x);
try {
  await sql`SELECT pg_terminate_backend(pg_backend_pid())`;
  console.log('主动终止自身后端（模拟断线）');
} catch (e) {
  console.log('终止后端异常（预期）:', e.code || e.message);
}
try {
  const r2 = await sql`SELECT 2 as y`;
  console.log('终止后再次查询 OK →', r2[0].y, '✅ 连接池自动恢复');
} catch (e) {
  console.log('终止后再次查询失败:', e.code || e.message, '❌ 连接池未恢复');
}
// 大量并发查询看池是否泄漏
const t0 = Date.now();
const many = await Promise.all(
  Array.from({ length: 200 }, (_, i) => sql`SELECT ${i} as n`),
);
console.log(`200 次并发查询完成，用时 ${Date.now() - t0}ms，池未耗尽 ✅`);

// ---------- A10: 迁移幂等 ----------
console.log('\n===== PROBE A10: 迁移记录与实际结构一致性 =====');
const mig = await sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
console.log('迁移记录数:', mig.length, 'hash:', mig.map((m) => m.hash).join(','));
const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`;
console.log('实际表数:', tables.length);
const idx = await sql`SELECT indexname FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`;
console.log('索引:', idx.map((i) => i.indexname).join(', '));

// ---------- A8 续: 多进程一致性（同一 key 并发自增）----------
console.log('\n===== PROBE A8b: rate_limit_buckets 并发自增一致性 =====');
await sql`DELETE FROM rate_limit_buckets`;
const key = 'ratelimit:probe:multi';
const windowSeconds = 60;
const incr = async () => {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const r = await sql`
    INSERT INTO rate_limit_buckets (key, count, window_start)
    VALUES (${key}, 1, ${windowStart.toISOString()})
    ON CONFLICT (key) DO UPDATE
      SET count = CASE WHEN rate_limit_buckets.window_start < ${windowStart.toISOString()}::timestamptz THEN 1 ELSE rate_limit_buckets.count + 1 END,
          window_start = CASE WHEN rate_limit_buckets.window_start < ${windowStart.toISOString()}::timestamptz THEN ${windowStart.toISOString()}::timestamptz ELSE rate_limit_buckets.window_start END
    RETURNING count`;
  return Number(r[0].count);
};
const counts = await Promise.all(Array.from({ length: 100 }, () => incr()));
const final = await sql`SELECT count FROM rate_limit_buckets WHERE key=${key}`;
console.log('100 次并发 incr → 最终 count =', final[0].count, final[0].count === 100 ? '✅ 无丢失更新' : '❌ 丢失更新');
console.log('  各次返回值最大值:', Math.max(...counts));

// ---------- 邮箱唯一索引大小写 ----------
console.log('\n===== PROBE: 邮箱唯一索引定义 =====');
const idxDef = await sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='users' ORDER BY indexname`;
for (const i of idxDef) console.log('  ', i.indexname, '=>', i.indexdef);

await sql.end();
console.log('\nprobe3 done');
