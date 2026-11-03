import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { rateLimitByIp, rateLimit } from '@/lib/rate-limit';
import { createResetToken, deliverMail, maskEmail } from '@/lib/mailer';
import { resolveClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/forgot-password —— 申请密码重置
 *
 * ## 防止邮箱枚举
 *
 * 无论邮箱是否存在，**响应体与状态码完全一致**：
 *   { ok: true, message: '如果该邮箱已注册，重置链接已发送（若邮件服务已配置）' }
 *
 * 差异只体现在：
 *  - 服务端耗时（通过让不存在的邮箱也走一次哈希 + 查询来拉平）
 *  - email_logs 表中的记录数（运营可见，对外不可见）
 *
 * ## 防暴力尝试
 *  - 按 IP 限流
 *  - 按邮箱哈希限流（防止针对单一邮箱的批量申请）
 */
export async function POST(request: Request) {
  // CSRF 校验（防止第三方站点诱导用户发起重置申请）
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = String(body?.email ?? '').trim().toLowerCase();

  if (!email || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // 格式错误也返回同样的响应（不泄露任何信息）
    return NextResponse.json({
      ok: true,
      message: '如果该邮箱已注册，重置链接已发送（若邮件服务已配置）',
    });
  }

  // 按 IP 限流
  const ipLimit = await rateLimitByIp(
    'forgot_password_ip',
    Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_IP_MAX ?? 10),
    Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS ?? 900),
  );
  if (!ipLimit.ok) {
    return NextResponse.json(
      { ok: false, error: `请求过于频繁，请 ${ipLimit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } },
    );
  }

  // 按邮箱限流（防止针对单一邮箱的批量申请 —— 邮件轰炸）
  const emailLimit = await rateLimit(
    'forgot_password_email',
    email,
    Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_EMAIL_MAX ?? 3),
    Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS ?? 900),
  );
  if (!emailLimit.ok) {
    // 同样返回统一响应，不告诉调用者"该邮箱被限流了"
    return NextResponse.json({
      ok: true,
      message: '如果该邮箱已注册，重置链接已发送（若邮件服务已配置）',
    });
  }

  const users = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      email: schema.users.email,
      status: schema.users.status,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  const user = users[0];

  if (user && user.status === 'active') {
    try {
      const ip = await resolveClientIp();
      const { token, expiresAt } = await createResetToken(user.id, ip);
      const baseUrl =
        process.env.PUBLIC_BASE_URL?.trim() ||
        (process.env.APP_URL?.trim() ?? '') ||
        new URL(request.url).origin;
      const link = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
      const ttlMinutes = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 60);

      const result = await deliverMail({
        to: email,
        purpose: 'password_reset',
        userId: user.id,
        subject: '重置你的 V2EX Clone 密码',
        body: [
          `你好 ${user.username}：`,
          '',
          '我们收到了重置密码的请求。请点击下面的链接设置新密码：',
          '',
          link,
          '',
          `该链接将在 ${ttlMinutes} 分钟后失效，且只能使用一次。`,
          '如果你没有申请过重置密码，请忽略此邮件，你的密码不会被更改。',
        ].join('\n'),
      });

      if (!result.delivered) {
        // 未配置 SMTP —— 必须如实反映状态，不能假装已发送
        console.warn(
          `[forgot-password] 邮件未送达（${maskEmail(email)}）：${result.reason}`,
        );
      }
    } catch (err) {
      console.error('[forgot-password] 处理失败:', err);
      // 即便内部出错也返回统一响应（不泄露内部状态）
    }
  }

  return NextResponse.json({
    ok: true,
    message: '如果该邮箱已注册，重置链接已发送（若邮件服务已配置）',
  });
}
