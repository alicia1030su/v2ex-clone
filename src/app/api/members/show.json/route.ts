import { db, schema } from '@/db';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { assembleLegacyMember, PUBLIC_USER_STATUSES } from '@/server/legacy-assemblers';
import { resolveBaseUrl } from '@/lib/feed-builder';
import {
  guardLegacyRateLimit,
  legacyJsonHeaders,
  legacyNotFoundResponse,
  legacyRateLimited,
} from '@/lib/legacy-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/members/show.json —— **V2EX 旧版会员资料端点**
 *
 * ## 契约（2026-11-08 经本机 xray 代理实测）
 *
 * | 请求 | 实测行为 |
 * |---|---|
 * | `?username=Livid` | 200，**单个对象**（不是数组） |
 * | `?username=livid` | 200，同上（用户名**大小写不敏感**） |
 * | `?id=1` | 200，同上（支持按 id 查） |
 * | `?username=…&id=…` | 200，**任一命中即可**（两者不是 AND 关系） |
 * | 不存在 / 无参数 | **404**，`{status:'error',message:'Object Not Found',rate_limit}` |
 *
 * 响应头实测：`Content-Type: application/json; charset=UTF-8`（**带空格**，
 * 与 `/api/topics/show.json` 的 `;charset=` 写法不同——照抄）、
 * `Cache-Control: public, max-age=600`。
 *
 * ## 字段
 *
 * 与 `/api/topics/show.json` 内嵌的 `member` **完全同构**，只多一个
 * `status: "found"`（实测值；原站仅在此端点返回该字段）。
 *
 * 与本项目的差异同 `/api/topics/show.json`：`pro` 恒 0、
 * `twitter/github/psn/btc` 恒 `null`、头像为确定性占位 data URI。
 *
 * ## v0.0.13（V13-01）：装配器统一 + 隐私
 *
 * - `member` 字段改用 `src/server/legacy-assemblers.ts` 的
 *   `assembleLegacyMember`，与主题 / 回复端点内嵌的 member 必然同构。
 * - **封禁 / 停用用户的资料不再从匿名接口公开**：查询加
 *   `status='active'` 条件（原站行为未实测，取更保守一侧）。
 *   已发布的历史内容仍显示作者用户名，但其自填资料字段会被置空。
 * - 载荷从不含 email / password_hash / 会话令牌 / 积分余额。
 */
export async function GET(request: Request) {
  const rl = await guardLegacyRateLimit('members-show');
  if (!rl.ok) return legacyRateLimited(rl);

  const url = new URL(request.url);
  const username = url.searchParams.get('username');
  const idRaw = url.searchParams.get('id');
  const id = idRaw !== null && /^\d+$/.test(idRaw) ? Number(idRaw) : null;

  if (!username && id === null) return legacyNotFoundResponse(rl, 600);

  // 任一命中即可（实测：?username=Livid&id=1 与二者单独请求结果相同）
  const identity = [];
  if (username) {
    const lower = username.toLowerCase();
    identity.push(sql`lower(${schema.users.username}) = ${lower}`);
  }
  if (id !== null) identity.push(eq(schema.users.id, id));
  const identityCondition = identity.length === 1 ? identity[0] : or(identity[0], identity[1]);

  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      tagline: schema.users.tagline,
      bio: schema.users.bio,
      url: schema.users.url,
      location: schema.users.location,
      status: schema.users.status,
      avatar: schema.users.avatar,
      createdAt: schema.users.createdAt,
      lastActiveAt: schema.users.lastActiveAt,
    })
    .from(schema.users)
    .where(and(eq(schema.users.status, PUBLIC_USER_STATUSES[0]), identityCondition))
    .orderBy(desc(schema.users.id))
    .limit(1);

  const user = rows[0];
  if (!user) return legacyNotFoundResponse(rl, 600);

  const origin = resolveBaseUrl(request.url);
  // 原站此端点额外返回 status: "found"
  const payload = { ...assembleLegacyMember(user, origin), status: 'found' };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: legacyJsonHeaders(rl, 600, true),
  });
}
