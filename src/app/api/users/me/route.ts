import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/** 各字段的长度上限 */
const LIMITS = {
  tagline: 255,
  bio: 5000,
  url: 512,
  location: 128,
} as const;

/**
 * PATCH /api/users/me —— 修改本人资料
 *
 * 只能改**自己的**资料 —— 服务端从会话取 userId，绝不接受前端传的用户 ID。
 * （用户 B 不能修改用户 A 的资料）
 */
export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: '请求格式无效' }, { status: 400 });
  }

  const patch: Partial<{
    tagline: string;
    bio: string;
    url: string;
    location: string;
  }> = {};

  for (const key of ['tagline', 'bio', 'url', 'location'] as const) {
    if (body[key] === undefined) continue;
    const raw = body[key];
    if (typeof raw !== 'string') {
      return NextResponse.json(
        { ok: false, error: `${key} 必须是字符串` },
        { status: 400 },
      );
    }
    const value = raw.trim();
    if (value.length > LIMITS[key]) {
      return NextResponse.json(
        { ok: false, error: `${key} 超长（上限 ${LIMITS[key]} 字）` },
        { status: 400 },
      );
    }
    patch[key] = value;
  }

  // URL 必须是 http/https（防止 javascript: 伪协议）
  if (patch.url) {
    try {
      const u = new URL(patch.url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return NextResponse.json(
          { ok: false, error: '个人网站只支持 http/https 链接' },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json(
        { ok: false, error: '个人网站链接格式不正确' },
        { status: 400 },
      );
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: '没有需要修改的内容' }, { status: 400 });
  }

  await db
    .update(schema.users)
    .set(patch)
    .where(eq(schema.users.id, user.id));

  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      tagline: schema.users.tagline,
      bio: schema.users.bio,
      url: schema.users.url,
      location: schema.users.location,
      avatar: schema.users.avatar,
      role: schema.users.role,
      status: schema.users.status,
      balance: schema.users.balance,
    })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);

  return NextResponse.json({ ok: true, user: rows[0] });
}

/**
 * GET /api/users/me —— 当前用户信息
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      email: schema.users.email,
      tagline: schema.users.tagline,
      bio: schema.users.bio,
      url: schema.users.url,
      location: schema.users.location,
      avatar: schema.users.avatar,
      role: schema.users.role,
      status: schema.users.status,
      balance: schema.users.balance,
      createdAt: schema.users.createdAt,
      lastActiveAt: schema.users.lastActiveAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);

  return NextResponse.json({ ok: true, user: rows[0] });
}
