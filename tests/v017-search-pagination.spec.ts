import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { and, count, desc, eq, ilike, or } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { PUBLIC_NODE_CONDITION } from '../src/lib/node-visibility';

/**
 * v0.0.17 P1-1 —— 搜索结果分页：**真库**验证不重不漏
 * ============================================================================
 *
 * ## 为什么要用真库造 21 / 101 / 大量数据
 *
 * 搜索页原本就**有分页**（`limit/offset` + `count` + `Pager`，v0.0.14 起）。
 * 所以本项不是在「从无到有加分页」，而是在查**分页是否真的不重不漏**。
 *
 * 分页的三个经典失效方式，**种子数据（十几条）永远测不出来**：
 *
 *   1. **排序不唯一**：只按 `lastReplyAt DESC` 排序时，并列行顺序不确定
 *      ⇒ 第 1 页与第 2 页之间会重复出现同一行、或漏掉某一行。
 *      （v0.0.17 实测缺陷：搜索页没有 id 兜底。）
 *   2. **总数被 limit 截断**：用 `list.length` 当 total ⇒ 永远只有 1 页。
 *   3. **可见性条件只加在列表、没加在 count**（或反过来）
 *      ⇒ 页数与实际条数错位，隐藏节点内容也可能漏出。
 *
 * ⇒ 本文件造 **21 / 101 / 305** 三档数据，逐页收集 id 集合并断言：
 *    · 并集大小 === 总数（不漏）
 *    · 并集去重后大小 === 总数（不重）
 *    · 每一页的 id 集合两两不相交
 *    · 重复请求同一页两次，结果完全一致（确定性）
 *
 * ## 为什么在本文件里**重写**查询而不是 import 页面组件
 *
 * 页面是 React Server Component，直接调用会拉起整棵组件树。
 * 这里刻意用**与页面完全相同的 where/orderBy 构造**（`PUBLIC_NODE_CONDITION`
 * + 同一组 ilike + 同一排序键），并由 `tests/static/v017-search-pagination.spec.ts`
 * 断言「页面里的排序键集合 == 本文件的排序键集合」—— 两边一旦漂移就判红。
 * 这不是「用测试抄一份实现」，而是把「排序契约」做成可静态核对的事实。
 */

const TEST_DB = process.env.V017_SEARCH_TEST_DB ?? 'v2ex_v017_search';
const PER_PAGE = 20;

process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);
{
  const g = globalThis as unknown as { __v2exSql?: unknown; __v2exDrizzle?: unknown };
  g.__v2exSql = undefined;
  g.__v2exDrizzle = undefined;
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let publicNodeId = 0;
let hiddenNodeId = 0;
let authorId = 0;

/** 本文件所有主题共用的关键词 —— 保证查询只命中本用例造的数据 */
const KEYWORD = 'v017paginate';

beforeAll(async () => {
  logDbTarget('tests/v017-search-pagination.spec.ts', TEST_DB);

  await provisionTestDatabase({
    file: 'tests/v017-search-pagination.spec.ts',
    db: TEST_DB,
    adminUrl: adminUrlOf(TEST_DB),
    migrate: () =>
      runDrizzleKit(['migrate'], {
        ...process.env,
        ENV_FILE: '',
        DATABASE_URL: dbUrlFor(TEST_DB),
      }),
  });

  client = postgres(dbUrlFor(TEST_DB), { prepare: false, max: 10 });
  db = drizzle(client, { schema });

  const [user] = await db
    .insert(schema.users)
    .values({ username: 'v017_search_author', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  authorId = user.id;

  const [cat] = await db
    .insert(schema.categories)
    .values({ name: 'v017searchcat', title: 'V017 Search Cat' })
    .returning({ id: schema.categories.id });

  const [pub] = await db
    .insert(schema.nodes)
    .values({ name: 'v017searchpub', title: 'V017 Search Public', categoryId: cat.id, status: 'active' })
    .returning({ id: schema.nodes.id });
  publicNodeId = pub.id;

  const [hid] = await db
    .insert(schema.nodes)
    .values({ name: 'v017searchhid', title: 'V017 Search Hidden', categoryId: cat.id, status: 'hidden' })
    .returning({ id: schema.nodes.id });
  hiddenNodeId = hid.id;
}, 120_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
}, 60_000);

/** 造 n 条 `published` 主题；可选让 `lastReplyAt` 大量并列（正是排序不唯一的情形） */
async function seedTopics(n: number, opts: { tieTimestamps?: boolean } = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({
    title: `${KEYWORD} 主题 ${i}`,
    content: `第 ${i} 篇正文，用于搜索分页验证。`,
    nodeId: publicNodeId,
    authorId,
    // 并列时间：所有行 lastReplyAt 完全相同 ⇒ 排序键不唯一
    lastReplyAt: opts.tieTimestamps ? new Date('2026-11-01T00:00:00.000Z') : new Date(2026, 0, 1, 0, 0, i),
  }));
  // 分批插入，避免单条 SQL 参数过多
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(schema.topics).values(rows.slice(i, i + 100));
  }
}

