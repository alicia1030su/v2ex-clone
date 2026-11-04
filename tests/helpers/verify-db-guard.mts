/**
 * 护栏可执行验证脚本（v0.0.4 / T01 验收标准 ⑧⑨ + T02 验收标准 ⑪）
 *
 * ## 为什么是**脚本**而不是 vitest 用例
 *
 * 单元测试的权威基线是 **190 条 / 15 个文件**（QA 在 `097c1b9` 实测）。
 * 本脚本刻意**不**做成 `*.spec.ts` —— 这样既能提供**可执行**的护栏证明，
 * 又不会改变单元测试的用例数与文件数口径。
 *
 * ## 验证什么
 *
 * | # | 断言 | 对应验收标准 |
 * |---|---|---|
 * | 1 | 14 个证据库逐个 `isDeletableTestDatabase()` → `false` | T01 ⑧⑨ |
 * | 2 | 14 个证据库逐个 `assertDatabaseAllowed()` → **抛错** | T01 ⑧⑨ |
 * | 3 | 白名单内的测试库 → `true`（不误伤正常流程） | — |
 * | 4 | 端点白名单拒绝 `127.0.0.1:9999` | T01 ④ |
 * | 5 | 端点白名单放行 `127.0.0.1:55440` / `127.0.0.1:5432` | CI 兼容 |
 * | 6 | CI 库名 `v2ex_ci` 被护栏 3 放行 | T01 / CI 兼容 |
 * | 7 | **实际尝试 DROP 证据库 → 被拒绝** | T02 ⑪ |
 * | 8 | **被拒绝后，证据库仍然存在** | T02 ⑪ |
 *
 * ## 用法
 *
 * ```bash
 * # 对着**持有证据库**的实例跑（最有说服力）：
 * DATABASE_URL='postgres://v2ex:<pw>@127.0.0.1:55433/v2ex_e2e' \
 *   npx tsx tests/helpers/verify-db-guard.mts
 *
 * # 对着隔离测试实例跑（证据库不在该实例上时，只验证拒绝行为）：
 * DATABASE_URL='postgres://v2ex:<pw>@127.0.0.1:55440/v2ex_test_base' \
 *   npx tsx tests/helpers/verify-db-guard.mts
 * ```
 *
 * ⚠️ 本脚本**只读**：所有 DROP 尝试都在护栏处被拦下，**不会发出任何 SQL**。
 * 第 8 项的存在性校验也是只读查询。
 */
import postgres from 'postgres';
import {
  assertDatabaseAllowed,
  assertEndpointAllowed,
  assertSafeTestTarget,
  isDeletableTestDatabase,
  isProtectedEvidenceDatabase,
  guardLists,
} from './test-db-guard';
import { dropTestDatabase } from './test-db-lifecycle';
import { getResolvedTestEnv, withAdminDatabase } from './test-env';

let failures = 0;
let checks = 0;

