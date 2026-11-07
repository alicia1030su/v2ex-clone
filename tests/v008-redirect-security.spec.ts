import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sanitizeRedirect, seeOther } from '../src/lib/redirect';
import { resolvePublicBaseUrl } from '../src/lib/public-base-url';

/**
 * v0.0.8 P0 安全回归测试
 *
 * 覆盖两件事：
 *   1. 303 重定向**只产生站内相对 Location**（Host Header Poisoning 修复的
 *      单元级锁 —— 集成级复现见 tools/security/host-attack-matrix.ts）；
 *   2. 邮件用公开基址**只信运维配置**，且 fail-closed。
 */

describe('sanitizeRedirect（开放重定向防护）', () => {
  it('保留合法站内路径', () => {
    expect(sanitizeRedirect('/t/123')).toBe('/t/123');
    expect(sanitizeRedirect('/t/123?page=2#reply')).toBe('/t/123?page=2#reply');
  });

  it('绝对 URL 一律归到 /', () => {
    expect(sanitizeRedirect('https://evil.example.com')).toBe('/');
    expect(sanitizeRedirect('http://evil.example.com/t/1')).toBe('/');
    expect(sanitizeRedirect('//evil.example.com')).toBe('/');
    expect(sanitizeRedirect('/\\evil.example.com')).toBe('/');
    expect(sanitizeRedirect('javascript:alert(1)')).toBe('/');
  });

  it('控制字符 / CRLF 注入归到 /', () => {
    expect(sanitizeRedirect('/t/1\r\nX-Injected: 1')).toBe('/');
    expect(sanitizeRedirect('/t/1\nSet-Cookie: a=b')).toBe('/');
    expect(sanitizeRedirect('/t/1\tX: 1')).toBe('/');
  });

  it('非字符串输入归到 /', () => {
    expect(sanitizeRedirect(undefined)).toBe('/');
    expect(sanitizeRedirect(null)).toBe('/');
    expect(sanitizeRedirect(123)).toBe('/');
    expect(sanitizeRedirect({ toString: () => '/x' })).toBe('/');
  });

  it('前后空白被剥掉后再判定', () => {
    expect(sanitizeRedirect('  /t/1  ')).toBe('/t/1');
    expect(sanitizeRedirect('  https://evil.com  ')).toBe('/');
  });
});

describe('seeOther（303 相对 Location）', () => {
  it('返回 303 + 相对 Location + no-store', () => {
    const res = seeOther('/t/123');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/t/123');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('内部再净化：传入绝对 URL 也不会产生开放重定向', () => {
    // 纵深防御 —— 调用方漏掉 sanitizeRedirect 也不能开口子
    expect(seeOther('https://evil.example.com').headers.get('location')).toBe('/');
    expect(seeOther('//evil.example.com').headers.get('location')).toBe('/');
    expect(seeOther('/\\evil.example.com').headers.get('location')).toBe('/');
  });

  it('Location 永不含协议与域名（Host 投毒面为零）', () => {
    for (const p of ['/t/1', '/go/programmer', '/', '/t/1?a=b']) {
      const loc = seeOther(p).headers.get('location') ?? '';
      expect(loc.startsWith('/')).toBe(true);
      expect(loc).not.toMatch(/^[a-z]+:\/\//i);
      expect(loc).not.toContain('://');
    }
  });
});

describe('resolvePublicBaseUrl（邮件链接基址，fail-closed）', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
    saved.APP_URL = process.env.APP_URL;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.APP_URL;
  });

  afterEach(() => {
    if (saved.PUBLIC_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = saved.PUBLIC_BASE_URL;
    if (saved.APP_URL === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved.APP_URL;
  });

  it('都未配置 ⇒ null（调用方必须 fail-closed）', () => {
    expect(resolvePublicBaseUrl()).toBeNull();
  });

  it('PUBLIC_BASE_URL 优先于 APP_URL', () => {
    process.env.PUBLIC_BASE_URL = 'https://public.example.com';
    process.env.APP_URL = 'http://internal:3000';
    expect(resolvePublicBaseUrl()).toBe('https://public.example.com');
  });

  it('APP_URL 兜底', () => {
    process.env.APP_URL = 'https://app.example.com';
    expect(resolvePublicBaseUrl()).toBe('https://app.example.com');
  });

  it('支持子路径部署（去掉末尾斜杠）', () => {
    process.env.APP_URL = 'https://example.com/forum/';
    expect(resolvePublicBaseUrl()).toBe('https://example.com/forum');
  });

  it('拒绝非 http/https 协议', () => {
    process.env.PUBLIC_BASE_URL = 'javascript:alert(1)';
    expect(resolvePublicBaseUrl()).toBeNull();
    process.env.PUBLIC_BASE_URL = 'file:///etc/passwd';
    expect(resolvePublicBaseUrl()).toBeNull();
  });

  it('拒绝畸形值（不静默接受）', () => {
    process.env.PUBLIC_BASE_URL = 'not a url';
    expect(resolvePublicBaseUrl()).toBeNull();
    process.env.PUBLIC_BASE_URL = 'https://';
    expect(resolvePublicBaseUrl()).toBeNull();
  });

  it('空白值被忽略', () => {
    process.env.PUBLIC_BASE_URL = '   ';
    process.env.APP_URL = 'https://ok.example.com';
    expect(resolvePublicBaseUrl()).toBe('https://ok.example.com');
  });

  it('URL 中的凭据部分不进入基址（origin 自动剔除）', () => {
    process.env.APP_URL = 'https://user:pass@example.com';
    expect(resolvePublicBaseUrl()).toBe('https://example.com');
  });
});
