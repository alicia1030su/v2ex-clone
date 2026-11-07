import { describe, it, expect, beforeEach } from 'vitest';
import {
  redact,
  maskEmailLocal,
  countMetric,
  metricsSnapshot,
  resetMetrics,
  recordSlowRequest,
  REDACTED,
} from '../src/lib/observability';

/**
 * v0.0.8：观测能力的单元测试
 *
 * 重点是**脱敏**（任务书 §六：「监控不能泄露数据库口令、Cookie、
 * 重置令牌和用户敏感信息」）—— 这是本模块最关键的安全属性。
 */

describe('v0.0.8 观测能力', () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe('redact（脱敏）', () => {
    it('敏感键名的值一律替换', () => {
      const out = redact({
        password: 'hunter2',
        token: 'abc',
        cookie: 'sid=1',
        session: 's',
        secret: 'x',
        authorization: 'Bearer y',
        database_url: 'postgres://u:p@h/db',
        redis_url: 'redis://:p@h:6379',
        reset_token: 'rt',
        api_key: 'k',
        normal: 'keep-me',
      }) as Record<string, unknown>;

      for (const k of [
        'password',
        'token',
        'cookie',
        'session',
        'secret',
        'authorization',
        'database_url',
        'redis_url',
        'reset_token',
        'api_key',
      ]) {
        expect(out[k], `${k} 必须被脱敏`).toBe(REDACTED);
      }
      expect(out.normal).toBe('keep-me');
    });

    it('键名大小写不敏感', () => {
      const out = redact({ PassWord: 'x', TOKEN: 'y', Cookie: 'z' }) as Record<string, unknown>;
      expect(out.PassWord).toBe(REDACTED);
      expect(out.TOKEN).toBe(REDACTED);
      expect(out.Cookie).toBe(REDACTED);
    });

    it('嵌套结构递归脱敏', () => {
      const out = redact({
        a: { b: { c: { password: 'deep' } } },
      }) as { a: { b: { c: { password: string } } } };
      expect(out.a.b.c.password).toBe(REDACTED);
    });

    it('数组内的对象也脱敏', () => {
      const out = redact([{ token: 't1' }, { token: 't2' }]) as { token: string }[];
      expect(out[0]!.token).toBe(REDACTED);
      expect(out[1]!.token).toBe(REDACTED);
    });

    it('超长字符串被截断（防止日志撑爆）', () => {
      const out = redact({ note: 'x'.repeat(1000) }) as { note: string };
      expect(out.note.length).toBeLessThan(600);
      expect(out.note).toContain('[truncated]');
    });

    it('循环引用不会栈溢出（有深度上限）', () => {
      const a: Record<string, unknown> = { name: 'a' };
      a.self = a;
      expect(() => redact(a)).not.toThrow();
    });

    it('基本类型原样返回', () => {
      expect(redact(42)).toBe(42);
      expect(redact(true)).toBe(true);
      expect(redact(null)).toBeNull();
      expect(redact(undefined)).toBeUndefined();
    });
  });

  describe('maskEmailLocal（邮箱脱敏）', () => {
    it('只保留首字符与域名', () => {
      expect(maskEmailLocal('alice@example.com')).toBe('a***@example.com');
    });

    it('畸形输入不泄露原文', () => {
      expect(maskEmailLocal('no-at-sign')).toBe('***');
      expect(maskEmailLocal('@only.com')).toBe('***');
    });
  });

  describe('计数与快照', () => {
    it('countMetric 按名累加', () => {
      countMetric('x');
      countMetric('x');
      countMetric('x', 3);
      expect(metricsSnapshot().counters.x).toBe(5);
    });

    it('resetMetrics 清空', () => {
      countMetric('y');
      resetMetrics();
      expect(metricsSnapshot().counters.y).toBeUndefined();
    });

    it('慢请求登记可被读取且有上限', () => {
      for (let i = 0; i < 260; i++) recordSlowRequest(`/api/r${i}`, 5000);
      const snap = metricsSnapshot();
      expect(snap.slowRequests.length).toBeLessThanOrEqual(200);
      expect(snap.slowRequests.length).toBeGreaterThan(0);
    });
  });
});
