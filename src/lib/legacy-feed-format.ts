/**
 * 旧版 `/feed/{node}.xml` 与 `/feed/{node}.json` 的**纯格式化层**
 *
 * ## 为什么与数据装配分开
 *
 * 格式化只依赖「一个已装配好的频道对象」，**不需要数据库、不需要 server-only**。
 * 拆出来后：
 *
 *   · 可以在**纯静态单测**里验证元素顺序、版本号、时间格式、id 形状
 *     （这些是最容易被「顺手升级到新版本」改坏、而站内页面毫无变化的地方）
 *   · 数据装配层（`src/server/legacy-feed.ts`）只负责查库，不掺格式细节
 *
 * 第一版把两者写在一个文件里，静态护栏一 import 就撞上 `server-only`
 * 保护 —— 这本身就是「层次没切干净」的信号。
 *
 * ## 形状来源（全部 2026-11-08 实测）
 *
 * | 项 | 原站 `/feed/{node}.xml` | 原站 `/feed/{node}.json` |
 * |---|---|---|
 * | 格式 | Atom 1.0 | JSON Feed **1.0**（`jsonfeed.org/version/1`） |
 * | 条数 | 50 | 50 |
 * | feed 级顺序 | title→subtitle→icon→logo→link→link→id→updated | — |
 * | 条目 id | `tag:host,YYYY-MM-DD:/t/{id}` | 主题绝对地址 |
 * | 条目 link/url | `/t/{id}#reply{N}`（带楼层锚点） | 同（带锚点） |
 * | 正文 | `<content type="html">` CDATA | `content_html`（无 `content_text`/`summary`） |
 * | 作者 | `<author><name/><uri/></author>` | `author{url,name,avatar}`（**1.0 的 `author{}`**） |
 * | 时间 | `published` + `updated`，秒级 `Z` | `date_published`，`+00:00` 偏移 |
 */

/** 原站 Feed 固定 50 条（实测 `.xml` 与 `.json` 均为 50） */
export const LEGACY_FEED_ITEMS = 50;

export type LegacyFeedEntry = {
  topicId: number;
  title: string;
  /** 带楼层锚点的详情地址（原站形如 `/t/1255394#reply3`） */
  link: string;
  /** Atom `<id>`：`tag:host,YYYY-MM-DD:/t/{id}` */
  atomId: string;
  /** JSON Feed `id`：主题详情绝对地址（**与 link 故意不同**） */
  jsonId: string;
  contentHtml: string;
  publishedAt: Date;
  updatedAt: Date;
  authorName: string;
  authorUrl: string;
  authorAvatarLarge: string;
  repliesCount: number;
};

export type LegacyFeedChannel = {
  title: string;
  subtitle: string;
  homePageUrl: string;
  selfLinkAtom: string;
  selfLinkJson: string;
  iconUrl: string;
  logoUrl: string;
  updatedAt: Date;
  entries: LegacyFeedEntry[];
};

/** 转义 XML 文本节点 / 属性值 */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Date → 原站 Atom 的 `2026-11-08T14:39:45Z`（秒级，无毫秒） */
export function atomTime(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** Date → 原站 JSON Feed 的 `2026-11-08T14:39:45+00:00` */
export function jsonFeedTime(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, '+00:00');
}

/** Atom `<id>`：`tag:{host},{YYYY-MM-DD}:/t/{id}`（原站实测形状） */
export function atomIdOf(origin: string, topicId: number, createdAt: Date): string {
  const host = origin.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const day = createdAt.toISOString().slice(0, 10);
  return `tag:${host},${day}:/t/${topicId}`;
}

/**
 * 构造 Atom 1.0。
 *
 * ⚠️ **元素顺序是契约**：`title → subtitle → icon → logo →
 * link(alternate) → link(self) → id → updated → entry*`。
 * 有严格校验器（以及部分阅读器的容错边界）依赖这个顺序。
 */
export function buildLegacyAtom(channel: LegacyFeedChannel): string {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="utf-8"?>');
  parts.push('<feed xmlns="http://www.w3.org/2005/Atom">');
  parts.push(`<title>${escapeXmlText(channel.title)}</title>`);
  parts.push(`<subtitle>${escapeXmlText(channel.subtitle)}</subtitle>`);
  parts.push(`<icon>${escapeXmlText(channel.iconUrl)}</icon>`);
  parts.push(`<logo>${escapeXmlText(channel.logoUrl)}</logo>`);
  parts.push(
    `<link rel="alternate" type="text/html" href="${escapeXmlText(channel.homePageUrl)}" />`,
  );
  parts.push(
    `<link rel="self" type="application/atom+xml" href="${escapeXmlText(channel.selfLinkAtom)}" />`,
  );
  parts.push(`<id>${escapeXmlText(channel.homePageUrl)}</id>`);
  parts.push(`<updated>${atomTime(channel.updatedAt)}</updated>`);

  for (const entry of channel.entries) {
    parts.push('<entry>');
    parts.push(`\t<title>${escapeXmlText(entry.title)}</title>`);
    parts.push(
      `\t<link rel="alternate" type="text/html" href="${escapeXmlText(entry.link)}" />`,
    );
    parts.push(`\t<id>${escapeXmlText(entry.atomId)}</id>`);
    parts.push(`\t<published>${atomTime(entry.publishedAt)}</published>`);
    parts.push(`\t<updated>${atomTime(entry.updatedAt)}</updated>`);
    parts.push('\t<author>');
    parts.push(`\t\t<name>${escapeXmlText(entry.authorName)}</name>`);
    parts.push(`\t\t<uri>${escapeXmlText(entry.authorUrl)}</uri>`);
    parts.push('\t</author>');
    // 正文用 CDATA —— 原站是富文本 HTML；这里同样是已清洗的 HTML
    parts.push(
      `\t<content type="html" xml:base="${escapeXmlText(channel.homePageUrl)}"><![CDATA[${entry.contentHtml}]]></content>`,
    );
    parts.push('</entry>');
  }

  parts.push('</feed>');
  return parts.join('\n');
}

/**
 * 构造 JSON Feed **1.0**（`version: https://jsonfeed.org/version/1`）
 *
 * ⚠️ 刻意**不**用 1.1：1.1 用 `authors[]`、1.0 用 `author{}`；
 * 原站用的是 1.0 的 `author{}`，且条目**没有** `content_text` / `summary`。
 * 兼容端点的价值就在「照抄形状」，而不是「顺手升级到新版本」。
 */
export function buildLegacyJsonFeed(channel: LegacyFeedChannel): string {
  const payload = {
    version: 'https://jsonfeed.org/version/1',
    title: channel.title,
    description: channel.subtitle,
    home_page_url: channel.homePageUrl,
    feed_url: channel.selfLinkJson,
    icon: channel.iconUrl,
    favicon: channel.logoUrl,
    items: channel.entries.map((entry) => ({
      id: entry.jsonId,
      url: entry.link,
      title: entry.title,
      content_html: entry.contentHtml,
      date_published: jsonFeedTime(entry.publishedAt),
      author: {
        url: entry.authorUrl,
        name: entry.authorName,
        avatar: entry.authorAvatarLarge,
      },
    })),
  };
  return JSON.stringify(payload, null, 2);
}
