import { describe, it, expect } from 'vitest';
import {
  buildLegacyAtom,
  buildLegacyJsonFeed,
  LEGACY_FEED_ITEMS,
  escapeXmlText,
  type LegacyFeedChannel,
} from '../../src/lib/legacy-feed-format';

/**
 * v0.0.13（V10-24）：旧版 **Feed 路径与格式**的契约护栏
 *
 * ## 为什么这层护栏必须存在
 *
 * 原站节点订阅地址是 `/feed/{node}.xml`（**Atom 1.0**、50 条）与
 * `/feed/{node}.json`（**JSON Feed 1.0**）。本项目的站内 Feed 是
 * `/api/feed`（**RSS 2.0**、30 条、JSON Feed **1.1**）。
 *
 * 差异不只是路径，还有**三条硬约束**，任何一条被改坏都会让现成的
 * RSS/Atom 阅读器读不出来，而**站内页面毫无变化、单元测试也未必红**：
 *
 *  1. **Atom 元素顺序**：部分严格校验器要求 `title → subtitle → icon →
 *     logo → link → link → id → updated` 在 `entry` 之前
 *  2. **JSON Feed 版本号**：原站是 `https://jsonfeed.org/version/1`（**1.0**），
 *     1.0 用 `author{}` 而非 1.1 的 `authors[]`
 *  3. **条目 id 形状**：Atom 是 `tag:host,YYYY-MM-DD:/t/{id}`，
 *     JSON Feed 是主题绝对地址 —— 两者**故意不同**（照抄原站）
 *
 * 期望值全部来自 2026-11-08 对原站的真实抓取。
 */

function channel(overrides: Partial<LegacyFeedChannel> = {}): LegacyFeedChannel {
  return {
    title: '程序员',
    subtitle: 'way to explore',
    homePageUrl: 'https://example.test/go/programmer',
    selfLinkAtom: 'https://example.test/feed/programmer.xml',
    selfLinkJson: 'https://example.test/feed/programmer.json',
    iconUrl: 'data:image/svg+xml;base64,AAA',
    logoUrl: 'data:image/svg+xml;base64,BBB',
    updatedAt: new Date('2026-11-08T15:11:46Z'),
    entries: [
      {
        topicId: 1255394,
        title: '人月神话依旧存在',
        link: 'https://example.test/t/1255394#reply3',
        atomId: 'tag:example.test,2026-11-08:/t/1255394',
        jsonId: 'https://example.test/t/1255394',
        contentHtml: '<p>正文</p>',
        publishedAt: new Date('2026-11-08T14:39:45Z'),
        updatedAt: new Date('2026-11-08T15:11:46Z'),
        authorName: 'grandlq',
        authorUrl: 'https://example.test/member/grandlq',
        authorAvatarLarge: 'data:image/svg+xml;base64,CCC',
        repliesCount: 3,
      },
    ],
    ...overrides,
  };
}

describe('旧版 Feed · Atom 1.0 结构', () => {
  const xml = buildLegacyAtom(channel());

  it('声明 utf-8 并落在 Atom 1.0 命名空间', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
  });

  it('feed 级元素顺序与实测一致（title→subtitle→icon→logo→link→link→id→updated）', () => {
    const head = xml.slice(0, xml.indexOf('<entry>'));
    const order = [...head.matchAll(/<(\w+)[ >]/g)].map((m) => m[1]);
    expect(order).toEqual([
      'feed',
      'title',
      'subtitle',
      'icon',
      'logo',
      'link',
      'link',
      'id',
      'updated',
    ]);
  });

  it('两个 link 的 rel 分别是 alternate 与 self', () => {
    expect(xml).toContain('rel="alternate" type="text/html"');
    expect(xml).toContain('rel="self" type="application/atom+xml"');
  });

  it('entry 含 title/link/id/published/updated/author/content，正文用 CDATA 且标 type="html"', () => {
    const entry = xml.slice(xml.indexOf('<entry>'));
    for (const tag of ['title', 'link', 'id', 'published', 'updated', 'author', 'content']) {
      expect(entry, `entry 缺 <${tag}>`).toContain(`<${tag}`);
    }
    expect(entry).toContain('<content type="html"');
    expect(entry).toContain('<![CDATA[');
  });

  it('时间格式为 秒级 UTC（不带毫秒）', () => {
    expect(xml).toContain('<published>2026-11-08T14:39:45Z</published>');
    expect(xml).not.toMatch(/<published>[^<]*\.\d{3}Z/);
  });

  it('条目 id 是 tag:host,YYYY-MM-DD:/t/id 形状（原站实测）', () => {
    expect(xml).toContain('<id>tag:example.test,2026-11-08:/t/1255394</id>');
  });

  it('XML 特殊字符被正确转义（不破坏结构）', () => {
    const esc = escapeXmlText('a & b < c > d " e \' f');
    expect(esc).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f');
    // 整份文档里不得出现裸的 & （除实体）
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
  });
});

describe('旧版 Feed · JSON Feed 1.0 结构', () => {
  const raw = buildLegacyJsonFeed(channel());
  const feed = JSON.parse(raw) as Record<string, unknown>;

  it('版本号是 1.0（不是 1.1）', () => {
    expect(feed.version).toBe('https://jsonfeed.org/version/1');
  });

  it('顶层键与实测一致（无 updated_at / language / authors）', () => {
    expect(Object.keys(feed).sort()).toEqual(
      ['description', 'favicon', 'feed_url', 'home_page_url', 'icon', 'items', 'title', 'version'].sort(),
    );
  });

  it('条目用 1.0 的 author 对象（不是 1.1 的 authors 数组）', () => {
    const items = feed.items as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);
    const item = items[0];
    expect(Object.keys(item).sort()).toEqual(
      ['author', 'content_html', 'date_published', 'id', 'title', 'url'].sort(),
    );
    expect(item.authors).toBeUndefined();
    expect(item.content_text).toBeUndefined();
    const author = item.author as Record<string, string>;
    expect(Object.keys(author).sort()).toEqual(['avatar', 'name', 'url']);
  });

  it('date_published 用 +00:00 偏移写法（原站形状）', () => {
    const items = feed.items as Array<Record<string, unknown>>;
    expect(items[0].date_published).toBe('2026-11-08T14:39:45+00:00');
  });

  it('条目 id 是主题绝对地址、url 带楼层锚点（两个字段故意不同）', () => {
    const items = feed.items as Array<Record<string, unknown>>;
    expect(items[0].id).toBe('https://example.test/t/1255394');
    expect(items[0].url).toBe('https://example.test/t/1255394#reply3');
  });
});

describe('旧版 Feed · 条数与路径约定', () => {
  it('原站固定 50 条（实测 /feed/programmer.xml 与 .json 均为 50）', () => {
    expect(LEGACY_FEED_ITEMS).toBe(50);
  });
});
