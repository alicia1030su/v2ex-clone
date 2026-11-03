import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = process.cwd();

function resolveTsx() {
  const pkgJsonPath = repoRoot + '/node_modules/tsx/package.json';
  const pkg = JSON.parse(require('node:fs').readFileSync(pkgJsonPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.tsx;
  return { command: process.execPath, args: [repoRoot + '/node_modules/tsx/' + bin] };
}

const URL = process.env.DATABASE_URL;
const sql = postgres(URL, { prepare: false, max: 5 });

const runSeed = (env) => {
  const { command, args } = resolveTsx();
  return execFileSync(command, [...args, 'scripts/seed.ts'], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: {
      ...process.env,
      ENV_FILE: '',
      DATABASE_URL: URL,
      SEED_ADMIN_USERNAME: 'auditadmin',
      SEED_ADMIN_EMAIL: 'auditadmin@test.local',
      SEED_ADMIN_PASSWORD: 'audit-admin-password-12345',
      SEED_DEMO_USERS: '1',
      SEED_DEMO_PASSWORD: 'audit-demo-password-12345',
      APP_RUNTIME_ENV: 'test',
      NODE_ENV: 'test',
      ...env,
    },
  });
};

console.log('===== PROBE A3: seed 幂等性 =====');
await sql.unsafe(`TRUNCATE replies, topics, nodes, categories, users, floor_counters, collections, votes, thanks, follows, notifications, kv_store, rate_limit_buckets, sessions, tags, topic_tags, login_attempts, moderation_logs RESTART IDENTITY CASCADE`);

const out1 = runSeed({});
console.log('--- 第一次 seed 输出 ---');
console.log(out1.trim());

const snap = async () => {
  const users = await sql`SELECT id, username, role, password_hash FROM users ORDER BY username`;
  const topics = await sql`SELECT id, title, replies_count FROM topics ORDER BY id`;
  const replies = await sql`SELECT id, topic_id, floor, content FROM replies ORDER BY id`;
  const counters = await sql`SELECT topic_id, last_floor FROM floor_counters ORDER BY topic_id`;
  const marker = await sql`SELECT key, value FROM kv_store`;
  const collections = await sql`SELECT id, user_id, target, topic_id, node_id FROM collections ORDER BY id`;
  const nodes = await sql`SELECT id, name, topics_count FROM nodes ORDER BY id`;
  return { users, topics, replies, counters, marker, collections, nodes };
};

const s1 = await snap();
console.log('\n第一次 seed 后快照:');
console.log('  用户:', s1.users.length, '| 主题:', s1.topics.length, '| 回复:', s1.replies.length, '| 收藏:', s1.collections.length);
console.log('  初始化标记:', JSON.stringify(s1.marker));
console.log('  counter 数:', s1.counters.length, '| counter 值:', s1.counters.map((c) => c.last_floor).join(','));

// 改口令 + 改角色，模拟用户操作
await sql`UPDATE users SET password_hash='user-changed-hash' WHERE username='auditadmin'`;
await sql`UPDATE users SET role='moderator' WHERE username='auditadmin'`;
await sql`UPDATE users SET balance=99999 WHERE username='auditadmin'`;
const beforeUsers = await sql`SELECT username, role, password_hash, balance FROM users ORDER BY username`;

const out2 = runSeed({});
console.log('\n--- 第二次 seed 输出 ---');
console.log(out2.trim());

const afterUsers = await sql`SELECT username, role, password_hash, balance FROM users ORDER BY username`;
console.log('\n第二次 seed 后用户对比:');
let userSame = true;
for (let i = 0; i < beforeUsers.length; i++) {
  const b = beforeUsers[i];
  const a = afterUsers[i];
  const same = b.username === a.username && b.role === a.role && b.password_hash === a.password_hash && b.balance === a.balance;
  if (!same) {
    userSame = false;
    console.log(`  ❌ ${b.username}: role ${b.role}→${a.role}, hash ${b.password_hash}→${a.password_hash}, balance ${b.balance}→${a.balance}`);
  }
}
if (userSame) console.log('  ✅ 所有用户（口令哈希/角色/余额）逐字节未变');

const s2 = await snap();
console.log('\n数据量对比（第一次 → 第二次）:');
console.log('  用户:', s1.users.length, '→', s2.users.length, s1.users.length === s2.users.length ? '✅' : '❌');
console.log('  主题:', s1.topics.length, '→', s2.topics.length, s1.topics.length === s2.topics.length ? '✅' : '❌');
console.log('  回复:', s1.replies.length, '→', s2.replies.length, s1.replies.length === s2.replies.length ? '✅' : '❌');
console.log('  收藏:', s1.collections.length, '→', s2.collections.length, s1.collections.length === s2.collections.length ? '✅' : '❌');
console.log('  counter:', s1.counters.length, '→', s2.counters.length, s1.counters.length === s2.counters.length ? '✅' : '❌');

// 楼层计数器一致性
console.log('\n楼层计数器一致性检查:');
const bad = await sql`
  SELECT r.topic_id, fc.last_floor, max(r.floor)::int AS actual_max
  FROM replies r JOIN floor_counters fc ON fc.topic_id = r.topic_id
  GROUP BY r.topic_id, fc.last_floor
  HAVING fc.last_floor <> max(r.floor)`;
console.log('  counter != max(floor) 的主题:', bad.length === 0 ? '无 ✅' : JSON.stringify(bad));

// 第三次 seed（重复）
runSeed({});
const s3 = await snap();
console.log('\n第三次 seed 后主题数:', s3.topics.length, s3.topics.length === s1.topics.length ? '✅ 幂等' : '❌');

// 已初始化标记守卫：第二次输出应含「跳过」
console.log('\n守卫检查: 第二次 seed 输出含「跳过 seed」→', out2.includes('跳过 seed') ? '✅' : '❌');

await sql.end();
console.log('\nprobe4 done');
