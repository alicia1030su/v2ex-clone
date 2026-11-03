/**
 * PROBE: Redis 运行期断线（初始化成功 → 之后断线）时，限流是否仍然生效
 *
 * 复刻 src/lib/kv.ts 的 buildKV / getKV / RedisKV.incrWindow 逻辑。
 * 注意：src/lib/kv.ts 带 import 'server-only'，纯 Node 环境不能直接 import，
 *       因此这里逐行复刻其逻辑（并在下方的静态断言里校验复刻与源码一致）。
 */
import { startFakeRedis } from './fake-redis.mjs';
import { readFileSync } from 'node:fs';

const kvSrc = readFileSync('src/lib/kv.ts', 'utf8');

// ---- 复刻 KV 抽象 ----
class RedisKV {
  constructor(client) { this.client = client; }
  async get(key) { return this.client.get(key); }
  async set(key, value, ttl) {
    if (ttl && ttl > 0) await this.client.set(key, value, 'EX', ttl);
    else await this.client.set(key, value);
  }
  async del(key) { await this.client.del(key); }
  async incrWindow(key, windowSeconds) {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, windowSeconds);
    const ttl = await this.client.ttl(key);
    return { count, resetAt: Date.now() + Math.max(ttl, 0) * 1000 };
  }
  async ping() { try { return (await this.client.ping()) === 'PONG'; } catch { return false; } }
  async clearAll() { await this.client.flushdb(); }
}

class PgKV {
  async incrWindow() { return { count: 1, resetAt: Date.now() }; }
  async ping() { return true; }
}

let kvInstance = null;
let kvInitPromise = null;

async function buildKV() {
  const url = process.env.REDIS_URL;
  if (!url) return new PgKV();
  const { default: Redis } = await import('ioredis');
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: () => null,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.ping();
    return new RedisKV(client);
  } catch {
    client.disconnect();
    return new PgKV();
  }
}

async function getKV() {
  if (kvInstance) return kvInstance;
  if (!kvInitPromise) {
    kvInitPromise = buildKV().then((kv) => { kvInstance = kv; return kv; });
  }
  return kvInitPromise;
}

// ---- 实测 ----
const fake = startFakeRedis(0);
await new Promise((r) => fake.server.listen(0, '127.0.0.1', r));
const port = fake.server.address().port;
process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
console.log('假 Redis 监听端口:', port);

console.log('\n===== PROBE: Redis 运行期断线 =====');
const kv = await getKV();
console.log('1) 初始化后的实现:', kv.constructor.name, kv.constructor.name === 'RedisKV' ? '✅ 用 Redis' : '❌ 意外降级');

const c1 = await kv.incrWindow('k1', 60);
const c2 = await kv.incrWindow('k1', 60);
const c3 = await kv.incrWindow('k1', 60);
console.log('2) 断线前 incrWindow:', c1.count, c2.count, c3.count, '（期望 1,2,3）');

console.log('3) 杀掉 Redis（模拟重启/被杀）...');
fake.kill();
await new Promise((r) => setTimeout(r, 500));

let err = null;
let after = null;
try {
  after = await kv.incrWindow('k1', 60);
} catch (e) {
  err = e;
}
console.log('4) 断线后 incrWindow:', after ? `count=${after.count}` : `抛错: ${err?.message ?? err}`);
if (err) {
  console.log('   错误类型:', err.constructor.name, '| message:', err.message);
  console.log('   ⇒ ❌ *** 缺口确认：Redis 运行期断线后，限流直接抛错，没有降级到 PostgreSQL ***');
  console.log('   ⇒ 上层若未捕获 → 请求 500；若被吞掉 → 限流被绕过（无限制）');
} else {
  console.log('   ⇒ ✅ 未抛错，count =', after.count);
}

// 5) 验证 getKV() 仍返回同一个（未重建的）实例
const kv2 = await getKV();
console.log('5) 断线后 getKV() 返回:', kv2.constructor.name, '=== 原实例?', kv2 === kv ? '✅ 是（说明不会重建/重试）' : '❌ 否');

// 6) ioredis 的 retryStrategy: () => null 行为 —— 断线后是否会重连
const { default: Redis } = await import('ioredis');
const probeClient = new Redis(`redis://127.0.0.1:${port}`, {
  lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000, retryStrategy: () => null,
});
probeClient.on('error', () => {});
try { await probeClient.connect(); await probeClient.ping(); console.log('6) 探测客户端已连接'); } catch (e) { console.log('6) 连接失败', e.message); }
let reconnectAttempted = false;
probeClient.on('reconnecting', () => { reconnectAttempted = true; });
fake.kill();
await new Promise((r) => setTimeout(r, 1500));
console.log('   断线后是否触发 reconnecting 事件:', reconnectAttempted, reconnectAttempted ? '（会重连）' : '⇒ retryStrategy: () => null 禁用了重连');
console.log('   client.status =', probeClient.status);
probeClient.disconnect();

// 7) 静态校验：复刻的 incrWindow 与源码语义一致
console.log('\n7) 源码一致性校验:');
console.log('   源码含 retryStrategy: () => null →', kvSrc.includes('retryStrategy: () => null') ? '✅' : '❌');
console.log('   源码 getKV 只在 kvInstance 为空时重建 →', /if \(kvInstance\) return kvInstance;/.test(kvSrc) ? '✅ 确认：不会重建' : '❌');
console.log('   源码 RedisKV.incrWindow 无 try/catch →', !/async incrWindow[\s\S]{0,400}?try\s*{/.test(kvSrc.split('async incrWindow')[1]?.slice(0, 400) ?? '') ? '✅ 确认：无错误兜底' : '❌');

await fake.close();
console.log('\nprobe5 done');
