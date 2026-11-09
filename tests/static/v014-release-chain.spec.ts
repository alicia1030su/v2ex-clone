import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 发布链路**触发器就绪性**护栏（v0.0.14）
 *
 * ## 这个护栏防的是什么（真实事故）
 *
 * v0.0.14 已获主人明确风险接受 + 公开发布授权，版本载体同步到 `0.0.14`，
 * 候选产物也在该源码树上验证通过。打 Tag 前逐项核对发布链路时发现：
 *
 *   `release.yml` 的 `on.push.tags` 白名单**只到 `v0.0.13`**。
 *
 * 后果不是「发布失败」，而是**发布根本不发生**：推 `v0.0.14` tag
 * 不会触发任何 job，没有报错、没有红叉、没有任何通知 —— 看起来"推上去了"，
 * 实际上 Release 永远不会出现。而 Tag 一旦推上去就**不可移动**
 * （移动 Tag 属需主人单独授权的不可逆操作），于是这个版本直接卡死。
 *
 * ## 为什么既有门禁全都抓不到
 *
 * · `ci.yml` 跑的是分支与 PR，**从不跑 tag 触发器**；
 * · 静态套件当时只断言「白名单里有 `v0.0.13`」—— 这是**历史字符串**，
 *   它不追问「当前版本的版本号在不在里面」；
 * · 单元 / E2E / 构建 / 安装验证都不需要 tag，因此全绿。
 *
 * 同类缺陷的一般形态是「**配置里少了一行，而这一行只在真实触发时才被读取**」，
 * 与 V14-01 的「代码齐全、链路不通」是同一类。本护栏因此不看历史字符串，
 * 而是**把当前版本载体与白名单做交叉比对**。
 *
 * ## 判据
 *
 * 1. `package.json` 的 version 必须出现在 `release.yml` 的 tag 白名单里；
 * 2. 白名单条目必须是纯版本号字符串（不能写成 `v*` 之类的通配 ——
 *    那会让任意 tag 都能触发带 `packages:write` / `contents:write` 的流水线）；
 * 3. 白名单里的版本号必须严格递增且无重复（防止手滑写成 `v0.0.1` 覆盖旧值）。
 *
 * ⚠️ 本护栏**不能**替代「打 Tag 前的人工核对」：它只保证「版本号在里面」，
 * 不能证明白名单里的版本**该不该**发布（那是 G10 授权判据的职责）。
 * 白名单就绪 ≠ 已授权 ≠ 已发布。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const WORKFLOW_PATH = '.github/workflows/release.yml';
const workflow = read(WORKFLOW_PATH);
const pkg = JSON.parse(read('package.json')) as { version: string };
const VERSION = pkg.version;
const TAG = `v${VERSION}`;

/**
 * 从 `on.push.tags` 段里抽出白名单条目。
 *
 * 只解析 **`on:` 之后的 `push:` → `tags:` 列表**，不扫全文 —— 否则
 * 注释里提到的历史版本号（本文件注释里就有一堆）会被误当成条目。
 * 这正是本仓反复踩的「朴素字符串匹配把注释当实现」的坑（V13-17 / V14-03）。
 */
function parseTagWhitelist(source: string): string[] {
  const lines = source.split('\n');
  const onIndex = lines.findIndex((l) => /^on:\s*$/.test(l));
  expect(onIndex, '未找到顶层 on: 段').toBeGreaterThanOrEqual(0);

  let inPush = false;
  let inTags = false;
  let pushIndent = -1;
  const entries: string[] = [];

  for (let i = onIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // 顶层键出现 ⇒ on: 段结束
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (!inPush) {
      if (/^push:\s*$/.test(trimmed)) {
        inPush = true;
        pushIndent = indent;
      }
      continue;
    }
    // 回到与 push 同级或更浅 ⇒ push 段结束
    if (trimmed && indent <= pushIndent && !/^\s*#/.test(line)) break;

    if (!inTags) {
      if (/^tags:\s*$/.test(trimmed)) inTags = true;
      continue;
    }
    if (!trimmed || trimmed.startsWith('#')) continue;

    const m = trimmed.match(/^-\s*'([^']+)'\s*$/) || trimmed.match(/^-\s*"([^"]+)"\s*$/);
    if (!m) {
      // 出现了非字符串条目（例如通配或裸标量）⇒ 直接记录，交由下面的断言判红
      entries.push(trimmed.replace(/^-\s*/, ''));
      continue;
    }
    entries.push(m[1]);
  }
  return entries;
}

