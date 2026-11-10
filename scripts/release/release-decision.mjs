#!/usr/bin/env node
/**
 * 发布决策判定（只读）
 * ============================================================================
 *
 * 这个脚本回答**一个**问题：给定「目标版本」，当前应该走哪条发布路径？
 *
 *   create   —— Tag 与 Release 都不存在 ⇒ 全新发布
 *   resume   —— Tag 已存在、Release 不存在 ⇒ **上次发布中断**，走幂等恢复
 *   refuse   —— Tag 与 Release 都存在 ⇒ 拒绝覆盖（已发布的不得重发）
 *   (error)  —— Tag 不存在但 Release 存在 ⇒ 状态不可能，按 fail-closed 报错
 *
 * ---------------------------------------------------------------------------
 * ## 为什么要有这个脚本（v0.0.15 P0-3 的真实教训）
 *
 * 第一版预演里写的是「**目标版本必须没有 Release**，否则判红」。
 * 它每次都会红 —— 而且红得**看起来像链路有故障**：
 *
 *   v0.0.14 首次正式发布时，流水线在镜像已推送、部署验证通过之后，
 *   因为 publish-release 缺 checkout 而失败，Release 没建出来。
 *   于是 Tag 存在、Release 不存在。这正是 `resume` 场景。
 *
 *   而开发态里 `package.json` 的版本按 G-VER-01 **刻意**停留在
 *   上一个**已发布**版本（0.0.14 已发布）。用「必须没有 Release」去判，
 *   这个检查在开发态**永远不可能通过** —— 它把「版本载体还没同步」
 *   这个**正常的开发态事实**，报成了「发布链路故障」。
 *
 * 一个在正常开发态必然变红的检查，只会让人把它删掉或改松。
 * 真正的不变量是「**决策必须与观测到的状态一致**」，
 * 而不是「状态必须是我期望的那一种」。
 *
 * ## 为什么三种路径都必须被真的跑到
 *
 * `refuse` 是唯一会「拦住」的路径。只测它「能拦住」是不够的 ——
 * 一个永远返回 refuse 的实现同样能通过。必须同时证明：
 *   · 全新版本 ⇒ create（不误拦）
 *   · Tag 有 / Release 无 ⇒ resume（能续上，不是从头再来）
 *   · 两者都有 ⇒ refuse（不覆盖）
 * 三条同时成立，判据才有意义。
 */

import { execFileSync } from 'node:child_process';

/** 纯函数：只吃状态，不碰网络。这样它可以在离线环境下被穷举验证。 */
export function decidePath({ tagExists, releaseExists }) {
  if (tagExists && releaseExists) return 'refuse';
  if (tagExists && !releaseExists) return 'resume';
  if (!tagExists && releaseExists) return 'inconsistent';
  return 'create';
}

const LABEL = {
  create: '全新发布（Tag 与 Release 均不存在）',
  resume: '幂等恢复（Tag 已存在、Release 不存在 —— 上次发布中断）',
  refuse: '拒绝覆盖（Tag 与 Release 均已存在）',
  inconsistent: '状态不可能（Release 存在但 Tag 不存在）',
};

// ---------------------------------------------------------------------------
// 自测：穷举 4 种状态组合，断言决策表
//
// ⚠️ 这不是「对实现的复述」。每条断言都写「为什么它必须是这个值」，
//    改实现而没同步改语义时，这里会先红。
// ---------------------------------------------------------------------------
const TRUTH_TABLE = [
  {
    state: { tagExists: false, releaseExists: false },
    expect: 'create',
    why: '什么都没发过 ⇒ 必须允许新建，不能误拦（否则版本永远发不出去）',
  },
  {
    state: { tagExists: true, releaseExists: false },
    expect: 'resume',
    why:
      'Tag 推了但 Release 没建成 ⇒ 必须能续上。' +
      'v0.0.14 首次发布就死在这个状态（publish-release 缺 checkout），' +
      '若判成 create 会重复建 Tag（不可移动），判成 refuse 则版本永久卡死',
  },
  {
    state: { tagExists: true, releaseExists: true },
    expect: 'refuse',
    why: '已发布 ⇒ 不得覆盖（覆盖已发布 Release 属不可逆操作）',
  },
  {
    state: { tagExists: false, releaseExists: true },
    expect: 'inconsistent',
    why: 'Release 依附于 Tag 存在；此状态不可能，必须 fail-closed 而不是猜',
  },
];

