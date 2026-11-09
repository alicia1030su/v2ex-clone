import { resolveBaseUrl } from '@/lib/feed-builder';
import { parseLegacyId } from '@/lib/legacy-topic-api';
import { loadLegacyReplies } from '@/server/legacy-replies';
import {
  LEGACY_CACHE_SECONDS,
  guardLegacyRateLimit,
  legacyJsonHeaders,
  legacyRateLimited,
} from '@/lib/legacy-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/replies/show.json —— **V2EX 旧版主题回复端点**（v0.0.13 / V13-03）
 *
 * 完整实测契约与 15 项核对见 `docs/LEGACY_API_MATRIX_v0.0.13.md`；
 * 关键差异（与 `topics/show.json` 不同，容易写错）：
 *
 * - **任何异常参数都返回 200 `[]`**，不返回 404 错误体
 *   （无参数、`topic_id=0`、`abc`、不存在的 id 全部实测 200 `[]`）
 * - `page` / `page_size` **被忽略**（实测 body 逐字节相同），不实现分页
 * - 同名参数取**最后一个**（`?topic_id=1&topic_id=2` ⇒ 全是 2）
 * - `Cache-Control: public, max-age=60`（比 topics 系短）
 */
export async function GET(request: Request) {
  const rl = await guardLegacyRateLimit('replies-show');
  if (!rl.ok) return legacyRateLimited(rl);

  const url = new URL(request.url);
  // 与 topics/show.json 共用同一个「同名参数取最后一个 / 非正整数 ⇒ null」解析器，
  // 避免两个端点对 `id` 的边界语义漂移。
  const topicId = parseLegacyId(url.searchParams.getAll('topic_id'));

  const payload = topicId === null
    ? []
    : await loadLegacyReplies(topicId, resolveBaseUrl(request.url));

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: legacyJsonHeaders(rl, LEGACY_CACHE_SECONDS.repliesShow),
  });
}
