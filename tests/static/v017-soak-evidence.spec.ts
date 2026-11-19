import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.17 P0-4 长跑证据：**「未采集」不得写成「0」**
 * ============================================================================
 *
 * ## 真实缺陷（v0.0.16 及更早）
 *
 * 长跑证据 `perf-samples.csv` 长这样（run 44296152975）：
 *
 * ```
 * ts,elapsed_s,mem_mb,cpu_pct,conn_used,conn_max,home_ms,db_ms
 * 2026-11-18T11:46:04Z,541,0.0,0.0,,,00,4
 * 2026-11-18T11:56:05Z,1142,0.0,0.0,,,00,7
 * ```
 *
 * 汇总里就写成「峰值内存：0 MB」。**但这不是「测到 0」，是「没测到」**：
 *
 * 1. `ps -o rss= -C node` 按**命令名精确匹配** `node`，
 *    而实际进程是 `next-server (v15.5.28)` ⇒ 匹配不到；
 * 2. 即使匹配不到，`awk '{s+=$1} END {printf "%.1f", s/1024}'` 对**空输入**
 *    仍然输出 `0.0`（`s` 为空 ⇒ `0/1024`）。
 *
 * 于是「采集失败」被渲染成一个**看起来像结论的数字**：
 * 「这服务几乎不占内存」。这正是本仓反复禁止的「把未知写成已知」。
 *
 * ## 本 spec 锁什么
 *
 *   · 采集必须按**命令行**匹配（`pgrep -f`），不依赖进程名；
 *   · 取不到时必须**留空**，且汇总里必须出现「未采集」；
 *   · 「未采集」与「0」在文本上必须可区分。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SOAK_RAW = readFileSync(path.join(ROOT, 'scripts/release/verify-soak.sh'), 'utf8');

/*
 * 只对**可执行代码**做反向断言，先把注释剥掉。
 *
 * ⚠️ 这一条是被自己的负向对照教出来的：修复时在注释里写了
 * 「原来的 `ps -o rss= -C node` 测不到任何东西」，而反向断言是
 * 「全文不得出现该写法」⇒ 注释既解释了缺陷、又让判据判红。
 * 本仓已记录过同类事故（V15-06 模板护栏被自己的黑名单误伤）：
 * **反向断言必须先剥掉不该算数的部分。**
 */
const SOAK = SOAK_RAW.split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');

describe('v0.0.17 P0-4 长跑：资源采集不得把「没测到」写成 0', () => {
  it('不得只靠 `ps -C node`（进程名精确匹配，next 的实际名是 next-server）', () => {
    expect(
      /ps\s+-o\s+rss=\s+-C\s+node/.test(SOAK),
      '又用回了 `ps -C node` —— next 的进程名是 next-server，匹配不到 ⇒ 恒为 0',
    ).toBe(false);
  });

  it('必须按命令行匹配进程（pgrep -f）', () => {
    expect(SOAK).toMatch(/pgrep\s+-f/);
  });

  it('awk 聚合必须区分「空输入」与「真 0」（用 NF 判断）', () => {
    // 空输入时 awk 的 s 为 0，若直接 printf 就会输出 0.0
    expect(SOAK, 'awk 没有用 NF 判空 —— 空输入会被算成 0').toMatch(/awk\s+'NF\s*\{/);
    expect(SOAK).toMatch(/if\s*\(n\s*>\s*0\)/);
  });

  it('汇总必须能输出「未采集」，且与 0 区分', () => {
    // ⚠️ 必须锚到**内存那一行**。只写 `/未采集/` 会被 PG 连接那行兜住 ——
    //    实测负向对照：把内存的「未采集」改回「0 MB」后用例仍然通过。
    expect(SOAK).toMatch(/峰值内存：未采集/);
    // 必须显式排除 0 / 0.0 这两种「看起来有值」的情况
    expect(SOAK).toMatch(/!= "0"/);
    expect(SOAK).toMatch(/!= "0\.0"/);
  });

  it('PG 连接数未提供 --pg-bin 时也必须写「未采集」而不是 0', () => {
    expect(SOAK).toMatch(/峰值PG连接：未采集/);
  });
});

describe('v0.0.17 P0-4 长跑：累计时长不得冒充单实例连续时长', () => {
  it('必须同时报告「累计」与「单段最长连续」', () => {
    expect(SOAK).toMatch(/累计运行时长/);
    expect(SOAK).toMatch(/单段最长连续运行/);
  });

  it('必须记录「已完成段数（= 实例重建次数）」', () => {
    // 段数 > 1 ⇒ 这些时长来自不同实例，不能说成「单实例连续 24 小时」
    expect(SOAK).toMatch(/已完成段数/);
  });

  it('23 小时 59 分不得被四舍五入成「24 小时」', () => {
    /*
     * 这一点靠代码结构保证：`ACTUAL_SECONDS` 是**真实秒数**，
     * 汇总写的是「N 秒（X 小时）」，小时数只作辅助展示。
     * 反向断言：不得出现「按小时取整后判定达标」的写法。
     */
    expect(SOAK).toMatch(/实际秒数|ACTUAL_SECONDS/);
    expect(
      /if\s*\[\s*"\$ACTUAL_H"\s*-ge\s*24\s*\]/.test(SOAK),
      '用小时数判达标 —— 23h59m 会被四舍五入/截断成 23 或 24，判定不可靠',
    ).toBe(false);
  });
});
