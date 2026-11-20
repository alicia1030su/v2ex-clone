import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * v0.0.18 P1-1：单实例连续运行工具
 *
 * 真实运行与合成边界分开：
 *   · CLI + mock HTTP + 真实 OS 进程采样 => 验证实际产物与退出码；
 *   · 合成时钟 => 只验证 24h 判定逻辑，绝不代表真实完成 24h。
 */
const ROOT = path.resolve(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'scripts/soak/single-instance.mjs');
const WORKFLOW = path.join(ROOT, '.github/workflows/soak-single-instance.yml');
const LAUNCHER = path.join(ROOT, 'scripts/soak/run-workflow-segment.mjs');
const DOC = path.join(ROOT, 'docs/SOAK_SINGLE_INSTANCE.md');

type Verdict = { status: string; claim24h: boolean; reasons: string[] };
type SoakModule = {
  SOAK_24H_MS: number;
  parseArgs(argv: string[]): Record<string, unknown>;
  sampleProcess(pid: number): Promise<Record<string, unknown>>;
  fingerprintSql(tables?: string[]): string;
  backupRestoreProbe(options: Record<string, unknown>, runner: unknown): Promise<Record<string, unknown>>;
  deriveStatus(input: Record<string, unknown>): Verdict;
  runSoak(options: Record<string, unknown>, dependencies: Record<string, unknown>): Promise<{
    summary: Record<string, unknown>; exitCode: number;
  }>;
};

async function loadSoak(): Promise<SoakModule> {
  const url = pathToFileURL(TOOL).href;
  return await import(/* @vite-ignore */ url) as SoakModule;
}

const tempDirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'v018-soak-'));
  tempDirs.push(dir);
  return dir;
}

type MockMode = 'ok' | 'drift' | 'http-fail';
async function mockApp(mode: MockMode = 'ok') {
  let opsCalls = 0;
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    res.setHeader('Content-Type', 'application/json');
    if (url === '/api/auth/signin') {
      res.setHeader('Set-Cookie', 'v2_session=test-session; Path=/; HttpOnly');
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url === '/api/health/ready') {
      const ok = mode !== 'http-fail';
      res.statusCode = ok ? 200 : 503;
      res.end(JSON.stringify({
        status: ok ? 'ready' : 'not-ready',
        checks: {
          db: { ok, latencyMs: 1 },
          redis: { ok: true, latencyMs: 0, configured: false },
        },
      }));
      return;
    }
    if (url === '/') {
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    if (url === '/api/admin/ops') {
      opsCalls++;
      res.statusCode = 200;
      res.end(JSON.stringify({
        scope: {
          instanceId: mode === 'drift' && opsCalls > 1 ? 'drifted-instance' : 'fixed-instance',
          pid: process.pid,
          startedAt,
          uptimeSeconds: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
          replicasDeclared: 1,
        },
        dependencies: {
          db: { ok: true, latencyMs: 1 },
          redis: { ok: true, latencyMs: 0, configured: false },
          postgres: { ok: true, total: 2, maxConnections: 100 },
        },
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not_found' }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server 未获得端口');
  return { base: `http://127.0.0.1:${address.port}` };
}

function runCli(base: string, out: string, withCredentials = true): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (withCredentials) {
      env.SOAK_ADMIN_USERNAME = 'admin';
      env.SOAK_ADMIN_PASSWORD = 'test-password';
    } else {
      delete env.SOAK_ADMIN_USERNAME;
      delete env.SOAK_ADMIN_PASSWORD;
    }
    const child: ChildProcess = spawn(process.execPath, [
      TOOL, '--base', base, '--duration-ms', '2200', '--interval-ms', '1000', '--out', out,
    ], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += String(chunk); });
    child.stderr?.on('data', (chunk) => { output += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code: code ?? 1, output }));
  });
}

function fakeSample() {
  return {
    at: new Date(0).toISOString(),
    health: { status: 200, latencyMs: 1, ready: true, dbOk: true, redisConfigured: false, redisOk: true },
    page: { status: 200, latencyMs: 1 },
    ops: {
      status: 200, latencyMs: 1, instanceId: 'fixed', pid: 123, startedAt: '2026-01-01T00:00:00.000Z',
      uptimeSeconds: 1, dbOk: true, redisConfigured: false, redisOk: true, postgresOk: true,
      postgresTotal: 1, replicasDeclared: 1,
    },
    process: { available: true, platform: 'linux', pid: 123, startIdentity: 'boot:1', memoryRssBytes: 1024, cpuTimeMs: 10 },
    errors: [],
  };
}

