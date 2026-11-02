/**
 * 开放重定向防护
 *
 * 只允许站内相对路径跳转，拒绝任何绝对 URL 或协议相对 URL（//evil.com）。
 */
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
