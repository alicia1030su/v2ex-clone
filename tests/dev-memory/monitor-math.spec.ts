import { describe, expect, it } from 'vitest';
import {
  nearestRankP95,
  ProcessMonitor,
  summarizeSamples,
} from '../../tools/dev-memory/lib/monitor-core.mjs';

function lease() {
  return {
    schema: 'workbuddy-dev-memory/lease/v1',
    run_id: 'run-1234567890abcdef',
    created_at: '2026-01-01T00:00:00.000Z',
    state: 'ACTIVE',
    profile: 'vitest',
    worktree: {
      root: '/tmp/worktree',
      git_head: 'a'.repeat(40),
      git_tree: 'b'.repeat(40),
      branch: 'test',
    },
    command: { argv: ['node', 'app.js'], cwd: '/tmp/worktree', env_fingerprint: 'sha256:x' },
    budget_mb: 512,
    root: {
      pid: 100,
      ppid: 10,
      name: 'node',
      exe: '/usr/bin/node',
      start_time: '2026-01-01T00:00:00.000Z',
      start_ticks: 1000,
      identity_hash: 'sha256:root',
    },
    observed: [],
    protected: [],
    fence: { worktree_hash: 'sha256:x', created_monotonic_ns: '1' },
  };
}

describe('monitor math and sampling', () => {
  it('uses nearest-rank P95 rather than interpolation', () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(nearestRankP95(values)).toBe(19);
    expect(nearestRankP95([])).toBe(0);
  });

  it('summarizes peak tree, peak process, P95, and sample count', () => {
    const samples = [
      { tree_rss_mb: 100, max_process_rss_mb: 60, monotonic_ns: '1000000' },
      { tree_rss_mb: 300.25, max_process_rss_mb: 200.2, monotonic_ns: '2000000' },
      { tree_rss_mb: 200, max_process_rss_mb: 100, monotonic_ns: '3000000' },
    ];
    const summary = summarizeSamples(samples);

    expect(summary).toEqual({
      peak_tree_rss_mb: 300.3,
      peak_process_rss_mb: 200.2,
      p95_tree_rss_mb: 300.3,
      sample_count: 3,
    });
  });

  it('samples only the exact root tree and reports tree RSS', () => {
    const processes = [
      { ...lease().root, rss_mb: 100.5 },
      { pid: 101, ppid: 100, name: 'child', rss_mb: 20.25, start_time: '2026-01-01T00:00:00.000Z', identity_hash: 'sha256:child' },
      { pid: 102, ppid: 999, name: 'outside', rss_mb: 900, start_time: '2026-01-01T00:00:00.000Z', identity_hash: 'sha256:outside' },
    ];
    const monitor = new ProcessMonitor({
      processTable: {
        snapshot: () => processes,
        snapshotOne: (pid) => processes.find((entry) => entry.pid === pid) ?? null,
      },
      platform: 'linux',
    });
    const sample = monitor.sample(lease());

    expect(sample.error).toBeNull();
    expect(sample.processes.map((row) => row.pid)).toEqual([100, 101]);
    expect(sample.tree_rss_mb).toBe(120.8);
    expect(sample.max_process_rss_mb).toBe(100.5);
  });

  it('treats a PID with changed identity as a monitor failure', () => {
    const recycled = { ...lease().root, start_ticks: 2000, rss_mb: 10 };
    const monitor = new ProcessMonitor({
      processTable: {
        snapshot: () => [recycled],
        snapshotOne: (pid) => pid === recycled.pid ? recycled : null,
      },
      platform: 'linux',
    });

    expect(monitor.sample(lease()).error).toBe('IDENTITY_MISMATCH');
  });
});
