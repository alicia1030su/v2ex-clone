import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { verifyPassword, hashPassword } from '@/lib/password';
import { rateLimitByUser } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  // CSRF 校验（置于鉴权之后：未登录请求直接 401，不泄露端点存在性）
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as {
    current?: string;
    next?: string;
  } | null;

  if (!body?.current || !body?.next) {
    return NextResponse.json({ ok: false, error: '请填写当前密码和新密码' }, { status: 400 });
  }
  if (body.next.length < 8) {
    return NextResponse.json({ ok: false, error: '新密码至少 8 位' }, { status: 400 });
  }
  if (body.next.length > 128) {
    return NextResponse.json({ ok: false, error: '新密码过长' }, { status: 400 });
  }

  const limit = await rateLimitByUser('password', user.id, 5, 300);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `尝试过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429 },
    );
  }

  const rows = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);

  if (!rows[0] || !verifyPassword(body.current, rows[0].passwordHash)) {
    return NextResponse.json({ ok: false, error: '当前密码不正确' }, { status: 401 });
  }

  await db
    .update(schema.users)
    .set({ passwordHash: hashPassword(body.next) })
    .where(eq(schema.users.id, user.id));

  return NextResponse.json({ ok: true });
}
