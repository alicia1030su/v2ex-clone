import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MAX_PAGE, parsePageParam, clampOffset } from '../../src/lib/page-param';

/**
 * `page` 参数统一化的静态护栏（v0.0.14）
 *
 * ## 这个文件为什么**只**断言纯模块
 *
 * 任务原本的想法是"断言页面不得再出现裸 `Math.max(1, Number(p ?? 1) || 1)`"。
 * 但**页面此刻还没改**（P0-1 由另一位工程师并行重构中，我按协作约束不碰页面）。
 * 若现在就把这条反向断言写进套件，套件会立刻变红；而为了让套件变绿，
 * 只有三种做法，**三种都是错的**：
 *
 *   · 恒真断言（`expect(true).toBe(true)`）—— 假绿，护栏失去意义；
 *   · `describe.skip` —— 跳过等于不通过，红灯被藏起来；
 *   · 放宽断言（只查注释、只查某个文件）—— 等于自己阉割护栏。
 *
 * 因此本文件只做两件**现在就能判定真假**的事：
 *
 * ① 纯模块存在、导出正确、行为正确（含负向对照）；
 * ② 用源码结构断言钉住实现的关键性质（如"必须 `Number.isInteger` 校验"、
 *    "必须钳 `MAX_PAGE`"），而不是靠"某个页面里没有某字符串"。
 *
 * 页面接入的护栏（`PAGE_PARAM_MIGRATION_QUEUE` 那份清单转成红灯断言）
 * 等页面合并后再加 —— 那时它是**可判定**的。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string): string => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/**
 * 去掉注释，只留真实代码。
 *
 * 本仓反复踩过「护栏用朴素字符串匹配，把注释里的说明当成实现」的坑
 * （V13-17 的 `not.toContain("from '@/db'")` 被注释误伤）。
 * 凡是「不得出现某写法」这类反向断言，都必须先剥注释。
 */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * 裸写法的模式：`Math.max(1, Number(p ?? 1) || 1)`
 *
 * 只在**去注释后**的源码上匹配，并且用一个**已知会命中的样本**做正向对照
 * （见下方「反向断言不是恒真」用例）—— 否则"改一下正则让它永不命中"
 * 就能让护栏假绿。
 */
