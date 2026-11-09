import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.13：**发行文档真实性护栏**
 *
 * ## 为什么需要它
 *
 * 2026-11-09 接管 master 时发现，多份对外文档处在「看起来写得很认真，
 * 但版本状态是错的」的状态，而且**没有任何测试会因为它们写错而变红**：
 *
 *   · `CHANGELOG.md` 的 `[Unreleased]` 仍以 **v0.0.9** 为标题
 *     （v0.0.9 早在 2026-11-05 就已发布），并把当时的「公开发布流程进行中」
 *     一直带到 v0.0.13 —— 复用旧模板忘改标题；
 *   · `README.md` 把版本历史、当前公开版本、开发候选混在一起，
 *     一键部署段还写着 v0.0.10 的「安装包待发布」；
 *   · 根目录 `FEATURE_MATRIX.md` / `API_SPEC.md` 与 `docs/` 下的
 *     同名文件并存，读者无法分辨哪个是当前的；
 *   · v0.0.3~v0.0.12 的测试数字被反复当作「当前基线」引用；
 *   · 旧版 API 审计文档容易被写成「已完全兼容」，而原站有明确
 *     下线 / 无法验证的端点。
 *
 * 本护栏只做**口径层面**的结构断言：区分公开版本与开发版本、
 * 区分当前证据与历史快照、禁止把未验证的东西写成「完全兼容」。
 * 它不判断实现是否正确（那是 `v010-docs-implementation-parity.spec.ts`
 * 与各个 E2E 的职责）。
 */

const ROOT = path.resolve(__dirname, '..', '..');
// 静态护栏必须**行尾无关**：CI 是 LF，Windows 本机 core.autocrlf=true 时是 CRLF。
// 不归一化时，`toContain('a\n    ? b')` 这类多行断言会在本机假红、在 CI 假绿。
const read = (rel: string) =>
  readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel: string) => existsSync(path.join(ROOT, rel));

const README = read('README.md');
const CHANGELOG = read('CHANGELOG.md');
const MATRIX = read('docs/FEATURE_MATRIX.md');
const API_SPEC = read('docs/API_SPEC.md');
const PAGE_INVENTORY = read('docs/PAGE_INVENTORY.md');
const LEGACY_MATRIX = read('docs/LEGACY_API_MATRIX_v0.0.13.md');
const ROOT_MATRIX = read('FEATURE_MATRIX.md');
const ROOT_API_SPEC = read('API_SPEC.md');
const BUG_REGISTER = read('BUG_REGISTER.md');
const RELEASE_GATE = read('RELEASE_GATE.md');

/**
 * 当前**发行候选**版本 —— 从 `package.json` 派生，**不硬编码**。
 *
 * 为什么改成派生：这条护栏原本写死 `v0.0.13`，而 v0.0.13 从未发布、
 * 成果由 v0.0.14 一次性包含。硬编码的后果是每次推进版本号，
 * 「文档必须区分已公开版本与开发候选」这条**真正重要的护栏**都要人工改一次，
 * 改的时候很容易顺手把它改松（例如把版本正则删掉）。
 * 现在断言的是**关系**（README 必须同时声明「已公开版本」与「开发候选」，
 * 且候选版本号 = package.json 的版本），与具体版本号解耦，不会随发版失效。
 */
const CANDIDATE = String(
  JSON.parse(read('package.json')).version ?? '',
);
const CANDIDATE_TAG = `v${CANDIDATE}`;
const HANDOFF = `docs/SESSION_HANDOFF_${CANDIDATE_TAG}.md`;
const CANDIDATE_ESCAPED = CANDIDATE.replace(/\./g, '\\.');

/**
 * CHANGELOG 中 v0.0.13 段落标题的**两种合法形态**：
 *   · 开发态：`## [Unreleased] — v0.0.13（开发中 / 发行候选，未发布）`
 *   · 发布当天：`## [0.0.13] — v0.0.13`
 *
 * `.github/workflows/release.yml`「生成中文 Release Notes」用
 * `lines.findIndex(l => /^##\s/.test(l) && l.includes(version))` 抽段：
 * 只要标题仍是 `##` 级且含 `v0.0.13`，把 `[Unreleased]` 改成 `[0.0.13]`
 * 依然能正确注入。这是常规发布动作，护栏**不应判红**；
 * 但也不能因此让护栏失效 —— 仍须挡住「把 v0.0.9 当作 Unreleased / 当前版本」，
 * 以及「v0.0.13 段落被换成空壳」这两类真实风险。
 */
