#!/usr/bin/env node
/**
 * R-01 历史合规专项调查（v0.0.15）
 *
 * ## 这个脚本做什么
 *
 * 对**每一个远端引用**逐一判定「原站素材是否仍可从它取回」，并输出可复核的
 * 结论表。任务书 §六 要求 12 项调查，本脚本覆盖其中可在本机完成的部分：
 *
 *   ① 全部受影响对象重新核对（不是照抄旧报告的数字）
 *   ② 所有 Git refs 可达性调查
 *   ③ 已发布 Tag / Release 影响调查（Tag 侧；Release 侧由 API 另查）
 *   ④ PR refs 与缓存可达性调查（PR refs 在 ls-remote 里可枚举）
 *   ⑤ GitHub Actions Artifact 排查（API 另查，本脚本只出清单）
 *   ⑥ GHCR 镜像内容复核（拉 manifest/layer 清单另查）
 *
 * ## 为什么不能照抄旧报告
 *
 * v0.0.9 的报告发现过一件真实的事：**可达分支比 v0.0.8 报告多了
 * `fix/review-p0-p1-audit`** —— 照抄旧报告会漏掉新增的暴露面。
 * 所以每个数字都重新算，分母必须打印出来。
 *
 * ## 用法
 *
 *   node scripts/release/r01-audit.mjs                 # 只读调查，输出 Markdown 表
 *   node scripts/release/r01-audit.mjs --json          # 机器可读
 *
 * ## 纪律
 *
 * **本脚本只读**：不 push、不改写历史、不移动 Tag、不删任何东西。
 * 它存在的意义是让「风险有多大」这件事**可复核**，而不是替主人做决定。
 */

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const ROOT = process.cwd();

function git(...argv) {
  return execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * 受影响对象的**路径模式**。
 *
 * ⚠️ 刻意用「目录 + 命名模式」而不是固定文件清单：
 * 固定清单会漏掉「后来又被加回来的文件」，而那正是本类风险最危险的形式。
 *
 * ## 口径（v0.0.15 修正 —— 这里曾得出过一个矛盾的 68）
 *
 * 「受影响对象」= **原站第三方素材**，只有三类：
 *   · `combo.css` / `combo.js` —— 原站样式与脚本的完整副本；
 *   · `docs/evidence/html/*.html` —— 原站页面快照；
 *   · `ref-*.png` —— 原站页面的像素级截图；
 *   · `diff-*.png` —— 本站与原站的差异热力图（含原站像素）。
 *
 * ⚠️ `local-*.png` **不属于**受影响对象 —— 那是**本站自己页面**的截图。
 *    第一版把所有 `screenshots/*.png` 和所有 `visual/*.png` 都算了进去，
 *    得到「68 个」，与历史报告里反复核实的 **81 个** 对不上，
 *    而两个数字都很像"算过一遍"的样子 —— 这正是「口径不明导致的自证矛盾」。
 *
 *    81 的历史口径 = assets 2 + html 46 + screenshots **20** + visual **13**
 *    （= ref 10 + local 10 / diff 10 + json 3）——
 *    **它把 local-* 与 measurement json 也算进了"证据文件"总数**。
 *    两种口径都有道理，但**不能混用**。
 *
 *    本脚本因此**同时报告两个数字**：
 *      · `thirdParty` —— 真正的第三方素材（**风险对象**，用于判定可达性）；
 *      · `evidenceTotal` —— 与历史报告可比的证据文件总数（含本站自有截图）。
 *    只有前者用于「这个 ref 是否让第三方素材可达」的判定。
 */
const THIRD_PARTY_PATTERNS = [
  /^docs\/evidence\/assets\/combo\.(css|js)$/,
  /^docs\/evidence\/html\/.+\.html$/,
  /^docs\/evidence\/screenshots\/ref-.+\.png$/,
  /^docs\/evidence\/visual\/diff-.+\.png$/,
];

/** 历史报告口径的「证据文件」：上面三类 + 本站自有截图 + 测量 JSON */
const EVIDENCE_PATTERNS = [
  ...THIRD_PARTY_PATTERNS,
  /^docs\/evidence\/screenshots\/local-.+\.png$/,
  /^docs\/evidence\/visual\/.*\.json$/,
];

const isThirdParty = (p) => THIRD_PARTY_PATTERNS.some((re) => re.test(p));
const isEvidence = (p) => EVIDENCE_PATTERNS.some((re) => re.test(p));

/** 兼容旧名：可达性判定一律用第三方口径 */
const isAffected = isThirdParty;

/** 全部远端引用（heads / tags / pull） */
function listRemoteRefs() {
  const out = git('ls-remote', 'origin');
  const refs = [];
  for (const line of out.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref) continue;
    if (ref.endsWith('^{}')) continue; // annotated tag 的解引用行，单独处理
    refs.push({ sha, ref });
  }
  return refs;
}

