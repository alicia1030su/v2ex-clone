#!/usr/bin/env node
/**
 * 发布授权校验（v0.0.16）
 * ============================================================================
 *
 * ## 这个脚本取代了什么，以及为什么必须取代
 *
 * 上一版的 preflight 授权闸门是这样写的：
 *
 *     for token in 'A3' 'B1' 'R-01'; do
 *       grep -q "$token" "$DECISION" || exit 1
 *     done
 *
 * 它只能证明**这三个字符串出现过**，不能证明「拿到了有效授权」。反例全都真实存在：
 *
 *   · 「本次**不**授权 B1 公开发布」—— 含 `B1`，但意思完全相反；
 *   · 「上一版是 A3 + B1，本版沿用」—— 含 `A3` `B1`，但那是**别的版本**的裁决；
 *   · 「本文档待补，先写 A3/B1 占位」—— 含三个词，一个字都不是裁决；
 *   · 把 `v0.0.15` 的裁决文件复制成 `v0.0.16` —— 文件名对了，内容还是旧的。
 *
 * 所以判据必须是**结构化的字段值**，而不是正文里的关键词。
 * 本脚本只读 `docs/RISK_DECISION_v<版本>.md` 里的
 * `<!-- RISK-DECISION-FIELDS -->` 块中那段 JSON，逐个字段校验语义。
 *
 * ## 用法
 *
 *   node scripts/release/verify-risk-decision.mjs --version v0.0.16
 *   node scripts/release/verify-risk-decision.mjs --version v0.0.16 --file <路径>
 *
 * 退出码：0 = 授权有效；1 = 无授权 / 授权无效（**必须中止发布**）
 *
 * ## 纪律
 *
 * · **不生成、不补齐、不推断**任何字段。缺字段就是无授权。
 * · 本脚本**不修改**任何其它门禁；它只在 preflight 里当一道**额外**的闸门。
 * · 任何「为了让发布通过」而放宽这里的改动，都等同于伪造授权。
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const argv = process.argv.slice(2);

function argOf(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const VERSION_ARG = argOf('--version') ?? `v${readDeployVersion()}`;
const FILE = argOf('--file') ?? path.join(ROOT, 'docs', `RISK_DECISION_${VERSION_ARG}.md`);

function readDeployVersion() {
  try {
    return readFileSync(path.join(ROOT, 'deploy', 'VERSION'), 'utf8').trim();
  } catch {
    return 'unknown';
  }
}

/**
 * 允许的操作：公开授权必须显式覆盖这四项，缺一不可。
 *
 * v0.0.18 P0-1：`create-public-prerelease` 是渠道硬编码。
 * 新裁决统一使用渠道无关的 `create-public-release`；
 * 为兼容**已经落盘、不得回写**的 v0.0.16/v0.0.17 历史裁决，接受旧字段
 * `create-public-prerelease` 或 `create-public-stable-release`。
 * 渠道本身由 RELEASE_CHANNELS.json 独立判定，不靠授权字段推断。
 */
const REQUIRED_ALLOWED = [
  'create-annotated-tag',
  'push-tag',
  'push-ghcr-image',
];
/** 禁止的操作：必须显式列出，防止「只写允许、不写禁止」的宽松裁决 */
const REQUIRED_FORBIDDEN = [
  'rewrite-remote-history',
  'force-push',
  'move-or-delete-existing-tag',
  'change-repository-visibility',
];
/** 看起来像「自动化身份」的主体 —— 机器不能自己授权自己发布 */
const AUTOMATION_TOKENS = ['ai', 'bot', 'assistant', 'automated', 'agent', 'claude', 'gpt', 'llm', 'model', 'script'];

