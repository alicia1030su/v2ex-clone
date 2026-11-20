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
const NOTES_TPL = readFileSync(path.join(ROOT, '.github/release-notes-template.md'), 'utf8');
const RENDERER = readFileSync(path.join(ROOT, 'scripts/release/render-release-notes.mjs'), 'utf8');

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

  it('当前载体版本按候选/发布态登记，且不得预登记未来稳定版', () => {
    const d = JSON.parse(readFileSync(path.join(ROOT, WHITELIST_PATH), 'utf8')) as {
      stable: string[];
    };
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    const channels = JSON.parse(readFileSync(path.join(ROOT, 'docs/RELEASE_CHANNELS.json'), 'utf8')) as {
      default?: string;
      versions?: Record<string, string>;
    };
    const current = `v${pkg.version}`;
    const currentChannel = channels.versions?.[current] ?? channels.default;
    const registered = d.stable.includes(current);
    if (currentChannel === 'stable') {
      expect(registered, '稳定版载体必须同步登记到迁移白名单').toBe(true);
    } else {
      expect(registered, '候选态不得提前登记为稳定版').toBe(false);
    }
    // 注入式负向对照：取当前载体的下一个 patch 作为“未来候选”，
    // 它必须未被提前登记；同一判据若看到候选被登记必须抛错。
    const curParts = current.slice(1).split('.').map(Number);
    const future = `v${curParts[0]}.${curParts[1]}.${curParts[2] + 1}`;
    const futureChannel = channels.versions?.[future] ?? channels.default;
    expect(d.stable, `未来候选 ${future} 不得提前登记`).not.toContain(future);
    expect(() => {
      const injected = [...d.stable, future];
      if (futureChannel !== 'stable' && injected.includes(future)) {
        throw new Error('candidate_pre_registered');
      }
    }).toThrow('candidate_pre_registered');
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

describe('v0.0.17 发布形态：闸门必须真实存在（v0.0.18 起统一解析器）', () => {
  it('tag push 与 dispatch 都必须由统一解析器给出形态', () => {
    const metaBlock = WF.slice(WF.indexOf('记录三态标志'), WF.indexOf('读取远端 Release 状态'));
    expect(metaBlock, '找不到三态标志步骤').not.toBe('');
    expect(metaBlock).toContain('resolve-release-channel.mjs');
    expect(metaBlock).toContain('--format github-output');
    // 不再提供可覆盖清单的 prerelease 输入
    const inputs = WF.slice(WF.indexOf('workflow_dispatch:'), WF.indexOf('concurrency:'));
    expect(inputs, '仍存在独立的 prerelease 输入 —— 会形成第二真相来源').not.toMatch(/^      prerelease:/m);
  });

  it('publish-release 必须防御性复算并与 preflight 比对', () => {
    expect(WF).toContain('release-channel-recheck.out');
    expect(WF).toMatch(/RECHECK_PRERELEASE/);
    expect(WF).toMatch(/发布形态不一致：preflight=\$PRERELEASE/);
    // 未登记版本由解析器默认 prerelease；若 output 被篡改成 stable，这里必须失败
    const guard = WF.slice(WF.indexOf('release-channel-recheck.out') - 400, WF.indexOf('release-channel-recheck.out') + 900);
    expect(guard).toMatch(/exit 1/);
  });

  it('清单缺失或无效时解析器必须失败，不得回退成稳定版', () => {
    const resolver = readFileSync(path.join(ROOT, 'scripts/release/resolve-release-channel.mjs'), 'utf8');
    expect(resolver).toMatch(/无法读取/);
    expect(resolver).toMatch(/process\.exit\(1\)/);
    // 解析器不捕获清单错误后继续输出 channel
    expect(resolver).not.toMatch(/catch[\s\S]{0,100}manifest\.default/);
  });
});

describe('v0.0.17 发布形态：Release 形态措辞不得自相矛盾', () => {
  it('Release 名称与 Notes 标题必须随 PRERELEASE 切换', () => {
    // 名称
    expect(WF).toMatch(/RELEASE_TITLE=/);
    expect(WF).toMatch(/RELEASE_TITLE="\$VERSION — 开发预览版"/);
    expect(WF).toMatch(/RELEASE_TITLE="\$VERSION 稳定版"/);
    // Notes 标题用占位符注入，不写死
    expect(NOTES_TPL).toContain('__FORM_SUFFIX__');
    expect(NOTES_TPL).toContain('__FORM_NOTICE__');
  });

  it('Notes 模板不得再硬编码「不是稳定版」', () => {
    expect(
      NOTES_TPL.includes('**这是早期开发预览版（Pre-release），不是稳定版。**'),
      'Notes 模板又写死了「不是稳定版」—— 稳定版发布时会自相矛盾',
    ).toBe(false);
  });

  it('稳定版 Notes 里出现「不是稳定版」必须判红（反向闸门）', () => {
    expect(RENDERER).toMatch(/稳定版 Notes 里出现「不是稳定版」/);
  });

  it('主标题闸门必须按形态比对，而不是写死「开发预览版」', () => {
    expect(RENDERER).toContain('const expectedTitle = isPrerelease');
    expect(RENDERER).toContain('`## ${VERSION} — 开发预览版（Pre-release）`');
    expect(RENDERER).toContain('`## ${VERSION} — 稳定版`');
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

  it('已登记版本 v0.0.17 / v0.0.18 均为稳定版，未登记版本不是', () => {
    expect(isStable('v0.0.17')).toBe(true);
    expect(isStable('v0.0.18')).toBe(true);
    expect(isStable('v0.0.16'), 'v0.0.16 未登记却被判为稳定版').toBe(false);
    expect(isStable('v0.0.19'), 'v0.0.19 未登记却被判为稳定版').toBe(false);
  });

  it('大小写/空格/前缀都不该被宽松匹配', () => {
    for (const bad of ['V0.0.17', ' v0.0.17', 'v0.0.17 ', '0.0.17', 'v0.0', 'v0.0.']) {
      expect(isStable(bad), `"${bad}" 被判为稳定版 —— 匹配过宽`).toBe(false);
    }
  });
});
