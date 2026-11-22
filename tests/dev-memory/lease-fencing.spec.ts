import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LEASE_SCHEMA,
  LeaseStore,
  OwnershipLease,
} from '../../tools/dev-memory/lib/ownership-lease.mjs';

const worktree = {
  root: '/tmp/work tree with spaces',
  git_head: 'a'.repeat(40),
  git_tree: 'b'.repeat(40),
  branch: 'release/v0.0.21-stable',
};

function rootIdentity(overrides = {}) {
  return {
    pid: 4242,
    ppid: 4100,
    name: 'node',
    exe: '/usr/bin/node',
    cwd: '/tmp/old cwd',
    start_time: '2026-01-01T00:00:00.000Z',
    start_ticks: 123456,
    ...overrides,
  };
}

describe('ownership lease fencing', () => {
  it('captures the supervisor cwd as authoritative root cwd', () => {
    const lease = OwnershipLease.create({
      runId: 'run-1234567890abcdef',
      worktree,
      command: {
        argv: ['node', 'script with spaces.js'],
        cwd: '/tmp/work tree with spaces',
        env_fingerprint: 'sha256:' + 'c'.repeat(64),
      },
      budgetMB: 768,
      profile: 'next-build',
      root: rootIdentity(),
      observed: [rootIdentity({ pid: 4243, ppid: 4242, start_ticks: 123457 })],
      protected: [],
      platform: 'linux',
      createdAt: new Date('2026-01-01T00:00:01.000Z'),
    });

    expect(lease.schema).toBe(LEASE_SCHEMA);
    expect(lease.root.cwd).toBe('/tmp/work tree with spaces');
    expect(lease.command.argv).toEqual(['node', 'script with spaces.js']);
    expect(lease.root.identity_hash).toMatch(/^sha256:/);
    expect(lease.fence.worktree_hash).toMatch(/^sha256:/);
  });

  it('writes and reads a lease atomically through LeaseStore', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'wb-lease-'));
    const leasePath = path.join(directory, 'lease with spaces.json');
    const store = new LeaseStore({
      worktree: {
        resolve: () => worktree,
        sameWorktree: (left, right) => left.root === right.root,
      },
    });
    try {
      const lease = store.create({
        runId: 'run-abcdef1234567890',
        worktree,
        command: {
          argv: ['node', '-e', 'setInterval(()=>{},1000)'],
          cwd: worktree.root,
          env_fingerprint: 'sha256:' + 'd'.repeat(64),
        },
        budgetMB: 512,
        profile: 'vitest',
        root: rootIdentity(),
      }, leasePath);

      expect(store.read(leasePath)).toEqual(lease);
      expect(store.verifyCurrentWorktree(lease).ok).toBe(true);
      lease.state = 'FINISHED';
      store.update(leasePath, lease);
      expect(store.read(leasePath).state).toBe('FINISHED');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects cleanup against another worktree identity', () => {
    const store = new LeaseStore({
      worktree: {
        resolve: () => ({ ...worktree, root: '/tmp/other-worktree' }),
        sameWorktree: () => false,
      },
    });
    const lease = OwnershipLease.create({
      runId: 'run-1234567890abcdef',
      worktree,
      command: {
        argv: ['node', 'app.js'],
        cwd: worktree.root,
        env_fingerprint: 'sha256:' + 'e'.repeat(64),
      },
      budgetMB: 512,
      profile: 'vitest',
      root: rootIdentity(),
    });

    const verification = store.verifyCurrentWorktree(lease);
    expect(verification.ok).toBe(false);
    expect(verification.reason).toBe('CROSS_WORKTREE_IDENTITY');
  });

  it('rejects an invalid lease schema instead of repairing it silently', () => {
    expect(() => OwnershipLease.validate({ ... OwnershipLease.create({
      runId: 'run-1234567890abcdef',
      worktree,
      command: {
        argv: ['node'],
        cwd: worktree.root,
        env_fingerprint: 'sha256:' + 'f'.repeat(64),
      },
      budgetMB: 512,
      profile: 'vitest',
      root: rootIdentity(),
    }), schema: 'other' })).toThrow(/lease schema/);
  });
});
