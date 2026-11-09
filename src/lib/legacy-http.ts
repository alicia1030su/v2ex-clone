import 'server-only';
import { NextResponse } from 'next/server';
import { rateLimitByIp } from '@/lib/rate-limit';
import { legacyNotFound } from '@/lib/legacy-topic-api';
import {
  LEGACY_RATE_LIMIT,
  LEGACY_RATE_WINDOW_SECONDS,
} from '@/lib/legacy-constants';

// 常量统一由纯模块提供（静态护栏不能 import server-only 模块）
export * from '@/lib/legacy-constants';

/**
 * 旧版 V2EX API / Feed 的**共用 HTTP 基础设施**
 *
 * ## 为什么要抽出来
 *
 * v0.0.13 一次性补齐了 6 个旧版端点（`/api/topics/show.json`、`latest.json`、
 * `members/show.json`、`nodes/show.json`、`nodes/all.json`、`/feed/{node}.xml|json`）。
 * 它们共享同一套横切关注点：
 *
 *   · **限流**：原站所有 `/api/*` 共用 600 次/小时的配额，并回写三元组响应头
 *   · **错误体**：`{status:'error',message:'Object Not Found',rate_limit:{...}}`
 *   · **响应头**：`application/json;charset=UTF-8` + 各自的 `Cache-Control`
 *
 * 如果每个路由各写一遍，迟早会出现「某个端点的错误体字段不一样」这种
 * 只有第三方客户端才会踩到的问题。集中一处，逐个端点只声明**自己的**差异
 * （缓存时长、Content-Type、是否有 status 字段）。
 *
 * ## 配额口径
 *
 * 原站实测 `x-rate-limit-limit: 600`（每 IP 每小时）。本项目沿用同一数字，
 * 但**计数是按端点分别统计的**（`scope` 不同）—— 与原站「全局共享配额」
 * 略有差异。这是刻意的：本项目的限流实现按 scope 分桶，
 * 共用一个大桶会让「某个端点被脚本打满」影响全部端点。
 * 该差异已在 `docs/API_SPEC.md` §14 登记。
 */


export type LegacyRateLimit = {
  count: number;
  limit: number;
  resetAt: number;
  ok: boolean;
  retryAfterSeconds: number;
};

/** 统一的 JSON 响应头 */
/**
 * 旧版 API 的限流状态三元组（P2-7）。
 *
 * 所有经过 `guardLegacyRateLimit()` 的响应都应当回写同一组头 ——
 * 包括 400 / 404 / 304 / 200。此前只有 `legacyJsonHeaders()` 带这组头，
 * 于是 `nodes/list.json` 缺参 400、Feed 的 200/404/304 都少了它，
 * 客户端无法得知配额余量。抽成共用函数避免各处拼装漂移。
 */
export function legacyRateLimitHeaders(rl: LegacyRateLimit): Record<string, string> {
  return {
    'x-rate-limit-limit': String(rl.limit),
    'x-rate-limit-remaining': String(Math.max(0, rl.limit - rl.count)),
    'x-rate-limit-reset': String(Math.floor(rl.resetAt / 1000)),
  };
}

export function legacyJsonHeaders(
  rl: LegacyRateLimit,
  cacheSeconds: number,
  withCharsetSpace = false,
): Record<string, string> {
  return {
    // 原站两种写法并存：topics 系为 `application/json;charset=UTF-8`，
    // members/show.json 为 `application/json; charset=UTF-8`（带空格）。
    // 这里照抄各自实测值 —— 有客户端会做字符串比较。
    'Content-Type': withCharsetSpace
      ? 'application/json; charset=UTF-8'
      : 'application/json;charset=UTF-8',
    'Cache-Control': `public, max-age=${cacheSeconds}`,
    ...legacyRateLimitHeaders(rl),
    'X-Content-Type-Options': 'nosniff',
  };
}

/** 限流超限响应（429） */
export function legacyRateLimited(rl: LegacyRateLimit): NextResponse {
  return NextResponse.json(
    {
      status: 'error',
      message: 'Rate Limit Exceeded',
      rate_limit: {
        used: rl.count,
        quota: rl.limit,
        reset_at: Math.floor(rl.resetAt / 1000),
      },
    },
    {
      status: 429,
      headers: {
        ...legacyJsonHeaders(rl, 0),
        'Retry-After': String(rl.retryAfterSeconds),
      },
    },
  );
}

/** 404 错误响应（原站形状） */
export function legacyNotFoundResponse(rl: LegacyRateLimit, cacheSeconds = 0): NextResponse {
  return NextResponse.json(
    legacyNotFound(rl.count, rl.limit, Math.floor(rl.resetAt / 1000)),
    { status: 404, headers: legacyJsonHeaders(rl, cacheSeconds) },
  );
}

/**
 * 执行限流。
 *
 * @param scope 端点标识（每个端点独立计数，见文件头「配额口径」）
 */
export async function guardLegacyRateLimit(scope: string): Promise<LegacyRateLimit> {
  const rl = await rateLimitByIp(`legacy-api-${scope}`, LEGACY_RATE_LIMIT, LEGACY_RATE_WINDOW_SECONDS);
  return {
    count: rl.count,
    limit: rl.limit,
    resetAt: rl.resetAt,
    ok: rl.ok,
    retryAfterSeconds: rl.retryAfterSeconds,
  };
}

/**
 * `/api/nodes/list.json` 缺参响应 —— 原站实测是 **400 + 极简 HTML**：
 * `Content-Type: text/html; charset=UTF-8`，body
 * `<html><title>400: Bad Request</title><body>400: Bad Request</body></html>`。
 *
 * 与其余端点的 JSON 错误体**刻意不同**：这是原站行为，照抄而不是「顺手统一」。
 * 已在 `docs/API_SPEC.md` §14.4 登记。
 *
 * v0.0.13（P2-7）：body / 状态码照抄原站，但**响应头**仍要回写本项目的
 * 限流三元组 —— 该请求已经过 `guardLegacyRateLimit()`，客户端应能看到配额。
 */
export function legacyBadRequest(rl?: LegacyRateLimit): NextResponse {
  return new NextResponse(
    '<html><title>400: Bad Request</title><body>400: Bad Request</body></html>',
    {
      status: 400,
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'no-store',
        ...(rl ? legacyRateLimitHeaders(rl) : {}),
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
