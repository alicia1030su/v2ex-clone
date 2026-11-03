import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 20 });
const allocate = (t) => sql`
  INSERT INTO floor_counters (topic_id, last_floor)
  SELECT ${t}, greatest(coalesce(max(floor),0),0)+1 FROM replies WHERE topic_id=${t}
  ON CONFLICT (topic_id) DO UPDATE SET last_floor = greatest(floor_counters.last_floor, EXCLUDED.last_floor)+1
  RETURNING last_floor`;

await sql.unsafe(`TRUNCATE replies, topics, nodes, categories, users, floor_counters RESTART IDENTITY CASCADE`);
const [c] = await sql`INSERT INTO categories (name,title,sort) VALUES ('c','c',1) RETURNING id`;
const [u] = await sql`INSERT INTO users (username,email,password_hash,role) VALUES ('u','u@x','x','user') RETURNING id`;
const [n] = await sql`INSERT INTO nodes (name,title,category_id,created_by) VALUES ('n','n',${c.id},${u.id}) RETURNING id`;
const [t] = await sql`INSERT INTO topics (title,content,node_id,author_id) VALUES ('t','c',${n.id},${u.id}) RETURNING id`;

console.log('=== 顺序回复 6 次（模拟真实用户逐条回复）===');
const floors = [];
for (let i = 0; i < 6; i++) {
  const f = Number((await allocate(t.id))[0].last_floor);
  await sql`INSERT INTO replies (topic_id,author_id,content,floor) VALUES (${t.id},${u.id},'r',${f})`;
  floors.push(f);
}
console.log('分配到的楼层:', floors.join(','));
console.log('期望          : 1,2,3,4,5,6');
console.log(floors.join(',') === '1,2,3,4,5,6' ? '✅ 正确' : '❌ *** 跳号缺陷确认 ***');
const gaps = [];
for (let i = 1; i < floors.length; i++) if (floors[i] !== floors[i - 1] + 1) gaps.push(`${floors[i - 1]}->${floors[i]}`);
console.log('空洞:', gaps.join(', ') || '无');
const ctr = await sql`SELECT last_floor FROM floor_counters WHERE topic_id=${t.id}`;
console.log('counter.last_floor =', ctr[0].last_floor, '| replies 实际最大 floor =', floors[floors.length - 1]);

console.log('\n=== ensureFloorCounter 后再分配 ===');
await sql`INSERT INTO floor_counters (topic_id,last_floor) SELECT ${t.id}, coalesce(max(floor),0) FROM replies WHERE topic_id=${t.id} ON CONFLICT (topic_id) DO UPDATE SET last_floor = GREATEST(floor_counters.last_floor, EXCLUDED.last_floor)`;
const f2 = Number((await allocate(t.id))[0].last_floor);
console.log('ensure 后分配 =', f2, '期望', floors[floors.length - 1] + 1, f2 === floors[floors.length - 1] + 1 ? '✅' : '❌');
await sql.end();