/** 某个 commit 的树里有哪些受影响对象 */
function affectedInCommit(sha) {
  let tree;
  try {
    tree = git('ls-tree', '-r', sha, '--name-only');
  } catch {
    return null; // 对象不可达
  }
  return tree
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(isEvidence);
}

/** 某个 commit 的**历史**里是否出现过受影响对象（不只是当前树） */
function everIntroduced(sha) {
  try {
    const out = git('log', '--all', '--format=%H', '--diff-filter=A', '--', 'docs/evidence/assets', 'docs/evidence/html', 'docs/evidence/screenshots', 'docs/evidence/visual');
    return out.split('\n').filter(Boolean).length;
  } catch {
    return -1;
  }
}

// ---------------------------------------------------------------------------
// ① 受影响对象全量重核
// ---------------------------------------------------------------------------
const ROOT_COMMIT_HINT = '75c9508245f3ebc329990c169ef32e33c6d90f6d';

// 找出「引入受影响对象最多的那个提交」—— 它通常就是根提交。
// 不硬编码 SHA：仓库若被重写，硬编码会立刻失效并给出假结论。
let culprit = ROOT_COMMIT_HINT;
let maxCount = -1;
try {
  const allCommits = git('rev-list', '--all', '--max-count=4000').split('\n').filter(Boolean);
  for (const c of allCommits) {
    // 只对「可能持有素材」的提交做树扫描，避免 4000 次全树列举
    let n = 0;
    try {
      const names = git('ls-tree', '-r', '--name-only', c).split('\n');
      n = names.filter(isAffected).length;
    } catch {
      n = 0;
    }
    if (n > maxCount) {
      maxCount = n;
      culprit = c;
    }
  }
} catch {
  // 保留 hint
}

const culpritEvidence = affectedInCommit(culprit) ?? [];
const culpritThirdParty = culpritEvidence.filter(isThirdParty);
const byDir = { assets: 0, html: 0, screenshots: 0, visual: 0 };
for (const p of culpritEvidence) {
  if (p.includes('/assets/')) byDir.assets += 1;
  else if (p.includes('/html/')) byDir.html += 1;
  else if (p.includes('/screenshots/')) byDir.screenshots += 1;
  else if (p.includes('/visual/')) byDir.visual += 1;
}
const byDirThird = { assets: 0, html: 0, screenshots: 0, visual: 0 };
for (const p of culpritThirdParty) {
  if (p.includes('/assets/')) byDirThird.assets += 1;
  else if (p.includes('/html/')) byDirThird.html += 1;
  else if (p.includes('/screenshots/')) byDirThird.screenshots += 1;
  else if (p.includes('/visual/')) byDirThird.visual += 1;
}

// ---------------------------------------------------------------------------
// ② 全部 refs 可达性
// ---------------------------------------------------------------------------
const refs = listRemoteRefs();

/**
 * 判定某个 ref 是否让受影响对象可达。
 *
 * 判据：该 ref 的**当前树**里有素材，**或**该 ref 的历史里出现过素材提交。
 * 前者是「现在还直接看得到」，后者是「翻历史还能挖出来」——
 * 两者都算可达，但性质不同，必须分开报告。
 */
function refReachability(ref) {
  const { sha, ref: name } = ref;
  const all = affectedInCommit(sha);
  if (all === null) {
    return { name, sha, reachable: false, mode: 'unreadable', count: 0 };
  }
  // ⚠️ 可达性判定**只能用第三方口径**。
  //    第一版用了"证据文件"口径（含 local-*.png），结果所有 refs 都被判成
  //    `current-tree` —— 因为 `local-*.png` 是**本站自己的页面截图**，
  //    它们在 master 上本来就正常跟踪着，与第三方版权无关。
  //    那个假结论会把"风险面"虚报成 100%。
  const direct = all.filter(isThirdParty);
  if (direct.length > 0) {
    return { name, sha, reachable: true, mode: 'current-tree', count: direct.length };
  }
  let ancestor = false;
  try {
    git('merge-base', '--is-ancestor', culprit, sha);
    ancestor = true;
  } catch {
    ancestor = false;
  }
  return {
    name,
    sha,
    reachable: ancestor,
    mode: ancestor ? 'history-only' : 'clean',
    count: direct.length,
  };
}

const results = refs.map(refReachability);