describe('发布链路：Tag 白名单与版本载体一致（v0.0.14）', () => {
  it('release.yml 存在且能被解析出非空白名单', () => {
    expect(existsSync(path.join(ROOT, WORKFLOW_PATH))).toBe(true);
    const list = parseTagWhitelist(workflow);
    expect(list.length, 'tag 白名单为空 —— 任何 tag 都不会触发发布流水线').toBeGreaterThan(0);
  });

  it('版本载体中的当前版本必须出现在 tag 白名单里（否则推 Tag 不会触发发布）', () => {
    const list = parseTagWhitelist(workflow);
    expect(
      list,
      `release.yml 的 on.push.tags 白名单缺少当前版本 ${TAG}（package.json version = ${VERSION}）。\n` +
        `后果：推送 ${TAG} tag **不会触发任何 job**，Release 永远建不出来，` +
        `而 Tag 推上去就不可移动 ⇒ 该版本会被卡死。\n` +
        `修复：在 .github/workflows/release.yml 的 on.push.tags 下加入 '- '${TAG}''。`,
    ).toContain(TAG);
  });

  it('白名单条目必须是具体版本号，不得使用通配（否则任意 tag 都能触发带写权限的流水线）', () => {
    const list = parseTagWhitelist(workflow);
    const bad = list.filter((t) => !/^v\d+\.\d+\.\d+$/.test(t));
    expect(bad, `白名单含非具体版本条目：${bad.join(', ')}`).toEqual([]);
  });

  it('白名单版本号严格递增且无重复', () => {
    const list = parseTagWhitelist(workflow);
    const versions = list.map((t) => t.replace(/^v/, ''));
    expect(new Set(versions).size, `白名单存在重复版本：${versions.join(', ')}`).toBe(versions.length);

    const bySemver = (a: string, b: string) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i += 1) {
        if (pa[i] !== pb[i]) return pa[i] - pb[i];
      }
      return 0;
    };
    const sorted = [...versions].sort(bySemver);
    expect(versions, '白名单未按版本号递增排列（易被手滑覆盖）').toEqual(sorted);
  });
});

/**
 * ## 第二个真实事故：读仓库文件的 job 没有 checkout
 *
 * run `42661344826`（v0.0.14 正式发布）在**镜像已推送、部署验证通过、
 * 安装包 N2 校验通过**之后，于「生成中文 Release Notes」步骤判红：
 *
 *     Error: ENOENT: no such file or directory, open 'CHANGELOG.md'
 *
 * 根因：v0.0.13 的 V13-10 给 `publish-release` 加了「更新内容必须由本版本
 * CHANGELOG 生成」的逻辑（`readFileSync('CHANGELOG.md')`），
 * 但**没有给这个 job 加 checkout** —— 全部 8 个 job 里只有它没有。
 *
 * 为什么既有门禁抓不到：`ci.yml` 根本不跑 `release.yml` 的 job；
 * 而 `v013-docs-authenticity.spec.ts` 只断言「模板里有
 * `readFileSync('CHANGELOG.md'` 这句**代码**」——
 * 代码在，**运行目录里没有那个文件**。同属「代码写了、链路不通」。
 *
 * ⇒ 判据：**任何在 `run:` 里读仓库内文件的 job，都必须有 checkout，
 *   且 checkout 必须排在 `download-artifact` 之前**。
 *   后半条不是洁癖：`actions/checkout` 默认 `clean: true` 会
 *   `git clean -ffdx`，若先下载 artifact 再 checkout，
 *   `release-assets/` 会被静默清空，后续上传资产拿不到文件。
 */

/** 按 `  <job-name>:` 切分 jobs 段，返回 job → 该 job 的源码块。 */
function splitJobs(source: string): Map<string, string> {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  expect(start, '未找到 jobs: 段').toBeGreaterThanOrEqual(0);

  const result = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) {
      if (current) result.set(current, buffer.join('\n'));
      current = m[1];
      buffer = [];
      continue;
    }
    if (current) buffer.push(line);
  }
  if (current) result.set(current, buffer.join('\n'));
  return result;
}

/** job 块里是否真的会去读仓库文件（按 `run:` 脚本内容判断，不看注释）。 */
const READS_REPO_FILE = /\b(readFileSync|readFile|cat\s+[A-Za-z0-9_./-]+\.(md|json)|head\s+[A-Za-z0-9_./-]+\.(md|json))\b/;

