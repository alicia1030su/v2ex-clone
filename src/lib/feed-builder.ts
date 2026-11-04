import 'server-only';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import * as schema from '@/db/schema';

/**
 * Feed 构建器（v0.0.3）
 *
 * 输出 RSS 2.0 / Atom 1.0 / JSON Feed 1.1 三种标准格式。
 *
 * ## 关键约束
 *
 * 1. **必须转义 XML 特殊字符** —— 标题/正文里的 `& < > " '`
 *    若不转义会直接破坏 feed 格式（解析器报错）。
 * 2. **内容来自真实数据库** —— `buildFeedEntries()` 直接查 topics/users/nodes，
 *    软删除（`deleted_at` 非空 **或** `status = 'deleted'`）的主题一律不出现。
 * 3. **时间用 RFC 822 / RFC 3339** —— RSS 用 RFC 822（`Date.toUTCString()`），
 *    Atom 与 JSON Feed 用 RFC 3339（`toISOString()`）。
 * 4. **link 必须是绝对 URL** —— RSS/Atom 规范要求绝对地址，
 *    订阅端在本地打开相对路径会失效。
 * 5. **不写死演示数据** —— 本模块的所有内容都来自数据库查询结果。
 */

/** drizzle 实例类型（与 `src/db/index.ts` 导出的 `db` 一致） */
export type FeedDatabase = ReturnType<typeof drizzle<typeof schema>>;

export type FeedItem = {
  title: string;
  link: string;
  /** 发布时间 */
  publishedAt: Date;
  author: string | null;
  /** 摘要 / 描述（纯文本，已剥离 HTML） */
  summary: string;
  /** 内容 ID（Atom 的 id / JSON Feed 的 id） */
  id: string;
  /** 作者主页（绝对 URL）—— JSON Feed 1.1 的 authors[].url */
  authorUrl?: string;
  /** 所属节点名（RSS category） */
  nodeName?: string;
  /** 所属节点标题（RSS category 显示名） */
  nodeTitle?: string;
};

/** 数据库查询出的 feed 条目 */
export type FeedEntry = {
  id: number;
  title: string;
  /** 主题绝对链接 */
  url: string;
  authorName: string;
  /** 作者主页绝对链接 */
  authorUrl: string;
  /** 摘要（纯文本） */
  summary: string;
  /** 发布时间 */
  publishedAt: Date;
  /** 最后活跃时间 */
  updatedAt: Date;
  nodeName: string;
  nodeTitle: string;
  nodeUrl: string;
  repliesCount: number;
};

/** feed 最多输出的条目数 */
export const FEED_MAX_ITEMS = 30;

/**
 * XML 1.0 不允许出现的控制字符。
 * 即便 `& < >` 都已转义，这些字符仍会让 XML 解析器直接报错。
 */
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/**
 * XML 文本 / 属性值转义。
 *
 * 顺序很重要：必须**先**转义 `&`，否则后面转义出来的 `&lt;` 会被二次转义。
 */