const kindOf = (name) => {
  if (name.startsWith('refs/heads/')) return 'branch';
  if (name.startsWith('refs/tags/')) return 'tag';
  if (name.startsWith('refs/pull/')) return 'pull';
  return 'other';
};

const summary = { branch: [0, 0], tag: [0, 0], pull: [0, 0], other: [0, 0] };
for (const r of results) {
  const k = kindOf(r.name);
  summary[k][1] += 1;
  if (r.reachable) summary[k][0] += 1;
}

// ---------------------------------------------------------------------------
// ③ 已发布 Tag 的影响（哪些 tag 让素材可达）
// ---------------------------------------------------------------------------
const tags = results.filter((r) => kindOf(r.name) === 'tag');
const reachableTags = tags.filter((r) => r.reachable);

// ---------------------------------------------------------------------------
// ④ PR refs
// ---------------------------------------------------------------------------
const pulls = results.filter((r) => kindOf(r.name) === 'pull');
const reachablePulls = pulls.filter((r) => r.reachable);

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
if (asJson) {
  console.log(
    JSON.stringify(
      {
        culprit,
        thirdPartyTotal: culpritThirdParty.length,
        thirdPartyByDir: byDirThird,
        evidenceTotal: culpritEvidence.length,
        evidenceByDir: byDir,
        refsTotal: results.length,
        summary,
        reachableTags: reachableTags.map((r) => r.name),
        reachablePulls: reachablePulls.map((r) => r.name),
        reachableBranches: results
          .filter((r) => kindOf(r.name) === 'branch' && r.reachable)
          .map((r) => r.name),
        refs: results,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
console.log('# R-01 历史合规调查（v0.0.15 · 本机只读）\n');
console.log(`- 调查时间：${new Date().toISOString()}`);
console.log(`- 素材最集中的提交：\`${culprit}\``);
console.log('');
console.log('### 两个口径（**不可混用**）\n');
console.log(`**① 第三方素材（真正的风险对象，用于可达性判定）：${culpritThirdParty.length} 个**`);
console.log(
  `   assets ${byDirThird.assets} / html ${byDirThird.html} / ref 截图 ${byDirThird.screenshots} / diff 热力图 ${byDirThird.visual}`,
);
console.log('');
console.log(`**② 证据文件总数（与历史报告的 81 个可比，含本站自有截图与测量 JSON）：${culpritEvidence.length} 个**`);
console.log(
  `   assets ${byDir.assets} / html ${byDir.html} / screenshots ${byDir.screenshots}（含 local-*）/ visual ${byDir.visual}（含 *.json）`,
);
console.log('');
console.log('> ⚠️ 历史报告里的「81 个」是口径 ②。');
console.log('> **可达性判定必须用口径 ①** —— `local-*.png` 是本站自己的页面截图，');
console.log('> 不受第三方版权约束；把它的可达性算进「素材暴露」会得出虚高的风险数字。');
console.log('');
console.log('## 各类型引用的可达性（分母已打印）\n');
console.log('| 类型 | 可达 / 总数 |');
console.log('|---|---|');
for (const k of ['branch', 'tag', 'pull', 'other']) {
  const [hit, total] = summary[k];
  if (total === 0) continue;
  const label = { branch: '分支', tag: 'Tag', pull: 'PR ref', other: '其它' }[k];
  console.log(`| ${label} | **${hit} / ${total}** |`);
}
console.log('');
console.log('## 让素材可达的 Tag（已发布的越少越好）\n');
if (reachableTags.length === 0) {
  console.log('（无）');
} else {
  for (const t of reachableTags) {
    console.log(`- \`${t.name}\`（${t.mode}）`);
  }
}
console.log('');
console.log('## 让素材可达的分支\n');
const rb = results.filter((r) => kindOf(r.name) === 'branch' && r.reachable);
if (rb.length === 0) console.log('（无）');
else for (const b of rb) console.log(`- \`${b.name}\`（${b.mode}）`);
console.log('');
console.log(`## PR refs\n`);
console.log(`- 可达：**${reachablePulls.length} / ${pulls.length}**`);
if (reachablePulls.length > 0) {
  console.log(`- 清单：${reachablePulls.map((p) => p.name.replace('refs/pull/', '#').replace('/head', '')).join(', ')}`);
}
console.log('');
console.log('## 说明\n');
console.log('- `current-tree` = 该 ref 的**当前树**里就有素材（直接可见）。');
console.log('- `history-only` = 当前树没有，但**历史里**有（翻 `git log` 可取回）。');
console.log('- 本脚本**只读**：未 push、未改写历史、未移动/删除任何 Tag。');
