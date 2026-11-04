import 'server-only';

/**
 * Feed 构建器（v0.0.3）
 *
 * 输出 RSS 2.0 / Atom 1.0 / JSON Feed 1.1 三种标准格式。
 *
 * ## 关键约束
 *
 * 1. **必须转义 XML 特殊字符** —— 标题/正文里的 `& < > " '`
 *    若不转义会直接破坏 feed 格式（解析器报错）。
 * 2. **内容来自真实数据库** —— 本模块只负责格式化，数据由调用方传入。
 * 3. **时间用 RFC 822 / RFC 3339** —— RSS 用 RFC 822（`Date.toUTCString()`），
 *    Atom 与 JSON Feed 用 RFC 3339（`toISOString()`）。
 */

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
};

/** XML 文本转义 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 剥离 HTML 标签，得到纯文本摘要 */
export function stripHtml(value: string): string {
  return value
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
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
  );
  parts.push('  <channel>');
  parts.push(`    <title>${escapeXml(opts.title)}</title>`);
  parts.push(`    <link>${escapeXml(opts.link)}</link>`);
  parts.push(`    <description>${escapeXml(opts.description)}</description>`);
  parts.push(`    <language>zh-cn</language>`);
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
      parts.push(`    <author><name>${escapeXml(item.author)}</name></author>`);
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
      ...(item.author ? { author: { name: item.author } } : {}),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/** 从请求推导站点根地址（优先 PUBLIC_BASE_URL） */
export function siteOrigin(request: Request): string {
  const configured =
    process.env.PUBLIC_BASE_URL?.trim() || process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const url = new URL(request.url);
  return url.origin;
}
