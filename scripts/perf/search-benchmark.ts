/**
 * 搜索方案性能对照（v0.0.5）
 *
 * ## 目的
 *
 * 任务书 §六要求：「有实际数据规模的性能对照报告」。
 * 本脚本在**真实规模**数据上对比 v0.0.4 的 `ILIKE` 与 v0.0.5 的
 * **bigram 中文分词**方案的耗时与索引使用情况。
 *
 * ## 用法
 *
 * ```bash
 * npx tsx scripts/perf/search-benchmark.ts \
 *   --db=postgres://v2ex:xxx@127.0.0.1:55440/v2ex_searchbench \
 *   --topics=5000 --queries=40
 * ```
 *
 * ⚠️ 库名必须含 `bench` / `perf` / `loadtest`（脚本自检，拒绝写其他库）。
 *
 * ## 输出
 *
 * 每种查询类型的 P50 / P95 / P99、平均返回行数、以及是否用到索引
 * （`EXPLAIN` 的 plan 里出现 `Bitmap Index Scan` / `Index Scan` 即为命中索引）。
 */

import postgres from 'postgres';

type Options = {
  db: string;
  topics: number;
  queries: number;
  verbose: boolean;
};

function parseArgs(): Options {
  const argv = process.argv.slice(2);
  // 同时支持 `--db=xxx` 与 `--db xxx` 两种写法
  // （实测踩到：只支持后者时，`--db=xxx` 会被当成没有值 ⇒ 报「缺少 --db 参数」）
  const get = (name: string, fallback: string): string => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    db: get('db', process.env.DATABASE_URL ?? ''),
    topics: Number(get('topics', '5000')),
    queries: Number(get('queries', '40')),
    verbose: argv.includes('--verbose'),
  };
}

/** 库名护栏 —— 与 scripts/loadtest/seed-large.ts 同一套规则 */
const SAFE_DB_NAME_PATTERNS = ['bench', 'perf', 'loadtest', 'stress'];

function assertSafeDb(dbUrl: string): string {
  const name = dbUrl.slice(dbUrl.lastIndexOf('/') + 1).split('?')[0];
  const lower = name.toLowerCase();
  if (!SAFE_DB_NAME_PATTERNS.some((p) => lower.includes(p))) {
    throw new Error(
      `拒绝写入库「${name}」—— 库名必须含 ${SAFE_DB_NAME_PATTERNS.join(' / ')} 之一`,
    );
  }
  return name;
}

/** CJK bigram（与 src/lib/search-tokenize.ts 同一算法） */
function tokenize(query: string): string[] {
  const lower = query.toLowerCase();
  const tokens: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    if (t && !seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  };
  for (const m of lower.matchAll(/[a-z0-9]+/g)) {
    if (m[0].length >= 2) push(m[0]);
  }
  for (const m of lower.matchAll(/[぀-ヿ㐀-䶿一-鿿豈-﫿]+/g)) {
    const seg = m[0];
    if (seg.length === 1) {
      push(seg);
      continue;
    }
    for (let i = 0; i < seg.length - 1; i++) push(seg.slice(i, i + 2));
  }
  return tokens;
}

