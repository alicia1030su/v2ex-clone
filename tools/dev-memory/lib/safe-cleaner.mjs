import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ReportStore } from '../report-store.mjs';
import { WorktreeIdentityService } from './worktree.mjs';
import { confirmedDescendants, verifyProcessIdentity } from './process-table.mjs';

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function captureArtifacts(artifactPaths) {
  /** @type {Map<string, string>} */
  const hashes = new Map();
  /** @type {string[]} */
  const missing = [];
  const visit = (inputPath) => {
    const absolute = path.resolve(inputPath);
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch {
      missing.push(absolute);
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute).sort()) {
        visit(path.join(absolute, entry));
      }
      return;
    }
    if (!stat.isFile()) return;
    try {
      const digest = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      hashes.set(absolute, digest);
    } catch {
      missing.push(absolute);
    }
  };
  for (const artifactPath of artifactPaths ?? []) visit(artifactPath);
  return { hashes, missing };
}

function artifactsEqual(left, right) {
  if (left.missing.length > 0 || right.missing.length > 0) return false;
  if (left.hashes.size !== right.hashes.size) return false;
  for (const [filePath, hash] of left.hashes) {
    if (right.hashes.get(filePath) !== hash) return false;
  }
  return true;
}

/**
 * Exact-PID, identity-fenced, deepest-first process cleaner.
 */
export class SafeCleaner {
  /**
   * @param {{
   *   processTable:object,
   *   protectedRegistry:object,
   *   leaseStore:object,
   *   worktree?:WorktreeIdentityService,
   *   reportStore?:ReportStore,
   *   graceMs?:number,
   *   pollMs?:number,
   * }} dependencies
   */
  constructor(dependencies) {
    if (!dependencies?.processTable) throw new Error('processTable is required');
    if (!dependencies?.protectedRegistry) throw new Error('protectedRegistry is required');
    if (!dependencies?.leaseStore) throw new Error('leaseStore is required');
    this.processTable = dependencies.processTable;
    this.protectedRegistry = dependencies.protectedRegistry;
    this.leaseStore = dependencies.leaseStore;
    this.worktree = dependencies.worktree ?? new WorktreeIdentityService();
    this.reportStore = dependencies.reportStore ?? new ReportStore();
    this.graceMs = dependencies.graceMs ?? 1_000;
    this.pollMs = dependencies.pollMs ?? 25;
    this.platform = dependencies.platform ?? process.platform;
  }

  /**
   * @param {object} expected
   * @param {object|null} fresh
   * @returns {boolean}
   */
  verifyIdentity(expected, fresh) {
    return verifyProcessIdentity(expected, fresh, this.platform);
  }

  /**
   * @param {object} root
   * @param {object[]} [processes]
   * @returns {object[]}
   */
  confirmDescendants(root, processes) {
    const snapshot = processes ?? (
      typeof this.processTable.snapshotFresh === 'function'
        ? this.processTable.snapshotFresh()
        : this.processTable.snapshot()
    );
    return confirmedDescendants(root, snapshot).map((entry) => entry.process);
  }

  /**
   * @param {object} target
   * @returns {Promise<boolean>}
   */
  async waitForExit(target) {
    const deadline = Date.now() + this.graceMs;
    while (Date.now() < deadline) {
      const fresh = this.processTable.snapshotOne(target.pid);
      if (fresh === null || !this.verifyIdentity(target, fresh)) return true;
      await sleep(this.pollMs);
    }
    return false;
  }

  /**
   * @param {object} target
   * @param {object[]} reportTargets
   * @returns {Promise<void>}
   */
  async terminate(target, reportTargets) {
    const reportEntry = {
      pid: target.pid,
      identity_hash: target.identity_hash,
      identity_ok: true,
      signal: 'SIGTERM',
      result: 'signaled',
      verified_at: new Date().toISOString(),
    };
    reportTargets.push(reportEntry);
    try {
      this.processTable.signal(target.pid, 'SIGTERM');
    } catch (error) {
      reportEntry.result = error?.code === 'ESRCH' ? 'exited' : 'signal-failed';
      if (reportEntry.result === 'signal-failed') throw error;
      return;
    }

    if (await this.waitForExit(target)) {
      reportEntry.result = 'exited';
      return;
    }

    // Re-read immediately before escalation. A mismatched identity means the
    // PID was reused and must never receive the second signal.
    const fresh = this.processTable.snapshotOne(target.pid);
    if (fresh === null) {
      reportEntry.result = 'exited';
      return;
    }
    if (!this.verifyIdentity(target, fresh)) {
      const error = new Error(`identity changed before SIGKILL for pid ${target.pid}`);
      error.code = 'IDENTITY_MISMATCH';
      throw error;
    }
    reportEntry.signal = 'SIGKILL';
    this.processTable.signal(target.pid, 'SIGKILL');
    if (await this.waitForExit(target)) {
      reportEntry.result = 'exited';
    } else {
      reportEntry.result = 'still-running';
      const error = new Error(`process ${target.pid} remained alive after SIGKILL`);
      error.code = 'CLEANUP_FAILED';
      throw error;
    }
  }

