/**
 * 压测数据生成器 —— 批量生成大规模、可重复的论坛数据集
 *
 * ⚠️ 危险脚本：只能在**隔离的压测库**上运行。
 *   脚本默认拒绝写入库名不含 loadtest / perf / stress / bench 的数据库，
 *   除非显式加 `--allow-any-db`。生产库请不要运行本脚本。
 *
 * 设计要点
 * ---------------------------------------------------------------------------
 * 1. 批量 INSERT：全部走 `INSERT ... SELECT ... FROM generate_series(...)`，
 *    100 万条回复不需要几小时，而是几十秒。
 * 2. 可重复（deterministic）：所有随机性来自 `seed` 参数派生的**确定性哈希**
 *    （md5(seed || ':' || key)），同一 seed 永远产出同一数据集。
 *    不依赖 `random()` / `setseed()`（后者的行为随 PG 版本漂移）。
 *    唯一的例外是 `users.password_hash`（含随机盐，见 README）。
 * 3. 单事务：整个生成过程在**一个事务**内完成 —— 中断即全部回滚，
 *    不会留下半截数据。重跑要么完整重做，要么（配合 --truncate）先清空。
 * 4. 遵守业务约束：floor 唯一、replies_count 只计未删除回复、
 *    credit_ledger 流水自洽、nodes.parent_id 无环、软删除比例约 5%。
 *
 * 运行：
 *   npx tsx scripts/loadtest/seed-large.ts \
 *     --users=10000 --nodes=1000 --topics=100000 --replies=1000000 \
 *     --seed=20261104 --db=postgres://... --batch=5000 --truncate
 *
 * 冒烟模式（几秒跑完）：
 *   npx tsx scripts/loadtest/seed-large.ts \
 *     --users=100 --nodes=10 --topics=1000 --replies=5000 \
 *     --db=postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_loadtest --truncate
 */
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { hashPassword, verifyPassword } from '../../src/lib/password';

// ---------------------------------------------------------------------------
// 环境变量
// ---------------------------------------------------------------------------

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

// ---------------------------------------------------------------------------
// 命令行参数
// ---------------------------------------------------------------------------

export type Options = {
  users: number;
  nodes: number;
  topics: number;
  replies: number;
  seed: number;
  db: string;
  batch: number;
  truncate: boolean;
  allowAnyDb: boolean;
  help: boolean;
};

const DEFAULTS = {
  users: 10000,
  nodes: 1000,
  topics: 100000,
  replies: 1000000,
  seed: 20261104,
  batch: 5000,
};

const USAGE = `
压测数据生成器 —— v2ex-clone

用法:
  npx tsx scripts/loadtest/seed-large.ts [选项]

选项:
  --users=N          用户数量          (默认 ${DEFAULTS.users})
  --nodes=N          节点数量          (默认 ${DEFAULTS.nodes})
  --topics=N         主题数量          (默认 ${DEFAULTS.topics})
  --replies=N        回复数量          (默认 ${DEFAULTS.replies})
  --seed=N           随机种子（决定数据集） (默认 ${DEFAULTS.seed})
  --db=URL           PostgreSQL 连接串（缺省读环境变量 DATABASE_URL）
  --batch=N          每批插入的回复条数  (默认 ${DEFAULTS.batch})
  --truncate         生成前清空目标库的所有表（会打印警告）
  --allow-any-db     允许写入库名不含 loadtest/perf/stress/bench 的数据库
  --help             显示本帮助

示例（冒烟模式，几秒完成）:
  npx tsx scripts/loadtest/seed-large.ts \\
    --users=100 --nodes=10 --topics=1000 --replies=5000 \\
    --db=postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_loadtest --truncate

示例（完整规模）:
  npx tsx scripts/loadtest/seed-large.ts \\
    --users=10000 --nodes=1000 --topics=100000 --replies=1000000 \\
    --seed=20261104 --db=postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_loadtest \\
    --batch=5000 --truncate
`.trim();

/** 允许写入的库名关键字（--allow-any-db 可放宽） */
const SAFE_DB_NAME_PATTERNS = ['loadtest', 'perf', 'stress', 'bench'];

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    users: DEFAULTS.users,
    nodes: DEFAULTS.nodes,
    topics: DEFAULTS.topics,
    replies: DEFAULTS.replies,
    seed: DEFAULTS.seed,
    db: '',
    batch: DEFAULTS.batch,
    truncate: false,
    allowAnyDb: false,
    help: false,
  };

  for (const raw of argv) {
    const arg = raw.trim();
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--truncate') {
      opts.truncate = true;
      continue;
    }
    if (arg === '--allow-any-db') {
      opts.allowAnyDb = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`无法识别的参数：${arg}`);
    }

    const eq = arg.indexOf('=');
    if (eq === -1) {
      throw new Error(`参数必须写成 --name=value 形式：${arg}`);
    }
    const key = arg.slice(2, eq);
    const value = arg.slice(eq + 1);

    switch (key) {
      case 'users':
      case 'nodes':
      case 'topics':
      case 'replies':
      case 'seed':
      case 'batch':
        opts[key] = parseIntStrict(value, key);
        break;
      case 'db':
        opts.db = value;
        break;
      default:
        throw new Error(`未知参数：--${key}`);
    }
  }

  return opts;
}

/** 严格整数解析：拒绝 "12abc" / "1.5" / "" / "0x10" */
function parseIntStrict(value: string, name: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`--${name} 必须是整数，收到 "${value}"`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`--${name} 超出安全整数范围：${value}`);
  }
  return n;
}

/** 校验参数；不合法直接退出 */
function validate(opts: Options): void {
  const errors: string[] = [];

  if (!Number.isInteger(opts.users) || opts.users < 1) {
    errors.push('--users 必须是 ≥1 的整数');
  }
  if (!Number.isInteger(opts.nodes) || opts.nodes < 1) {
    errors.push('--nodes 必须是 ≥1 的整数');
  }
  if (!Number.isInteger(opts.topics) || opts.topics < 1) {
    errors.push('--topics 必须是 ≥1 的整数');
  }
  if (!Number.isInteger(opts.replies) || opts.replies < 0) {
    errors.push('--replies 必须是 ≥0 的整数');
  }
  if (!Number.isInteger(opts.seed)) {
    errors.push('--seed 必须是整数');
  }
  if (!Number.isInteger(opts.batch) || opts.batch < 1) {
    errors.push('--batch 必须是 ≥1 的整数');
  }
  if (opts.batch > 200000) {
    errors.push('--batch 过大（上限 200000）');
  }
  // replies 必须 ≥ topics（每个主题至少 1 条回复，否则 floor 无从分配）
  if (opts.replies < opts.topics) {
    errors.push('--replies 不能小于 --topics（每个主题至少 1 条回复）');
  }

  if (errors.length > 0) {
    throw new Error(`参数校验失败：\n  - ${errors.join('\n  - ')}`);
  }
}

/** 从连接串里取出库名（用于安全检查与日志） */
function dbNameOf(url: string): string {
  try {
    const u = new URL(url);
    const name = u.pathname.replace(/^\//, '');
    return name || '(默认库)';
  } catch {
    return '(无法解析)';
  }
}

function safeHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}`;
  } catch {
    return '(未知主机)';
  }
}

function maskPassword(url: string): string {
  return url.replace(/\/\/([^:/?#]+):([^@]*)@/, (_m, user: string) => `//${user}:***@`);
}

