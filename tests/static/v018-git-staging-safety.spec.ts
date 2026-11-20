import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, chmodSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * v0.0.18 P0-2：真实 Git 仓库验证暂存安全
 *
 * 不 mock git：每次测试都创建临时仓库、真实 add/commit/hook。
 */
const ROOT = path.resolve(__dirname, '..', '..');
const SAFE = path.join(ROOT, 'scripts/git/safe-stage.mjs');
const CHECK = path.join(ROOT, 'scripts/git/check-staged-files.mjs');

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'v018-git-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  return dir;
}
function run(cwd: string, args: string[]) {
  try {
    const out = execFileSync(process.execPath, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('v0.0.18 安全暂存', () => {
  it('CI 接线提交树门禁且文档登记安全流程', () => {
    const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('node scripts/git/check-staged-files.mjs --tree HEAD');
    const workflow = readFileSync(path.join(ROOT, 'docs/DEVELOPMENT_WORKFLOW.md'), 'utf8');
    expect(workflow).toContain('safe-stage.mjs');
    expect(workflow).toContain('core.hooksPath');
    expect(workflow).toContain('--no-verify');
  });

  it('只暂存显式文件', () => {
    const dir = repo();
    try {
      writeFileSync(path.join(dir, 'a.ts'), 'a');
      writeFileSync(path.join(dir, 'b.ts'), 'b');
      expect(run(dir, [SAFE, 'a.ts']).code).toBe(0);
      const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' });
      expect(staged.trim()).toBe('a.ts');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('拒绝 -A / . / glob / 目录', () => {
    const dir = repo();
    try {
      writeFileSync(path.join(dir, 'a.ts'), 'a');
      mkdirSync(path.join(dir, 'src'));
      for (const bad of ['-A', '--all', '.', '*.ts', 'src']) {
        expect(run(dir, [SAFE, bad]).code, `${bad} 应被拒绝`).not.toBe(0);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('可显式暂存已跟踪文件的删除', () => {
    const dir = repo();
    try {
      writeFileSync(path.join(dir, 'a.ts'), 'a');
      execFileSync('git', ['add', 'a.ts'], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-m', 'add'], { cwd: dir });
      unlinkSync(path.join(dir, 'a.ts'));
      expect(run(dir, [SAFE, 'a.ts']).code).toBe(0);
      const staged = execFileSync('git', ['diff', '--cached', '--name-status'], { cwd: dir, encoding: 'utf8' });
      expect(staged.trim()).toBe('D\ta.ts');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('允许 Next.js 动态路由的字面方括号路径，但仍拒绝 glob', () => {
    const dir = repo();
    try {
      mkdirSync(path.join(dir, 'src/app/t/[id]'), { recursive: true });
      writeFileSync(path.join(dir, 'src/app/t/[id]/page.tsx'), 'page');
      expect(run(dir, [SAFE, 'src/app/t/[id]/page.tsx']).code).toBe(0);
      const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' });
      expect(staged.trim()).toBe('src/app/t/[id]/page.tsx');
      expect(run(dir, [SAFE, 'src/app/t/[missing]/page.tsx']).code).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('拒绝提交信息草稿与敏感文件', () => {
    const dir = repo();
    try {
      for (const name of ['.m', '.msg2', '.cm', '.env', 'id_rsa', 'INSTALL_CREDENTIALS.txt']) {
        writeFileSync(path.join(dir, name), 'x');
        expect(run(dir, [SAFE, name]).code, `${name} 应被拒绝`).not.toBe(0);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('提交树检查拦截禁止路径（CI 兜底）', () => {
    const dir = repo();
    try {
      const blob = (content: string) => execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: dir, input: content, encoding: 'utf8',
      }).trim();
      const tree = (name: string, content: string) => execFileSync('git', ['mktree'], {
        cwd: dir, input: `100644 blob ${blob(content)}\t${name}\n`, encoding: 'utf8',
      }).trim();
      expect(run(dir, [CHECK, '--tree', tree('ok.ts', 'ok')]).code).toBe(0);
      const bad = run(dir, [CHECK, '--tree', tree('.msg', 'draft')]);
      expect(bad.code).not.toBe(0);
      expect(bad.out).toContain('.msg');
      expect(run(dir, [CHECK, '--tree', 'missing-ref']).code).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('pre-commit hook 拦住暂存草稿', () => {
    const dir = repo();
    try {
      mkdirSync(path.join(dir, 'scripts/git'), { recursive: true });
      mkdirSync(path.join(dir, '.githooks'), { recursive: true });
      copyFileSync(CHECK, path.join(dir, 'scripts/git/check-staged-files.mjs'));
      copyFileSync(path.join(ROOT, '.githooks/pre-commit'), path.join(dir, '.githooks/pre-commit'));
      chmodSync(path.join(dir, '.githooks/pre-commit'), 0o755);
      execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });
      writeFileSync(path.join(dir, 'ok.ts'), 'ok');
      execFileSync('git', ['add', 'ok.ts'], { cwd: dir });
      const okCommit = spawnSync('git', ['commit', '-q', '-m', 'ok'], {
        cwd: dir, encoding: 'utf8',
      });
      expect(okCommit.status, `${okCommit.stdout ?? ''}${okCommit.stderr ?? ''}`).toBe(0);
      expect(`${okCommit.stdout ?? ''}${okCommit.stderr ?? ''}`).toContain('暂存区安全');
      writeFileSync(path.join(dir, '.msg'), 'draft');
      execFileSync('git', ['add', '.msg'], { cwd: dir });
      const blockedCommit = spawnSync('git', ['commit', '-q', '-m', 'should fail'], {
        cwd: dir, encoding: 'utf8',
      });
      const blockedOutput = `${blockedCommit.stdout ?? ''}${blockedCommit.stderr ?? ''}`;
      expect(blockedCommit.status, 'hook 未拦住草稿提交').not.toBe(0);
      expect(blockedOutput).toContain('.msg');
      expect(blockedOutput).toContain('禁止提交信息草稿或敏感文件名');
      const head = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: dir, encoding: 'utf8' }).trim();
      expect(head).toBe('ok');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
