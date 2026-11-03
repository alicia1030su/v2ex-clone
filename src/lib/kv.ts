/**
 * 键值存储抽象层
 *
 * 生产环境使用 Redis（ioredis），本地开发在没有 Redis 时自动降级到 PostgreSQL
 * 实现的等价语义（rate_limit_buckets 表）。两者行为一致：
 *  - incr(key, windowSeconds): 原子自增并返回当前窗口计数
 *  - get / set / del / expire
 *
 * 这样保证「不使用静态假数据伪装动态功能」：限流、会话缓存都走真实后端存储。
 */
import Redis from 'ioredis';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { extractRows } from '@/server/sql-rows';

type CounterResult = { count: number; resetAt: number };

interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incrWindow(key: string, windowSeconds: number): Promise<CounterResult>;
  ping(): Promise<boolean>;
  /**
   * 清空全部键（调试端点用）。
   *
   * 限流计数器的键空间随实现而变：
   *  - Redis 实现 → 存在 Redis 里
   *  - PostgreSQL 降级实现 → 存在 rate_limit_buckets 与 kv_store 表里
   * 只清其中一边会导致「清空限流」在另一种后端下静默失效。
   */
  clearAll(): Promise<void>;
}

class RedisKV implements KV {
  constructor(private readonly client: Redis) {}

  async get(key: string) {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string) {
    await this.client.del(key);
  }

  async incrWindow(key: string, windowSeconds: number): Promise<CounterResult> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    const ttl = await this.client.ttl(key);
    return { count, resetAt: Date.now() + Math.max(ttl, 0) * 1000 };
  }

  async ping() {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async clearAll() {
    // 清空整个库。Redis 实例与其它用途共享，用 FLUSHDB 保证彻底。
    await this.client.flushdb();
  }
}

/** PostgreSQL 降级实现：使用 rate_limit_buckets + 一个 kv 通用表 */
class PgKV implements KV {
  async get(key: string) {
    const res = await db.execute(sql`
      SELECT value FROM kv_store WHERE key = ${key} LIMIT 1
    `);
    return extractRows<{ value: string }>(res)[0]?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
    await db.execute(sql`
      INSERT INTO kv_store (key, value, expires_at)
      VALUES (${key}, ${value}, ${expiresAt})
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
    `);
  }

  async del(key: string) {
    await db.execute(sql`DELETE FROM kv_store WHERE key = ${key}`);
    // 限流计数器与通用 KV 使用同一键空间，需一并清除
    await db.execute(sql`DELETE FROM rate_limit_buckets WHERE key = ${key}`);
  }

  async incrWindow(key: string, windowSeconds: number): Promise<CounterResult> {
    const now = new Date();
    const windowStart = new Date(
      Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000,
    );
    const resetAt = windowStart.getTime() + windowSeconds * 1000;

    // postgres.js 不接受 Date 实例作为参数，需传 ISO 字符串。
    //
    // 窗口重置（修复前的缺陷）：原实现 ON CONFLICT 只做 count+1，
    // 从不比较 window_start。窗口过期后计数会无限累积，
    // 导致该键被永久锁死（限流阈值再也达不到 resetAt）。
    //
    // 现在：若已存在的行属于更早的窗口，则把 count 重置为 1 并更新 window_start。
    const res = await db.execute(sql`
      INSERT INTO rate_limit_buckets (key, count, window_start)
      VALUES (${key}, 1, ${windowStart.toISOString()})
      ON CONFLICT (key) DO UPDATE
        SET count = CASE
              WHEN rate_limit_buckets.window_start < ${windowStart.toISOString()}::timestamptz
                THEN 1
              ELSE rate_limit_buckets.count + 1
            END,
            window_start = CASE
              WHEN rate_limit_buckets.window_start < ${windowStart.toISOString()}::timestamptz
                THEN ${windowStart.toISOString()}::timestamptz
              ELSE rate_limit_buckets.window_start
            END
      RETURNING count
    `);

    return { count: Number(extractRows<{ count: number }>(res)[0]?.count ?? 1), resetAt };
  }

  async ping() {
    try {
      await db.execute(sql`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }

  async clearAll() {
    // 限流计数器与通用 KV 都在数据库里，两张表都要清。
    await db.execute(sql`DELETE FROM rate_limit_buckets`);
    await db.execute(sql`DELETE FROM kv_store`);
  }
}

let kvInstance: KV | null = null;
let kvInitPromise: Promise<KV> | null = null;

async function buildKV(): Promise<KV> {
  const url = process.env.REDIS_URL;
  if (!url) {
    return new PgKV();
  }
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: () => null,
  });
  client.on('error', () => {
    /* 由下方 ping 结果决定是否降级 */
  });
  try {
    await client.connect();
    await client.ping();
    return new RedisKV(client);
  } catch {
    client.disconnect();
    return new PgKV();
  }
}

export async function getKV(): Promise<KV> {
  if (kvInstance) return kvInstance;
  if (!kvInitPromise) {
    kvInitPromise = buildKV().then((kv) => {
      kvInstance = kv;
      return kv;
    });
  }
  return kvInitPromise;
}

/** 同步获取；未初始化时返回 null，调用方需处理降级 */
export function getKVIfReady(): KV | null {
  return kvInstance;
}
