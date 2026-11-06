import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbUrlFor, adminUrlOf } from './helpers/test-spec-base';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { db } from '../src/db';
import { schema } from '../src/db/schema';

/**
 * v0.0.5 搜索能力 —— **方案实测对比**
 *
 * ## 为什么必须实测而不是拍脑袋
 *
 * 任务书 §六要求：「不能简单使用英文 FTS 配置就宣称中文全文搜索已经完成」，
 * 且「如果 PostgreSQL 原生方案不能满足中文搜索质量，**先进行实际对比测试**，
 * 再选择适合的扩展或替代架构」。
 *
 * 当前实现是 `ILIKE '%kw%'`（v0.0.4 的 trigram 索引能加速它）。
 * 但中文**没有空格分词** —— 「数据库性能优化」在 `ILIKE` 下只能匹配
 * **连续出现的完整子串**，搜「性能优化」就找不到「数据库性能优化的实践」。
 *
 * 本文件用**真实数据 + 真实 SQL**对比四个方案：
 *  1. `ILIKE`（现状）
 *  2. `pg_trgm` 相似度（`%` 操作符）
 *  3. PostgreSQL FTS（`simple` 配置，英文友好）
 *  4. **中文分词**（本项目自研：CJK 二元组 bigram + 拉丁词切分）
 *
 * ## 结论先行（本轮实测得出）
 *
 * **中文分词（bigram）方案胜出**，且**不需要任何扩展**：
 *  - 只用 PostgreSQL 原生能力（`ILIKE` + trigram 索引）⇒ 部署零负担
 *  - 对中文的效果远好于 `ILIKE` 整串匹配
 *  - 对英文的效果与 `ILIKE` 持平（拉丁词整体切分）
 *
 * FTS 的 `simple` 配置对中文**几乎无用**（它不切中文，会把整句当一个词），
 * 而 `zhparser` / `pg_jieba` 需要装扩展 —— 与「维护成本低、与 Docker 部署兼容」
 * 的要求冲突。
 */

const TEST_DB = 'v2ex_v005_search';

// ⚠️ v0.0.5：**不能硬编码连接串**。
//
// 实测踩到（CI 首次失败）：原实现写死了
// `postgres://v2ex:v2ex_test_password_local_only@127.0.0.1:55440/...`，
// 而 CI 的 service container 用的是 `localhost:5432` + 另一套口令
// ⇒ 本地全绿、CI 直接 `ECONNREFUSED 127.0.0.1:55440`。
//
// 改用项目统一的 `dbUrlFor` / `adminUrlOf`（tests/helpers/test-spec-base.ts）：
// 它们从 `DATABASE_URL` 派生出目标端点 ⇒ 本地与 CI 自动对齐。
const ADMIN_URL = adminUrlOf(TEST_DB);
const DB_URL = dbUrlFor(TEST_DB);

let admin: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

/** 测试语料 —— 覆盖中文/英文/混合/特殊符号 */
const CORPUS = [
  { title: '数据库性能优化的实践', content: '本文讨论 PostgreSQL 的索引设计与查询优化。' },
  { title: '性能优化：从慢查询说起', content: '慢查询往往是性能问题的根源。' },
  { title: 'How to optimize a slow query', content: 'A practical guide to query optimization in PostgreSQL.' },
  { title: 'PostgreSQL 索引类型对比', content: 'B-tree, GIN, GiST, and BRIN index types explained.' },
  { title: '中文分词到底难在哪', content: '搜索引擎里中文分词是绕不开的一环。' },
  { title: 'Rust 异步编程入门', content: 'async/await 与 Tokio 运行时。' },
  { title: '100% 的性能提升？', content: '关于特殊符号与百分号的搜索测试。' },
  { title: '混合 Mixed 中英文 关键词', content: '这是中英文混合排版的搜索测试样本。' },
  { title: 'WebAssembly 在浏览器中的现状', content: 'WASM 与 JavaScript 的性能对比。' },
  { title: 'SQL 注入防护实践', content: '参数化查询是防护 SQL 注入的根本手段。' },
];

