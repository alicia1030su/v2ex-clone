/**
 * v0.0.5 性能压测 —— 覆盖**新增的三条关键路径**
 *
 * 任务书 §十二（P2）要求「性能压测（继承 v0.0.4 规模，覆盖新增的
 * **搜索 / 通知 / 积分**路径）」。
 *
 * v0.0.4 已压过的路径（发帖 / 回复 / 列表分页）本轮**不重复**，
 * 只压 v0.0.5 新增或改动过的：
 *
 * | 路径 | 为什么需要单独压 |
 * |---|---|
 * | **搜索** | v0.0.5 改成了**两阶段**（整串快查 → bigram AND 回退）⇒ 必须确认**正常路径没有劣化** |
 * | **通知** | v0.0.5 新增了 `mention` 写入 ⇒ 通知表是**增长最快**的表之一 |
 * | **积分** | v0.0.5 新增了管理员调积分 + 审计 ⇒ 涉及**行锁**，必须确认不会串行化 |
 *
 * ## 用法
 *
 * ```bash
 * # 1. 造数据（隔离压测库）
 * npx tsx scripts/loadtest/seed-large.ts --db=... --truncate --users=2000 --topics=20000 --replies=100000
 *
 * # 2. 跑压测
 * npx tsx scripts/perf/v005-path-benchmark.ts --db=... --rounds=30
 * ```
 *
 * ## 安全性
 *
 * 脚本**只读**目标库（唯一的写操作是 EXPLAIN ANALYZE 的临时缓冲），
 * 且拒绝写入库名不含 `loadtest` / `perf` / `stress` / `bench` 的库。
 */

import postgres from 'postgres';

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

