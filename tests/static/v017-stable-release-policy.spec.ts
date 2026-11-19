import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * v0.0.17 发布形态：从「0.0.x 一律 Pre-release」改为**按版本白名单**
 * ============================================================================
 *
 * ## 为什么必须改成白名单，而不是直接删掉那条闸门
 *
 * 原实现（v0.0.9 ~ v0.0.16）在 `release.yml` 里**硬编码**：
 *
 * ```bash
 * # tag push 路径
 * echo "prerelease=true" >> "$GITHUB_OUTPUT"
 *
 * # publish-release 阶段
 * if [ "$PRERELEASE" != "true" ]; then
 *   echo "::error::本项目 0.0.x 全部是早期开发预览版，不得发布为稳定版。"
 *   exit 1
 * fi
 * ```
 *
 * 这条政策的**初衷是对的**（防止用户误以为 0.0.x 可长期依赖），
 * 但它是硬编码的 ⇒ 即使项目所有者明确决定某版本已生产就绪，也只能改代码；
 * 而「改代码」这件事本身**没有审计痕迹**，也容易被下一次改动悄悄恢复。
 *
 * ⇒ 改成读 `docs/STABLE_RELEASES.json` 的**逐版本白名单**：
 *   在白名单里才允许 `prerelease=false`；不在则回到 Pre-release。
 *   新增一个稳定版必须走 PR 改这个文件，**diff 本身就是审计记录**。
 *
 * ## 这组护栏锁的五件事
 *
 * ① 白名单必须是**精确枚举**，不能变成前缀通配（否则「0.0.x 都稳定」）；
 * ② 闸门必须**真的存在**——不能为了发稳定版把它整段删掉；
 * ③ 白名单读不到时**不得回退**成稳定版（宁可发布失败）；
 * ④ Release 标题/Notes 的形态措辞必须跟随 PRERELEASE（不能自相矛盾）；
 * ⑤ `--latest` 必须只给稳定版（Pre-release 不应成为 Latest）。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const WF_RAW = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');

/** 剥掉 YAML/bash 注释 —— 反向断言必须只对**可执行代码**生效 */
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

const WHITELIST_PATH = 'docs/STABLE_RELEASES.json';

describe('v0.0.17 发布形态：稳定版白名单', () => {
  it('白名单文件存在且为合法 JSON，stable 是数组', () => {
    expect(existsSync(path.join(ROOT, WHITELIST_PATH)), `缺少 ${WHITELIST_PATH}`).toBe(true);
    const d = JSON.parse(readFileSync(path.join(ROOT, WHITELIST_PATH), 'utf8')) as {
      stable?: unknown;
    };
    expect(Array.isArray(d.stable), 'stable 必须是数组').toBe(true);
  });

  it('必须是**精确版本号**枚举，不得出现通配/前缀写法', () => {
    const d = JSON.parse(readFileSync(path.join(ROOT, WHITELIST_PATH), 'utf8')) as {
      stable: string[];
    };
    for (const v of d.stable) {
      expect(v, `白名单项 "${v}" 不是精确的 vX.Y.Z —— 前缀通配会让「0.0.x 都稳定」`).toMatch(
        /^v\d+\.\d+\.\d+$/,
      );
    }
  });

  it('本版 v0.0.17 必须已登记（否则稳定版发不出去）', () => {
    const d = JSON.parse(readFileSync(path.join(ROOT, WHITELIST_PATH), 'utf8')) as {
      stable: string[];
    };
    expect(d.stable, 'v0.0.17 未登记为稳定版').toContain('v0.0.17');
  });

  it('不得把未发布过的版本预先登记（防止「占位式白名单」）', () => {
    const d = JSON.parse(readFileSync(path.join(ROOT, WHITELIST_PATH), 'utf8')) as {
      stable: string[];
    };
    // 只允许登记当前载体版本与历史已发布版本；具体规则见下
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    const current = `v${pkg.version}`;
    expect(d.stable, '当前载体版本必须已登记').toContain(current);
    // 反向断言：不得出现明显是「未来版本」的项（大于当前 carrier）
    for (const v of d.stable) {
      const parts = v.slice(1).split('.').map(Number);
      const cur = current.slice(1).split('.').map(Number);
      const cmp = (a: number[], b: number[]) => {
        for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
        return 0;
      };
      expect(cmp(parts, cur), `白名单含未来版本 ${v}`).toBeLessThanOrEqual(0);
    }
  });
});