function selftest() {
  let fail = 0;
  console.log('=== 发布决策判据自测（穷举 4 种状态）===\n');
  for (const row of TRUTH_TABLE) {
    const got = decidePath(row.state);
    const ok = got === row.expect;
    const s = `tag=${row.state.tagExists ? '有' : '无'} release=${row.state.releaseExists ? '有' : '无'}`;
    console.log(`${ok ? '✓' : '✗'} ${s.padEnd(30)} ⇒ ${got}${ok ? '' : `（应为 ${row.expect}）`}`);
    if (!ok) {
      console.log(`    理由：${row.why}`);
      fail += 1;
    }
  }
  console.log('');
  if (fail > 0) {
    console.log(`✗ 决策表有 ${fail} 处与语义不符`);
    process.exit(1);
  }
  // 反向断言：一个「永远 refuse」的实现必须过不了这张表
  const alwaysRefuse = (s) => (s.tagExists || s.releaseExists ? 'refuse' : 'refuse');
  const trivialPasses = TRUTH_TABLE.every((r) => alwaysRefuse(r.state) === r.expect);
  if (trivialPasses) {
    console.log('✗ 存在平凡实现（恒返回 refuse）也能通过本表 —— 判据无效');
    process.exit(1);
  }
  console.log('✓ 决策表 4/4 通过，且平凡实现（恒 refuse）不能通过');
}

// ---------------------------------------------------------------------------
// 只读探测：用真实 API 取状态，再交给纯函数判定
// ---------------------------------------------------------------------------
function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function probeLive(repo, version) {
  // Tag：用 ls-remote 而不是 API 列表 —— 后者分页，版本多了会漏
  let tagExists = false;
  try {
    const out = gh(['api', `repos/${repo}/git/ref/tags/${version}`]);
    tagExists = out.trim().length > 0;
  } catch {
    tagExists = false;
  }

  // Release：必须用**列表**接口 —— 按 tag 查询的端点读不到 draft
  let releaseExists = false;
  let releaseMeta = null;
  try {
    const raw = gh(['api', `repos/${repo}/releases?per_page=100`]);
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('Release 列表不是数组');
    const hit = list.find((r) => r.tag_name === version);
    if (hit) {
      releaseExists = true;
      releaseMeta = { id: hit.id, draft: hit.draft, prerelease: hit.prerelease };
    }
  } catch (e) {
    // fail-closed：查不到不等于「不存在」
    console.error(`::error::查询 Release 列表失败（${e.message}）—— 无法判定冲突，按 fail-closed 中止`);
    process.exit(1);
  }

  return { tagExists, releaseExists, releaseMeta };
}

function main() {
  const argv = process.argv.slice(2);
  const get = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (argv.includes('--selftest')) {
    selftest();
    return;
  }

  const repo = get('repo') ?? process.env.REPO;
  const version = get('version') ?? process.env.INPUT_VERSION;
  const expect = get('expect');

  if (!repo || !version) {
    console.error('用法：release-decision.mjs --repo <owner/name> --version vX.Y.Z [--expect create|resume|refuse]');
    console.error('      release-decision.mjs --selftest');
    process.exit(2);
  }

  const state = probeLive(repo, version);
  const decision = decidePath(state);

  console.log('=== 发布路径判定（只读，不创建任何东西）===\n');
  console.log(`  目标版本   : ${version}`);
  console.log(`  Tag        : ${state.tagExists ? '存在' : '不存在'}`);
  console.log(`  Release    : ${state.releaseExists ? '存在' : '不存在'}`);
  if (state.releaseMeta) {
    console.log(
      `  Release 元数据: id=${state.releaseMeta.id} draft=${state.releaseMeta.draft} prerelease=${state.releaseMeta.prerelease}`,
    );
  }
  console.log(`  ⇒ 决策     : **${decision}** —— ${LABEL[decision]}`);
  console.log('');

  if (decision === 'inconsistent') {
    console.log('::error::Release 存在但 Tag 不存在 —— 这是不可能的状态，必须人工核查');
    process.exit(1);
  }

  if (expect) {
    if (decision !== expect) {
      console.log(`::error::期望决策为 "${expect}"，实际为 "${decision}" —— 判据未按预期工作`);
      process.exit(1);
    }
    console.log(`✓ 决策与期望一致（"${expect}"）`);
    return;
  }

  // 无 --expect 时：只要求「决策自洽」，不要求「必须是某一种」。
  //
  // 这是本脚本存在的核心：开发态里版本载体停在上一个**已发布**版本，
  // 此时正确决策就是 refuse —— 那是**正确**的，不是故障。
  // 报红会让这个检查在正常开发态永远红，最后被人删掉或改松。
  console.log(`✓ 决策自洽（${version} ⇒ ${decision}）`);
  if (decision === 'refuse') {
    console.log('');
    console.log('  说明：该版本**已经发布**，因此正确决策是「拒绝覆盖」。');
    console.log('        这不是失败 —— 它证明冲突判据生效。');
    console.log('        若要演练「全新发布」路径，请用 --version 指定一个尚未发布的版本。');
  }
  if (decision === 'resume') {
    console.log('');
    console.log('  说明：该版本 Tag 已存在但 Release 缺失，正确决策是「幂等恢复」');
    console.log('        （v0.0.14 首次发布中断时就是这个状态）。');
  }
}

if (process.argv[1] && process.argv[1].endsWith('release-decision.mjs')) {
  main();
}
