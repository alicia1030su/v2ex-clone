import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
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
    await db.delete(schema.rateLimitBuckets).where(eq(schema.rateLimitBuckets.key, `ratelimit:v019-fixed:${id}`));
    await db.delete(schema.rateLimitSlidingHits).where(eq(schema.rateLimitSlidingHits.key, `ratelimit-sliding:v019-sliding:${id}`));
    await db.delete(schema.rateLimitSlidingHits).where(eq(schema.rateLimitSlidingHits.key, `ratelimit-sliding:v019-concurrent:${id}`));
  }
});

describe('v0.0.19 限流窗口语义', () => {
  it('固定窗口在整窗口边界重置，不保留上一窗口命中', async () => {
    const id = key('fixed');
    const bucketKey = `ratelimit:v019-fixed:${id}`;
    await db.insert(schema.rateLimitBuckets).values({
      key: bucketKey,
      count: 99,
      windowStart: new Date(Date.now() - 10_000),
    });

    const first = await rateLimit('v019-fixed', id, 5, 1);
    expect(first.count).toBe(1);
    expect(first.ok).toBe(true);

    const second = await rateLimit('v019-fixed', id, 5, 1);
    expect(second.count).toBe(2);
  });

  it('滑动窗口丢弃过期命中，只统计最近窗口', async () => {
    const id = key('sliding');
    const slidingKey = `ratelimit-sliding:v019-sliding:${id}`;
    await db.delete(schema.rateLimitSlidingHits).where(eq(schema.rateLimitSlidingHits.key, slidingKey));
    // 用 30 秒窗口，避免 CI 调度抖动让“窗口内”样本在断言前恰好过期。
    // 60 秒前的样本必须被删除；200ms 前的样本必须保留；新增一次后计数为 2。
    await db.insert(schema.rateLimitSlidingHits).values([
      { key: slidingKey, hitAt: new Date(Date.now() - 60_000) },
      { key: slidingKey, hitAt: new Date(Date.now() - 200) },
    ]);

    const result = await rateLimitSliding('v019-sliding', id, 5, 30);
    expect(result.count).toBe(2);

    const rows = await db
      .select()
      .from(schema.rateLimitSlidingHits)
      .where(eq(schema.rateLimitSlidingHits.key, slidingKey));
    expect(rows).toHaveLength(2);
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