// ---------------------------------------------------------------------------
// 表清单
// ---------------------------------------------------------------------------

/** TRUNCATE 顺序 + 统计输出范围 */
const TABLES = [
  'login_attempts',
  'rate_limit_buckets',
  'kv_store',
  'email_logs',
  'password_reset_tokens',
  'edit_history',
  'moderation_logs',
  'reports',
  'node_requests',
  'avatars',
  'daily_checkins',
  'credit_ledger',
  'sessions',
  'notifications',
  'thanks',
  'votes',
  'collections',
  'follows',
  'floor_counters',
  'topic_tags',
  'tags',
  'replies',
  'topics',
  'nodes',
  'categories',
  'users',
] as const;

/** 「主表」：非空时不允许直接写入（除非 --truncate） */
const MAIN_TABLES = ['users', 'categories', 'nodes', 'topics', 'replies'] as const;

/** 引用双引号（表名来自本文件的常量，无注入风险） */
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

// ---------------------------------------------------------------------------
// 业务常量
// ---------------------------------------------------------------------------

/** 软删除比例（约 5%） */
const SOFT_DELETE_RATE = 0.05;

/** 分类定义 */
const CATEGORIES: Array<[name: string, title: string, sort: number]> = [
  ['tech', '技术', 1],
  ['create', '创意', 2],
  ['life', '生活', 3],
  ['play', '好玩', 4],
  ['apple', 'Apple', 5],
  ['jobs', '酷工作', 6],
  ['deals', '交易', 7],
  ['city', '城市', 8],
  ['qna', '问与答', 9],
];

/** 主题标题片段 */
const TITLE_PREFIXES = [
  '分享', '讨论', '求推荐', '求助', '吐槽', '经验', '实测', '对比', '选型',
  '踩坑', '源码', '性能', '重构', '学习', '面试', '招聘', '二手', '报价',
];
const TITLE_SUBJECTS = [
  '这个方案到底值不值',
  '有没有更省心的替代品',
  '线上环境的三个坑',
  '从零搭建一套工作流',
  '生产事故复盘记录',
  '为什么大家的实现都不一样',
  '本地跑通之后的几点体会',
  '关于这个生态的一些看法',
  '新的版本带来了什么变化',
  '如何把响应时间压到 100ms',
];
const TITLE_SUFFIXES = ['（长文）', '（经验帖）', '（求拍砖）', '（2024）', '（更新）', ''];

/** 回复内容片段 */
const REPLY_SNIPPETS = [
  '同问，蹲一个答案。',
  '我们线上就是这么做的，跑了两年没出问题。',
  '不太同意楼主说的，实践中瓶颈在别的地方。',
  '补充一个细节：记得先做灰度。',
  '感谢分享，正好在找这个。',
  '这个方案我试过，配置比想象的复杂一些。',
  '建议先在小规模上验证一下再推广。',
  '有遇到过类似的问题，最后是清缓存重装解决的。',
  '已经加到我的清单里了。',
  '楼上说得对，我遇到过一模一样的情况。',
];

/** 与 src/lib/credit-service.ts 的默认额度保持一致 */
const CREDIT = {
  registration: 100,
  topic: 5,
  reply: 2,
  checkin: 2,
  streakBonus: 1,
};

// ---------------------------------------------------------------------------
// 确定性伪随机（SQL 侧）
// ---------------------------------------------------------------------------
//
// 在 PostgreSQL 侧用 md5 哈希做确定性随机：
//   h = md5(seed || ':' || key)
//   r = h 的前 8 位十六进制当作有符号 32 位整数，映射到 [0,1)
//
// 优点：
//  - 完全确定：同一 (seed, key) 永远得到同一 r，与 PG 版本 / 会话 / 批次无关
//  - 无需 setseed()（setseed 的行为在不同 PG 版本间会漂移）
//  - 可在 SQL 里自由组合：r('u:'||i)、r('t:'||i) 等
class Rnd {
  constructor(private readonly seed: number) {}

  /**
   * [0,1) 的确定性随机值。
   *
   * 注意：整个表达式必须用括号包住 —— 否则 `interval '2 years' * R / Y`
   * 会按左结合解析成 `(interval * R) / Y`，中间结果溢出成「interval 超出范围」。
   */
  expr(keyExpr: string): string {
    return (
      `((('x' || substr(md5(${this.seed}::text || ':' || ${keyExpr}), 1, 8))` +
      `::bit(32)::int + 2147483648.0) / 4294967296.0)`
    );
  }

  /** [lo, hi] 闭区间内的确定性整数 */
  int(keyExpr: string, lo: number, hi: number): string {
    return `${lo} + floor(${this.expr(keyExpr)} * ${hi - lo + 1})::int`;
  }

  /**
   * 幂律（Zipf 近似）整数：偏向小值。
   *
   * 压测需要**长尾分布** —— 真实的论坛里少数「水军」账号贡献绝大部分内容。
   * 均匀分布会让所有查询计划看起来都很好，掩盖真实的热点行竞争。
   *
   * 实现：u ∈ [0,1)，取 u^alpha 后映射到 [1, n]。
   * alpha 越大越集中（alpha=1 已经是轻微偏斜，alpha=3 相当集中）。
   */
  zipf(keyExpr: string, n: number, alpha: number): string {
    const u = this.expr(keyExpr);
    return `greatest(1, least(${n}, 1 + floor(power(${u}, ${alpha}) * ${n})))`;
  }
}

/**
 * 时间锚点 —— 决定性的「现在」。
 *
 * 用固定锚点而不是 `now()`：否则同一 seed 两次运行的时间戳会差几毫秒，
 * 数据集就不是可重复的了。
 *
 * 锚点由 **seed 本身** 派生：把 seed 当作 YYYYMMDD 解析成一个日期
 * （例如默认 seed 20261104 → 2026-11-04）。数据集的所有时间戳都落在
 * [锚点 - 2 年, 锚点] 区间内。
 *
 * 想让「过去 2 年」对齐真实时间，就把 seed 设成今天的日期（YYYYMMDD）。
 */
function resolveAnchor(seed: number): { iso: string; date: string } {
  let y = Math.floor(seed / 10000);
  let m = Math.floor(seed / 100) % 100;
  let d = seed % 100;
  // seed 不是合法 YYYYMMDD 时退回到一个固定日期（仍然完全确定）
  if (y < 1970 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) {
    y = 2026;
    m = 11;
    d = 4;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`--seed ${seed} 无法解析为有效日期（期望 YYYYMMDD）`);
  }
  const iso = dt.toISOString();
  return { iso, date: iso.slice(0, 10) };
}

