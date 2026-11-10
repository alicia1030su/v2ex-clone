import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 长期稳定性验证的**口径护栏**（v0.0.15 P0-2）
 *
 * ## 这条护栏防的是什么
 *
 * v0.0.9 起，24 小时稳定性验证被拆成「5 段 × 5 小时」的串行链
 * （GitHub-hosted runner 单 job 上限 6 小时，单 job 跑 24 小时不可能）。
 *
 * 这个设计本身是对的，但它的**注释与汇总文案**写错了一句话：
 *
 *     「⇒『24 小时』指应用**实际持续运行** 24 小时」
 *
 * 暗示是**同一个实例**连续跑了 24 小时。**那不是事实**：
 * 每一段都会
 *   ① `docker run` 一个全新的 PostgreSQL 容器（全新数据目录）；
 *   ② `npm run build` 重新构建；
 *   ③ `next start` 起一个全新的应用进程；
 *   ④ 段末 `docker rm -f soak-postgres` 销毁数据库。
 *
 * ⇒ 段与段之间**不共享实例、不共享数据库**。
 * 24 小时「累计」的真实含义是「**5 个互不相同的实例各跑约 5 小时**」。
 *
 * 两者**证明力不同**：累计值证明不了「单实例长期运行不劣化」
 * （内存泄漏、连接泄漏、句柄泄漏都只在**单体长跑**里才暴露）。
 *
 * 所以「累计 24 小时 = 24 小时稳定性通过」是**用分段累积冒充连续运行** ——
 * 正是任务书 §三 明令禁止的那一类。
 *
 * ## 判据
 *
 * 1. 长跑脚本必须**同时记录**「累计」与「单段最长」两个数字
 *    （`CUMULATIVE_SECONDS` / `MAX_SEGMENT_SECONDS`）；
 * 2. 汇总环节必须**同时报告**两者，且累计达标不得被表述为单实例连续；
 * 3. 缺少这些字段时**必须判红**（防止用旧 artifact 冒充新口径）；
 * 4. 文档里不得再出现「应用实际持续运行 24 小时」这类**未经限定的**表述。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const SOAK_SCRIPT = read('scripts/release/verify-soak.sh');
const SOAK_WF = read('.github/workflows/soak-test.yml');
const SEGMENT_WF = read('.github/workflows/soak-segment.yml');

describe('长期稳定性：累计口径与单实例口径不可混淆', () => {
  it('长跑脚本必须记录单段最长连续运行（不能只有累计值）', () => {
    for (const marker of [
      'MAX_SEGMENT_SECONDS',
      'SEGMENTS_TOTAL',
      'LONGEST_MEM_MB',
      'MAX_CONN_USED',
    ]) {
      expect(SOAK_SCRIPT, `verify-soak.sh 缺指标 ${marker}`).toContain(marker);
    }
    // 状态文件必须真的写出它（否则下一段拿不到）
    expect(SOAK_SCRIPT).toMatch(/MAX_SEGMENT_SECONDS=\$\{MAX_SEGMENT_SECONDS_NEW\}/);
    expect(SOAK_SCRIPT).toMatch(/SEGMENTS_TOTAL=\$\{SEGMENTS_TOTAL\}/);
  });

  it('长跑脚本的注释必须如实说明「段间不共享实例/数据库」', () => {
    expect(
      SOAK_SCRIPT,
      'verify-soak.sh 必须显式声明每段是全新容器 + 全新进程（否则读者会以为是同一个实例）',
    ).toContain('不共享实例');
    expect(SOAK_SCRIPT).toContain('不共享数据库');
    // 并明确"累计 ≠ 单实例连续"
    expect(SOAK_SCRIPT).toMatch(/累计\s*≠\s*单实例连续|不等于|不是一回事/);
  });

  it('长跑脚本不得残留「应用实际持续运行 24 小时」这类未限定表述', () => {
    // 这是被修正的**原话**：它把"累计"讲成"同一个实例持续运行"
    expect(
      SOAK_SCRIPT,
      'verify-soak.sh 不得再写「24 小时指应用实际持续运行」（那是错的，会误导读者）',
    ).not.toMatch(/「24 小时」指应用实际持续运行 24 小时/);
  });

  it('soak-test.yml 的汇总 job 必须同时打印两个口径', () => {
    expect(
      SOAK_WF,
      'soak-test.yml 汇总必须显式给出「累计」与「单段最长」',
    ).toContain('MAX_SEGMENT_SECONDS');
    expect(SOAK_WF).toContain('单段最长');
    expect(SOAK_WF, '必须声明"累计 24h ≠ 单实例连续 24h"').toMatch(
      /累计 24 小时\s*≠\s*单实例连续 24 小时|不共享实例/,
    );
  });

  it('soak-test.yml 汇总对缺字段的 state 必须判红（不让旧 artifact 冒充新口径）', () => {
    const summaryBlock = (() => {
      const idx = SOAK_WF.indexOf('  汇总');
      return idx < 0 ? SOAK_WF : SOAK_WF.slice(idx);
    })();
    expect(
      summaryBlock,
      '汇总 job 必须对缺失 MAX_SEGMENT_SECONDS / SEGMENTS_TOTAL 的 state.env 判红',
    ).toContain('MAX_SEGMENT_SECONDS');
    expect(summaryBlock).toMatch(/exit 1/);
  });

  it('soak-segment.yml 必须真的是「全新容器 + 全新进程」（口径成立的事实基础）', () => {
    // 若哪天改成持久卷 + 复用容器，那「段间不共享实例」就不再成立，
    // 本文件的口径说明与判据都要重写 —— 这条断言就是那个报警器。
    expect(SEGMENT_WF, '每段必须新建 postgres 容器').toContain('docker run -d --name soak-postgres');
    expect(SEGMENT_WF, '段末必须销毁容器（否则下一段会复用）').toContain(
      'docker rm -f soak-postgres',
    );
    expect(SEGMENT_WF, '每段必须起新应用进程').toContain('npx next start');
    // 不应挂持久卷（挂了就意味着数据跨段保留，口径必须改）
    expect(
      SEGMENT_WF,
      '若给 postgres 挂了持久卷，段间就不再是"全新数据库"——口径说明需要重写',
    ).not.toMatch(/docker run[\s\S]{0,400}-v\s+[a-zA-Z0-9_/.-]+:/);
  });
});
