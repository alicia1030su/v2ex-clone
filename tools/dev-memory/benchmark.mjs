import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { RunOrchestrator } from './run.mjs';
import { ReportStore } from './report-store.mjs';
import { WorktreeIdentityService, environmentFingerprint, machineId } from './lib/worktree.mjs';
import { CliError, optionalInteger, parseArgs, requireString } from './cli-args.mjs';
import { pathToFileURL } from 'node:url';

const NODE = process.execPath;
const TASKS = Object.freeze({
  'next-build': Object.freeze({
    profile: 'next-build',
    standard: Object.freeze([NODE, 'node_modules/next/dist/bin/next', 'build']),
    low: Object.freeze([NODE, 'node_modules/next/dist/bin/next', 'build']),
  }),
  vitest: Object.freeze({
    profile: 'vitest',
    standard: Object.freeze([NODE, 'node_modules/vitest/vitest.mjs', 'run']),
    low: Object.freeze([
      NODE,
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      'vitest.low.config.ts',
    ]),
  }),
  playwright: Object.freeze({
    profile: 'playwright',
    standard: Object.freeze([NODE, 'node_modules/playwright/cli.js', 'test']),
    low: Object.freeze([
      NODE,
      'node_modules/playwright/cli.js',
      'test',
      '--config',
      'playwright.low.config.ts',
    ]),
  }),
  'visual-audit': Object.freeze({
    profile: 'visual-audit',
    standard: Object.freeze([NODE, 'tools/visual/v021/run-audit.mjs']),
    low: Object.freeze([NODE, 'tools/visual/v021/run-audit.mjs', '--managed-server']),
  }),
});

