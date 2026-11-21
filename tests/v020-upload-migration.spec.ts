import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'migrate-legacy-uploads.mjs');
const tempDirs: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'v020-upload-migrate-'));
  tempDirs.push(dir);
  return dir;
}

function run(dir: string, target: string) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    env: { ...process.env, UPLOAD_ROOT: target },
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('v0.0.20 legacy upload startup migration', () => {
  it('copies and verifies every file before removing public/uploads', () => {
    const dir = workspace();
    const legacy = path.join(dir, 'public', 'uploads');
    const target = path.join(dir, 'private', 'uploads');
    mkdirSync(path.join(legacy, 'replies', '1'), { recursive: true });
    writeFileSync(path.join(legacy, 'replies', '1', 'aaaaaaaa.png'), 'probe-bytes');

    const result = run(dir, target);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(target, 'replies', '1', 'aaaaaaaa.png'), 'utf8')).toBe('probe-bytes');
    expect(existsSync(legacy)).toBe(false);
  });

  it('refuses to overwrite an existing target file and keeps the legacy tree', () => {
    const dir = workspace();
    const legacy = path.join(dir, 'public', 'uploads');
    const target = path.join(dir, 'private', 'uploads');
    mkdirSync(path.join(legacy, 'avatars', '1'), { recursive: true });
    mkdirSync(path.join(target, 'avatars', '1'), { recursive: true });
    writeFileSync(path.join(legacy, 'avatars', '1', 'bbbbbbbb.png'), 'legacy');
    writeFileSync(path.join(target, 'avatars', '1', 'bbbbbbbb.png'), 'target');

    const result = run(dir, target);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('拒绝覆盖');
    expect(readFileSync(path.join(legacy, 'avatars', '1', 'bbbbbbbb.png'), 'utf8')).toBe('legacy');
    expect(readFileSync(path.join(target, 'avatars', '1', 'bbbbbbbb.png'), 'utf8')).toBe('target');
  });

  it.skipIf(process.platform === 'win32')('refuses symlinks in the legacy tree', () => {
    const dir = workspace();
    const legacy = path.join(dir, 'public', 'uploads');
    const target = path.join(dir, 'private', 'uploads');
    mkdirSync(legacy, { recursive: true });
    const secret = path.join(dir, 'secret.txt');
    writeFileSync(secret, 'secret');
    symlinkSync(secret, path.join(legacy, 'escape.png'));

    const result = run(dir, target);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('符号链接');
    expect(existsSync(path.join(target, 'escape.png'))).toBe(false);
    expect(existsSync(path.join(legacy, 'escape.png'))).toBe(true);
  });
});
