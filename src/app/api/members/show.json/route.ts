import { NextResponse } from 'next/server';
import { db, schema } from '@/db';
import { desc, eq, sql } from 'drizzle-orm';
import { avatarUrl } from '@/components/Avatar';
import type { LegacyMemberInput } from '@/lib/legacy-topic-api';
import {
  MEMBER_AVATAR_SIZES,
  toLegacyMember,
} from '@/lib/legacy-topic-api';
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
 */

/** 组装头像 URL（六个尺寸，站内同一套确定性占位） */
function avatarsOf(user: { id: number; username: string; avatar: string | null }) {
  const out = {} as Record<keyof typeof MEMBER_AVATAR_SIZES, string>;
  for (const [key, size] of Object.entries(MEMBER_AVATAR_SIZES)) {
    out[key as keyof typeof MEMBER_AVATAR_SIZES] = avatarUrl(user, size);
  }
  return out;
}

export async function GET(request: Request) {
  const rl = await guardLegacyRateLimit('members-show');
  if (!rl.ok) return legacyRateLimited(rl);

  const url = new URL(request.url);
  const username = url.searchParams.get('username');
  const idRaw = url.searchParams.get('id');
  const id = idRaw !== null && /^\d+$/.test(idRaw) ? Number(idRaw) : null;

  if (!username && id === null) return legacyNotFoundResponse(rl, 600);

  // 任一命中即可（实测：?username=Livid&id=1 与二者单独请求结果相同）
  const conditions = [];
  if (username) {
    const lower = username.toLowerCase();
    conditions.push(sql`lower(${schema.users.username}) = ${lower}`);
  }
  if (id !== null) {
    conditions.push(eq(schema.users.id, id));
  }

  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      tagline: schema.users.tagline,
      bio: schema.users.bio,
      url: schema.users.url,
      location: schema.users.location,
      avatar: schema.users.avatar,
      createdAt: schema.users.createdAt,
      lastActiveAt: schema.users.lastActiveAt,
    })
    .from(schema.users)
    .where(conditions.length === 1 ? conditions[0] : sql`(${conditions[0]} or ${conditions[1]})`)
    .orderBy(desc(schema.users.id))
    .limit(1);

  const user = rows[0];
  if (!user) return legacyNotFoundResponse(rl, 600);

  const origin = resolveBaseUrl(request.url);

  const input: LegacyMemberInput = {
    id: user.id,
    username: user.username,
    tagline: user.tagline,
    bio: user.bio,
    url: user.url,
    location: user.location,
    createdAt: user.createdAt,
    lastActiveAt: user.lastActiveAt,
    avatars: avatarsOf(user),
  };

  // 原站此端点额外返回 status: "found"
  const payload = { ...toLegacyMember(input, origin), status: 'found' };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: legacyJsonHeaders(rl, 600, true),
  });
}
