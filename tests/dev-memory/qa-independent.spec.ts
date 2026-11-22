import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BudgetPlanner } from '../../tools/dev-memory/lib/budget-planner.mjs';
import { MemoryProbe, MIB } from '../../tools/dev-memory/lib/memory-probe.mjs';
import { ProcessMonitor } from '../../tools/dev-memory/lib/monitor-core.mjs';
import { LeaseStore, OwnershipLease } from '../../tools/dev-memory/lib/ownership-lease.mjs';
import { ProcessTable, verifyProcessIdentity } from '../../tools/dev-memory/lib/process-table.mjs';
import { LinuxProcessTable } from '../../tools/dev-memory/lib/process-table-linux.mjs';
import { SafeCleaner } from '../../tools/dev-memory/lib/safe-cleaner.mjs';
import { WorktreeIdentityService } from '../../tools/dev-memory/lib/worktree.mjs';
import { ReportStore } from '../../tools/dev-memory/report-store.mjs';
import { RunOrchestrator } from '../../tools/dev-memory/run.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const children = new Set<ChildProcess>();

interface TempDirectoryIdentity {
  dev: bigint;
  ino: bigint;
  birthtimeMs: number;
}

const tempDirectories = new Map<string, TempDirectoryIdentity>();

function isStrictlyInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

function lstatDirectory(directory: string) {
  return fs.lstatSync(directory, { bigint: true });
}

function assertSafeTempDirectory(directory: string, expected: TempDirectoryIdentity) {
  const current = lstatDirectory(directory);
  if (!current.isDirectory() || current.isSymbolicLink()) {
    throw new Error(`QA temporary path is no longer a real directory: ${directory}`);
  }
  if (
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    current.birthtimeMs !== expected.birthtimeMs
  ) {
    throw new Error(`QA temporary directory identity changed: ${directory}`);
  }

  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const resolvedDirectory = fs.realpathSync(directory);
  if (!isStrictlyInside(temporaryRoot, resolvedDirectory)) {
    throw new Error(`QA temporary directory escaped os.tmpdir(): ${directory}`);
  }
  return resolvedDirectory;
}

function cleanupTemporaryDirectories() {
  const errors: string[] = [];
  for (const [directory, expected] of tempDirectories) {
    try {
      let current: fs.BigIntStats;
      try {
        current = lstatDirectory(directory);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          tempDirectories.delete(directory);
          continue;
        }
        throw error;
      }
      if (!current.isDirectory() || current.isSymbolicLink()) {
        throw new Error(`QA temporary path is no longer a real directory: ${directory}`);
      }
      const resolvedDirectory = assertSafeTempDirectory(directory, expected);
      fs.rmSync(resolvedDirectory, { recursive: true, force: false });
      tempDirectories.delete(directory);
    } catch (error) {
      errors.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Unsafe QA temporary directory cleanup');
  }
}

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
  cleanupTemporaryDirectories();
});

function temporaryDirectory(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const stats = lstatDirectory(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`QA temporary directory was not created as a real directory: ${directory}`);
  }
  tempDirectories.set(directory, {
    dev: stats.dev,
    ino: stats.ino,
    birthtimeMs: stats.birthtimeMs,
  });
  return directory;
}

function memorySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    physical_mb: 8192,
    cgroup_limit_mb: 4096,
    effective_limit_mb: 4096,
    current_available_mb: 3072,
    errors: [],
    ...overrides,
  };
}

function processIdentity(overrides: Record<string, unknown> = {}) {
  return {
    pid: 100,
    ppid: 10,
    name: 'node',
    exe: process.execPath,
    cwd: ROOT,
    start_time: '2026-01-01T00:00:00.000Z',
    start_ticks: 1000,
    identity_hash: 'sha256:root',
    rss_mb: 10,
    ...overrides,
  };
}

