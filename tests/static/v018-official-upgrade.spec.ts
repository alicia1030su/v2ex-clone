import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * v0.0.18 官方公开资产升级验收护栏。
 *
 * 真实缺陷：Release Notes 曾让用户进入“新解压的 v0.0.18 目录”执行
 * ./update.sh，但 update.sh 正确要求现有 .env；新目录没有 .env，必然拒绝。
 * 本 spec 同时锁住文档、渲染闸门、验收脚本与独立工作流，并做注入式负向对照。
 */
const ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE = path.join(ROOT, '.github', 'release-notes-template.md');
const RENDERER = path.join(ROOT, 'scripts', 'release', 'render-release-notes.mjs');
const UPGRADE_SCRIPT = path.join(ROOT, 'scripts', 'release', 'verify-official-upgrade.sh');
const UPGRADE_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'official-upgrade.yml');

function read(rel: string) {
  return readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

function runRenderer(cwd: string) {
  try {
    const out = execFileSync(process.execPath, [RENDERER], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        VERSION: 'v0.0.18',
        PRERELEASE: 'false',
        IMAGE_DIGEST_TEXT: 'sha256:test',
        OUTPUT: 'release-notes.md',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('v0.0.18 升级文档真实性', () => {
  it('Release Notes 必须在现有安装目录备份并带 --version 升级', () => {
    const template = read('.github/release-notes-template.md');
    expect(template).toContain('在**现有安装目录**执行');
    expect(template).toContain('cd <你现有的 V2EX Clone 部署目录>');
    expect(template).toContain('./backup.sh');
    expect(template).toContain('./update.sh --version __VERSION__');
    expect(template).not.toContain('cd v2ex-clone-__VERSION__-deploy/deploy\n./update.sh');
  });

  it('包内 INSTALL.md 不得把升级命令写成无 --version 的旧写法', () => {
    const install = read('deploy/INSTALL.md');
    expect(install).toContain('在**现有安装目录**执行');
    expect(install).toContain('./update.sh --version <目标版本>');
    expect(install).toContain('新目录没有现有 `.env`');
  });

  it('README 的 v0.0.18 升级入口与包内文档一致', () => {
    const readme = read('README.md');
    expect(readme).toContain('**v0.0.4 → v0.0.18** 与 **v0.0.17 → v0.0.18**');
    expect(readme).toContain('./update.sh --version v0.0.18');
    expect(readme).toContain('那里没有现有 `.env`');
  });

  it('真实渲染器接受正确升级命令', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'v018-notes-ok-'));
    try {
      cpSync(path.join(ROOT, 'CHANGELOG.md'), path.join(dir, 'CHANGELOG.md'));
      mkdirSync(path.join(dir, '.github'));
      cpSync(TEMPLATE, path.join(dir, '.github', 'release-notes-template.md'));
      const result = runRenderer(dir);
      expect(result.code, result.out).toBe(0);
      expect(readFileSync(path.join(dir, 'release-notes.md'), 'utf8'))
        .toContain('./update.sh --version v0.0.18');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('负向：把模板改回新解压目录旧命令，渲染器必须判红', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'v018-notes-bad-'));
    try {
      cpSync(path.join(ROOT, 'CHANGELOG.md'), path.join(dir, 'CHANGELOG.md'));
      mkdirSync(path.join(dir, '.github'));
      const good = readFileSync(TEMPLATE, 'utf8');
      const broken = good
        .replace('在**现有安装目录**执行；新解压的发行包没有 `.env`', '官方升级基线以 CI 为准')
        .replace('cd <你现有的 V2EX Clone 部署目录>', 'cd v2ex-clone-__VERSION__-deploy/deploy')
        .replace('./update.sh --version __VERSION__', './update.sh');
      expect(broken).not.toBe(good);
      writeFileSync(path.join(dir, '.github', 'release-notes-template.md'), broken);
      const result = runRenderer(dir);
      expect(result.code, result.out).not.toBe(0);
      expect(result.out).toContain('Release Notes 升级路径不符');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('v0.0.18 官方资产升级工作流', () => {
  it('升级脚本通过真实 bash 语法检查', () => {
    expect(() => execFileSync('bash', ['-n', UPGRADE_SCRIPT], { stdio: 'pipe' })).not.toThrow();
  });

  it('脚本必须匿名下载双版本正式资产并校验 SHA256', () => {
    const script = read('scripts/release/verify-official-upgrade.sh');
    expect(script).toContain('releases/download/${version}');
    expect(script).toContain('sha256sum -c SHA256SUMS');
    expect(script).toContain('download_release "$FROM_VERSION"');
    expect(script).toContain('download_release "$TO_VERSION"');
    expect(script).not.toContain('docker login');
    expect(script).not.toContain('GH_TOKEN');
    expect(script).not.toContain('rm -rf');
    expect(script).toContain('WORK 必须是全新的空目录');
    expect(script).toContain('非法 REPO');
  });

  it('必须用旧版官方 install.sh 与包内 update.sh 做真实容器升级', () => {
    const script = read('scripts/release/verify-official-upgrade.sh');
    expect(script).toContain('./install.sh');
    expect(script).toContain('./update.sh --version "$TO_VERSION"');
    expect(script).toContain('fingerprint-before.txt');
    expect(script).toContain('fingerprint-after.txt');
    expect(script).toContain('diff -u "$WORK/fingerprint-before.txt" "$WORK/fingerprint-after.txt"');
    expect(script).toContain('docker inspect --format');
  });

  it('独立工作流只手动触发、只读权限、匿名资产验收', () => {
    const workflow = read('.github/workflows/official-upgrade.yml');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('verify-official-upgrade.sh');
    expect(workflow).toContain('FROM_VERSION: ${{ inputs.from_version }}');
    expect(workflow).toContain('TO_VERSION: ${{ inputs.to_version }}');
    expect(workflow).toContain('--from "$FROM_VERSION"');
    expect(workflow).toContain('--to "$TO_VERSION"');
    expect(workflow).not.toContain('--from "${{ inputs.from_version }}"');
    expect(workflow).toContain('WORK: /tmp/official-upgrade-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(workflow).not.toContain('docker login');
    expect(workflow).not.toContain('GHCR_USERNAME');
  });
});
