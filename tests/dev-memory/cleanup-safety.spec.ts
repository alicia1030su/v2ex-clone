import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LeaseStore,
  OwnershipLease,
} from '../../tools/dev-memory/lib/ownership-lease.mjs';
import { ProcessTable } from '../../tools/dev-memory/lib/process-table.mjs';
import { ProtectedProcessRegistry, isProtectedProcess } from '../../tools/dev-memory/lib/protected-registry.mjs';
import { SafeCleaner } from '../../tools/dev-memory/lib/safe-cleaner.mjs';
import { WorktreeIdentityService } from '../../tools/dev-memory/lib/worktree.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const children = new Set<ChildProcess>();

afterEach(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
  children.clear();
});

function spawnProbe(scriptPath: string, readyPath: string, extraArgs: string[] = []) {
  const child = spawn(process.execPath, [scriptPath, readyPath, ...extraArgs], {
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
  });
  children.add(child);
  return child;
}

async function waitForFile(filePath: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const value = fs.readFileSync(filePath, 'utf8').trim();
      if (value !== '') return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

async function waitForGone(processTable: ProcessTable, pid: number, identityHash?: string, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fresh = processTable.snapshotOne(pid);
    if (fresh === null || (identityHash && fresh.identity_hash !== identityHash)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`process ${pid} did not exit`);
}

function fakeLeaseStore(verifyResult = { ok: true }) {
  return {
    verifyCurrentWorktree: () => verifyResult,
    update: () => undefined,
  };
}

function fakeIdentity(pid: number, ppid: number, overrides = {}) {
  return {
    pid,
    ppid,
    name: 'node',
    exe: process.execPath,
    cwd: 'UNKNOWN',
    start_time: '2026-01-01T00:00:00.000Z',
    start_ticks: 1000 + pid,
    identity_hash: `sha256:${pid}`,
    ...overrides,
  };
}

function fakeLease(root = fakeIdentity(100, 10), overrides = {}) {
  return OwnershipLease.create({
    runId: 'run-1234567890abcdef',
    worktree: {
      root: ROOT,
      git_head: 'a'.repeat(40),
      git_tree: 'b'.repeat(40),
      branch: 'test',
    },
    command: {
      argv: ['node', 'app.js'],
      cwd: ROOT,
      env_fingerprint: 'sha256:' + 'c'.repeat(64),
    },
    budgetMB: 512,
    profile: 'vitest',
    root,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

function fakeRegistry(protectedPid = null) {
  return {
    snapshot: () => [],
    assertNoProtectedTargets: (targets) => {
      const hit = targets.find((target) => target.pid === protectedPid);
      if (hit) {
        const error = new Error(`protected process targeted: ${hit.pid}`);
        error.code = 'PROTECTED_TARGET';
        error.targets = [hit];
        throw error;
      }
    },
  };
}

describe('SafeCleaner exact-tree behavior', () => {
  it('recognizes WorkBuddy, editor, PostgreSQL, and Redis images as protected', () => {
    expect(isProtectedProcess({ name: 'WorkBuddy.exe', exe: null })).toBe(true);
    expect(isProtectedProcess({ name: 'Code.exe', exe: null })).toBe(true);
    expect(isProtectedProcess({ name: 'postgres.exe', exe: null })).toBe(true);
    expect(isProtectedProcess({ name: 'redis-server.exe', exe: null })).toBe(true);
    expect(isProtectedProcess({ name: 'node.exe', exe: 'C:\\nodejs\\node.exe' })).toBe(false);
  });

  it('terminates recorded descendants deepest-first while an outside probe and artifacts survive', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wb cleanup spaces '));
    const childScript = path.join(directory, 'child probe.js');
    const outsideScript = path.join(directory, 'outside probe.js');
    const rootScript = path.join(directory, 'root supervisor.js');
    const outsideReady = path.join(directory, 'outside.ready');
    const rootReady = path.join(directory, 'root.ready');
    const childReady = path.join(directory, 'child.ready');
    const goFile = path.join(directory, 'go.now');
    const sentinel = path.join(directory, 'evidence must stay.json');
    fs.writeFileSync(childScript, 'setInterval(() => {}, 1000);\n', 'utf8');
    fs.writeFileSync(
      outsideScript,
      "require('node:fs').writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);\n",
      'utf8',
    );
    fs.writeFileSync(rootScript, `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [readyPath, childScript, goPath, childReady] = process.argv.slice(2);
let child = null;
fs.writeFileSync(readyPath, String(process.pid));
const timer = setInterval(() => {
  if (child === null && fs.existsSync(goPath)) {
    child = spawn(process.execPath, [childScript], { stdio: 'ignore', shell: false, windowsHide: true });
    fs.writeFileSync(childReady, String(child.pid));
    clearInterval(timer);
  }
}, 20);
setInterval(() => {}, 1000);
`, 'utf8');
    fs.writeFileSync(sentinel, '{"evidence":true}\n', 'utf8');

    const outside = spawnProbe(outsideScript, outsideReady);
    const root = spawnProbe(rootScript, rootReady, [childScript, goFile, childReady]);
    try {
      const outsidePid = Number(await waitForFile(outsideReady));
      const rootPid = Number(await waitForFile(rootReady));
      const processTable = new ProcessTable();
      const worktreeService = new WorktreeIdentityService();
      const worktree = worktreeService.resolve(ROOT);
      const leaseStore = new LeaseStore({ worktree: worktreeService });
      let lease = leaseStore.create({
        runId: 'run-cleanup-1234567890',
        worktree,
        command: {
          argv: [process.execPath, rootScript],
          cwd: directory,
          env_fingerprint: 'sha256:' + 'd'.repeat(64),
        },
        budgetMB: 512,
        profile: 'vitest',
        root: processTable.snapshotOne(rootPid),
        observed: [],
        protected: [],
        platform: process.platform,
        artifacts: [sentinel],
      }, path.join(directory, 'lease.json'));

      // Start the descendant only after the lease exists, making the intended
      // Node child unambiguous even though Windows may also attach a console host.
      fs.writeFileSync(goFile, 'go', 'utf8');
      const childPid = Number(await waitForFile(childReady));
      lease.observed = [processTable.snapshotOne(childPid)];
      leaseStore.update(path.join(directory, 'lease.json'), lease);
      const childIdentityBeforeCleanup = processTable.snapshotOne(childPid);
      expect(
        Date.parse(childIdentityBeforeCleanup?.start_time ?? ''),
        `lease=${lease.created_at} child=${childIdentityBeforeCleanup?.start_time}`,
      ).toBeGreaterThanOrEqual(Date.parse(lease.created_at));

      // Exercise the standalone monitor CLI against a real live tree. The
      // timeout ends monitoring successfully without signaling the probe.
      const monitorReportPath = path.join(directory, 'monitor.json');
      const monitorRun = spawnSync(process.execPath, [
        path.join(ROOT, 'tools', 'dev-memory', 'monitor.mjs'),
        '--lease',
        path.join(directory, 'lease.json'),
        '--report',
        monitorReportPath,
        '--timeout-ms',
        '1200',
      ], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
      expect(monitorRun.status, monitorRun.stderr).toBe(0);
      const monitorReport = JSON.parse(fs.readFileSync(monitorReportPath, 'utf8')) as {
        summary: { sample_count: number; monitor_errors: string[] };
      };
      expect(monitorReport.summary.sample_count).toBeGreaterThanOrEqual(1);
      expect(monitorReport.summary.monitor_errors).toEqual([]);

      const cleaner = new SafeCleaner({
        processTable,
        protectedRegistry: new ProtectedProcessRegistry({ processTable }),
        leaseStore,
        graceMs: 250,
        pollMs: 25,
      });
      const report = await cleaner.cleanup(lease, 'test-cleanup', {
        leasePath: path.join(directory, 'lease.json'),
        outsideProbePid: outsidePid,
        artifacts: [sentinel],
        graceMs: 250,
      });

      expect(report.decision, JSON.stringify(report, null, 2)).toBe('CLEANED');
      expect(report.errors).toEqual([]);
      const targetPids = report.targets.map((target) => target.pid);
      expect(targetPids).toContain(childPid);
      expect(targetPids).toContain(rootPid);
      expect(targetPids).not.toContain(outsidePid);
      expect(report.targets.at(-1)?.pid).toBe(rootPid);
      expect(report.outside_probe).toEqual({ pid: outsidePid, alive: true });
      expect(report.protected_intact).toBe(true);
      expect(report.artifacts_intact).toBe(true);
      expect(fs.readFileSync(sentinel, 'utf8')).toContain('evidence');

      await waitForGone(processTable, childPid, childIdentityBeforeCleanup?.identity_hash);
      await waitForGone(processTable, rootPid, lease.root.identity_hash);
      expect(processTable.snapshotOne(outsidePid)).not.toBeNull();
    } finally {
      if (outside.exitCode === null) outside.kill('SIGKILL');
      if (root.exitCode === null) root.kill('SIGKILL');
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('aborts without signaling when the root PID was recycled', async () => {
    const lease = fakeLease();
    const freshRoot = fakeIdentity(100, 10, { start_ticks: 9999, identity_hash: 'sha256:reused' });
    const signals: Array<[number, string]> = [];
    const processTable = {
      snapshotOne: (pid) => pid === 100 ? freshRoot : null,
      snapshot: () => [freshRoot],
      isAlive: () => true,
      signal: (pid, signal) => signals.push([pid, signal]),
    };
    const cleaner = new SafeCleaner({
      processTable,
      protectedRegistry: fakeRegistry(),
      leaseStore: fakeLeaseStore(),
      graceMs: 10,
      pollMs: 5,
    });

    const report = await cleaner.cleanup(lease, 'pid-reuse-test');
    expect(report.decision).toBe('ABORTED');
    expect(report.errors).toContain('IDENTITY_MISMATCH');
    expect(signals).toEqual([]);
  });

  it('skips a recycled PID after the direct child exit was confirmed', async () => {
    const lease = fakeLease();
    const freshRoot = fakeIdentity(100, 10, { start_ticks: 9999, identity_hash: 'sha256:reused' });
    const signals: Array<[number, string]> = [];
    const processTable = {
      snapshotOne: (pid) => pid === 100 ? freshRoot : null,
      snapshot: () => [freshRoot],
      isAlive: () => true,
      signal: (pid, signal) => signals.push([pid, signal]),
    };
    const cleaner = new SafeCleaner({
      processTable,
      protectedRegistry: fakeRegistry(),
      leaseStore: fakeLeaseStore(),
      graceMs: 10,
      pollMs: 5,
    });

    const report = await cleaner.cleanup(lease, 'post-exit-reuse', { rootExitConfirmed: true });
    expect(report.decision).toBe('NOOP');
    expect(report.skipped).toEqual([
      expect.objectContaining({ pid: 100, reason: 'PID_REUSED_AFTER_CONFIRMED_EXIT' }),
    ]);
    expect(signals).toEqual([]);
  });

  it('aborts a cross-worktree cleanup without signaling', async () => {
    const lease = fakeLease();
    const root = fakeIdentity(100, 10);
    const signals: Array<[number, string]> = [];
    const processTable = {
      snapshotOne: (pid) => pid === 100 ? root : null,
      snapshot: () => [root],
      isAlive: () => true,
      signal: (pid, signal) => signals.push([pid, signal]),
    };
    const cleaner = new SafeCleaner({
      processTable,
      protectedRegistry: fakeRegistry(),
      leaseStore: fakeLeaseStore({ ok: false, reason: 'CROSS_WORKTREE_IDENTITY' }),
      graceMs: 10,
      pollMs: 5,
    });

    const report = await cleaner.cleanup(lease, 'cross-worktree-test');
    expect(report.decision).toBe('ABORTED');
    expect(report.errors).toContain('CROSS_WORKTREE_IDENTITY');
    expect(signals).toEqual([]);
  });

  it('abandons the whole cleanup if any target is protected', async () => {
    const root = fakeIdentity(100, 10);
    const child = fakeIdentity(101, 100, { start_time: '2026-01-01T00:00:01.000Z' });
    const outside = fakeIdentity(102, 999, { start_time: '2026-01-01T00:00:01.000Z' });
    const signals: Array<[number, string]> = [];
    const processTable = {
      snapshotOne: (pid) => [root, child, outside].find((entry) => entry.pid === pid) ?? null,
      snapshot: () => [root, child, outside],
      isAlive: () => true,
      signal: (pid, signal) => signals.push([pid, signal]),
    };
    const cleaner = new SafeCleaner({
      processTable,
      protectedRegistry: fakeRegistry(101),
      leaseStore: fakeLeaseStore(),
      graceMs: 10,
      pollMs: 5,
    });

    const report = await cleaner.cleanup(fakeLease(root), 'protected-test');
    expect(report.decision).toBe('ABORTED');
    expect(report.protected_intact).toBe(false);
    expect(report.skipped).toEqual([
      expect.objectContaining({ pid: 101, reason: 'PROTECTED_TARGET' }),
    ]);
    expect(signals).toEqual([]);
  });

  it('never selects an unrelated Node process outside the root tree', async () => {
    const root = fakeIdentity(100, 10);
    const child = fakeIdentity(101, 100, { start_time: '2026-01-01T00:00:01.000Z' });
    const unrelatedNode = fakeIdentity(102, 999, {
      start_time: '2026-01-01T00:00:01.000Z',
      identity_hash: 'sha256:unrelated',
    });
    const unrelatedWorkBuddy = fakeIdentity(103, 998, {
      name: 'WorkBuddy.exe',
      exe: 'C:\\WorkBuddy\\WorkBuddy.exe',
      start_time: '2026-01-01T00:00:01.000Z',
      identity_hash: 'sha256:workbuddy',
    });
    const unrelatedPostgres = fakeIdentity(104, 997, {
      name: 'postgres.exe',
      exe: 'C:\\PostgreSQL\\postgres.exe',
      start_time: '2026-01-01T00:00:01.000Z',
      identity_hash: 'sha256:postgres',
    });
    const unrelatedRedis = fakeIdentity(105, 996, {
      name: 'redis-server.exe',
      exe: 'C:\\Redis\\redis-server.exe',
      start_time: '2026-01-01T00:00:01.000Z',
      identity_hash: 'sha256:redis',
    });
    const live = new Map(
      [root, child, unrelatedNode, unrelatedWorkBuddy, unrelatedPostgres, unrelatedRedis]
        .map((entry) => [entry.pid, entry]),
    );
    const signals: number[] = [];
    const processTable = {
      snapshotOne: (pid) => live.get(pid) ?? null,
      snapshot: () => [...live.values()],
      isAlive: (pid) => live.has(pid),
      signal: (pid) => {
        signals.push(pid);
        live.delete(pid);
      },
    };
    const cleaner = new SafeCleaner({
      processTable,
      protectedRegistry: fakeRegistry(),
      leaseStore: fakeLeaseStore(),
      graceMs: 10,
      pollMs: 5,
    });

    const report = await cleaner.cleanup(fakeLease(root), 'outside-tree-test');
    expect(report.decision).toBe('CLEANED');
    expect(signals.sort((a, b) => a - b)).toEqual([100, 101]);
    expect(live.has(102)).toBe(true);
    expect(live.has(103)).toBe(true);
    expect(live.has(104)).toBe(true);
    expect(live.has(105)).toBe(true);
  });
});
