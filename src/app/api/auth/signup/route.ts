import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { hashPassword } from '@/lib/password';
import { createSession, setSessionCookie } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

const USERNAME_RE = /^[a-zA-Z0-9_]{2,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    username?: string;
    email?: string;
    password?: string;
  } | null;

  if (!body?.username || !body?.password) {
    return NextResponse.json({ ok: false, error: '用户名和密码不能为空' }, { status: 400 });
  }

  const username = body.username.trim();
  const hdrs = await headers();
  const ip =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip') ?? '127.0.0.1';

  const email = (body.email ?? '').trim().toLowerCase() || null;

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { ok: false, error: '用户名只能包含字母、数字和下划线，长度 2-32' },
      { status: 400 },
    );
  }
  if (body.password.length < 8) {
    return NextResponse.json({ ok: false, error: '密码至少 8 位' }, { status: 400 });
  }
  if (body.password.length > 128) {
    return NextResponse.json({ ok: false, error: '密码过长' }, { status: 400 });
  }
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: '邮箱格式不正确' }, { status: 400 });
  }

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.username}) = lower(${username})`)
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ ok: false, error: '该用户名已被使用' }, { status: 409 });
  }

  if (email) {
    const existingEmail = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = lower(${email})`)
      .limit(1);
    if (existingEmail.length > 0) {
      return NextResponse.json({ ok: false, error: '该邮箱已被使用' }, { status: 409 });
    }
  }

  // 限流放在全部校验之后：无效请求不应消耗限流配额。
  // 限流键为 IP + 用户名：防止同一账号被反复注册尝试，
  // 同时不影响同一 IP 下注册不同账号的正常用户。
  const limit = await rateLimit(
    'signup',
    `${ip}|${username.toLowerCase()}`,
    5,
    Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `注册过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const [row] = await db
    .insert(schema.users)
    .values({
      username,
      email,
      passwordHash: hashPassword(body.password),
      role: 'user',
      balance: 1000,
    })
    .returning({ id: schema.users.id });

  const sessionId = await createSession(row.id);
  await setSessionCookie(sessionId);

  return NextResponse.json({ ok: true, redirect: '/' }, { status: 201 });
}
