import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { register } from '../src/instrumentation';
import { metricsSnapshot, resetMetrics } from '../src/lib/observability';

/**
 * v0.0.9 发布前安全审计 A-03 —— `instrumentation.ts` 重复计数回归
 *
 * ## 缺陷机理（已用真实 node:http 实测确认）
 *
 * `src/instrumentation.ts` 的 `res.once('finish', finish)` 写在
 * `patchedWriteHead` **函数体内** ⇒ 同一响应每调用一次 `writeHead`
 * 就多注册一个 `once('finish')` 监听器。`once` 只保证「单个监听器
 * 触发一次」，**不保证只注册一个监听器**。
 *
 * 实测（本机 Node，同一响应调用 3 次 writeHead）：
 *   · 基线实现：finish 回调执行 3 次、`listenerCount('finish')` = 4
 *     （Node 内部 1 + 补丁 3）⇒ `api.request` 被计 3 次
 *   · 修复语义：finish 回调 1 次、`listenerCount('finish')` = 2
 *
 * 注意：Node 原生 `writeHead` 第二次调用会抛 `ERR_HTTP_HEADERS_SENT`，
 * 但补丁是在**调用 originalWriteHead 之前**注册监听器的 ——
 * 所以异常并不阻止监听器累积，这正是缺陷能成立的原因。
 *
 * ## 预期修复（由工程师并行处理 src/instrumentation.ts）
 *
 * 在响应对象上用 `Symbol.for('v2ex.instrumentation.finishHooked')`
 * 标记，保证同一响应只注册一次 `finish`。
 *
 * ## 本测试的立场
 *
 * **按修复后的行为断言**（只计一次、监听器不累积）。
 * 在尚未合入 A-03 修复的基线上，主用例应当**失败** —— 这正是
 * 回归护栏的意义，不是测试写错。断言不含任何恒真条件。
 *
 * 本文件不依赖 PostgreSQL / Redis / Docker，可在无服务环境独立运行。
 */

const INSTRUMENTED_KEY = Symbol.for('v2ex.instrumentation.writeHead');

type WritableProto = {
  writeHead: (...args: unknown[]) => unknown;
  [key: symbol]: unknown;
};

const proto = http.ServerResponse.prototype as unknown as WritableProto;

type ProbeBody = {
  finishListeners: number;
  writeHeadErrors: string[];
};

type ProbeServer = {
  url: string;
  close: () => Promise<void>;
};

/** 轮询等待 'finish' 回调把计数写入 globalThis（跨进程 IO 有微小延迟） */
async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('等待指标写入超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * 起一个真实的临时 HTTP server，对**同一个响应**调用 `writeHeadCalls` 次
 * `writeHead`（后几次 Node 会抛错，此处捕获并把错误码带回响应体）。
 */
function startProbeServer(
  writeHeadCalls: number,
  path = '/api/v009-instrumentation-once',
): Promise<ProbeServer> {
  const server = http.createServer((_req, res) => {
    const writeHeadErrors: string[] = [];
    for (let i = 0; i < writeHeadCalls; i++) {
      try {
        res.writeHead(200, { 'content-type': 'application/json' });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        writeHeadErrors.push(code ?? (err instanceof Error ? err.message : String(err)));
      }
    }
    // 必须在 end() 之前读：finish 触发后 once 监听器会被移除
    const finishListeners = res.listenerCount('finish');
    res.end(JSON.stringify({ finishListeners, writeHeadErrors } satisfies ProbeBody));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('临时 server 未取到端口'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}${path}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function getJson(url: string): Promise<{ status: number; body: ProbeBody }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => {
          raw += chunk.toString('utf8');
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) as ProbeBody });
          } catch (err) {
            reject(err);
          }
        });
      })
      .once('error', reject);
  });
}

let originalWriteHead: WritableProto['writeHead'];
let originalFlag: unknown;
let hadFlag = false;