/** 把 ISO 时间戳渲染成 PostgreSQL 字面量 */
function tsLiteral(iso: string): string {
  return `TIMESTAMPTZ '${iso}'`;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

type Stat = {
  table: string;
  actual: number;
  target: number | null;
  checksum: string | null;
};

/** 用于校验「数据是否确定性」的指纹（不含 password_hash 的随机盐） */
const CHECKSUM_TABLES = ['users', 'topics', 'replies', 'nodes'] as const;

async function main(): Promise<void> {
  let opts: Options;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`✗ ${(err as Error).message}\n`);
    console.error(USAGE);
    process.exit(2);
  }

  if (opts.help) {
    console.log(USAGE);
    return;
  }

  try {
    validate(opts);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}\n`);
    console.error(USAGE);
    process.exit(2);
  }

  // --db 缺省读 DATABASE_URL
  const dbUrl = opts.db.trim() || (process.env.DATABASE_URL ?? '').trim();
  if (!dbUrl) {
    console.error('✗ 未指定数据库：请用 --db=... 或设置环境变量 DATABASE_URL\n');
    console.error(USAGE);
    process.exit(2);
  }
  opts.db = dbUrl;

  const dbName = dbNameOf(dbUrl);
  const host = safeHost(dbUrl);
  const anchor = resolveAnchor(opts.seed);

  // ---- 安全闸门：绝不写入开发库 / 生产库 ----
  const lowerName = dbName.toLowerCase();
  const looksSafe = SAFE_DB_NAME_PATTERNS.some((p) => lowerName.includes(p));
  if (!looksSafe && !opts.allowAnyDb) {
    console.error(
      `✗ 拒绝执行：目标库 "${dbName}"（${host}）的库名不含 ` +
        `${SAFE_DB_NAME_PATTERNS.map((p) => `"${p}"`).join(' / ')}。\n` +
        '  本脚本只允许写入隔离的压测库。\n' +
        '  如果你确认这是一个隔离的临时库，可以加 --allow-any-db 强制执行。',
    );
    process.exit(3);
  }

  console.log('▶ 压测数据生成器');
  console.log(`  目标数据库 : ${dbName}  (${host})`);
  console.log(`  完整连接串 : ${maskPassword(dbUrl)}`);
  console.log(
    `  目标规模   : users=${opts.users}  nodes=${opts.nodes}  ` +
      `topics=${opts.topics}  replies=${opts.replies}`,
  );
  console.log(`  seed       : ${opts.seed}`);
  console.log(`  时间锚点   : ${anchor.iso}（所有时间戳基于它，保证可重复）`);
  console.log(`  batch      : ${opts.batch}`);

  if (opts.truncate) {
    console.log('');
    console.log('  ⚠⚠⚠  警告：--truncate 已指定，即将清空目标库的全部业务表  ⚠⚠⚠');
    console.log(`     目标库：${dbName}（${host}）`);
    console.log(`     清空范围：${TABLES.length} 张表（业务数据将全部丢失）`);
    console.log('');
  }

  const sql = postgres(dbUrl, {
    max: 4,
    idle_timeout: 30,
    connect_timeout: 15,
    prepare: false,
  });

  const startedAt = Date.now();
  const timers: Array<{ step: string; ms: number }> = [];
  let batches = 0;
  let replyWritten = 0;

  try {
    // 校验 schema 是否已迁移
    const schemaOk = await sql.unsafe(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('users','topics','replies','nodes')`,
    );
    if (Number(schemaOk[0]?.n ?? 0) < 4) {
      throw new Error(
        '目标库缺少业务表（users/topics/replies/nodes）。请先对该库执行迁移：\n' +
          '  DATABASE_URL=<该库> npx drizzle-kit migrate',
      );
    }

    await sql.begin(async (tx) => {
      // ---- 0. TRUNCATE ----
      if (opts.truncate) {
        const t0 = Date.now();
        await tx.unsafe(
          `TRUNCATE TABLE ${TABLES.map((t) => q(t)).join(', ')} RESTART IDENTITY CASCADE`,
        );
        timers.push({ step: 'truncate', ms: Date.now() - t0 });
        console.log(`  ✓ 已清空 ${TABLES.length} 张表`);
      } else {
        // 不清空时要求主表为空 —— 避免在已有数据上叠加导致行数对不上
        const rows = await tx.unsafe(
          `SELECT ${MAIN_TABLES.map((t) => `(SELECT count(*)::int FROM ${q(t)})`).join(', ')}`,
        );
        const counts = Object.keys(rows[0] as Record<string, number>);
        const nonEmpty = counts.filter((c) => Number((rows[0] as Record<string, number>)[c]) > 0);
        if (nonEmpty.length > 0) {
          throw new Error(
            `目标库已有数据（${nonEmpty.join(', ')} 非空）。\n` +
              '  请加 --truncate 先清空，或换一个空库 —— 否则行数与目标值对不上。',
          );
        }
      }

      const rnd = new Rnd(opts.seed);
      // 时间锚点（决定性的「现在」）—— 所有时间戳都基于它，而非 now()
      const ANCHOR = tsLiteral(anchor.iso);

      // ---- 1. 密码哈希 ----
      // 10000 个用户只复用 5 个哈希值：scrypt 很贵，生成 5 次就够了。
      // 详见 README「密码哈希复用」一节。
      const tHash = Date.now();
      const passwordHashes: string[] = [];
      for (let i = 0; i < 5; i++) {
        const h = hashPassword(`loadtest-password-${opts.seed}-${i}`);
        // 自检：确保生成的是合法哈希（verifyPassword 能通过）
        if (!verifyPassword(`loadtest-password-${opts.seed}-${i}`, h)) {
          throw new Error('生成的 password_hash 未通过 verifyPassword 自检');
        }
        passwordHashes.push(h);
      }
      timers.push({ step: 'password hash', ms: Date.now() - tHash });

      // ---- 2. categories ----
      const tCat = Date.now();
      await tx.unsafe(
        `INSERT INTO categories (name, title, sort, created_at)
         SELECT c.name, c.title, c.sort, ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'cat:' || c.name`)})
         FROM (VALUES ${CATEGORIES.map(
           ([name, title, sort]) => `(${literal(name)}, ${literal(title)}, ${sort})`,
         ).join(', ')}) AS c(name, title, sort)
         WHERE NOT EXISTS (SELECT 1 FROM categories e WHERE e.name = c.name)`,
      );
      timers.push({ step: 'categories', ms: Date.now() - tCat });
      console.log(`  ✓ categories: ${CATEGORIES.length}`);

      // ---- 3. users ----
      const tUsers = Date.now();
      const hashCase = `CASE ((g - 1) % ${passwordHashes.length}) ${passwordHashes
        .map((h, i) => `WHEN ${i} THEN ${literal(h)}`)
        .join(' ')} END`;

      await tx.unsafe(
        `INSERT INTO users (
           id, username, password_hash, email, avatar, tagline, bio, url, location,
           role, status, balance, created_at, last_active_at
         )
         SELECT
           g,
           'lt_' || lpad(g::text, 6, '0'),
           ${hashCase},
           'lt_' || lpad(g::text, 6, '0') || '@loadtest.invalid',
           '/uploads/avatars/seed/' || (g % 50) || '.png',
           '压测用户 #' || g,
           '这是压测数据集自动生成的第 ' || g || ' 号用户，bio 用于填充详情页长度。',
           CASE WHEN g % 4 = 0 THEN 'https://example.invalid/user/' || g ELSE NULL END,
           CASE WHEN g % 3 = 0
             THEN (ARRAY['北京','上海','深圳','杭州','成都'])[1 + (g % 5)] ELSE NULL END,
           CASE
             WHEN g = 1 THEN 'admin'::user_role
             WHEN g <= 6 THEN 'moderator'::user_role
             ELSE 'user'::user_role
           END,
           CASE
             WHEN g % 200 = 0 THEN 'suspended'::user_status
             WHEN g % 500 = 0 THEN 'banned'::user_status
             ELSE 'active'::user_status
           END,
           0,
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'user:' || g`)}),
           ${ANCHOR} - (interval '30 days' * ${rnd.expr(`'active:' || g`)})
         FROM generate_series(1, ${opts.users}) AS s(g)`,
      );
      await resyncSequence(tx, 'users', opts.users);
      await assertDenseIds(tx, 'users', opts.users);
      timers.push({ step: 'users', ms: Date.now() - tUsers });
      console.log(`  ✓ users: ${opts.users}`);

      // ---- 4. nodes ----
      // 层级结构（父 id 恒小于子 id ⇒ 不可能成环）：
      //   - 40% 顶层节点（parent_id = NULL）
      //   - 40% 二级节点（parent = 某个顶层节点）
      //   - 20% 三级节点（parent = 某个二级节点）
      const tNodes = Date.now();
      const rootCount = Math.max(1, Math.floor(opts.nodes * 0.4));
      const midStart = rootCount + 1;
      const midCount = Math.max(0, Math.floor(opts.nodes * 0.4));
      const leafStart = midStart + midCount;
      const leafCount = Math.max(0, opts.nodes - rootCount - midCount);

      await tx.unsafe(
        `INSERT INTO nodes (
           id, name, title, description, avatar, parent_id, category_id, status,
           topics_count, feed_url, created_by, created_at
         )
         SELECT
           g,
           'n_' || lpad(g::text, 6, '0'),
           (ARRAY['技术','创意','生活','好玩','讨论','经验','问答','二手','招聘','评测'])[1 + (g % 10)]
             || '节点 #' || g,
           '压测节点 #' || g || ' 的描述文本，用于填充节点详情页。',
           '/uploads/avatars/nodes/' || (g % 20) || '.png',
           CASE
             WHEN g <= ${rootCount} THEN NULL
             WHEN g <= ${leafStart - 1} THEN 1 + (g - ${midStart}) % ${rootCount}
             ELSE ${midStart} + (g - ${leafStart}) % ${Math.max(1, midCount)}
           END,
           (SELECT c.id FROM categories c ORDER BY c.id OFFSET (g % ${CATEGORIES.length}) LIMIT 1),
           CASE
             WHEN g % 50 = 0 THEN 'pending'::node_status
             WHEN g % 97 = 0 THEN 'hidden'::node_status
             ELSE 'active'::node_status
           END,
           0,
           '/feed/node/' || g || '.rss',
           1 + (g % ${Math.max(1, Math.min(opts.users, 6))}),
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'node:' || g`)})
         FROM generate_series(1, ${opts.nodes}) AS s(g)`,
      );
      await resyncSequence(tx, 'nodes', opts.nodes);
      await assertDenseIds(tx, 'nodes', opts.nodes);
      timers.push({ step: 'nodes', ms: Date.now() - tNodes });
      console.log(`  ✓ nodes: ${opts.nodes}（顶层 ${rootCount} / 二级 ${midCount} / 三级 ${leafCount}）`);

      // ---- 5. topics ----
      const tTopics = Date.now();
      // 用临时表记录「主题 id ↔ 逻辑序号 ↔ 回复配额」，下游统一按 rn 派生随机量。
      await tx.unsafe(`CREATE TEMP TABLE lt_topics (
        id integer PRIMARY KEY, rn integer NOT NULL, n integer NOT NULL DEFAULT 0
      ) ON COMMIT DROP`);
      await tx.unsafe(
        `WITH ins AS (
           INSERT INTO topics (
             id, title, content, node_id, author_id, status, replies_count, views, votes,
             locked, pinned, deleted_at, deleted_by, deleted_reason, edited_at, edit_count,
             last_reply_at, created_at, updated_at
           )
           SELECT
             g,
             ${arrayLiteral(TITLE_PREFIXES)}[1 + (g % ${TITLE_PREFIXES.length})]
               || ' ' ||
             ${arrayLiteral(TITLE_SUBJECTS)}[1 + (g % ${TITLE_SUBJECTS.length})]
               || ' ' ||
             ${arrayLiteral(TITLE_SUFFIXES)}[1 + (g % ${TITLE_SUFFIXES.length})],
             '这是压测主题 #' || g || ' 的正文内容。' ||
               repeat('用于压测的正文段落，验证列表与详情页的读取性能。', 3),
             1 + (g % ${opts.nodes}),
             ${rnd.zipf(`'t:a:' || g`, opts.users, 1.5)},
             CASE
               WHEN ${rnd.expr(`'tdel:' || g`)} < ${SOFT_DELETE_RATE} THEN 'deleted'::topic_status
               WHEN g % 500 = 0 THEN 'locked'::topic_status
               ELSE 'published'::topic_status
             END,
             0,
             ${rnd.int(`'views:' || g`, 0, 5000)},
             0,
             (g % 500 = 0),
             (g % 1000 = 0),
             CASE
               WHEN ${rnd.expr(`'tdel:' || g`)} < ${SOFT_DELETE_RATE}
                 THEN ${ANCHOR} - (interval '30 days' * ${rnd.expr(`'tdelwhen:' || g`)})
               ELSE NULL
             END,
             CASE
               WHEN ${rnd.expr(`'tdel:' || g`)} < ${SOFT_DELETE_RATE}
                 THEN 1 + (g % ${Math.max(1, Math.min(opts.users, 6))})
               ELSE NULL
             END,
             CASE
               WHEN ${rnd.expr(`'tdel:' || g`)} < ${SOFT_DELETE_RATE} THEN '压测批量软删除'
               ELSE NULL
             END,
             CASE WHEN g % 7 = 0
               THEN ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'tedit:' || g`)}) ELSE NULL END,
             CASE WHEN g % 7 = 0 THEN 1 + (g % 3) ELSE 0 END,
             ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'tlast:' || g`)}),
             ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'tcrt:' || g`)}),
             ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'tcrt:' || g`)})
           FROM generate_series(1, ${opts.topics}) AS s(g)
           RETURNING id
         )
         INSERT INTO lt_topics (id, rn) SELECT id, row_number() OVER (ORDER BY id)::int FROM ins`,
      );
      await resyncSequence(tx, 'topics', opts.topics);
      await assertDenseIds(tx, 'topics', opts.topics);

      // 回复配额：每个主题 base 条，余数按 rn 顺序分配给前 remainder 个主题。
      const basePerTopic = Math.floor(opts.replies / opts.topics);
      const remainder = opts.replies % opts.topics;
      await tx.unsafe(
        `UPDATE lt_topics SET n = ${basePerTopic} + CASE WHEN rn <= ${remainder} THEN 1 ELSE 0 END`,
      );
      timers.push({ step: 'topics', ms: Date.now() - tTopics });
      console.log(`  ✓ topics: ${opts.topics}（每主题 ${basePerTopic}~${basePerTopic + 1} 条回复）`);

      // ---- 6. replies ----
      // floor = 1..n（主题内唯一，满足 replies_topic_floor_uidx）
      // 分批插入：每批处理 batch 条回复量
      const tReplies = Date.now();
      const perBatchTopics = Math.max(1, Math.floor(opts.batch / Math.max(1, basePerTopic)));

      for (let offset = 0; offset < opts.topics; offset += perBatchTopics) {
        const limit = Math.min(perBatchTopics, opts.topics - offset);
        const inserted = await tx.unsafe(
          `INSERT INTO replies (
             topic_id, author_id, content, floor, thanks, quote_id,
             deleted_at, deleted_by, deleted_reason, edited_at, edit_count,
             created_at, updated_at
           )
           SELECT
             t.id,
             ${rnd.zipf(`'ra:' || t.rn || ':' || f.i`, opts.users, 2.0)},
             ${arrayLiteral(REPLY_SNIPPETS)}[1 + ((t.rn + f.i) % ${REPLY_SNIPPETS.length})],
             f.i,
             0,
             NULL,
             CASE
               WHEN ${rnd.expr(`'rdel:' || t.rn || ':' || f.i`)} < ${SOFT_DELETE_RATE}
                 THEN ${ANCHOR} - (interval '30 days' * ${rnd.expr(`'rdelwhen:' || t.rn || ':' || f.i`)})
               ELSE NULL
             END,
             CASE
               WHEN ${rnd.expr(`'rdel:' || t.rn || ':' || f.i`)} < ${SOFT_DELETE_RATE}
                 THEN 1 + (t.rn % ${Math.max(1, Math.min(opts.users, 6))})
               ELSE NULL
             END,
             CASE
               WHEN ${rnd.expr(`'rdel:' || t.rn || ':' || f.i`)} < ${SOFT_DELETE_RATE}
                 THEN '压测批量软删除'
               ELSE NULL
             END,
             CASE WHEN (t.rn + f.i) % 11 = 0
               THEN ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'redit:' || t.rn || ':' || f.i`)}) ELSE NULL END,
             CASE WHEN (t.rn + f.i) % 11 = 0 THEN 1 ELSE 0 END,
             LEAST(${ANCHOR} - interval '1 minute', tt.created_at + (f.i * interval '7 minutes')),
             LEAST(${ANCHOR} - interval '1 minute', tt.created_at + (f.i * interval '7 minutes'))
           FROM lt_topics t
           JOIN topics tt ON tt.id = t.id
           CROSS JOIN LATERAL generate_series(1, t.n) AS f(i)
           WHERE t.rn > ${offset} AND t.rn <= ${offset + limit}`,
        );
        replyWritten += Number(inserted.count ?? 0);
        batches += 1;
      }
      timers.push({ step: 'replies', ms: Date.now() - tReplies });
      console.log(`  ✓ replies: ${replyWritten}（${batches} 批）`);

      // ---- 7. 回填 topics.replies_count（只算未删除回复）----
      const tCount = Date.now();
      await tx.unsafe(
        `UPDATE topics t SET
           replies_count = COALESCE(c.cnt, 0),
           last_reply_at = COALESCE(c.last_at, t.last_reply_at)
         FROM (
           SELECT topic_id, count(*)::int AS cnt, max(created_at) AS last_at
           FROM replies WHERE deleted_at IS NULL GROUP BY topic_id
         ) AS c
         WHERE c.topic_id = t.id`,
      );
      await tx.unsafe(
        `UPDATE topics t SET replies_count = 0
         WHERE NOT EXISTS (
           SELECT 1 FROM replies r WHERE r.topic_id = t.id AND r.deleted_at IS NULL
         )`,
      );
      timers.push({ step: 'replies_count 回填', ms: Date.now() - tCount });

      // ---- 8. floor_counters ----
      // 计数表必须与实际最大楼层一致，否则新回复会撞楼层唯一索引。
      await tx.unsafe(
        `INSERT INTO floor_counters (topic_id, last_floor)
         SELECT topic_id, max(floor)::int FROM replies GROUP BY topic_id
         ON CONFLICT (topic_id) DO UPDATE SET last_floor = EXCLUDED.last_floor`,
      );

      // ---- 9. nodes.topics_count ----
      // 只统计未删除主题（与 src/lib/node-service.ts 的查询语义一致）
      await tx.unsafe(
        `UPDATE nodes n SET topics_count = COALESCE(c.cnt, 0)
         FROM (
           SELECT node_id, count(*)::int AS cnt
           FROM topics WHERE deleted_at IS NULL GROUP BY node_id
         ) AS c
         WHERE c.node_id = n.id`,
      );
      await tx.unsafe(
        `UPDATE nodes SET topics_count = 0
         WHERE NOT EXISTS (
           SELECT 1 FROM topics t WHERE t.node_id = nodes.id AND t.deleted_at IS NULL
         )`,
      );

      // ---- 10. votes ----
      // 每个主题的票数按幂律分布（热门主题票多、冷门主题票少）；
      // 投票人也按幂律分布 —— 少数「水军」账号投出大部分票，
      // 这会让 votes_user_topic_uidx 索引上出现热点条目，
      // 更接近真实的索引页竞争场景。
      //
      // DISTINCT ON 保证 (user_id, topic_id) 不重复（幂律映射不保证唯一）。
      // topics.votes = up 数 - down 数（与 src/lib/content-service.ts 的 voteTopic 语义一致）。
      const tVotes = Date.now();
      const maxVotesPerTopic = Math.max(1, Math.min(20, opts.users));
      await tx.unsafe(
        `INSERT INTO votes (user_id, topic_id, direction, created_at)
         SELECT DISTINCT ON (t.id, vx.uid)
           vx.uid,
           t.id,
           CASE WHEN ${rnd.expr(`'vdir:' || t.rn || ':' || v.i`)} < 0.75
             THEN 'up'::vote_direction ELSE 'down'::vote_direction END,
           tt.created_at + (v.i * interval '3 minutes')
         FROM (
           SELECT
             lt.id,
             lt.rn,
             ${rnd.zipf(`'vn:' || lt.rn`, maxVotesPerTopic, 1.4)}::int AS n_votes
           FROM lt_topics lt
         ) AS t
         JOIN topics tt ON tt.id = t.id
         CROSS JOIN LATERAL generate_series(1, t.n_votes) AS v(i)
         CROSS JOIN LATERAL (
           SELECT ${rnd.zipf(`'vv:' || t.rn || ':' || v.i`, opts.users, 1.5)}::int AS uid
         ) AS vx
         WHERE tt.deleted_at IS NULL
         ORDER BY t.id, vx.uid, v.i`,
      );
      await tx.unsafe(
        `UPDATE topics t SET votes = COALESCE(v.v, 0)
         FROM (
           SELECT topic_id, sum(CASE WHEN direction = 'up' THEN 1 ELSE -1 END)::int AS v
           FROM votes GROUP BY topic_id
         ) AS v
         WHERE v.topic_id = t.id`,
      );
      timers.push({ step: 'votes', ms: Date.now() - tVotes });
      console.log(`  ✓ votes`);

      // ---- 11. thanks ----
      // 感谢的是回复；replies.thanks 必须等于 thanks 表里该回复的行数。
      await tx.unsafe(
        `INSERT INTO thanks (user_id, reply_id, created_at)
         SELECT DISTINCT
           ${rnd.zipf(`'ta:' || r.rn`, opts.users, 2.0)},
           r.id,
           r.created_at + interval '2 minutes'
         FROM (
           SELECT id, created_at, row_number() OVER (ORDER BY id)::int AS rn
           FROM replies WHERE deleted_at IS NULL
         ) AS r
         WHERE r.rn % 5 = 0`,
      );
      await tx.unsafe(
        `UPDATE replies r SET thanks = COALESCE(t.cnt, 0)
         FROM (SELECT reply_id, count(*)::int AS cnt FROM thanks GROUP BY reply_id) AS t
         WHERE t.reply_id = r.id`,
      );
      timers.push({ step: 'thanks', ms: Date.now() - tVotes });

      // ---- 12. collections（收藏主题 / 收藏节点）----
      const tColl = Date.now();
      await tx.unsafe(
        `INSERT INTO collections (user_id, target, topic_id, node_id, created_at)
         SELECT
           ${rnd.zipf(`'ct:' || t.rn`, opts.users, 1.6)},
           'topic'::collection_target,
           t.id,
           NULL,
           tt.created_at + interval '1 day'
         FROM lt_topics t
         JOIN topics tt ON tt.id = t.id
         WHERE tt.deleted_at IS NULL AND t.rn % 10 = 0`,
      );
      await tx.unsafe(
        `INSERT INTO collections (user_id, target, topic_id, node_id, created_at)
         SELECT
           ${rnd.zipf(`'cn:' || n.rn`, opts.users, 1.6)},
           'node'::collection_target,
           NULL,
           n.id,
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'collnode:' || n.rn`)})
         FROM (
           SELECT id, row_number() OVER (ORDER BY id)::int AS rn FROM nodes
         ) AS n
         WHERE n.rn % 5 = 0`,
      );
      timers.push({ step: 'collections', ms: Date.now() - tColl });

      // ---- 13. follows（关注关系，不能自环）----
      await tx.unsafe(
        `INSERT INTO follows (follower_id, following_id, created_at)
         SELECT
           fu.follower_id,
           fu.following_id,
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'follow:' || fu.follower_id || ':' || fu.k`)})
         FROM (
           SELECT
             u.id AS follower_id,
             1 + ((u.id::bigint * 3 + k.i::bigint - 1) % ${opts.users}) AS following_id,
             k.i AS k
           FROM users u
           CROSS JOIN LATERAL generate_series(1, 3) AS k(i)
         ) AS fu
         WHERE fu.following_id <> fu.follower_id`,
      );
      timers.push({ step: 'follows', ms: Date.now() - tColl });

      // ---- 14. notifications ----
      await tx.unsafe(
        `INSERT INTO notifications (user_id, type, actor_id, topic_id, reply_id, message, read, created_at)
         SELECT
           tt.author_id,
           'reply'::notification_type,
           ${rnd.zipf(`'na:' || t.rn`, opts.users, 1.6)},
           t.id,
           rp.id,
           '压测通知：用户 ' || t.rn || ' 回复了你的主题',
           (t.rn % 3 = 0),
           rp.created_at + interval '1 minute'
         FROM lt_topics t
         JOIN topics tt ON tt.id = t.id
         JOIN LATERAL (
           SELECT r.id, r.created_at FROM replies r
           WHERE r.topic_id = t.id AND r.deleted_at IS NULL
           ORDER BY r.floor LIMIT 1
         ) AS rp ON true
         WHERE tt.deleted_at IS NULL AND t.rn % 20 = 0`,
      );
      timers.push({ step: 'notifications', ms: Date.now() - tColl });
      console.log(`  ✓ collections / follows / notifications`);

      // ---- 15. sessions ----
      await tx.unsafe(
        `INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip)
         SELECT
           md5('lt_sess:' || ${opts.seed}::text || ':' || g),
           1 + (g % ${opts.users}),
           ${ANCHOR} - (interval '30 days' * ${rnd.expr(`'sess:' || g`)}),
           ${ANCHOR} - (interval '30 days' * ${rnd.expr(`'sess:' || g`)}) + interval '14 days',
           'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LoadTest/1.0',
           '10.' || (g % 255) || '.' || ((g * 7) % 255) || '.' || ((g * 13) % 255)
         FROM generate_series(1, ${Math.max(1, Math.floor(opts.users / 10))}) AS s(g)
         ON CONFLICT (id) DO NOTHING`,
      );
      timers.push({ step: 'sessions', ms: Date.now() - tColl });

      // ---- 16. daily_checkins ----
      // 每个用户最近 N 天连续签到（N = 1 + id % 14）；2/3 的用户参与。
      // streak = 连续天数（从最早一天算起），reward 与 credit-service 的规则一致。
      const tCheck = Date.now();
      await tx.unsafe(
        `INSERT INTO daily_checkins (user_id, checkin_date, reward, streak, created_at)
         SELECT
           d.uid,
           to_char(d.day, 'YYYY-MM-DD'),
           CASE WHEN d.streak > 1 THEN ${CREDIT.checkin + CREDIT.streakBonus} ELSE ${CREDIT.checkin} END,
           d.streak,
           d.day
         FROM (
           SELECT
             uu.id AS uid,
             dd.day,
             row_number() OVER (PARTITION BY uu.id ORDER BY dd.day DESC)::int AS streak
           FROM (SELECT id FROM users) AS uu
           CROSS JOIN LATERAL (
             SELECT generate_series(
               (${ANCHOR} - interval '1 day') - (interval '1 day' * (uu.id % 14)),
               (${ANCHOR} - interval '1 day'),
               interval '1 day'
             )::timestamptz AS day
           ) AS dd
           WHERE uu.id % 3 <> 0
         ) AS d
         ON CONFLICT (user_id, checkin_date) DO NOTHING`,
      );
      timers.push({ step: 'daily_checkins', ms: Date.now() - tCheck });

      // ---- 17. credit_ledger（积分流水，自洽）----
      // 规则：
      //  - 每个用户按 (注册奖励 → 签到 → 发主题 → 发回复) 的顺序产生流水
      //  - balance_before + amount = balance_after，且相邻流水首尾相接
      //  - 流水按 id 顺序与该顺序一致（显式指定 id，保证链式校验可复现）
      //  - 流水末尾的 balance_after 等于 users.balance
      const tLedger = Date.now();
      await tx.unsafe(
        `WITH entries AS (
           SELECT u.id AS user_id, 0 AS ord, u.id AS seq, u.created_at AS created_at,
                  'registration_bonus'::ledger_entry_type AS type, ${CREDIT.registration}::int AS amount,
                  'reg:' || u.id::text AS idem, NULL::varchar AS ref_type, NULL::integer AS ref_id,
                  u.id AS actor_id, '注册赠送'::text AS reason
           FROM users u
           UNION ALL
           SELECT d.user_id, 1, d.id, d.created_at,
                  'daily_checkin'::ledger_entry_type, d.reward,
                  'daily_checkin:' || d.user_id::text || ':' || d.checkin_date,
                  'checkin'::varchar, d.id::integer, d.user_id, '每日签到'::text
           FROM daily_checkins d
           UNION ALL
           SELECT t.author_id, 2, t.id, t.created_at,
                  'topic_created'::ledger_entry_type, ${CREDIT.topic},
                  'topic_created:' || t.id::text, 'topic'::varchar, t.id::integer,
                  t.author_id, '发布主题'::text
           FROM topics t
           UNION ALL
           SELECT r.author_id, 3, r.id, r.created_at,
                  'reply_created'::ledger_entry_type, ${CREDIT.reply},
                  'reply_created:' || r.id::text, 'reply'::varchar, r.id::integer,
                  r.author_id, '发表回复'::text
           FROM replies r
         ), numbered AS (
           SELECT
             e.*,
             row_number() OVER (ORDER BY e.user_id, e.ord, e.seq)::int AS gid,
             COALESCE(sum(e.amount) OVER (
               PARTITION BY e.user_id ORDER BY e.ord, e.seq
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::int AS before_amt,
             sum(e.amount) OVER (
               PARTITION BY e.user_id ORDER BY e.ord, e.seq
             )::int AS after_amt
           FROM entries e
         )
         INSERT INTO credit_ledger (
           id, user_id, type, amount, balance_before, balance_after,
           ref_type, ref_id, idempotency_key, actor_id, reason, created_at
         )
         SELECT
           n.gid, n.user_id, n.type, n.amount, n.before_amt, n.after_amt,
           n.ref_type, n.ref_id, n.idem, n.actor_id, n.reason, n.created_at
         FROM numbered n`,
      );
      // 显式指定 id 后必须修正序列，否则应用层再写会撞主键
      await tx.unsafe(
        `SELECT setval(pg_get_serial_sequence('credit_ledger', 'id'),
                       COALESCE((SELECT max(id) FROM credit_ledger), 1))`,
      );
      // 末尾余额对齐 users.balance
      await tx.unsafe(
        `UPDATE users u SET balance = COALESCE(l.final_balance, 0)
         FROM (
           SELECT user_id, max(balance_after)::int AS final_balance
           FROM credit_ledger GROUP BY user_id
         ) AS l
         WHERE l.user_id = u.id`,
      );
      timers.push({ step: 'credit_ledger', ms: Date.now() - tLedger });
      console.log(`  ✓ credit_ledger / daily_checkins / sessions`);

      // ---- 18. 其余辅助表（引用自洽）----
      await tx.unsafe(
        `INSERT INTO moderation_logs (moderator_id, action, target_type, target_id, reason, created_at)
         SELECT
           1 + (g % ${Math.max(1, Math.min(opts.users, 6))}),
           (ARRAY['topic_delete','topic_lock','topic_pin','reply_delete','topic_restore'])[1 + (g % 5)],
           (ARRAY['topic','reply'])[1 + (g % 2)],
           1 + (g % ${opts.topics}),
           '压测生成的审核记录 #' || g,
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'mod:' || g`)})
         FROM generate_series(1, ${Math.max(1, Math.floor(opts.topics / 100))}) AS s(g)`,
      );

      await tx.unsafe(
        `INSERT INTO tags (name)
         SELECT 'tag_' || lpad(g::text, 4, '0') FROM generate_series(1, 50) AS s(g)
         ON CONFLICT DO NOTHING`,
      );
      await tx.unsafe(
        `INSERT INTO topic_tags (topic_id, tag_id)
         SELECT DISTINCT
           1 + (t.rn % ${opts.topics}),
           1 + (t.rn % 50)
         FROM (SELECT id, row_number() OVER (ORDER BY id)::int AS rn FROM topics) AS t
         WHERE t.rn % 25 = 0`,
      );

      await tx.unsafe(
        `INSERT INTO reports (target_type, target_id, reporter_id, reason, status,
                              handled_by, handled_at, handle_note, created_at)
         SELECT
           (ARRAY['topic','reply','user'])[1 + (g % 3)]::report_target_type,
           1 + (g % ${opts.topics}),
           1 + (g % ${opts.users}),
           '压测生成的举报 #' || g,
           (ARRAY['pending','accepted','rejected'])[1 + (g % 3)]::report_status,
           CASE WHEN g % 3 = 0 THEN NULL ELSE 1 + (g % 6) END,
           CASE WHEN g % 3 = 0 THEN NULL ELSE ${ANCHOR} END,
           CASE WHEN g % 3 = 0 THEN NULL ELSE '压测处理的举报' END,
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'report:' || g`)})
         FROM generate_series(1, ${Math.max(1, Math.floor(opts.topics / 200))}) AS s(g)`,
      );

      await tx.unsafe(
        `INSERT INTO node_requests (name, title, description, category_id, requester_id,
                                    status, handled_by, handled_at, approved_node_id, created_at)
         SELECT
           'req_' || lpad(g::text, 6, '0'),
           '申请节点 #' || g,
           '压测生成的节点申请',
           (SELECT c.id FROM categories c ORDER BY c.id OFFSET (g % ${CATEGORIES.length}) LIMIT 1),
           1 + (g % ${opts.users}),
           (ARRAY['pending','approved','rejected'])[1 + (g % 3)]::node_request_status,
           CASE WHEN g % 3 = 0 THEN NULL ELSE 1 + (g % 6) END,
           CASE WHEN g % 3 = 0 THEN NULL ELSE ${ANCHOR} END,
           NULL,
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'nreq:' || g`)})
         FROM generate_series(1, ${Math.max(1, Math.floor(opts.nodes / 10))}) AS s(g)`,
      );

      await tx.unsafe(
        `INSERT INTO avatars (user_id, storage_path, original_name, mime_type, size, width, height, created_at)
         SELECT
           1 + (g % ${opts.users}),
           'avatars/' || (1 + (g % ${opts.users})) || '/' || lpad(g::text, 8, '0') || '.png',
           'avatar_' || g || '.png',
           'image/png',
           2048 + (g % 4096),
           256, 256,
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'avatar:' || g`)})
         FROM generate_series(1, ${Math.max(1, Math.floor(opts.users / 5))}) AS s(g)
         ON CONFLICT DO NOTHING`,
      );

      await tx.unsafe(
        `INSERT INTO email_logs (recipient_masked, purpose, delivered, skip_reason, user_id, created_at)
         SELECT
           'lt_***@loadtest.invalid',
           'password_reset'::email_purpose,
           (g % 2 = 0),
           CASE WHEN g % 2 = 0 THEN NULL ELSE '压测环境未配置 SMTP' END,
           1 + (g % ${opts.users}),
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'email:' || g`)})
         FROM generate_series(1, ${Math.max(1, Math.floor(opts.users / 10))}) AS s(g)`,
      );

      await tx.unsafe(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used_at, revoked_at,
                                            request_ip, created_at)
         SELECT
           1 + (g % ${opts.users}),
           md5('lt_reset:' || ${opts.seed}::text || ':' || g),
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'prt:' || g`)}) + interval '1 hour',
           CASE WHEN g % 3 = 0 THEN ${ANCHOR} ELSE NULL END,
           CASE WHEN g % 5 = 0 THEN ${ANCHOR} ELSE NULL END,
           '10.0.0.' || (g % 255),
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'prt:' || g`)})
         FROM generate_series(1, ${Math.max(1, Math.floor(opts.users / 20))}) AS s(g)
         ON CONFLICT DO NOTHING`,
      );

      await tx.unsafe(
        `INSERT INTO edit_history (target_type, target_id, editor_id, previous_title,
                                   previous_content, new_title, new_content, created_at)
         SELECT
           (ARRAY['topic','reply'])[1 + (g % 2)],
           1 + (g % ${opts.topics}),
           1 + (g % ${opts.users}),
           '压测编辑前的标题 #' || g,
           '压测编辑前的正文 #' || g,
           '压测编辑后的标题 #' || g,
           '压测编辑后的正文 #' || g,
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'edit:' || g`)})
         FROM generate_series(1, ${Math.max(1, Math.floor(opts.topics / 50))}) AS s(g)`,
      );

      await tx.unsafe(
        `INSERT INTO login_attempts (identifier, ip, success, created_at)
         SELECT
           'lt_' || lpad((1 + (g % ${opts.users}))::text, 6, '0'),
           '10.0.1.' || (g % 255),
           (g % 4 <> 0),
           ${ANCHOR} - (interval '2 years' * ${rnd.expr(`'login:' || g`)})
         FROM generate_series(1, ${Math.max(1, Math.floor(opts.users / 2))}) AS s(g)`,
      );

      await tx.unsafe(
        `INSERT INTO rate_limit_buckets (key, count, window_start)
         SELECT
           'rl_' || lpad(g::text, 8, '0'),
           g % 50,
           ${ANCHOR} - (interval '2 hours' * ${rnd.expr(`'rl:' || g`)})
         FROM generate_series(1, 500) AS s(g)
         ON CONFLICT DO NOTHING`,
      );

      // 标记：本次生成的参数，便于事后核对数据集来源
      await tx.unsafe(
        `INSERT INTO kv_store (key, value, expires_at)
         VALUES ('loadtest:seed',
                 ${literal(JSON.stringify({
                   seed: opts.seed,
                   users: opts.users,
                   nodes: opts.nodes,
                   topics: opts.topics,
                   replies: opts.replies,
                 }))},
                 NULL)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      );
    });

    const elapsedMs = Date.now() - startedAt;

    // ---- 统计输出 ----
    console.log('');
    console.log('▶ 生成完成，开始统计');
    const stats = await collectStats(sql, opts);

    const totalRows = stats.reduce((acc, s) => acc + s.actual, 0);

    console.log('');
    console.log('═══ 生成结果 ═══');
    console.log(`  目标库       : ${dbName} (${host})`);
    console.log(`  seed         : ${opts.seed}`);
    console.log(`  总耗时       : ${formatDuration(elapsedMs)}`);
    console.log(`  批次数       : ${batches}（回复分批插入）`);
    console.log('  事务数       : 1（单个事务，失败即全量回滚）');
    console.log(`  总行数       : ${totalRows}`);
    console.log(`  写入速度     : ${Math.round(totalRows / (elapsedMs / 1000))} 行/秒`);
    console.log('');
    console.log(
      '  ' +
        '表名'.padEnd(18) +
        '实际行数'.padStart(12) +
        '目标'.padStart(12) +
        '达成'.padStart(8),
    );
    console.log('  ' + '─'.repeat(50));
    for (const s of stats) {
      const target = s.target === null ? '—' : String(s.target);
      const pct =
        s.target === null || s.target === 0 ? '—' : `${Math.round((s.actual / s.target) * 100)}%`;
      console.log(
        '  ' +
          s.table.padEnd(18) +
          String(s.actual).padStart(12) +
          target.padStart(12) +
          pct.padStart(8),
      );
    }

    console.log('');
    console.log('  确定性指纹（同 seed 应完全一致，不同 seed 应完全不同）:');
    for (const s of stats) {
      if (s.checksum) {
        console.log(`    ${s.table.padEnd(10)} ${s.checksum}`);
      }
    }

    console.log('');
    console.log('  分步耗时:');
    for (const t of timers) {
      console.log(`    ${t.step.padEnd(22)} ${formatDuration(t.ms)}`);
    }

    console.log('');
    console.log('✓ 压测数据集生成完成');
  } catch (err) {
    console.error('');
    console.error(`✗ 生成失败：${(err as Error).message}`);
    console.error('  事务已回滚 —— 目标库不会留下半截数据。');
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 10 }).catch(() => undefined);
  }
}

