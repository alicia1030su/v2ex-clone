import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * v0.0.18 P0-1：发布渠道单一事实来源
 *
 * 真实缺陷：v0.0.17 把「0.0.x 一律 Pre-release」复制到 8 处，
 * 改清单后产出侧与判据侧漂移，造成 8 次真实发布失败。
 * 本 spec 直接执行解析器，验证默认值、精确映射、迁移冲突与接线。
 */
const ROOT = path.resolve(__dirname, '..', '..');
const RESOLVER = path.join(ROOT, 'scripts/release/resolve-release-channel.mjs');

function run(cwd: string, version: string) {
  try {
    const out = execFileSync(process.execPath, [RESOLVER, '--version', version, '--format', 'json'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out, data: JSON.parse(out) };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}`, data: null };
  }
}

function tempRepo(manifest: unknown, legacy: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), 'v018-channel-'));
  mkdirSync(path.join(dir, 'docs'));
  writeFileSync(path.join(dir, 'docs/RELEASE_CHANNELS.json'), JSON.stringify(manifest));
  writeFileSync(path.join(dir, 'docs/STABLE_RELEASES.json'), JSON.stringify(legacy));
  return dir;
}

const validManifest = {
  schema: 'v2ex-clone-release-channels/v1',
  default: 'prerelease',
  versions: { 'v0.0.17': 'stable' },
};
const validLegacy = { stable: ['v0.0.17'] };

describe('v0.0.18 发布渠道解析器', () => {
  it('真实清单：v0.0.17 与 v0.0.18 均为 stable', () => {
    expect(run(ROOT, 'v0.0.17').data).toEqual({ version: 'v0.0.17', channel: 'stable', prerelease: false, latest: true });
    expect(run(ROOT, 'v0.0.18').data).toEqual({ version: 'v0.0.18', channel: 'stable', prerelease: false, latest: true });
  });

  it('负向：迁移清单冲突必须拒绝', () => {
    const dir = tempRepo(validManifest, { stable: [] });
    try { expect(run(dir, 'v0.0.17').code).not.toBe(0); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('负向：通配版本必须拒绝', () => {
    const dir = tempRepo({ ...validManifest, versions: { 'v0.0.*': 'stable' } }, validLegacy);
    try { expect(run(dir, 'v0.0.17').code).not.toBe(0); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('负向：非法渠道值必须拒绝', () => {
    const dir = tempRepo({ ...validManifest, versions: { 'v0.0.17': 'beta' } }, validLegacy);
    try { expect(run(dir, 'v0.0.17').code).not.toBe(0); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('负向：清单缺失必须拒绝，不得回退', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'v018-channel-missing-'));
    try { expect(run(dir, 'v0.0.17').code).not.toBe(0); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('v0.0.18 版本载体', () => {
  it('package.json 与 package-lock.json 的根版本必须一致', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
    const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages['']?.version).toBe(pkg.version);
    const sync = readFileSync(path.join(ROOT, 'scripts/release/sync-version.mjs'), 'utf8');
    expect(sync).toContain("file: 'package-lock.json'");
  });
});

describe('v0.0.18 发布渠道消费者接线', () => {
  const release = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
  const post = readFileSync(path.join(ROOT, '.github/workflows/post-release-verify.yml'), 'utf8');
  const dry = readFileSync(path.join(ROOT, 'scripts/release/preflight-dryrun.mjs'), 'utf8');

  it('release 的 meta 与 publish 都调用解析器', () => {
    expect(release).toContain('resolve-release-channel.mjs');
    expect(release).toContain('release-channel-recheck.out');
    expect(release).not.toMatch(/INPUT_PRERELEASE/);
  });

  it('正式发布步骤必须显式注入 PRERELEASE，且稳定版名称符合本版要求', () => {
    const start = release.indexOf('      - name: 核验 draft 资产后正式发布');
    expect(start).toBeGreaterThan(-1);
    const block = release.slice(start, release.indexOf('\n      - name:', start + 10));
    expect(block).toContain('PRERELEASE: ${{ needs.preflight.outputs.prerelease }}');
    expect(release).toContain('RELEASE_TITLE="$VERSION 稳定版"');
  });

  it('幂等补救允许复用本次构建 commit 的镜像，但仍拒绝任意 revision', () => {
    expect(release).toContain('ACTUAL_BUILD_SHA="$(git rev-parse HEAD)"');
    expect(release).toContain('if [ "$REV" != "$TAG_SHA" ] && [ "$REV" != "$ACTUAL_BUILD_SHA" ]; then');
    expect(release).toContain('preflight 已验证 Tag 与本次构建在全部构建输入上零差异');
  });

  it('发布后验收与预演不得再自己读旧清单', () => {
    const code = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(code(post)).toContain('resolve-release-channel.mjs');
    expect(code(post)).not.toContain('STABLE_RELEASES.json');
    expect(dry).toContain('resolve-release-channel.mjs');
  });
});
