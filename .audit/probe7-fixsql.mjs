import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 10 });

await sql.unsafe(`TRUNCATE replies, topics, nodes, categories, users, floor_counters RESTART IDENTITY CASCADE`);
const [c] = await sql`INSERT INTO categories (name,title,sort) VALUES ('c','c',1) RETURNING id`;
const [u] = await sql`INSERT INTO users (username,email,password_hash,role) VALUES ('u','u@x','x','user') RETURNING id`;
const [n] = await sql`INSERT INTO nodes (name,title,category_id,created_by) VALUES ('n','n',${c.id},${u.id}) RETURNING id`;

// 方案 A：EXCLUDED 技巧
const allocA = (t) => sql`
  INSERT INTO floor_counters (topic_id, last_floor)
  SELECT ${t}, coalesce(max(floor),0)+1 FROM replies WHERE topic_id=${t}
  ON CONFLICT (topic_id) DO UPDATE
    SET last_floor = greatest(floor_counters.last_floor, EXCLUDED.last_floor - 1) + 1
  RETURNING last_floor`;

// 方案 B：DO UPDATE 里用子查询读实时 max
const allocB = (t) => sql`
  INSERT INTO floor_counters (topic_id, last_floor)
  SELECT ${t}, coalesce(max(floor),0)+1 FROM replies WHERE topic_id=${t}
  ON CONFLICT (topic_id) DO UPDATE
    SET last_floor = greatest(floor_counters.last_floor,
      (SELECT coalesce(max(floor),0) FROM replies WHERE topic_id=${t})) + 1
  RETURNING last_floor`;

async function scenario(name, alloc) {
  console.log('\n--- ' + name + ' ---');
  // 场景1：全新主题顺序回复 6 次
  const [t1] = await sql`INSERT INTO topics (title,content,node_id,author_id) VALUES ('t1','c',${n.id},${u.id}) RETURNING id`;
  const f1 = [];
  for (let i = 0; i < 6; i++) {
    const f = Number((await alloc(t1.id))[0].last_floor);
    await sql`INSERT INTO replies (topic_id,author_id,content,floor) VALUES (${t1.id},${u.id},'r',${f})`;
    f1.push(f);
  }
  console.log('  全新主题顺序回复:', f1.join(','), f1.join(',') === '1,2,3,4,5,6' ? '✅' : '❌');

  // 场景2：counter 漂移（counter=0，实际 floors 1..10）
  const [t2] = await sql`INSERT INTO topics (title,content,node_id,author_id) VALUES ('t2','c',${n.id},${u.id}) RETURNING id`;
  for (let f = 1; f <= 10; f++)
    await sql`INSERT INTO replies (topic_id,author_id,content,floor) VALUES (${t2.id},${u.id},'x',${f})`;
  await sql`INSERT INTO floor_counters (topic_id,last_floor) VALUES (${t2.id},0)`;
  const f2 = Number((await alloc(t2.id))[0].last_floor);
  console.log('  counter 漂移(0) + 实际 1..10 → 分配', f2, f2 === 11 ? '✅' : '❌ 期望 11');

  // 场景3：counter 超前（counter=20，实际 1..10）
  await sql`UPDATE floor_counters SET last_floor=20 WHERE topic_id=${t2.id}`;
  const f3 = Number((await alloc(t2.id))[0].last_floor);
  console.log('  counter 超前(20) + 实际 1..10 → 分配', f3, f3 === 21 ? '✅' : '❌ 期望 21');

  // 场景4：counter 缺失（全新，无 replies）
  const [t4] = await sql`INSERT INTO topics (title,content,node_id,author_id) VALUES ('t4','c',${n.id},${u.id}) RETURNING id`;
  const f4 = Number((await alloc(t4.id))[0].last_floor);
  console.log('  无 counter 无 replies → 分配', f4, f4 === 1 ? '✅' : '❌ 期望 1');

  // 场景5：并发 50 路
  const [t5] = await sql`INSERT INTO topics (title,content,node_id,author_id) VALUES ('t5','c',${n.id},${u.id}) RETURNING id`;
  const res = await Promise.all(
    Array.from({ length: 50 }, async () => {
      try {
        const f = Number((await alloc(t5.id))[0].last_floor);
        await sql`INSERT INTO replies (topic_id,author_id,content,floor) VALUES (${t5.id},${u.id},'c',${f})`;
        return { f, ok: true };
      } catch (e) {
        return { f: null, ok: false, err: e.code };
      }
    }),
  );
  const okc = res.filter((r) => r.ok).length;
  const fs = res.filter((r) => r.ok).map((r) => r.f).sort((a, b) => a - b);
  const uniq = new Set(fs).size;
  const dup = await sql`SELECT floor FROM replies WHERE topic_id=${t5.id} GROUP BY floor HAVING count(*)>1`;
  const gaps = [];
  for (let i = 1; i < fs.length; i++) if (fs[i] !== fs[i - 1] + 1) gaps.push(`${fs[i - 1]}->${fs[i]}`);
  console.log(`  并发 50 → 成功 ${okc}, 唯一楼层 ${uniq}, DB重复 ${dup.length}, 空洞 ${gaps.length}`);
  console.log(`  ${okc === 50 && uniq === 50 && dup.length === 0 ? '✅' : '❌'}`);
}

await scenario('方案 A (EXCLUDED 技巧)', allocA);
await scenario('方案 B (DO UPDATE 子查询)', allocB);

await sql.end();
