import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.17 P1-1 搜索分页：契约锁（页面 ↔ 真库测试不得漂移）
 * ============================================================================
 *
 * ## 为什么需要这一层
 *
 * 搜索分页的真库测试（`tests/v017-search-pagination.spec.ts`）为了能跑，
 * 必须自己写一份查询。这就带来一个经典漂移风险：
 * **测试断言的是「测试自己的查询」，不是「页面用的查询」** ——
 * 页面如果把 `id` 兜底删掉，测试仍然全绿。
 *
 * 本文件把两边的**排序键集合**与**可见性条件来源**做成静态比对：
 * 页面改了排序、测试没改（或反之）⇒ 立即判红。
 *
 * ## 本文件还锁两条「任务书要求但容易漏」的行为
 *
 *   · **关键词必须跨页保留**：`Pager` 必须收到 `query={{ q }}`；
 *   · **空结果必须有明确提示**：不能只渲染一个空列表。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const PAGE = read('src/app/go/search/page.tsx');
const DB_TEST = read('tests/v017-search-pagination.spec.ts');

describe('v0.0.17 搜索分页：排序契约不得漂移', () => {
  it('页面排序必须含 id 兜底（否则并列时间下分页会重/漏）', () => {
    // 取 orderBy 那一行的实参
    // ⚠️ 不能用 `[^)]*`：`desc(schema.topics.lastReplyAt)` 内部就有右括号，
    //    第一版因此只截到 `desc(schema.topics.lastReplyAt` ⇒ 判据假红。
    //    改成「从 .orderBy( 起取到该语句的换行前的整段」。
    const m = PAGE.match(/\.orderBy\(([^\n]*)/);
    expect(m, '搜索页找不到 orderBy').toBeTruthy();
    const args = m![1];
    expect(args, '排序缺少 lastReplyAt').toMatch(/lastReplyAt/);
    expect(
      /topics\.id|schema\.topics\.id|\(schema\.topics\.id\)/.test(args),
      '排序缺少 id 兜底 —— 并列 lastReplyAt 时行序不确定，分页必然重/漏',
    ).toBe(true);
  });

  it('真库测试必须用**同一组**排序键（页面改了测试也要改）', () => {
    const m = DB_TEST.match(/const ORDER = \[([\s\S]*?)\] as const;/);
    expect(m, '真库测试找不到 ORDER 定义').toBeTruthy();
    const args = m![1];
    expect(args).toMatch(/lastReplyAt/);
    expect(args).toMatch(/topics\.id/);
  });

  it('列表与 count 必须共用同一个可见性条件来源', () => {
    // 两者都从 PUBLIC_NODE_CONDITION 取，而不是各写一份 eq(status,'active')
    expect(PAGE).toContain('PUBLIC_NODE_CONDITION');
    const occurrences = (PAGE.match(/PUBLIC_NODE_CONDITION/g) ?? []).length;
    expect(occurrences, '搜索页应同时用于列表与 count（≥2 处）').toBeGreaterThanOrEqual(2);
    // 反向断言：页面里不得再手写一份节点状态条件
    expect(PAGE, '页面手写了节点状态条件 —— 会与 PUBLIC_NODE_CONDITION 漂移').not.toMatch(
      /eq\(schema\.nodes\.status/,
    );
  });

  it('真库测试同样必须使用该条件（不得自己放宽）', () => {
    expect(DB_TEST).toContain('PUBLIC_NODE_CONDITION');
    expect(DB_TEST).not.toMatch(/eq\(schema\.nodes\.status/);
  });
});

describe('v0.0.17 搜索分页：跨页保留关键词 + 空结果提示', () => {
  it('上下两个分页器都必须带 q，否则翻页后关键词丢失', () => {
    const matches = PAGE.match(/query=\{q \? \{ q \} : undefined\}/g) ?? [];
    expect(matches.length, '分页器数量应为 2（顶部 + 底部），且都带 q').toBe(2);
  });

  it('空结果必须有可见提示（不能只渲染空列表）', () => {
    expect(PAGE).toMatch(/没有找到相关主题/);
  });

  it('页码必须走统一解析（非法/超大页码由它兜底）', () => {
    expect(PAGE).toContain('parsePageParam');
    // 反向断言：不得自己 parseInt 页码
    expect(PAGE, '页面自己解析页码 —— 非法值会绕过统一兜底').not.toMatch(/parseInt\(\s*params\.p/);
  });

  it('totalPages 必须钳在 MAX_PAGE 内（与页码解析上限一致）', () => {
    expect(PAGE).toMatch(/Math\.min\(MAX_PAGE/);
  });
});

describe('v0.0.17 搜索分页：节点/会员匹配只在第 1 页', () => {
  it('侧栏匹配必须受 page === 1 约束', () => {
    // 否则每页都重复渲染同一批节点/会员，用户会以为「翻页没生效」
    expect(PAGE).toMatch(/showSideMatches[\s\S]{0,120}page === 1/);
    // 允许 `showSideMatches` 与 `?` 之间换行（实际代码就是换行书写）
    const useCount = (PAGE.match(/showSideMatches\s*\?/g) ?? []).length;
    expect(useCount, '节点与会员两处都应受该开关约束').toBe(2);
  });
});
