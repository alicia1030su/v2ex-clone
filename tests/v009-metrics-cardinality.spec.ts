import { describe, it, expect, beforeEach } from 'vitest';
import {
  countMetric,
  metricsSnapshot,
  normalizeApiPath,
  resetMetrics,
} from '../src/lib/observability';

/**
 * v0.0.9 —— 指标**基数控制**回归测试（发布前安全审计发现）
 *
 * ## 要锁住的风险
 *
 * `counters` 是一个 `Map`。若用**高基数**的键（例如把资源 id 拼进键），
 * 键数会随请求量**无界增长** ⇒ 进程内存持续上涨 ⇒ 长期运行的服务**内存泄漏**。
 *
 * 本仓的 API 路由里大量存在动态段（`/api/topics/[id]`、`/api/replies/[id]`、
 * `/api/admin/users/[id]/role` …），而 `src/instrumentation.ts` 观测的是
 * **原始请求路径** ⇒ `/api/topics/1` 与 `/api/topics/2` 会变成**两个不同的键**。
 *
 * 修复：
 * 1. `normalizeApiPath()` 把数字段 / UUID 段归一化成 `:id`
 *    ⇒ 键基数 = 真实路由数；
 * 2. `countMetric()` 另加键数上限兜底 ⇒ 即使调用方失误也不会无界增长。
 */
describe('v0.0.9 指标基数控制', () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe('normalizeApiPath', () => {
    it('数字 id 段归一化为 :id', () => {
      expect(normalizeApiPath('/api/topics/123')).toBe('/api/topics/:id');
      expect(normalizeApiPath('/api/replies/456/edit-history')).toBe(
        '/api/replies/:id/edit-history',
      );
    });

    it('UUID 段归一化为 :id', () => {
      expect(
        normalizeApiPath('/api/admin/users/3f2504e0-4f89-11d3-9a0c-0305e82c3301/role'),
      ).toBe('/api/admin/users/:id/role');
    });

    it('纯字母段保持原样（节点名等不是 id）', () => {
      expect(normalizeApiPath('/api/nodes/python/feed')).toBe('/api/nodes/python/feed');
      expect(normalizeApiPath('/api/health/ready')).toBe('/api/health/ready');
    });

    it('同一路由的不同 id 归一化到同一个模板', () => {
      const a = normalizeApiPath('/api/topics/1');
      const b = normalizeApiPath('/api/topics/999');
      const c = normalizeApiPath('/api/topics/12345');
      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it('空路径与根路径不报错', () => {
      expect(normalizeApiPath('')).toBe('');
      expect(normalizeApiPath('/')).toBe('/');
    });
  });

  describe('计数器键数上限', () => {
    it('超过上限后不再新增键，但已有键继续累加', () => {
      // 先灌 2000 个键（MAX_COUNTER_KEYS = 2000）
      for (let i = 0; i < 2000; i++) {
        countMetric(`filler.${i}`);
      }
      expect(Object.keys(metricsSnapshot().counters).length).toBe(2000);

      // 第 2001 个键 —— 不应被加入
      countMetric('overflow.key');
      const after = metricsSnapshot().counters;
      expect(after['overflow.key']).toBeUndefined();
      expect(Object.keys(after).length).toBe(2000);

      // 已有键**仍然**可以累加（统计维度封顶，数值不丢）
      countMetric('filler.0');
      expect(metricsSnapshot().counters['filler.0']).toBe(2);
    });
  });

  describe('用归一化后的路径计数', () => {
    it('100 个不同 id 的 404 只产生 1 个路由键', () => {
      for (let i = 1; i <= 100; i++) {
        const route = normalizeApiPath(`/api/topics/${i}`);
        countMetric(`api.error.4xx.${route}`);
      }
      const { counters } = metricsSnapshot();
      const routeKeys = Object.keys(counters).filter((k) => k.startsWith('api.error.4xx.'));
      expect(routeKeys.length).toBe(1);
      expect(routeKeys[0]).toBe('api.error.4xx./api/topics/:id');
      expect(counters['api.error.4xx./api/topics/:id']).toBe(100);
    });

    it('计数器总键数不随 id 数量增长', () => {
      for (let i = 1; i <= 500; i++) {
        countMetric(`api.error.5xx.${normalizeApiPath(`/api/replies/${i}`)}`);
      }
      expect(Object.keys(metricsSnapshot().counters).length).toBe(1);
    });
  });
});
