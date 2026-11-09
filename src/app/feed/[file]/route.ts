import { loadLegacyFeed } from '@/server/legacy-feed';
import { buildLegacyAtom, buildLegacyJsonFeed } from '@/lib/legacy-feed-format';
import { resolveBaseUrl } from '@/lib/feed-builder';
import { feedCachedResponse } from '@/lib/feed-cache';
import {
  guardLegacyRateLimit,
  legacyRateLimitHeaders,
  legacyRateLimited,
  LEGACY_RATE_LIMIT,
  LEGACY_CACHE_SECONDS,
} from '@/lib/legacy-http';

export const dynamic = 'force-dynamic';

/**
 * GET /feed/{node}.xml  /  GET /feed/{node}.json —— **V2EX 旧版订阅路径兼容**
 *
 * ## 为什么需要（真实缺口）
 *
 * 原站的节点订阅地址是 `/feed/{node}.xml`（Atom 1.0）与 `/feed/{node}.json`
 * （JSON Feed 1.0）。本项目此前只在 `/api/nodes/{name}/feed` 提供 **RSS 2.0** ——
 *
 *   · **路径不同** ⇒ 任何按原站地址配置的 RSS 阅读器直接 404
 *   · **格式不同** ⇒ 即便路径对上，Atom 客户端也吃不下 RSS
 *
 * 这两点都是「高保真复刻」在 URL 层的实际缺口，不是可有可无的补充。
 *
 * ## 契约（2026-11-08 实测）
 *
 * | 请求 | 实测行为 |
 * |---|---|
 * | `/feed/programmer.xml` | 200，Atom 1.0，**50 条**，`application/atom+xml;charset=UTF-8`，`max-age=600` |
 * | `/feed/programmer.json` | 200，JSON Feed **1.0**（`version: https://jsonfeed.org/version/1`），50 条，`max-age=1800` |
 * | `/feed/zzz_nomode.xml` | **404**（原站是 HTML 404 页，这里返回一致的 JSON 404 体） |
 * | `/feed/PROGRAMMER.xml` | **200**（本项目节点名大小写不敏感：正则带 `/i`，查库 `toLowerCase()`；原站该行为无法验证，属有意策略，见 `docs/LEGACY_API_MATRIX_v0.0.13.md`） |
 * | `/feed/all.xml` | 200 且 **body 长度为 0**（原站如此——视为原站缺陷，**不复刻**） |
 *
 * 关于 `all.xml`：原站返回 200 但 body 为空，任何阅读器拿到都会解析失败。
 * 本项目**不复制这个缺陷** —— `/feed/all.xml` 返回全站最新 50 条的合法 Atom。
 * 这是**有意偏离**，已在 `docs/API_SPEC.md` §14 登记。
 *
 * ## 路由实现说明
 *
 * Next.js 的动态段不能直接表达「`.xml` / `.json` 后缀」，因此用
 * `[file]` 接住 `programmer.xml` 这样的整段，再在代码里拆后缀。
 * 这样 `/feed/programmer.xml`、`/feed/programmer.json`、
 * `/feed/all.xml`、`/feed/all.json` 四条路径都由本文件处理。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const rl = await guardLegacyRateLimit('feed');
  if (!rl.ok) return legacyRateLimited(rl);

  const { file } = await params;
  const raw = String(file ?? '');

  // 拆后缀：只接受 .xml / .json（原站无扩展名一律 404 —— 实测）
  const match = raw.match(/^([a-z0-9][a-z0-9_-]{0,63})\.(xml|json)$/i);
  if (!match) {
    return new Response(
      JSON.stringify({
        status: 'error',
        message: 'Object Not Found',
        rate_limit: {
          used: rl.count,
          quota: LEGACY_RATE_LIMIT,
          reset_at: Math.floor(rl.resetAt / 1000),
        },
      }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          ...legacyRateLimitHeaders(rl),
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  }

  const nodeName = match[1];
  const format = match[2].toLowerCase() as 'xml' | 'json';

  // `all` 是全站（原站该路径返回空 body，本项目返回合法全站 Feed —— 有意偏离）
  const isAll = nodeName.toLowerCase() === 'all';

  // 只用配置的 PUBLIC_BASE_URL → APP_URL（Host 头不可信，见 src/lib/public-base-url.ts）
  const origin = resolveBaseUrl(request.url);
  const channel = await loadLegacyFeed({
    origin,
    // `all` 不传 nodeName ⇒ 全站
    ...(isAll ? {} : { nodeName }),
  });

  if (!channel) {
    return new Response(
      JSON.stringify({
        status: 'error',
        message: 'Object Not Found',
        rate_limit: {
          used: rl.count,
          quota: LEGACY_RATE_LIMIT,
          reset_at: Math.floor(rl.resetAt / 1000),
        },
      }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          ...legacyRateLimitHeaders(rl),
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  }

  // v0.0.13（V13-06）：ETag / 304 条件请求。阅读器轮询时若内容未变，
  // 返回 304 且不发正文；ETag 由最终序列化 body 的 SHA-256 计算。
  if (format === 'json') {
    return feedCachedResponse(request, buildLegacyJsonFeed(channel), {
      // 实测原文：`application/json;charset=utf-8`（小写 utf-8）
      'Content-Type': 'application/json;charset=utf-8',
      'Cache-Control': `public, max-age=${LEGACY_CACHE_SECONDS.feedJson}`,
      ...legacyRateLimitHeaders(rl),
      'X-Content-Type-Options': 'nosniff',
    });
  }

  return feedCachedResponse(request, buildLegacyAtom(channel), {
    // 实测原文：`application/atom+xml;charset=UTF-8`
    'Content-Type': 'application/atom+xml;charset=UTF-8',
    'Cache-Control': `public, max-age=${LEGACY_CACHE_SECONDS.feedAtom}`,
    ...legacyRateLimitHeaders(rl),
    'X-Content-Type-Options': 'nosniff',
  });
}