describe('v0.0.18 单实例长跑工具', () => {
  it('真实 OS 进程采样可重复且包含启动身份', async () => {
    const soak = await loadSoak();
    const first = await soak.sampleProcess(process.pid);
    const second = await soak.sampleProcess(process.pid);
    expect(first.available).toBe(true);
    expect(second.available).toBe(true);
    expect(first.pid).toBe(process.pid);
    expect(first.startIdentity).toBe(second.startIdentity);
    expect(Number(first.memoryRssBytes)).toBeGreaterThan(0);
  });

  it('短时真实运行必须输出 not-completed，且资源未知不能写成 0', async () => {
    const soak = await loadSoak();
    const { base } = await mockApp();
    const out = tempDir();
    const result = await runCli(base, out);
    expect(result.code).toBe(3);
    const summary = JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8'));
    expect(summary.schema).toBe('v2ex-clone-soak-single-instance/v1');
    expect(summary.status).toBe('not-completed');
    expect(summary.claim24h).toBe(false);
    expect(summary.reasonCodes).toContain('duration_lt_24h');
    expect(summary.reasonCodes).toContain('data_fingerprint_not_matched');
    expect(summary.reasonCodes).toContain('backup_restore_probe_not_passed');
    expect(summary.sampleCount).toBeGreaterThanOrEqual(3);
    expect(summary.maxima.memoryRssBytes).toBeGreaterThan(0);
    const samples = readFileSync(path.join(out, 'samples.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(samples.length).toBe(summary.sampleCount);
    expect(samples.every((sample) => sample.process.available === true)).toBe(true);
  });

  it('负向：实例 ID 漂移必须 fail，且不能声称 24h', async () => {
    const { base } = await mockApp('drift');
    const out = tempDir();
    const result = await runCli(base, out);
    expect(result.code).toBe(1);
    const summary = JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8'));
    expect(summary.status).toBe('fail');
    expect(summary.claim24h).toBe(false);
    expect(summary.drift).toContain('instance_id_drift');
  });

  it('负向：HTTP 非 200 必须 fail', async () => {
    const { base } = await mockApp('http-fail');
    const out = tempDir();
    const result = await runCli(base, out);
    expect(result.code).toBe(1);
    const summary = JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8'));
    expect(summary.status).toBe('fail');
    expect(summary.errors).toContain('health_not_ready');
  });

  it('负向：登录失败也必须落盘 fail 摘要', async () => {
    const { base } = await mockApp();
    const out = tempDir();
    const result = await runCli(base, out, false);
    expect(result.code).toBe(1);
    const summary = JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8'));
    expect(summary.status).toBe('fail');
    expect(summary.claim24h).toBe(false);
    expect(summary.reasonCodes).toContain('runner_error');
    expect(summary.sampleCount).toBe(0);
    expect(readFileSync(path.join(out, 'samples.jsonl'), 'utf8')).toBe('');
  });

  it('24h 判定边界：23h59m59s、缺证据、漂移、指纹不一致均不得 pass', async () => {
    const soak = await loadSoak();
    const base = {
      actualDurationMs: soak.SOAK_24H_MS,
      samples: [fakeSample(), fakeSample()],
      errors: [], drift: [],
      fingerprint: { status: 'match' }, probe: { status: 'passed' },
    };
    expect(soak.deriveStatus(base)).toEqual({ status: 'pass', claim24h: true, reasons: [] });
    expect(soak.deriveStatus({ ...base, actualDurationMs: soak.SOAK_24H_MS - 1 }).status).toBe('not-completed');
    expect(soak.deriveStatus({ ...base, fingerprint: { status: 'not-run' } }).status).toBe('not-completed');
    expect(soak.deriveStatus({ ...base, probe: { status: 'not-run' } }).status).toBe('not-completed');
    expect(soak.deriveStatus({ ...base, drift: ['os_process_drift'] }).status).toBe('fail');
    expect(soak.deriveStatus({ ...base, fingerprint: { status: 'mismatch' } }).status).toBe('fail');
    expect(soak.deriveStatus({ ...base, errors: ['page_not_200'] }).status).toBe('fail');
  });

  it('合成时钟接线：数据指纹前后不一致必须写入 fail 摘要', async () => {
    const soak = await loadSoak();
    let clock = 0;
    let fingerprintCalls = 0;
    const out = tempDir();
    const options = soak.parseArgs([
      '--base', 'http://127.0.0.1:3000', '--duration-ms', String(soak.SOAK_24H_MS),
      '--interval-ms', String(soak.SOAK_24H_MS), '--out', out,
      '--pg-host', '127.0.0.1', '--pg-user', 'test', '--pg-database', 'testdb',
    ]);
    const result = await soak.runSoak(options, {
      now: () => clock,
      sleep: async (ms: number) => { clock += ms; },
      login: async () => 'v2_session=synthetic',
      collect: async () => ({ ...fakeSample(), at: new Date(clock).toISOString() }),
      fingerprint: async () => (++fingerprintCalls === 1 ? 'a'.repeat(32) : 'b'.repeat(32)),
      probe: async () => ({ status: 'passed' }),
    });
    expect(fingerprintCalls).toBe(2);
    expect(result.exitCode).toBe(1);
    expect(result.summary.status).toBe('fail');
    expect(result.summary.claim24h).toBe(false);
    expect(result.summary.reasonCodes).toContain('data_fingerprint_mismatch');
    const summary = JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8'));
    expect(summary.dataFingerprint.status).toBe('mismatch');
  });

  it('备份恢复探针：恢复指纹不一致必须失败且仍清理临时库', async () => {
    const soak = await loadSoak();
    const commands: string[] = [];
    const runner = async (command: string, args: string[]) => {
      commands.push(command);
      if (command === 'psql') {
        const database = args[args.indexOf('-d') + 1];
        return { stdout: `${database.startsWith('v2ex_soak_probe_') ? 'b' : 'a'}`.repeat(32) + '\n' };
      }
      if (command === 'pg_dump') {
        const file = args[args.indexOf('--file') + 1];
        writeFileSync(file, 'synthetic-dump');
      }
      return { stdout: '' };
    };
    await expect(soak.backupRestoreProbe({
      pgHost: '127.0.0.1', pgPort: '5432', pgUser: 'test', pgDatabase: 'source',
    }, runner)).rejects.toThrow('指纹不一致');
    expect(commands).toEqual(expect.arrayContaining(['createdb', 'pg_dump', 'pg_restore', 'dropdb']));
  });

  it('参数、指纹 SQL 与工作流上限有负向门禁', async () => {
    const soak = await loadSoak();
    expect(() => soak.parseArgs(['--base', 'file:///tmp', '--duration-ms', '1', '--out', 'x'])).toThrow();
    expect(() => soak.parseArgs([
      '--base', 'http://localhost', '--duration-ms', '1000', '--interval-ms', '1', '--out', 'x',
    ])).toThrow();
    expect(() => soak.parseArgs([
      '--base', 'http://localhost', '--duration-ms', '20000000', '--max-duration-ms', '19800000', '--out', 'x',
    ])).toThrow();
    expect(() => soak.fingerprintSql(['users; DROP TABLE users'])).toThrow();
    const workflow = readFileSync(WORKFLOW, 'utf8');
    const launcher = readFileSync(LAUNCHER, 'utf8');
    expect(workflow).toContain('workflow_dispatch');
    expect(workflow).toContain('timeout-minutes: 340');
    expect(launcher).toContain('--max-duration-ms');
    expect(launcher).toContain('MAX_MINUTES = 330');
    expect(workflow).toContain('not-completed');
    expect(workflow).toContain('soak-evidence/summary.json');
    expect(workflow).toContain('PGPASSWORD:');
    // GitHub Actions service.command 只接受标量；数组会在解析阶段生成 0-job failure。
    const redisCommand = workflow.match(/^\s+command:\s*(.+)$/m)?.[1] ?? '';
    const isSequenceCommand = (line: string) => line.trimStart().startsWith('[');
    expect(isSequenceCommand(redisCommand), 'Redis service.command 不能是 YAML 序列').toBe(false);
    expect(isSequenceCommand("['redis-server', '--requirepass', 'x']"), '负向对照必须能识别数组写法').toBe(true);
    const doc = readFileSync(DOC, 'utf8');
    expect(doc).toContain('24 小时单实例连续验证 = `not-completed`');
    expect(doc).toContain('分段累计 ≠ 单实例连续');
  });
});
