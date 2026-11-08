import { resolveBaseUrl } from '@/lib/feed-builder';
import { loadLegacyTopics } from '@/server/legacy-topics';
import {
  LEGACY_LATEST_LIMIT,
  guardLegacyRateLimit,
  legacyJsonHeaders,
  legacyRateLimited,
} from '@/lib/legacy-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/topics/latest.json —— **V2EX 旧版「最新主题」端点**
 *
 * ## 契约（2026-11-08 实测，三次探测结果一致）
 *
 * - 200，**数组**，元素形状与 `/api/topics/show.json` **完全同构**（13 个键）
 * - 实测原站固定返回 **35** 条，`created` 降序（跨度约 7.6 小时）
 * - `?limit=` / `?page=` / `?p=` / `?node_name=` **全部被忽略**（实测）
 * - 响应头：`application/json;charset=UTF-8`、`Cache-Control: public, max-age=120`
 *
 * ## 为什么是 35
 *
 * 原站没有文档说明这个数字。三次探测（间隔数秒）都返回 35 条且首末 id 相同，
 * 说明**不是**「最近 N 小时」这类时间窗（否则会随抓取时刻漂移），
 * 而是固定条数。本项目沿用 35，并注明「数字来源是实测，不是规格」。
 *
 * ## 与 `/api/topics/show.json?node_name=` 的区别
 *
 * 后者是**单节点**过滤（10 条），前者是**全站**最新（35 条）。
 * 两者形状相同、语义不同，都实现；装配逻辑共用
 * `src/server/legacy-topics.ts`，避免两处口径漂移。
 */
export async function GET(request: Request) {
  const rl = await guardLegacyRateLimit('topics-latest');
  if (!rl.ok) return legacyRateLimited(rl);

  const origin = resolveBaseUrl(request.url);
  const topics = await loadLegacyTopics({
    filter: { kind: 'latest' },
    limit: LEGACY_LATEST_LIMIT,
    origin,
  });

  return new Response(JSON.stringify(topics), {
    status: 200,
    headers: legacyJsonHeaders(rl, 120),
  });
}
