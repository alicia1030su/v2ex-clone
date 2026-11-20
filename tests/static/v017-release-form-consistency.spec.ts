import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * v0.0.17 发布形态：**所有**判据必须按「声明」判真伪，不得写死某一种形态
 * ============================================================================
 *
 * ## 为什么需要这组护栏（真实事故）
 *
 * 正式发布 run `44659056915` 的「远端核验」job 判红：
 *
 * ```
 * ##[error]Release 未标记 prerelease
 * ```
 *
 * 而实际情况是：Release **正确地**建成了 Stable Release
 * （`prerelease=false`、`draft=false`、`latest=v0.0.17`）。
 * 判据把「必须是 prerelease」写死了 —— 稳定版发布时必然自相矛盾。
 *
 * 这与本仓 v0.0.15 记录的「判据不能假设状态应该是某一种」**完全同类**。
 * 本轮为了保证发稳定版，把**产出侧**（白名单、Release 名称、Notes、
 * `--latest`）都改成了跟随形态，却漏了**核验侧** ——
 * 产出与核验口径不一，等于自己判自己错。
 *
 * ## 本 spec 锁的四件事
 *
 * ① 核验必须拿到 PRERELEASE（否则只能假设）；
 * ② 形态比对必须用「声明 vs 实际」，不得出现 `if not is_prerelease: error`；
 * ③ `latest` 判据必须双向（预发布不得占用、稳定版应当占用）；
 * ④ 所有提到形态的地方都读同一个真相来源，不得各写一份。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const WF_RAW = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');

/** 剥注释：反向断言只对可执行代码生效 */
function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('#') || t.startsWith('//'));
    })
    .join('\n');
}
const WF = stripComments(WF_RAW);

/** 取「远端核验」job 的正文 */
function verifyJob(): string {
  const start = WF.indexOf('verify-release:');
  expect(start, '找不到 verify-release job').toBeGreaterThan(0);
  return WF.slice(start);
}

describe('v0.0.17 远端核验：形态判据必须按声明判真伪', () => {
  it('核验脚本必须拿到 PRERELEASE（否则只能靠猜）', () => {
    const job = verifyJob();
    expect(job).toMatch(/PRERELEASE="\$\{\{\s*needs\.preflight\.outputs\.prerelease\s*\}\}"/);
    // 必须真的传给 python，而不是拿到了不用
    expect(job).toMatch(/python3 - "\$VERSION" "\$PUBLISH" "\$PRERELEASE"/);
  });

  it('不得写死「必须是 prerelease」', () => {
    /*
     * 关键反向断言：原实现是
     *     if not is_prerelease:
     *         print('::error::Release 未标记 prerelease'); sys.exit(1)
     * 这行在稳定版发布时**必然**杀掉正确的 Release。
     */
    const job = verifyJob();
    expect(
      /if\s+not\s+is_prerelease\s*:/.test(job),
      '又回到了「必须是 prerelease」—— 稳定版发布会再次判红',
    ).toBe(false);
    // 反之亦然：不得要求「必须不是 prerelease」
    expect(
      /if\s+is_prerelease\s*:[\s\S]{0,80}::error::/.test(job),
      '写死了「必须是稳定版」—— 预发布发布会判红',
    ).toBe(false);
  });

  it('必须做「声明 vs 实际」的等值比对', () => {
    const job = verifyJob();
    expect(job).toMatch(/EXPECT_PRERELEASE\s*=\s*\(PRERELEASE\s*==\s*'true'\)/);
    expect(job, '没有把实际形态与声明比对').toMatch(
      /if\s+is_prerelease\s*!=\s*EXPECT_PRERELEASE\s*:/,
    );
  });

  it('latest 判据必须双向：预发布不得占用，稳定版应当占用', () => {
    const job = verifyJob();
    expect(job).toMatch(/EXPECT_PRERELEASE\s+and\s+LATEST\s*==\s*VERSION/);
    expect(job).toMatch(/\(not\s+EXPECT_PRERELEASE\)\s+and\s+LATEST\s*!=\s*VERSION/);
  });

  it('latest 必须从 /releases/latest 读 —— 列表接口**没有** latest 字段', () => {
    /*
     * 真实缺陷（v0.0.17 核对 Release 时发现）：
     * Release **列表**接口返回的字段是
     *   assets / draft / prerelease / tag_name / …
     * **没有 `latest`**。所以原判据 `d.get('latest') is True` **恒为 False**
     * ⇒ 「Pre-release 不得占用 latest」那条检查**从未生效过**，
     * 是一个「写了断言但永远不会失败」的假绿。
     *
     * 修法：单独查 `/releases/latest`，它返回 GitHub 认定的 Latest Release。
     */
    const job = verifyJob();
    expect(job, '没有查 /releases/latest').toContain('/releases/latest');
    expect(
      /d\.get\('latest'\)/.test(job),
      '又读回了列表对象里的 latest 字段 —— 该字段不存在，判据会恒假',
    ).toBe(false);
  });

  it('读不到 latest 时必须判红（不得静默放过）', () => {
    const job = verifyJob();
    expect(job).toMatch(/if not LATEST:/);
    expect(job).toMatch(/无法读取 GitHub Latest Release/);
  });

  it('报错文案必须能区分两个方向（否则误导排查）', () => {
    const job = verifyJob();
    expect(job).toMatch(/Pre-release 被标记为 latest/);
    expect(job).toMatch(/稳定版未成为 latest/);
  });
});

