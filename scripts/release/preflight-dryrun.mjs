#!/usr/bin/env node
/**
 * 发布预演：静态链路检查 + Release Notes 渲染（v0.0.15 P0-3）
 *
 * ## 这个脚本解决的真实问题
 *
 * v0.0.14 首次真实发布暴露了三个缺陷，**每一个都不让任何既有门禁变红**：
 *
 *   1. `release.yml` 的 `on.push.tags` 白名单硬编码版本，新版本不在里面
 *      ⇒ 推 Tag **不触发任何 job**（无报错、无红叉），而 Tag 不可移动 ⇒ 卡死；
 *   2. `publish-release` 是唯一没有 `checkout` 的 job，却要读 `CHANGELOG.md`
 *      ⇒ 真发版时 `ENOENT`（首次发布 runs `42661344826` 就是这么死的）；
 *   3. Release Notes 模板把「待主人裁决」写死 ⇒ 发布成功后公开说明自证未授权。
 *
 * 共同形态：**配置少一行 / 文件读不到 / 文案过期，而它们只在真实触发时才被读取。**
 *
 * ## 为什么必须带负向对照
 *
 * 「文件里出现了某个字符串」这种断言有两个致命弱点（本仓已踩过多次）：
 *   · 可能被**注释**满足（V13-17 的 `not.toContain` 被注释误伤）；
 *   · 可能因为函数被搬走而变成**恒绿空断言**（v014-tag-chain 的「名字出现 ≠ 被调用」）。
 *
 * 所以本脚本的每一条正向判据都**立刻**在同一进程里做一次注入式负向对照：
 * 把输入改坏 → 同一个判据必须判红 → 否则「判据本身失效」也要报错。
 *
 * ## 用法
 *
 *   node scripts/release/preflight-dryrun.mjs --mode=static
 *   node scripts/release/preflight-dryrun.mjs --mode=static --version=v0.0.15
 *   node scripts/release/preflight-dryrun.mjs --mode=notes
 *   node scripts/release/preflight-dryrun.mjs --mode=notes --version=v0.0.15
 *
 * 退出码：0 = 全部通过（含全部负向对照）／1 = 有任何一项不符合预期
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
let checks = 0;

function ok(msg) {
  checks += 1;
  console.log(`  ✓ ${msg}`);
}

function bad(msg) {
  failures += 1;
  console.error(`  ✗ ${msg}`);
}

function section(title) {
  console.log(`\n${title}`);
}

/** 参数解析（不引第三方库：本脚本要在没装依赖时也能跑） */
const args = process.argv.slice(2);
const mode = (args.find((a) => a.startsWith('--mode=')) ?? '--mode=static').split('=')[1];
const versionArg = (() => {
  const hit = args.find((a) => a.startsWith('--version='));
  if (hit === undefined) return undefined;
  return hit.slice('--version='.length);
})();

// ---------------------------------------------------------------------------
// 公共：版本号从 argv / package.json 派生
// ---------------------------------------------------------------------------
const pkgVersion = String(JSON.parse(read('package.json')).version);
const VERSION = (() => {
  if (versionArg !== undefined) return versionArg;
  return `v${pkgVersion}`;
})();

const VERSION_RE = /^v\d+\.\d+\.\d+$/;

// ---------------------------------------------------------------------------
// 判据实现（纯函数，便于负向对照直接喂"坏输入"）
// ---------------------------------------------------------------------------

/** 从 `on.push.tags` 段解析白名单（只认代码，不认注释） */
export function parseTagWhitelist(source) {
  const lines = source.split('\n');
  const onIndex = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (onIndex < 0) return null;

  let inPush = false;
  let inTags = false;
  let pushIndent = -1;
  const entries = [];

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
    if (trimmed && indent <= pushIndent && !trimmed.startsWith('#')) break;

    if (!inTags) {
      if (/^tags:\s*$/.test(trimmed)) inTags = true;
      continue;
    }
    if (!trimmed || trimmed.startsWith('#')) continue;

    const m = trimmed.match(/^-\s*'([^']+)'\s*$/) || trimmed.match(/^-\s*"([^"]+)"\s*$/);
    entries.push(m ? m[1] : trimmed.replace(/^-\s*/, ''));
  }
  return entries;
}

