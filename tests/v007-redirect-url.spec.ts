import { describe, it, expect } from 'vitest';
import {
  buildRedirectUrl,
  resolveRequestHost,
  resolveRequestProtocol,
} from '@/lib/redirect-url';

/**
 * v0.0.7：重定向 URL 必须保持**请求的 host**（产品缺陷 V7-05 的回归护栏）
 *
 * 背景：Next 的 `request.url` 用服务器自身 hostname（默认 localhost）重建，
 * 导致原生表单提交的 303 把用户从 127.0.0.1 带到 localhost
 * ⇒ 浏览器出现两个 v2_csrf cookie ⇒ 后续写操作一律 403。
 *
 * 这个测试把「重定向不换 host」变成可执行断言。
 */
describe('redirect-url（v0.0.7）', () => {
  const mkReq = (url: string, headers: Record<string, string> = {}) =>
    new Request(url, { headers });

  describe('resolveRequestHost', () => {
    it('优先取 host 头', () => {
      const req = mkReq('http://localhost:3103/api/replies', { host: '127.0.0.1:3103' });
      expect(resolveRequestHost(req)).toBe('127.0.0.1:3103');
    });

    it('x-forwarded-host 优先于 host（反代场景）', () => {
      const req = mkReq('http://localhost:3103/api/replies', {
        host: '127.0.0.1:3103',
        'x-forwarded-host': 'v2ex.example.com',
      });
      expect(resolveRequestHost(req)).toBe('v2ex.example.com');
    });

    it('x-forwarded-host 是逗号链时取第一个（最靠近客户端的）', () => {
      const req = mkReq('http://localhost:3103/api/replies', {
        'x-forwarded-host': 'v2ex.example.com, inner.proxy',
      });
      expect(resolveRequestHost(req)).toBe('v2ex.example.com');
    });

    it('两个头都没有时返回 null（由调用方回退）', () => {
      const req = mkReq('http://localhost:3103/api/replies');
      expect(resolveRequestHost(req)).toBeNull();
    });
  });

  describe('resolveRequestProtocol', () => {
    it('x-forwarded-proto=https 时返回 https', () => {
      const req = mkReq('http://localhost:3103/api/replies', { 'x-forwarded-proto': 'https' });
      expect(resolveRequestProtocol(req)).toBe('https');
    });

    it('无该头时用 request.url 的协议', () => {
      const req = mkReq('http://127.0.0.1:3103/api/replies');
      expect(resolveRequestProtocol(req)).toBe('http');
    });
  });

  describe('buildRedirectUrl', () => {
    it('用请求的 Host 构造，而不是 request.url 的 hostname', () => {
      const req = mkReq('http://localhost:3103/api/replies', { host: '127.0.0.1:3103' });
      // ⚠️ 关键断言：结果必须是 127.0.0.1，不能是 localhost
      expect(buildRedirectUrl(request_(req), '/t/22')).toBe('http://127.0.0.1:3103/t/22');
    });

    it('反代场景：x-forwarded-host + x-forwarded-proto 都被尊重', () => {
      const req = mkReq('http://localhost:3103/api/replies', {
        'x-forwarded-host': 'v2ex.example.com',
        'x-forwarded-proto': 'https',
      });
      expect(buildRedirectUrl(request_(req), '/t/22')).toBe('https://v2ex.example.com/t/22');
    });

    it('Host 头缺失时回退到 request.url（不引入新的失败模式）', () => {
      const req = mkReq('http://localhost:3103/api/replies');
      expect(buildRedirectUrl(request_(req), '/t/22')).toBe('http://localhost:3103/t/22');
    });

    it('非站内路径被强制为 /（防开放重定向）', () => {
      const req = mkReq('http://localhost:3103/api/replies', { host: '127.0.0.1:3103' });
      expect(buildRedirectUrl(request_(req), 'https://evil.example.com')).toBe(
        'http://127.0.0.1:3103/',
      );
    });

    it('协议相对路径 //evil.com 被拦为 /', () => {
      const req = mkReq('http://localhost:3103/api/replies', { host: '127.0.0.1:3103' });
      expect(buildRedirectUrl(request_(req), '//evil.example.com')).toBe(
        'http://127.0.0.1:3103/',
      );
    });

    it('反斜杠变体 /\\evil.com 也被拦为 /', () => {
      const req = mkReq('http://localhost:3103/api/replies', { host: '127.0.0.1:3103' });
      expect(buildRedirectUrl(request_(req), '/\\evil.example.com')).toBe(
        'http://127.0.0.1:3103/',
      );
    });
  });
});

/** mkReq 返回的 Request 已是 Request；此包装仅为类型清晰 */
function request_(r: Request): Request {
  return r;
}