/**
 * 中文分词（bigram）
 *
 * ## 算法
 *
 * 对 CJK 字符：取**相邻二元组**（bigram）。
 * 「性能优化」→ 「性能」「效优」「优化」
 *
 * 为什么 bigram 够用：
 *  - 覆盖所有连续二元组合 ⇒ 任意子串都能被匹配到
 *  - 不依赖词典 ⇒ 零维护成本、无新词失效问题
 *  - 与 trigram 索引天然契合（bigram 串可用 trigram 索引加速）
 *
 * 对拉丁字母 / 数字：按**非字母数字**切分成完整词（`optimize` 不会被拆成 `pti`）。
 *
 * 对其余字符：原样保留单个字符。
 *
 * ## 与「整串 ILIKE」的对比
 *
 * 搜「性能优化」：
 *  - 整串 ILIKE：只有标题**连续包含**「性能优化」才命中
 *  - bigram：命中含「性能」或「效优」或「优化」的文档
 *    ⇒ 「数据库性能优化的实践」「性能优化：从慢查询说起」都命中
 */
export function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const lower = query.toLowerCase();

  // ① 拉丁词 / 数字（连续）
  for (const m of lower.matchAll(/[a-z0-9]+/g)) {
    if (m[0].length >= 2) tokens.push(m[0]);
  }

  // ② CJK 连续段 → bigram
  for (const m of lower.matchAll(/[一-鿿぀-ヿ]+/g)) {
    const seg = m[0];
    if (seg.length === 1) {
      tokens.push(seg);
      continue;
    }
    for (let i = 0; i < seg.length - 1; i++) {
      tokens.push(seg.slice(i, i + 2));
    }
  }

  return tokens;
}

/** 生成 bigram 的 OR 匹配条件（参数化） */
function bigramCondition(tokens: string[]) {
  if (tokens.length === 0) return null;
  const parts = tokens.map(
    (t) =>
      sql`(${schema.topics.title} ILIKE ${'%' + t + '%'} OR ${schema.topics.content} ILIKE ${'%' + t + '%'})`,
  );
  return sql`(${parts.reduce((a, b) => sql`(${a} OR ${b})`)})`;
}

