import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 发布授权一致性护栏（v0.0.15）
 *
 * ## 这条护栏防的是什么（真实缺口）
 *
 * v0.0.15 的裁决是**两项独立决定**：
 *   决策 A = **A3 保留历史 + 强化披露**（不改写、不移动 Tag）
 *   决策 B = **B1 授权公开发布**（Tag / 镜像 / Pre-release）
 *
 * 这两项在文档里有**三处会互相矛盾**的落点：
 *   ① README 说「已获本版公开发布授权」，但 `docs/RISK_DECISION_v<版本>.md` 不存在
 *      ⇒ 读者无法复核授权来源，等于自证；
 *   ② 同一份 README 里一处写「已获授权」、另一处仍写「无本版发布授权」
 *      ⇒ 与 v0.0.14 发布后「Notes 写待裁决」是同一类「自相矛盾」；
 *   ③ 裁决记录把 R-01 写成 FIXED / RESOLVED / 已修复
 *      ⇒ A3 的语义被偷换成「风险消失」，而这正是本仓反复强调禁止的。
 *
 * ## 判据
 *
 * 1. 若 README 声明「已获本版公开发布授权」，则 `docs/RISK_DECISION_v{version}.md` 必须存在；
 * 2. 该文件必须写明决策 A 为 A3（保留 + 披露）、决策 B 为 B1（授权发布）；
 * 3. 该文件必须写「DEFERRED」，且**不得**把 R-01 说成已修复 / 已消除 / 已解决；
 * 4. README 不得同时出现「已获本版公开发布授权」与「无本版发布授权」。
 *
 * ⚠️ 本护栏只保证**声明之间自洽**，不能替代「授权是否真实作出」——
 * 那只能由主人的裁决记录本身证明。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const exists = (p: string) => existsSync(path.join(ROOT, p));

const README = read('README.md');
const pkg = JSON.parse(read('package.json')) as { version: string };
const VERSION = pkg.version;
const DECISION_PATH = `docs/RISK_DECISION_v${VERSION}.md`;

/** README 是否声明「本版已获公开发布授权」 */
const claimsAuthorized = /已获本版公开发布授权/.test(README);

describe('发布授权一致性（v0.0.15）', () => {
  it('声明已获授权时，裁决记录文件必须存在（否则授权无法复核）', () => {
    if (!claimsAuthorized) return;
    expect(
      exists(DECISION_PATH),
      `README 声明「已获本版公开发布授权」，但 ${DECISION_PATH} 不存在。\n` +
        '授权必须有一份可复核的裁决记录；只有声明、没有记录，等于自证。',
    ).toBe(true);
  });

  it('裁决记录必须写明 A3（保留 + 披露）与 B1（授权发布）', () => {
    if (!exists(DECISION_PATH)) return;
    const text = read(DECISION_PATH);
    expect(text, '裁决记录未写明决策 A = A3').toMatch(/A3/);
    expect(text, '裁决记录未写明 A3 的语义是「保留 + 披露」').toMatch(
      /保留[\s\S]{0,30}披露|保留\s*\+\s*披露/,
    );
    expect(text, '裁决记录未写明决策 B = B1').toMatch(/B1/);
    expect(text, '裁决记录未写明 B1 的语义是「授权发布」').toMatch(/授权[\s\S]{0,12}发布/);
  });

  it('裁决记录必须写明 R-01 仍为 DEFERRED，且不得声称为已修复', () => {
    if (!exists(DECISION_PATH)) return;
    const text = read(DECISION_PATH);
    expect(text, '裁决记录未写明 R-01 维持 DEFERRED').toContain('DEFERRED');

    /**
     * A3 的核心纪律：保留 + 披露 ≠ 风险消失。禁止把状态偷换成已修复。
     *
     * ⚠️ 这里**必须先剥掉否定语境**，否则护栏会咬自己的正确表述。
     *   本文件的「A3 明确**不**意味着」小节里就有一行：
     *
     *       1. **不是**把 R-01 标为 FIXED / MITIGATED / RESOLVED。
     *
     *   这句是**正确的**（它正是在禁止这件事），而朴素的
     *   `/R-01[\s\S]{0,40}(已修复|FIXED)/` 会把它判红 ——
     *   与 V13-17（`not.toContain` 被注释误伤）、V14-03（扫全文被自己的
     *   黑名单误伤）是**同一类错**：反向断言没有先排除「不该算数的部分」。
     *
     *   判据改为：**逐行**判定，且该行含否定标记（不是 / 不得 / 未 / 非 /
     *   不等于 / 严禁 / 禁止）时跳过 —— 只抓「肯定式声称已修复」。
     */
    const NEGATION = /不是|不得|不能|未|非|不等于|严禁|禁止|绝不/;
    const AFFIRMATIVE = /R-01[^\n]{0,60}(已修复|已消除|已解决|已关闭|FIXED|RESOLVED|MITIGATED)/;
    const offenders = text
      .split('\n')
      .filter((line) => !NEGATION.test(line))
      .filter((line) => AFFIRMATIVE.test(line));
    expect(
      offenders,
      `裁决记录以肯定式把 R-01 说成已修复 / 已消除 / 已解决 —— A3 不允许这样表述：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('README 不得同时声称「已获授权」与「无本版发布授权」', () => {
    const contradicts = /无本版发布授权/.test(README);
    expect(
      claimsAuthorized && contradicts,
      'README 同时出现「已获本版公开发布授权」与「无本版发布授权」—— 同一事实两种相反陈述',
    ).toBe(false);
  });
});