describe('v0.0.17 发布形态：闸门必须真实存在（不是把闸门删掉）', () => {
  it('tag push 路径不得再无脑写 prerelease=true', () => {
    /*
     * 关键反向断言：原实现是
     *     echo "prerelease=true" >> "$GITHUB_OUTPUT"
     * 无条件执行。改成白名单后，这一行必须被条件分支包住。
     */
    const metaBlock = WF.slice(WF.indexOf('记录三态标志'), WF.indexOf('读取远端 Release 状态'));
    expect(metaBlock, '找不到三态标志步骤').not.toBe('');

    // 必须读白名单
    expect(metaBlock).toContain('docs/STABLE_RELEASES.json');
    expect(metaBlock).toMatch(/IS_STABLE/);
    // 必须**同时**保留两条分支（true 与 false）
    expect(metaBlock).toMatch(/prerelease=false/);
    expect(metaBlock).toMatch(/prerelease=true/);

    // 反向：不得出现「无条件」的 prerelease=true（即没有 if 包着）
    const lines = metaBlock.split('\n').map((l) => l.trim());
    const idx = lines.findIndex((l) => l === 'echo "prerelease=true" >> "$GITHUB_OUTPUT"');
    expect(idx, '找不到 prerelease=true 的赋值行（结构已变，本用例需重写）').toBeGreaterThan(0);
    // 上一行的有效语句必须是 else（而不是 fi 或空行）
    const prevNonEmpty = lines.slice(0, idx).filter((l) => l && !l.startsWith('#')).pop();
    expect(
      prevNonEmpty,
      `prerelease=true 没有被 else 分支包住（上一行是 ${JSON.stringify(prevNonEmpty)}）—— 又变成无条件了`,
    ).toBe('else');
  });

  it('publish-release 阶段必须**仍有**稳定版守卫（不能整段删除）', () => {
    /*
     * 改成白名单 ≠ 取消守卫。若有人为了发稳定版把 `if [ "$PRERELEASE" != "true" ]`
     * 整段删掉，那么任何版本（包括未登记的 0.0.18）都能发稳定版。
     */
    expect(WF, '稳定版守卫被删除了 —— 未登记版本将可以直接发稳定版').toMatch(
      /if\s*\[\s*"\$PRERELEASE"\s*!=\s*"true"\s*\]\s*;?\s*then/,
    );
    // 守卫里必须**再次**校验白名单（不能只信 preflight 的 output）
    const guard = WF.slice(WF.indexOf('if [ "$PRERELEASE" != "true" ]; then'));
    expect(guard).toMatch(/STABLE_RELEASES\.json/);
    expect(guard, '守卫里没有再判 STABLE_OK').toMatch(/STABLE_OK/);
    // 未登记时必须 exit 1
    expect(guard.slice(0, 1500)).toMatch(/exit 1/);
  });

  it('白名单读不到时**不得**回退成稳定版', () => {
    // 正向要求：文件不存在 ⇒ warning + 按 Pre-release
    // ⚠️ 文案里用的是变量 `$STABLE_WHITELIST`，不是字面路径 ——
    //    第一版写 `/STABLE_RELEASES\.json 不存在/` 恒不匹配（判据假红）。
    expect(WF).toMatch(/\$STABLE_WHITELIST 不存在/);
    expect(WF, '文件缺失时没有回退到 Pre-release 的显式说明').toMatch(/按 Pre-release 处理/);
  });
});

