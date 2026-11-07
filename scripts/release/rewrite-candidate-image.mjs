#!/usr/bin/env node
/**
 * v0.0.9：把候选部署包内的镜像引用改写为候选镜像标签（任务书 §二 模式 B）
 *
 * ## 为什么需要单独一个脚本
 *
 * 候选包必须引用一个**真实存在**的镜像。在正式发布授权之前，
 * GHCR 上并没有 `ghcr.io/alicia1030su/v2ex-clone:v0.0.9` ——
 * 若不���写，用户拿候选包执行 install.sh 会去拉一个**不存在的镜像**，
 * 安装必然失败（这正是 v0.0.8 暴露的老问题）。
 *
 * 因此候选包要把镜像引用改成本地已 build、已 `docker load` 的候选标签，
 * 例如 `v2ex-clone-candidate:v0.0.9`。
 *
 * ## 改写点（4 处，缺一不可）
 *
 * | 文件 | 内容 | 作用 |
 * |---|---|---|
 * | `docker-compose.yml` | `${V2EX_IMAGE:-<默认>}` | compose 的兜底默认值 |
 * | `.env.example`       | `V2EX_IMAGE=<默认>`     | install.sh 首次生成 .env 时的取值 |
 * | `install.sh`         | `DEFAULT_IMAGE="<默认>"` | 脚本内的默认镜像 |
 * | `install.ps1`        | `$DefaultImage = '<默认>'` | Windows 脚本内的默认镜像 |
 *
 * ## 幂等性与安全性
 *
 * · 改写只碰镜像引用，**不动任何其它内容**；
 * · 改写后逐个文件校验目标标签确实出现，否则退出码 1（不让错误往下游流）；
 * · 文件不存在时跳过而不是报错（不同版本的载体集合可能不同）。
 *
 * ## 用法
 *
 *   node scripts/release/rewrite-candidate-image.mjs <stageDir> <imageTag>
 *
 * 退出码：0 = 全部改写成功 / 1 = 有文件未成功改写
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const stageDir = process.argv[2];
const tag = process.argv[3];

if (!stageDir || !tag) {
  console.error('用法: node scripts/release/rewrite-candidate-image.mjs <stageDir> <imageTag>');
  process.exit(1);
}

if (!existsSync(stageDir)) {
  console.error(`候选包暂存目录不存在: ${stageDir}`);
  process.exit(1);
}

/** 镜像标签校验：必须是合法的 tag 形式，禁止注入换行/引号 */
if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]*:[A-Za-z0-9._\-]+$/.test(tag)) {
  console.error(`镜像标签格式非法: ${tag}`);
  process.exit(1);
}

/**
 * 每一项：文件 → 替换函数
 *
 * 替换函数返回 null 表示「该文件不需要改写」（例如本来就没有默认镜像）。
 */
const EDITS = [
  {
    file: 'docker-compose.yml',
    apply: (s) => s.replace(/\$\{V2EX_IMAGE:-[^}]+\}/, `\${V2EX_IMAGE:-${tag}}`),
  },
  {
    file: '.env.example',
    apply: (s) => s.replace(/^(V2EX_IMAGE=).*$/m, `$1${tag}`),
  },
  {
    file: 'install.sh',
    apply: (s) => s.replace(/^(DEFAULT_IMAGE=")[^"]+(")/m, `$1${tag}$2`),
  },
  {
    file: 'install.ps1',
    apply: (s) => s.replace(/(\$DefaultImage\s*=\s*')[^']+(')/m, `$1${tag}$2`),
  },
];

let failed = 0;
const changed = [];

for (const { file, apply } of EDITS) {
  const p = path.join(stageDir, file);
  if (!existsSync(p)) {
    // 载体不存在不是错误（不同版本载体集合可能不同），但要记录。
    console.log(`· ${file} —— 不存在，跳过`);
    continue;
  }
  const before = readFileSync(p, 'utf8');
  const after = apply(before);
  if (after === before) {
    console.log(`· ${file} —— 未找到可替换的镜像引用（请检查载体格式）`);
    failed++;
    continue;
  }
  writeFileSync(p, after, 'utf8');

  // 写后复验：目标标签必须真的出现在文件里
  const verify = readFileSync(p, 'utf8');
  if (!verify.includes(tag)) {
    console.log(`✗ ${file} —— 写后复验失败，目标标签未出现`);
    failed++;
    continue;
  }
  console.log(`✓ ${file} —— 已指向 ${tag}`);
  changed.push(file);
}

if (failed > 0) {
  console.error(`\n✗ ${failed} 个文件的镜像引用改写失败 —— 候选包不可用。`);
  process.exit(1);
}

if (changed.length === 0) {
  console.error('\n✗ 没有任何文件被改写 —— 候选包仍会指向远端不存在的镜像。');
  process.exit(1);
}

console.log(`\n✓ 候选镜像引用改写完成（${changed.length} 个文件）: ${changed.join(', ')}`);
