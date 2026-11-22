import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunOrchestrator } from '../../tools/dev-memory/run.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const orchestrator = new RunOrchestrator();

afterAll(() => {
  orchestrator.processTable.impl?.dispose?.();
});

interface RunReports {
  preflight: { decision: string };
  lease: Record<string, unknown>;
  monitor: {
    summary: {
      sample_count: number;
      peak_tree_rss_mb: number;
      monitor_errors: string[];
      exit_code: number | null;
      signal: string | null;
    };
  };
  cleanup: { decision: string };
}

function readRunReports(jsonDir: string): RunReports {
  const runDirectories = fs.readdirSync(jsonDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(jsonDir, entry.name));
  expect(runDirectories).toHaveLength(1);
  const runDirectory = runDirectories[0];
  return {
    preflight: JSON.parse(fs.readFileSync(path.join(runDirectory, 'preflight.json'), 'utf8')),
    lease: JSON.parse(fs.readFileSync(path.join(runDirectory, 'lease.json'), 'utf8')),
    monitor: JSON.parse(fs.readFileSync(path.join(runDirectory, 'monitor.json'), 'utf8')),
    cleanup: JSON.parse(fs.readFileSync(path.join(runDirectory, 'cleanup.json'), 'utf8')),
  };
}

describe('RunOrchestrator exit paths', () => {
  it('reports a normal completion with a real process-tree sample', async () => {
    const jsonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb run normal '));
    try {
      const exitCode = await orchestrator.run({
        profile: 'vitest',
        command: [process.execPath, '-e', 'setTimeout(() => {}, 2_500)'],
        worktree: ROOT,
        jsonDir,
        quiet: true,
      });
      const reports = readRunReports(jsonDir);

      expect(exitCode, JSON.stringify(reports.cleanup)).toBe(0);
      expect(reports.preflight.decision).toBe('ALLOW');
      expect(reports.monitor.summary.sample_count).toBeGreaterThanOrEqual(1);
      expect(reports.monitor.summary.peak_tree_rss_mb).toBeGreaterThan(0);
      expect(reports.monitor.summary.monitor_errors).toEqual([]);
      expect(reports.monitor.summary.exit_code).toBe(0);
      expect(reports.cleanup.decision).not.toBe('ABORTED');
    } finally {
      fs.rmSync(jsonDir, { recursive: true, force: true });
    }
  });

  it('preserves a non-zero child exit code', async () => {
    const jsonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb run failure '));
    try {
      const exitCode = await orchestrator.run({
        profile: 'vitest',
        command: [process.execPath, '-e', 'setTimeout(() => process.exit(7), 2_500)'],
        worktree: ROOT,
        jsonDir,
        quiet: true,
      });
      const reports = readRunReports(jsonDir);

      expect(exitCode, JSON.stringify(reports.monitor.summary)).toBe(7);
      expect(reports.monitor.summary.exit_code).toBe(7);
      expect(reports.cleanup.decision).not.toBe('ABORTED');
    } finally {
      fs.rmSync(jsonDir, { recursive: true, force: true });
    }
  });

  it('reports a signal termination as a non-zero supervisor result', async () => {
    const jsonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb run signal '));
    try {
      const exitCode = await orchestrator.run({
        profile: 'vitest',
        command: [
          process.execPath,
          '-e',
          "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 2_500)",
        ],
        worktree: ROOT,
        jsonDir,
        quiet: true,
      });
      const reports = readRunReports(jsonDir);

      expect(exitCode, JSON.stringify({
        monitor: reports.monitor.summary,
        cleanup: reports.cleanup,
      })).toBe(1);
      expect(
        reports.monitor.summary.signal === 'SIGTERM' ||
          reports.monitor.summary.exit_code === 1,
      ).toBe(true);
      expect(reports.cleanup.decision).not.toBe('ABORTED');
    } finally {
      fs.rmSync(jsonDir, { recursive: true, force: true });
    }
  });
});
