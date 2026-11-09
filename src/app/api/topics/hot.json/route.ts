import { resolveBaseUrl } from '@/lib/feed-builder';
import { loadLegacyTopics } from '@/server/legacy-topics';
import {
  LEGACY_CACHE_SECONDS,
  LEGACY_HOT_LIMIT,
  guardLegacyRateLimit,
  legacyJsonHeaders,
  legacyRateLimited,
} from '@/lib/legacy-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/topics/hot.json —— **V2EX 旧版「热门主题」端点**（v0.0.13 / V13-02）
 *
 * ## 为什么上一轮漏掉了它
 *
 * PR #45/#46 声称「把原站所有旧版端点打了一遍，仍是 200 的还有 6 个」，
 * 但 2026-11-09 复核时本端点**仍返回 200**。也就是说上一轮的
 * 「全量」审计并不完整 —— 本轮把它与 `replies/show.json`、
 * `nodes/list.json` 一起补齐，并把 15 项契约逐条登记在
 * `docs/LEGACY_API_MATRIX_v0.0.13.md`。
 *
 * ## 契约（2026-11-09 低频只读实测）
 *
 * | 项 | 实测 |
 * |---|---|
 * | 状态码 | 200（无需认证） |
 * | 载荷 | **数组**，10 条，元素形状与 `show.json`/`latest.json` 完全同构 |
 * | 排序 | `replies` **严格降序**（实测 114,69,58,39,32,31,30,29,26,22） |
 * | `?limit=1` | 被忽略，body **逐字节相同**（仍 10 条） |
 * | `?node_name=python` / `?id=1` | 被忽略，body 逐字节相同 |
 * | 响应头 | `application/json;charset=UTF-8`、`Cache-Control: public, max-age=120`、`x-rate-limit-*` |
 *
 * 排序的**确定性**：本项目额外以 `id` 降序兜底同回复数的主题，
 * 避免数据库返回顺序漂移（原站同值顺序未实测，属于有意补强）。
 * 装配复用 `src/server/legacy-topics.ts`，因此同一主题在
 * `show.json` / `latest.json` / `hot.json` 里的字段值必然一致。
 */
export async function GET(request: Request) {
  const rl = await guardLegacyRateLimit('topics-hot');
  if (!rl.ok) return legacyRateLimited(rl);

  const origin = resolveBaseUrl(request.url);
  const topics = await loadLegacyTopics({
    filter: { kind: 'hot' },
    limit: LEGACY_HOT_LIMIT,
    origin,
  });

  return new Response(JSON.stringify(topics), {
    status: 200,
    headers: legacyJsonHeaders(rl, LEGACY_CACHE_SECONDS.topicsHot),
  });
}
