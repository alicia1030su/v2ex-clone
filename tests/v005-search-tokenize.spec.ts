import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import {
  tokenizeSearchQuery,
  buildSearchPatterns,
  toLikePattern,
  limitSearchTokens,
  MAX_SEARCH_TOKENS,
} from '../src/lib/search-tokenize';

/**
 * v0.0.5 中文搜索 —— **生产模块**的单元测试
 *
 * 覆盖 `src/lib/search-tokenize.ts`（被 `src/app/api/search/route.ts` 使用）。
 *
 * 端到端的效果对比见 `tests/v005-search-quality.spec.ts`
 * （那是四种方案的横向对比，用独立语料库）。
 */

describe('v0.0.5 中文分词 · tokenizeSearchQuery', () => {
  it('中文取相邻二元组', () => {
    expect(tokenizeSearchQuery('性能优化')).toEqual(['性能', '能优', '优化']);
  });

  it('两个字的词只产生一个 bigram', () => {
    expect(tokenizeSearchQuery('性能')).toEqual(['性能']);
  });

  it('单个汉字保留为一个 token', () => {
    expect(tokenizeSearchQuery('猫')).toEqual(['猫']);
  });

  it('拉丁词整体保留，不被拆成 bigram', () => {
    expect(tokenizeSearchQuery('optimize')).toEqual(['optimize']);
  });

  it('中英混合：中文走 bigram，拉丁走整词', () => {
    expect(tokenizeSearchQuery('Rust异步')).toEqual(['rust', '异步']);
  });

  it('数字参与拉丁词', () => {
    expect(tokenizeSearchQuery('web3')).toEqual(['web3']);
  });

  it('单字母拉丁词被忽略（长度 < 2，避免噪声）', () => {
    expect(tokenizeSearchQuery('a')).toEqual([]);
  });

  it('去重', () => {
    // 「性能性能」四个字的 bigram 是「性能」「能性」「性能」⇒ 去重后 2 个
    expect(tokenizeSearchQuery('性能性能')).toEqual(['性能', '能性']);
  });

  it('纯符号返回空数组', () => {
    expect(tokenizeSearchQuery('!!!')).toEqual([]);
    expect(tokenizeSearchQuery('   ')).toEqual([]);
  });

  it('大小写不敏感', () => {
    expect(tokenizeSearchQuery('Optimize')).toEqual(['optimize']);
  });
});

describe('v0.0.5 中文分词 · limitSearchTokens', () => {
  it('不超过上限时原样返回', () => {
    const t = ['a', 'b', 'c'];
    expect(limitSearchTokens(t)).toEqual(t);
  });

  it('超过上限时截断', () => {
    const many = Array.from({ length: MAX_SEARCH_TOKENS + 20 }, (_, i) => `t${i}`);
    expect(limitSearchTokens(many).length).toBe(MAX_SEARCH_TOKENS);
  });

  it('50 字相同汉字只产生 1 个 bigram（去重后）', () => {
    // 「中」×50 ⇒ 49 个 bigram，但全是「中中」⇒ 去重后只剩 1 个
    const t = tokenizeSearchQuery('中'.repeat(50));
    expect(t).toEqual(['中中']);
    expect(limitSearchTokens(t).length).toBe(1);
  });

  it('50 字不同汉字产生 49 个 bigram（未超限）', () => {
    // 从 Unicode 码点**程序化**生成 50 个互不相同的汉字
    //（手写汉字串很容易数错字数 —— 实测踩到：写 50 个实际只有 32 个）
    const distinct = Array.from({ length: 50 }, (_, i) =>
      String.fromCodePoint(0x4e00 + i),
    ).join('');
    expect(distinct.length).toBe(50);
    expect(new Set(distinct).size).toBe(50);

    const t = tokenizeSearchQuery(distinct);
    expect(t.length).toBe(49);
    expect(limitSearchTokens(t).length).toBe(49);
  });
});

describe('v0.0.5 中文分词 · toLikePattern（LIKE 元字符转义）', () => {
  it('普通词被包成 %...%', () => {
    expect(toLikePattern('abc')).toBe('%abc%');
  });

  it('百分号被转义（防止变成通配符）', () => {
    expect(toLikePattern('100%')).toBe('%100\\%%');
  });

  it('下划线被转义', () => {
    expect(toLikePattern('a_b')).toBe('%a\\_b%');
  });

  it('反斜杠被转义', () => {
    expect(toLikePattern('a\\b')).toBe('%a\\\\b%');
  });
});

describe('v0.0.5 中文分词 · buildSearchPatterns', () => {
  it('纯 ASCII 关键词保持整串匹配（不劣化 v0.0.4 行为）', () => {
    expect(buildSearchPatterns('optimize')).toEqual(['%optimize%']);
  });

  it('含 CJK 的关键词：整串 + bigram 组合', () => {
    const p = buildSearchPatterns('性能优化');
    // 第 1 条必须是**整串**（排序时用它判断「标题强匹配」）
    expect(p[0]).toBe('%性能优化%');
    // 其余是 bigram
    expect(p).toContain('%性能%');
    expect(p).toContain('%能优%');
    expect(p).toContain('%优化%');
  });

  it('中英混合：整串 + 拉丁词 + CJK bigram', () => {
    const p = buildSearchPatterns('Rust异步');
    // 整串统一**小写**（ILIKE 本身不区分大小写，但模式保持一致）
    expect(p[0]).toBe('%rust异步%');
    expect(p).toContain('%rust%');
    expect(p).toContain('%异步%');
  });

  it('空查询返回空数组', () => {
    expect(buildSearchPatterns('')).toEqual([]);
    expect(buildSearchPatterns('   ')).toEqual([]);
  });

  it('纯符号查询返回空数组（无法分词）', () => {
    // ⚠️ 若按「纯 ASCII 整串匹配」处理会生成 `%!!!%` ——
    //    虽然 LIKE 元字符已转义（不会变成通配符），但必然匹配不到任何内容，
    //    白白浪费一次全表扫描。实现已提前判定为空。
    expect(buildSearchPatterns('!!!')).toEqual([]);
    expect(buildSearchPatterns('#$%^&*')).toEqual([]);
  });

  it('超长中文查询被截断（模式数有上限）', () => {
    const p = buildSearchPatterns('中'.repeat(200));
    // 1 条整串 + 至多 MAX_SEARCH_TOKENS 条 bigram
    expect(p.length).toBeLessThanOrEqual(MAX_SEARCH_TOKENS + 1);
  });

  it('模式无重复', () => {
    const p = buildSearchPatterns('性能优化');
    expect(new Set(p).size).toBe(p.length);
  });
});

describe('v0.0.5 中文分词 · 生产路由确实使用该模块', () => {
  it('src/app/api/search/route.ts 引用了 buildSearchPatterns', () => {
    // 静态断言：确保「生产路由真的用了中文分词」——
    // 否则模块写好了却没接上（这正是 v0.0.4 的状态：
    // 路由里只有整串 ILIKE，没有任何分词）。
    const route = readFileSync(
      path.join(__dirname, '..', 'src', 'app', 'api', 'search', 'route.ts'),
      'utf8',
    );
    expect(route).toContain('buildSearchPatterns');
    // 旧的整串 pattern 变量应当已被替换
    expect(route).not.toMatch(/const pattern = `%\$\{keyword/);
  });
});