function fail(why) {
  console.error(`  ✗ ${why}`);
  console.error('');
  console.error('  ⇒ 没有有效授权，发布必须中止。');
  console.error('    修复方式只有一种：由项目所有者对本版本单独作出裁决并落盘。');
  console.error('    **不允许**由自动化流程补写一份授权记录。');
  process.exit(1);
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

console.log(`\n=== 发布授权校验（目标版本 ${VERSION_ARG}）===`);
console.log(`  文件：${path.relative(ROOT, FILE) || FILE}`);

if (!existsSync(FILE)) {
  fail(`缺少 ${path.relative(ROOT, FILE)} —— 本版本没有走过公开发布授权流程`);
}

const text = readFileSync(FILE, 'utf8');

// ---------------------------------------------------------------------------
// 1. 抽取结构化字段块
// ---------------------------------------------------------------------------
const MARKER = 'RISK-DECISION-FIELDS';
const markerIdx = text.indexOf(MARKER);
if (markerIdx < 0) {
  fail('文件里没有结构化裁决块（缺少 <!-- RISK-DECISION-FIELDS --> 标记）。' +
    '只有正文描述不算授权 —— 正文里的关键词可能是反向句、引述或占位');
}

const afterMarker = text.slice(markerIdx);
const fence = afterMarker.match(/```json\s*\n([\s\S]*?)```/);
if (!fence) {
  fail('结构化裁决块里找不到 ```json 代码块 —— 无法机器校验');
}

let fields;
try {
  fields = JSON.parse(fence[1]);
} catch (e) {
  fail(`结构化裁决块不是合法 JSON：${e.message}`);
}

// ---------------------------------------------------------------------------
// 2. 逐字段校验（每一条都对应一种真实可发生的「假授权」）
// ---------------------------------------------------------------------------
const problems = [];

const eq = (key, want) => {
  if (fields[key] !== want) {
    problems.push(`字段 ${key} 应为 "${want}"，实际为 ${JSON.stringify(fields[key])}`);
  }
};

// ② schema：防止用一份结构完全不兼容的旧文档冒充
eq('schema', 'v2ex-clone-risk-decision/v1');

// ③ **版本必须与被发布版本一致** —— 防止复用上一版的裁决
if (fields.version !== VERSION_ARG) {
  problems.push(
    `字段 version 为 ${JSON.stringify(fields.version)}，与目标版本 ${VERSION_ARG} 不一致` +
    '（不能把上一版的裁决挪用到本版本）',
  );
}

// ④ 两条决策的**具体编号**（不是「含 A3/B1 三个字」）
eq('decision_a', 'A3');
eq('decision_b', 'B1');

// ⑤ 公开发布权限必须是**布尔 true**（"true" 字符串 / 1 / "yes" 都不算）
if (fields.public_release_authorized !== true) {
  problems.push(
    `字段 public_release_authorized 必须为布尔 true，实际为 ${JSON.stringify(fields.public_release_authorized)}`,
  );
}

// ⑥ 作用域必须**仅限单版本且一次性**（防止「一次授权、长期生效」）
eq('scope', 'single-version');
if (fields.one_time !== true) {
  problems.push(`字段 one_time 必须为布尔 true，实际为 ${JSON.stringify(fields.one_time)}`);
}

// ⑦ R-01 必须仍为 DEFERRED（不允许借发布把风险标成已修复）
eq('r01_status', 'DEFERRED');

// ⑧ 授权主体不能是自动化身份
const by = typeof fields.authorized_by === 'string' ? fields.authorized_by.trim() : '';
if (by.length < 3) {
  problems.push('字段 authorized_by 缺失或过短 —— 授权必须有明确主体');
} else {
  const tokens = by.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hit = tokens.find((t) => AUTOMATION_TOKENS.includes(t));
  if (hit) {
    problems.push(
      `authorized_by = ${JSON.stringify(by)} 含自动化身份词 "${hit}" —— ` +
      '机器不能自己授权自己发布',
    );
  }
}

// ⑨ 裁决日期：必须存在且形如 YYYY-MM-DD，且不是未来日期
const at = typeof fields.authorized_at === 'string' ? fields.authorized_at.trim() : '';
if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) {
  problems.push(`字段 authorized_at 必须形如 YYYY-MM-DD，实际为 ${JSON.stringify(fields.authorized_at)}`);
} else {
  const d = new Date(`${at}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    problems.push(`authorized_at = ${at} 不是合法日期`);
  } else if (d.getTime() > Date.now() + 24 * 3600 * 1000) {
    problems.push(`authorized_at = ${at} 是未来日期 —— 授权的日期不能晚于裁决时刻`);
  }
}

// ⑩ 允许 / 禁止操作清单必须**显式覆盖**关键项
const allowed = Array.isArray(fields.allowed_operations) ? fields.allowed_operations : [];
const forbidden = Array.isArray(fields.forbidden_operations) ? fields.forbidden_operations : [];
for (const op of REQUIRED_ALLOWED) {
  if (!allowed.includes(op)) {
    problems.push(`allowed_operations 缺少 "${op}" —— 授权未覆盖该发布动作`);
  }
}
const hasGenericReleasePermission = allowed.includes('create-public-release');
const hasLegacyReleasePermission =
  allowed.includes('create-public-prerelease') || allowed.includes('create-public-stable-release');
if (!hasGenericReleasePermission && !hasLegacyReleasePermission) {
  problems.push(
    'allowed_operations 缺少 "create-public-release" —— 授权未明确覆盖公开发布动作' +
    '（历史裁决可用 create-public-prerelease 或 create-public-stable-release 兼容）',
  );
}
for (const op of REQUIRED_FORBIDDEN) {
  if (!forbidden.includes(op)) {
    problems.push(`forbidden_operations 缺少 "${op}" —— 禁止项不完整，等于默许`);
  }
}

if (problems.length > 0) {
  console.error('');
  for (const p of problems) console.error(`  ✗ ${p}`);
  fail(`授权字段校验未通过（${problems.length} 项）`);
}

// ---------------------------------------------------------------------------
// 3. 通过
// ---------------------------------------------------------------------------
ok(`schema 合规（v2ex-clone-risk-decision/v1）`);
ok(`版本匹配：${fields.version}`);
ok(`决策 A = ${fields.decision_a}（保留历史 + 强化披露）`);
ok(`决策 B = ${fields.decision_b}（授权公开发布）`);
ok(`公开发布权限：true，作用域 ${fields.scope}，一次性 ${fields.one_time}`);
ok(`R-01 = ${fields.r01_status}（风险未被宣称修复）`);
ok(`授权主体：${fields.authorized_by}，裁决日期：${fields.authorized_at}`);
ok(`允许操作 ${allowed.length} 项 / 禁止操作 ${forbidden.length} 项，关键项齐全`);
console.log('\n  ⇒ 授权有效（仅限本版本）\n');
process.exit(0);
