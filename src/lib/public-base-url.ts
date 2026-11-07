/**
 * 公开站点基址解析（v0.0.8 安全加固）
 *
 * ## 用途
 *
 * 为「离开浏览器上下文的安全敏感绝对 URL」提供基址 —— 典型是
 * **密码重置邮件里的链接**（带一次性令牌）。
 *
 * ## 为什么不能从请求头推导
 *
 * Host / x-forwarded-host / x-forwarded-proto 都是**客户端或代理可控**的：
 *
 *   · 直连场景：攻击者可用任意工具伪造 Host 头发请求；
 *   · 反代场景：若代理不剥离客户端自带的转发头，攻击者可注入
 *     `x-forwarded-host: evil.com` ⇒ 重置链接指向攻击者域名
 *     ⇒ 受害者点链接 ⇒ **令牌泄露给攻击者**（完整账号接管）。
 *
 * 教训来源：v0.0.7 的 303 重定向先踩「request.url 用服务器 hostname」，
 * 再踩「改用请求头 ⇒ Host Header Poisoning」。同一类错误不再犯第三次。
 *
 * ## 设计（fail-closed）
 *
 * 只信任**运维显式配置**的环境变量：`PUBLIC_BASE_URL` → `APP_URL`。
 * 都没配 ⇒ 返回 null，调用方**必须拒绝发送**（而不是退回请求头）。
 * 配置值本身也要过严格校验（协议 / 主机名 / 非法字符）。
 */

/** 严格校验并归一化一个配置的基址；不合法返回 null */
function normalizeConfiguredBaseUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  // 只允许 http/https（拒绝 javascript:、data:、file: 等）
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  // 拒绝含控制字符/空字节的怪异主机名（new URL 一般已拦，双保险）
  if (/[\u0000-\u001f\u007f]/.test(u.hostname)) return null;
  // 保留 origin + 路径前缀（支持部署在子路径，如 https://example.com/forum）
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.origin}${path}`;
}

/**
 * 解析用于**邮件等站外场景**的公开基址。
 *
 * @returns 归一化基址（无末尾斜杠）；未配置或全部不合法时返回 **null**
 *
 * 调用方契约：返回 null 时**不得**用请求头推导兜底，必须放弃发送
 * 并留下可观测的错误日志。
 */
export function resolvePublicBaseUrl(): string | null {
  for (const candidate of [process.env.PUBLIC_BASE_URL, process.env.APP_URL]) {
    const value = candidate?.trim();
    if (!value) continue;
    const normalized = normalizeConfiguredBaseUrl(value);
    if (normalized) return normalized;
    // 配了但不合法 —— 必须响（否则运维以为配好了，实际邮件链接全是错的）
    console.error(
      `[public-base-url] 环境变量值不合法，已忽略：` +
        `${candidate === process.env.PUBLIC_BASE_URL ? 'PUBLIC_BASE_URL' : 'APP_URL'}="${value}"`,
    );
  }
  return null;
}