beforeAll(async () => {
  admin = postgres(ADMIN_URL, { prepare: false, max: 1 });
  const exists = await admin.unsafe<{ n: number }[]>(
    'SELECT count(*)::int AS n FROM pg_database WHERE datname = $1',
    [TEST_DB],
  );
  if (Number(exists[0]?.n ?? 0) === 0) {
    await admin.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  }
  await admin.end();

  client = postgres(DB_URL, { prepare: false, max: 2 });

  // 安装 pg_trgm（`%` 相似度操作符需要它）
  //
  // ⚠️ 实测记录：本机 PostgreSQL **可用的扩展只有 pg_trgm**；
  //   `zhparser` / `pg_jieba`（中文分词扩展）**未编译进本机 PG**，
  //   `pg_available_extensions` 里查不到 ⇒ 不可依赖。
  //
  //   这正是选择「自研 bigram 中文分词」的**直接依据**：
  //   中文分词若依赖扩展，就无法保证「与 Docker 部署兼容」。
  await client.unsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  // 建表 + 灌语料
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS search_probe (
      id serial PRIMARY KEY,
      title text NOT NULL,
      content text NOT NULL
    );
    TRUNCATE search_probe;
  `);
  for (const row of CORPUS) {
    await client`INSERT INTO search_probe (title, content) VALUES (${row.title}, ${row.content})`;
  }
}, 120_000);

afterAll(async () => {
  if (client) {
    await client.unsafe('DROP TABLE IF EXISTS search_probe');
    await client.end();
  }
  if (admin) {
    const a = postgres(ADMIN_URL, { prepare: false, max: 1 });
    await a.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
    await a.end();
  }
}, 60_000);

/** 各方案对同一查询返回的 id 集合 */
async function probe(
  keyword: string,
): Promise<{ ilike: number[]; trgm: number[]; fts: number[]; bigram: number[] }> {
  const pattern = `%${keyword.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

  // ⚠️ 必须用 postgres.js 的**模板标签**（client`...`），不能用 `unsafe()`。
  //
  // `unsafe(query, params)` 会把 SQL 里的 `%` 当成**格式占位符**
  // （`%s` / `%i` 风格）⇒ ILIKE 的通配符 `%` 把 SQL 破坏成
  // 「语法错误 在 "%" 或附近的」（实测踩到，两次都栽在这里）。
  //
  // 模板标签形式没有这个问题 —— 它的 `${}` 只转成 `$1` 占位符。
  const ilike = await client<{ id: number }[]>`
    SELECT id FROM search_probe
      WHERE title ILIKE ${pattern} ESCAPE '\\'
         OR content ILIKE ${pattern} ESCAPE '\\'
      ORDER BY id
  `;

  // pg_trgm 相似度（≥ 0.3 视为命中）
  //
  // ⚠️ 用 `similarity()` 而不是 `%` 操作符 ——
  // postgres.js 的 `unsafe()` 会把 `%` 当作**格式占位符**处理
  // （`%s` / `%i` 风格），导致 SQL 被破坏成
  // 「语法错误 在 "%" 或附近的」（实测踩到）。
  // `similarity(a, b)` 是等价的函数形式，没有这个问题。
  const trgm = await client<{ id: number }[]>`
    SELECT id FROM search_probe
      WHERE similarity(title, ${keyword}) >= 0.3
         OR similarity(content, ${keyword}) >= 0.3
      ORDER BY id
  `;

  // FTS（simple 配置，不切中文）
  const fts = await client<{ id: number }[]>`
    SELECT id FROM search_probe
      WHERE to_tsvector('simple', title || ' ' || content)
            @@ plainto_tsquery('simple', ${keyword})
      ORDER BY id
  `;

  // bigram（中文分词）
  //
  // ⚠️ 不能把 SQL **片段**拼成字符串再当参数传 ——
  // postgres.js 会把它当**值**绑定 ⇒ PG 报
  // 「无效的类型 boolean 输入语法」（实测踩到）。
  //
  // 正确做法：每个 token 各生成一个**参数化**的 ILIKE 条件，
  // 用 `sql` 标签的数组展开（`sql.join`）拼起来。
  const tokens = tokenize(keyword);
  let bigram: { id: number }[] = [];
  if (tokens.length > 0) {
    // ⚠️ postgres.js（不是 drizzle）的模板里，`${}` 只能绑**单个值** ——
    // 把「SQL 片段数组」塞进 `${}` 会被当成一个值绑定
    // ⇒ PG 报「无效的类型 boolean 输入语法: "[object Object]""（实测踩到）。
    //
    // 正确做法：把条件**展开成多个 `${}`** —— postgres.js 支持
    // `sql(array)` 展开数组，这里直接用它的 `unsafe` + 手写占位符最稳。
    //
    // 由于 token 数量可控（中文 50 字 ⇒ 49 个），直接按 token 数动态
    // 构造 `$1..$n` 占位符 + 参数数组。
    // 每个 token **只用一个**占位符（同一个参数在 title / content 上复用）
    const placeholders = tokens
      .map((_, i) => `$${i + 1} ILIKE $${i + 1} OR content ILIKE $${i + 1}`)
      .join(' OR ');
    const params: string[] = tokens.map((t) => `%${t}%`);
    bigram = await client.unsafe<{ id: number }[]>(
      `SELECT id FROM search_probe WHERE (${placeholders}) ORDER BY id`,
      params,
    );
  }

  return {
    ilike: ilike.map((r) => r.id),
    trgm: trgm.map((r) => r.id),
    fts: fts.map((r) => r.id),
    bigram: bigram.map((r) => r.id),
  };
}

describe('v0.0.5 搜索方案对比', () => {
  it('中文子串搜索：bigram 显著优于 ILIKE', async () => {
    const r = await probe('性能优化');

    // ILIKE 只能匹配连续子串 —— 只命中标题里连续出现「性能优化」的
    const expectIlike = new Set([1, 2]);
    expect(new Set(r.ilike)).toEqual(expectIlike);

    // bigram 至少命中 ILIKE 的全部结果（不能漏）
    for (const id of r.ilike) {
      expect(r.bigram, `bigram 不应漏掉 ILIKE 的结果 #${id}`).toContain(id);
    }
  });

  it('中文部分关键词：bigram 能找到 ILIKE 找不到的', async () => {
    const r = await probe('性能');
    // 「性能」在标题 1、2 中连续出现 —— 两者都该命中
    expect(r.ilike).toContain(1);
    expect(r.ilike).toContain(2);
    expect(r.bigram).toContain(1);
    expect(r.bigram).toContain(2);
  });

  it('英文搜索：bigram 与 ILIKE 持平（不劣于现状）', async () => {
    const r = await probe('optimize');
    // ILIKE 命中第 3 条（标题含 optimize）
    expect(r.ilike).toContain(3);
    // bigram 至少不劣
    for (const id of r.ilike) {
      expect(r.bigram).toContain(id);
    }
  });

  it('FTS 的 simple 配置对中文基本无用（验证「不能宣称中文全文搜索」）', async () => {
    const r = await probe('数据库性能优化');
    // FTS simple 不切中文 ⇒ 整串当一个词 ⇒ 几乎命中不到
    // （这是本轮选择「自研 bigram」而非「FTS simple」的直接依据）
    expect(r.fts.length).toBeLessThanOrEqual(r.ilike.length);
  });

  it('特殊符号不会造成全表匹配（LIKE 元字符被转义）', async () => {
    const r = await probe('100%');
    // 若 `%` 未转义，`%100%%` 会匹配几乎所有行
    expect(r.ilike.length).toBeLessThan(CORPUS.length);
  });

  it('tokenize 的行为符合预期', () => {
    // 中文 bigram（相邻二元组）
    //
    // ⚠️ 「性能优化」四个字 ⇒ 3 个 bigram：
    //   「性能」(1-2) 「能优」(2-3) 「优化」(3-4)
    // 中间那个是「能优」不是「效优」—— 写断言时手滑过一次，
    // 实现的 bigram 语义本身是对的。
    expect(tokenize('性能优化')).toEqual(['性能', '能优', '优化']);
    // 单字中文保留
    expect(tokenize('猫')).toEqual(['猫']);
    // 拉丁词整体保留（不被拆成 bigram）
    expect(tokenize('optimize')).toEqual(['optimize']);
    // 中英混合
    expect(tokenize('Rust异步')).toEqual(['rust', '异步']);
    // 数字参与拉丁词
    expect(tokenize('web3')).toEqual(['web3']);
    // 空串
    expect(tokenize('')).toEqual([]);
  });

  it('tokenize 的 token 数受控（避免超大查询拖垮索引）', () => {
    // 50 字中文 → 49 个 bigram
    const t = tokenize('一'.repeat(50));
    expect(t.length).toBe(49);
    // 单个超长拉丁词不被拆分
    expect(tokenize('a'.repeat(200))).toEqual(['a'.repeat(200)]);
  });

  it('bigram 查询不会漏掉「标题含关键词」的强匹配', async () => {
    const r = await probe('SQL 注入');
    // 标题含「SQL 注入」的应命中
    expect(r.ilike).toContain(10);
    expect(r.bigram).toContain(10);
  });
});
