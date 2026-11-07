import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  countMetric,
  metricsSnapshot,
  recordSlowRequest,
  resetMetrics,
} from '../src/lib/observability';

/**
 * v0.0.9 —— 可观测性「跨 bundle 可见性」回归测试
 *
 * ## 覆盖的缺陷（v0.0.8 实测发现）
 *
 * 1. **模块实例隔离**：Next.js 把 `middleware.ts` 编译成独立 webpack bundle，
 *    与路由处理器的 bundle **不共享模块实例**。v0.0.8 里
 *    `observability.ts` 的 `Map` 是模块级变量 ⇒ 埋点写进 middleware 那份、
 *    `/api/admin/ops` 读路由那份 ⇒ **`api.requests` 恒为 0**。
 *
 *    修法：状态挂到 `globalThis` 上 ⇒ 同进程内共享。
 *
 * 2. **真实状态码**：middleware 的 `response.status` 恒为 200
 *    （`NextResponse.next()` 返回的是它自己的响应）⇒ `byStatus` 恒 `{200}`。
 *    修法：改由 `src/instrumentation.ts` 在 Node HTTP 层观测。
 *    —— 该部分需要真实 HTTP 服务，由**真实存在**的
 *    `e2e/v009-ops-metrics.spec.ts` 覆盖（v0.0.9 发布前审计 A-04 已补齐：
 *    此前这里指向的是一个不存在的文件）：它用真实请求产生
 *    200 / 401 / 403 / 404，再用 `/api/admin/ops` 的前后快照断言
 *    `byStatus` 被分别计入；5xx 因缺少稳定的真实端点，在该文件中以
 *    `test.fixme` 如实标注「**真实 HTTP 5xx 未覆盖**」。5xx 的**分桶逻辑**
 *    另由 `tests/v009-instrumentation-once.spec.ts` 的状态码分桶单测覆盖
 *    （直接把 ServerResponse 的 statusCode 设为 500 后断言桶位）。
 *    此处只保证**存储层**行为正确。
 *
 * ## 为什么用「动态 import + 二次求值」模拟 bundle 隔离
 *
 * vitest 的模块缓存会让 `import` 只求值一次，**无法复现**生产环境的
 * 「同一文件被两个 bundle 各求值一次」。因此这里用
 * `vi.resetModules()` + 动态 import 强制重新求值 —— 等价于生产里
 * middleware bundle 与 route bundle 各有一份模块实例。
 */
describe('v0.0.9 可观测性 · 跨 bundle 可见性', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('计数在重新求值模块后仍然可见（globalThis 桥接生效）', async () => {
    countMetric('api.request', 3);
    countMetric('api.status.200', 3);

    // 模拟「另一个 webpack bundle 重新求值了本模块」
    vi.resetModules();
    const fresh = await import('../src/lib/observability');

    const snap = fresh.metricsSnapshot();
    expect(snap.counters['api.request']).toBe(3);
    expect(snap.counters['api.status.200']).toBe(3);
  });

  it('重新求值后的模块与原模块写入同一份状态', async () => {
    vi.resetModules();
    const fresh = await import('../src/lib/observability');

    fresh.countMetric('api.error.5xx', 1);

    // 原模块读到的必须是同一份状态
    const snap = metricsSnapshot();
    expect(snap.counters['api.error.5xx']).toBe(1);
  });

  it('计数可累加且按名称分别统计', () => {
    countMetric('api.request');
    countMetric('api.request');
    countMetric('api.status.200');
    countMetric('api.status.500');

    const { counters } = metricsSnapshot();
    expect(counters['api.request']).toBe(2);
    expect(counters['api.status.200']).toBe(1);
    expect(counters['api.status.500']).toBe(1);
  });

  it('慢请求记录可跨模块求值读取，并受上限约束', async () => {
    recordSlowRequest('/api/topics', 2500);
    recordSlowRequest('/api/replies', 3000);

    vi.resetModules();
    const fresh = await import('../src/lib/observability');

    const snap = fresh.metricsSnapshot();
    expect(snap.slowRequests.length).toBe(2);
    expect(snap.slowRequests[0]?.route).toBe('/api/topics');
    expect(snap.slowRequests[0]?.durationMs).toBe(2500);
  });

  it('resetMetrics 清空计数与慢请求', async () => {
    countMetric('api.request');
    recordSlowRequest('/api/x', 5000);

    resetMetrics();

    const snap = metricsSnapshot();
    expect(snap.counters['api.request']).toBeUndefined();
    expect(snap.slowRequests.length).toBe(0);
  });

  it('慢请求条数不超过上限（防止内存无界增长）', async () => {
    vi.resetModules();
    const fresh = await import('../src/lib/observability');
    fresh.resetMetrics();

    for (let i = 0; i < 260; i++) {
      fresh.recordSlowRequest(`/api/route-${i}`, 2000 + i);
    }

    const snap = fresh.metricsSnapshot();
    // 上限 200 —— 超出部分被丢弃
    expect(snap.slowRequests.length).toBe(200);
    // 保留的是**最新**的 200 条
    expect(snap.slowRequests[snap.slowRequests.length - 1]?.route).toBe('/api/route-259');
  });
});
