/**
 * 防误连护栏 —— 三道硬失败断言（v0.0.4 / 问题 A）
 *
 * ## 为什么需要护栏
 *
 * 单元测试会在数据库上执行 `DROP DATABASE` / `CREATE DATABASE`。
 * 一旦目标解析错了（连到开发库 / 生产库 / 证据库），后果是**数据丢失**，
 * 而且这类错误在旧实现下是**静默**的 —— 测试照常「通过」，只是把开发库删了。
 *
 * 因此护栏必须在**发出任何 SQL 之前**失败，且失败信息要能一眼看懂。
 *
 * ## 三道护栏
 *
 * | # | 护栏 | 作用范围 | 拦截什么 |
 * |---|---|---|---|
 * | 1 | **端点白名单** | 连接前 | 连到不在白名单的实例（如生产库） |
 * | 2 | **库名精确枚举 + 证据库拒绝名单** | 跨端点 | 删/建不在清单里的库 |
 * | 3 | **CI 实例归属校验** | CI 环境 | CI 的库名不被护栏 2 误伤 |
 *
 * ## ⚠️ 为什么护栏 2 用**精确枚举**而不是前缀通配
 *
 * 设计文档初稿曾用 `^v2ex_(test|v003|v004|floorcont|seedtest|rateclear|admintest|floortest)`
 * 这类前缀正则做清理筛选。**实测证明它会误伤证据库**：
 *
 * - `v2ex_v004_audit` 命中 `v2ex_v004` 分支 → 会被删除，
 *   但它是 `docs/UPGRADE_RECOVERY_v0.0.4.md` §1.1 列出的**升级审计证据库**；
 * - `v2ex_e2e_v004`、`v2ex_mig_v004`、`v2ex_upg_v004_*` 同理 —— 它们都带版本号，
 *   前缀通配把「版本号前缀」误当成了「测试库命名空间」。
 *
 * 因此最终实现是**双层判定**：
 * 第 1 层 `PROTECTED_DB_NAMES`（证据库）→ **无条件豁免**；
 * 第 2 层 `ALLOWED_DB_NAMES`（精确枚举）+ `v2ex_test_` 保留前缀。
 *
 * @see docs/TEST_ENV_ISOLATION_v0.0.4.md §3.5
 */

/**
 * 允许连接的端点白名单
 *
 * - 默认仅本机隔离测试实例 `127.0.0.1:55440`；
 * - `127.0.0.1:5432` **默认放行**（CI 的 service container 固定用 5432，
 *   不放行会让 CI 全红）。真正的防线是护栏 2（库名判定跨端点生效）。
 * - 可用 `TEST_DB_ALLOWED_ENDPOINTS` 覆盖（逗号分隔）。
 */
const DEFAULT_ALLOWED_ENDPOINTS = ['127.0.0.1:55440', '127.0.0.1:5432', 'localhost:5432'];

/** 允许被 DROP / CREATE 的库名 —— **精确枚举**（不使用前缀通配） */
const ALLOWED_DB_NAMES = new Set([
  'v2ex_admintest',
  'v2ex_v003_admin',
  'v2ex_v003_content',
  'v2ex_v003_credits',
  'v2ex_v003_feed',
  'v2ex_v003_reset',
  'v2ex_floorcont_v004',
  'v2ex_floortest',
  'v2ex_rateclear',
  'v2ex_seedtest',
  'v2ex_readiness_probe', // §4.7.1 判据 B 的就绪探针库
  'v2ex_v005_reports', // v0.0.5 举报系统 + 管理员积分调整
  'v2ex_v005_floor', // v0.0.5 楼层号 100 并发与编号稳定性
  'v2ex_v005_search', // v0.0.5 搜索方案实测对比
  'v2ex_v014_tags', // v0.0.14 标签落库（唯一约束收敛 / 追加语义 / 并发）
]);

/** 新增测试库的保留前缀（比枚举更灵活，但必须带 `v2ex_test_` 前缀） */
const ALLOWED_DB_PREFIXES = ['v2ex_test_'];

/**
 * 证据库拒绝名单 —— **即使被前缀规则命中也一律拒绝删除**
 *
 * 这些库是 v0.0.4 的一手证据：负载测试数据、升级基线、发布验证、
 * 视觉对照基线、E2E 用库、升级/恢复演练现场、QA 幂等验证现场。
 * **任何情况下不得由测试清理脚本删除。**
 */
