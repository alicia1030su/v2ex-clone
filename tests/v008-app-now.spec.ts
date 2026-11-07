import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * v0.0.8：确定性时钟（视觉回归）
 *
 * ## 为什么需要
 *
 * 相对时间文案（src/lib/time.ts 的 relativeTime）在 Server Component 里渲染
 * ⇒ 用 Node 时钟 ⇒ 同一份种子数据在不同时刻渲染出不同长度的文本
 * ⇒ 320px 窄视口换行 ⇒ 容器高度变化 ⇒ **视觉基线随时间漂移**
 * （实测差 120px；master 与特性分支同样失败 ⇒ 与代码改动无关）。
 *
 * ## 契约
 *
 *   · APP_NOW 未设置 ⇒ 用真实时钟（生产行为**完全不变**）
 *   · APP_NOW 设置为合法 ISO8601 ⇒ 相对时间基于该时刻计算
 *   · APP_NOW 非法 ⇒ 忽略 + 明确错误日志（不能静默）
 *   · 只影响相对时间**文案**，不影响令牌有效期/限流/数据库时间戳
 */

describe('v0.0.8 确定性时钟（APP_NOW）', () => {
  const saved = process.env.APP_NOW;

  beforeEach(() => {
    // 动态 import 以便每个用例重置模块状态
    vi.resetModules();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.APP_NOW;
    else process.env.APP_NOW = saved;
    vi.resetModules();
  });

  it('未设置 APP_NOW ⇒ 使用真实时钟', async () => {
    delete process.env.APP_NOW;
    const appNow = await import('../src/lib/app-now');
    expect(appNow.isFixedClock).toBe(false);
    // 真实时钟 ⇒ nowMs 与 Date.now 接近
    expect(Math.abs(appNow.nowMs() - Date.now())).toBeLessThan(1000);
  });

  it('设置 APP_NOW ⇒ 时钟被冻结', async () => {
    process.env.APP_NOW = '2026-11-06T04:00:00.000Z';
    const appNow = await import('../src/lib/app-now');
    expect(appNow.isFixedClock).toBe(true);
    expect(appNow.nowMs()).toBe(Date.parse('2026-11-06T04:00:00.000Z'));
    expect(appNow.nowDate().toISOString()).toBe('2026-11-06T04:00:00.000Z');
  });

  it('非法 APP_NOW ⇒ 忽略并回退真实时钟（不静默崩溃）', async () => {
    process.env.APP_NOW = 'not-a-date';
    const appNow = await import('../src/lib/app-now');
    expect(appNow.isFixedClock).toBe(false);
  });

  it('relativeTime 在冻结时钟下产出确定性结果', async () => {
    process.env.APP_NOW = '2026-11-06T04:00:00.000Z';
    const { relativeTime } = await import('../src/lib/time');
    // 锚点**之前** 1 小时 ⇒ 「1 小时前」
    expect(relativeTime('2026-11-06T03:00:00.000Z')).toBe('1 小时前');
    // 锚点**之后**（种子数据的时间戳都落在锚点之后）⇒ diff 为负 ⇒ 「刚刚」
    expect(relativeTime('2026-11-06T05:00:00.000Z')).toBe('刚刚');
  });

  it('同一输入在冻结时钟下两次调用结果一致（确定性）', async () => {
    process.env.APP_NOW = '2026-11-06T04:00:00.000Z';
    const { relativeTime } = await import('../src/lib/time');
    const a = relativeTime('2026-11-06T05:00:00.000Z');
    const b = relativeTime('2026-11-06T05:00:00.000Z');
    expect(a).toBe(b);
  });

  it('显式传入 now 参数时优先于 APP_NOW（保持既有调用语义）', async () => {
    process.env.APP_NOW = '2026-11-06T04:00:00.000Z';
    const { relativeTime } = await import('../src/lib/time');
    const explicit = relativeTime(
      '2026-11-06T05:00:00.000Z',
      new Date('2026-11-07T05:00:00.000Z'),
    );
    expect(explicit).toBe('1 天前');
  });

  it('未冻结时相对时间反映真实经过时间', async () => {
    delete process.env.APP_NOW;
    const { relativeTime } = await import('../src/lib/time');
    expect(relativeTime(new Date(Date.now() - 60_000))).toBe('1 分钟前');
    expect(relativeTime(new Date(Date.now() - 3 * 3600_000))).toBe('3 小时前');
  });

  it('冻结时钟不影响令牌有效期 / 限流窗口等逻辑（它们不读 APP_NOW）', async () => {
    // 这条断言是**回归护栏**：确认 app-now 只被相对时间文案使用。
    // 若将来有人把 APP_NOW 接到令牌校验上，这里会失效（需重新评估安全性）。
    process.env.APP_NOW = '2020-01-01T00:00:00.000Z';
    const resetSrc = await import('node:fs').then((fs) =>
      fs.readFileSync('src/lib/reset-token.ts', 'utf8'),
    );
    expect(resetSrc).not.toContain('app-now');
    const rateSrc = await import('node:fs').then((fs) =>
      fs.readFileSync('src/lib/rate-limit.ts', 'utf8'),
    );
    expect(rateSrc).not.toContain('app-now');
  });
});