const BARE_PAGE_PATTERN = /Math\.max\(\s*1,\s*Number\(/;

/**
 * 曾使用裸写法、现已接入 `parsePageParam()` 的 10 个页面。
 *
 * ## 这份清单的性质已经变了（v0.0.14 完成态）
 *
 * 页面迁移**之前**，这里只是「待接入登记」，测试只断言文件存在
 * （因为那时断言"必须还有裸写法"会在别人改页面时变红 —— 把巧合当契约）。
 *
 * 现在 10 处**已全部接入** ⇒ 清单升级为**双向断言**：
 *   · 每个页面都必须调用 `parsePageParam()`；
 *   · `src/app` 下不得再出现裸写法（全量扫描，不只是这 10 个文件）。
 * 这样新写一个分页页面若又抄了旧写法，会立刻红。
 */
const PAGE_PARAM_MIGRATED = [
  'src/app/page.tsx',
  'src/app/hot/page.tsx',
  'src/app/recent/page.tsx',
  'src/app/go/[name]/page.tsx',
  'src/app/go/search/page.tsx',
  'src/app/tag/[name]/page.tsx',
  'src/app/t/[id]/page.tsx',
  'src/app/following/page.tsx',
  'src/app/member/[username]/page.tsx',
  'src/app/leaderboard/page.tsx',
] as const;

/** 递归收集 `src/app` 下的 .tsx 页面文件（相对路径，正斜杠） */
function collectAppPages(dir = 'src/app', out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) collectAppPages(rel, out);
    else if (entry.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

describe('page-param 纯模块必须存在且导出正确', () => {
  it('模块文件存在', () => {
    expect(existsSync(path.join(ROOT, 'src/lib/page-param.ts'))).toBe(true);
  });

  it('导出 parsePageParam / MAX_PAGE / clampOffset，且是纯模块', () => {
    const src = read('src/lib/page-param.ts');
    expect(src, '必须导出 parsePageParam').toMatch(/export\s+function\s+parsePageParam/);
    expect(src, '必须导出 MAX_PAGE 常量').toMatch(/export\s+const\s+MAX_PAGE\s*=\s*1000/);
    expect(src, '必须导出 clampOffset').toMatch(/export\s+function\s+clampOffset/);

    // 纯模块：不得依赖 server-only / 数据库，否则无法在客户端与单测中共用
    const code = codeOnly(src);
    expect(code, '不得 import server-only').not.toMatch(/import\s+'server-only';/);
    expect(code, '不得依赖数据库').not.toMatch(/from\s+'@?\/?db'|from\s+'@\/db'/);
    expect(code, '不得依赖 drizzle-orm').not.toMatch(/from\s+'drizzle-orm'/);
  });

  it('实现必须逐项校验（而不是 `Math.max(1, Number(x) || 1)` 换个位置）', () => {
    const code = codeOnly(read('src/lib/page-param.ts'));
    // 关键性质 1：用 `Number.isInteger` / `Number.isSafeInteger` 一类**整数判定**。
    // 只做 `Math.max` 挡不住 `1.5`（`Math.max(1, 1.5)` = 1.5 ⇒ OFFSET 1.5 ⇒ SQL 报错）。
    expect(code, '必须有整数判定').toMatch(/Number\.is(?:Safe)?Integer/);
    // 关键性质 2：必须显式比较上限并**钳制**（不是回落 1）
    expect(code, '必须与上限比较并钳制').toMatch(/parsed\s*>\s*max/);
    expect(code, '钳制方向必须是返回 max').toContain('return max');
    // 关键性质 3：数组形态取第一个（`?p=1&p=2`）
    expect(code, '必须处理数组形态').toMatch(/Array\.isArray\(raw\)/);
    // 负向对照：不得用 parseInt「猜」一个值（`parseInt('12abc')` = 12 会掩掉错误）
    expect(code, '不得使用 parseInt 猜值').not.toMatch(/parseInt\(/);
  });
});

describe('page-param 行为护栏（与单元测试互补，防止实现被整段替换）', () => {
  it('合法输入原样、非法输入回退到 1', () => {
    expect(parsePageParam('7')).toBe(7);
    expect(parsePageParam('abc')).toBe(1);
    expect(parsePageParam('1.5')).toBe(1);
    expect(parsePageParam('Infinity')).toBe(1);
    expect(parsePageParam('0')).toBe(1);
    expect(parsePageParam('-3')).toBe(1);
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam('')).toBe(1);
  });

  it('超上限钳到 MAX_PAGE（**不是**回到第 1 页）', () => {
    expect(MAX_PAGE).toBe(1000);
    expect(parsePageParam('1001')).toBe(MAX_PAGE);
    expect(parsePageParam('1001')).not.toBe(1);
    expect(parsePageParam('999999999')).toBe(MAX_PAGE);
  });

  it('clampOffset 不产生非安全整数（否则 postgres 会把它写成 1e+21）', () => {
    const offset = clampOffset(Number.MAX_SAFE_INTEGER, 1000);
    expect(Number.isSafeInteger(offset)).toBe(true);
    expect(String(offset)).not.toContain('e+');
  });
});

describe('公共列表页面必须统一接入 parsePageParam', () => {
  it.each(PAGE_PARAM_MIGRATED)('%s 必须调用 parsePageParam', (rel) => {
    const code = codeOnly(read(rel));
    expect(code, `${rel} 必须用 parsePageParam() 解析页码`).toMatch(
      /parsePageParam\(\s*(?:params\.p|p)\s*\)/,
    );
    // 反向断言：不得再出现裸写法（先剥注释，避免被说明文字误伤）
    expect(code, `${rel} 不得再手写裸页码解析`).not.toMatch(BARE_PAGE_PATTERN);
    // totalPages 也要钳在 MAX_PAGE 以内：只钳 page 不钳 totalPages ⇒
    // 导航显示第 1001 页、实际查的是第 1000 页（地址栏与内容错位，用户可感知）。
    expect(code, `${rel} 的 totalPages 必须钳到 MAX_PAGE`).toContain('Math.min(MAX_PAGE');
  });

  it('全仓 src/ 不得再出现裸页码解析（负向对照证明判据有鉴别力）', () => {
    const offenders = collectSourceFiles(path.join(ROOT, 'src'))
      .filter((file) => BARE_PAGE_PATTERN.test(codeOnly(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))))
      .map((file) => path.relative(ROOT, file).replace(/\\/g, '/'));

    expect(
      offenders,
      `这些文件仍在手写裸页码解析，必须改用 parsePageParam()：\n${offenders.join('\n')}`,
    ).toEqual([]);

    // 负向对照：把**旧代码的真实样本**喂给同一正则，必须命中 ——
    // 否则「全仓没有」可能只是因为正则写错了（恒绿），或有人把正则改成永不匹配。
    expect(
      BARE_PAGE_PATTERN.test('const page = Math.max(1, Number(p ?? 1) || 1);'),
      '裸写法正则失去鉴别力（旧写法样本必须命中）',
    ).toBe(true);
    expect(
      BARE_PAGE_PATTERN.test('Math.max(\n  1,\n  Number(params.p ?? 1) || 1,\n)'),
      '正则必须容忍换行排版差异',
    ).toBe(true);
    // 误报对照：接入后的正确写法不得命中
    expect(BARE_PAGE_PATTERN.test('const page = parsePageParam(p);')).toBe(false);
  });
});
