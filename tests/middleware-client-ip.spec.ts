import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Middleware 客户端 IP 注入的回归测试
 *
 * ## 为什么必须单独测 middleware 这一层
 *
 * `tests/client-ip.spec.ts` 测的是 `resolveClientIp()` —— 也就是
 * **消费**内部头的那一端。但**生产**（`x-v2-client-ip` 内部头被伪造的路径）
 * 恰恰发生在**生产**（middleware）这一端。
 *
 * 2026-11-04 实测证明了这个缺口是真实的：
 * 把 middleware 的信任判断去掉（还原成「无条件采信 x-forwarded-for」），
 * `tests/client-ip.spec.ts` 的 **8 条用例全部照常通过** ——
 * 也就是说，**那个 P0 级的信任边界绕过，现有测试完全看不见**。
 *
 * 原因：`resolveClientIp()` 只看它**收到**的头；
 * 而伪造值是被 middleware **注入**进去的，消费端当然分不出来。
 *
 * 本文件因此直接测 middleware 本身：
 * 1. 客户端伪造的内部头会被**剥离**（不生效）
 * 2. 注入的是**真实来源**，不是客户端可控的值
 * 3. `TRUST_PROXY_HEADERS=0`（默认）时，客户端可控的代理头**不进入**内部头
 * 4. `TRUST_PROXY_HEADERS=1` 时，代理头才被采信
 */

const INTERNAL_CLIENT_IP_HEADER = 'x-v2-client-ip';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.TRUST_PROXY_HEADERS = '0';
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

/**
 * 构造一个 NextRequest（middleware 的入参形态）。
 *
 * 注意 `NextRequest` 的构造**不会**带上 socket 信息 ——
 * 这正是「middleware 在 Edge Runtime 拿不到真实来源地址」的技术前提，
 * 也是本实现必须依赖「显式信任模式」的原因。
 */
function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/test', {
    method: 'GET',
    headers,
  });
}

/**
 * 执行 middleware，返回注入后的请求头。
 *
 * middleware 通过 `NextResponse.next({ request: { headers } })` 把新头传下去，
 * 因此从 response 的 `x-middleware-request-*` 头里取回注入结果。
 */
async function runMiddleware(req: NextRequest): Promise<Headers> {
  const { middleware } = await import('../src/middleware');
  const res = (await middleware(req)) as Response;
  const override = res.headers.get('x-middleware-override-headers');
  const injected = new Headers();
  if (override) {
    for (const key of override.split(',')) {
      const k = key.trim();
      const v = res.headers.get(`x-middleware-request-${k}`);
      if (v !== null) injected.set(k, v);
    }
  }
  return injected;
}

describe('middleware 客户端 IP 注入', () => {
  it('剥离客户端伪造的 x-v2-client-ip，注入的是真实来源', async () => {
    const req = makeRequest({
      [INTERNAL_CLIENT_IP_HEADER]: '6.6.6.6',
      'x-forwarded-for': '7.7.7.7',
    });
    const injected = await runMiddleware(req);

    // 客户端伪造的 6.6.6.6 不得出现在注入结果里
    expect(injected.get(INTERNAL_CLIENT_IP_HEADER)).not.toBe('6.6.6.6');
  });

  it('TRUST_PROXY_HEADERS=0（默认）时，客户端可控的代理头不进入内部头', async () => {
    const req = makeRequest({
      'x-forwarded-for': '6.6.6.6',
      'x-real-ip': '7.7.7.7',
    });
    const injected = await runMiddleware(req);

    const value = injected.get(INTERNAL_CLIENT_IP_HEADER);
    // 伪造的代理头不得被「洗白」成内部可信头
    expect(value).not.toBe('6.6.6.6');
    expect(value).not.toBe('7.7.7.7');
    expect(value).toBe('127.0.0.1');
  });

  it('TRUST_PROXY_HEADERS=1 时才采信 x-forwarded-for 的首个地址', async () => {
    process.env.TRUST_PROXY_HEADERS = '1';
    const req = makeRequest({
      'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2',
    });
    const injected = await runMiddleware(req);
    expect(injected.get(INTERNAL_CLIENT_IP_HEADER)).toBe('203.0.113.5');
  });

  it('TRUST_PROXY_HEADERS=1 时无 x-forwarded-for 则回退到 x-real-ip', async () => {
    process.env.TRUST_PROXY_HEADERS = '1';
    const req = makeRequest({ 'x-real-ip': '198.51.100.7' });
    const injected = await runMiddleware(req);
    expect(injected.get(INTERNAL_CLIENT_IP_HEADER)).toBe('198.51.100.7');
  });

  it('TRUST_PROXY_HEADERS=1 且无任何代理头时退化为 127.0.0.1', async () => {
    process.env.TRUST_PROXY_HEADERS = '1';
    const req = makeRequest({});
    const injected = await runMiddleware(req);
    expect(injected.get(INTERNAL_CLIENT_IP_HEADER)).toBe('127.0.0.1');
  });

  it('客户端伪造的内部头即使同时带着合法代理头也不生效', async () => {
    // 反代场景（TRUST=1）+ 客户端试图伪造内部头
    process.env.TRUST_PROXY_HEADERS = '1';
    const req = makeRequest({
      [INTERNAL_CLIENT_IP_HEADER]: '6.6.6.6',
      'x-forwarded-for': '203.0.113.5',
    });
    const injected = await runMiddleware(req);
    // 应当是**反代提供的**地址，而不是客户端伪造的内部头
    expect(injected.get(INTERNAL_CLIENT_IP_HEADER)).toBe('203.0.113.5');
    expect(injected.get(INTERNAL_CLIENT_IP_HEADER)).not.toBe('6.6.6.6');
  });
});
