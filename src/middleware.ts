import { NextResponse, type NextRequest } from 'next/server';

/**
 * CSRF Cookie 下发中间件
 *
 * 双提交 Cookie 模式要求每个访客都有一个 CSRF Cookie。
 * Server Component 不能修改 Cookie（Next.js 限制），
 * 因此在 Middleware 中下发 —— 它对所有请求路径生效。
 *
 * CSRF Cookie 刻意设置为 httpOnly: false，
 * 这样客户端脚本可以读取并放入请求头；
 * 攻击者受同源策略限制无法读取目标站点的 Cookie，
 * 因此无法伪造出携带正确 token 的跨站请求。
 */
const CSRF_COOKIE = 'v2_csrf';
const CSRF_MAX_AGE = 60 * 60 * 24 * 14; // 14 天，与会话同周期

export function middleware(request: NextRequest) {
  const existing = request.cookies.get(CSRF_COOKIE)?.value;

  // 已存在且长度合理 → 直接放行
  if (existing && existing.length >= 32) {
    return NextResponse.next();
  }

  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const response = NextResponse.next();

  response.cookies.set({
    name: CSRF_COOKIE,
    value: token,
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CSRF_MAX_AGE,
  });

  return response;
}

export const config = {
  matcher: [
    // 排除静态资源与 API（API 由各路由自行校验）
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|woff2?)$).*)',
  ],
};