  /**
   * @param {object} lease
   * @param {string} reason
   * @param {{leasePath?:string, outsideProbePid?:number, artifacts?:string[], graceMs?:number, rootExitConfirmed?:boolean}} [options]
   * @returns {Promise<object>}
   */
  async cleanup(lease, reason = 'manual', options = {}) {
    const startedAt = new Date().toISOString();
    const artifactsBefore = captureArtifacts(options.artifacts ?? lease.artifacts ?? []);
    /** @type {object[]} */
    const targetsReport = [];
    /** @type {object[]} */
    const skipped = [];
    /** @type {string[]} */
    const errors = [];
    let decision = 'NOOP';
    let rootVerification = { ok: false, pid: lease.root.pid, identity_hash: lease.root.identity_hash };
    let protectedIntact = true;
    const originalGrace = this.graceMs;
    if (options.graceMs !== undefined) this.graceMs = options.graceMs;

    try {
      const worktreeCheck = this.leaseStore.verifyCurrentWorktree(lease);
      if (!worktreeCheck.ok) {
        decision = 'ABORTED';
        errors.push(worktreeCheck.reason ?? 'WORKTREE_MISMATCH');
      } else {
        const freshRoot = this.processTable.snapshotOne(lease.root.pid);
        if (freshRoot === null) {
          rootVerification = {
            ok: false,
            pid: lease.root.pid,
            identity_hash: lease.root.identity_hash,
            reason: 'ROOT_NOT_RUNNING',
          };
        } else if (!this.verifyIdentity(lease.root, freshRoot)) {
          if (options.rootExitConfirmed || lease.state === 'FINISHED') {
            // The direct child already reported exit. A different identity at
            // the same PID is therefore post-exit reuse: skip it without a
            // signal and without turning a successful command into a failure.
            rootVerification = {
              ok: false,
              pid: lease.root.pid,
              identity_hash: freshRoot.identity_hash,
              reason: 'PID_REUSED_AFTER_CONFIRMED_EXIT',
            };
            skipped.push({
              pid: lease.root.pid,
              identity_hash: freshRoot.identity_hash,
              reason: 'PID_REUSED_AFTER_CONFIRMED_EXIT',
            });
          } else {
            decision = 'ABORTED';
            rootVerification = {
              ok: false,
              pid: lease.root.pid,
              identity_hash: freshRoot.identity_hash,
              reason: 'IDENTITY_MISMATCH',
            };
            errors.push('IDENTITY_MISMATCH');
          }
        } else {
          rootVerification = {
            ok: true,
            pid: freshRoot.pid,
            identity_hash: freshRoot.identity_hash,
          };
          const snapshot = typeof this.processTable.snapshotFresh === 'function'
            ? this.processTable.snapshotFresh()
            : this.processTable.snapshot();
          const descendants = this.confirmDescendants(freshRoot, snapshot);
          // The lease is necessarily written after spawn. On Windows a console
          // host or other OS child can therefore be milliseconds older than the
          // lease even though it is a genuine descendant. The root start time is
          // the strongest portable ownership floor: no child can legitimately
          // predate its parent.
          const ownershipFloorMs = Date.parse(lease.root.start_time ?? lease.created_at);
          for (const descendant of descendants) {
            const startedMs = Date.parse(descendant.start_time ?? '');
            if (Number.isFinite(ownershipFloorMs) && Number.isFinite(startedMs) && startedMs < ownershipFloorMs) {
              decision = 'ABORTED';
              errors.push(`DESCENDANT_PREDATES_ROOT:${descendant.pid}`);
              skipped.push({
                pid: descendant.pid,
                identity_hash: descendant.identity_hash,
                reason: 'DESCENDANT_PREDATES_ROOT',
              });
            }
          }

          if (decision !== 'ABORTED') {
            const orderedDescendants = descendants
              .map((processInfo) => ({
                process: processInfo,
                depth: this.depthOf(freshRoot, processInfo, snapshot),
              }))
              .sort((left, right) => right.depth - left.depth || right.process.pid - left.process.pid)
              .map((entry) => entry.process);
            const allTargets = [...orderedDescendants, freshRoot];
            try {
              this.protectedRegistry.assertNoProtectedTargets(allTargets);
            } catch (error) {
              decision = 'ABORTED';
              protectedIntact = false;
              errors.push(error instanceof Error ? error.message : String(error));
              for (const target of error.targets ?? []) {
                skipped.push({
                  pid: target.pid,
                  identity_hash: target.identity_hash,
                  reason: 'PROTECTED_TARGET',
                });
              }
            }

            if (decision !== 'ABORTED') {
              // Fence every target before sending the first signal. If any
              // identity changed in this window, no signal is safe and none has
              // been sent yet: skip the whole cleanup as a safe NOOP.
              let identityChangedBeforeSignal = false;
              for (const target of allTargets) {
                const fresh = this.processTable.snapshotOne(target.pid);
                const expected = target.pid === freshRoot.pid ? lease.root : target;
                if (!this.verifyIdentity(expected, fresh)) {
                  identityChangedBeforeSignal = true;
                  skipped.push({
                    pid: target.pid,
                    identity_hash: expected.identity_hash,
                    reason: 'IDENTITY_CHANGED_BEFORE_SIGNAL',
                  });
                }
              }
              if (identityChangedBeforeSignal) {
                decision = 'NOOP';
                rootVerification = {
                  ok: false,
                  pid: lease.root.pid,
                  identity_hash: lease.root.identity_hash,
                  reason: 'IDENTITY_CHANGED_BEFORE_SIGNAL',
                };
              }
            }

            if (decision === 'NOOP' && rootVerification.ok) {
              for (const target of allTargets) {
                const fresh = this.processTable.snapshotOne(target.pid);
                const expected = target.pid === freshRoot.pid ? lease.root : target;
                if (fresh === null) {
                  targetsReport.push({
                    pid: target.pid,
                    identity_hash: expected.identity_hash,
                    identity_ok: true,
                    signal: null,
                    result: 'exited',
                    verified_at: new Date().toISOString(),
                  });
                  continue;
                }
                if (!this.verifyIdentity(expected, fresh)) {
                  if (target.pid === freshRoot.pid && options.rootExitConfirmed) {
                    // The direct root exited or its PID was recycled while
                    // descendants were being terminated. No root signal is
                    // needed; skipping is safe and completes the cleanup.
                    skipped.push({
                      pid: target.pid,
                      identity_hash: expected.identity_hash,
                      reason: 'ROOT_EXITED_OR_REUSED_BEFORE_SIGNAL',
                    });
                    continue;
                  }
                  decision = 'ABORTED';
                  errors.push(`IDENTITY_MISMATCH:${target.pid}`);
                  skipped.push({
                    pid: target.pid,
                    identity_hash: expected.identity_hash,
                    reason: 'IDENTITY_MISMATCH',
                  });
                  break;
                }
                try {
                  await this.terminate(fresh, targetsReport);
                  decision = 'CLEANED';
                } catch (error) {
                  decision = 'ABORTED';
                  errors.push(error instanceof Error ? error.message : String(error));
                  break;
                }
              }
            }
          }
        }
      }
    } catch (error) {
      decision = 'ABORTED';
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      this.graceMs = originalGrace;
    }

    let outsideProbe = null;
    if (options.outsideProbePid !== undefined) {
      outsideProbe = {
        pid: options.outsideProbePid,
        alive: this.processTable.isAlive(options.outsideProbePid),
      };
    }
    const artifactsAfter = captureArtifacts(options.artifacts ?? lease.artifacts ?? []);
    const artifactsIntact = artifactsEqual(artifactsBefore, artifactsAfter);
    if (!artifactsIntact) errors.push('ARTIFACTS_CHANGED_OR_MISSING');

    if (options.leasePath) {
      lease.state = decision === 'ABORTED' ? 'ABORTED' : 'FINISHED';
      lease.finished_at = new Date().toISOString();
      try {
        this.leaseStore.update(options.leasePath, lease);
      } catch (error) {
        decision = 'ABORTED';
        errors.push(`LEASE_UPDATE_FAILED:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      schema: 'workbuddy-dev-memory/cleanup/v1',
      run_id: lease.run_id,
      decision,
      reason,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      root_verification: rootVerification,
      targets: targetsReport,
      skipped,
      outside_probe: outsideProbe,
      protected_intact: protectedIntact,
      artifacts_intact: artifactsIntact,
      errors,
    };
  }

  /**
   * @param {object} root
   * @param {object} target
   * @param {object[]} processes
   * @returns {number}
   */
  depthOf(root, target, processes) {
    const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
    let depth = 0;
    let current = target;
    const visited = new Set();
    while (current && current.pid !== root.pid && !visited.has(current.pid)) {
      visited.add(current.pid);
      depth += 1;
      current = byPid.get(current.ppid);
    }
    return current?.pid === root.pid ? depth : Number.MAX_SAFE_INTEGER;
  }
}
