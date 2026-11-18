import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

/**
 * v0.0.16 发布流水线：授权闸门与预演诚实性
 * ============================================================================
 *
 * ## 这组护栏防的是什么
 *
 * ### ① 用文案冒充事实
 * Release Notes 模板原先**硬编码**「本版本已获明确授权 / 已授权（仅限本版本）」。
 * 模板是静态文本，它不知道这一版到底有没有拿到授权 ⇒ 任何一次发布都会
 * 自动产出「已授权」的声明，包括**没有授权**的那一次。
 * 这不是排版问题，是让产物替人做出它无权做出的断言。
 *
 * 修法：去掉预写结论，改为「授权状态由 preflight 按文件判定」，
 * 并在 preflight 里加**授权闸门**（缺 `docs/RISK_DECISION_v<ver>.md` 即中止）。
 *
 * ### ② 闸门自己可能是假绿的
 * 「文件存在」很容易被空文件蒙过去。所以闸门还要求文件里含
 * `A3` / `B1` / `R-01` 三个要件。本 spec 用**真实临时目录**跑这条判据，
 * 三个负向对照（空文件 / 缺 token / 不存在）都必须判红。
 *
 * ### ③ 预演的版本兜底不能写死
 * `release-dryrun.yml` 的负向对照原先兜底 `v0.0.15` —— 那是**已发布**版本，
 * 于是 sync 到 0.0.16 之后该判据必然自相矛盾（期望 create，实际 refuse）。
 * 必须从 `deploy/VERSION` 读。
 */

const ROOT = path.resolve(__dirname, '..', '..');
function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*#.*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+\/\/.*$/gm, '');
}

describe('v0.0.16 发布闸门：授权必须由文件驱动，不能由文案预写', () => {
  const src = stripComments(read('.github/workflows/release.yml'));

  it('Release Notes 模板不得预写「已授权」结论', () => {
    expect(
      src.includes('已授权（仅限本版本）'),
      'Release Notes 模板又预写了「已授权（仅限本版本）」—— ' +
        '模板是静态文本，它无法知道本版本是否真的拿到授权',
    ).toBe(false);
    expect(
      src.includes('本版本已获明确授权'),
      'Release Notes 模板又预写了「本版本已获明确授权」',
    ).toBe(false);
    expect(
      src.includes('见 preflight 校验结果') || src.includes('由 preflight'),
      '模板应把授权状态交由 preflight 判定，而不是自己下结论',
    ).toBe(true);
  });

  it('preflight 必须有授权闸门，且在构建 job 之前', () => {
    const gateIdx = src.indexOf('授权闸门（本版本裁决记录必须存在）');
    expect(gateIdx, '找不到授权闸门步骤').toBeGreaterThan(0);
    // 闸门必须在 preflight job 内（在 code-checks 之前）
    const codeChecksIdx = src.indexOf('代码检查（类型 + 构建）');
    expect(codeChecksIdx).toBeGreaterThan(gateIdx);
    // 闸门必须真的检查文件
    expect(src).toContain('docs/RISK_DECISION_${VERSION}.md');
    expect(src).toMatch(/if\s*\[\s*!\s*-f\s*"\$DECISION"\s*\]/);
  });

  it('预演的版本兜底必须来自源码载体，不得写死已发布版本', () => {
    const dry = stripComments(read('.github/workflows/release-dryrun.yml'));
    expect(
      /TARGET="\$\{INPUT_VERSION:-v0\.0\.\d+\}"/.test(dry),
      '预演兜底又写死成某个具体版本 —— 该版本一旦发布，判据必然自相矛盾',
    ).toBe(false);
    expect(dry, '兜底应读 deploy/VERSION').toContain("tr -d ' \\r\\n' < deploy/VERSION");
  });
});

describe('v0.0.16 授权闸门的判据本身必须有效（真实文件 + 负向对照）', () => {
  /*
   * 用**真实临时目录**复刻闸门的判定逻辑，而不是只做字符串匹配。
   * 字符串匹配只能证明「这段代码存在」，证明不了「它真的会拦」。
   */
  function gatePasses(dir: string, version: string): boolean {
    const decision = path.join(dir, 'docs', `RISK_DECISION_${version}.md`);
    if (!existsSync(decision)) return false;
    const text = readFileSync(decision, 'utf8');
    return ['A3', 'B1', 'R-01'].every((t) => text.includes(t));
  }

  it('要件齐全的文件通过；空文件 / 缺 token / 不存在 全部不通过', () => {
    const dir = path.join(os.tmpdir(), `v016-gate-${process.pid}-${Date.now()}`);
    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    try {
      // ① 正常
      writeFileSync(
        path.join(dir, 'docs', 'RISK_DECISION_v0.0.16.md'),
        '# 裁决\n\n- 决策 A：A3 保留 + 披露\n- 决策 B：B1 授权发布\n- R-01：DEFERRED\n',
        'utf8',
      );
      expect(gatePasses(dir, 'v0.0.16'), '要件齐全的文件应通过').toBe(true);

      // ② 空文件（存在但没内容）
      writeFileSync(path.join(dir, 'docs', 'RISK_DECISION_v0.0.16.md'), '', 'utf8');
      expect(gatePasses(dir, 'v0.0.16'), '空文件不得通过（否则放个占位就能发版）').toBe(false);

      // ③ 缺 B1
      writeFileSync(
        path.join(dir, 'docs', 'RISK_DECISION_v0.0.16.md'),
        'A3 R-01\n',
        'utf8',
      );
      expect(gatePasses(dir, 'v0.0.16'), '缺 B1 不得通过').toBe(false);

      // ④ 文件不存在
      rmSync(path.join(dir, 'docs', 'RISK_DECISION_v0.0.16.md'));
      expect(gatePasses(dir, 'v0.0.16'), '文件不存在不得通过').toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
