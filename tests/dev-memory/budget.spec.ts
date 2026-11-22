import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BudgetPlanner } from '../../tools/dev-memory/lib/budget-planner.mjs';

function snapshot(overrides = {}) {
  return {
    physical_mb: 8192,
    cgroup_limit_mb: 4096,
    effective_limit_mb: 4096,
    current_available_mb: 3072,
    errors: [],
    ...overrides,
  };
}

describe('BudgetPlanner dynamic budget', () => {
  it('uses the smaller cgroup limit and the documented share formula', () => {
    const planner = new BudgetPlanner();
    const result = planner.plan(snapshot(), 'next-build', [], {
      cpuCount: 4,
      env: {},
    });

    expect(result.decision).toBe('ALLOW');
    expect(result.limits.effective_limit_mb).toBe(4096);
    expect(result.limits.host_reserve_mb).toBe(1024);
    expect(result.limits.available_mb).toBe(3072);
    expect(result.plan.task_floor_mb).toBe(768);
    expect(result.plan.task_share).toBe(0.55);
    expect(result.plan.task_budget_mb).toBe(1689);
    expect(result.plan.sum_task_budgets_plus_reserve_mb).toBe(2713);
    expect(result.plan.runtime).toEqual({
      node_max_old_space_mb: 1013,
      vitest_max_workers: 1,
      vitest_file_parallelism: false,
      vitest_pool: 'forks',
      playwright_workers: 1,
      playwright_fully_parallel: false,
      next_build_cpus: 3,
    });
  });

  it('applies the user ceiling without splitting one budget across tasks', () => {
    const planner = new BudgetPlanner();
    const result = planner.plan(snapshot(), 'vitest', [1000], {
      userCeilingMB: 1000,
      cpuCount: 16,
      env: {},
    });

    expect(result.plan.task_budget_mb).toBe(1000);
    expect(result.plan.runtime.node_max_old_space_mb).toBe(600);
    expect(result.plan.runtime.next_build_cpus).toBe(1);
    expect(result.plan.sum_task_budgets_plus_reserve_mb).toBe(3024);
  });

  it('fails closed on malformed environment values', () => {
    const planner = new BudgetPlanner();
    const result = planner.plan(snapshot(), 'vitest', [], {
      env: { WORKBUDDY_RESERVE_MB: 'NaN' },
    });

    expect(result.decision).toBe('DENY');
    expect(result.reason_codes.join('\n')).toContain('INVALID_ENV');
  });

  it('only lets --unsafe-override bypass a sub-floor task budget', () => {
    const planner = new BudgetPlanner();
    const low = snapshot({
      physical_mb: 1536,
      cgroup_limit_mb: null,
      effective_limit_mb: 1536,
      current_available_mb: 512,
    });

    const denied = planner.plan(low, 'next-build', [], { env: {} });
    expect(denied.decision).toBe('DENY');
    expect(denied.reason_codes).toContain('BELOW_TASK_FLOOR');

    const unsafe = planner.plan(low, 'next-build', [], {
      env: {},
      unsafeOverride: true,
    });
    expect(unsafe.decision).toBe('ALLOW_UNSAFE');
    expect(unsafe.unsafe).toBe(true);
  });

  it('never lets --unsafe-override bypass unmeasurable memory', () => {
    const planner = new BudgetPlanner();
    const result = planner.plan(snapshot({
      physical_mb: 0,
      effective_limit_mb: 0,
      errors: ['PHYSICAL_MEMORY_UNMEASURABLE'],
    }), 'vitest', [], { env: {}, unsafeOverride: true });

    expect(result.decision).toBe('DENY');
    expect(result.reason_codes.join('\n')).toContain('MEASUREMENT:PHYSICAL_MEMORY_UNMEASURABLE');
  });

  it('serializes concurrent machine-level slots and recovers a dead owner slot', async () => {
    const slotDir = mkdtempSync(path.join(os.tmpdir(), 'wb-budget-slots-'));
    const owner = {
      pid: 100,
      ppid: 1,
      start_time: '2026-01-01T00:00:00.000Z',
      start_ticks: 1,
      exe: '/usr/bin/node',
      identity_hash: 'sha256:owner',
    };
    const processTable = {
      snapshotOne(pid) {
        return pid === 100 ? owner : null;
      },
    };
    try {
      const planner = new BudgetPlanner({ slotDir, processTable });
      const plan = planner.plan(snapshot(), 'next-build', [], { env: {} });
      planner.acquireSlot('run-1234567890abcdef', plan, {
        worktreeRoot: '/tmp/work tree',
        owner,
        profile: 'vitest',
      });
      expect(planner.listActiveSlots()).toHaveLength(1);
      expect(() => planner.acquireSlot('run-fedcba0987654321', plan, {
        worktreeRoot: '/tmp/work tree',
        owner: { ...owner, pid: 101, identity_hash: 'sha256:other' },
        profile: 'vitest',
      })).toThrow(/exhausted/);
      planner.releaseSlot('run-1234567890abcdef');
      expect(planner.listActiveSlots()).toEqual([]);
    } finally {
      rmSync(slotDir, { recursive: true, force: true });
    }
  });
});
