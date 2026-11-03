import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 10 });

await sql.unsafe(
  `TRUNCATE replies, topics, nodes, categories, users, floor_counters, collections, votes, thanks, follows, notifications, kv_store, rate_limit_buckets, sessions, tags, topic_tags, login_attempts, moderation_logs RESTART IDENTITY CASCADE`,
);
const [c] = await sql`INSERT INTO categories (name,title,sort) VALUES ('c','c',1) RETURNING id`;
const [u] = await sql`INSERT INTO users (username,email,password_hash,role) VALUES ('u','u@x','x','user') RETURNING id`;
const [n] = await sql`INSERT INTO nodes (name,title,category_id,created_by) VALUES ('n','n',${c.id},${u.id}) RETURNING id`;

console.log('=== D3/D-signup: 并发注册同名用户（模拟 signup 路由的 TOCTOU）===');
// signup 路由流程：先 SELECT 检查（两者都查不到）→ 再 INSERT
const results = await Promise.all(
  Array.from({ length: 5 }, async (_, i) => {
    // 预检查：都查不到
    const existing = await sql`SELECT id FROM users WHERE lower(username) = lower('raceuser')`;
    if (existing.length > 0) return { step: 'precheck-blocked' };
    try {
      const r = await sql`INSERT INTO users (username,email,password_hash,role) VALUES ('raceuser',${'r' + i + '@x'},'x','user') RETURNING id`;
      return { step: 'inserted', id: r[0].id };
    } catch (e) {
      return { step: 'insert-threw', code: e.code, msg: e.message };
    }
  }),
);
console.log('结果:', JSON.stringify(results));
const threw = results.filter((r) => r.step === 'insert-threw');
console.log(
  threw.length > 0
    ? `❌ 有 ${threw.length} 个请求在 INSERT 时抛唯一约束冲突（错误码 ${threw[0].code}）`
    : '✅ 无冲突',
);
console.log('⇒ signup 路由的 INSERT 没有 try/catch → 唯一约束冲突会变成 HTTP 500，而不是 409「该用户名已被使用」');

// 实测 signup 路由是否捕获了唯一约束冲突
import { readFileSync } from 'node:fs';
const signupSrc = readFileSync('src/app/api/auth/signup/route.ts', 'utf8');
const insertIdx = signupSrc.indexOf('.insert(schema.users)');
const afterInsert = signupSrc.slice(insertIdx, insertIdx + 500);
console.log('  signup 路由 INSERT 附近是否含 try/catch:', /try\s*\{/.test(afterInsert.split('await db')[0] + afterInsert) ? '可能有' : '❌ 没有');
console.log('  路由里是否出现 23505 / unique 处理:', signupSrc.includes('23505') ? '有' : '❌ 无（冲突 → 500）');

// === D4: seed 的 nodes.topics_count ===
console.log('\n=== D4: seed 的 nodes.topics_count 赋值语义 ===');
const [t1] = await sql`INSERT INTO topics (title,content,node_id,author_id) VALUES ('a','c',${n.id},${u.id}) RETURNING id`;
const [t2] = await sql`INSERT INTO topics (title,content,node_id,author_id) VALUES ('b','c',${n.id},${u.id}) RETURNING id`;
await sql`UPDATE nodes SET topics_count = 1 WHERE id=${n.id}`; // seed 的写法
const nc = await sql`SELECT topics_count FROM nodes WHERE id=${n.id}`;
const actual = await sql`SELECT count(*)::int c FROM topics WHERE node_id=${n.id} AND status='published'`;
console.log(`seed 风格 → topics_count=${nc[0].topics_count}，实际 published=${actual[0].c}`, nc[0].topics_count === actual[0].c ? '✅' : '❌ 漂移');

// === D4b: 增量写法 ===
await sql`UPDATE nodes SET topics_count = topics_count + 1 WHERE id=${n.id}`;
const nc2 = await sql`SELECT topics_count FROM nodes WHERE id=${n.id}`;
console.log(`增量写法 → topics_count=${nc2[0].topics_count}`, nc2[0].topics_count === actual[0].c ? '✅' : '❌');

// === A5: 事务原子性 — 回复插入与计数更新 ===
console.log('\n=== D5: 回复插入 + 计数更新 + 通知的原子性 ===');
console.log('replies 路由中 update(topics) 是否与 insert(replies) 同事务:');
const repliesSrc = readFileSync('src/app/api/replies/route.ts', 'utf8');
console.log('  路由含 db.transaction →', repliesSrc.includes('db.transaction') ? '✅ 有事务' : '❌ 无事务（计数与插入分离）');
const txSrc = readFileSync('src/app/api/topics/route.ts', 'utf8');
console.log('  topics 路由含 db.transaction →', txSrc.includes('db.transaction') ? '✅' : '❌ 无事务');

// === 邮箱归一化检查 ===
console.log('\n=== 邮箱归一化 ===');
const su = readFileSync('src/app/api/auth/signup/route.ts', 'utf8');
console.log('  signup 把 email 转小写 →', /\.toLowerCase\(\)/.test(su) ? '✅ 是（所以索引大小写敏感实际被绕过）' : '❌ 否');

await sql.end();