describe('发布链路：读仓库文件的 job 必须 checkout（v0.0.14）', () => {
  const jobs = splitJobs(workflow);

  it('jobs 段能被切分且包含 publish-release', () => {
    expect(jobs.size, 'jobs 段解析结果为空').toBeGreaterThan(5);
    expect([...jobs.keys()]).toContain('publish-release');
  });

  it('publish-release 必须 checkout（否则 Release Notes 读不到 CHANGELOG.md）', () => {
    const block = jobs.get('publish-release') ?? '';
    expect(block, 'publish-release job 不存在').not.toBe('');
    expect(
      block.includes('uses: actions/checkout'),
      'publish-release 缺少 actions/checkout。\n' +
        '该 job 的「生成中文 Release Notes」需要读仓库里的 CHANGELOG.md；\n' +
        '没有 checkout 会在发布时抛 ENOENT，且**只在真正发版时才暴露**。',
    ).toBe(true);
  });

  it('publish-release 的 checkout 必须排在下载安装包之前（否则 artifact 会被 git clean 清空）', () => {
    const block = jobs.get('publish-release') ?? '';
    const checkoutAt = block.indexOf('uses: actions/checkout');
    const downloadAt = block.indexOf('uses: actions/download-artifact');
    expect(checkoutAt, '未找到 checkout').toBeGreaterThanOrEqual(0);
    expect(downloadAt, '未找到 download-artifact').toBeGreaterThanOrEqual(0);
    expect(
      checkoutAt < downloadAt,
      'checkout 排在 download-artifact 之后 —— actions/checkout 默认 clean:true ' +
        '会执行 git clean -ffdx，把刚下载的 release-assets/ 静默删除。',
    ).toBe(true);
  });

  /**
   * ## 第三个真实缺口：Release Notes 里写死了「待主人裁决」
   *
   * v0.0.14 首次发布后核对线上 Release Notes，发现 R-01 表格里有一行：
   *
   *     风险接受按版本单独作出 | …… | **待主人裁决**
   *
   * 但这行是在**发布成功之后**读到的 —— 而 Release 能发出来，本身就说明
   * 授权已经作出（发布流水线之外没有任何自动发布路径）。
   * 于是一条"待裁决"的公开声明，描述的是一个**不可能存在的状态**，
   * 等于公开说「本版本未获授权就发布了」—— 这是最不该出现的假话。
   *
   * 判据：模板**不得**出现"待裁决 / 待授权"这类**待定态**措辞。
   * 发布流水线的输入只有两种：tag push（已授权）与 dispatch publish=true
   * （已授权）；不存在"未授权但能发出去"的路径。
   */
  /** 只截出 `cat > release-notes.md <<'NOTES'` 到 `NOTES` 之间的**模板正文**。
   *
   * ⚠️ 不能扫整个 workflow：文件里另有一处 `devOnly` 数组**合法地**列着
   * 「待授权 / 未发布」等词 —— 那是**反向过滤**用的黑名单（用来保证这些词
   * 不会漏进 Release Notes）。第一版护栏就是扫了全文，被自己的黑名单误伤。
   * 判据必须限定在**真正会写进公开说明的文本**上。
   * 这与本仓 V13-17 / V14-03 的教训同源：反向断言先剥掉不该算数的部分。
   */
  const notesTemplate = (() => {
    const start = workflow.indexOf("cat > release-notes.md <<'NOTES'");
    if (start < 0) return '';
    const bodyStart = workflow.indexOf('\n', start) + 1;
    const end = workflow.indexOf('\n          NOTES', bodyStart);
    return end < 0 ? '' : workflow.slice(bodyStart, end);
  })();

  it('Release Notes 模板必须是可解析的（不能因抽取失败而静默跳过检查）', () => {
    expect(
      notesTemplate.length,
      '未能从 release.yml 抽出 Release Notes 模板正文 —— 护栏会静默失效，判失败',
    ).toBeGreaterThan(1000);
  });

  it('Release Notes 模板不得声明「待主人裁决 / 待授权」这类不可能存在的状态', () => {
    const pending = ['待主人裁决', '待授权', '待批准'];
    const found = pending.filter((w) => notesTemplate.includes(w));
    expect(
      found,
      `Release Notes 模板含待定态措辞：${found.join(' / ')}。\n` +
        'Release 能发出来就说明授权已作出；公开说明里写"待裁决"等于自证未授权发布。',
    ).toEqual([]);
  });

  it('Release Notes 模板必须由本版本 CHANGELOG 注入更新内容（V13-10 契约）', () => {
    expect(notesTemplate).toContain('__CHANGELOG_SECTION__');
    expect(notesTemplate).toContain('### __VERSION__ 更新内容');
  });

  it('凡是在 run 脚本里读仓库文件的 job 都必须 checkout', () => {
    const offenders: string[] = [];
    for (const [name, block] of jobs) {
      if (!READS_REPO_FILE.test(block)) continue;
      if (!block.includes('uses: actions/checkout')) offenders.push(name);
    }
    expect(
      offenders,
      `以下 job 在脚本里读仓库文件却没有 checkout（发布时会 ENOENT）：${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
