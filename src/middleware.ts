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
 * v0.0.9：**把 middleware 切到 Node.js 运行时**（实测缺陷修复）
 *
 * ## 为什么必须切
 *
 * v0.0.8 把 API 埋点放在 middleware 里（`countMetric('api.request')` 等），
 * 但 middleware 默认跑在 **Edge Runtime** —— 那是**另一个进程**的另一个
 * V8 isolate。因此：
 *
 *   · 埋点写进 Edge isolate 的内存；
 *   · `/api/admin/ops` 读的是 Node 进程里的那份状态；
 *   · ⇒ **API 请求数恒为 0**（实测确认，`api.requests` 一直是 0，
 *     而同接口里的 `ratelimit.checks` 正常 —— 因为它在 Node 侧计数）。
 *
 * 这直接违背任务书 §六「API 5xx 是否能够被统计」——
 * **错误率统计在架构上是瞎的**。
 *
 * ## 切换的代价与收益
 *
 * | | Edge Runtime | Node.js Runtime（本改动） |
 * |---|---|---|
 * | API 埋点可见 | ❌ 跨进程不可见 | ✅ 同进程可见 |
 * | 冷启动 | 快 | 略慢（但本项目本就常驻 Node） |
 * | Node API（fs / net） | 不可用 | 可用 |
 *
 * 本项目的中间件只用 `crypto.randomUUID()` 与 `Headers`，
 * 在 Node 运行时下**行为完全一致**，无兼容性风险。
 *
 * ## 与 `globalThis` 桥接的关系
 *
 * 即使同进程，middleware 与路由处理器仍是**两个 webpack bundle**，
 * 模块实例不共享 ⇒ 切到 Node 运行时**还不够**，
 * 必须配合 `src/lib/observability.ts` 把状态挂到 `globalThis` 上。
 * 两处改动**必须同时存在**，缺一则埋点仍然不可见。
 *
 * ⚠️ 本文件此前**不能**用 Edge Runtime 的另一个原因是
 * `resolveIncomingIp` 需要读 socket 远端地址 —— 但实测 Next.js 15.5
 * 在 middleware 执行**之前**就已经用 `x-forwarded-for` 覆盖了真实地址
 * （见下方注释），所以该限制本来就存在，与运行时选择无关。
 */
export const runtime = 'nodejs';

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
 * 因此本函数**只在显式信任反代头时才读代理头**：
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

    // ⚠️ v0.0.5 修复：`secure` 的判定不能只看 `NODE_ENV`。
    //
    // 根因（v0.0.5 跨浏览器实测发现，**只在 WebKit 复现**）：
    //   原判定 `secure: process.env.NODE_ENV === 'production'`。
    //   而 `next start`（**任何**部署方式，含本地 HTTP 调试与
    //   「Linux 全新安装」的非 HTTPS 部署）都会设 `NODE_ENV=production`
    //   ⇒ Cookie 带 `secure: true`。
    //
    //   Chromium / Firefox 对 `localhost` 的 `Secure` Cookie 有**放宽**
    //   （允许 HTTP 上的 localhost），所以一直没暴露；
    //   **WebKit 没有这个放宽** ⇒ 在 HTTP 下**直接拒绝存储该 Cookie**
    //   ⇒ `document.cookie` 为空 ⇒ 所有写操作（登录 / 发帖 / 举报…）
    //   一律 403「CSRF 校验失败」。
    //
    //   实测证据（webkit-1280x900）：
    //     DIAG_COOKIE ''            ← 浏览器里读不到
    //     DIAG_COOKIES_CTX [... "secure":true, "sameSite":"None" ...]
    //                            ← 但浏览器**确实收到了**，只是不落地
    //
    // 修法：**按请求的实际协议判定**，而不是按环境变量。
    //   - HTTPS（含反代后带 `x-forwarded-proto: https`）⇒ secure = true
    //   - 纯 HTTP ⇒ secure = false（否则 WebKit 直接丢掉 Cookie）
    //
    // ⚠️ 安全影响评估：HTTP 下不设 `secure` 意味着 Cookie 会随明文 HTTP
    //    传输 —— 但**这本来就是 HTTP 部署的固有风险**（会话 Cookie 同理），
    //    且 `SameSite=Lax` 仍能挡住绝大多数 CSRF。
    //    真正的生产部署应当在**反向代理后用 HTTPS**（此时 secure=true）。
    const forwardedProto = request.headers.get('x-forwarded-proto');
    const isHttps =
      request.nextUrl.protocol === 'https:' ||
      (forwardedProto ? forwardedProto.split(',')[0]?.trim() === 'https' : false);

    response.cookies.set({
      name: CSRF_COOKIE,
      value: token,
      httpOnly: false,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: CSRF_MAX_AGE,
    });
  }

  // ---- 5. API 请求埋点：**已移出 middleware**（v0.0.9 修复）----
  //
  // ⚠️ v0.0.8 把 API 埋点放在这里，是**错的**（实测确认）：
  //
  //   · `NextResponse.next()` 返回的是 **middleware 自己**的响应（恒 200），
  //     下游路由的真实响应会**替换**它 —— middleware 拿不到真实状态码；
  //   · 实测结果：`api.byStatus` 永远只有 `{200: N}`，
  //     连真实的 401/403/404 都不计入 ⇒ 「错误率统计」形同虚设，
  //     不满足任务书 §六。
  //
  // 现在改由 `src/instrumentation.ts` 在 **Node HTTP 层**观测
  // （拦截 `ServerResponse.writeHead` 拿真实 statusCode）。
  //
  // 保留本文件里的 CSRF Cookie 下发与客户端 IP 注入 —— 它们与埋点无关。
  return response;
}

export const config = {
  matcher: [
    // API 路由也需要注入客户端 IP（限流依赖它），因此不再排除 api/
    // 静态资源与图片不需要 CSRF cookie，也不需要 IP —— 排除掉以减少开销。
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|woff2?)$).*)',
  ],
};