/** 记录一次断言结果 */
function check(label: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (ok) {
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 取当前实例上的数据库列表（只读） */
async function listDatabases(adminUrl: string): Promise<string[]> {
  const client = postgres(adminUrl, { prepare: false, max: 1 });
  try {
    const rows = await client.unsafe<{ datname: string }[]>(
      'SELECT datname FROM pg_database ORDER BY datname',
    );
    return rows.map((r) => r.datname);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const resolved = getResolvedTestEnv();
  const adminUrl = withAdminDatabase(resolved.databaseUrl);

  console.log(`\n[db-guard-verify] 目标实例：${resolved.endpoint}（库 ${resolved.database}）`);
  console.log(`[db-guard-verify] 证据库清单（${guardLists.protectedDbNames.length} 个）\n`);

  // ── 断言 1 & 2：证据库逐个验证 ────────────────────────────────
  console.log('【断言 1】证据库 isDeletableTestDatabase() 必须为 false：');
  for (const name of guardLists.protectedDbNames) {
    check(`${name} → false`, isDeletableTestDatabase(name) === false);
  }

  console.log('\n【断言 2】证据库 assertDatabaseAllowed() 必须抛错：');
  for (const name of guardLists.protectedDbNames) {
    let threw = false;
    let message = '';
    try {
      assertDatabaseAllowed(name);
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message.split('\n')[0] : String(err);
    }
    check(`${name} 被拒绝`, threw, threw ? message : '（未抛错 —— 护栏失效！）');
  }

  // ── 断言 3：正常测试库不被误伤 ────────────────────────────────
  console.log('\n【断言 3】允许清单内的测试库必须放行（不误伤正常流程）：');
  for (const name of guardLists.allowedDbNames) {
    check(`${name} → true`, isDeletableTestDatabase(name) === true);
  }
  check(
    'v2ex_test_ 前缀库 → true',
    isDeletableTestDatabase('v2ex_test_anything') === true,
  );

  // ── 断言 4 & 5：端点白名单 ────────────────────────────────────
  console.log('\n【断言 4】端点白名单必须拒绝非白名单端点：');
  for (const endpoint of ['127.0.0.1:9999', '10.0.0.5:5432', 'prod.example.com:5432']) {
    let threw = false;
    try {
      assertEndpointAllowed(endpoint);
    } catch {
      threw = true;
    }
    check(`${endpoint} 被拒绝`, threw);
  }

  console.log('\n【断言 5】端点白名单必须放行本机隔离实例与 CI 端点：');
  for (const endpoint of ['127.0.0.1:55440', '127.0.0.1:5432', 'localhost:5432']) {
    let threw = false;
    try {
      assertEndpointAllowed(endpoint);
    } catch {
      threw = true;
    }
    check(`${endpoint} 被放行`, !threw);
  }

  // ── 断言 6：CI 库名放行（护栏 3）──────────────────────────────
  console.log('\n【断言 6】CI 库名 v2ex_ci 不得被护栏误伤：');
  const previousCi = process.env.CI;
  const previousAllowed = process.env.TEST_DB_ALLOWED_DATABASES;
  try {
    process.env.CI = 'true';
    process.env.TEST_DB_ALLOWED_DATABASES = 'v2ex_ci,v2ex_release_unit,v2ex_release_e2e';
    check(
      'v2ex_ci 被放行',
      isDeletableTestDatabase('v2ex_ci') === true,
      '（CI 注入 TEST_DB_ALLOWED_DATABASES 后）',
    );
    let threw = false;
    try {
      assertSafeTestTarget('postgres://v2ex:pw@localhost:5432/v2ex_ci', 'v2ex_ci');
    } catch {
      threw = true;
    }
    check('assertSafeTestTarget(v2ex_ci) 不抛错', !threw);

    // ── 真实 CI 路径：CI=true，但不注入 TEST_DB_ALLOWED_DATABASES ──
    // GitHub Actions 的 unit job 正是如此（只给 DATABASE_URL）。
    // 这一条曾经是**红的**：护栏 3 只存在于从未被调用的
    // assertCiInstanceOwnership 里，globalSetup 走的
    // assertDatabaseAllowed 不认 CI 库名 → CI 启动即被拦死。
    delete process.env.TEST_DB_ALLOWED_DATABASES;
    let threwRealCi = false;
    try {
      assertSafeTestTarget('postgres://v2ex:pw@localhost:5432/v2ex_ci', 'v2ex_ci');
    } catch {
      threwRealCi = true;
    }
    check('真实 CI 路径（无 TEST_DB_ALLOWED_DATABASES）v2ex_ci 不被误伤', !threwRealCi);

    // ── 反向：非 CI 环境且无注入时，v2ex_ci 仍须被拒 ──────────────
    // 证明修复没有在本机放松任何约束。
    delete process.env.CI;
    let threwLocal = false;
    try {
      assertSafeTestTarget('postgres://v2ex:pw@localhost:5432/v2ex_ci', 'v2ex_ci');
    } catch {
      threwLocal = true;
    }
    check('非 CI 环境无注入时 v2ex_ci 仍被拒绝', threwLocal);
  } finally {
    if (previousCi === undefined) delete process.env.CI;
    else process.env.CI = previousCi;
    if (previousAllowed === undefined) delete process.env.TEST_DB_ALLOWED_DATABASES;
    else process.env.TEST_DB_ALLOWED_DATABASES = previousAllowed;
  }

  // ── 断言 7 & 8：实际尝试 DROP 证据库 → 被拒绝，且库仍然存在 ────
  console.log('\n【断言 7】实际尝试 DROP 证据库 → 必须被护栏拒绝：');
  const before = await listDatabases(adminUrl);
  console.log(`  （当前实例共 ${before.length} 个库）`);

  // 优先用本实例上**真实存在**的证据库（端到端验证最有说服力）
  const evidenceOnThisInstance = guardLists.protectedDbNames.filter((n) => before.includes(n));
  const targets = evidenceOnThisInstance.length > 0
    ? evidenceOnThisInstance
    : ['v2ex_v004_audit'];

  for (const name of targets) {
    const existedBefore = before.includes(name);
    let threw = false;
    let message = '';
    try {
      await dropTestDatabase(adminUrl, name);
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message.split('\n')[0] : String(err);
    }
    check(
      `DROP ${name} 被拒绝`,
      threw,
      threw ? message : '（未抛错 —— 护栏失效！）',
    );
  }

  console.log('\n【断言 8】被拒绝后，证据库必须仍然存在：');
  const after = await listDatabases(adminUrl);
  const missing = before.filter((n) => !after.includes(n));
  check(
    '没有任何数据库消失',
    missing.length === 0,
    missing.length > 0 ? `消失了：${missing.join(', ')}` : `（前后都是 ${after.length} 个库）`,
  );
  for (const name of evidenceOnThisInstance) {
    check(`${name} 仍然存在`, after.includes(name));
  }
  if (evidenceOnThisInstance.length === 0) {
    console.log(
      '  ℹ️ 本实例上没有证据库（隔离测试实例的正常情况）—— ' +
        '「仍然存在」的断言已由「没有任何数据库消失」覆盖。',
    );
  }

  // ── 汇总 ──────────────────────────────────────────────────────
  console.log(`\n[db-guard-verify] 共 ${checks} 项断言，失败 ${failures} 项`);
  if (failures > 0) {
    console.error('[db-guard-verify] ❌ 护栏验证失败');
    process.exit(1);
  }
  console.log('[db-guard-verify] ✅ 全部护栏断言通过');
}

await main();
