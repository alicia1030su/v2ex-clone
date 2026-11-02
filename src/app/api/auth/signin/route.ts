import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db, schema } from '@/db';
import { verifyPassword } from '@/lib/password';
import { createSession, setSessionCookie } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { getKV } from '@/lib/kv';
import { sanitizeRedirect } from '@/lib/redirect';
import { verifyCaptcha, verifyCaptchaField } from '@/server/captcha';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    username?: string;
    password?: string;
    next?: string;
    captchaId?: string;
    captchaField?: string;
    captchaText?: string;
  } | null;

  if (!body?.username || !body?.password) {
    return NextResponse.json({ ok: false, error: '用户名和密码不能为空' }, { status: 400 });
  }

  // 验证码校验（与原站一致：登录页要求输入验证码）
  // 测试环境可通过 DISABLE_CAPTCHA=1 跳过（仅用于自动化测试，不影响生产行为）
  const captchaDisabled = process.env.DISABLE_CAPTCHA === '1';
  if (body.captchaId && !captchaDisabled) {
    const fieldOk = await verifyCaptchaField(body.captchaId, body.captchaField ?? '');
    const captchaOk = fieldOk && (await verifyCaptcha(body.captchaId, body.captchaText ?? ''));
    if (!captchaOk) {
      return NextResponse.json({ ok: false, error: '验证码不正确' }, { status: 400 });
    }
  }

  const username = body.username.trim();
  const hdrs = await headers();
  const ip =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip') ?? '127.0.0.1';

  // 限流键为 IP + 用户名组合：
  //  - 针对同一账号的暴力破解会被拦截
  //  - 不同账号从同一 IP 登录互不影响
  const limit = await rateLimit(
    'login',
    `${ip}|${username.toLowerCase()}`,
    Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 10),
    Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `尝试过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const rows = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.username}) = lower(${username})`)
    .limit(1);

  const user = rows[0];

  const valid = user ? verifyPassword(body.password, user.passwordHash) : false;
  await db.insert(schema.loginAttempts).values({
    identifier: username,
    ip,
    success: valid,
  });

  if (!user || !valid) {
    return NextResponse.json({ ok: false, error: '用户名或密码不正确' }, { status: 401 });
  }
  if (user.status === 'banned') {
    return NextResponse.json({ ok: false, error: '该账号已被封禁' }, { status: 403 });
  }
  if (user.status === 'suspended') {
    return NextResponse.json({ ok: false, error: '该账号已被暂停' }, { status: 403 });
  }

  // 登录成功后清空该账号的失败计数
  const kv = await getKV();
  await kv.del(`ratelimit:login:${ip}|${username.toLowerCase()}`);

  const sessionId = await createSession(user.id);
  await setSessionCookie(sessionId);
  await db
    .update(schema.users)
    .set({ lastActiveAt: new Date() })
    .where(eq(schema.users.id, user.id));

  const next = sanitizeRedirect(body.next);
  return NextResponse.json({ ok: true, redirect: next });
}
