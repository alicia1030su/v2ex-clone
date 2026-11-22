import { ReportStore } from '../report-store.mjs';
import { confirmedDescendants, verifyProcessIdentity } from './process-table.mjs';

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sleepInterruptibly(milliseconds, signal) {
  if (!signal) return sleep(milliseconds);
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

function roundOne(value) {
  return Number(value.toFixed(1));
}

/**
 * Nearest-rank P95 as required by the report contract.
 *
 * @param {number[]} values
 * @returns {number}
 */
export function nearestRankP95(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
  return roundOne(sorted[index]);
}

/**
 * @param {object[]} samples
 * @returns {{peak_tree_rss_mb:number, peak_process_rss_mb:number, p95_tree_rss_mb:number, sample_count:number}}
 */
export function summarizeSamples(samples) {
  const treeValues = samples.map((sample) => sample.tree_rss_mb);
  return {
    peak_tree_rss_mb: treeValues.length > 0 ? roundOne(Math.max(...treeValues)) : 0,
    peak_process_rss_mb: samples.length > 0
      ? roundOne(Math.max(...samples.map((sample) => sample.max_process_rss_mb)))
      : 0,
    p95_tree_rss_mb: nearestRankP95(treeValues),
    sample_count: samples.length,
  };
}

/**
 * Independent 1 Hz process-tree monitor.
 */
export class ProcessMonitor {
  /**
   * @param {{processTable:object, reportStore?:ReportStore, platform?:string}} dependencies
   */
  constructor(dependencies) {
    if (!dependencies?.processTable) throw new Error('processTable is required');
    this.processTable = dependencies.processTable;
    this.reportStore = dependencies.reportStore ?? new ReportStore();
    this.platform = dependencies.platform ?? process.platform;
  }

  /**
   * @param {object} lease
   * @returns {object}
   */
  sample(lease) {
    // Consume the latest completed tree snapshot. On Windows the expensive
    // enumeration refreshes in a dedicated worker so the monitor tick itself
    // remains bounded; cleanup and protected checks force a fresh snapshot.
    let processes = typeof this.processTable.snapshotCached === 'function'
      ? this.processTable.snapshotCached()
      : this.processTable.snapshot();
    if (
      !processes.some((entry) => entry.pid === lease.root.pid) &&
      typeof this.processTable.snapshotFresh === 'function'
    ) {
      // A cache captured before spawn must not be mistaken for a dead root.
      processes = this.processTable.snapshotFresh();
    }
    // The sampling instant is when the tree data became available, not when a
    // potentially slow first-cache warm-up began.
    const at = new Date().toISOString();
    const monotonicNs = process.hrtime.bigint();
    const freshRoot = processes.find((entry) => entry.pid === lease.root.pid) ?? null;
    if (freshRoot === null) {
      return {
        at,
        monotonic_ns: monotonicNs.toString(),
        elapsed_ms: 0,
        processes: [],
        tree_rss_mb: 0,
        max_process_rss_mb: 0,
        error: 'ROOT_NOT_RUNNING',
      };
    }
    if (!verifyProcessIdentity(lease.root, freshRoot, this.platform)) {
      return {
        at,
        monotonic_ns: monotonicNs.toString(),
        elapsed_ms: 0,
        processes: [],
        tree_rss_mb: 0,
        max_process_rss_mb: 0,
        error: 'IDENTITY_MISMATCH',
      };
    }

    const descendants = confirmedDescendants(freshRoot, processes).map((entry) => entry.process);
    const tree = [freshRoot, ...descendants];
    const rows = tree.map((processInfo) => ({
      pid: processInfo.pid,
      ppid: processInfo.ppid,
      name: processInfo.name,
      rss_mb: processInfo.rss_mb,
      start_time: processInfo.start_time,
      identity_hash: processInfo.identity_hash,
    }));
    const rssValues = rows.map((row) => row.rss_mb);
    return {
      at,
      monotonic_ns: monotonicNs.toString(),
      elapsed_ms: 0,
      processes: rows,
      tree_rss_mb: roundOne(rssValues.reduce((sum, value) => sum + value, 0)),
      max_process_rss_mb: rssValues.length > 0 ? roundOne(Math.max(...rssValues)) : 0,
      error: null,
    };
  }

  /**
   * @param {object[]} samples
   * @param {object} metadata
   * @returns {object}
   */
  summarize(samples, metadata = {}) {
    const summary = summarizeSamples(samples);
    const first = samples[0];
    const last = samples[samples.length - 1];
    const wallClockMs = metadata.wallClockMs ?? (
      first && last ? Number(BigInt(last.monotonic_ns) - BigInt(first.monotonic_ns)) / 1_000_000 : 0
    );
    return {
      root_pid: metadata.rootPid,
      ...summary,
      wall_clock_ms: Number(wallClockMs.toFixed(1)),
      exit_code: metadata.exitCode ?? null,
      signal: metadata.signal ?? null,
      command: metadata.command ? [...metadata.command] : [],
      commit: metadata.commit ?? null,
      profile: metadata.profile ?? null,
      machine_id: metadata.machineId ?? null,
      monitor_errors: [...(metadata.monitorErrors ?? [])],
    };
  }

  /**
   * Sample immediately and then at the requested cadence until `shouldStop`.
   *
   * @param {object} lease
   * @param {string} reportPath
   * @param {{
   *   intervalMs?:number,
   *   shouldStop?:()=>boolean,
   *   onSample?:(sample:object, state:{consecutiveOverBudget:number})=>void|Promise<void>,
   *   budgetMB?:number,
   *   exitCode?:()=>number|null,
   *   signal?:()=>string|null,
   *   machineId?:string,
   *   stopSignal?:AbortSignal,
   * }} [options]
   * @returns {Promise<object>}
   */
  async run(lease, reportPath, options = {}) {
    const intervalMs = options.intervalMs ?? 1_000;
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > 10_000) {
      throw new Error('monitor interval must be between 100 and 10000 ms');
    }
    // The requested interval is the maximum report cadence. Windows process
    // enumeration can approach one second under load, so schedule at 2 Hz and
    // let a slow snapshot consume the headroom rather than emit a false >1 s
    // interval failure. Fewer than one sample per second is never allowed.
    const cadenceMs = Math.max(1, Math.floor(intervalMs / 2));
    const shouldStop = options.shouldStop ?? (() => false);
    const startedAt = new Date().toISOString();
    const startedNs = process.hrtime.bigint();
    /** @type {object[]} */
    const samples = [];
    /** @type {string[]} */
    const monitorErrors = [];
    let consecutiveOverBudget = 0;
    let nextDeadline = Date.now();
    let previousSampleNs = null;
    let firstSample = true;

    const buildReport = () => {
      const endedNs = process.hrtime.bigint();
      return {
        schema: 'workbuddy-dev-memory/monitor/v1',
        run_id: lease.run_id,
        started_at: startedAt,
        ended_at: new Date().toISOString(),
        interval_ms: intervalMs,
        samples,
        summary: this.summarize(samples, {
          rootPid: lease.root.pid,
          wallClockMs: Number(endedNs - startedNs) / 1_000_000,
          exitCode: options.exitCode?.(),
          signal: options.signal?.(),
          command: lease.command.argv,
          commit: lease.worktree.git_head,
          profile: lease.profile,
          machineId: options.machineId,
          monitorErrors,
        }),
      };
    };

    while (true) {
      const sample = this.sample(lease);
      const sampleNs = BigInt(sample.monotonic_ns);
      if (previousSampleNs !== null) {
        sample.elapsed_ms = Number(sampleNs - previousSampleNs) / 1_000_000;
        if (sampleNs - previousSampleNs > BigInt(intervalMs) * 1_000_000n) {
          monitorErrors.push('SAMPLING_INTERVAL_EXCEEDED');
        }
      } else {
        sample.elapsed_ms = 0;
      }
      previousSampleNs = sampleNs;
      samples.push(sample);

      if (sample.error && sample.error !== 'ROOT_NOT_RUNNING') {
        monitorErrors.push(sample.error);
      }
      const budgetMB = options.budgetMB ?? lease.budget_mb;
      if (sample.tree_rss_mb > budgetMB * 1.1) consecutiveOverBudget += 1;
      else consecutiveOverBudget = 0;

      const report = buildReport();
      this.reportStore.writeAtomic(reportPath, report);

      if (options.onSample) {
        try {
          await options.onSample(sample, { consecutiveOverBudget });
        } catch (error) {
          monitorErrors.push(`ON_SAMPLE_FAILED:${error instanceof Error ? error.message : String(error)}`);
          this.reportStore.writeAtomic(reportPath, buildReport());
        }
      }

      if (sample.error === 'ROOT_NOT_RUNNING') break;
      if (sample.error === 'IDENTITY_MISMATCH') break;
      if (shouldStop()) break;

      if (firstSample) {
        firstSample = false;
        nextDeadline = Date.now();
      } else {
        nextDeadline += cadenceMs;
      }
      const delay = nextDeadline - Date.now();
      if (delay > 0) await sleepInterruptibly(delay, options.stopSignal);
      else await sleepInterruptibly(0, options.stopSignal);
      if (shouldStop()) break;
    }

    const finalReport = buildReport();
    this.reportStore.writeAtomic(reportPath, finalReport);
    return finalReport;
  }
}