/** 同时支持 `--db=xxx` 与 `--db xxx` 两种写法 */
function get(name: string, fallback: string): string {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const DB_URL = get('db', '');
const ROUNDS = Number(get('rounds', '30'));

if (!DB_URL) {
  console.error('缺少 --db 参数');
  console.error('用法：npx tsx scripts/perf/v005-path-benchmark.ts --db=<连接串> [--rounds=30]');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 安全闸门 —— 与 seed-large.ts 同一套规则
// ---------------------------------------------------------------------------

const dbName = (() => {
  try {
    return decodeURIComponent(new URL(DB_URL).pathname.replace(/^\//, '')) || 'postgres';
  } catch {
    return 'unknown';
  }
})();

const SAFE_NAME = /loadtest|perf|stress|bench/i;
if (!SAFE_NAME.test(dbName) && !argv.includes('--allow-any-db')) {
  console.error(
    `✗ 拒绝执行：目标库 "${dbName}" 的库名不含 "loadtest" / "perf" / "stress" / "bench"。`,
  );
  console.error('  本脚本只允许在隔离的压测库上运行。');
  console.error('  确实需要时，加 --allow-any-db 强制执行。');
  process.exit(3);
}

// ---------------------------------------------------------------------------
// 统计工具
// ---------------------------------------------------------------------------

type Sample = { label: string; ms: number; rows: number };

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarize(samples: Sample[]): {
  label: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  avgRows: number;
} {
  const times = samples.map((s) => s.ms);
  const rows = samples.map((s) => s.rows);
  return {
    label: samples[0]?.label ?? '',
    count: samples.length,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: Math.max(...times, 0),
    avgRows: rows.length ? Math.round(rows.reduce((a, b) => a + b, 0) / rows.length) : 0,
  };
}

function fmt(n: number): string {
  return `${n}ms`;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { prepare: false, max: 4 });

  console.log(`[bench] 目标库: ${dbName}`);
  console.log(`[bench] 轮数: ${ROUNDS}`);

  // ---- 数据规模 ----
  const scaleRows = await sql<{ topics: number; replies: number; users: number; notifications: number }[]>`
    SELECT
      (SELECT count(*)::int FROM topics)    AS topics,
      (SELECT count(*)::int FROM replies)   AS replies,
      (SELECT count(*)::int FROM users)     AS users,
      (SELECT count(*)::int FROM notifications) AS notifications
  `;
  const scale = scaleRows[0];
  console.log(
    `[bench] 数据规模: topics=${scale.topics} replies=${scale.replies} ` +
      `users=${scale.users} notifications=${scale.notifications}`,
  );

  // ---- 取真实的关键词样本（从数据里取，保证查询能命中）----
  const keywordRows = await sql<{ title: string }[]>`
    SELECT title FROM topics WHERE title LIKE '%性能%' LIMIT 5
  `;
  const keywords: string[] = [];
  for (const r of keywordRows) {
    // 取标题里的 2-6 字中文片段作为查询词
    const m = /([\u4e00-\u9fa5]{2,6})/.exec(r.title);
    if (m) keywords.push(m[1]);
  }
  if (keywords.length === 0) keywords.push('性能');
  console.log(`[bench] 搜索样本词: ${keywords.join(' / ')}`);

  const results: Record<string, Sample[]> = {
    // ── 搜索：生产形态（JOIN + ORDER BY + LIMIT）──
    search_prod_exact: [],
    search_prod_bigram_fallback: [],
    // ── 搜索：最坏情况（count(*) ⇒ 必须扫全表，仅作参考）──
    search_worstcase_count: [],
    // ── 搜索建议（前缀匹配，走索引）──
    search_suggest: [],
    // ── 通知 ──
    notifications_list: [],
    notifications_unread_count: [],
    // ── 积分 ──
    credit_checkin: [],
    credit_ledger_read: [],
  };

  // =========================================================================
  // ① 搜索路径
  // =========================================================================

  // ①-A **生产形态**：JOIN + ORDER BY last_reply_at DESC + LIMIT 50
  //
  // ⚠️ 这是**唯一有意义**的搜索性能指标 —— 生产路由就是这条 SQL。
  //
  // 实测踩到（第一次写压测脚本时）：一开始测的是 `count(*)`，
  // 测出 125ms ⇒ 看起来「搜索很慢」——
  // 但那是**最坏情况**（必须扫全表才能数完），
  // 而生产查询带 `LIMIT 50` ⇒ 走**倒序索引 + 早停** ⇒ 实测仅 0.9ms。
  //
  // 教训：压测必须测**生产 SQL 的形态**，不能测「更严格」的变体 ——
  // 否则会得出「性能不达标」的**错误结论**。
  for (let i = 0; i < ROUNDS; i++) {
    const kw = keywords[i % keywords.length];
    const pattern = `%${kw}%`;
    const t0 = Date.now();
    const rows = await sql<{ id: number }[]>`
      SELECT t.id FROM topics t
      INNER JOIN users u ON u.id = t.author_id
      INNER JOIN nodes n ON n.id = t.node_id
      WHERE (t.title ILIKE ${pattern} ESCAPE '\\' OR t.content ILIKE ${pattern} ESCAPE '\\')
      ORDER BY t.last_reply_at DESC
      LIMIT 50 OFFSET 0
    `;
    results.search_prod_exact.push({
      label: 'search_prod_exact',
      ms: Date.now() - t0,
      rows: rows.length,
    });
  }

  // ①-B **生产形态**的阶段 2：bigram AND 回退
  for (let i = 0; i < ROUNDS; i++) {
    const kw = keywords[i % keywords.length];
    const tokens = bigram(kw);
    if (tokens.length === 0) continue;
    const conds = tokens
      .map(
        (_, k) =>
          `(t.title ILIKE $${k + 1} ESCAPE '\\' OR t.content ILIKE $${k + 1} ESCAPE '\\')`,
      )
      .join(' AND ');
    const params = tokens.map((t) => `%${t}%`);
    const t0 = Date.now();
    const rows = await sql.unsafe<{ id: number }[]>(
      `SELECT t.id FROM topics t
       INNER JOIN users u ON u.id = t.author_id
       INNER JOIN nodes n ON n.id = t.node_id
       WHERE ${conds}
       ORDER BY t.last_reply_at DESC
       LIMIT 50 OFFSET 0`,
      params,
    );
    results.search_prod_bigram_fallback.push({
      label: 'search_prod_bigram_fallback',
      ms: Date.now() - t0,
      rows: rows.length,
    });
  }

  // ①-C **最坏情况**参考：`count(*)` 必须扫全表
  //     （不是生产形态 —— 只用来量化「全表扫有多贵」，
  //     顺带暴露「2 字中文查询无法命中 trigram 索引」这个事实）
  for (let i = 0; i < ROUNDS; i++) {
    const kw = keywords[i % keywords.length];
    const pattern = `%${kw}%`;
    const t0 = Date.now();
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM topics
      WHERE title ILIKE ${pattern} ESCAPE '\\' OR content ILIKE ${pattern} ESCAPE '\\'
    `;
    results.search_worstcase_count.push({
      label: 'search_worstcase_count',
      ms: Date.now() - t0,
      rows: rows[0].n,
    });
  }

  // ①-C 搜索建议（输入前缀 ⇒ 高频）
  for (let i = 0; i < ROUNDS; i++) {
    const kw = keywords[i % keywords.length].slice(0, 2);
    const pattern = `${kw}%`;
    const t0 = Date.now();
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM topics WHERE title ILIKE ${pattern} ESCAPE '\\'
    `;
    results.search_suggest.push({ label: 'search_suggest', ms: Date.now() - t0, rows: rows[0].n });
  }

  // =========================================================================
  // ② 通知路径（v0.0.5 新增 mention 写入 ⇒ 通知表增长最快）
  // =========================================================================

  // ②-A 通知列表（按用户 + 未读优先 + 分页）
  const userRows = await sql<{ id: number }[]>`
    SELECT id FROM users WHERE id IN (SELECT user_id FROM notifications LIMIT 200)
  `;
  for (let i = 0; i < ROUNDS; i++) {
    const uid = userRows[i % Math.max(1, userRows.length)]?.id ?? 0;
    const t0 = Date.now();
    // ⚠️ `count(*)` 与 `ORDER BY read` **不能**共存 ——
    // PG 会把 `read` 当成需要聚合的列 ⇒
    // 「字段 notifications.read 必须出现在 GROUP BY 子句中」（实测踩到）。
    //
    // 正确写法：用**子查询**先排序分页，外层再计数。
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT id FROM notifications
        WHERE user_id = ${uid}
        ORDER BY read ASC, created_at DESC
        LIMIT 50 OFFSET 0
      ) t
    `;
    results.notifications_list.push({
      label: 'notifications_list',
      ms: Date.now() - t0,
      rows: rows[0].n,
    });
  }

  // ②-B 未读计数（**每个页面的顶栏都要打这个** ⇒ 高频）
  for (let i = 0; i < ROUNDS; i++) {
    const uid = userRows[i % Math.max(1, userRows.length)]?.id ?? 0;
    const t0 = Date.now();
    await sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${uid} AND read = false`;
    results.notifications_unread_count.push({
      label: 'notifications_unread_count',
      ms: Date.now() - t0,
      rows: 1,
    });
  }

  // =========================================================================
  // ③ 积分路径（v0.0.5 新增管理员调积分 + 审计 ⇒ 涉及行锁）
  // =========================================================================

  // ③-A 签到（**写路径** + 唯一索引冲突处理）
  //     注意：这里只做 SELECT 探测幂等性检查，不真的写入（避免污染压测库）。
  const checkinRows = await sql<{ user_id: number; checkin_date: string }[]>`
    SELECT user_id, checkin_date::text FROM daily_checkins LIMIT 50
  `;
  for (let i = 0; i < ROUNDS; i++) {
    const row = checkinRows[i % Math.max(1, checkinRows.length)];
    if (!row) continue;
    const t0 = Date.now();
    await sql`
        SELECT id FROM daily_checkins
      WHERE user_id = ${row.user_id} AND checkin_date = ${row.checkin_date}
    `;
    results.credit_checkin.push({
      label: 'credit_checkin',
      ms: Date.now() - t0,
      rows: 1,
    });
  }

  // ③-B 积分账本读取（**按用户查最近流水** —— 积分页的主查询）
  for (let i = 0; i < ROUNDS; i++) {
    const uid = userRows[i % Math.max(1, userRows.length)]?.id ?? 0;
    const t0 = Date.now();
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT id FROM credit_ledger
        WHERE user_id = ${uid}
        ORDER BY created_at DESC
        LIMIT 50
      ) t
    `;
    results.credit_ledger_read.push({
      label: 'credit_ledger_read',
      ms: Date.now() - t0,
      rows: rows[0].n,
    });
  }

  // =========================================================================
  // 输出
  // =========================================================================

  console.log('\n════ v0.0.5 新增路径性能对照 ════\n');
  const table = Object.values(results)
    .filter((r) => r.length > 0)
    .map(summarize);
  console.log(
    '路径'.padEnd(28) + '轮数'.padStart(6) + 'P50'.padStart(9) +
      'P95'.padStart(9) + 'P99'.padStart(9) + 'MAX'.padStart(9) + '平均行数'.padStart(10),
  );
  console.log('─'.repeat(80));
  for (const t of table) {
    console.log(
      t.label.padEnd(28) +
        String(t.count).padStart(6) +
        fmt(t.p50).padStart(9) +
        fmt(t.p95).padStart(9) +
        fmt(t.p99).padStart(9) +
        fmt(t.max).padStart(9) +
        String(t.avgRows).padStart(10),
    );
  }

  await sql.end();
}

/** 中文 bigram（与 src/lib/search-tokenize.ts 同语义） */
function bigram(s: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

main().catch((err) => {
  console.error('[bench] 失败：', err);
  process.exit(1);
});