describe('v0.0.17 发布形态：产出侧与核验侧必须同源', () => {
  it('所有形态判定都读 needs.preflight.outputs.prerelease', () => {
    // 允许出现的形态来源只有这一个
    const sources = [...WF.matchAll(/needs\.preflight\.outputs\.prerelease/g)].length;
    expect(sources, '形态来源太少 —— 可能有人在某处另写了一份判定').toBeGreaterThanOrEqual(3);
  });

  it('不得在核验里重算白名单（口径会漂移）', () => {
    // 核验侧只该消费 preflight 的结论；自己再读一遍白名单就多了一个真相来源
    const job = verifyJob();
    expect(
      job.includes('STABLE_RELEASES.json'),
      '核验侧自己重读了白名单 —— 与 preflight 形成两个真相来源',
    ).toBe(false);
  });
});

describe('v0.0.17 发布形态：本地预演与远端核验口径一致', () => {
  it('预演脚本也按白名单判形态（不是写死预览版）', () => {
    const dry = readFileSync(path.join(ROOT, 'scripts/release/preflight-dryrun.mjs'), 'utf8');
    expect(dry).toContain('resolve-release-channel.mjs');
    expect(dry).toMatch(/channelResult/);
    // 主标题期望值必须随形态，不写死
    expect(dry).toMatch(/expectTitle\s*=\s*`## \$\{VERSION\}\$\{formSuffix\}`/);
  });
});

describe('v0.0.17 发布后独立验收：形态判据同样不得写死', () => {
  const POST = stripComments(
    readFileSync(path.join(ROOT, '.github/workflows/post-release-verify.yml'), 'utf8'),
  );

  it('不得要求「必须 Pre-release」', () => {
    /*
     * 真实失败（run 44667366422）：
     *   发布后独立验收报「tag / 已发布 / Pre-release 三项不一致」
     * 而 Release 实际完全正确（Stable、非 draft、资产齐全）。
     * 这是**第四个**写死形态的判据 —— 同一个错误在四个地方复发。
     */
    expect(
      /tag==sys\.argv\[2\]\s+and\s+draft\s+is\s+False\s+and\s+pre\s+is\s+True/.test(POST),
      '又写死了「必须 Pre-release」—— 稳定版发布后验收会判红',
    ).toBe(false);
  });

  it('形态期望必须来自统一解析器（不写死、不复制清单逻辑）', () => {
    expect(POST).toContain('resolve-release-channel.mjs');
    expect(POST).not.toContain('STABLE_RELEASES.json');
    expect(POST).toMatch(/EXPECT_PRE/);
    // 必须真的拿期望去比，而不是拿到不用
    expect(POST).toMatch(/pre\s+is\s+exp/);
  });
});
