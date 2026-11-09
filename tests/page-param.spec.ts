import { describe, it, expect } from 'vitest';
import { parsePageParam, clampOffset, MAX_PAGE } from '../src/lib/page-param';

/**
 * `page` 查询参数解析的单元测试（v0.0.14）
 *
 * ## 为什么这一层值得单独测
 *
 * 全仓 10 个分页页面此前各自手写 `Math.max(1, Number(p ?? 1) || 1)`。
 * 那一行的三个缺陷都是**实测**出来的，而不是"理论风险"：
 *
 * | 输入（URL） | 旧写法结果 | 真实后果 |
 * |---|---|---|
 * | `?p=1.5` | `1.5` | `OFFSET 1.5` ⇒ PostgreSQL `invalid input syntax for type bigint` ⇒ **整页 500** |
 * | `?p=Infinity` | `Infinity` | `OFFSET Infinity` ⇒ 同样 500 |
 * | `?p=999999999` | `999999999` | `OFFSET 19999999980` 深翻页 ⇒ 全表扫描 |
 *
 * 第三条（深翻页）不会报错，但会把数据库拖垮，属于**更难发现**的一类：
 * 页面照样 200，只是"慢到像挂了"。
 *
 * 本文件只测纯函数 —— 不碰数据库，因此可以在任何环境跑。
 */

describe('parsePageParam：合法输入', () => {
  it('未传 / 空值 ⇒ 第 1 页', () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam('')).toBe(1);
    // 只有空白的值也是"没填"（`?p=%20` 是合法 URL）
    expect(parsePageParam('   ')).toBe(1);
  });

  it('合法正整数原样返回', () => {
    expect(parsePageParam('1')).toBe(1);
    expect(parsePageParam('2')).toBe(2);
    expect(parsePageParam('42')).toBe(42);
    // 首尾空白与显式 `+` 号是常见的手写/复制粘贴形态
    expect(parsePageParam(' 7 ')).toBe(7);
    expect(parsePageParam('+7')).toBe(7);
  });

  it('数组形式（`?p=1&p=2`）取第一个', () => {
    // Next.js 的 searchParams 在参数重复时给出数组，语义应与
    // `URLSearchParams.get()` 一致（取第一个），而不是拼成一个字符串。
    expect(parsePageParam(['1', '2'])).toBe(1);
    expect(parsePageParam(['5'])).toBe(5);
    // 数组第一项本身非法 ⇒ 仍回退到 1，不能"跳过第一项取第二项"
    expect(parsePageParam(['abc', '3'])).toBe(1);
  });
});

describe('parsePageParam：非法输入一律回退到第 1 页', () => {
  const invalid = ['abc', '1.5', 'NaN', 'Infinity', '-Infinity', '-3', '0', '1e3', '0x10', '%20', '3px'];

  for (const raw of invalid) {
    it(`'${raw}' ⇒ 1`, () => {
      expect(parsePageParam(raw)).toBe(1);
      // 关键：结果必须是**有限的整数**，否则下游 `OFFSET` 会直接报 SQL 语法错
      expect(Number.isSafeInteger(parsePageParam(raw))).toBe(true);
    });
  }

  it('`1.5` 不会返回 1.5（旧写法的真实缺陷）', () => {
    // 负向对照：证明这个断言能分辨"修了"与"没修"
    const legacy = Math.max(1, Number('1.5') || 1);
    expect(legacy, '旧写法确实会返回 1.5 —— 所以这不是假想的缺陷').toBe(1.5);
    expect(parsePageParam('1.5')).toBe(1);
  });

  it('`Infinity` 不会返回 Infinity（旧写法的真实缺陷）', () => {
    const legacy = Math.max(1, Number('Infinity') || 1);
    expect(legacy, '旧写法确实会返回 Infinity').toBe(Infinity);
    expect(parsePageParam('Infinity')).toBe(1);
  });
});

