import { createHash } from 'node:crypto';

/**
 * Feed 的 **ETag / 304** 共用实现（v0.0.13 / V13-06）
 *
 * ## 为什么需要
 *
 * 订阅阅读器按小时轮询 Feed。此前本项目所有 Feed 只发
 * `Cache-Control: max-age=…`，没有 `ETag`，阅读器每次都要下载完整
 * 50 条正文；加了 `ETag` 后才谈得上「按现有 HTTP 缓存规范合理实现条件请求」。
 *
 * ## 口径
 *
 * - ETag = 响应体字节的 SHA-256 十六进制（**强校验**），带双引号
 * - `If-None-Match` 支持 `*`、逗号分隔列表与 `W/` 弱前缀
 * - 命中返回 **304**，body 为空，保留 `ETag` / `Cache-Control` /
 *   `Content-Type` / `Vary`（不重复发正文）
 * - 未命中返回 200 并带上 `ETag` 与 `Vary: Accept-Encoding`
 *
 * 注意：ETag 由**最终序列化后的 body** 计算，因此与 `Content-Encoding`
 * 解耦；纯函数 `feedEtag()` 可在静态单测里确定性验证。
 */

export function feedEtag(body: string): string {
  return `"${createHash('sha256').update(body, 'utf8').digest('hex')}"`;
}

/** 解析 If-None-Match；返回归一化后的 tag 集合与是否包含通配符 */
export function parseIfNoneMatch(header: string | null): { tags: string[]; any: boolean } {
  if (!header) return { tags: [], any: false };
  const raw = header.trim();
  if (raw === '*') return { tags: [], any: true };
  return {
    tags: raw
      .split(',')
      .map((t) => t.trim().replace(/^W\//, ''))
      .filter((t) => t.length > 0),
    any: false,
  };
}

export function ifNoneMatchHits(header: string | null, etag: string): boolean {
  const { tags, any } = parseIfNoneMatch(header);
  return any || tags.includes(etag);
}

/**
 * 把已经序列化好的 Feed body 包装成带条件请求能力的 Response。
 *
 * @param headers 必须包含 Content-Type / Cache-Control；本函数只追加 ETag / Vary
 */
export function feedCachedResponse(
  request: Request,
  body: string,
  headers: Record<string, string>,
): Response {
  const etag = feedEtag(body);
  const base: Record<string, string> = {
    ...headers,
    ETag: etag,
    Vary: 'Accept-Encoding',
  };

  if (ifNoneMatchHits(request.headers.get('if-none-match'), etag)) {
    // 304 不得带 body；Content-Length 也不发
    return new Response(null, { status: 304, headers: base });
  }
  return new Response(body, { status: 200, headers: base });
}
