#!/usr/bin/env node
/**
 * 安全暂存（v0.0.18 P0-2）
 *
 * 用法：
 *   node scripts/git/safe-stage.mjs <显式文件...>
 *
 * 刻意不支持：
 *   -A / --all / . / 目录 / glob
 *
 * 原因：v0.0.17 三次 `git add -A` 把提交信息草稿 .m/.msg2/.cm 带进仓库。
 * “记得不要用”不是治理；工具拒绝 + hook 复核才是。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { inspectPaths } from './check-staged-files.mjs';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法：node scripts/git/safe-stage.mjs <显式文件...>');
  process.exit(2);
}
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const relative = args.map((arg) => {
  if (arg === '-A' || arg === '--all' || arg === '.') {
    console.error(`✗ 拒绝无差别暂存：${arg}。请逐个列出文件。`);
    process.exit(1);
  }
  const absolute = path.resolve(root, arg);
  const rel = path.relative(root, absolute).split(path.sep).join('/');
  if (!rel || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) {
    console.error(`✗ 文件不在仓库内：${arg}`);
    process.exit(1);
  }
  const literalExists = existsSync(absolute);
  if (literalExists && statSync(absolute).isDirectory()) {
    console.error(`✗ 拒绝暂存目录：${arg}。请逐个列出文件。`);
    process.exit(1);
  }
  if (!literalExists) {
    let tracked = false;
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: root, stdio: 'ignore' });
      tracked = true;
    } catch { /* 不存在且未跟踪 */ }
    // Next.js 动态路由文件名本身含 [id] / [...slug]；真实存在或已跟踪删除的
    // 字面路径必须允许。路径不存在、未跟踪且含通配符时才按 glob 拒绝。
    if (!tracked && /[*?\[\]]/.test(arg)) {
      console.error(`✗ 拒绝无差别暂存：${arg}。请逐个列出文件。`);
      process.exit(1);
    }
    if (!tracked) {
      console.error(`✗ 文件不存在或未被 Git 跟踪：${arg}`);
      process.exit(1);
    }
  }
  return rel;
});
const policyErrors = inspectPaths(relative);
if (policyErrors.length) {
  for (const e of policyErrors) console.error(`✗ ${e}`);
  process.exit(1);
}
// 先让 Git 自己验证 pathspec / 忽略规则，再真正改索引；失败时不产生部分暂存。
execFileSync('git', ['add', '--dry-run', '--', ...relative], { cwd: root, stdio: 'inherit' });
execFileSync('git', ['add', '--', ...relative], { cwd: root, stdio: 'inherit' });
console.log(`✓ 已安全暂存 ${relative.length} 个文件：`);
for (const rel of relative) console.log(`  ${rel}`);