/** 与页面完全一致的 where 构造 */
function searchWhere(q: string) {
  return and(
    eq(schema.topics.status, 'published'),
    PUBLIC_NODE_CONDITION,
    or(ilike(schema.topics.title, `%${q}%`), ilike(schema.topics.content, `%${q}%`)),
  );
}

/** 与页面完全一致的排序键（v0.0.17：必须含 id 兜底） */
const ORDER = [desc(schema.topics.lastReplyAt), desc(schema.topics.id)] as const;

async function pageIds(q: string, page: number): Promise<number[]> {
  const rows = await db
    .select({ id: schema.topics.id })
    .from(schema.topics)
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(searchWhere(q))
    .orderBy(...ORDER)
    .limit(PER_PAGE)
    .offset((page - 1) * PER_PAGE);
  return rows.map((r) => r.id);
}

async function totalOf(q: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(schema.topics)
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(searchWhere(q));
  return Number(rows[0]?.n ?? 0);
}

/** 逐页收齐，返回 { pages, ids } */
async function collectAll(q: string) {
  const total = await totalOf(q);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const perPage: number[][] = [];
  for (let p = 1; p <= pages; p++) perPage.push(await pageIds(q, p));
  return { total, pages, perPage, ids: perPage.flat() };
}

describe('v0.0.17 搜索分页：21 条（跨页边界）', () => {
  it('总数正确，且第 2 页只有 1 条', async () => {
    await seedTopics(21);
    const total = await totalOf(KEYWORD);
    expect(total, '真库应有 21 条命中').toBe(21);

    const p1 = await pageIds(KEYWORD, 1);
    const p2 = await pageIds(KEYWORD, 2);
    expect(p1).toHaveLength(20);
    expect(p2, '21 条时第 2 页应恰好 1 条（off-by-one 边界）').toHaveLength(1);
  });

  it('21 条：两页并集 = 21，无重复', async () => {
    const { total, perPage, ids } = await collectAll(KEYWORD);
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size, '出现了重复行 —— 排序不唯一或 offset 算错').toBe(total);

    const [a, b] = perPage;
    const overlap = a.filter((x) => b.includes(x));
    expect(overlap, `第 1/2 页出现重复 id：${overlap.join(',')}`).toHaveLength(0);
  });
});

describe('v0.0.17 搜索分页：101 条（多页 + 末尾页）', () => {
  beforeAll(async () => {
    await seedTopics(80); // 21 + 80 = 101
  });

  it('101 条 ⇒ 6 页（最后一页 1 条）', async () => {
    const total = await totalOf(KEYWORD);
    expect(total).toBe(101);
    expect(Math.ceil(total / PER_PAGE)).toBe(6);

    const p6 = await pageIds(KEYWORD, 6);
    expect(p6).toHaveLength(1);
  });

  it('101 条：6 页并集 = 101，两两不相交（不重不漏）', async () => {
    const { total, perPage, ids } = await collectAll(KEYWORD);
    expect(perPage).toHaveLength(6);
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);

    // 两两不相交
    for (let i = 0; i < perPage.length; i++) {
      for (let j = i + 1; j < perPage.length; j++) {
        const dup = perPage[i].filter((x) => perPage[j].includes(x));
        expect(dup, `第 ${i + 1} 页与第 ${j + 1} 页重复：${dup.join(',')}`).toHaveLength(0);
      }
    }
  });

  it('排序键在**大量并列时间**下仍然确定（这是本项的核心缺陷）', async () => {
    /*
     * 关键用例：把 21 条**全部**设成同一个 lastReplyAt ⇒ 排序键 (lastReplyAt) 退化，
     * 若没有 id 兜底，PostgreSQL 的行序在多次查询间可能不同，
     * 逐页收集就会出现重复/遗漏。
     */
    await db
      .update(schema.topics)
      .set({ lastReplyAt: new Date('2026-11-01T00:00:00.000Z') })
      .where(ilike(schema.topics.title, `${KEYWORD}%`));

    const first = await collectAll(KEYWORD);
    expect(first.ids).toHaveLength(first.total);
    expect(new Set(first.ids).size, '并列时间下出现重复 —— 排序键不唯一').toBe(first.total);

    // 同一查询重复三次，必须完全一致（确定性）
    const second = await collectAll(KEYWORD);
    const third = await collectAll(KEYWORD);
    expect(second.ids, '同一查询两次结果不同 ⇒ 排序不确定').toEqual(first.ids);
    expect(third.ids).toEqual(first.ids);
  });
});