const PROTECTED_DB_NAMES = new Set([
  'v2ex_loadtest', // 890MB —— 负载测试数据（主理人明确「不可动」）
  'v2ex_v002_baseline', // v0.0.2 → v0.0.4 升级验证基线
  'v2ex_release_v001', // 发布验证证据
  'v2ex_visual', // 视觉对照基线
  'v2ex_e2e', // E2E 用库（主理人明确「不可动」）
  'v2ex_e2e_v004', // E2E 用库（主理人明确「不可动」）
  'v2ex_upg_v004_fresh', // 全新安装演练现场
  'v2ex_upg_v004_old', // 旧版本升级源
  'v2ex_upg_v004_restore', // 备份恢复目标
  'v2ex_upgrade_src', // 升级源库
  'v2ex_mig_idem', // 迁移幂等验证现场
  'v2ex_mig_v004', // 迁移验证现场
  'v2ex_v004_audit', // 升级审计证据库
  'v2ex_qa_migidem_v004', // QA 迁移幂等验证现场
]);

/**
 * CI 环境的库名 —— 护栏 3
 *
 * CI 的 `DATABASE_URL` 指向下列库名，它们不在上面的精确枚举里。
 * 护栏 3 负责让 CI 通过，同时**不放松**本机环境的任何约束。
 *
 * | 库名 | 来源 |
 * |---|---|
 * | `v2ex_ci` | `.github/workflows/ci.yml` 的 unit / e2e job（service container） |
 * | `v2ex_release_unit` | `.github/workflows/release.yml` 的 unit-tests job |
 * | `v2ex_release_e2e` | `.github/workflows/release.yml` 的 e2e-tests job |
 *
 * ⚠️ v0.0.4 修正：此前只列了 `v2ex_ci`，
 * 于是 **release.yml 的单元测试 job 会在「建基础库」之前被护栏 2 拦死**
 * （run `41954236858` 实测红灯）。而该错误又被 vitest 的错误格式化器
 * 崩溃（`TypeError: code.charCodeAt is not a function`）掩盖，
 * 报出来的是一句完全看不懂的 Startup Error —— 真实原因被藏住了。
 *
 * 这三个库名**只可能是 CI 的 service container**（本机实例用的是
 * `v2ex_test_base` 与 `v2ex_*` 白名单里的名字），且判据是 `process.env.CI`
 * 为真才生效 ⇒ 本机不设 `CI` 时，约束一丝不放宽。
 */
const CI_DATABASE_NAMES = new Set(['v2ex_ci', 'v2ex_release_unit', 'v2ex_release_e2e']);

/** 解析端点白名单（每次调用都重算 —— 便于测试注入环境变量） */
function allowedEndpoints(): Set<string> {
  const raw = process.env.TEST_DB_ALLOWED_ENDPOINTS;
  const list = raw
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ENDPOINTS;
  return new Set(list);
}

