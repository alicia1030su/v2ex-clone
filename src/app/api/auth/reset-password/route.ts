import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { db, schema } from '@/db';
import { eq, isNull } from 'drizzle-orm';
import { hashPassword } from '@/lib/password';
import { consumeResetToken, revokeUserTokens, inspectResetToken } from '@/lib/reset-token-store';
import { rateLimitByIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/reset-password —— 用令牌重置密码
 *
 * body: { token: string, newPassword: string }
 *
 * ## 安全属性
 *  - 令牌只存哈希；数据库泄露也无法直接用于重置
 *  - 过期 / 已撤销 / 已使用 三种情况都拒绝（防重放）
 *  - 消费令牌用 `UPDATE ... WHERE used_at IS NULL` —— 并发下只有一个请求能成功
 *  - **改密后销毁该用户所有会话**（旧会话立即失效）
 *  - 重置成功后撤销该用户其余未使用令牌
 *  - 按 IP 限流，防暴力尝试
 */
export async function POST(request: Request) {
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as {
    token?: string;
    newPassword?: string;
  } | null;

  const token = String(body?.token ?? '').trim();
  const newPassword = String(body?.newPassword ?? '');

  if (!token) {
    return NextResponse.json({ ok: false, error: '重置令牌无效' }, { status: 400 });
  }

  // 密码强度校验（与注册路由保持一致：8–128 位）
  if (newPassword.length < 8) {
    return NextResponse.json({ ok: false, error: '密码至少 8 位' }, { status: 400 });
  }
  if (newPassword.length > 128) {
    return NextResponse.json({ ok: false, error: '密码过长' }, { status: 400 });
  }

  const ipLimit = await rateLimitByIp(
    'reset_password_ip',
    Number(process.env.RATE_LIMIT_RESET_PASSWORD_IP_MAX ?? 20),
    Number(process.env.RATE_LIMIT_RESET_PASSWORD_WINDOW_SECONDS ?? 900),
  );
  if (!ipLimit.ok) {
    return NextResponse.json(
      { ok: false, error: `尝试过于频繁，请 ${ipLimit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } },
    );
  }

  const consumed = await consumeResetToken(token);
  if (!consumed.ok) {
    return NextResponse.json({ ok: false, error: consumed.reason }, { status: 400 });
  }

  const passwordHash = hashPassword(newPassword);

  // 更新口令 + 销毁全部旧会话（改密后旧会话必须失效）
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ passwordHash })
      .where(eq(schema.users.id, consumed.userId));

    await tx
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, consumed.userId));
  });

  // 撤销该用户其余未使用令牌
  await revokeUserTokens(consumed.userId);

  return NextResponse.json({
    ok: true,
    message: '密码已重置，请使用新密码登录',
  });
}

/**
 * GET /api/auth/reset-password?token=xxx —— 校验令牌是否可用
 *
 * 用于前端在用户填新密码前先确认链接有效。
 * 注意：这里只校验**不消费**令牌（真正的消费发生在 POST）。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';

  if (!token || token.length < 32) {
    return NextResponse.json({ ok: false, error: '重置链接无效' }, { status: 400 });
  }

  const check = await inspectResetToken(token);
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.reason }, { status: 400 });
  }

  return NextResponse.json({ ok: true, valid: true, expiresAt: check.expiresAt });
}