describe('v0.0.17 搜索分页：305 条（大量数据 + 深页）', () => {
  beforeAll(async () => {
    await seedTopics(204); // 101 + 204 = 305
  });

  it('305 条 ⇒ 16 页，深页（第 16 页）非空且正确', async () => {
    const total = await totalOf(KEYWORD);
    expect(total).toBe(305);
    expect(Math.ceil(total / PER_PAGE)).toBe(16);

    const deep = await pageIds(KEYWORD, 16);
    expect(deep.length).toBeGreaterThan(0);
    expect(deep.length).toBeLessThanOrEqual(PER_PAGE);
  });

  it('305 条：全部 16 页并集 = 305，无重复', async () => {
    const { total, perPage, ids } = await collectAll(KEYWORD);
    expect(perPage).toHaveLength(16);
    expect(new Set(ids).size).toBe(total);
    expect(ids).toHaveLength(total);
  });

  it('超出末页返回空集（不是报错、也不是回到第 1 页）', async () => {
    const beyond = await pageIds(KEYWORD, 17);
    expect(beyond).toHaveLength(0);
  });

  it('相同关键词大小写不同，命中数一致（ilike 语义）', async () => {
    const lower = await totalOf(KEYWORD.toLowerCase());
    const upper = await totalOf(KEYWORD.toUpperCase());
    const mixed = await totalOf(KEYWORD);
    expect(lower).toBe(mixed);
    expect(upper).toBe(mixed);
  });
});

describe('v0.0.17 搜索分页：隐藏节点 / 已删除主题不得泄漏', () => {
  it('hidden 节点下的匹配主题不出现在任何一页，也不计入总数', async () => {
    const before = await totalOf(KEYWORD);

    // 造 5 条命中关键词、但落在 hidden 节点下的主题
    await db.insert(schema.topics).values(
      Array.from({ length: 5 }, (_, i) => ({
        title: `${KEYWORD} 隐藏主题 ${i}`,
        content: '不应出现在搜索结果里',
        nodeId: hiddenNodeId,
        authorId,
        lastReplyAt: new Date(),
      })),
    );

    const after = await totalOf(KEYWORD);
    expect(after, '隐藏节点主题被计入总数 —— 列表与 count 口径不一致').toBe(before);

    const { ids } = await collectAll(KEYWORD);
    const hiddenTitles = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .where(eq(schema.topics.nodeId, hiddenNodeId));
    const hiddenIds = new Set(hiddenTitles.map((h) => h.id));
    const leaked = ids.filter((id) => hiddenIds.has(id));
    expect(leaked, `隐藏节点主题泄漏：${leaked.join(',')}`).toHaveLength(0);
  });

  it('软删除主题不出现在结果里，也不计入总数', async () => {
    const before = await totalOf(KEYWORD);

    const [victim] = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .where(and(ilike(schema.topics.title, `${KEYWORD} 主题 0`), eq(schema.topics.status, 'published')))
      .limit(1);

    await db
      .update(schema.topics)
      .set({ status: 'deleted' })
      .where(eq(schema.topics.id, victim.id));

    const after = await totalOf(KEYWORD);
    expect(after, '软删除主题仍计入总数').toBe(before - 1);

    const { ids } = await collectAll(KEYWORD);
    expect(ids, '已删除主题仍出现在结果里').not.toContain(victim.id);
  });
});