describe('v0.0.17 发布形态：Release 形态措辞不得自相矛盾', () => {
  it('Release 名称与 Notes 标题必须随 PRERELEASE 切换', () => {
    // 名称
    expect(WF).toMatch(/RELEASE_TITLE=/);
    expect(WF).toMatch(/RELEASE_TITLE="\$VERSION — 开发预览版"/);
    expect(WF).toMatch(/RELEASE_TITLE="\$VERSION — 稳定版"/);
    // Notes 标题用占位符注入，不写死
    expect(WF_RAW).toContain('__FORM_SUFFIX__');
    expect(WF_RAW).toContain('__FORM_NOTICE__');
  });

  it('Notes 模板不得再硬编码「不是稳定版」', () => {
    // 反向断言：模板正文里写死的那句必须已被占位符取代
    const tplStart = WF_RAW.indexOf('cat > release-notes.md');
    expect(tplStart).toBeGreaterThan(0);
    const tpl = WF_RAW.slice(tplStart, tplStart + 2500);
    expect(
      tpl.includes('**这是早期开发预览版（Pre-release），不是稳定版。**'),
      'Notes 模板又写死了「不是稳定版」—— 稳定版发布时会自相矛盾',
    ).toBe(false);
  });

  it('稳定版 Notes 里出现「不是稳定版」必须判红（反向闸门）', () => {
    expect(WF).toMatch(/稳定版 Notes 里出现「不是稳定版」/);
  });

  it('主标题闸门必须按形态比对，而不是写死「开发预览版」', () => {
    expect(WF).toMatch(/EXPECT_TITLE=/);
    expect(WF).toMatch(/EXPECT_TITLE="## \${VERSION} — 开发预览版（Pre-release）"/);
    expect(WF).toMatch(/EXPECT_TITLE="## \${VERSION} — 稳定版"/);
  });
});

describe('v0.0.17 发布形态：latest 只给稳定版', () => {
  it('Pre-release 路径必须 --latest=false', () => {
    const block = WF.slice(WF.indexOf('if [ "$PRERELEASE" = "true" ]; then\\n              gh release edit') >= 0
      ? WF.indexOf('if [ "$PRERELEASE" = "true" ]; then\\n              gh release edit')
      : WF.indexOf('gh release edit'));
    // ⚠️ 续行符是**字面反斜杠**，`\s+` 匹配不到它（第一版因此假红）。
    expect(WF).toMatch(/--prerelease=true \\?\s*\n\s*--latest=false/);
  });

  it('稳定版路径必须 --prerelease=false 且 --latest', () => {
    expect(WF).toMatch(/--prerelease=false \\?\s*\n\s*--latest/);
    // 反向：不得给稳定版也加 --latest=false
    expect(
      /--prerelease=false \\?\s*\n\s*--latest=false/.test(WF),
      '稳定版被设成 --latest=false —— 那与「正式稳定版」语义矛盾',
    ).toBe(false);
  });
});

describe('v0.0.17 发布形态：白名单判定的真实行为（执行，不是字符串匹配）', () => {
  /** 复刻 release.yml 里的白名单判定逻辑，用真实文件跑 */
  function isStable(version: string): boolean {
    try {
      execFileSync(
        process.execPath,
        [
          '-e',
          `const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
           const list=Array.isArray(d.stable)?d.stable:[];
           process.exit(list.includes(process.argv[2])?0:1);`,
          WHITELIST_PATH,
          version,
        ],
        { cwd: ROOT, stdio: 'pipe' },
      );
      return true;
    } catch {
      return false;
    }
  }

  it('v0.0.17 ⇒ 稳定版', () => {
    expect(isStable('v0.0.17')).toBe(true);
  });

  it('未登记的版本一律不是稳定版（含 v0.0.16、v0.0.18）', () => {
    expect(isStable('v0.0.16'), 'v0.0.16 未登记却被判为稳定版').toBe(false);
    expect(isStable('v0.0.18'), 'v0.0.18 未登记却被判为稳定版').toBe(false);
  });

  it('大小写/空格/前缀都不该被宽松匹配', () => {
    for (const bad of ['V0.0.17', ' v0.0.17', 'v0.0.17 ', '0.0.17', 'v0.0', 'v0.0.']) {
      expect(isStable(bad), `"${bad}" 被判为稳定版 —— 匹配过宽`).toBe(false);
    }
  });
});
