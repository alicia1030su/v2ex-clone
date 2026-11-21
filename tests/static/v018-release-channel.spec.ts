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

/** 提取某个具名 step 的 run: | 脚本，供真实 shell 语法检查。 */
function stepRun(workflow: string, stepName: string): string {
  const marker = `      - name: ${stepName}`;
  const start = workflow.indexOf(marker);
  expect(start, `找不到 step: ${stepName}`).toBeGreaterThan(-1);
  const next = workflow.indexOf('\n      - name:', start + marker.length);
  const block = workflow.slice(start, next === -1 ? undefined : next);
  const run = block.indexOf('        run: |');
  expect(run, `step 没有 run: |: ${stepName}`).toBeGreaterThan(-1);
  return block
    .slice(run + '        run: |\n'.length)
    .split(/\r?\n/)
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
}

/** GitHub 表达式不是 shell 语法；替换为占位符后交给 bash -n 做真实解析。 */
function shellSyntaxError(script: string): string | null {
  const normalized = script.replace(/\$\{\{[\s\S]*?\}\}/g, 'GH_EXPR');
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'v018-sh-')), 'step.sh');
  writeFileSync(file, normalized);
  try {
    execFileSync('bash', ['-n', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return null;
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    return err.stderr || err.message || 'bash -n failed';
  } finally {
    rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

/**
 * 把 Notes 步骤里的 Node 调用替换成 env 探针后真实执行。
 * 这能抓到“shell 有值、Node 子进程看不到”的作用域缺陷；bash -n 抓不到。
 */
function runNotesEnvProbe(script: string): { code: number; out: string } {
  const probe = script
    .replace('${{ needs.preflight.outputs.version }}', 'v0.0.18')
    .replace('node scripts/release/render-release-notes.mjs', 'printenv IMAGE_DIGEST_TEXT');
  const { IMAGE_DIGEST_TEXT: _inherited, ...cleanEnv } = process.env;
  try {
    const out = execFileSync('bash', ['-c', probe], {
      encoding: 'utf8',
      env: {
        ...cleanEnv,
        IMAGE_DIGEST: 'sha256:test-digest',
        PUBLISH: 'true',
        GITHUB_STEP_SUMMARY: path.join(tmpdir(), 'v018-step-summary.md'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
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
  const release = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8').replace(/\r\n/g, '\n');
  const post = readFileSync(path.join(ROOT, '.github/workflows/post-release-verify.yml'), 'utf8').replace(/\r\n/g, '\n');
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

  it('补救构建白名单覆盖 Dockerfile 的真实运行时输入', () => {
    for (const input of [
      'scripts/', 'drizzle.config.ts', 'next-env.d.ts', 'global.d.ts',
      'package.json', 'package-lock.json', 'Dockerfile',
    ]) {
      expect(release, `构建输入白名单缺少 ${input}`).toContain(input);
    }
  });

  it('正式发布路径拒绝 lightweight Tag', () => {
    expect(release).toContain('if [ "$TAG_TYPE_NOW" != "tag" ]; then');
    expect(release).toContain('正式发布授权要求 annotated Tag');
  });

  it('正式发布与 Draft 创建脚本必须通过真实 bash 语法检查', () => {
    expect(shellSyntaxError(stepRun(release, '创建 Release（先 draft）'))).toBeNull();
    expect(shellSyntaxError(stepRun(release, '核验 draft 资产后正式发布'))).toBeNull();
  });

  it('Notes 步骤必须把真实镜像 digest 导出给 Node 子进程', () => {
    const script = stepRun(release, '生成中文 Release Notes');
    const ok = runNotesEnvProbe(script);
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out.trim()).toBe('sha256:test-digest');

    const broken = script.replace('export IMAGE_DIGEST_TEXT\n', '');
    expect(broken).not.toBe(script);
    const bad = runNotesEnvProbe(broken);
    expect(bad.code, bad.out).toBe(0);
    expect(bad.out.trim(), '删掉 export 后 Node 探针必须取不到 digest').not.toBe('sha256:test-digest');
  });

  it('负向：删掉 publish 分支条件必须被 shell 语法检查判红', () => {
    const script = stepRun(release, '核验 draft 资产后正式发布');
    const broken = script.replace('if [ "$PUBLISH" = "true" ]; then\n', '');
    expect(broken).not.toBe(script);
    expect(shellSyntaxError(broken), '漏掉 if 后 else 必须造成语法错误').not.toBeNull();
  });

  it('Draft 补救必须复用 release_id，且 GHCR 核验只对 publish=true 执行', () => {
    const create = stepRun(release, '创建 Release（先 draft）');
    expect(create).toContain('RESUME_DRAFT="${resume_draft:-false}"');
    expect(create).toContain('跳过创建与资产上传');
    const publish = stepRun(release, '核验 draft 资产后正式发布');
    expect(publish).toContain('-F body=@release-notes.md');
    expect(release).toContain("name: 登录 GHCR（核验用）\n        # Draft 路径不推送镜像，不能登录后拉一个尚不存在的标签。\n        if: ${{ needs.preflight.outputs.publish == 'true' }}");
    expect(release).toContain("name: 核验 GHCR 镜像已推送（带凭据拉取）\n        if: ${{ needs.preflight.outputs.publish == 'true' }}");
    expect(release).toContain("name: 交叉核对真实镜像 Digest（N3）\n        # Draft 路径没有 registry digest；只有公开发布后才做三方核对。\n        if: ${{ needs.preflight.outputs.publish == 'true' }}");
  });

  it('发布后验收与预演不得再自己读旧清单', () => {
    const code = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(code(post)).toContain('resolve-release-channel.mjs');
    expect(code(post)).not.toContain('STABLE_RELEASES.json');
    expect(post).toContain('cd "$GITHUB_WORKSPACE/verify-tools"');
    expect(post).toContain('&& node scripts/release/resolve-release-channel.mjs');
    expect(dry).toContain('resolve-release-channel.mjs');
  });
});
