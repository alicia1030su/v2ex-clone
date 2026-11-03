import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 10 });
await sql.unsafe(
  `TRUNCATE replies, topics, nodes, categories, users, floor_counters, collections, votes, thanks, follows, notifications, kv_store, rate_limit_buckets, sessions, tags, topic_tags, login_attempts, moderation_logs RESTART IDENTITY CASCADE`,
);
const [c] = await sql`INSERT INTO categories (name,title,sort) VALUES ('c','c',1) RETURNING id`;
const [u] = await sql`INSERT INTO users (username,email,password_hash,role) VALUES ('u','u@x','x','user') RETURNING id`;
const [n] = await sql`INSERT INTO nodes (name,title,category_id,created_by) VALUES ('n','n',${c.id},${u.id}) RETURNING id`;

console.log('=== A7b: 节点 topics_count 语义 ===');
for (let i = 0; i < 3; i++)
  await sql`INSERT INTO topics (title,content,node_id,author_id) VALUES (${'t' + i},'c',${n.id},${u.id})`;
await sql`UPDATE nodes SET topics_count = 1 WHERE id=${n.id}`; // 复刻 seed 的写法
const cnt = await sql`SELECT topics_count FROM nodes WHERE id=${n.id}`;
const actual = await sql`SELECT count(*)::int c FROM topics WHERE node_id=${n.id} AND status='published'`;
console.log('seed 风格（绝对赋值 1）→ topics_count =', cnt[0].topics_count, '| 实际 published =', actual[0].c, cnt[0].topics_count === actual[0].c ? '✅' : '❌ 计数漂移');
await sql`UPDATE nodes SET topics_count = (SELECT count(*)::int FROM topics WHERE node_id=${n.id}) WHERE id=${n.id}`;
const cnt2 = await sql`SELECT topics_count FROM nodes WHERE id=${n.id}`;
console.log('修正为 count(*) →', cnt2[0].topics_count, cnt2[0].topics_count === actual[0].c ? '✅' : '❌');

console.log('\n=== A7c: 软删主题后计数 ===');
await sql`UPDATE topics SET status='deleted' WHERE id=1`;
const after = await sql`SELECT topics_count FROM nodes WHERE id=${n.id}`;
const actual2 = await sql`SELECT count(*)::int c FROM topics WHERE node_id=${n.id} AND status='published'`;
console.log('软删 1 个主题后 topics_count =', after[0].topics_count, '| 实际 published =', actual2[0].c, after[0].topics_count === actual2[0].c ? '✅' : '❌ 计数未随软删调整');

console.log('\n=== A7d: replies_count 缓存 vs 实际 ===');
const [t] = await sql`INSERT INTO topics (title,content,node_id,author_id,replies_count) VALUES ('tc','c',${n.id},${u.id},0) RETURNING id`;
for (let f = 1; f <= 3; f++)
  await sql`INSERT INTO replies (topic_id,author_id,content,floor) VALUES (${t.id},${u.id},'r',${f})`;
await sql`UPDATE topics SET replies_count = replies_count + 1 WHERE id=${t.id}`;
const rc = await sql`SELECT replies_count FROM topics WHERE id=${t.id}`;
const ra = await sql`SELECT count(*)::int c FROM replies WHERE topic_id=${t.id}`;
console.log('replies_count =', rc[0].replies_count, '| 实际回复数 =', ra[0].c, rc[0].replies_count === ra[0].c ? '✅' : '❌');

console.log('\n=== A6b: 并发收藏同一主题 ===');
const col = await Promise.all(
  Array.from({ length: 15 }, () =>
    sql`INSERT INTO collections (user_id,target,topic_id) VALUES (${u.id},'topic',${t.id}) ON CONFLICT DO NOTHING RETURNING id`
      .then((r) => r.length)
      .catch((e) => 'err:' + e.code),
  ),
);
const cc = await sql`SELECT count(*)::int c FROM collections WHERE user_id=${u.id} AND topic_id=${t.id}`;
console.log('并发 15 次收藏 → 实际收藏行数:', cc[0].c, cc[0].c === 1 ? '✅ 唯一约束生效' : '❌');
console.log('  每次返回行数:', col.join(','));

console.log('\n=== A6c: 并发投票同一主题 ===');
await Promise.all(
  Array.from({ length: 15 }, () =>
    sql`INSERT INTO votes (user_id,topic_id,direction) VALUES (${u.id},${t.id},'up') ON CONFLICT DO NOTHING RETURNING id`
      .then(() => undefined)
      .catch(() => undefined),
  ),
);
const vc = await sql`SELECT count(*)::int c FROM votes WHERE user_id=${u.id} AND topic_id=${t.id}`;
console.log('并发 15 次投票 → 实际行数:', vc[0].c, vc[0].c === 1 ? '✅' : '❌');

console.log('\n=== A6d: 并发关注同一对 ===');
await Promise.all(
  Array.from({ length: 15 }, () =>
    sql`INSERT INTO follows (follower_id,following_id) VALUES (${u.id},${u.id}) ON CONFLICT DO NOTHING RETURNING id`
      .then(() => undefined)
      .catch(() => undefined),
  ),
);
const fc = await sql`SELECT count(*)::int c FROM follows WHERE follower_id=${u.id} AND following_id=${u.id}`;
console.log('并发 15 次关注 → 实际行数:', fc[0].c, fc[0].c === 1 ? '✅' : '❌');

await sql.end();
