import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProfile } from '../profiles.mjs';

const DEFAULT_RESERVE_MB = 1024;
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function toIntegerMB(value, label, { minimum = 0, nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new Error(`${label} is required`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  if (value < minimum) throw new Error(`${label} must be >= ${minimum}`);
  return value;
}

function parseEnvNumber(raw, label) {
  if (raw === undefined || raw === '') return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  return parsed;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Dynamic memory budget planner and machine-level serialization slots.
 */
export class BudgetPlanner {
  /**
   * @param {{
   *   slotDir?: string,
   *   processTable?: {snapshotOne(pid:number): {identity_hash?:string}|null},
   *   fs?: Pick<fs, 'mkdirSync'|'readdirSync'|'readFileSync'|'writeFileSync'|'unlinkSync'|'statSync'>,
   *   now?: () => Date,
   * }} [dependencies]
   */
  constructor(dependencies = {}) {
    this.slotDir = dependencies.slotDir ?? path.join(os.tmpdir(), 'workbuddy-dev-memory-slots');
    this.processTable = dependencies.processTable;
    this.fs = dependencies.fs ?? fs;
    this.now = dependencies.now ?? (() => new Date());
  }

  /**
   * Apply the PRD MEM-02 formula.
   *
   * @param {object} snapshot
   * @param {string} profileName
   * @param {number[]} [activeBudgets]
   * @param {{unsafeOverride?:boolean, reserveMB?:number|null, userCeilingMB?:number|null, cpuCount?:number, env?:Record<string,string|undefined>}} [options]
   * @returns {object}
   */
  plan(snapshot, profileName, activeBudgets = [], options = {}) {
    const profile = getProfile(profileName);
    /** @type {string[]} */
    const reasons = [];
    let reserveMB = DEFAULT_RESERVE_MB;
    let userCeilingMB = null;

    if (options.reserveMB !== undefined && options.reserveMB !== null) {
      reserveMB = toIntegerMB(options.reserveMB, 'host reserve', { minimum: 0 });
    } else if (options.env?.WORKBUDDY_RESERVE_MB !== undefined) {
      try {
        const parsed = parseEnvNumber(options.env.WORKBUDDY_RESERVE_MB, 'WORKBUDDY_RESERVE_MB');
        reserveMB = parsed === null ? DEFAULT_RESERVE_MB : Math.floor(parsed);
      } catch (error) {
        reasons.push(`INVALID_ENV:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    reserveMB = Math.max(DEFAULT_RESERVE_MB, reserveMB);

    const ceilingRaw = options.userCeilingMB !== undefined
      ? options.userCeilingMB
      : options.env?.WORKBUDDY_USER_CEILING_MB;
    if (ceilingRaw !== undefined && ceilingRaw !== null && ceilingRaw !== '') {
      try {
        const parsed = typeof ceilingRaw === 'number'
          ? ceilingRaw
          : parseEnvNumber(String(ceilingRaw), 'WORKBUDDY_USER_CEILING_MB');
        if (parsed === null || parsed < 1) throw new Error('user ceiling must be >= 1 MB');
        userCeilingMB = Math.floor(parsed);
      } catch (error) {
        reasons.push(`INVALID_ENV:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const physicalMB = toIntegerMB(snapshot?.physical_mb, 'physical_mb', { minimum: 0 });
    const effectiveLimitMB = toIntegerMB(
      snapshot?.effective_limit_mb,
      'effective_limit_mb',
      { minimum: 0 },
    );
    const currentAvailableMB = toIntegerMB(
      snapshot?.current_available_mb,
      'current_available_mb',
      { minimum: 0 },
    );
    const cgroupLimitMB = snapshot?.cgroup_limit_mb === null || snapshot?.cgroup_limit_mb === undefined
      ? null
      : toIntegerMB(snapshot.cgroup_limit_mb, 'cgroup_limit_mb', { minimum: 0 });
    if (Array.isArray(snapshot?.errors) && snapshot.errors.length > 0) {
      reasons.push(...snapshot.errors.map((code) => `MEASUREMENT:${String(code)}`));
    }
    if (physicalMB <= 0 || effectiveLimitMB <= 0) {
      reasons.push('EFFECTIVE_LIMIT_UNMEASURABLE');
    }

    const normalizedActiveBudgets = activeBudgets.map((value, index) =>
      toIntegerMB(value, `activeBudgets[${index}]`, { minimum: 0 }));
    const activeBudgetsMB = normalizedActiveBudgets.reduce((sum, value) => sum + value, 0);
    const availableMB = Math.max(0, effectiveLimitMB - reserveMB);
    const shareBudgetMB = Math.floor(availableMB * profile.taskShare);
    const taskBudgetMB = Math.max(
      1,
      Math.min(
        userCeilingMB ?? effectiveLimitMB,
        Math.max(profile.taskFloorMB, shareBudgetMB),
      ),
    );
    const sumTaskBudgetsPlusReserveMB = activeBudgetsMB + taskBudgetMB + reserveMB;

    let slotConflict = false;
    if (
      taskBudgetMB < profile.taskFloorMB ||
      shareBudgetMB < profile.taskFloorMB ||
      availableMB < profile.taskFloorMB
    ) {
      reasons.push('BELOW_TASK_FLOOR');
    }
    if (currentAvailableMB < profile.taskFloorMB) {
      reasons.push('CURRENT_AVAILABLE_BELOW_FLOOR');
    }
    if (sumTaskBudgetsPlusReserveMB > effectiveLimitMB) {
      // A floor larger than the post-reserve pool is the one budget condition
      // that --unsafe-override may bypass. An existing slot consuming the pool
      // is a serialization conflict and must never be bypassed.
      if (!(availableMB < profile.taskFloorMB && activeBudgetsMB === 0)) {
        reasons.push('BUDGET_EXCEEDS_EFFECTIVE_LIMIT');
        slotConflict = true;
      }
    }

    const structuralReasons = reasons.filter((reason) =>
      reason.startsWith('MEASUREMENT:') ||
      reason.startsWith('INVALID_ENV:') ||
      reason === 'EFFECTIVE_LIMIT_UNMEASURABLE');
    if (slotConflict) structuralReasons.push('BUDGET_EXCEEDS_EFFECTIVE_LIMIT');
    const unsafe = Boolean(options.unsafeOverride) && structuralReasons.length === 0 && reasons.length > 0;
    let decision = 'ALLOW';
    if (structuralReasons.length > 0 || (reasons.length > 0 && !unsafe)) decision = 'DENY';
    else if (unsafe) decision = 'ALLOW_UNSAFE';

    const runtime = this.deriveRuntime(
      { task_budget_mb: taskBudgetMB, task_floor_mb: profile.taskFloorMB, profile: profileName },
      { cpuCount: options.cpuCount ?? 1 },
    );

    return {
      decision,
      unsafe,
      unsafe_override_requested: Boolean(options.unsafeOverride),
      reason_codes: [...new Set(reasons)],
      profile: profileName,
      limits: {
        physical_mb: physicalMB,
        cgroup_limit_mb: cgroupLimitMB,
        effective_limit_mb: effectiveLimitMB,
        host_reserve_mb: reserveMB,
        available_mb: availableMB,
        current_available_mb: currentAvailableMB,
        user_ceiling_mb: userCeilingMB,
      },
      plan: {
        task_floor_mb: profile.taskFloorMB,
        task_share: profile.taskShare,
        active_budgets_mb: activeBudgetsMB,
        task_budget_mb: taskBudgetMB,
        sum_task_budgets_plus_reserve_mb: sumTaskBudgetsPlusReserveMB,
        runtime,
      },
    };
  }

  /**
   * Derive every runtime knob from one task budget.
   *
   * @param {{task_budget_mb:number}} plan
   * @param {{cpuCount?:number}} [options]
   * @returns {{node_max_old_space_mb:number, vitest_max_workers:number, vitest_file_parallelism:boolean, vitest_pool:string, playwright_workers:number, playwright_fully_parallel:boolean, next_build_cpus:number}}
   */
  deriveRuntime(plan, options = {}) {
    const budget = toIntegerMB(plan?.task_budget_mb, 'task_budget_mb', { minimum: 1 });
    const cpuCount = Math.max(1, Math.floor(options.cpuCount ?? 1));
    return {
      node_max_old_space_mb: Math.max(256, Math.floor(budget * 0.6)),
      vitest_max_workers: 1,
      vitest_file_parallelism: false,
      vitest_pool: 'forks',
      playwright_workers: 1,
      playwright_fully_parallel: false,
      next_build_cpus: clamp(Math.floor(budget / 512), 1, Math.min(cpuCount, 4)),
    };
  }

  /**
   * @returns {string}
   */
  ensureSlotDir() {
    this.fs.mkdirSync(this.slotDir, { recursive: true, mode: 0o700 });
    return this.slotDir;
  }

  /**
   * @param {object} slot
   * @returns {boolean}
   */
  isSlotActive(slot) {
    if (!slot || typeof slot !== 'object') return false;
    if (slot.root?.pid !== undefined && this.processTable) {
      try {
        const fresh = this.processTable.snapshotOne(Number(slot.root.pid));
        return Boolean(fresh && fresh.identity_hash === slot.root.identity_hash);
      } catch {
        return false;
      }
    }
    if (slot.owner?.pid !== undefined && this.processTable) {
      try {
        const fresh = this.processTable.snapshotOne(Number(slot.owner.pid));
        return Boolean(fresh && fresh.identity_hash === slot.owner.identity_hash);
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * List active machine-level reservations, recovering only slots whose exact
   * recorded owner/root identity no longer exists.
   *
   * @returns {object[]}
   */
  listActiveSlots() {
    if (!fs.existsSync(this.slotDir)) return [];
    const active = [];
    for (const name of this.fs.readdirSync(this.slotDir)) {
      if (!name.endsWith('.json')) continue;
      const filePath = path.join(this.slotDir, name);
      let slot;
      try {
        slot = JSON.parse(this.fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        throw new Error(`invalid budget slot ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!this.isSlotActive(slot)) {
        try {
          this.fs.unlinkSync(filePath);
        } catch {
          // A concurrent release is harmless.
        }
      } else {
        active.push(slot);
      }
    }
    return active;
  }

  /**
   * Acquire an exclusive machine-level budget slot.
   *
   * @param {string} runId
   * @param {object} plan
   * @param {{worktreeRoot:string, owner?:object, root?:object, profile?:string}} metadata
   * @returns {object}
   */
  acquireSlot(runId, plan, metadata) {
    if (!RUN_ID_PATTERN.test(runId)) throw new Error('run_id must be 16-128 URL-safe characters');
    this.ensureSlotDir();
    const active = this.listActiveSlots();
    const activeBudgets = active.reduce((sum, slot) => sum + Number(slot.budget_mb ?? 0), 0);
    const effectiveLimit = Number(plan?.limits?.effective_limit_mb ?? 0);
    const reserve = Number(plan?.limits?.host_reserve_mb ?? 0);
    const budget = Number(plan?.plan?.task_budget_mb ?? 0);
    if (active.some((slot) => slot.run_id === runId)) {
      throw new Error(`budget slot already exists for run_id ${runId}`);
    }
    if (activeBudgets + budget + reserve > effectiveLimit) {
      const error = new Error('machine-level budget slots are exhausted');
      error.code = 'BUDGET_SLOT_CONFLICT';
      throw error;
    }

    const slot = {
      schema: 'workbuddy-dev-memory/budget-slot/v1',
      run_id: runId,
      created_at: this.now().toISOString(),
      worktree_root: metadata.worktreeRoot,
      profile: metadata.profile ?? null,
      budget_mb: budget,
      owner: metadata.owner ?? null,
      root: metadata.root ?? null,
    };
    const slotPath = path.join(this.slotDir, `${runId}.json`);
    this.fs.writeFileSync(slotPath, `${JSON.stringify(slot, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });

    // Close the check-then-create race across worktrees. If two supervisors
    // both observed spare capacity, at least one must fail closed after the
    // exclusive files become visible.
    const activeAfterCreate = this.listActiveSlots();
    const activeAfterMB = activeAfterCreate.reduce((sum, entry) => sum + Number(entry.budget_mb ?? 0), 0);
    if (activeAfterMB + reserve > effectiveLimit) {
      this.releaseSlot(runId);
      const error = new Error('machine-level budget slots are exhausted');
      error.code = 'BUDGET_SLOT_CONFLICT';
      throw error;
    }
    return slot;
  }

  /**
   * @param {string} runId
   * @param {object} updates
   * @returns {object}
   */
  updateSlot(runId, updates) {
    const slotPath = path.join(this.slotDir, `${runId}.json`);
    const current = JSON.parse(this.fs.readFileSync(slotPath, 'utf8'));
    const next = { ...current, ...updates, updated_at: this.now().toISOString() };
    this.fs.writeFileSync(slotPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return next;
  }

  /**
   * @param {string} runId
   */
  releaseSlot(runId) {
    try {
      this.fs.unlinkSync(path.join(this.slotDir, `${runId}.json`));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  /**
   * Stable hash used by slot fencing helpers and diagnostics.
   *
   * @param {object} value
   * @returns {string}
   */
  static fingerprint(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
  }
}

export { DEFAULT_RESERVE_MB, parseEnvNumber, RUN_ID_PATTERN };
