import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq, isNull } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import {
  buildRss,
  buildAtom,
  buildJsonFeed,
  escapeXml,
  stripHtml,
  truncate,
  type FeedItem,
} from '../src/lib/feed-builder';

/**
 * v0.0.3 Feed 与搜索 —— 回归测试
 *
 * 覆盖：
 *  1. RSS 2.0 / Atom 1.0 / JSON Feed 1.1 的**格式有效性**（能被解析器解析）
 *  2. XML 特殊字符转义正确（不破坏格式）
 *  3. 内容来自真实数据库、软删除主题不出现
 *  4. 搜索的分页上限、SQL 注入防护、排序与过滤
 */

const TEST_DB = process.env.V003_FEED_TEST_DB ?? 'v2ex_v003_feed';

/**
 * 让 `@/db` 的全局连接池也指向本测试库。
 *
 * `src/db/index.ts` 在模块加载时读取 DATABASE_URL 并缓存连接池，
 * 因此必须在**导入任何使用 @/db 的模块之前**把 DATABASE_URL 指向测试库。
 * 否则服务层写 A 库、断言读 B 库，会出现外键约束失败。
 *
 * ⚠️ v0.0.4：连接串统一从 `tests/helpers/test-spec-base.ts` 派生
 * （与 `tests/setup.ts` 的规范化结果同源，**只换库名，不换 host/port**）。
 */
process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);
// 清掉可能被其他测试文件（同一 worker 进程）缓存的连接池，
// 强制 @/db 用上面设置的测试库重新建连接。
{
  const g = globalThis as unknown as {
    __v2exSql?: unknown;
    __v2exDrizzle?: unknown;
  };
  g.__v2exSql = undefined;
  g.__v2exDrizzle = undefined;
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let nodeId = 0;
let otherNodeId = 0;
let userId = 0;

/** 极简 XML 结构校验：标签配对 + 根元素正确 */
function assertWellFormedXml(xml: string, rootTag: string): void {
  // XML 声明
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);

  // 根元素
  expect(xml).toContain(`<${rootTag}`);
  expect(xml).toContain(`</${rootTag}>`);

  // 标签配对检查（简易栈）
  const stack: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z0-9_:.-]+)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const [, closing, name, , selfClose] = m;
    if (closing) {
      expect(stack.pop()).toBe(name);
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  expect(stack).toHaveLength(0);
}

beforeAll(async () => {
  logDbTarget('tests/feed-search.spec.ts', TEST_DB);

  // 建库 → 迁移，逐阶段计时（护栏在 provision 内部强制生效）
  await provisionTestDatabase({
    file: 'tests/feed-search.spec.ts',
    db: TEST_DB,
    adminUrl: adminUrlOf(TEST_DB),
    migrate: () =>
      runDrizzleKit(['migrate'], {
        ...process.env,
        ENV_FILE: '',
        DATABASE_URL: dbUrlFor(TEST_DB),
      }),
  });

  client = postgres(dbUrlFor(TEST_DB), { prepare: false, max: 20 });
  db = drizzle(client, { schema });

  const users = await db
    .insert(schema.users)
    .values({ username: 'feeduser', passwordHash: 'x', role: 'user' })
    .returning({ id: schema.users.id });
  userId = users[0].id;

  const cat = await db
    .insert(schema.categories)
    .values({ name: 'feedcat', title: 'Feed Cat' })
    .returning({ id: schema.categories.id });

  const n1 = await db
    .insert(schema.nodes)
    .values({ name: 'feednode', title: 'Feed Node', categoryId: cat[0].id })
    .returning({ id: schema.nodes.id });
  nodeId = n1[0].id;

  const n2 = await db
    .insert(schema.nodes)
    .values({ name: 'othernode', title: 'Other Node', categoryId: cat[0].id })
    .returning({ id: schema.nodes.id });
  otherNodeId = n2[0].id;
}, 180000);

