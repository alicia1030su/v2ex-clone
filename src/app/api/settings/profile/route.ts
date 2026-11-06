import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { guardCommunityAction } from '@/lib/community-rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  // CSRF 校验（置于鉴权之后：未登录请求直接 401，不泄露端点存在性）
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;
  // v0.0.5：社区动作频率限制（用户 + IP 双维度）
  const rl = await guardCommunityAction('profile_update', user?.id ?? null);
  if (rl) return rl;

  const body = (await request.json().catch(() => null)) as {
    tagline?: string;
    bio?: string;
    url?: string;
    location?: string;
  } | null;

  const tagline = (body?.tagline ?? '').trim().slice(0, 255);
  const bio = (body?.bio ?? '').trim().slice(0, 5000);
  const location = (body?.location ?? '').trim().slice(0, 128);
  const url = (body?.url ?? '').trim().slice(0, 512);

  if (url) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ ok: false, error: '个人主页必须是合法 URL' }, { status: 400 });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json(
        { ok: false, error: '个人主页只支持 http/https 协议' },
        { status: 400 },
      );
    }
  }

  await db
    .update(schema.users)
    .set({ tagline, bio, url, location })
    .where(eq(schema.users.id, user.id));

  return NextResponse.json({ ok: true });
}