/** 判据 1：目标版本必须在白名单里 */
export function whitelistContains(source, version) {
  const list = parseTagWhitelist(source);
  if (list === null) return { pass: false, why: '未找到 on.push.tags 段' };
  if (list.length === 0) return { pass: false, why: '白名单为空' };
  if (!list.includes(version)) {
    return {
      pass: false,
      why: `白名单缺 ${version}（当前：${list.join(', ')}）⇒ 推该 Tag 不会触发任何 job`,
    };
  }
  return { pass: true, list };
}

/** 判据 2：白名单条目必须是具体版本号，不得通配 */
export function whitelistIsConcrete(source) {
  const list = parseTagWhitelist(source);
  if (list === null) return { pass: false, why: '未找到 on.push.tags 段' };
  const badEntries = list.filter((t) => !VERSION_RE.test(t));
  if (badEntries.length > 0) {
    return {
      pass: false,
      why: `含非具体版本条目：${badEntries.join(', ')}（通配会让任意 tag 触发带写权限的流水线）`,
    };
  }
  return { pass: true, list };
}

/** 按 `  <job>:` 切分 jobs 段 */
export function splitJobs(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return null;

  const result = new Map();
  let current = null;
  let buffer = [];

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

const READS_REPO_FILE =
  /\b(readFileSync|readFile|cat\s+[A-Za-z0-9_./-]+\.(md|json)|head\s+[A-Za-z0-9_./-]+\.(md|json))\b/;

/** 判据 3：publish-release 必须有 checkout，且在 download-artifact 之前 */
export function publishReleaseCheckout(source) {
  const jobs = splitJobs(source);
  if (!jobs) return { pass: false, why: '未找到 jobs 段' };
  const block = jobs.get('publish-release');
  if (!block) return { pass: false, why: '未找到 publish-release job' };

  const checkoutAt = block.indexOf('uses: actions/checkout');
  if (checkoutAt < 0) {
    return {
      pass: false,
      why: 'publish-release 缺 actions/checkout ⇒ Release Notes 读不到 CHANGELOG.md（v0.0.14 首次发布即死于此）',
    };
  }
  const downloadAt = block.indexOf('uses: actions/download-artifact');
  if (downloadAt >= 0 && checkoutAt > downloadAt) {
    return {
      pass: false,
      why: 'checkout 排在 download-artifact 之后 ⇒ checkout 默认 clean:true 会 git clean -ffdx 清空刚下载的 release-assets/',
    };
  }
  return { pass: true };
}

/** 判据 4：凡读仓库文件的 job 都必须 checkout */
export function allRepoReadingJobsCheckout(source) {
  const jobs = splitJobs(source);
  if (!jobs) return { pass: false, why: '未找到 jobs 段' };
  const offenders = [];
  for (const [name, block] of jobs) {
    if (!READS_REPO_FILE.test(block)) continue;
    if (!block.includes('uses: actions/checkout')) offenders.push(name);
  }
  if (offenders.length > 0) {
    return { pass: false, why: `以下 job 读仓库文件却没有 checkout：${offenders.join(', ')}` };
  }
  return { pass: true };
}

/** 抽出 Release Notes 模板正文（`cat > release-notes.md <<'NOTES'` 到 `NOTES`） */
/**
 * 抽出模板的**原始**文本（保留 `run: |` 的块缩进）。
 *
 * ⚠️ 为什么需要两个函数：v0.0.17 给 `extractNotesTemplate` 加了「去掉公共缩进」，
 * 于是它返回的文本**不再与源码逐字相同** ⇒ 负向对照用
 * `workflow.indexOf(tpl)` 定位注入点时得到 -1、用 `replace(tpl, ...)` 变成空操作
 * ⇒ 报「无法构造 / 假绿」。
 *
 * 这不是判据失效，是**两个用途被混在一个返回值上**：
 *   · **判定**（比较标题、查待定词）需要「运行时看到的那份文本」⇒ 去缩进
 *   · **注入**（在源码里改坏一段）需要「源码里的那份文本」⇒ 保留缩进
 * 分开之后两边都对。
 */
export function extractNotesTemplateRaw(source) {
  const start = source.indexOf("cat > release-notes.md <<'NOTES'");
  if (start < 0) return null;
  const bodyStart = source.indexOf('\n', start) + 1;
  const end = source.indexOf('\n          NOTES', bodyStart);
  if (end < 0) return null;
  return source.slice(bodyStart, end);
}

export function extractNotesTemplate(source) {
  const start = source.indexOf("cat > release-notes.md <<'NOTES'");
  if (start < 0) return null;
  const bodyStart = source.indexOf('\n', start) + 1;
  const end = source.indexOf('\n          NOTES', bodyStart);
  if (end < 0) return null;
  const raw = source.slice(bodyStart, end);

  /*
   * ⚠️ v0.0.17：必须**去掉 YAML 块标量的公共缩进**。
   *
   * `run: |` 里的内容在 YAML 解析时由 GitHub Actions 统一剥掉块缩进
   * （本文件是 10 个空格），运行时写进 `release-notes.md` 的文本**没有**缩进。
   * 而这里是从**源码文本**里切片的，切出来的每一行都带着那 10 个空格
   * ⇒ 本地预演的产物第一行是 `          ## v0.0.17 — 稳定版`，
   * 那不是 Markdown 标题，GitHub 会渲染成缩进代码块。
   *
   * 换句话说：预演的产物与真实发布的产物**不是同一份文本** ——
   * 这正是本仓反复记录的「预演验证的不是同一条路径」。
   * 在抽取处统一去缩进，两边才一致。
   */
  const lines = raw.split('\n');
  const indents = lines
    .filter((l) => l.trim() !== '')
    .map((l) => l.match(/^ */)[0].length);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(common)).join('\n');
}

