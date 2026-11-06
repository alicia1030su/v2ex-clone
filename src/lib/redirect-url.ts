/**
 * v0.0.7：按**请求的 Host 头**构造重定向 URL
 *
 * ## 为什么不能用 `new URL(redirect, request.url)`
 *
 * Next.js 的 `request.url` 在 `next start` 下是用**服务器自身配置的 hostname**
 * 重建的（默认 `localhost`），**不是**客户端实际请求的 Host 头。
 *
 * 实测（Linux 分片矩阵 chromium-1280x900，取证见 e2e/v004-content-interaction.spec.ts
 * 的 `thanks-diag` 输出）：
 *
 *   · 测试 baseURL = http://127.0.0.1:3103（正确）
 *   · 注册后 page.url() = http://127.0.0.1:3103/（正确）
 *   · 提交原生表单（POST /api/replies）后 ⇒ 页面被 303 重定向到
 *     **http://localhost:3103/t/22**（host 被换掉！）
 *
 * 后果（真实用户可感知）：
 *   1. 浏览器里出现**两个** `v2_csrf` cookie（`domain=127.0.0.1` 与
 *      `domain=localhost`）—— 因为 middleware 按请求 host 各下发了一个；
 *   2. 之后任何写操作携带的是 A 域的 token，而服务端读到的是 B 域的
 *      ⇒ `verifyCsrf` 失败 ⇒ **403「CSRF 校验失败」**；
 *   3. 在反代 / 多域名 / 局域网部署下，用户会被**重定向到错误的 host**
 *      （可能直接打不开页面）。
 *
 * ## 修法
 *
 * 用请求头里的 Host（或 `x-forwarded-host`）构造 base，
 * 保留原协议（`x-forwarded-proto` / 实际协议）。
 * Host 缺失时回退 `request.url`（保持旧行为，不引入新的失败模式）。
 */

/** 从请求头解析对外可见的 host（优先 x-forwarded-host，其次 host） */
export function resolveRequestHost(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-host');
  if (forwarded) {
    // x-forwarded-host 可能是逗号分隔的链，取第一个（最靠近客户端的）
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const host = request.headers.get('host')?.trim();
  return host || null;
}

/** 从请求头解析对外可见的协议（优先 x-forwarded-proto，其次 request.url） */
export function resolveRequestProtocol(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim().toLowerCase();
    if (first === 'https' || first === 'http') return first;
  }
  try {
    return new URL(request.url).protocol.replace(':', '');
  } catch {
    return 'http';
  }
}

/**
 * 构造同源的重定向 URL。
 *
 * @param request 当前请求
 * @param path    站内相对路径（必须以 / 开头；调用方需先做 sanitizeRedirect）
 * @returns 绝对 URL 字符串
 */
export function buildRedirectUrl(request: Request, path: string): string {
  const host = resolveRequestHost(request);

  // 协议相对 URL（//evil.com）与反斜杠变体（/\evil.com）必须拦掉 ——
  // 否则拼进 base 会变成「同 host + evil 路径」，语义虽不外跳但意图可疑。
  const trimmed = path.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return `${resolveRequestProtocol(request)}://${host ?? new URL(request.url).host}/`;
  }

  const safePath = trimmed.startsWith('/') ? trimmed : '/';
  if (!host) {
    // 回退：Host 头缺失时用 request.url（保持旧行为）
    return new URL(safePath, request.url).toString();
  }
  const proto = resolveRequestProtocol(request);
  return `${proto}://${host}${safePath}`;
}