const V13_HEADING_LINE = /^##\s+\[(?:Unreleased|0\.0\.13)\][^\n]*v0\.0\.13/;

type ChangelogV13Section = { heading: string; section: string };

/** 按 release.yml 的抽段规则定位 v0.0.13 段落；找不到返回 null。 */
function findChangelogV13Section(text: string): ChangelogV13Section | null {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i]) && V13_HEADING_LINE.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return {
    heading: lines[start],
    section: lines.slice(start, end).join('\n'),
  };
}

describe('发行文档真实性（v0.0.13）', () => {
  /**
   * ## 这条护栏为什么在发布后换了口径（而不是被删掉 / 改松）
   *
   * 原版写死三件事：README 必须声明「当前实际公开版本 = v0.0.12」、
   * 「本版候选 = v0.0.14」、以及「未打 Tag、未发布 Release」。
   * 那是 **开发态** 的正确事实；v0.0.14 一旦真的发布，这三条同时变成假的 ——
   * 而一条在发版后必然变红的护栏只有两种下场：被人删掉，或被人改松。
   *
   * 真正**不随发版失效**的不变量是「README 的版本声明必须自洽」：
   *   ① 声明的「当前实际公开版本」必须是具体语义版本；
   *   ② 该版本必须同时出现在 Releases 链接 / 部署包名 / 镜像标签三处，
   *      且三处版本号**完全一致**（不能声明 v0.0.14 却给 v0.0.12 的包名）；
   *   ③ 若 `package.json` 的版本 ≠ 已公开版本（开发态），README 必须把
   *      该版本明确标为「候选」，且不得把它写成已发布；
   *   ④ 若两者相等（发布态），README 不得再写「未打 Tag、未发布 Release」。
   *
   * 这比原版更强：原版只要求「两个版本号各自出现过」，
   * 现在要求「声明与三处下载入口版本一致」，且两种形态各自判真。
   */
  it('README 的版本声明必须自洽：已公开版本 = 三处下载入口版本，候选与载体一致', () => {
    expect(README).toContain('当前实际公开版本');
    const releasedMatch = README.match(/当前实际公开版本[^\n]*v(\d+\.\d+\.\d+)/);
    expect(releasedMatch, 'README 未在「当前实际公开版本」后写出具体语义版本').not.toBeNull();
    const RELEASED = String(releasedMatch?.[1] ?? '');
    expect(RELEASED, 'README 的已公开版本号格式非法').toMatch(/^\d+\.\d+\.\d+$/);

    // ① 三处下载入口必须指向**同一个**版本（声明与产物不能各说各话）
    expect(README, `README 缺少 v${RELEASED} 的 Release 链接`).toContain(
      `releases/tag/v${RELEASED}`,
    );
    expect(README, `README 的部署包名不是 v2ex-clone-v${RELEASED}-deploy.zip`).toContain(
      `v2ex-clone-v${RELEASED}-deploy.zip`,
    );
    expect(README, `README 的镜像标签不是 :v${RELEASED}`).toContain(
      `ghcr.io/alicia1030su/v2ex-clone:v${RELEASED}`,
    );

    // ② 候选 / 发布 两种形态二选一，且必须与 package.json 的版本对得上
    const statusSection = README.slice(
      README.indexOf('## 当前版本状态'),
      README.indexOf('\n## ', README.indexOf('## 当前版本状态') + 1),
    );
    expect(statusSection.length, 'README 缺少「当前版本状态」小节').toBeGreaterThan(0);

    if (RELEASED === CANDIDATE) {
      // 发布态：本版即已公开版本 ⇒ 不得再声称"未发布 / 未打 Tag"
      expect(
        statusSection,
        `README 声明 v${RELEASED} 已公开，却又写着「未打 Tag、未发布 Release」—— 自相矛盾`,
      ).not.toContain('未打 Tag、未发布 Release');
      expect(statusSection, `README 未把 v${CANDIDATE} 标注为本版发行版本`).toContain(
        `v${CANDIDATE}`,
      );
      expect(README).not.toContain('未打 Tag、未发布 Release');
    } else {
      // 开发态：候选版本必须被明确标注为候选，且不得写成已发布
      expect(
        statusSection,
        `「当前版本状态」小节必须声明「本版候选 = v${CANDIDATE}」`,
      ).toMatch(new RegExp(`(当前开发版本|本版候选)[^\\n]*v${CANDIDATE_ESCAPED}`));
      expect(
        README,
        `README 把 v${CANDIDATE} 写成已公开发布，但声明的已公开版本是 v${RELEASED}`,
      ).not.toMatch(new RegExp(`v${CANDIDATE_ESCAPED}[^\\n]{0,20}(已正式发布|已发布 Pre-release)`));
    }
  });

  it('README 不得把 v0.0.13 写成已发布，也不得把 v0.0.9 写成当前版本', () => {
    expect(README).not.toMatch(/v0\.0\.13[^\n]{0,20}(已正式发布|已发布 Pre-release)/);
    expect(README).not.toContain('## 当前版本：v0.0.9');
    expect(README).toContain('v0.0.13');
  });

  it('README 继续披露 R-01，并指向本版交接文档', () => {
    expect(README).toContain('R-01');
    expect(README).toContain(HANDOFF);
  });

  it('CHANGELOG 的 v0.0.13 标题为两种合法形态之一，且 v0.0.9 只能作为历史出现', () => {
    const v13 = findChangelogV13Section(CHANGELOG);
    expect(
      v13,
      'CHANGELOG 缺少 v0.0.13 段落：应为 `## [Unreleased] — v0.0.13` 或 `## [0.0.13] — v0.0.13`',
    ).not.toBeNull();
    if (!v13) return;
    // 与 release.yml 的抽段条件同口径：## 级标题 + 含版本号
    expect(v13.heading).toMatch(/^##\s/);
    expect(v13.heading).toContain('v0.0.13');
    expect(v13.heading).toMatch(/^##\s+\[(?:Unreleased|0\.0\.13)\]/);
    // 开发态仍必须显式标注「未发布」；发布态改成 [0.0.13] 后不再要求
    if (v13.heading.includes('[Unreleased]')) {
      expect(v13.heading, '[Unreleased] 标题必须显式标注未发布').toContain('未发布');
    }
    // 真实历史事故：v0.0.9 曾被写成 [Unreleased] / 当前版本 —— 继续挡住
    expect(CHANGELOG).not.toContain('v0.0.9（公开发布流程进行中）');
    expect(CHANGELOG).toContain('## [历史] v0.0.9');
    expect(CHANGELOG).not.toMatch(/^##\s+\[Unreleased\][^\n]*v0\.0\.9/m);
    const v13Index = CHANGELOG.indexOf(v13.heading);
    const v9Index = CHANGELOG.indexOf('## [历史] v0.0.9');
    expect(v13Index).toBeGreaterThanOrEqual(0);
    expect(v9Index).toBeGreaterThan(v13Index);
  });

  it('CHANGELOG 的 v0.0.13 段落必须由实际补齐的三个端点生成，且不宣称完全兼容', () => {
    const v13 = findChangelogV13Section(CHANGELOG);
    expect(v13, 'CHANGELOG 缺少 v0.0.13 段落').not.toBeNull();
    if (!v13) return;
    const section = v13.section;
    for (const endpoint of [
      '/api/topics/hot.json',
      '/api/replies/show.json',
      '/api/nodes/list.json',
    ]) {
      expect(section, `v0.0.13 段落漏了 ${endpoint}`).toContain(endpoint);
    }
    expect(section).toContain('不宣称');
    expect(section).toContain('R-01');

    // Release Notes 注入契约：精确模拟 release.yml 的抽取方式 ——
    // 找到 v0.0.13 的 `## ` 段 → 切到下一个 `## ` → 跳过开头的仓库内部
    // 状态说明，只取**第一个 `###` 小标题之后**的实质内容（A~F 段）。
    const firstSub = section.indexOf('### ');
    expect(firstSub, 'v0.0.13 段落缺少 ### 小标题').toBeGreaterThanOrEqual(0);
    const injected = (firstSub >= 0 ? section.slice(firstSub) : section).trim();
    for (const marker of ['### A.', 'hot.json', 'Feed']) {
      expect(injected, `注入内容缺少实质标记「${marker}」`).toContain(marker);
    }
    expect(injected.length, '注入 Release Notes 的实质内容过短').toBeGreaterThan(100);

    // 发布后会失真的绝对状态陈述不得进入公开 Release Notes。
    // 段落开头（## 到第一个 ### 之前）是给交接用的内部状态说明，
    // release.yml 不注入它 ⇒ **只**在 injected 上断言，不对整个 ## 段落断言，
    // 否则必然假红（见 team-lead 的断言范围澄清）。
    expect(injected, '注入内容含发布后会失真的版本状态陈述').not.toMatch(
      /当前开发版本|当前实际公开版本|发行候选|待授权|尚无 Tag|未发布/,
    );
  });

  it('README 的测试数字表必须标注为「历史实测（非当前结论）」并指向本版交接文档', () => {
    // 真实风险：v0.0.12 的 444 / 220 被反复当作 v0.0.13 的当前基线。
    const tableHeader = /v0\.0\.12[^\n]{0,20}历史实测[^\n]{0,20}非当前结论/;
    expect(README, '测试数字表缺少「历史实测（非当前结论）」标注').toMatch(tableHeader);
    const start = README.search(tableHeader);
    const block = README.slice(start, start + 2000);
    expect(block, '测试数字表附近未指向本版交接文档').toContain(HANDOFF);
    expect(block, '测试数字表附近缺少「当前测试基线」口径指引').toContain('当前测试基线');
    // 444 / 220 必须留在带历史标注的这一段里，不能另起「当前结论」表
    expect(block, 'v0.0.12 的 444 必须留在历史标注段内').toContain('444');
    expect(block, 'v0.0.12 的 220 必须留在历史标注段内').toContain('220');
  });

  it('根目录 FEATURE_MATRIX / API_SPEC 必须显式标注为历史快照并指向权威版', () => {
    for (const [name, text, authority] of [
      ['FEATURE_MATRIX.md', ROOT_MATRIX, 'docs/FEATURE_MATRIX.md'],
      ['API_SPEC.md', ROOT_API_SPEC, 'docs/API_SPEC.md'],
    ] as const) {
      expect(text, `${name} 缺历史快照声明`).toContain('历史快照');
      expect(text, `${name} 未指向权威版本`).toContain(authority);
      expect(text, `${name} 缺「不得作为当前结论」声明`).toMatch(/不得/);
    }
  });

  it('docs/FEATURE_MATRIX.md 必须保留六类状态、范围声明与当前证据段', () => {
    for (const state of [
      '已实现且已验证',
      '已实现但未验证',
      '部分实现',
      '独立实现',
      '确认缺失',
      '原站行为无法确认',
    ]) {
      expect(MATRIX, `图例缺少「${state}」`).toContain(state);
    }
    expect(MATRIX).toContain('只代表其列出的范围');
    expect(MATRIX).toContain('不得把历史数字写成当前结论');
    expect(MATRIX).toContain('## 13.3 v0.0.13 当前验收证据');
    expect(MATRIX).toContain(HANDOFF);
    expect(MATRIX).toContain('tests/static/v013-docs-authenticity.spec.ts');
  });

  it('兼容矩阵必须显式声明不宣称完全兼容，并披露无法验证项', () => {
    expect(LEGACY_MATRIX).toContain('不宣称「完全兼容原站旧版 API」');
    expect(LEGACY_MATRIX).toMatch(/无法验证|未实测/);
    expect(LEGACY_MATRIX).toMatch(/15\s*项|15 项/);
  });

  it('API_SPEC 与 PAGE_INVENTORY 必须同时登记三个新增旧版端点', () => {
    const endpoints = [
      '/api/topics/hot.json',
      '/api/replies/show.json',
      '/api/nodes/list.json',
    ];
    for (const endpoint of endpoints) {
      expect(API_SPEC, `API_SPEC 未登记 ${endpoint}`).toContain(endpoint);
      expect(PAGE_INVENTORY, `PAGE_INVENTORY 未登记 ${endpoint}`).toContain(endpoint);
    }
    // 文档写了端点，实现文件就必须存在（避免「文档先行」冒充已实现）
    expect(exists('src/app/api/topics/hot.json/route.ts')).toBe(true);
    expect(exists('src/app/api/replies/show.json/route.ts')).toBe(true);
    expect(exists('src/app/api/nodes/list.json/route.ts')).toBe(true);
  });

  it('API_SPEC 必须区分原站路径的 Atom/JSON Feed 与站内 RSS/JSON Feed', () => {
    expect(API_SPEC).toContain('Atom 1.0');
    expect(API_SPEC).toContain('JSON Feed 1.0');
    expect(API_SPEC).toContain('ETag');
    expect(API_SPEC).toContain('304');
  });

  it('交接文档必须存在且包含 HEAD / 当前测试基线 / 授权边界 / Go-No-Go', () => {
    expect(exists(HANDOFF), `缺少 ${HANDOFF}`).toBe(true);
    if (!exists(HANDOFF)) return;
    const text = read(HANDOFF);
    for (const marker of ['当前测试基线', '授权边界', 'HEAD', 'Go/No-Go', 'R-01']) {
      expect(text, `交接文档缺少「${marker}」`).toContain(marker);
    }
    // 交接文档引用的证据文件必须真实存在
    const missing: string[] = [];
    for (const m of text.matchAll(/`((?:docs|e2e|src|tests|scripts)\/[^`\s]+?\.(?:ts|tsx|md|json|sh|mjs))`/g)) {
      if (!exists(m[1])) missing.push(m[1]);
    }
    expect(missing, `交接文档引用了不存在的文件：\n${missing.join('\n')}`).toEqual([]);
  });

  it('BUG_REGISTER 必须登记本轮 V13 缺陷，RELEASE_GATE 必须有本版 Go/No-Go 段', () => {
    expect(BUG_REGISTER).toContain('V13-01');
    expect(BUG_REGISTER).toContain('V13-');
    expect(RELEASE_GATE).toContain('v0.0.13');
    expect(RELEASE_GATE).toMatch(/Go\s*\/\s*No-Go/);
  });

  it('Release Notes 生成模板不得复用旧版本标题 / 旧版本更新内容', () => {
    const workflow = read('.github/workflows/release.yml');
    // v0.0.12 的公开 Notes 标题写着「v0.0.9 更新内容」，正文整段是 v0.0.9 的更新条目。
    // 已发布 Release 不可改，但生成模板必须根治：更新内容由 CHANGELOG 注入。
    expect(workflow).toContain('### __VERSION__ 更新内容');
    expect(workflow).toContain('__CHANGELOG_SECTION__');
    expect(workflow).toContain("readFileSync('CHANGELOG.md'");
    expect(workflow).toContain('拒绝用旧模板生成 Release Notes');
    expect(workflow).toContain('缺少本版本更新内容标题');
    expect(workflow).not.toContain('### v0.0.9 更新内容');
    expect(workflow).not.toContain('风险接受仅针对 v0.0.9');
    // 已被实现否证的「主题编辑与删除未实现」不得再写进对外说明
    expect(workflow).not.toContain('**主题编辑与删除**：未实现');
    // 白名单就绪 ≠ 已发布；本版本链路必须存在
    expect(workflow).toContain("- 'v0.0.13'");
  });

  it('版本载体在开发态必须彼此一致（package.json / deploy/VERSION / release-facts.json）', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    const deployVersion = read('deploy/VERSION').trim();
    const facts = JSON.parse(read('docs/release-facts.json')) as { version: string };
    expect(pkg.version).toBe(deployVersion);
    expect(facts.version).toBe(deployVersion);
    // 0 条测试不能被写成「成功」：发布事实里不能有零用例的套件
    expect(facts).toHaveProperty('unit.tests');
    const f = facts as unknown as { unit: { tests: number }; e2e: { tests: number } };
    expect(f.unit.tests).toBeGreaterThan(0);
    expect(f.e2e.tests).toBeGreaterThan(0);
  });
});