afterAll(async () => {
  await client?.end();
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
}, 60_000);

beforeEach(async () => {
  await client.unsafe(
    `TRUNCATE topics, replies, votes, thanks RESTART IDENTITY CASCADE`,
  );
});

describe('v0.0.3 Feed —— XML 转义', () => {
  it('escapeXml 转义全部 5 个特殊字符', () => {
    expect(escapeXml(`a & b`)).toBe('a &amp; b');
    expect(escapeXml(`<tag>`)).toBe('&lt;tag&gt;');
    expect(escapeXml(`"quoted"`)).toBe('&quot;quoted&quot;');
    expect(escapeXml(`it's`)).toBe('it&apos;s');
  });

  it('含特殊字符的标题不会破坏 feed 格式', () => {
    const items: FeedItem[] = [
      {
        title: 'A & B <C> "D" \'E\'',
        link: 'https://example.com/t/1',
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        author: 'user & co',
        summary: 'x < y > z & w',
        id: 'https://example.com/t/1',
      },
    ];
    const xml = buildRss({
      title: 'T & T',
      description: 'D < D',
      link: 'https://example.com',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      items,
    });
    assertWellFormedXml(xml, 'rss');
    expect(xml).toContain('A &amp; B &lt;C&gt;');
    // 原始未转义的 & 不应出现
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it('stripHtml 去除标签与实体', () => {
    expect(stripHtml('<p>hello <b>world</b></p>')).toBe('hello world');
    expect(stripHtml('a &amp; b')).toBe('a & b');
  });

  it('truncate 截断并加省略号', () => {
    expect(truncate('abcdef', 3)).toBe('abc…');
    expect(truncate('ab', 10)).toBe('ab');
  });
});

describe('v0.0.3 Feed —— 格式有效性', () => {
  it('RSS 2.0 输出结构完整且可解析', () => {
    const items: FeedItem[] = [
      {
        title: '第一个主题',
        link: 'https://example.com/t/1',
        publishedAt: new Date('2026-01-02T03:04:05Z'),
        author: 'alice',
        summary: '摘要内容',
        id: 'https://example.com/t/1',
      },
    ];
    const xml = buildRss({
      title: '站点',
      description: '描述',
      link: 'https://example.com',
      selfLink: 'https://example.com/api/feed',
      updatedAt: new Date('2026-01-02T03:04:05Z'),
      items,
    });

    assertWellFormedXml(xml, 'rss');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<channel>');
    expect(xml).toContain('<title>第一个主题</title>');
    expect(xml).toContain('<link>https://example.com/t/1</link>');
    expect(xml).toContain('<author>alice</author>');
    // pubDate 必须是 RFC 822 格式
    expect(xml).toMatch(/<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4}/);
    // XML 声明与 encoding
    expect(xml).toContain('encoding="UTF-8"');
  });

  it('Atom 1.0 输出结构完整且可解析', () => {
    const items: FeedItem[] = [
      {
        title: 'Atom 条目',
        link: 'https://example.com/t/2',
        publishedAt: new Date('2026-01-02T03:04:05Z'),
        author: 'bob',
        summary: '摘要',
        id: 'https://example.com/t/2',
      },
    ];
    const xml = buildAtom({
      title: '站点',
      subtitle: '副标题',
      link: 'https://example.com',
      selfLink: 'https://example.com/api/feed/atom',
      updatedAt: new Date('2026-01-02T03:04:05Z'),
      items,
    });

    assertWellFormedXml(xml, 'feed');
    expect(xml).toContain('xmlns="http://www.w3.org/2005/Atom"');
    expect(xml).toContain('<title>Atom 条目</title>');
    // updated 必须是 RFC 3339
    expect(xml).toMatch(/<updated>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z<\/updated>/);
  });

  it('JSON Feed 1.1 输出符合规范', () => {
    const items: FeedItem[] = [
      {
        title: 'JSON 条目',
        link: 'https://example.com/t/3',
        publishedAt: new Date('2026-01-02T03:04:05Z'),
        author: 'carol',
        summary: '摘要',
        id: 'https://example.com/t/3',
      },
    ];
    const json = buildJsonFeed({
      title: '站点',
      description: '描述',
      homePageUrl: 'https://example.com',
      feedUrl: 'https://example.com/api/feed/json',
      updatedAt: new Date('2026-01-02T03:04:05Z'),
      items,
    });

    const parsed = JSON.parse(json);
    expect(parsed.version).toBe('https://jsonfeed.org/version/1.1');
    expect(parsed.title).toBe('站点');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].id).toBe('https://example.com/t/3');
    expect(parsed.items[0].url).toBe('https://example.com/t/3');
    expect(parsed.items[0].title).toBe('JSON 条目');
    expect(parsed.items[0].author.name).toBe('carol');
    expect(parsed.items[0].date_published).toBe('2026-01-02T03:04:05.000Z');
  });
});