describe('parsePageParam：上限钳制（不是回退到第 1 页）', () => {
  it('边界 999 / 1000 / 1001', () => {
    expect(MAX_PAGE).toBe(1000);
    expect(parsePageParam('999')).toBe(999);
    expect(parsePageParam('1000')).toBe(MAX_PAGE);
    // 超上限必须"钳到上限"：
    // 回退到第 1 页会让"翻到第 1001 页"的用户莫名回到首页，
    // 而且地址栏仍是 ?p=1001（URL 与内容不一致，刷新行为诡异）。
    expect(parsePageParam('1001')).toBe(MAX_PAGE);
    expect(parsePageParam('1001'), '钳制 ≠ 回退到 1').not.toBe(1);
    expect(parsePageParam('999999999')).toBe(MAX_PAGE);
  });

  it('超大数字串（超出安全整数）⇒ 钳到上限而不是 1', () => {
    // `Number('9'.repeat(30))` 是 1e30（非安全整数）
    expect(parsePageParam('9'.repeat(30))).toBe(MAX_PAGE);
  });

  it('可以用 opts.max 覆盖上限', () => {
    expect(parsePageParam('50', { max: 10 })).toBe(10);
    expect(parsePageParam('5', { max: 10 })).toBe(5);
    // 非法上限回退到默认上限 —— 绝不因为调用方传错而失去上界
    expect(parsePageParam('5000', { max: Number.NaN })).toBe(MAX_PAGE);
    expect(parsePageParam('5000', { max: 0 })).toBe(MAX_PAGE);
    expect(parsePageParam('5000', { max: -5 })).toBe(MAX_PAGE);
  });
});

describe('clampOffset：SQL OFFSET 永不溢出', () => {
  it('与全仓 `.offset((page - 1) * perPage)` 同口径', () => {
    expect(clampOffset(1, 20)).toBe(0);
    expect(clampOffset(2, 20)).toBe(20);
    expect(clampOffset(1000, 20)).toBe(19980);
  });

  it('乘积超出安全整数时钳到 MAX_SAFE_INTEGER（不退化成指数写法）', () => {
    const offset = clampOffset(Number.MAX_SAFE_INTEGER, 1000);
    expect(offset).toBe(Number.MAX_SAFE_INTEGER);
    // 关键：结果必须是安全整数 —— 否则 postgres 会序列化成 `1e+21`
    // ⇒ `invalid input syntax for type bigint` ⇒ 整页 500
    expect(Number.isSafeInteger(offset)).toBe(true);
    expect(String(offset)).not.toContain('e+');
  });

  it('非法 page / perPage 回退到安全值（不返回 NaN）', () => {
    // page 非法 ⇒ 视为第 1 页 ⇒ offset 0
    expect(clampOffset(Number.NaN, 20)).toBe(0);
    expect(clampOffset(0, 20)).toBe(0);
    expect(clampOffset(-5, 20)).toBe(0);
    expect(clampOffset(Infinity, 20)).toBe(0);

    // perPage 非法 ⇒ 视为 1 条/页（最小的安全值），offset 随之变成 page - 1。
    // 这里断言的是**真实语义**而不是"猜一个好看的数"：
    // 关键是"绝不返回 NaN / Infinity / 负数"，因为那些值进 SQL 就是 500。
    expect(clampOffset(3, Number.NaN)).toBe(2);
    expect(clampOffset(3, 0)).toBe(2);
    expect(clampOffset(3, -10)).toBe(2);
    for (const [page, perPage] of [
      [3, Number.NaN],
      [3, 0],
      [Number.NaN, 20],
      [Infinity, Infinity],
    ] as const) {
      const offset = clampOffset(page, perPage);
      expect(Number.isSafeInteger(offset), `clampOffset(${page}, ${perPage}) 必须返回安全整数`).toBe(
        true,
      );
      expect(offset, 'offset 不得为负').toBeGreaterThanOrEqual(0);
    }
    expect(Number.isNaN(clampOffset(Number.NaN, Number.NaN))).toBe(false);
  });

  it('maxOffset 可进一步钳制（业务上限）', () => {
    expect(clampOffset(100, 20, 500)).toBe(500);
    expect(clampOffset(2, 20, 500)).toBe(20);
    // 非法 maxOffset 视为"不限制"，但绝不返回负数
    expect(clampOffset(2, 20, Number.NaN)).toBe(20);
    expect(clampOffset(2, 20, -1)).toBe(20);
    expect(clampOffset(2, 20, Number.POSITIVE_INFINITY)).toBe(20);
  });

  it('parsePageParam + clampOffset 组合：深翻页被双重约束', () => {
    // 用户手写 ?p=999999999 ⇒ 页码钳到 1000 ⇒ offset 19980（而不是 2e10）
    const page = parsePageParam('999999999');
    expect(clampOffset(page, 20)).toBe(19980);
  });
});
