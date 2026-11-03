import { NextResponse, type NextRequest } from 'next/server';
import { INTERNAL_CLIENT_IP_HEADER } from '@/lib/client-ip-constants';

/**
 * CSRF Cookie 下发 + 客户端 IP 注入中间件
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

/**
 * 取「转发链上最靠近客户端的地址」。
 *
 * ⚠️ **这里有一个必须理解的陷阱**（实测得出，勿轻易改动）：
 *
 * Next.js 15 的 `next/dist/server/base-server.js` 里有这一行：
 *
 * ```js
 * req.headers['x-forwarded-for'] ??= originalRequest?.socket?.remoteAddress;
 * ```
 *
 * 注意是 `??=` —— **客户端传了这个头，Next 就不会用 socket 的真实地址覆盖它**。
 * 且这一行早于 middleware 执行。
 *
 * 后果：middleware **无法区分**「这个 x-forwarded-for 是 Next 填的真实
 * socket 地址」还是「客户端自己伪造的」。Next.js 15 也没有 `nodeMiddleware`
 * 选项（实测 `grep -rn nodeMiddleware node_modules/next/dist/` 零命中），
 * middleware 跑在 Edge Runtime，拿不到 socket 远端地址。
 *
 * 因此本函数**只���显式信任反代头时才读代理头**：
 * 否则一律返回兜底值。绝不能把客户端可控的头「洗白」成内部可信头 ——
 * 那会让 `resolveClientIp` 的整个信任模型形同虚设。
 *
 * 取舍（必须让使用者知晓）：
 * - `TRUST_PROXY_HEADERS=0`（默认）：限流的 IP 维度退化为**全局单桶**
 *   （所有客户端共用 `127.0.0.1`）。这是**安全但粗糙**的取舍 ——
 *   要拿到真实来源 IP，必须部署在反向代理之后并显式设 `TRUST_PROXY_HEADERS=1`。
 * - 账号维度的限流（例如登录的 `ip|username`）仍然有效，
 *   因此针对**同一账号**的暴力破解仍会被拦截。
 */
function resolveIncomingIp(request: NextRequest): string {
  if (process.env.TRUST_PROXY_HEADERS === '1') {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    const realIp = request.headers.get('x-real-ip')?.trim();
    if (realIp) return realIp;
  }
  return '127.0.0.1';
}

export function middleware(request: NextRequest) {
  // ---- 1. 剥离客户端伪造的内部头，再写入本次请求的来源地址 ----
  // 必须**先删后写**：否则客户端自带 x-v2-client-ip 会覆盖我们注入的值，
  // 从而操纵限流分桶。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(INTERNAL_CLIENT_IP_HEADER);
  requestHeaders.set(INTERNAL_CLIENT_IP_HEADER, resolveIncomingIp(request));

  const existing = request.cookies.get(CSRF_COOKIE)?.value;
  const hasValidCsrf = Boolean(existing && existing.length >= 32);

  // 请求头有变化 → 必须用 request headers 继续，否则下游读不到注入的头
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // ---- 2. CSRF Cookie 下发 ----
  if (!hasValidCsrf) {
    const token =
      crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    response.cookies.set({
      name: CSRF_COOKIE,
      value: token,
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: CSRF_MAX_AGE,
    });
  }

  return response;
}

export const config = {
  matcher: [
    // API 路由也需要注入客户端 IP（限流依赖它），因此不再排除 api/
    // 静态资源与图片不需要 CSRF cookie，也不需要 IP —— 排除掉以减少开销。
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|woff2?)$).*)',
  ],
};
