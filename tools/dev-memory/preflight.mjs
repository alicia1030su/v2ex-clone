import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { MemoryProbe } from './lib/memory-probe.mjs';
import { BudgetPlanner } from './lib/budget-planner.mjs';
import { createProcessTable } from './lib/process-table.mjs';
import { ReportStore } from './report-store.mjs';
import { WorktreeIdentityService, environmentFingerprint, machineId } from './lib/worktree.mjs';
import { PROFILE_NAMES } from './profiles.mjs';
import {
  CliError,
  optionalInteger,
  parseArgs,
  requireString,
} from './cli-args.mjs';

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
}

/** Preflight application service shared by the CLI and supervisor. */
export class PreflightService {
  /**
   * @param {{
   *   memoryProbe?:MemoryProbe,
   *   budgetPlanner?:BudgetPlanner,
   *   worktree?:WorktreeIdentityService,
   *   processTable?:object,
   *   reportStore?:ReportStore,
   * }} [dependencies]
   */
  constructor(dependencies = {}) {
    this.memoryProbe = dependencies.memoryProbe ?? new MemoryProbe();
    this.processTable = dependencies.processTable ?? createProcessTable();
    this.budgetPlanner = dependencies.budgetPlanner ?? new BudgetPlanner({ processTable: this.processTable });
    this.worktree = dependencies.worktree ?? new WorktreeIdentityService();
    this.reportStore = dependencies.reportStore ?? new ReportStore();
  }

  /**
   * @param {{
   *   profile:string,
   *   worktree:string,
   *   argv:string[],
   *   cwd?:string,
   *   unsafeOverride?:boolean,
   *   reserveMB?:number,
   *   userCeilingMB?:number,
   *   runId?:string,
   *   env?:NodeJS.ProcessEnv,
   * }} input
   * @returns {object}
   */
  preflight(input) {
    if (!PROFILE_NAMES.includes(input.profile)) {
      throw new Error(`unknown profile: ${input.profile}`);
    }
    if (!Array.isArray(input.argv) || input.argv.length === 0) {
      throw new Error('preflight requires an exact non-empty argv');
    }
    const worktree = this.worktree.resolve(input.worktree);
    const snapshot = this.memoryProbe.probe();
    let activeBudgets = [];
    try {
      activeBudgets = this.budgetPlanner.listActiveSlots().map((slot) => Number(slot.budget_mb));
    } catch (error) {
      snapshot.errors.push(`BUDGET_SLOT_UNREADABLE:${error instanceof Error ? error.message : String(error)}`);
    }
    const plan = this.budgetPlanner.plan(snapshot, input.profile, activeBudgets, {
      unsafeOverride: input.unsafeOverride,
      reserveMB: input.reserveMB,
      userCeilingMB: input.userCeilingMB,
      cpuCount: Math.max(1, os.cpus().length),
      env: input.env ?? process.env,
    });
    if (plan.decision === 'ALLOW_UNSAFE') plan.reason_codes.push('UNSAFE_OVERRIDE');
    const env = input.env ?? process.env;
    return {
      schema: 'workbuddy-dev-memory/preflight/v1',
      run_id: input.runId ?? randomBytes(16).toString('hex'),
      decision: plan.decision,
      unsafe: plan.unsafe,
      reason_codes: [...new Set(plan.reason_codes)],
      profile: input.profile,
      measured_at: snapshot.measured_at,
      machine: {
        id: machineId({ platform: snapshot.platform }),
        platform: snapshot.platform,
        arch: process.arch,
        node_version: process.version,
        cpu_count: Math.max(1, os.cpus().length),
      },
      worktree,
      limits: {
        ...plan.limits,
        physical_mb: snapshot.physical_mb,
        cgroup: snapshot.cgroup,
      },
      plan: plan.plan,
      command: {
        argv: [...input.argv],
        cwd: worktree.root,
        env_fingerprint: environmentFingerprint(env),
      },
      raw_memory: {
        physical_memory_bytes: snapshot.physical_memory_bytes,
        free_memory_bytes: snapshot.free_memory_bytes,
        cgroup: snapshot.cgroup,
      },
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
      profile: { type: 'string' },
      worktree: { type: 'string' },
      json: { type: 'string' },
      'unsafe-override': { type: 'boolean' },
      'reserve-mb': { type: 'string' },
      'ceiling-mb': { type: 'string' },
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
    const worktree = requireString(parsed.options, 'worktree');
    const jsonPath = requireString(parsed.options, 'json');
    const reserveMB = optionalInteger(parsed.options, 'reserve-mb', 0, 0, 1024 * 1024);
    const ceilingMB = optionalInteger(parsed.options, 'ceiling-mb', 0, 1, 1024 * 1024);
    const service = new PreflightService();
    const commandArgv = parsed.rest.length > 0
      ? parsed.rest
      : [process.execPath, 'tools/dev-memory/preflight.mjs'];
    const report = service.preflight({
      profile,
      worktree,
      argv: commandArgv,
      unsafeOverride: parsed.options['unsafe-override'] === true,
      reserveMB: reserveMB || undefined,
      userCeilingMB: ceilingMB || undefined,
    });
    service.reportStore.writeAtomic(jsonPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report.decision === 'DENY' ? 2 : 0;
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
