import { resolveBaseUrl } from '@/lib/feed-builder';
import {
  loadLegacyNodeRecords,
  publicLegacyNode,
  type LoadLegacyNodeOptions,
} from '@/server/legacy-assemblers';
import {
  guardLegacyRateLimit,
  legacyJsonHeaders,
  legacyNotFoundResponse,
  legacyRateLimited,
} from '@/lib/legacy-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nodes/show.json —— **V2EX 旧版节点详情端点**
 *
 * ## 契约（2026-11-08 实测）
 *
 * | 请求 | 实测行为 |
 * |---|---|
 * | `?name=programmer` | 200，**单个对象** |
 * | `?name=PROGRAMMER` | 200（名称**大小写不敏感**） |
 * | `?id=300` | 200（支持按 id 查） |
 * | `?name=…&id=…` | 200，**任一命中即可** |
 * | 不存在 / 无参数 | **404** `Object Not Found` |
 *
 * 响应头实测：`application/json;charset=UTF-8`（**无空格**）、
 * `Cache-Control: public, max-age=3600`。
 *
 * 字段与 `/api/topics/show.json` 内嵌的 `node` **完全同构**（16 个键）。
 *
 * 与本项目的差异：`header`/`footer` 恒空串、`aliases` 恒 `[]`
 * （均未建模，给空值而非编造）、头像为确定性占位 data URI、
 * `founder_id` 取 `nodes.created_by`（未记录则为 0）。
 *
 * ## v0.0.13（V13-01）
 *
 * 改用共用装配器：现在只暴露 `status='active'` 的节点，
 * 与 `/api/nodes/all.json` / `/api/nodes/list.json` 的可见性一致。
 * 此前本端点不限制状态 ⇒ 同一节点在 `all.json` 查不到、在 `show.json`
 * 却能查到，属于跨接口一致性缺陷。
 */
export async function GET(request: Request) {
  const rl = await guardLegacyRateLimit('nodes-show');
  if (!rl.ok) return legacyRateLimited(rl);

  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  const idRaw = url.searchParams.get('id');
  const id = idRaw !== null && /^\d+$/.test(idRaw) ? Number(idRaw) : null;

  if (!name && id === null) return legacyNotFoundResponse(rl, 3600);

  const matchAny: NonNullable<LoadLegacyNodeOptions['matchAny']> = [];
  if (name) matchAny.push({ kind: 'name', value: name });
  if (id !== null) matchAny.push({ kind: 'id', value: id });

  const records = await loadLegacyNodeRecords({
    origin: resolveBaseUrl(request.url),
    matchAny,
    order: 'id-asc',
  });

  const node = records[0];
  if (!node) return legacyNotFoundResponse(rl, 3600);

  return new Response(JSON.stringify(publicLegacyNode(node)), {
    status: 200,
    headers: legacyJsonHeaders(rl, 3600),
  });
}