export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 剥离 HTML 标签，得到纯文本摘要 */
export function stripHtml(value: string): string {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 摘要截断 */
export function truncate(value: string, max = 300): string {
  const t = stripHtml(value);
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * 剥离 Markdown 标记，得到纯文本摘要。
 *
 * 主题正文在库里是 Markdown，直接放进 feed 会把 `**加粗**` 之类的标记
 * 暴露给订阅端，因此这里剥离掉（不引入 @/lib/markdown 以免带上渲染依赖）。
 */
export function stripMarkdown(value: string, maxLength = 300): string {
  const text = String(value ?? '')
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图片] ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * 归一化站点根地址：保留 origin + path 前缀，去掉末尾斜杠。
 * （支持部署在子路径下，如 https://example.com/forum）
 */
export function normalizeBaseUrl(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.origin}${path}`;
  } catch {
    return baseUrl.replace(/\/+$/, '');
  }
}

/**
 * 推导 feed 使用的站点根地址。
 *
 * 优先级：PUBLIC_BASE_URL → APP_URL → NEXT_PUBLIC_APP_URL → 请求自身的 origin。
 * 前三者用于「反代后请求头被改写」的场景 —— 请求的 origin 可能是内网地址。
 */
export function resolveBaseUrl(requestUrl: string): string {
  const candidates = [
    process.env.PUBLIC_BASE_URL,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    try {
      return normalizeBaseUrl(value);
    } catch {
      // 非法配置 → 忽略并尝试下一个
    }
  }
  try {
    return normalizeBaseUrl(new URL(requestUrl).origin);
  } catch {
    return 'http://localhost:3000';
  }
}

/**
 * 查询 feed 条目（**真实数据库内容**）。
 *
 * @param db drizzle 实例（由调用方注入，测试可指向专用库，不会误连开发库）
 * @param opts.baseUrl 站点根地址（绝对）
 * @param opts.nodeId 仅取该节点下的主题（可选）
 * @param opts.limit 条目数上限
 */
export async function buildFeedEntries(
  db: FeedDatabase,
  opts: { baseUrl: string; nodeId?: number; limit?: number },
): Promise<FeedEntry[]> {
  const base = normalizeBaseUrl(opts.baseUrl);
  const limit = Math.min(Math.max(opts.limit ?? FEED_MAX_ITEMS, 1), FEED_MAX_ITEMS);

  const conditions = [
    // 软删除的主题不得出现在 feed 里：
    // deleted_at 非空（v0.0.3 软删除标记）或 status = 'deleted'（旧数据兼容）
    isNull(schema.topics.deletedAt),
    ne(schema.topics.status, 'deleted'),
  ];
  if (opts.nodeId != null) {
    conditions.push(eq(schema.topics.nodeId, opts.nodeId));
  }

  const rows = await db
    .select({
      id: schema.topics.id,
      title: schema.topics.title,
      content: schema.topics.content,
      createdAt: schema.topics.createdAt,
      lastReplyAt: schema.topics.lastReplyAt,
      repliesCount: schema.topics.repliesCount,
      authorName: schema.users.username,
      nodeName: schema.nodes.name,
      nodeTitle: schema.nodes.title,
    })
    .from(schema.topics)
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(and(...conditions))
    .orderBy(desc(schema.topics.lastReplyAt), desc(schema.topics.id))
    .limit(limit);

  return rows.map((row) => {
    const url = `${base}/t/${row.id}`;
    return {
      id: row.id,
      title: row.title,
      url,
      authorName: row.authorName,
      authorUrl: `${base}/member/${encodeURIComponent(row.authorName)}`,
      summary: stripMarkdown(row.content ?? '', 300),
      publishedAt: row.createdAt,
      updatedAt: row.lastReplyAt,
      nodeName: row.nodeName,
      nodeTitle: row.nodeTitle,
      nodeUrl: `${base}/go/${row.nodeName}`,
      repliesCount: row.repliesCount,
    };
  });
}

/** FeedEntry → FeedItem（供下面的三种格式化函数使用） */
export function toFeedItem(entry: FeedEntry): FeedItem {
  return {
    title: entry.title,
    link: entry.url,
    publishedAt: entry.publishedAt,
    author: entry.authorName,
    summary: entry.summary,
    id: entry.url,
    authorUrl: entry.authorUrl,
    nodeName: entry.nodeName,
    nodeTitle: entry.nodeTitle,
  };
}

/** 构造 RSS 2.0 */
export function buildRss(opts: {
  title: string;
  description: string;
  link: string;
  selfLink?: string;
  updatedAt: Date;
  items: FeedItem[];
}): string {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
  );
  parts.push('  <channel>');
  parts.push(`    <title>${escapeXml(opts.title)}</title>`);
  parts.push(`    <link>${escapeXml(opts.link)}</link>`);
  parts.push(`    <description>${escapeXml(opts.description)}</description>`);
  parts.push('    <language>zh-cn</language>');
  parts.push(
    `    <lastBuildDate>${opts.updatedAt.toUTCString()}</lastBuildDate>`,
  );
  if (opts.selfLink) {
    parts.push(
      `    <atom:link href="${escapeXml(opts.selfLink)}" rel="self" type="application/rss+xml"/>`,
    );
  }

  for (const item of opts.items) {
    parts.push('    <item>');
    parts.push(`      <title>${escapeXml(item.title)}</title>`);
    parts.push(`      <link>${escapeXml(item.link)}</link>`);
    parts.push(`      <guid isPermaLink="false">${escapeXml(item.id)}</guid>`);
    if (item.author) {
      parts.push(`      <author>${escapeXml(item.author)}</author>`);
      parts.push(`      <dc:creator>${escapeXml(item.author)}</dc:creator>`);
    }
    if (item.nodeTitle) {
      parts.push(`      <category>${escapeXml(item.nodeTitle)}</category>`);
    }
    parts.push(
      `      <pubDate>${item.publishedAt.toUTCString()}</pubDate>`,
    );
    parts.push(`      <description>${escapeXml(item.summary)}</description>`);
    parts.push('    </item>');
  }

  parts.push('  </channel>');
  parts.push('</rss>');
  return parts.join('\n');
}

/** 构造 Atom 1.0 */
export function buildAtom(opts: {
  title: string;
  subtitle: string;
  link: string;
  selfLink: string;
  updatedAt: Date;
  items: FeedItem[];
}): string {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-cn">',
  );
  parts.push(`  <title>${escapeXml(opts.title)}</title>`);
  parts.push(`  <subtitle>${escapeXml(opts.subtitle)}</subtitle>`);
  parts.push(`  <id>${escapeXml(opts.selfLink)}</id>`);
  parts.push(
    `  <updated>${opts.updatedAt.toISOString()}</updated>`,
  );
  parts.push(`  <link rel="alternate" type="text/html" href="${escapeXml(opts.link)}"/>`);
  parts.push(`  <link rel="self" type="application/atom+xml" href="${escapeXml(opts.selfLink)}"/>`);

  for (const item of opts.items) {
    parts.push('  <entry>');
    parts.push(`    <title>${escapeXml(item.title)}</title>`);
    parts.push(`    <id>${escapeXml(item.id)}</id>`);
    parts.push(`    <link rel="alternate" type="text/html" href="${escapeXml(item.link)}"/>`);
    parts.push(`    <updated>${item.publishedAt.toISOString()}</updated>`);
    if (item.author) {
      parts.push('    <author>');
      parts.push(`      <name>${escapeXml(item.author)}</name>`);
      if (item.authorUrl) {
        parts.push(`      <uri>${escapeXml(item.authorUrl)}</uri>`);
      }
      parts.push('    </author>');
    }
    parts.push(`    <summary>${escapeXml(item.summary)}</summary>`);
    parts.push('  </entry>');
  }

  parts.push('</feed>');
  return parts.join('\n');
}

/** 构造 JSON Feed 1.1 */
export function buildJsonFeed(opts: {
  title: string;
  description: string;
  homePageUrl: string;
  feedUrl: string;
  updatedAt: Date;
  items: FeedItem[];
}): string {
  const payload = {
    version: 'https://jsonfeed.org/version/1.1',
    title: opts.title,
    description: opts.description,
    home_page_url: opts.homePageUrl,
    feed_url: opts.feedUrl,
    language: 'zh-CN',
    updated_at: opts.updatedAt.toISOString(),
    items: opts.items.map((item) => ({
      id: item.id,
      url: item.link,
      title: item.title,
      content_text: item.summary,
      date_published: item.publishedAt.toISOString(),
      // JSON Feed 1.1 用 authors 数组；author 为 1.0 的旧字段，一并保留以兼容旧客户端
      authors: [
        {
          name: item.author ?? '',
          ...(item.authorUrl ? { url: item.authorUrl } : {}),
        },
      ],
      ...(item.author ? { author: { name: item.author } } : {}),
      ...(item.nodeTitle ? { tags: [item.nodeTitle] } : {}),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/** 从请求推导站点根地址（优先 PUBLIC_BASE_URL） */
export function siteOrigin(request: Request): string {
  const configured =
    process.env.PUBLIC_BASE_URL?.trim() || process.env.APP_URL?.trim();
  if (configured) return normalizeBaseUrl(configured);
  const url = new URL(request.url);
  return url.origin;
}