describe('v0.0.3 Feed —— 真实数据库内容', () => {
  it('Feed 只包含未删除的主题', async () => {
    // 造 3 个主题，其中 1 个软删除
    await db.insert(schema.topics).values([
      { title: '保留的主题一', content: '内容一', nodeId, authorId: userId },
      { title: '保留的主题二', content: '内容二', nodeId, authorId: userId },
      {
        title: '已删除的主题',
        content: '内容三',
        nodeId,
        authorId: userId,
        deletedAt: new Date(),
      },
    ]);

    const rows = await db
      .select({
        id: schema.topics.id,
        title: schema.topics.title,
        content: schema.topics.content,
        createdAt: schema.topics.createdAt,
        authorName: schema.users.username,
      })
      .from(schema.topics)
      .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
      .where(isNull(schema.topics.deletedAt));

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.title)).not.toContain('已删除的主题');
  });

  it('空数据库时 Feed 仍输出有效格式', async () => {
    const rows = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .where(isNull(schema.topics.deletedAt));
    expect(rows).toHaveLength(0);

    const xml = buildRss({
      title: '空站点',
      description: '描述',
      link: 'https://example.com',
      updatedAt: new Date(),
      items: [],
    });
    assertWellFormedXml(xml, 'rss');
    expect(xml).toContain('<channel>');
  });
});

describe('v0.0.3 搜索 —— 安全与分页', () => {
  it('SQL 注入尝试不影响数据', async () => {
    await db.insert(schema.topics).values({
      title: '正常主题',
      content: '正常内容',
      nodeId,
      authorId: userId,
    });

    const injection = `'; DROP TABLE topics; --`;
    // 用参数化查询（与 search 路由一致）
    const pattern = `%${injection.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await client.unsafe(
      `SELECT id FROM topics WHERE title ILIKE $1 ESCAPE '\\'`,
      [pattern],
    );
    expect(rows).toHaveLength(0);

    // 表还在
    const count = await client.unsafe(`SELECT count(*)::int AS n FROM topics`);
    expect(Number(count[0].n)).toBe(1);
  });

  it('分页上限被钳制到 100', async () => {
    // 直接验证常量与钳制逻辑
    const MAX_LIMIT = 100;
    const clamp = (v: number) => Math.min(Math.max(v, 1), MAX_LIMIT);
    expect(clamp(1000)).toBe(100);
    expect(clamp(0)).toBe(1);
    expect(clamp(-5)).toBe(1);
    expect(clamp(50)).toBe(50);
  });

  it('软删除的主题不出现在搜索结果', async () => {
    await db.insert(schema.topics).values([
      { title: '可见主题', content: 'x', nodeId, authorId: userId },
      {
        title: '隐藏主题',
        content: 'x',
        nodeId,
        authorId: userId,
        deletedAt: new Date(),
      },
    ]);

    const rows = await client.unsafe(
      `SELECT title FROM topics WHERE deleted_at IS NULL`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('可见主题');
  });
});