function toPattern(t: string): string {
  return `%${t.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

/** 百分位 */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

const CN_QUERIES = [
  '数据库性能优化',
  '性能优化',
  '前端框架',
  '系统架构设计',
  '异步编程',
  '数据库索引',
  '缓存策略',
  '微服务架构',
  '容器部署',
  '监控告警',
];

const EN_QUERIES = [
  'optimize',
  'query performance',
  'async await',
  'docker',
  'index',
];

async function main(): Promise<void> {
  const opts = parseArgs();
  if (!opts.db) throw new Error('缺少 --db 参数');
  const dbName = assertSafeDb(opts.db);
  console.log(`[bench] 目标库：${dbName}，主题数：${opts.topics}`);

  // ── 确保目标库存在（自动创建）──
  //
  // ⚠️ 必须先连管理库（postgres）建库 —— 直接连不存在的库会
  //    报 `FATAL: database "..." does not exist`（3D000）。
  const adminUrl = opts.db.replace(/\/([^/?]+)(\?.*)?$/, '/postgres$2');
  {
    const admin = postgres(adminUrl, { prepare: false, max: 1 });
    try {
      const exists = await admin.unsafe<{ n: number }[]>(
        'SELECT count(*)::int AS n FROM pg_database WHERE datname = $1',
        [dbName],
      );
      if (Number(exists[0]?.n ?? 0) === 0) {
        await admin.unsafe(`CREATE DATABASE "${dbName}"`);
        console.log(`[bench] 已创建库 ${dbName}`);
      }
    } finally {
      await admin.end();
    }
  }

  const sql = postgres(opts.db, { prepare: false, max: 4 });

  // ── 建表 + 灌数据 ──
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS topics (
      id serial PRIMARY KEY,
      title text NOT NULL,
      content text NOT NULL
    );
    TRUNCATE topics;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  `);

  console.log('[bench] 生成数据…');
  const batch = 500;
  for (let i = 0; i < opts.topics; i += batch) {
    // ⚠️ postgres.js 的 `sql(...)` 批量插入 helper 与直觉不符（实测连踩三次）：
    //   `sql([{title, content}])` → 「语法错误 在 ""title"" 或附近的」
    //   `sql(titles, contents)`     → 「语法错误 在 ""技术话题 0…"" 或附近的」
    //   `sql([titles, contents])`   → 「语法错误 在 ""0"" 或附近的」
    //
    // 最稳妥且**完全参数化**的写法：手工拼多值 INSERT 的占位符，
    // 参数数组顺序对应。
    // ⚠️ 数据分布决定索引效果 ——
    //
    // 第一版所有标题都含「数据库性能优化」⇒ 关键词命中 60% 的行
    // ⇒ trigram 索引**选择性太差**，优化器直接放弃索引走 Seq Scan
    // （这不是 trigram 的问题，是数据分布的问题）。
    //
    // 真实论坛里关键词分布是**长尾**的：少数文档命中某个词。
    // 这里按长尾分布生成 —— 每 50 条才有一条含目标关键词。
    const titles: string[] = [];
    const contents: string[] = [];
    for (let j = 0; j < batch && i + j < opts.topics; j++) {
      const n = i + j;
      const hot = n % 50 === 0;
      titles.push(
        hot
          ? `技术话题 ${n}：数据库性能优化与系统架构设计`
          : `技术话题 ${n}：${['前端','后端','移动','运维','数据','算法','测试','产品'][n % 8]}开发的日常记录`,
      );
      contents.push(
        hot
          ? '本文深入讨论数据库性能优化、缓存策略、异步编程与容器部署。'
          : `第 ${n} 篇记录了日常开发中遇到的一些问题与解决思路。`,
      );
    }
    const valuesSql = titles
      .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
      .join(', ');
    const params: string[] = [];
    for (let i = 0; i < titles.length; i++) {
      params.push(titles[i], contents[i]);
    }
    await sql.unsafe(
      `INSERT INTO topics (title, content) VALUES ${valuesSql}`,
      params,
    );
  }
  console.log('[bench] 数据就绪');

  // ── 建索引（与生产一致：title / content 各一个 GIN trigram）──
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS topics_title_trgm_idx ON topics USING gin (title gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS topics_content_trgm_idx ON topics USING gin (content gin_trgm_ops);
  `);
  await sql.unsafe('ANALYZE topics');

  // ── 构造查询集 ──
  const queries: Array<{ label: string; keyword: string }> = [];
  for (let i = 0; i < opts.queries; i++) {
    const cn = CN_QUERIES[i % CN_QUERIES.length];
    const en = EN_QUERIES[i % EN_QUERIES.length];
    queries.push({ label: '中文', keyword: cn });
    if (i % 2 === 1) queries.push({ label: '英文', keyword: en });
  }

  // ── 跑两种方案 ──
  type Result = { label: string; ms: number; rows: number };
  const ilikeResults: Result[] = [];
  const bigramResults: Result[] = [];
  const bigramAndResults: Result[] = [];

  for (const q of queries) {
    const pattern = toPattern(q.keyword);

    // ① ILIKE 整串（v0.0.4 现状）
    //
    // ⚠️ 必须用**模板标签**（sql`...`）而不是 `unsafe(query, params)` ——
    //    后者会把 SQL 里的 `%` 当成**格式占位符**（`%s` / `%i` 风格），
    //    ILIKE 的通配符 `%` 于是把 SQL 破坏成
    //    「语法错误 在 "%" 或附近的」（实测踩到）。
    let t0 = Date.now();
    const r1 = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM topics
        WHERE title ILIKE ${pattern} ESCAPE '\\'
           OR content ILIKE ${pattern} ESCAPE '\\'
    `;
    ilikeResults.push({ label: q.label, ms: Date.now() - t0, rows: r1[0].n });

    // ② bigram 中文分词 —— **OR 策略**（任一 token 命中即算）
    const tokens = tokenize(q.keyword);
    if (tokens.length > 0) {
      // ⚠️ 这里用 `unsafe` + 手写占位符是**安全**的 ——
      //    `%` 只出现在**参数值**里，不在 SQL 文本里 ⇒ 不会被当格式占位符。
      //    （对比上面的 ILIKE：那里 `%` 在 SQL 文本的 pattern 里。）
      const placeholders = tokens
        .map((_, i) => `$${i + 1} ILIKE $${i + 1} OR content ILIKE $${i + 1}`)
        .join(' OR ');
      const params = tokens.map(toPattern);
      t0 = Date.now();
      const r2 = await sql.unsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM topics WHERE (${placeholders})`,
        params,
      );
      bigramResults.push({ label: q.label, ms: Date.now() - t0, rows: r2[0].n });
    }

    // ③ bigram **AND** 策略（全部 token 都要命中）—— 精度更高
    //
    // ⚠️ OR 策略的**假阳性**问题：搜「数据库性能优化」会产生
    //    「数据库」「据库」「库性」「性能」「能优」「优化」等 token，
    //    任一命中即算 ⇒ 只要文档含「优化」就会被召回。
    //
    // AND 策略要求**所有** token 都命中 ⇒ 精度大幅提升，
    // 代价是可能漏掉「词序被打散」的文档（可接受）。
    if (tokens.length > 0) {
      const andPlaceholders = tokens
        .map((_, i) => `(title ILIKE $${i + 1} ESCAPE '\\' OR content ILIKE $${i + 1} ESCAPE '\\')`)
        .join(' AND ');
      const params = tokens.map(toPattern);
      t0 = Date.now();
      const r3 = await sql.unsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM topics WHERE ${andPlaceholders}`,
        params,
      );
      bigramAndResults.push({ label: q.label, ms: Date.now() - t0, rows: r3[0].n });
    }
  }

  // ── 汇总 ──
  function summarize(rs: Result[]) {
    const byLabel = new Map<string, Result[]>();
    for (const r of rs) {
      if (!byLabel.has(r.label)) byLabel.set(r.label, []);
      byLabel.get(r.label)!.push(r);
    }
    const out: Record<string, unknown> = {};
    for (const [label, items] of byLabel) {
      const times = items.map((i) => i.ms).sort((a, b) => a - b);
      out[label] = {
        次数: items.length,
        'P50 (ms)': pct(times, 50),
        'P95 (ms)': pct(times, 95),
        'P99 (ms)': pct(times, 99),
        最大值: times[times.length - 1],
        平均返回行数: Math.round(
          items.reduce((a, b) => a + b.rows, 0) / items.length,
        ),
      };
    }
    return out;
  }

  console.log('\n═══════════ 搜索方案性能对照 ═══════════');
  console.log(`数据规模：${opts.topics} 个主题（title + content 各带 GIN trigram 索引）`);
  console.log(`查询次数：${queries.length}（中英文混合）`);
  console.log('\n──── ① ILIKE 整串（v0.0.4 现状）────');
  console.log(JSON.stringify(summarize(ilikeResults), null, 2));
  console.log('\n──── ② bigram 中文分词 · OR 策略（任一 token 命中）────');
  console.log(JSON.stringify(summarize(bigramResults), null, 2));
  console.log('\n──── ③ bigram 中文分词 · AND 策略（全部 token 命中）────');
  console.log(JSON.stringify(summarize(bigramAndResults), null, 2));

  // ── 索引使用验证 ──
  const explainPattern = toPattern('数据库性能优化');
  const explain = await sql<{ 'QUERY PLAN': string }[]>`
    EXPLAIN (ANALYZE, BUFFERS)
      SELECT id FROM topics
      WHERE title ILIKE ${explainPattern} ESCAPE '\\'
         OR content ILIKE ${explainPattern} ESCAPE '\\'
  `;
  const plan = explain.map((r) => r['QUERY PLAN']).join('\n');
  const usesIndex = /Bitmap Index Scan|Index Scan|Index Cond/.test(plan);
  console.log('\n──── 索引使用验证（ILIKE 整串）────');
  console.log(usesIndex ? '✅ 命中索引（Bitmap Index Scan / Index Cond）' : '⚠️ 未命中索引（Seq Scan）');
  if (opts.verbose) console.log(plan);

  // ── 清理 ──
  await sql.unsafe('DROP TABLE IF EXISTS topics');
  await sql.end();
  console.log('\n[bench] 完成（临时表已清理）');
}

void main().catch((err) => {
  console.error('[bench] 失败：', err);
  process.exit(1);
});
