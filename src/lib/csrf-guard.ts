import 'server-only';
import { NextResponse } from 'next/server';
import { verifyCsrf } from '@/lib/csrf';

/**
 * 写接口的 CSRF 守卫。
 *
 * 用法：
 *   const csrf = await guardCsrf(request);
 *   if (csrf) return csrf;   // 校验失败，直接返回 403
 *
 * 例外：登录 / 注册接口在首次访问时可能还没有 CSRF Cookie，
 * 这两个接口额外允许"无 Cookie 且无 Token"的首次提交（详见各自实现）。
 */
export async function guardCsrf(request: Request): Promise<NextResponse | null> {
  const ok = await verifyCsrf(request);
  if (ok) return null;
  return NextResponse.json(
    { ok: false, error: 'CSRF 校验失败，请刷新页面后重试' },
    { status: 403 },
  );
}