beforeAll(async () => {
  // register() 在 Edge 分支直接 return，必须显式声明 Node 运行时
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');

  // 保存并清除原型上的幂等标记，确保本次 register() 真的打上补丁；
  // 同时保存原始 writeHead，afterAll 还原，避免污染同进程其它测试文件。
  originalWriteHead = proto.writeHead;
  hadFlag = Object.prototype.hasOwnProperty.call(proto, INSTRUMENTED_KEY);
  originalFlag = proto[INSTRUMENTED_KEY];
  delete proto[INSTRUMENTED_KEY];

  resetMetrics();
  await register();
});

afterAll(() => {
  proto.writeHead = originalWriteHead;
  if (hadFlag) proto[INSTRUMENTED_KEY] = originalFlag;
  else delete proto[INSTRUMENTED_KEY];
  vi.unstubAllEnvs();
  resetMetrics();
});

beforeEach(() => {
  resetMetrics();
});

describe('v0.0.9 instrumentation · 同一响应只结算一次（A-03）', () => {
  it('多次 writeHead：api.request / api.status 只增加一次，finish 监听器不累积', async () => {
    // ── 对照组：单次 writeHead ────────────────────────────────
    const single = await startProbeServer(1);
    const singleRes = await getJson(single.url);
    await single.close();
    await waitFor(() => (metricsSnapshot().counters['api.request'] ?? 0) >= 1);
    const afterSingle = metricsSnapshot().counters;

    expect(singleRes.status).toBe(200);
    expect(singleRes.body.writeHeadErrors).toEqual([]);
    expect(afterSingle['api.request']).toBe(1);
    expect(afterSingle['api.status.200']).toBe(1);
    const singleListeners = singleRes.body.finishListeners;
    // 至少要有「Node 内部 1 个 + 补丁 1 个」，否则说明补丁根本没生效
    expect(singleListeners).toBeGreaterThanOrEqual(2);

    // ── 实验组：同一响应 3 次 writeHead ───────────────────────
    const multi = await startProbeServer(3);
    const multiRes = await getJson(multi.url);
    await multi.close();
    await waitFor(() => (metricsSnapshot().counters['api.request'] ?? 0) >= 2);
    const afterMulti = metricsSnapshot().counters;

    expect(multiRes.status).toBe(200);
    // 后两次 writeHead 确实抛错 —— 证明这不是「只调用了一次」的假对照
    expect(multiRes.body.writeHeadErrors).toEqual([
      'ERR_HTTP_HEADERS_SENT',
      'ERR_HTTP_HEADERS_SENT',
    ]);

    // 两个请求 ⇒ 计数必须是 2，而**不是** 1 + 3 = 4
    expect(afterMulti['api.request']).toBe(2);
    expect(afterMulti['api.status.200']).toBe(2);
    // 监听器数量与对照组一致 ⇒ 没有因多次 writeHead 而累积
    expect(multiRes.body.finishListeners).toBe(singleListeners);
  });

  it('重复调用 register() 不会叠加补丁（Symbol.for 幂等）', async () => {
    // 原型上已有 INSTRUMENTED 标记 ⇒ 本次 register() 应直接 return，
    // 不会把 writeHead 再包一层（否则单次请求会 +2）。
    await register();

    const server = await startProbeServer(1);
    const res = await getJson(server.url);
    await server.close();
    await waitFor(() => (metricsSnapshot().counters['api.request'] ?? 0) >= 1);

    expect(res.status).toBe(200);
    expect(metricsSnapshot().counters['api.request']).toBe(1);
    expect(metricsSnapshot().counters['api.status.200']).toBe(1);
  });

  it('非 /api/ 前缀的响应不进入 API 统计', async () => {
    const server = await startProbeServer(1, '/v009-instrumentation-page');
    const res = await getJson(server.url);
    await server.close();
    // 给 'finish' 一点时间，确认它**没有**写入计数
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(res.status).toBe(200);
    expect(metricsSnapshot().counters['api.request'] ?? 0).toBe(0);
    expect(metricsSnapshot().counters['api.status.200'] ?? 0).toBe(0);
  });
});
