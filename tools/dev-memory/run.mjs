import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PreflightService } from './preflight.mjs';
import { createProcessTable } from './lib/process-table.mjs';
import { BudgetPlanner } from './lib/budget-planner.mjs';
import { LeaseStore } from './lib/ownership-lease.mjs';
import { ProtectedProcessRegistry } from './lib/protected-registry.mjs';
import { SafeCleaner } from './lib/safe-cleaner.mjs';
import { ProcessMonitor } from './lib/monitor-core.mjs';
import { ReportStore } from './report-store.mjs';
import { machineId } from './lib/worktree.mjs';
import { CliError, optionalInteger, parseArgs, requireString } from './cli-args.mjs';

function isMain() {
  if (!process.argv[1]) return false;
  return pathToFileURL(process.argv[1]).href === import.meta.url;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseEnvironmentAdditions(values) {
  /** @type {Record<string, string>} */
  const additions = {};
  for (const value of values) {
    const equalAt = value.indexOf('=');
    if (equalAt <= 0) throw new Error(`--env expects KEY=VALUE, received: ${value}`);
    const key = value.slice(0, equalAt);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid environment key: ${key}`);
    additions[key] = value.slice(equalAt + 1);
  }
  return additions;
}

function withHeapLimit(existing, heapMB) {
  const withoutExisting = String(existing ?? '')
    .replace(/--max-old-space-size(?:=|\s+)\d+/g, ' ')
    .trim();
  return `${withoutExisting}${withoutExisting ? ' ' : ''}--max-old-space-size=${heapMB}`;
}

function waitForStream(stream) {
  return new Promise((resolve, reject) => {
    stream.once('finish', resolve);
    stream.once('error', reject);
  });
}

/**
 * Resource-guarded command supervisor.
 */
export class RunOrchestrator {
  /**
   * @param {{
   *   preflight?:PreflightService,
   *   processTable?:object,
   *   reportStore?:ReportStore,
   *   leaseStore?:LeaseStore,
   *   spawn?:typeof spawn,
   * }} [dependencies]
   */
  constructor(dependencies = {}) {
    this.processTable = dependencies.processTable ?? createProcessTable();
    this.preflight = dependencies.preflight ?? new PreflightService({
      processTable: this.processTable,
    });
    this.reportStore = dependencies.reportStore ?? new ReportStore();
    this.leaseStore = dependencies.leaseStore ?? new LeaseStore({ reportStore: this.reportStore });
    this.spawn = dependencies.spawn ?? spawn;
  }

  /**
   * @param {{
   *   profile:string,
   *   command:string[],
   *   worktree?:string,
   *   jsonDir?:string,
   *   unsafeOverride?:boolean,
   *   reserveMB?:number,
   *   userCeilingMB?:number,
   *   mode?:'standard'|'low',
   *   envAdditions?:Record<string,string>,
   *   intervalMs?:number,
   *   timeoutMs?:number,
   *   verbose?:boolean,
   *   quiet?:boolean,
   * }} options
   * @returns {Promise<number>}
   */
  async run(options) {
    if (!Array.isArray(options.command) || options.command.length === 0) {
      throw new Error('run requires an exact command after --');
    }
    const emit = (value) => {
      if (!options.quiet) process.stdout.write(`${JSON.stringify(value)}\n`);
    };
    const worktreeInput = options.worktree ?? '.';
    const jsonDir = path.resolve(options.jsonDir ?? path.join('test-results', 'dev-memory'));
    const runId = randomBytes(16).toString('hex');
    const runDir = path.join(
      jsonDir,
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${runId.slice(0, 8)}`,
    );
    fs.mkdirSync(runDir, { recursive: true });
    const preflightPath = path.join(runDir, 'preflight.json');
    const leasePath = path.join(runDir, 'lease.json');
    const monitorPath = path.join(runDir, 'monitor.json');
    const cleanupPath = path.join(runDir, 'cleanup.json');
    const commandLogPath = path.join(runDir, 'command.log');

    const envAdditions = options.envAdditions ?? {};
    const childEnv = { ...process.env, ...envAdditions };
    const preflight = this.preflight.preflight({
      profile: options.profile,
      worktree: worktreeInput,
      argv: options.command,
      unsafeOverride: options.unsafeOverride,
      reserveMB: options.reserveMB,
      userCeilingMB: options.userCeilingMB,
      runId,
      env: childEnv,
    });
    this.reportStore.writeAtomic(preflightPath, preflight);
    if (preflight.decision === 'DENY') {
      emit({ preflight: preflightPath, decision: 'DENY' });
      return 2;
    }

    const owner = this.processTable.snapshotOne(process.pid);
    if (!owner) {
      const denied = {
        ...preflight,
        decision: 'DENY',
        unsafe: false,
        reason_codes: [...new Set([...preflight.reason_codes, 'OWNER_IDENTITY_UNMEASURABLE'])],
      };
      this.reportStore.writeAtomic(preflightPath, denied);
      emit({ preflight: preflightPath, decision: 'DENY' });
      return 2;
    }

    const planner = this.preflight.budgetPlanner;
    let slot;
    try {
      slot = planner.acquireSlot(runId, preflight, {
        worktreeRoot: preflight.worktree.root,
        owner,
        profile: options.profile,
      });
    } catch (error) {
      const denied = {
        ...preflight,
        decision: 'DENY',
        unsafe: false,
        reason_codes: [
          ...new Set([
            ...preflight.reason_codes,
            `BUDGET_SLOT_CONFLICT:${error instanceof Error ? error.message : String(error)}`,
          ]),
        ],
      };
      this.reportStore.writeAtomic(preflightPath, denied);
      emit({ preflight: preflightPath, decision: 'DENY' });
      return 2;
    }

    const protectedRegistry = new ProtectedProcessRegistry({ processTable: this.processTable });
    let protectedProcesses = [];
    try {
      protectedProcesses = protectedRegistry.snapshot();
    } catch (error) {
      planner.releaseSlot(runId);
      const denied = {
        ...preflight,
        decision: 'DENY',
        unsafe: false,
        reason_codes: [
          ...new Set([
            ...preflight.reason_codes,
            `PROTECTED_REGISTRY_FAILED:${error instanceof Error ? error.message : String(error)}`,
          ]),
        ],
      };
      this.reportStore.writeAtomic(preflightPath, denied);
      emit({ preflight: preflightPath, decision: 'DENY' });
      return 2;
    }

    if (options.mode === 'low') {
      childEnv.NODE_OPTIONS = withHeapLimit(
        childEnv.NODE_OPTIONS,
        preflight.plan.runtime.node_max_old_space_mb,
      );
      if (options.profile === 'next-build' || options.profile === 'next-dev') {
        childEnv.WORKBUDDY_NEXT_CPUS = String(preflight.plan.runtime.next_build_cpus);
      }
    }

    const logStream = createWriteStream(commandLogPath, { flags: 'a', mode: 0o600 });
    const logFinished = waitForStream(logStream).catch(() => undefined);
    let child;
    try {
      child = this.spawn(options.command[0], options.command.slice(1), {
        cwd: preflight.worktree.root,
        env: childEnv,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      logStream.end();
      planner.releaseSlot(runId);
      throw error;
    }

    if (options.verbose) {
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
    }
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    /** @type {{code:number|null, signal:string|null, error:Error|null}} */
    const childResult = { code: null, signal: null, error: null };
    const monitorStop = new AbortController();
    const childExit = new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        childResult.code = code;
        childResult.signal = signal;
        monitorStop.abort();
        resolve();
      });
      child.once('error', (error) => {
        childResult.error = error;
        childResult.code = -1;
        monitorStop.abort();
        resolve();
      });
    });

    let root = null;
    const spawnedAtMs = Date.now();
    const bindDeadline = spawnedAtMs + 5_000;
    while (root === null && Date.now() < bindDeadline && childResult.code === null) {
      const candidate = this.processTable.snapshotOne(child.pid);
      if (candidate !== null) {
        // Let the child exit event run once more before accepting an identity.
        // This closes the spawn -> CIM query race in which a short-lived PID
        // could already have exited and been recycled.
        await sleep(0);
        if (childResult.code === null && childResult.signal === null) root = candidate;
      }
      if (root === null) await sleep(25);
    }
    if (root === null) {
      if (childResult.code === null) {
        try {
          child.kill('SIGKILL');
        } catch {
          // The child may have exited between the check and signal.
        }
      }
      await childExit.catch(() => undefined);
      logStream.end();
      planner.releaseSlot(runId);
      const monitorFailure = {
        schema: 'workbuddy-dev-memory/monitor/v1',
        run_id: runId,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        interval_ms: options.intervalMs ?? 1_000,
        samples: [],
        summary: {
          root_pid: child.pid,
          peak_tree_rss_mb: 0,
          peak_process_rss_mb: 0,
          p95_tree_rss_mb: 0,
          sample_count: 0,
          wall_clock_ms: 0,
          exit_code: childResult.code,
          signal: childResult.signal,
          command: [...options.command],
          commit: preflight.worktree.git_head,
          profile: options.profile,
          machine_id: machineId({ platform: process.platform }),
          monitor_errors: ['ROOT_IDENTITY_UNMEASURABLE'],
        },
      };
      this.reportStore.writeAtomic(monitorPath, monitorFailure);
      emit({ preflight: preflightPath, monitor: monitorPath, exit_code: 3 });
      return 3;
    }

    let lease;
    try {
      lease = this.leaseStore.create({
        runId,
        worktree: preflight.worktree,
        command: preflight.command,
        budgetMB: preflight.plan.task_budget_mb,
        profile: options.profile,
        root,
        observed: [],
        protected: protectedProcesses,
        platform: process.platform,
        artifacts: [],
      }, leasePath);
      planner.updateSlot(runId, { root });
    } catch (error) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Preserve the lease establishment failure.
      }
      await childExit.catch(() => undefined);
      logStream.end();
      planner.releaseSlot(runId);
      const monitorFailure = {
        schema: 'workbuddy-dev-memory/monitor/v1',
        run_id: runId,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        interval_ms: options.intervalMs ?? 1_000,
        samples: [],
        summary: {
          root_pid: child.pid,
          peak_tree_rss_mb: 0,
          peak_process_rss_mb: 0,
          p95_tree_rss_mb: 0,
          sample_count: 0,
          wall_clock_ms: 0,
          exit_code: childResult.code,
          signal: childResult.signal,
          command: [...options.command],
          commit: preflight.worktree.git_head,
          profile: options.profile,
          machine_id: machineId({ platform: process.platform }),
          monitor_errors: [`LEASE_CREATION_FAILED:${error instanceof Error ? error.message : String(error)}`],
        },
      };
      this.reportStore.writeAtomic(monitorPath, monitorFailure);
      emit({ preflight: preflightPath, monitor: monitorPath, exit_code: 3 });
      return 3;
    }

    const cleaner = new SafeCleaner({
      processTable: this.processTable,
      protectedRegistry,
      leaseStore: this.leaseStore,
      reportStore: this.reportStore,
    });
    const monitor = new ProcessMonitor({
      processTable: this.processTable,
      reportStore: this.reportStore,
    });
    let timeoutTriggered = false;
    let cleanupInitiated = false;
    const initiateCleanup = async (reason) => {
      if (cleanupInitiated) return;
      cleanupInitiated = true;
      try {
        budgetCleanupReport = await cleaner.cleanup(lease, reason, { leasePath });
      } catch (error) {
        budgetCleanupReport = {
          schema: 'workbuddy-dev-memory/cleanup/v1',
          run_id: lease.run_id,
          decision: 'ABORTED',
          reason,
          root_verification: {
            ok: false,
            pid: lease.root.pid,
            identity_hash: lease.root.identity_hash,
          },
          targets: [],
          skipped: [],
          outside_probe: null,
          protected_intact: true,
          artifacts_intact: true,
          errors: [error instanceof Error ? error.message : String(error)],
        };
      }
      this.reportStore.writeAtomic(cleanupPath, budgetCleanupReport);
    };
    const timeout = options.timeoutMs > 0
      ? setTimeout(() => {
          timeoutTriggered = true;
          void initiateCleanup('timeout');
        }, options.timeoutMs)
      : null;

    let receivedSignal = null;
    const signalHandler = (signal) => {
      receivedSignal = signal;
      void initiateCleanup(`supervisor-${signal}`);
    };
    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);

    let budgetCleanupReport = null;
    let monitorReport;
    try {
      monitorReport = await monitor.run(lease, monitorPath, {
        intervalMs: options.intervalMs ?? 1_000,
        machineId: machineId({ platform: process.platform }),
        budgetMB: lease.budget_mb,
        shouldStop: () => (
          childResult.code !== null ||
          childResult.signal !== null ||
          budgetCleanupReport?.decision === 'ABORTED'
        ),
        exitCode: () => childResult.code,
        signal: () => childResult.signal,
        stopSignal: monitorStop.signal,
        onSample: async (_sample, state) => {
          if (state.consecutiveOverBudget < 3) return;
          await initiateCleanup('budget-exceeded');
        },
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);
    }

    let cleanupReport = budgetCleanupReport;
    if (!cleanupReport) {
      // Allow the direct child exit event to update childResult before the
      // post-run cleanup identity check. This closes the Windows PID-reuse
      // race without ever signaling a recycled PID.
      if (childResult.code === null && childResult.signal === null) {
        await Promise.race([childExit, sleep(250)]);
      }
      if (monitorReport.summary.exit_code === null && monitorReport.summary.signal === null) {
        monitorReport.summary.exit_code = childResult.code;
        monitorReport.summary.signal = childResult.signal;
        monitorReport.ended_at = new Date().toISOString();
        this.reportStore.writeAtomic(monitorPath, monitorReport);
      }
      const reason = monitorReport.summary.monitor_errors.length > 0
        ? 'monitor-failed'
        : timeoutTriggered
          ? 'timeout'
          : receivedSignal
            ? `supervisor-${receivedSignal}`
            : 'run-finished';
      const monitorObservedRootExit = monitorReport.samples.some(
        (sample) => sample.error === 'ROOT_NOT_RUNNING',
      );
      cleanupReport = await cleaner.cleanup(lease, reason, {
        leasePath,
        rootExitConfirmed: (
          childResult.code !== null ||
          childResult.signal !== null ||
          monitorObservedRootExit
        ),
      });
      this.reportStore.writeAtomic(cleanupPath, cleanupReport);
    }

    if (cleanupReport.decision === 'ABORTED' && childResult.code === null && childResult.signal === null) {
      // A protected target means no signal is safe. Detach the exact child and
      // leave it running rather than violating the protected-process fence.
      child.unref();
      child.stdout.destroy();
      child.stderr.destroy();
      logStream.end();
      await logFinished;
      planner.releaseSlot(runId);
      const summary = {
        run_id: runId,
        exit_code: 4,
        decision: preflight.decision,
        profile: options.profile,
        mode: options.mode ?? 'low',
        reports: {
          preflight: preflightPath,
          lease: leasePath,
          monitor: monitorPath,
          cleanup: cleanupPath,
          command_log: commandLogPath,
        },
        peak_tree_rss_mb: monitorReport.summary.peak_tree_rss_mb,
        wall_clock_ms: monitorReport.summary.wall_clock_ms,
      };
      emit(summary);
      return 4;
    }

    if (childResult.code === null && childResult.signal === null) {
      await Promise.race([childExit, sleep(2_000)]);
      if (childResult.code === null && childResult.signal === null) {
        cleanupReport.decision = 'ABORTED';
        cleanupReport.errors.push('CHILD_STILL_RUNNING_AFTER_CLEANUP');
        this.reportStore.writeAtomic(cleanupPath, cleanupReport);
        child.unref();
        child.stdout.destroy();
        child.stderr.destroy();
        logStream.end();
        await logFinished;
        planner.releaseSlot(runId);
        emit({
          run_id: runId,
          exit_code: 4,
          decision: preflight.decision,
          profile: options.profile,
          mode: options.mode ?? 'low',
          reports: {
            preflight: preflightPath,
            lease: leasePath,
            monitor: monitorPath,
            cleanup: cleanupPath,
            command_log: commandLogPath,
          },
          peak_tree_rss_mb: monitorReport.summary.peak_tree_rss_mb,
          wall_clock_ms: monitorReport.summary.wall_clock_ms,
        });
        return 4;
      }
    }

    await childExit.catch(() => undefined);
    logStream.end();
    try {
      await logFinished;
    } catch {
      // A closed stdout pipe can surface here; the command result remains valid.
    }
    planner.releaseSlot(runId);

    let exitCode;
    if (cleanupReport.decision === 'ABORTED') exitCode = 4;
    else if (monitorReport.summary.monitor_errors.length > 0) exitCode = 3;
    else if (timeoutTriggered || receivedSignal) exitCode = 1;
    else if (typeof childResult.code === 'number' && childResult.code >= 0) exitCode = childResult.code;
    else exitCode = 1;

    const summary = {
      run_id: runId,
      exit_code: exitCode,
      decision: preflight.decision,
      profile: options.profile,
      mode: options.mode ?? 'low',
      reports: {
        preflight: preflightPath,
        lease: leasePath,
        monitor: monitorPath,
        cleanup: cleanupPath,
        command_log: commandLogPath,
      },
      peak_tree_rss_mb: monitorReport.summary.peak_tree_rss_mb,
      wall_clock_ms: monitorReport.summary.wall_clock_ms,
    };
    emit(summary);
    return exitCode;
  }
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv, {
      profile: { type: 'string' },
      worktree: { type: 'string' },
      'json-dir': { type: 'string' },
      'unsafe-override': { type: 'boolean' },
      'reserve-mb': { type: 'string' },
      'ceiling-mb': { type: 'string' },
      mode: { type: 'string' },
      env: { type: 'multiple' },
      'interval-ms': { type: 'string' },
      'timeout-ms': { type: 'string' },
      verbose: { type: 'boolean' },
    });
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message);
      return error.exitCode;
    }
    throw error;
  }

  try {
    const profile = requireString(parsed.options, 'profile');
    if (parsed.rest.length === 0) throw new Error('missing exact command after --');
    const mode = parsed.options.mode ?? 'low';
    if (mode !== 'standard' && mode !== 'low') throw new Error('--mode must be standard or low');
    const reserveMB = optionalInteger(parsed.options, 'reserve-mb', 0, 0, 1024 * 1024);
    const ceilingMB = optionalInteger(parsed.options, 'ceiling-mb', 0, 1, 1024 * 1024);
    const orchestrator = new RunOrchestrator();
    return await orchestrator.run({
      profile,
      command: parsed.rest,
      worktree: typeof parsed.options.worktree === 'string' ? parsed.options.worktree : '.',
      jsonDir: typeof parsed.options['json-dir'] === 'string'
        ? parsed.options['json-dir']
        : path.join('test-results', 'dev-memory'),
      unsafeOverride: parsed.options['unsafe-override'] === true,
      reserveMB: reserveMB || undefined,
      userCeilingMB: ceilingMB || undefined,
      mode,
      envAdditions: parseEnvironmentAdditions(
        Array.isArray(parsed.options.env) ? parsed.options.env : [],
      ),
      intervalMs: optionalInteger(parsed.options, 'interval-ms', 1_000, 100, 10_000),
      timeoutMs: optionalInteger(parsed.options, 'timeout-ms', 0, 0, 24 * 60 * 60 * 1_000),
      verbose: parsed.options.verbose === true,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (isMain()) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
