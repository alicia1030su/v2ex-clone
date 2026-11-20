#!/usr/bin/env node
/**
 * Git 暂存安全策略（v0.0.18 P0-2）
 *
 * 唯一判据实现：safe-stage.mjs 与 pre-commit hook 都调用本脚本。
 *
 * 规则：
 *   · 拒绝无差别暂存：-A / --all / . / 目录 / glob；
 *   · 拒绝提交信息草稿：.m / .msg / .msg2 / .cm / .commitmsg；
 *   · 拒绝敏感文件：.env（示例除外）、私钥、INSTALL_CREDENTIALS.txt、backups/；
 *   · 只检查**暂存区新增行**，避免历史内容/示例造成误伤；
 *   · 任一违规 => 非零退出，并打印具体文件与原因。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DENY_NAMES = new Set([
  '.m', '.msg', '.msg2', '.cm', '.commitmsg',
  '.env', '.env.local', '.env.production', '.env.development',
  'INSTALL_CREDENTIALS.txt', 'id_rsa', 'id_ed25519',
]);
const DENY_PARTS = new Set(['backups', '.git', 'node_modules']);
const SECRET_LINE = /(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{16,}/i;

export function inspectPaths(paths) {
  const errors = [];
  for (const rel of paths) {
    const normalized = rel.replace(/\\/g, '/');
    const base = path.posix.basename(normalized);
    const parts = normalized.split('/');
    if (DENY_NAMES.has(base)) {
      errors.push(`${normalized}: 禁止提交信息草稿或敏感文件名 ${base}`);
      continue;
    }
    if (parts.some((p) => DENY_PARTS.has(p))) {
      errors.push(`${normalized}: 禁止提交运行时/敏感目录 ${parts.find((p) => DENY_PARTS.has(p))}`);
      continue;
    }
    if (/\.(pem|key|p12|pfx)$/i.test(base)) {
      errors.push(`${normalized}: 禁止提交私钥/证书文件`);
      continue;
    }
  }
  return errors;
}

export function stagedFiles() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

export function treeFiles(ref) {
  const out = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', ref], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

export function stagedAddedLines(file) {
  const out = execFileSync('git', ['diff', '--cached', '--unified=0', '--', file], { encoding: 'utf8' });
  return out.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
}

export function checkStaged() {
  const files = stagedFiles();
  const errors = inspectPaths(files);
  for (const file of files) {
    if (errors.some((e) => e.startsWith(`${file}:`))) continue;
    const bad = stagedAddedLines(file).find((l) => SECRET_LINE.test(l));
    if (bad) errors.push(`${file}: 暂存新增行疑似明文凭据：${bad.slice(0, 120)}`);
  }
  return { files, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === '--tree') {
    const files = treeFiles(args[1]);
    const errors = inspectPaths(files);
    if (errors.length) {
      for (const e of errors) console.error(`✗ ${e}`);
      process.exit(1);
    }
    console.log(`✓ 提交树路径安全（${args[1]}，${files.length} 个文件；内容扫描仅覆盖暂存新增行）`);
    process.exit(0);
  }
  if (args.length !== 0) {
    console.error('用法：node scripts/git/check-staged-files.mjs [--tree <git-ref>]');
    process.exit(2);
  }
  const { files, errors } = checkStaged();
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    process.exit(1);
  }
  console.log(`✓ 暂存区安全（${files.length} 个文件）`);
}
