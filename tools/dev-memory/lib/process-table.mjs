import { LinuxProcessTable, hashProcessIdentity } from './process-table-linux.mjs';
import { WindowsProcessTable } from './process-table-windows.mjs';

/**
 * Cross-platform process table facade.
 */
export class ProcessTable {
  /**
   * @param {{platform?:string, processTable?:object}} [options]
   */
  constructor(options = {}) {
    const platform = options.platform ?? process.platform;
    if (options.processTable) {
      this.impl = options.processTable;
    } else if (platform === 'linux') {
      this.impl = new LinuxProcessTable();
    } else if (platform === 'win32') {
      this.impl = new WindowsProcessTable();
    } else {
      throw new Error(`unsupported process-table platform: ${platform}`);
    }
    this.platform = platform;
  }

  /** @returns {object[]} */
  snapshot() {
    return this.impl.snapshot();
  }

  /**
   * Return a recent cached tree when the platform implementation supports it.
   * Monitoring uses this path so a slow OS query cannot break the 1 Hz tick.
   *
   * @returns {object[]}
   */
  snapshotCached() {
    return typeof this.impl.snapshotCached === 'function'
      ? this.impl.snapshotCached()
      : this.impl.snapshot();
  }

  /**
   * Force a current tree snapshot for safety decisions.
   *
   * @returns {object[]}
   */
  snapshotFresh() {
    return typeof this.impl.snapshotFresh === 'function'
      ? this.impl.snapshotFresh()
      : this.impl.snapshot();
  }

  /**
   * @param {number} pid
   * @returns {object|null}
   */
  snapshotOne(pid) {
    return this.impl.snapshotOne(pid);
  }

  /**
   * @param {number} pid
   * @param {number} ppid
   * @returns {object|null}
   */
  snapshotDirectChild(pid, ppid) {
    return typeof this.impl.snapshotDirectChild === 'function'
      ? this.impl.snapshotDirectChild(pid, ppid)
      : this.impl.snapshotOne(pid);
  }

  /**
   * @param {number} pid
   * @returns {boolean}
   */
  isAlive(pid) {
    return this.impl.isAlive(pid);
  }

  /**
   * @param {number} pid
   * @param {string} signal
   */
  signal(pid, signal) {
    this.impl.signal(pid, signal);
  }
}

/**
 * Build parent/child relations without relying on process names or command
 * lines. Cycles are ignored so malformed snapshots cannot loop forever.
 *
 * @param {object[]} processes
 * @returns {Map<number, object[]>}
 */
export function childrenByParent(processes) {
  const children = new Map();
  for (const processInfo of processes) {
    const list = children.get(processInfo.ppid) ?? [];
    list.push(processInfo);
    children.set(processInfo.ppid, list);
  }
  return children;
}

/**
 * Return only processes whose current PPID chain reaches the exact root PID.
 *
 * @param {object} root
 * @param {object[]} processes
 * @returns {Array<{process:object, depth:number}>}
 */
export function confirmedDescendants(root, processes) {
  if (!root) return [];
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  if (!byPid.has(root.pid)) return [];
  const children = childrenByParent(processes);
  const found = [];
  const visited = new Set([root.pid]);
  const queue = (children.get(root.pid) ?? []).map((entry) => ({ process: entry, depth: 1 }));
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.process.pid)) continue;
    visited.add(current.process.pid);
    found.push(current);
    for (const child of children.get(current.process.pid) ?? []) {
      if (!visited.has(child.pid)) queue.push({ process: child, depth: current.depth + 1 });
    }
  }
  return found;
}

/**
 * Verify exact identity. PID alone is never sufficient.
 *
 * @param {object} expected
 * @param {object|null} fresh
 * @param {string} platform
 * @returns {boolean}
 */
export function verifyProcessIdentity(expected, fresh, platform = process.platform) {
  if (!expected || !fresh) return false;
  if (expected.pid !== fresh.pid || expected.ppid !== fresh.ppid) return false;
  if (platform === 'win32') {
    // Windows has no Linux-style start ticks. A missing creation time removes
    // the only portable PID-reuse fence and must never compare equal.
    if (typeof expected.start_time !== 'string' || typeof fresh.start_time !== 'string') {
      return false;
    }
    if (!Number.isFinite(Date.parse(expected.start_time)) || !Number.isFinite(Date.parse(fresh.start_time))) {
      return false;
    }
    if (Date.parse(expected.start_time) !== Date.parse(fresh.start_time)) return false;
  } else {
    if (!Number.isSafeInteger(expected.start_ticks) || expected.start_ticks < 0) return false;
    if (expected.start_ticks !== fresh.start_ticks) return false;
  }
  if (expected.start_ticks !== null && expected.start_ticks !== undefined) {
    if (expected.start_ticks !== fresh.start_ticks) return false;
  }
  const normalizeExe = (value) => {
    if (value === null || value === undefined) return null;
    return platform === 'win32' ? String(value).toLowerCase() : String(value);
  };
  return normalizeExe(expected.exe) === normalizeExe(fresh.exe);
}

export function createProcessTable(options = {}) {
  return new ProcessTable(options);
}

export { hashProcessIdentity, LinuxProcessTable, WindowsProcessTable };
