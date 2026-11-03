/**
 * PROBE A4: entrypoint 三阶段（migrate → init → start）行为差异
 * A11: 备份恢复（在临时库上实测）
 */
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const PG_BIN = 'C:/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin';

function resolveTsx() {
  const pkg = JSON.parse(readFileSync(repoRoot + '/node_modules/tsx/package.json', 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.tsx;
  return { command: process.execPath, args: [repoRoot + '/node_modules/tsx/' + bin] };
}

const DB = 'v2ex_audit_entry';
const URL_BASE = 'postgres://v2ex:v2ex_password@127.0.0.1:5432';
const URL = `${URL_BASE}/${DB}`;

const admin = postgres(`${URL_BASE}/postgres`, { prepare: false });
let sql = null;

function sh(cmd, args, env) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, ENV_FILE: '', DATABASE_URL: URL, ...env },
  });
}

console.log('===== PROBE A4: entrypoint 三阶段 =====');
await admin.unsafe(`DROP DATABASE IF EXISTS ${DB}`);
await admin.unsafe(`CREATE DATABASE ${DB}`);
sql = postgres(URL, { prepare: false, max: 5 });

// 阶段 1: migrate
console.log('--- 阶段 1: migrate（全新空库）---');
sh(process.execPath, [repoRoot + '/node_modules/drizzle-kit/bin.cjs', 'migrate'], {});
const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`;
console.log('  迁移后表数:', tables.length, tables.length === 18 ? '✅' : '❌');

// 阶段 2: init（首次）
console.log('--- 阶段 2: init（首次初始化）---');
const { command, args } = resolveTsx();
const seedOut1 = sh(command, [...args, 'scripts/seed.ts'], {
  SEED_ADMIN_USERNAME: 'entryadmin',
  SEED_ADMIN_EMAIL: 'entryadmin@test.local',
  SEED_ADMIN_PASSWORD: 'entry-admin-password-12345',
  SEED_DEMO_USERS: '0',
  APP_RUNTIME_ENV: 'test',
  NODE_ENV: 'test',
});
console.log('  ' + seedOut1.trim().split('\n').join('\n  '));
const marker1 = await sql`SELECT value FROM kv_store WHERE key='seed:initialized'`;
const users1 = await sql`SELECT count(*)::int c FROM users`;
const topics1 = await sql`SELECT count(*)::int c FROM topics`;
console.log(`  初始化标记: ${JSON.stringify(marker1)} | 用户 ${users1[0].c} | 主题 ${topics1[0].c}`);

// 改口令模拟用户操作
await sql`UPDATE users SET password_hash='user-set-hash' WHERE username='entryadmin'`;
await sql`UPDATE users SET role='moderator' WHERE username='entryadmin'`;
const hashBefore = (await sql`SELECT password_hash, role FROM users WHERE username='entryadmin'`)[0];

// 阶段 2 再次运行（模拟再次启动）
console.log('--- 阶段 2: init（第二次启动 —— 应跳过）---');
const seedOut2 = sh(command, [...args, 'scripts/seed.ts'], {
  SEED_ADMIN_USERNAME: 'entryadmin',
  SEED_ADMIN_EMAIL: 'entryadmin@test.local',
  SEED_ADMIN_PASSWORD: 'entry-admin-password-12345',
  SEED_DEMO_USERS: '0',
  APP_RUNTIME_ENV: 'test',
  NODE_ENV: 'test',
});
console.log('  ' + seedOut2.trim().split('\n').join('\n  '));
const hashAfter = (await sql`SELECT password_hash, role FROM users WHERE username='entryadmin'`)[0];
const users2 = await sql`SELECT count(*)::int c FROM users`;
const topics2 = await sql`SELECT count(*)::int c FROM topics`;
console.log('  口令哈希未变:', hashBefore.password_hash === hashAfter.password_hash ? '✅' : '❌');
console.log('  角色未变:', hashBefore.role === hashAfter.role ? '✅' : '❌');
console.log(`  用户数 ${users1[0].c}→${users2[0].c} ${users1[0].c === users2[0].c ? '✅' : '❌'} | 主题数 ${topics1[0].c}→${topics2[0].c} ${topics1[0].c === topics2[0].c ? '✅' : '❌'}`);

// 阶段 1 再跑一次（幂等）
console.log('--- 阶段 1: migrate 重复执行（幂等性）---');
const migBefore = await sql`SELECT count(*)::int c FROM drizzle.__drizzle_migrations`;
sh(process.execPath, [repoRoot + '/node_modules/drizzle-kit/bin.cjs', 'migrate'], {});
const migAfter = await sql`SELECT count(*)::int c FROM drizzle.__drizzle_migrations`;
console.log(`  迁移记录数 ${migBefore[0].c}→${migAfter[0].c}`, migBefore[0].c === migAfter[0].c ? '✅ 幂等' : '❌');

// ===== A11: 备份恢复 =====
console.log('\n===== PROBE A11: 备份与恢复 =====');
const bdir = path.join(repoRoot, '.audit', 'backups');
rmSync(bdir, { recursive: true, force: true });
mkdirSync(bdir, { recursive: true });

// 用真实 pg_dump 做逻辑备份（复刻 deploy/backup.sh 的核心：pg_dump | gzip）
const dumpFile = path.join(bdir, `v2ex-${Date.now()}.sql.gz`);
console.log('  执行 pg_dump | gzip ...');
const { spawnSync } = await import('node:child_process');
const dump = spawnSync(
  path.join(PG_BIN, 'pg_dump.exe'),
  ['-h', '127.0.0.1', '-p', '5432', '-U', 'v2ex', '-d', DB, '--no-owner', '--no-acl', '-t', 'users', '-t', 'topics'],
  { env: { ...process.env, PGPASSWORD: 'v2ex_password' }, encoding: 'buffer' },
);
if (dump.status !== 0) {
  console.log('  ❌ pg_dump 失败:', dump.stderr.toString());
} else {
  const { gzipSync } = await import('node:zlib');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(dumpFile, gzipSync(dump.stdout));
  console.log('  ✅ 备份文件:', path.basename(dumpFile), (dump.stdout.length / 1024).toFixed(1) + 'KB');

  // 破坏数据：删掉所有用户
  await sql`DELETE FROM topics`;
  await sql`DELETE FROM users`;
  const after = await sql`SELECT count(*)::int c FROM users`;
  console.log('  已破坏数据 → users 表行数:', after[0].c);

  // 恢复
  const { gunzipSync } = await import('node:zlib');
  const restoreSql = gunzipSync(readFileSync(dumpFile)).toString();
  const { default: postgres } = await import('postgres');
  // 模拟 restore.sh 的 --single-transaction
  const restoreClient = postgres(URL, { prepare: false, max: 1 });
  await restoreClient.begin(async (tx) => {
    await tx.unsafe(restoreSql);
  });
  await restoreClient.end();
  const restored = await sql`SELECT count(*)::int c FROM users`;
  const restoredTopics = await sql`SELECT count(*)::int c FROM topics`;
  console.log(`  ✅ 恢复后 users=${restored[0].c} topics=${restoredTopics[0].c}`, restored[0].c === users1[0].c ? '✅ 数据完整' : '❌ 数据不完整');

  // 恢复的幂等性/可重复：再恢复一次
  try {
    const rc2 = postgres(URL, { prepare: false, max: 1 });
    await rc2.begin(async (tx) => { await tx.unsafe(restoreSql); });
    await rc2.end();
    const r2 = await sql`SELECT count(*)::int c FROM users`;
    console.log('  重复恢复 → users =', r2[0].c, r2[0].c === users1[0].c ? '✅ 幂等' : '❌');
  } catch (e) {
    console.log('  重复恢复抛错:', e.code || e.message, '（pg_dump --clean 未加 → 重复恢复会因主键冲突失败）');
  }

  // 中途失败回滚测试：注入语法错误
  console.log('  --- 中途失败回滚测试 ---');
  const broken = restoreSql + '\nSELECT * FROM definitely_not_a_table_xyz;\n';
  const rc3 = postgres(URL, { prepare: false, max: 1 });
  try {
    await rc3.begin(async (tx) => { await tx.unsafe(broken); });
    console.log('  ❌ 破损 SQL 竟然成功了');
  } catch (e) {
    console.log('  ✅ 破损 SQL 抛错（事务回滚）:', e.code || e.message.split('\n')[0]);
  } finally {
    await rc3.end();
  }
  const afterRollback = await sql`SELECT count(*)::int c FROM users`;
  console.log('  回滚后 users =', afterRollback[0].c, afterRollback[0].c === users1[0].c ? '✅ 数据未损坏' : '❌ 数据损坏');
}

// 清理
await sql.end();
await admin.unsafe(`DROP DATABASE IF EXISTS ${DB}`);
await admin.end();
console.log('\nprobe9 done');