/**
 * 把 serial 序列推进到当前最大 id。
 *
 * 脚本用显式 id 插入（users.id = g），序列还停在初始值 —— 不推进的话，
 * 应用层后续写入会撞主键。显式 setval 比让序列自己走要快得多。
 */
async function resyncSequence(
  tx: postgres.TransactionSql,
  table: string,
  expected: number,
): Promise<void> {
  await tx.unsafe(
    `SELECT setval(pg_get_serial_sequence('${q(table)}', 'id'), GREATEST(${expected}, 1))`,
  );
}

/**
 * 断言主键是「密集的 1..N」——
 * 脚本的下游逻辑（1 + (x % n) 之类的取模）依赖这个前提。
 * 不满足时直接失败，而不是生成一份 id 对不上的数据集。
 */
async function assertDenseIds(
  tx: postgres.TransactionSql,
  table: string,
  expected: number,
): Promise<void> {
  const res = await tx.unsafe(
    `SELECT count(*)::int AS n, min(id)::int AS mn, max(id)::int AS mx FROM ${q(table)}`,
  );
  const row = res[0] as unknown as { n: number; mn: number | null; mx: number | null };
  if (row.n !== expected || row.mn !== 1 || row.mx !== expected) {
    throw new Error(
      `${table} 的 id 不是密集的 1..${expected}（count=${row.n}, min=${row.mn}, max=${row.mx}）。` +
        '请用 --truncate 重置序列后再运行。',
    );
  }
}

