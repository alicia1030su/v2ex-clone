import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
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
  // CSRF 校验：登录/注册同样需要，防止跨站提交
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

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
  //
  // 双维度限流（修复前的缺陷）：原实现只有 IP + 用户名一个维度，
  // 攻击者只要不断更换用户名即可绕过限制进行批量注册。
  //
  // 现在同时检查两个维度：
  //  1. IP + 用户名：防止针对同一账号的反复注册尝试
  //  2. 纯 IP：限制同一来源在窗口内的注册总次数，阻断换用户名批量注册
  const registerWindow = Number(process.env.RATE_LIMIT_REGISTER_WINDOW_SECONDS ?? 300);

  const perAccountLimit = await rateLimit(
    'signup_account',
    `${ip}|${username.toLowerCase()}`,
    Number(process.env.RATE_LIMIT_REGISTER_MAX ?? 5),
    registerWindow,
  );
  if (!perAccountLimit.ok) {
    return NextResponse.json(
      { ok: false, error: `注册过于频繁，请 ${perAccountLimit.retryAfterSeconds} 秒后再试` },
      {
        status: 429,
        headers: { 'Retry-After': String(perAccountLimit.retryAfterSeconds) },
      },
    );
  }

  const perIpLimit = await rateLimit(
    'signup_ip',
    ip,
    Number(process.env.RATE_LIMIT_REGISTER_IP_MAX ?? 20),
    registerWindow,
  );
  if (!perIpLimit.ok) {
    return NextResponse.json(
      { ok: false, error: `该网络注册账号过多，请 ${perIpLimit.retryAfterSeconds} 秒后再试` },
      {
        status: 429,
        headers: { 'Retry-After': String(perIpLimit.retryAfterSeconds) },
      },
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
