import { createHash, randomBytes } from 'node:crypto';
import { ReportStore } from '../report-store.mjs';
import { WorktreeIdentityService, environmentFingerprint } from './worktree.mjs';
import { hashProcessIdentity } from './process-table-linux.mjs';

export const LEASE_SCHEMA = 'workbuddy-dev-memory/lease/v1';

function normalizeIdentity(identity, platform) {
  if (!identity || !Number.isSafeInteger(Number(identity.pid)) || Number(identity.pid) <= 0) {
    throw new Error('lease process identity requires a valid pid');
  }
  const ppid = Number(identity.ppid ?? 0);
  if (!Number.isSafeInteger(ppid) || ppid < 0) {
    throw new Error('lease process identity requires a valid ppid');
  }
  const normalized = {
    pid: Number(identity.pid),
    ppid,
    start_time: identity.start_time ?? null,
    start_ticks: identity.start_ticks ?? null,
    exe: identity.exe ?? null,
    cwd: identity.cwd ?? 'UNKNOWN',
    name: identity.name ?? 'UNKNOWN',
    identity_hash: identity.identity_hash ?? hashProcessIdentity(identity, platform),
  };
  return normalized;
}

function validateRootIdentity(root, platform) {
  if (!root || !Number.isSafeInteger(root.pid) || root.pid <= 0) {
    throw new Error('lease root identity is invalid');
  }
  if (!Number.isSafeInteger(root.ppid) || root.ppid < 0) {
    throw new Error('lease root identity ppid is invalid');
  }
  if (typeof root.exe !== 'string' || root.exe.length === 0) {
    throw new Error('lease root identity requires an executable fence');
  }
  if (platform === 'win32') {
    if (
      typeof root.start_time !== 'string' ||
      !Number.isFinite(Date.parse(root.start_time))
    ) {
      throw new Error('lease root identity requires a Windows creation-time fence');
    }
  } else if (!Number.isSafeInteger(root.start_ticks) || root.start_ticks < 0) {
    throw new Error('lease root identity requires a Linux start-ticks fence');
  }
}

/**
 * Create and fence an ownership lease for one exact child process tree.
 */
export class OwnershipLease {
  /**
   * @param {{
   *   runId:string,
   *   worktree:object,
   *   command:{argv:string[], cwd:string, env_fingerprint:string},
   *   budgetMB:number,
   *   profile:string,
   *   root:object,
   *   observed?:object[],
   *   protected?:object[],
   *   platform?:string,
   *   createdAt?:Date,
   *   artifacts?:string[],
   * }} input
   * @returns {object}
   */
  static create(input) {
    const runId = input.runId ?? randomBytes(16).toString('hex');
    if (typeof runId !== 'string' || runId.length < 16) {
      throw new Error('run_id must contain at least 16 characters');
    }
    const platform = input.platform ?? process.platform;
    const root = normalizeIdentity(input.root, platform);
    validateRootIdentity(root, platform);
    // On Windows the supervisor-captured command cwd is authoritative; the
    // standard process API cannot reread an arbitrary process cwd.
    root.cwd = input.command.cwd;
    const createdAt = input.createdAt ?? new Date();
    const worktreeFence = createHash('sha256')
      .update(JSON.stringify({
        root: input.worktree.root,
        git_head: input.worktree.git_head,
        git_tree: input.worktree.git_tree,
      }))
      .digest('hex');
    return {
      schema: LEASE_SCHEMA,
      run_id: runId,
      created_at: createdAt.toISOString(),
      state: 'ACTIVE',
      profile: input.profile,
      worktree: { ...input.worktree },
      command: {
        argv: [...input.command.argv],
        cwd: input.command.cwd,
        env_fingerprint: input.command.env_fingerprint ?? environmentFingerprint(process.env),
      },
      budget_mb: input.budgetMB,
      root,
      observed: (input.observed ?? []).map((entry) => normalizeIdentity(entry, platform)),
      protected: (input.protected ?? []).map((entry) => normalizeIdentity(entry, platform)),
      artifacts: [...(input.artifacts ?? [])],
      fence: {
        worktree_hash: `sha256:${worktreeFence}`,
        created_monotonic_ns: process.hrtime.bigint().toString(),
      },
    };
  }

  /**
   * @param {object} lease
   * @returns {object}
   */
  static validate(lease) {
    if (!lease || lease.schema !== LEASE_SCHEMA) {
      throw new Error(`lease schema must be ${LEASE_SCHEMA}`);
    }
    if (typeof lease.run_id !== 'string' || lease.run_id.length < 16) {
      throw new Error('lease run_id is invalid');
    }
    if (!lease.worktree || typeof lease.worktree.root !== 'string') {
      throw new Error('lease worktree is invalid');
    }
    if (!lease.root || !Number.isSafeInteger(lease.root.pid)) {
      throw new Error('lease root identity is invalid');
    }
    validateRootIdentity(lease.root, process.platform);
    if (!Array.isArray(lease.command?.argv) || lease.command.argv.length === 0) {
      throw new Error('lease command argv is invalid');
    }
    return lease;
  }
}

/**
 * Persistent lease store with atomic updates.
 */
export class LeaseStore {
  /**
   * @param {{worktree?:WorktreeIdentityService, reportStore?:ReportStore}} [dependencies]
   */
  constructor(dependencies = {}) {
    this.worktree = dependencies.worktree ?? new WorktreeIdentityService();
    this.reportStore = dependencies.reportStore ?? new ReportStore();
  }

  /**
   * @param {object} input
   * @param {string} filePath
   * @returns {object}
   */
  create(input, filePath) {
    const lease = OwnershipLease.create(input);
    this.reportStore.writeAtomic(filePath, lease);
    return lease;
  }

  /**
   * @param {string} filePath
   * @returns {object}
   */
  read(filePath) {
    return OwnershipLease.validate(this.reportStore.read(filePath));
  }

  /**
   * @param {string} filePath
   * @param {object} lease
   */
  update(filePath, lease) {
    OwnershipLease.validate(lease);
    this.reportStore.writeAtomic(filePath, lease);
  }

  /**
   * @param {object} lease
   * @returns {{ok:boolean, reason?:string, current?:object}}
   */
  verifyCurrentWorktree(lease) {
    try {
      const current = this.worktree.resolve(lease.worktree.root);
      if (!this.worktree.sameWorktree(lease.worktree, current)) {
        return { ok: false, reason: 'CROSS_WORKTREE_IDENTITY', current };
      }
      return { ok: true, current };
    } catch (error) {
      return {
        ok: false,
        reason: 'WORKTREE_UNREADABLE',
        current: undefined,
      };
    }
  }
}
