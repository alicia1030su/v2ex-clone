import { resolveBaseUrl } from '@/lib/feed-builder';
import { loadLegacyNodeRecords, publicLegacyNode } from '@/server/legacy-assemblers';
import {
  guardLegacyRateLimit,
  legacyJsonHeaders,
  legacyRateLimited,
} from '@/lib/legacy-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nodes/all.json —— **V2EX 旧版「全部节点」端点**
 *
 * ## 契约（2026-11-08 实测）
 *
 * - 200，**数组**，形状与 `/api/nodes/show.json` 的单个对象同构（16 个键）
 * - 实测原站返回 **1380** 条（本项目节点数远小于此，返回库内全部 active 节点）
 * - 响应头：`application/json;charset=UTF-8`、
 *   `Cache-Control: public, max-age=7200`（2 小时，长于单节点）
 * - 排序：原站按 id 升序（首项 `babel`/id=1）
 *
 * ## 与站内 `/api/nodes` 的区别
 *
 * 站内端点返回 `{ok:true,nodes:[…]}` 包裹并带统计；本端点是**裸数组**，
 * 字段名逐字对齐旧版 API。两者服务不同客户端，**不合并**。
 *
 * 本项目节点数量有限，因此不分页（原站也不分页）。
 *
 * ## v0.0.13（V13-01）：装配器统一
 *
 * 本端点、`/api/nodes/show.json`、`/api/nodes/list.json` 以及三个主题
 * 端点里内嵌的 `node` 全部走 `src/server/legacy-assemblers.ts`。
 * 因此 `stars` / `founder_id` / 头像 / `status='active'` 可见性
 * 在所有接口里必然一致（此前 `show.json` 不限制 status，是真实偏差）。
 */
export async function GET(request: Request) {
  const rl = await guardLegacyRateLimit('nodes-all');
  if (!rl.ok) return legacyRateLimited(rl);

  const origin = resolveBaseUrl(request.url);
  const records = await loadLegacyNodeRecords({ origin, order: 'id-asc' });
  const payload = records.map(publicLegacyNode);

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: legacyJsonHeaders(rl, 7200),
  });
}