function isMain() {
  if (!process.argv[1]) return false;
  return pathToFileURL(process.argv[1]).href === import.meta.url;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function maximum(values) {
  return values.length > 0 ? Math.max(...values) : 0;
}

function sha256File(filePath) {
  return `sha256:${createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

/**
 * Before/after benchmark runner and acceptance evaluator.
 */
export class BenchmarkRunner {
  /**
   * @param {{
   *   orchestrator?:RunOrchestrator,
   *   worktree?:WorktreeIdentityService,
   *   reportStore?:ReportStore,
   *   fs?:Pick<fs, 'readdirSync'|'existsSync'>,
   * }} [dependencies]
   */
  constructor(dependencies = {}) {
    this.orchestrator = dependencies.orchestrator ?? new RunOrchestrator();
    this.worktree = dependencies.worktree ?? new WorktreeIdentityService();
    this.reportStore = dependencies.reportStore ?? new ReportStore();
    this.fs = dependencies.fs ?? fs;
  }

  /**
   * @param {object} before
   * @param {object} after
   * @returns {object}
   */
  evaluate(before, after) {
    const beforeSamples = before?.samples ?? [];
    const afterSamples = after?.samples ?? [];
    const beforePeakMedian = median(beforeSamples.map((sample) => sample.peak_tree_rss_mb));
    const afterPeakMax = maximum(afterSamples.map((sample) => sample.peak_tree_rss_mb));
    const beforeWallMedian = median(beforeSamples.map((sample) => sample.wall_clock_ms));
    const afterWallMax = maximum(afterSamples.map((sample) => sample.wall_clock_ms));
    const peakPass = beforeSamples.length === 3 && afterSamples.length === 3 && afterPeakMax < beforePeakMedian;
    const wallPass = beforeSamples.length === 3 && afterSamples.length === 3 &&
      afterWallMax <= beforeWallMedian * 1.3 + 30_000;
    const testsPass = beforeSamples.length === 3 && afterSamples.length === 3 &&
      [...beforeSamples, ...afterSamples].every((sample) => sample.exit_code === 0);
    return {
      aggregate: {
        before_peak_median_mb: beforePeakMedian,
        after_peak_max_mb: afterPeakMax,
        before_wall_median_ms: beforeWallMedian,
        after_wall_max_ms: afterWallMax,
      },
      acceptance: {
        peak_pass: peakPass,
        wall_pass: wallPass,
        tests_pass: testsPass,
        formula: 'afterPeakMax < beforePeakMedian && afterWallMax <= beforeWallMedian*1.3+30000 && testsPass',
        conclusion: peakPass && wallPass && testsPass ? 'completed' : 'not-completed',
      },
    };
  }

  /**
   * @param {string} taskName
   * @param {'standard'|'low'} mode
   * @param {number} index
   * @param {string} jsonDir
   * @returns {Promise<object>}
   */
  async runSample(taskName, mode, index, jsonDir) {
    const task = TASKS[taskName];
    if (!task) throw new Error(`unknown benchmark task: ${taskName}`);
    fs.mkdirSync(jsonDir, { recursive: true });
    const beforeDirs = new Set(this.fs.readdirSync(jsonDir));
    const exitCode = await this.orchestrator.run({
      profile: task.profile,
      command: [...task[mode]],
      worktree: '.',
      jsonDir,
      mode,
      quiet: true,
      intervalMs: 1_000,
    });
    const created = this.fs.readdirSync(jsonDir).filter((entry) => !beforeDirs.has(entry));
    if (created.length !== 1) {
      throw new Error(`expected one report directory for ${taskName}/${mode}#${index}, found ${created.length}`);
    }
    const runDir = path.join(jsonDir, created[0]);
    const monitorPath = path.join(runDir, 'monitor.json');
    const preflightPath = path.join(runDir, 'preflight.json');
    if (!fs.existsSync(monitorPath) || !fs.existsSync(preflightPath)) {
      throw new Error(`missing reports for ${taskName}/${mode}#${index}`);
    }
    const monitor = this.reportStore.read(monitorPath);
    const preflight = this.reportStore.read(preflightPath);
    return {
      run_id: monitor.run_id,
      exit_code: exitCode,
      peak_tree_rss_mb: monitor.summary.peak_tree_rss_mb,
      wall_clock_ms: monitor.summary.wall_clock_ms,
      reports: {
        preflight: preflightPath,
        monitor: monitorPath,
        lease: path.join(runDir, 'lease.json'),
        cleanup: path.join(runDir, 'cleanup.json'),
        command_log: path.join(runDir, 'command.log'),
      },
      decision: preflight.decision,
    };
  }

  /**
   * @param {string} taskName
   * @param {{runs?:number, warmups?:number, mode?:'both'|'standard'|'low', jsonDir?:string, worktree?:string}} [options]
   * @returns {Promise<object>}
   */
  async run(taskName, options = {}) {
    if (!TASKS[taskName]) throw new Error(`unknown benchmark task: ${taskName}`);
    const runs = options.runs ?? 3;
    if (!Number.isSafeInteger(runs) || runs < 1 || runs > 10) {
      throw new Error('benchmark runs must be between 1 and 10');
    }
    const warmups = options.warmups ?? 1;
    const mode = options.mode ?? 'both';
    const jsonDir = path.resolve(options.jsonDir ?? path.join('test-results', 'dev-memory', 'benchmarks', taskName));
    fs.mkdirSync(jsonDir, { recursive: true });
    const warmupId = randomBytes(8).toString('hex');

    if (mode === 'both' || mode === 'standard') {
      for (let index = 0; index < warmups; index += 1) {
        await this.runSample(taskName, 'standard', -(index + 1), path.join(jsonDir, 'warmup'));
      }
    }
    if (mode === 'both' || mode === 'low') {
      for (let index = 0; index < warmups; index += 1) {
        await this.runSample(taskName, 'low', -(index + 1), path.join(jsonDir, 'warmup'));
      }
    }

    /** @type {object[]} */
    const before = [];
    /** @type {object[]} */
    const after = [];
    if (mode === 'both' || mode === 'standard') {
      for (let index = 0; index < runs; index += 1) {
        before.push(await this.runSample(taskName, 'standard', index + 1, path.join(jsonDir, 'before')));
      }
    }
    if (mode === 'both' || mode === 'low') {
      for (let index = 0; index < runs; index += 1) {
        after.push(await this.runSample(taskName, 'low', index + 1, path.join(jsonDir, 'after')));
      }
    }

    const worktree = this.worktree.resolve(options.worktree ?? '.');
    const lockPath = path.join(worktree.root, 'package-lock.json');
    const evaluation = this.evaluate(
      { mode: 'standard', samples: before },
      { mode: 'low', samples: after },
    );
    return {
      schema: 'workbuddy-dev-memory/benchmark/v1',
      task: taskName,
      environment: {
        commit: worktree.git_head,
        tree: worktree.git_tree,
        dependency_lock_sha256: sha256File(lockPath),
        node_version: process.version,
        machine_id: machineId({ platform: process.platform }),
        db_fixture_sha256: null,
        warmup_id: warmupId,
        env_fingerprint: environmentFingerprint(process.env),
      },
      before: { mode: 'standard', samples: before },
      after: { mode: 'low', samples: after },
      aggregate: evaluation.aggregate,
      acceptance: evaluation.acceptance,
    };
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
      task: { type: 'string' },
      mode: { type: 'string' },
      runs: { type: 'string' },
      warmups: { type: 'string' },
      json: { type: 'string' },
      'json-dir': { type: 'string' },
      worktree: { type: 'string' },
    });
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message);
      return error.exitCode;
    }
    throw error;
  }

  try {
    const task = requireString(parsed.options, 'task');
    const reportPath = requireString(parsed.options, 'json');
    const mode = parsed.options.mode ?? 'both';
    if (mode !== 'both' && mode !== 'standard' && mode !== 'low') {
      throw new Error('--mode must be both, standard, or low');
    }
    const runner = new BenchmarkRunner();
    const report = await runner.run(task, {
      runs: optionalInteger(parsed.options, 'runs', 3, 1, 10),
      warmups: optionalInteger(parsed.options, 'warmups', 1, 0, 3),
      mode,
      jsonDir: typeof parsed.options['json-dir'] === 'string'
        ? parsed.options['json-dir']
        : undefined,
      worktree: typeof parsed.options.worktree === 'string' ? parsed.options.worktree : '.',
    });
    runner.reportStore.writeAtomic(reportPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report.acceptance.conclusion === 'completed' ? 0 : 5;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 5;
  }
}

if (isMain()) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 5;
  });
}