/** 解析额外的允许库名（CI 注入 `TEST_DB_ALLOWED_DATABASES`，逗号分隔） */
function extraAllowedDatabases(): Set<string> {
  const raw = process.env.TEST_DB_ALLOWED_DATABASES;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * 判定一个库名是否属于**受保护的证据库**
 *
 * 证据库无条件豁免 —— 这是护栏 2 的第 1 层。
 */
export function isProtectedEvidenceDatabase(dbName: string): boolean {
  if (PROTECTED_DB_NAMES.has(dbName)) return true;
  // CI 的库名走「允许」路线，不属于证据库
  return false;
}

/**
 * 判定一个库名是否允许被测试清理脚本删除（**唯一权威判定**）
 *
 * 第 1 层：证据库拒绝名单优先 —— 证据库无条件豁免；
 * 第 2 层：精确枚举；
 * 第 3 层：保留前缀（`v2ex_test_`）。
 */
export function isDeletableTestDatabase(dbName: string): boolean {
  // 第 1 层：拒绝名单优先 —— 证据库无条件豁免
  if (isProtectedEvidenceDatabase(dbName)) return false;
  // 第 2 层：精确枚举
  if (ALLOWED_DB_NAMES.has(dbName)) return true;
  // CI 注入的额外允许库名（护栏 3）
  if (extraAllowedDatabases().has(dbName)) return true;
  // 第 3 层：保留前缀
  return ALLOWED_DB_PREFIXES.some((p) => dbName.startsWith(p));
}

/**
 * 护栏 1：端点白名单断言
 *
 * @throws 端点不在白名单时抛错
 */
export function assertEndpointAllowed(endpoint: string): void {
  const allowed = allowedEndpoints();
  if (allowed.has(endpoint)) return;
  throw new Error(
    `[db-guard] 拒绝连接：端点 ${endpoint} 不在白名单内。\n` +
      `  允许的端点：${[...allowed].join(', ')}\n` +
      `  单元测试绝不允许连接开发库或生产库。\n` +
      `  如需新增端点，设置环境变量 TEST_DB_ALLOWED_ENDPOINTS（逗号分隔）。`,
  );
}

/**
 * 护栏 2：库名强制断言（**跨端点生效**）
 *
 * @throws 库名不在清单内、或属于受保护证据库时抛错
 */
export function assertDatabaseAllowed(dbName: string): void {
  if (isDeletableTestDatabase(dbName)) return;

  // ── 护栏 3 落地：CI 的库名不得被护栏 2 误伤 ──────────────────────
  //
  // 设计文档早已规定「CI 的库名走允许路线，不属于证据库」，但此前只有
  // `assertCiInstanceOwnership` 记得这件事 —— 而它在关键路径上
  // （globalSetup → ensureBaseDatabaseExists → assertDatabaseAllowed）
  // **从未被调用**。GitHub Actions 的 unit job 只注入 `DATABASE_URL`
  // （指向 `v2ex_ci`），**不**注入 `TEST_DB_ALLOWED_DATABASES`，于是
  // CI 一启动就在「建基础库」之前被护栏 2 拦死（本机等价场景同样复现）。
  //
  // 判据用 `process.env.CI`（GitHub Actions 恒为 `true`；本机等价场景
  // 同样显式设置）—— 本机不设 `CI` 时，约束一丝不放宽。
  if (process.env.CI && CI_DATABASE_NAMES.has(dbName)) return;

  if (isProtectedEvidenceDatabase(dbName)) {
    throw new Error(
      `[db-guard] 拒绝操作数据库 ${dbName}：它是**受保护的证据库**，永不删除。\n` +
        `  证据库清单（${PROTECTED_DB_NAMES.size} 个）包含负载测试数据、升级基线、` +
        `发布验证、视觉基线、E2E 用库与升级/恢复演练现场。\n` +
        `  ⚠️ 若你认为这个判定有误，请修改 ` +
        `tests/helpers/test-db-guard.ts 的 PROTECTED_DB_NAMES，**不要**绕过护栏。`,
    );
  }

  throw new Error(
    `[db-guard] 拒绝操作数据库 ${dbName}：不在允许的测试库清单内。\n` +
      `  允许的精确枚举：${[...ALLOWED_DB_NAMES].join(', ')}\n` +
      `  允许的保留前缀：${ALLOWED_DB_PREFIXES.join(', ')}\n` +
      `  CI 额外允许：${[...extraAllowedDatabases()].join(', ') || '(无)'}\n` +
      `  如需新增测试库，请修改 tests/helpers/test-db-guard.ts 的 ALLOWED_DB_NAMES。`,
  );
}

/**
 * 护栏 1 + 护栏 2 组合断言 —— **在任何 SQL 发出之前**调用
 *
 * @param databaseUrl 目标连接串
 * @param dbName 目标库名
 * @throws 端点或库名不满足条件时抛错
 */
export function assertSafeTestTarget(databaseUrl: string, dbName: string): void {
  const u = new URL(databaseUrl);
  const endpoint = `${u.hostname}:${u.port || '5432'}`;
  assertEndpointAllowed(endpoint);
  assertDatabaseAllowed(dbName);
}

/**
 * 护栏 3：CI 环境实例归属校验
 *
 * CI 的 `DATABASE_URL` 指向 `v2ex_ci`（service container，端口固定 5432）。
 * 本函数确认：
 *  1. 当前确实是 CI 环境（`process.env.CI` 为真）；
 *  2. CI 的库名被护栏 2 放行 —— 否则 CI 会在建库前就被护栏拦死。
 *
 * @returns CI 归属校验是否通过（非 CI 环境恒返回 true）
 */
export function assertCiInstanceOwnership(databaseUrl: string, dbName: string): boolean {
  if (!process.env.CI) return true;

  const u = new URL(databaseUrl);
  const endpoint = `${u.hostname}:${u.port || '5432'}`;
  const ciNames = new Set<string>([...CI_DATABASE_NAMES, ...extraAllowedDatabases()]);

  if (ciNames.has(dbName)) return true;

  // CI 里用非 CI 库名也可以（各 spec 有自己的专用库），只要护栏 2 放行
  if (isDeletableTestDatabase(dbName)) return true;

  throw new Error(
    `[db-guard] CI 实例归属校验失败：CI 环境下的库名 ${dbName} 既不在 CI 允许清单` +
      `（${[...ciNames].join(', ')}）内，也不在测试库允许清单内。\n` +
      `  端点：${endpoint}\n` +
      `  请在 CI 的 unit job 里设置 TEST_DB_ALLOWED_DATABASES，列出该 job 会用到的库名。`,
  );
}

/** 导出清单，供测试与脚本引用（只读快照） */
export const guardLists = {
  allowedEndpoints: DEFAULT_ALLOWED_ENDPOINTS,
  allowedDbNames: [...ALLOWED_DB_NAMES],
  allowedDbPrefixes: ALLOWED_DB_PREFIXES,
  protectedDbNames: [...PROTECTED_DB_NAMES],
  ciDatabaseNames: [...CI_DATABASE_NAMES],
} as const;