/** 收集每张表的实际行数，并与目标值对比 */
async function collectStats(sql: postgres.Sql, opts: Options): Promise<Stat[]> {
  const targets: Record<string, number | null> = {
    users: opts.users,
    categories: CATEGORIES.length,
    nodes: opts.nodes,
    topics: opts.topics,
    replies: opts.replies,
    floor_counters: opts.topics,
  };

  const stats: Stat[] = [];
  for (const table of TABLES) {
    const res = await sql.unsafe(`SELECT count(*)::int AS n FROM ${q(table)}`);
    stats.push({
      table,
      actual: Number(res[0]?.n ?? 0),
      target: targets[table] ?? null,
      checksum: null,
    });
  }

  // 确定性指纹：对关键表做顺序无关的数值校验和。
  //
  // 指纹**含时间戳** —— 时间戳由 seed 派生的锚点决定（不是 now()），
  // 因此同 seed 两次运行的指纹必然一致，而不同 seed 的指纹必然不同。
  for (const table of CHECKSUM_TABLES) {
    const res = await sql.unsafe(
      `SELECT COALESCE(sum(('x' || substr(md5(rowtext), 1, 8))::bit(32)::int)::bigint, 0) AS s
       FROM (SELECT concat_ws('|', ${table === 'users' ? 'username, role, status, balance, created_at' : table === 'topics' ? 'title, node_id, author_id, status, views, created_at' : table === 'replies' ? 'topic_id, author_id, floor, content, created_at' : 'name, parent_id, category_id, status, created_at'})::text AS rowtext
             FROM ${q(table)}) x`,
    );
    const s = String(res[0]?.s ?? '0');
    const stat = stats.find((x) => x.table === table);
    if (stat) stat.checksum = s;
  }

  return stats;
}

/** SQL 字面量（值全部来自本文件的常量，无注入风险） */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * SQL 数组字面量：`(ARRAY['a', 'b', ...])`
 *
 * 必须带外层括号 —— PostgreSQL 不允许 `ARRAY['a','b'][1]` 这种直接下标语法，
 * 解析器会报「语法错误 在 "[" 或附近的」。
 */
function arrayLiteral(values: readonly string[]): string {
  return `(ARRAY[${values.map((v) => literal(v)).join(', ')}])`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)}s`;
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(1);
  return `${m}m${rest}s`;
}

main().catch((err) => {
  console.error('✗ 未捕获异常:', err);
  process.exit(1);
});