/** 判据 5：模板不得含待定态措辞（发布成功即证明已授权） */
export function notesHasNoPendingWord(source) {
  const tpl = extractNotesTemplate(source);
  if (tpl === null) return { pass: false, why: '无法抽出 Release Notes 模板正文' };
  if (tpl.length < 1000) {
    return { pass: false, why: `模板正文过短（${tpl.length} 字符）—— 抽取可能失效，护栏会静默变绿` };
  }
  const pending = ['待主人裁决', '待授权', '待批准'];
  const found = pending.filter((w) => tpl.includes(w));
  if (found.length > 0) {
    return {
      pass: false,
      why: `模板含待定态措辞：${found.join(' / ')}（Release 能发出来就说明已授权，写"待裁决"等于自证未授权发布）`,
    };
  }
  return { pass: true };
}

/** 判据 6：模板必须仍由 CHANGELOG 注入（V13-10 契约），防止回归成旧模板 */
export function notesKeepsChangelogContract(source) {
  const tpl = extractNotesTemplate(source);
  if (tpl === null) return { pass: false, why: '无法抽出 Release Notes 模板正文' };
  if (!tpl.includes('__CHANGELOG_SECTION__')) {
    return { pass: false, why: '模板缺 __CHANGELOG_SECTION__ 占位符' };
  }
  if (!tpl.includes('### __VERSION__ 更新内容')) {
    return { pass: false, why: '模板缺「### __VERSION__ 更新内容」标题（会退化成旧模板）' };
  }
  return { pass: true };
}

/**
 * 判据 7：CHANGELOG 能抽出目标版本段落，且注入正文不含**内部状态措辞**
 *
 * 抽取规则与 `.github/workflows/release.yml` 的「生成中文 Release Notes」
 * **逐字一致**（精确 token + headingVersion），否则本预演验证的不是同一条路径。
 */
