import { resolveBaseUrl } from '@/lib/feed-builder';
import { loadLegacyNodeRecords } from '@/server/legacy-assemblers';
import {
  parseLegacyFields,
  projectLegacyNode,
  resolveLegacyNodeSort,
} from '@/lib/legacy-node-list';
import {
  LEGACY_CACHE_SECONDS,
  guardLegacyRateLimit,
  legacyBadRequest,
  legacyRateLimited,
} from '@/lib/legacy-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nodes/list.json —— **V2EX 旧版「节点列表（可投影）」端点**
 * （v0.0.13 / V13-04）
 *
 * ## 这个端点最容易被误判为「已下线」
 *
 * 裸路径访问原站返回 **400**，不是 404。第三方文档把它列为 V1 接口并说明：
 * 必须同时提供 `fields` / `sort_by` / `reverse`，缺任意一个 ⇒ 400。
 * 2026-11-09 实测确认了这一点，也确认了带齐参数后返回 **200**。
 * 因此本项目实现它，而不是把它登记为「原站已下线」。
 *
 * ## 契约（8 组参数组合实测）
 *
 * | 项 | 行为 |
 * |---|---|
 * | 缺 `fields` / `sort_by` / `reverse` 任一项 | **400** + `text/html; charset=UTF-8` 极简 HTML |
 * | 带齐三项 | 200，数组，元素**只含 `fields` 请求的键** |
 * | 未知字段名 | 键仍出现，值为 **null**（实测 `fields=bogus`） |
 * | `sort_by=id` | id 降序 |
 * | `sort_by=name` | name 降序 |
 * | 其它 `sort_by` | name 升序 |
 * | `reverse` | 实测 **不生效**（0/1/2 结果相同）——照抄，不「修正」 |
 * | `page` / `limit` | 被忽略，不分页 |
 * | 响应头 | `application/json;charset=utf-8`、`Cache-Control: public, max-age=30`、`x-rate-limit-*` |
 *
 * 字段值来自**共用装配器** `loadLegacyNodeRecords()`，因此与
 * `/api/nodes/all.json`、`/api/nodes/show.json`、主题内嵌 `node`
 * 的 `id/name/title/topics/stars/…` 必然一致；只暴露 active 节点。
 */
export async function GET(request: Request) {
  const rl = await guardLegacyRateLimit('nodes-list');
  if (!rl.ok) return legacyRateLimited(rl);

  const url = new URL(request.url);
  const fieldsRaw = url.searchParams.get('fields');
  const sortByRaw = url.searchParams.get('sort_by');
  const reverseRaw = url.searchParams.get('reverse');

  // 三个参数必须同时存在（实测：缺任意一个 ⇒ 400）
  if (fieldsRaw === null || sortByRaw === null || reverseRaw === null) {
    return legacyBadRequest(rl);
  }

  const fields = parseLegacyFields(fieldsRaw);
  const sort = resolveLegacyNodeSort(sortByRaw);
  const order = sort === 'id' ? 'id-desc' : sort === 'name' ? 'name-desc' : 'name-asc';

  const records = await loadLegacyNodeRecords({
    origin: resolveBaseUrl(request.url),
    order,
  });

  const payload = records.map((record) => projectLegacyNode(record, fields));

  // 原站此处 Content-Type 是 `application/json;charset=utf-8`（小写 utf-8）
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'Cache-Control': `public, max-age=${LEGACY_CACHE_SECONDS.nodesList}`,
      'x-rate-limit-limit': String(rl.limit),
      'x-rate-limit-remaining': String(Math.max(0, rl.limit - rl.count)),
      'x-rate-limit-reset': String(Math.floor(rl.resetAt / 1000)),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
