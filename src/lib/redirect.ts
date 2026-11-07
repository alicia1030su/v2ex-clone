/**
 * 重定向工具：开放重定向防护 + 303 See Other 构造
 *
 * v0.0.8 安全加固（P0）：
 *
 * ## 为什么 303 用**站内相对 Location**
 *
 * v0.0.7 曾用 `new URL(redirect, request.url)` 构造绝对 Location ——
 * Next 在 `next start` 下按**服务器自身 hostname**（localhost）重建
 * `request.url`，把用户带到错误 host（两个 v2_csrf cookie ⇒ 后续写操作 403）。
 *
 * v0.0.8 审计进一步发现：即便改用请求头（Host / x-forwarded-host）构造
 * 绝对 URL（v0.0.7 的 `redirect-url.ts`），也存在 **Host Header Poisoning**
 * 面 —— 不可信代理 / 直连场景下攻击者可控制 Location 的域名与协议
 * （303 缓存投毒、反代部署跳到错误域名）。
 *
 * 因此改为 **RFC 7231 §7.1.2 允许的相对引用**：`Location: /t/123`。
 * 浏览器按**实际请求的 URL** 解析 ⇒ host 与协议永远正确，
 * 且**不经过任何请求头** ⇒ 无投毒面。这是同类框架（Rails/Django）
 * 对「POST 后跳回本站」的标准做法。
 */

/** 开放重定向防护：只允许站内相对路径（调用方应先走 sanitizeRedirect） */
export function sanitizeRedirect(next: unknown): string {
  if (typeof next !== 'string') return '/';
  const trimmed = next.trim();
  if (!trimmed.startsWith('/')) return '/';
  // "//evil.com" 与 "/\evil.com" 都是协议相对 URL
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return '/';
  // 拒绝包含控制字符或换行的注入尝试
  if (/[\r\n\t]/.test(trimmed)) return '/';
  return trimmed;
}

/**
 * 构造 303 See Other 响应（**相对 Location**）。
 *
 * @param path 目标路径（内部会再过一遍 sanitizeRedirect —— 纵深防御，
 *              防调用方漏掉净化步骤造成开放重定向）
 *
 * 用法：
 *   return seeOther(form.get('redirect'));
 *
 * 注意：不要改成绝对 URL。若未来确需绝对 URL（如邮件里的链接），
 * 必须使用**运维配置的公开 Origin**（PUBLIC_BASE_URL / APP_URL），
 * 严禁从请求头推导 —— 见 src/lib/public-base-url.ts 与
 * docs/SECURITY_AUDIT_v0.0.8.md。
 */
export function seeOther(path: unknown): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: sanitizeRedirect(path),
      // 303 响应本身不缓存；显式声明，防止中间缓存把带 token 的跳转缓存掉
      'Cache-Control': 'no-store',
    },
  });
}