export function extractChangelogSection(changelog, version) {
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionToken = new RegExp('(?:^|[^0-9])' + esc + '(?![0-9.])');
  const headingVersion = (line) => {
    const m = line.match(/\bv?\d+\.\d+\.\d+\b/g);
    return m ? m[m.length - 1].replace(/^v/, '') : null;
  };
  const want = version.replace(/^v/, '');
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(
    (l) => /^##\s/.test(l) && versionToken.test(l) && headingVersion(l) === want,
  );
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const raw = lines.slice(start + 1, end);
  const firstSub = raw.findIndex((l) => /^###\s/.test(l));
  return {
    heading: lines[start],
    section: (firstSub >= 0 ? raw.slice(firstSub) : raw).join('\n').trim(),
  };
}

const DEV_ONLY_WORDS = ['当前开发版本', '当前实际公开版本', '发行候选', '待授权', '尚无 Tag', '未发布'];

export function notesSectionIsPublishable(section) {
  if (!section || section.length < 100) {
    return { pass: false, why: `段落过短（${section?.length ?? 0} 字符），疑似占位模板` };
  }
  const leaked = DEV_ONLY_WORDS.filter((w) => section.includes(w));
  if (leaked.length > 0) {
    return { pass: false, why: `注入正文含仓库内部状态措辞：${leaked.join(' / ')}` };
  }
  const foreign = (section.match(/^#{2,4}\s+v?\d+\.\d+\.\d+[^\n]*$/gm) ?? []).filter((h) => {
    const m = h.match(/\bv?\d+\.\d+\.\d+\b/g);
    const hv = m ? m[m.length - 1].replace(/^v/, '') : null;
    return hv !== null && `v${hv}` !== VERSION;
  });
  if (foreign.length > 0) {
    return { pass: false, why: `注入正文含其它版本标题：${foreign.join(' | ')}` };
  }
  return { pass: true };
}

// ---------------------------------------------------------------------------
// 负向对照工具：把输入改坏，看同一判据是否真的判红
// ---------------------------------------------------------------------------

/** 从某个 job 里删掉 `actions/checkout` 步骤（正向判据的负向对照用） */
function removeJobCheckout(source, jobName) {
  const lines = source.split('\n');
  const jobStart = lines.findIndex((l) => l === `  ${jobName}:`);
  if (jobStart < 0) return null;
  let jobEnd = lines.length;
  for (let i = jobStart + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      jobEnd = i;
      break;
    }
  }
  const checkoutLine = lines.findIndex(
    (l, i) => i > jobStart && i < jobEnd && l.includes('uses: actions/checkout'),
  );
  if (checkoutLine < 0) return null;

  // 步骤边界：从上一个 `- ` 行（含）到下一个同级或更浅缩进的 `- ` 行之前。
  // 这里用「缩进 <= 该步骤起始缩进 的行」作为边界更稳妥 ——
  // 因为 `with:` 下面可能带大段注释块，靠"更深缩进"判断会把注释一并吃掉也可能吃不够。
  let from = checkoutLine;
  while (from > jobStart && !/^\s*-\s/.test(lines[from])) from -= 1;
  const stepIndent = lines[from].length - lines[from].trimStart().length;

  let to = from + 1;
  while (to < jobEnd) {
    const line = lines[to];
    if (line.trim() === '') {
      to += 1;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= stepIndent) break;
    to += 1;
  }
  // 回退尾部空行（别把下一个步骤前的空行删掉导致格式粘连）
  while (to - 1 > from && lines[to - 1].trim() === '') to -= 1;

  const removed = lines.slice();
  removed.splice(from, to - from);
  return removed.join('\n');
}

function negativeControl(name, mutate, judge) {
  const mutated = mutate();
  if (mutated === null) {
    bad(`负向对照「${name}」无法构造（找不到可破坏的位置）—— 判据可能已失效`);
    return;
  }
  const result = judge(mutated);
  if (result.pass) {
    bad(`负向对照「${name}」失败：输入已破坏，判据却仍判通过 —— 该判据是假绿`);
  } else {
    ok(`负向对照「${name}」判红：${result.why.slice(0, 80)}`);
  }
}

