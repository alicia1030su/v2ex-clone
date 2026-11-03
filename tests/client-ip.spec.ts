import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 限流客户端 IP 的信任边界回归测试
 *
 * 修复前的缺陷：应用无条件信任 `x-forwarded-for` / `x-real-ip`，
 * 而应用端口直接映射到宿主机（`deploy/docker-compose.yml` 的
 * `ports: ['${APP_PORT:-3000}:3000']`），攻击者可以直连并伪造这两个头，
 * 导致登录暴力破解与批量注册的限流**完全可绕过**。
 *
 * 这些用例锁死修复后的信任模型：
 *   - 默认（TRUST_PROXY_HEADERS=0）：代理头**不影响**分桶
 *   - 显式开启（TRUST_PROXY_HEADERS=1）：才采信代理头
 *   - 客户端伪造的内部头（x-v2-client-ip）不能生效
 */

/** 构造一个最小可用的 headers 读取器 */
function hdrs(map: Record<string, string>) {
  return {
    get(name: string): string | null {
      const k = Object.keys(map).find((x) => x.toLowerCase() === name.toLowerCase());
      return k ? map[k] : null;
    },
  };
}

async function loadResolver() {
  // 每个用例重新加载模块，确保能读到当前 env
  vi.resetModules();
  const mod = await import('../src/lib/client-ip');
  return mod;
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.TRUST_PROXY_HEADERS = '0';
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('客户端 IP 解析（限流信任边界）', () => {
  it('默认不采信 x-forwarded-for —— 伪造的头不得改变限流分桶', async () => {
    const { resolveClientIp } = await loadResolver();
    const h = hdrs({
      'x-forwarded-for': '1.2.3.4',
      'x-real-ip': '5.6.7.8',
      'x-v2-client-ip': '10.0.0.1',
    });
    const ip = await resolveClientIp(h);
    expect(ip).not.toBe('1.2.3.4');
    expect(ip).not.toBe('5.6.7.8');
    // 应回落到 middleware 注入的内部头
    expect(ip).toBe('10.0.0.1');
  });

  it('默认不采信代理头时，伪造 x-forwarded-for 无法改变分桶', async () => {
    const { resolveClientIp } = await loadResolver();
    const base = hdrs({ 'x-v2-client-ip': '10.0.0.1' });
    const spoofed = hdrs({
      'x-v2-client-ip': '10.0.0.1',
      'x-forwarded-for': '9.9.9.9',
    });
    expect(await resolveClientIp(spoofed)).toBe(await resolveClientIp(base));
  });

  it('客户端伪造的 x-v2-client-ip 会被 middleware 剥离（此处验证常量一致）', async () => {
    const { INTERNAL_CLIENT_IP_HEADER } = await loadResolver();
    expect(INTERNAL_CLIENT_IP_HEADER).toBe('x-v2-client-ip');
  });

  it('TRUST_PROXY_HEADERS=1 时采信 x-forwarded-for 的首个地址', async () => {
    process.env.TRUST_PROXY_HEADERS = '1';
    const { resolveClientIp } = await loadResolver();
    const ip = await resolveClientIp(
      hdrs({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2' }),
    );
    expect(ip).toBe('203.0.113.5');
  });

  it('TRUST_PROXY_HEADERS=1 时无 x-forwarded-for 则回退到 x-real-ip', async () => {
    process.env.TRUST_PROXY_HEADERS = '1';
    const { resolveClientIp } = await loadResolver();
    expect(await resolveClientIp(hdrs({ 'x-real-ip': '198.51.100.7' }))).toBe(
      '198.51.100.7',
    );
  });

  it('TRUST_PROXY_HEADERS=1 且没有任何头时退化为 127.0.0.1', async () => {
    process.env.TRUST_PROXY_HEADERS = '1';
    const { resolveClientIp } = await loadResolver();
    expect(await resolveClientIp(hdrs({}))).toBe('127.0.0.1');
  });

  it('归一化 IPv6 映射形式与带端口的地址', async () => {
    process.env.TRUST_PROXY_HEADERS = '1';
    const { resolveClientIp } = await loadResolver();
    expect(await resolveClientIp(hdrs({ 'x-forwarded-for': '::ffff:192.0.2.10' }))).toBe(
      '192.0.2.10',
    );
    expect(await resolveClientIp(hdrs({ 'x-forwarded-for': '[2001:db8::1]:443' }))).toBe(
      '2001:db8::1',
    );
  });

  it('不信任代理头时，x-v2-client-ip 缺失则退化为 127.0.0.1', async () => {
    const { resolveClientIp } = await loadResolver();
    expect(await resolveClientIp(hdrs({}))).toBe('127.0.0.1');
  });
});