function lease(root = processIdentity()) {
  return OwnershipLease.create({
    runId: 'run-qa-independent-123456',
    worktree: {
      root: ROOT,
      git_head: 'a'.repeat(40),
      git_tree: 'b'.repeat(40),
      branch: 'test',
    },
    command: {
      argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'],
      cwd: ROOT,
      env_fingerprint: 'sha256:' + 'c'.repeat(64),
    },
    budgetMB: 512,
    profile: 'vitest',
    root,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function runDirectories(jsonDir: string) {
  return fs.readdirSync(jsonDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(jsonDir, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

function readRun(jsonDir: string) {
  const directory = runDirectories(jsonDir)[0];
  expect(directory, 'expected one supervisor run directory').toBeTruthy();
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  return { directory, preflight: read('preflight.json'), monitor: read('monitor.json'), cleanup: read('cleanup.json') };
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for condition');
}

describe('QA independent budget boundaries', () => {
  it('denies a user ceiling below the profile task floor', () => {
    const planner = new BudgetPlanner();
    const result = planner.plan(memorySnapshot(), 'vitest', [], {
      env: {},
      userCeilingMB: 100,
    });

    expect(result.plan.task_budget_mb).toBe(100);
    expect(result.decision).toBe('DENY');
    expect(result.reason_codes).toContain('BELOW_TASK_FLOOR');
  });

  it('does not let unsafe override bypass an existing slot conflict', () => {
    const planner = new BudgetPlanner();
    const result = planner.plan(memorySnapshot(), 'next-build', [3500], {
      env: {},
      unsafeOverride: true,
    });

    expect(result.decision).toBe('DENY');
    expect(result.unsafe).toBe(false);
    expect(result.reason_codes).toContain('BUDGET_EXCEEDS_EFFECTIVE_LIMIT');
  });

  it('fails closed when a finite cgroup limit has malformed current usage', () => {
    const files = new Map<string, string>([
      ['/cg/memory.max', '4294967296\n'],
      ['/cg/memory.current', 'not-a-byte-count\n'],
    ]);
    const probe = new MemoryProbe({
      platform: 'linux',
      cgroupRoot: '/cg',
      procRoot: '/proc',
      os: {
        totalmem: () => 8192 * MIB,
        freemem: () => 4096 * MIB,
      },
      fs: {
        existsSync: (filePath) => files.has(String(filePath)),
        readFileSync: (filePath) => {
          const value = files.get(String(filePath));
          if (value === undefined) throw new Error('ENOENT');
          return value;
        },
      },
    });
    const snapshot = probe.probe();
    const result = new BudgetPlanner().plan(snapshot, 'vitest', [], {
      env: {},
      unsafeOverride: true,
    });

    expect(snapshot.errors.join('\n')).toContain('CGROUP');
    expect(result.decision).toBe('DENY');
    expect(result.unsafe).toBe(false);
  });

  it('fails closed when an existing cgroup limit cannot be read', () => {
    const probe = new MemoryProbe({
      platform: 'linux',
      cgroupRoot: '/cg',
      procRoot: '/proc',
      os: {
        totalmem: () => 8192 * MIB,
        freemem: () => 4096 * MIB,
      },
      fs: {
        existsSync: (filePath) => String(filePath) === '/cg/memory.max',
        readFileSync: () => {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        },
      },
    });
    const snapshot = probe.probe();

    expect(snapshot.errors.join('\n')).toContain('CGROUP_LIMIT_UNMEASURABLE');
  });

  it('fails closed when the process cgroup path cannot be read', () => {
    const files = new Map<string, string>([
      ['/cg/memory.max', 'max\n'],
      ['/cg/memory.current', '1048576\n'],
    ]);
    const probe = new MemoryProbe({
      platform: 'linux',
      cgroupRoot: '/cg',
      procRoot: '/proc',
      os: {
        totalmem: () => 8192 * MIB,
        freemem: () => 4096 * MIB,
      },
      fs: {
        existsSync: (filePath) => files.has(String(filePath)) || String(filePath) === '/proc/self/cgroup',
        readFileSync: (filePath) => {
          if (String(filePath) === '/proc/self/cgroup') {
            throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
          }
          const value = files.get(String(filePath));
          if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          return value;
        },
      },
    });
    const snapshot = probe.probe();

    expect(snapshot.errors.join('\n')).toMatch(/CGROUP/);
  });

  it('fails closed when cgroup current usage cannot be read for a finite limit', () => {
    const files = new Map<string, string>([['/cg/memory.max', '4294967296\n']]);
    const probe = new MemoryProbe({
      platform: 'linux',
      cgroupRoot: '/cg',
      procRoot: '/proc',
      os: {
        totalmem: () => 8192 * MIB,
        freemem: () => 4096 * MIB,
      },
      fs: {
        existsSync: (filePath) => files.has(String(filePath)),
        readFileSync: (filePath) => {
          const value = files.get(String(filePath));
          if (value === undefined) throw new Error('ENOENT');
          return value;
        },
      },
    });
    const snapshot = probe.probe();

    expect(snapshot.cgroup_limit_mb).toBe(4096);
    expect(snapshot.errors.join('\n')).toContain('CGROUP_CURRENT_UNMEASURABLE');
  });
});

describe('QA independent identity fencing', () => {
  it('rejects Windows identity without a creation time', () => {
    const expected = processIdentity({
      start_time: null,
      start_ticks: null,
      exe: 'C:\\Program Files\\nodejs\\node.exe',
    });
    const reused = { ...expected, start_time: '2026-01-02T00:00:00.000Z' };

    expect(verifyProcessIdentity(expected, reused, 'win32')).toBe(false);
  });

  it('rejects identity verification when the fresh creation time disappears', () => {
    const expected = processIdentity({ start_ticks: null });
    const fresh = { ...expected, start_time: null };

    expect(verifyProcessIdentity(expected, fresh, 'win32')).toBe(false);
  });

  it('rejects a lease whose root lacks a usable identity fence', () => {
    const malformed = lease();
    malformed.root.start_time = null;
    malformed.root.start_ticks = null;
    malformed.root.exe = null;

    expect(() => OwnershipLease.validate(malformed)).toThrow(/identity/i);
  });

  it('aborts without signaling when the root identity changes after a descendant exits', async () => {
    const root = processIdentity();
    const child = processIdentity({
      pid: 101,
      ppid: 100,
      start_time: '2026-01-01T00:00:01.000Z',
      start_ticks: 1001,
      identity_hash: 'sha256:child',
    });
    const reusedRoot = processIdentity({
      start_ticks: 9999,
      start_time: '2026-01-02T00:00:00.000Z',
      identity_hash: 'sha256:reused-root',
    });
    const live = new Map<number, Record<string, unknown>>([[100, root], [101, child]]);
    const signals: Array<[number, string]> = [];
    const processTable = {
      snapshotOne: (pid: number) => live.get(pid) ?? null,
      snapshotFresh: () => [...live.values()],
      isAlive: (pid: number) => live.has(pid),
      signal: (pid: number, signal: string) => {
        signals.push([pid, signal]);
        if (pid === 101) {
          live.delete(101);
          live.set(100, reusedRoot);
        } else {
          live.delete(pid);
        }
      },
    };
    const cleaner = new SafeCleaner({
      processTable,
      protectedRegistry: { snapshot: () => [], assertNoProtectedTargets: () => undefined },
      leaseStore: {
        verifyCurrentWorktree: () => ({ ok: true }),
        update: () => undefined,
      },
      graceMs: 10,
      pollMs: 1,
    });

    const report = await cleaner.cleanup(lease(root), 'root-changed-after-child');

    expect(report.decision).toBe('ABORTED');
    expect(report.errors).toContain('IDENTITY_MISMATCH:100');
    expect(signals).toEqual([[101, 'SIGTERM']]);
  });
});

describe('QA independent monitor failure handling', () => {
  it('fails closed when the Linux process tree cannot be enumerated', () => {
    const processTable = new LinuxProcessTable({
      fs: {
        readdirSync: () => {
          throw new Error('INJECTED_PROC_READDIR_FAILURE');
        },
        readFileSync: () => {
          throw new Error('ENOENT');
        },
        readlinkSync: () => {
          throw new Error('ENOENT');
        },
      },
    });

    expect(() => processTable.snapshot()).toThrow(/INJECTED_PROC_READDIR_FAILURE/);
  });

  it('records a sampling exception in the monitor report instead of rejecting silently', async () => {
    const directory = temporaryDirectory('wb qa monitor failure ');
    const reportPath = path.join(directory, 'monitor.json');
    const root = processIdentity();
    let calls = 0;
    const monitor = new ProcessMonitor({
      processTable: {
        snapshot: () => {
          calls += 1;
          if (calls === 1) throw new Error('INJECTED_SAMPLING_FAILURE');
          return [root];
        },
      },
      platform: process.platform,
    });

    const report = await monitor.run(lease(root), reportPath, {
      intervalMs: 100,
      machineId: 'qa-machine',
      shouldStop: () => calls >= 2,
    });

    expect(report.summary.monitor_errors.join('\n')).toContain('INJECTED_SAMPLING_FAILURE');
    expect(JSON.parse(fs.readFileSync(reportPath, 'utf8')).summary.monitor_errors)
      .toContain('SAMPLING_FAILED:INJECTED_SAMPLING_FAILURE');
  });

  it('records sampling delays above the requested interval', async () => {
    const directory = temporaryDirectory('wb qa monitor delay ');
    const root = processIdentity();
    let calls = 0;
    const monitor = new ProcessMonitor({
      processTable: {
        snapshot: () => {
          calls += 1;
          const deadline = Date.now() + 140;
          while (Date.now() < deadline) {
            // Simulate a synchronous OS query that exceeds the 100 ms cadence.
          }
          return [root];
        },
      },
      platform: process.platform,
    });

    const report = await monitor.run(lease(root), path.join(directory, 'monitor.json'), {
      intervalMs: 100,
      shouldStop: () => calls >= 2,
    });

    expect(report.summary.monitor_errors).toContain('SAMPLING_INTERVAL_EXCEEDED');
    expect(report.samples[1].elapsed_ms).toBeGreaterThan(100);
  });

  it('returns 3, writes cleanup, and stops the child when monitoring fails', async () => {
    const directory = temporaryDirectory('wb qa run monitor failure ');
    const jsonDir = path.join(directory, 'reports with spaces');
    const processTable = new ProcessTable();
    const injected = {
      snapshotOne: processTable.snapshotOne.bind(processTable),
      snapshotFresh: processTable.snapshotFresh.bind(processTable),
      snapshot: processTable.snapshot.bind(processTable),
      snapshotCached: () => {
        throw new Error('INJECTED_MONITOR_FAILURE');
      },
      isAlive: processTable.isAlive.bind(processTable),
      signal: processTable.signal.bind(processTable),
    };
    const orchestrator = new RunOrchestrator({ processTable: injected });
    let exitCode: number | undefined;
    let rootAliveAfterRun: boolean | undefined;
    try {
      exitCode = await orchestrator.run({
        profile: 'vitest',
        command: [process.execPath, '-e', 'setTimeout(()=>{},800)'],
        worktree: ROOT,
        jsonDir,
        quiet: true,
      });
      const reports = readRun(jsonDir);
      rootAliveAfterRun = processTable.snapshotOne(reports.monitor.summary.root_pid) !== null;
    } finally {
      processTable.impl?.dispose?.();
    }

    expect(exitCode).toBe(3);
    const reports = readRun(jsonDir);
    expect(reports.monitor.summary.monitor_errors.join('\n')).toContain('INJECTED_MONITOR_FAILURE');
    expect(fs.existsSync(path.join(reports.directory, 'cleanup.json'))).toBe(true);
    expect(reports.cleanup.decision).not.toBe('ABORTED');
    expect(rootAliveAfterRun).toBe(false);
  }, 20_000);

  it('still cleans the child when writing the monitor report fails', async () => {
    const directory = temporaryDirectory('wb qa monitor report failure ');
    const jsonDir = path.join(directory, 'reports');
    const realReportStore = new ReportStore();
    const reportStore = {
      writeAtomic(filePath: string, value: unknown) {
        if (filePath.endsWith('monitor.json')) throw new Error('INJECTED_REPORT_WRITE_FAILURE');
        realReportStore.writeAtomic(filePath, value);
      },
      read: realReportStore.read.bind(realReportStore),
    };
    const orchestrator = new RunOrchestrator({ reportStore });
    try {
      const exitCode = await orchestrator.run({
        profile: 'vitest',
        command: [process.execPath, '-e', 'setTimeout(()=>{},800)'],
        worktree: ROOT,
        jsonDir,
        quiet: true,
      });
      expect(exitCode).toBe(3);
      const runDir = runDirectories(jsonDir)[0];
      const lease = JSON.parse(fs.readFileSync(path.join(runDir, 'lease.json'), 'utf8'));
      expect(fs.existsSync(path.join(runDir, 'cleanup.json'))).toBe(true);
      expect(orchestrator.processTable.snapshotOne(lease.root.pid)).toBeNull();
    } finally {
      orchestrator.processTable.impl?.dispose?.();
    }
  }, 20_000);

  it('requires command in the monitor JSON schema', () => {
    const schema = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'tools/dev-memory/schemas/monitor.schema.json'),
      'utf8',
    ));

    expect(schema.properties.summary.required).toContain('command');
  });

  it('records a standalone monitor timeout in machine-readable output', async () => {
    const directory = temporaryDirectory('wb qa monitor timeout ');
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], {
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    });
    children.add(child);
    const processTable = new ProcessTable();
    try {
      await waitFor(() => processTable.snapshotOne(child.pid) !== null);
      const worktree = new WorktreeIdentityService().resolve(ROOT);
      const leasePath = path.join(directory, 'lease.json');
      new LeaseStore().create({
        runId: 'run-qa-monitor-timeout-123',
        worktree,
        command: {
          argv: [process.execPath, '-e', 'setTimeout(()=>{},10000)'],
          cwd: ROOT,
          env_fingerprint: 'sha256:' + 'd'.repeat(64),
        },
        budgetMB: 512,
        profile: 'vitest',
        root: processTable.snapshotOne(child.pid),
      }, leasePath);
      const reportPath = path.join(directory, 'monitor.json');
      const result = spawnSync(process.execPath, [
        path.join(ROOT, 'tools/dev-memory/monitor.mjs'),
        '--lease', leasePath,
        '--report', reportPath,
        '--timeout-ms', '300',
      ], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      expect(
        report.timed_out === true ||
        report.summary.timed_out === true ||
        report.summary.monitor_errors.includes('MONITOR_TIMEOUT'),
      ).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      processTable.impl?.dispose?.();
    }
  }, 20_000);
});

describe('QA independent supervisor boundaries', () => {
  it('preserves bracket and space arguments through exact argv spawning', async () => {
    const directory = temporaryDirectory('wb qa argv spaces ');
    const script = path.join(directory, 'capture argv.js');
    const output = path.join(directory, 'captured.json');
    fs.writeFileSync(script, [
      "require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));",
      "console.log('exact-argv-ok');",
    ].join('\n'));
    const orchestrator = new RunOrchestrator();
    try {
      const exitCode = await orchestrator.run({
        profile: 'vitest',
        command: [process.execPath, script, output, '/t/[id]', 'path with spaces'],
        worktree: ROOT,
        jsonDir: path.join(directory, 'reports'),
        quiet: true,
      });
      expect(exitCode).toBe(0);
      expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual(['/t/[id]', 'path with spaces']);
    } finally {
      orchestrator.processTable.impl?.dispose?.();
    }
  });

  it('writes a cleanup report when the exact command cannot be spawned', async () => {
    const directory = temporaryDirectory('wb qa spawn failure ');
    const jsonDir = path.join(directory, 'reports');
    const orchestrator = new RunOrchestrator();
    try {
      const exitCode = await orchestrator.run({
        profile: 'vitest',
        command: ['definitely-missing-qa-command-7f0c2e'],
        worktree: ROOT,
        jsonDir,
        quiet: true,
      });
      expect(exitCode).toBe(3);
      const reports = readRun(jsonDir);
      expect(reports.monitor.summary.root_pid).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(reports.directory, 'cleanup.json'))).toBe(true);
    } finally {
      orchestrator.processTable.impl?.dispose?.();
    }
  });

  it('keeps the budget slot while a protected-target abort leaves the child running', async () => {
    const directory = temporaryDirectory('wb qa protected slot ');
    const jsonDir = path.join(directory, 'reports');
    const processTable = new ProcessTable();
    let childPid: number | null = null;
    const injected = {
      snapshotOne(pid: number) {
        const row = processTable.snapshotOne(pid);
        if (row && childPid === null && pid !== process.pid) childPid = row.pid;
        return row;
      },
      snapshotFresh() {
        return processTable.snapshotFresh().map((row) =>
          row.pid === childPid ? { ...row, name: 'WorkBuddy.exe' } : row);
      },
      snapshot: processTable.snapshot.bind(processTable),
      snapshotCached: processTable.snapshotCached.bind(processTable),
      isAlive: processTable.isAlive.bind(processTable),
      signal: processTable.signal.bind(processTable),
    };
    const orchestrator = new RunOrchestrator({ processTable: injected });
    let leasePid: number | null = null;
    let slotPath: string | null = null;
    try {
      const exitCode = await orchestrator.run({
        profile: 'vitest',
        command: [process.execPath, '-e', 'setTimeout(()=>{},10000)'],
        worktree: ROOT,
        jsonDir,
        quiet: true,
        timeoutMs: 500,
      });
      expect(exitCode).toBe(4);
      const reports = readRun(jsonDir);
      const lease = JSON.parse(fs.readFileSync(path.join(reports.directory, 'lease.json'), 'utf8'));
      leasePid = lease.root.pid;
      slotPath = path.join(os.tmpdir(), 'workbuddy-dev-memory-slots', `${lease.run_id}.json`);
      expect(reports.cleanup.decision).toBe('ABORTED');
      expect(processTable.snapshotOne(leasePid)).not.toBeNull();
      expect(fs.existsSync(slotPath)).toBe(true);
    } finally {
      if (leasePid !== null && processTable.snapshotOne(leasePid) !== null) {
        try {
          processTable.signal(leasePid, 'SIGKILL');
        } catch {
          // The exact child may have exited between the check and signal.
        }
      }
      if (slotPath !== null) fs.rmSync(slotPath, { force: true });
      processTable.impl?.dispose?.();
    }
  }, 20_000);

  it('uses direct Node Next argv in the cross-platform low entries', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['dev:low']).toContain('-- node node_modules/next/dist/bin/next dev');
    expect(packageJson.scripts['build:low']).toContain('-- node node_modules/next/dist/bin/next build');
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    it(`cleans the exact child and returns non-zero after supervisor ${signal}`, async () => {
      const directory = temporaryDirectory(`wb qa ${signal} `);
      const helper = path.join(directory, 'signal helper.mjs');
      const jsonDir = path.join(directory, 'reports');
      fs.writeFileSync(helper, `
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RunOrchestrator } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'tools/dev-memory/run.mjs')).href)};
const [signal, worktree, jsonDir] = process.argv.slice(2);
const orchestrator = new RunOrchestrator();
const pending = orchestrator.run({
  profile: 'vitest',
  command: [process.execPath, '-e', 'setTimeout(()=>{},10000)'],
  worktree,
  jsonDir,
  quiet: true,
});
const timer = setInterval(() => {
  const dirs = fs.existsSync(jsonDir)
    ? fs.readdirSync(jsonDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : [];
  const runDir = dirs.length === 1 ? path.join(jsonDir, dirs[0].name) : null;
  const monitorPath = runDir ? path.join(runDir, 'monitor.json') : null;
  if (monitorPath && fs.existsSync(monitorPath)) {
    clearInterval(timer);
    process.emit(signal, signal);
  }
}, 25);
const timeout = setTimeout(() => {
  console.error('signal helper timed out');
  process.exit(99);
}, 12000);
const code = await pending;
clearTimeout(timeout);
orchestrator.processTable.impl?.dispose?.();
console.log(JSON.stringify({ code }));
process.exitCode = code;
`);
      const result = spawnSync(process.execPath, [helper, signal, ROOT, jsonDir], {
        encoding: 'utf8',
        timeout: 20_000,
        windowsHide: true,
      });
      expect([1, 3], result.stderr).toContain(result.status);
      const reports = readRun(jsonDir);
      expect(reports.cleanup.reason).toBe(`supervisor-${signal}`);
      expect(reports.cleanup.decision).toBe('CLEANED');
      expect(reports.monitor.summary.monitor_errors.every((error: string) =>
        error === 'SAMPLING_INTERVAL_EXCEEDED')).toBe(true);
      expect(reports.monitor.summary.exit_code).not.toBe(0);
    }, 30_000);
  }
});