// ---------------------------------------------------------------------------
// 模式 1：static
// ---------------------------------------------------------------------------
function runStatic() {
  console.log('═'.repeat(70));
  console.log(`发布预演 · 静态链路检查（目标版本 ${VERSION || '(空)'}）`);
  console.log('═'.repeat(70));

  // ① 版本号合法性（空 / 格式非法都必须拒绝）
  section('① 版本号校验');
  if (!VERSION || !VERSION_RE.test(VERSION)) {
    bad(`版本号非法：'${VERSION}'（应形如 v0.0.15）`);
    console.log('\n摘要：版本号未通过校验，后续检查无意义');
    return 1;
  }
  ok(`版本号合法：${VERSION}`);
  // 负向：空 / 各种非法形态
  for (const badVersion of ['', '0.0.15', 'v0.0', 'v0.0.15.1', 'vv0.0.15', 'v0.0.15-rc1']) {
    if (VERSION_RE.test(badVersion)) {
      bad(`负向：非法版本号 '${badVersion}' 竟然通过校验`);
    } else {
      ok(`负向：拒绝 '${badVersion}'`);
    }
  }

  const workflow = read('.github/workflows/release.yml');

  // ② 白名单含目标版本
  section('② Tag 白名单');
  const wl = whitelistContains(workflow, VERSION);
  if (wl.pass) {
    ok(`白名单含 ${VERSION}（共 ${wl.list.length} 项）`);
  } else {
    bad(wl.why);
  }
  negativeControl(
    `从白名单移除 ${VERSION}`,
    () =>
      workflow.includes(`      - '${VERSION}'`)
        ? workflow.replace(`      - '${VERSION}'\n`, '')
        : null,
    (src) => whitelistContains(src, VERSION),
  );

  // ③ 白名单不含通配
  section('③ 白名单条目必须是具体版本号');
  const concrete = whitelistIsConcrete(workflow);
  if (concrete.pass) {
    ok('全部条目均为具体版本号（无通配）');
  } else {
    bad(concrete.why);
  }
  negativeControl(
    '插入 v* 通配条目',
    () => workflow.replace('  push:\n    tags:\n', "  push:\n    tags:\n      - 'v*'\n"),
    (src) => whitelistIsConcrete(src),
  );

  // ④ publish-release 必须 checkout
  section('④ publish-release 的 checkout');
  const pr = publishReleaseCheckout(workflow);
  if (pr.pass) {
    ok('publish-release 有 checkout，且在 download-artifact 之前');
  } else {
    bad(pr.why);
  }
  negativeControl(
    '删除 publish-release 的 checkout 步骤',
    () => {
      const jobs = splitJobs(workflow);
      const block = jobs?.get('publish-release');
      if (!block) return null;
      const marker = '      - name: 检出代码（Release Notes 需要 CHANGELOG.md）';
      if (!block.includes(marker)) return null;
      const checkoutBlock = block.slice(
        block.indexOf(marker),
        block.indexOf('      - name: 下载安装包'),
      );
      return workflow.replace(checkoutBlock, '');
    },
    (src) => publishReleaseCheckout(src),
  );

  // ⑤ 凡读仓库文件的 job 都必须 checkout
  section('⑤ 读仓库文件的 job 必须 checkout');
  const allCo = allRepoReadingJobsCheckout(workflow);
  if (allCo.pass) {
    ok('全部读仓库文件的 job 都有 checkout');
  } else {
    bad(allCo.why);
  }
  // 负向对照的靶子必须是**判据真的认定为"读仓库文件"**的 job。
  //
  // ⚠️ 第一版靶子选了 `package`，结果对照失败 —— 不是判据失效，而是
  //    `package` 的读取发生在**被调用的脚本**（`package-deploy-zip.mjs`）里，
  //    不在 `run:` 内联脚本里，所以这个启发式判据本来就不覆盖它。
  //    这是判据的**已知边界**（见本节末尾的说明），不是缺陷；
  //    但用它当靶子会得到"判据假绿"的错误结论。
  //    现在改用 `security-scan` —— 它在 run 脚本里真的读文件。
  negativeControl(
    '删除 security-scan 的 checkout',
    () => removeJobCheckout(workflow, 'security-scan'),
    (src) => allRepoReadingJobsCheckout(src),
  );

  // ⑥ Notes 模板不含待定态措辞
  section('⑥ Release Notes 模板不得含待定态措辞');
  const pending = notesHasNoPendingWord(workflow);
  if (pending.pass) {
    ok('模板正文不含「待主人裁决 / 待授权 / 待批准」');
  } else {
    bad(pending.why);
  }
  negativeControl(
    '在模板里注入「待主人裁决」',
    () => {
      // ⚠️ 注入必须用**原始文本**（带块缩进），否则 workflow.indexOf(tpl) = -1
      const tpl = extractNotesTemplateRaw(workflow);
      if (tpl === null) return null;
      const idx = workflow.indexOf(tpl);
      if (idx < 0) return null;
      // ⚠️ 注入点不能锚在某一行的**具体措辞**上。
      //
      //    第一版锚的是 `| **后续仍需单独处置历史问题**` —— 而 v0.0.15 把这行
      //    改名为「保留与披露不等于风险消失」后，`replace` 变成**空操作**，
      //    输入根本没被破坏，判据自然仍判通过 ⇒ 负向对照报「假绿」。
      //    这不是判据失效，而是**对照的靶子随文档改名一起漂了**。
      //    靶子必须锚在**结构**上（模板首行必是主标题），与文案无关。
      const firstLineEnd = tpl.indexOf('\n');
      const broken =
        firstLineEnd < 0
          ? tpl + '\n待主人裁决\n'
          : tpl.slice(0, firstLineEnd) + '\n待主人裁决\n' + tpl.slice(firstLineEnd);
      return workflow.slice(0, idx) + broken + workflow.slice(idx + tpl.length);
    },
    (src) => notesHasNoPendingWord(src),
  );

  // ⑦ 模板保留 CHANGELOG 注入契约
  section('⑦ Release Notes 仍由 CHANGELOG 注入');
  const contract = notesKeepsChangelogContract(workflow);
  if (contract.pass) {
    ok('模板保留 __CHANGELOG_SECTION__ 与「### __VERSION__ 更新内容」');
  } else {
    bad(contract.why);
  }
  negativeControl(
    '删掉 __CHANGELOG_SECTION__ 占位符',
    () => {
      // 同上：注入用原始文本
      const tpl = extractNotesTemplateRaw(workflow);
      if (tpl === null) return null;
      const idx = workflow.indexOf(tpl);
      return (
        workflow.slice(0, idx) +
        tpl.replace('__CHANGELOG_SECTION__', '（此处应有更新内容）') +
        workflow.slice(idx + tpl.length)
      );
    },
    (src) => notesKeepsChangelogContract(src),
  );

  // ⑧ 所有 job 名字清单（供人工核对「是否有 job 被悄悄删掉」）
  section('⑧ job 清单');
  const jobs = splitJobs(workflow) ?? new Map();
  const names = [...jobs.keys()];
  const expected = [
    'resolve-tag',
    'preflight',
    'code-checks',
    'security-scan',
    'unit-tests',
    'e2e-tests',
    'build-image',
    'deploy-verify',
    'package',
    'publish-release',
    'verify-release',
  ];
  const missing = expected.filter((n) => !names.includes(n));
  if (missing.length === 0) {
    ok(`11 个 job 齐全：${names.join(', ')}`);
  } else {
    bad(`缺少 job：${missing.join(', ')}`);
  }
  negativeControl(
    '删掉 verify-release job 的声明行',
    () => workflow.replace('\n  verify-release:\n', '\n  verify-release-removed:\n'),
    (src) => {
      const j = splitJobs(src) ?? new Map();
      const miss = expected.filter((n) => ![...j.keys()].includes(n));
      return miss.length > 0 ? { pass: false, why: `缺 ${miss.join(', ')}` } : { pass: true };
    },
  );

  console.log('\n' + '─'.repeat(70));
  console.log(`静态链路检查：${checks} 项通过，${failures} 项失败`);
  console.log('─'.repeat(70));
  return failures === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// 模式 2：notes（真实渲染 Release Notes，但不创建 Release）
// ---------------------------------------------------------------------------
function runNotes() {
  console.log('═'.repeat(70));
  console.log(`发布预演 · Release Notes 渲染（目标版本 ${VERSION}）`);
  console.log('═'.repeat(70));

  if (!VERSION_RE.test(VERSION)) {
    bad(`版本号非法：'${VERSION}'`);
    return 1;
  }

  const workflow = read('.github/workflows/release.yml');
  const changelog = read('CHANGELOG.md');

  section('① 从 CHANGELOG 抽取目标版本段落');
  const extracted = extractChangelogSection(changelog, VERSION);
  if (!extracted) {
    bad(`CHANGELOG 缺少 ${VERSION} 段落（精确 token 匹配）—— 真发布会在这一步中止`);
    console.log('\n摘要：段落抽取失败，无法渲染 Notes');
    return 1;
  }
  ok(`命中标题：${extracted.heading}`);
  ok(`段落长度：${extracted.section.length} 字符`);

  // 负向：不存在的版本必须抽不到
  if (extractChangelogSection(changelog, 'v9.9.9') !== null) {
    bad('负向：不存在的版本 v9.9.9 竟然抽出了段落 —— 抽取判据失效');
  } else {
    ok('负向：不存在的版本 v9.9.9 抽取为 null');
  }
  // 负向：前缀碰撞（v0.0.1 不得命中 v0.0.14）
  if (extractChangelogSection(changelog, 'v0.0.1') !== null) {
    bad('负向：v0.0.1 命中了 v0.0.14 的段落 —— 精确 token 匹配失效（V13-10 会复发）');
  } else {
    ok('负向：v0.0.1 不会命中 v0.0.14（精确 token 生效）');
  }

  section('② 段落正文可发布性（不得含仓库内部状态措辞）');
  const publishable = notesSectionIsPublishable(extracted.section);
  if (publishable.pass) {
    ok('注入正文无内部状态措辞、无其它版本标题');
  } else {
    bad(publishable.why);
  }
  /*
   * ⚠️ 注入靶子必须锚**结构**，不能锚具体文案。
   *
   * 历史：这里原先写 `replace('### A.', ...)` —— 靶子是早期 CHANGELOG 的
   * 小标题「### A.」。后来本仓的 CHANGELOG 改用中文小标题
   * （`### 修掉的真实现象…` / `### 性能…`），`replace` 找不到目标
   * ⇒ 返回原串（**空操作**）⇒ 输入根本没被破坏 ⇒ 判据照常通过
   * ⇒ 对照报「输入已破坏，判据却仍判通过 —— 该判据是假绿」。
   *
   * 报出来的是**错误结论**：判据本身是好的，坏的是对照没真正注入。
   * 这与 V15-12 / V13-17 完全同类 —— 负向对照必须锚在**结构位置**上，
   * 且必须先确认「注入真的改变了输入」，否则它只会制造噪音。
   */
  negativeControl(
    '在段落正文里注入「当前实际公开版本」',
    () => {
      const firstHeading = extracted.section.search(/^#{2,4}\s/m);
      const at = firstHeading < 0 ? 0 : firstHeading;
      return `${extracted.section.slice(0, at)}当前实际公开版本：v0.0.1\n\n${extracted.section.slice(at)}`;
    },
    (s) => notesSectionIsPublishable(s),
  );

  section('③ 与 release.yml 的抽取规则一致性');
  // 确认 workflow 里仍然是「精确 token + headingVersion」这套逻辑，
  // 否则本预演验证的就不是同一条路径。
  for (const marker of [
    "const versionToken = new RegExp('(?:^|[^0-9])' + esc + '(?![0-9.])')",
    'headingVersion(l) === want',
  ]) {
    if (workflow.includes(marker)) ok(`workflow 保留判据：${marker.slice(0, 50)}…`);
    else bad(`workflow 的抽取判据已变（找不到：${marker.slice(0, 50)}…）—— 预演与真实路径脱节`);
  }

  section('④ 渲染 Notes（用真实模板，但不创建 Release）');
  const tpl = extractNotesTemplate(workflow);
  if (tpl === null) {
    bad('无法抽出模板正文');
    return 1;
  }
  // 把 CHANGELOG 的 ### 降一级为 ####（与 workflow 的 indented 逻辑一致）
  const indented = extracted.section.replace(/^(#{2,4})\s/gm, '#$1 ');

  /*
   * ⚠️ v0.0.17：模板新增两个**形态占位符** `__FORM_SUFFIX__` / `__FORM_NOTICE__`。
   *
   * 它们不能在本地预演里被忽略 —— 否则预演渲染出的标题永远是
   * `## vX.Y.Z — `（后缀为空），而真实流水线会填「稳定版」或「开发预览版」，
   * 预演与真实路径就**脱节**了。这类脱节正是本仓反复记录的
   * 「预演验证的不是同一条路径」。
   *
   * 形态判定必须与 release.yml **同一套规则**：读 docs/STABLE_RELEASES.json。
   */
  let isStable = false;
  try {
    const wl = JSON.parse(read('docs/STABLE_RELEASES.json'));
    isStable = Array.isArray(wl.stable) && wl.stable.includes(VERSION);
  } catch {
    isStable = false;
  }
  const formSuffix = isStable ? ' — 稳定版' : ' — 开发预览版（Pre-release）';
  const formNotice = isStable
    ? '> ✅ **这是正式稳定版（Stable Release）。**'
    : '> ⚠️ **这是早期开发预览版（Pre-release），不是稳定版。**';
  ok(`发布形态判定：${isStable ? '稳定版（白名单已登记）' : 'Pre-release（未登记）'}`);

  const notes = tpl
    .replace(/__CHANGELOG_SECTION__/g, () => indented)
    .replace(/__FORM_SUFFIX__/g, formSuffix)
    .replace(/__FORM_NOTICE__/g, formNotice)
    .replace(/__VERSION__/g, VERSION)
    .replace(/__DIGEST__/g, 'sha256:dryrun-no-image-pushed');

  const leftovers = ['__CHANGELOG_SECTION__', '__VERSION__', '__DIGEST__', '__FORM_SUFFIX__', '__FORM_NOTICE__'].filter((p) =>
    notes.includes(p),
  );
  if (leftovers.length > 0) {
    bad(`渲染后仍有未替换占位符：${leftovers.join(', ')}`);
  } else {
    ok('渲染后无未替换占位符');
  }
  if (notes.includes(`### ${VERSION} 更新内容`)) {
    ok(`标题指向本版本：### ${VERSION} 更新内容`);
  } else {
    bad(`渲染后的 Notes 缺少「### ${VERSION} 更新内容」`);
  }
  // 主标题必须与**形态**一致，不能写死「开发预览版」
  const expectTitle = `## ${VERSION}${formSuffix}`;
  if (notes.includes(expectTitle)) {
    ok(`主标题正确：${expectTitle}`);
  } else {
    bad(`主标题不是 ${VERSION}（期望：${expectTitle}）`);
  }
  // 反向断言：稳定版里不得出现「不是稳定版」
  if (isStable && notes.includes('不是稳定版')) {
    bad('稳定版 Notes 出现「不是稳定版」—— 形态自相矛盾');
  }
  // R-01 披露必须在场（发布说明的核心合规要求）
  for (const marker of ['R-01', 'DEFERRED', '不构成']) {
    if (notes.includes(marker)) ok(`R-01 披露含「${marker}」`);
    else bad(`R-01 披露缺少「${marker}」—— 合规披露不完整`);
  }

  section('⑤ 落盘（作为 CI artifact 证据）');
  const outDir = path.join(ROOT, 'dryrun-out');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'release-notes.md'), notes, 'utf8');
  writeFileSync(
    path.join(outDir, 'changelog-section.md'),
    `<!-- 从 CHANGELOG.md 抽出的 ${VERSION} 段落（原文，未降级） -->\n\n${extracted.section}\n`,
    'utf8',
  );
  ok(`已写入 ${path.relative(ROOT, outDir)}/release-notes.md（${notes.length} 字符）`);
  ok(`已写入 ${path.relative(ROOT, outDir)}/changelog-section.md`);

  console.log('\n' + '─'.repeat(70));
  console.log(`Notes 渲染：${checks} 项通过，${failures} 项失败`);
  console.log('─'.repeat(70));
  return failures === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
let code;
if (mode === 'static') code = runStatic();
else if (mode === 'notes') code = runNotes();
else {
  console.error(`未知的 --mode=${mode}（支持 static / notes）`);
  code = 1;
}
process.exit(code);
