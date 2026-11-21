import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getKV } from '../src/lib/kv';
import { rateLimit, rateLimitSliding } from '../src/lib/rate-limit';

/**
 * v0.0.19：固定窗口与滑动窗口必须有不同的可观测语义。
 * 不能用同一个测试窗口“看起来都通过”冒充两种实现。
 */

const ids: string[] = [];
const key = (name: string) => {
  const value = `v019-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  ids.push(value);
  return value;
};

let kv: Awaited<ReturnType<typeof getKV>>;

beforeAll(async () => {
  kv = await getKV();
});

afterAll(async () => {
  for (const id of ids) {
    await kv.del(`ratelimit:v019-fixed:${id}`).catch(() => undefined);
    await kv.del(`ratelimit-sliding:v019-sliding:${id}`).catch(() => undefined);
    await kv.del(`ratelimit-sliding:v019-concurrent:${id}`).catch(() => undefined);
  }
});

describe('v0.0.19 限流窗口语义', () => {
  it('固定窗口在整窗口边界重置，不保留上一窗口命中', async () => {
    const id = key('fixed');
    const bucketKey = `ratelimit:v019-fixed:${id}`;

    // 必须通过真实 KV 后端播种：CI 使用 Redis，本机降级到 PostgreSQL。
    // 只写其中一张表会让另一条实现“因为读到空存储”而假通过。
    const seeded = await kv.incrWindow(bucketKey, 1);
    expect(seeded.count).toBe(1);

    // 跨过完整 1 秒窗口：Redis 依靠 TTL 过期，PostgreSQL 依靠 window_start 对齐边界。
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const first = await rateLimit('v019-fixed', id, 5, 1);
    expect(first.count).toBe(1);
    expect(first.ok).toBe(true);

    const second = await rateLimit('v019-fixed', id, 5, 1);
    expect(second.count).toBe(2);
  });

  it('滑动窗口丢弃过期命中，只统计最近窗口', async () => {
    const id = key('sliding');
    const slidingKey = `ratelimit-sliding:v019-sliding:${id}`;

    // 用同一 KV 后端 + 显式时钟写入两个真实样本，覆盖 Redis 与 PostgreSQL。
    // 60 秒前的样本在第二步就应被删除；200ms 前的样本必须保留到生产调用。
    const old = await kv.slidingWindow(slidingKey, 30, Date.now() - 60_000);
    expect(old.count).toBe(1);
    const recent = await kv.slidingWindow(slidingKey, 30, Date.now() - 200);
    expect(recent.count).toBe(1);

    const result = await rateLimitSliding('v019-sliding', id, 5, 30);
    expect(result.count).toBe(2);
  });

  it('20 个并发滑动窗口请求得到唯一且连续的计数', async () => {
    const id = key('concurrent');
    const results = await Promise.all(
      Array.from({ length: 20 }, () => rateLimitSliding('v019-concurrent', id, 5, 60)),
    );
    const counts = results.map((result) => result.count).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(results.filter((result) => !result.ok)).toHaveLength(15);
  });
});
