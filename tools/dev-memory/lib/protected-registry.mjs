/**
 * Protected-process registry.
 *
 * Selection is based on exact process ancestry plus exact executable/process
 * names. Command lines are deliberately never inspected: they can contain
 * secrets and fuzzy matching is forbidden by the safety contract.
 */

const PROTECTED_BASENAMES = new Set([
  'workbuddy',
  'codebuddy',
  'sandbox-center',
  'editor_sdk',
  'betterleaks',
  'code',
  'cursor',
  'windsurf',
  'idea64',
  'pycharm64',
  'webstorm64',
  'sublime_text',
  'notepad++',
  'devenv',
  'postgres',
  'postmaster',
  'redis-server',
  'mysqld',
  'mariadbd',
  'services',
  'lsass',
  'csrss',
  'wininit',
  'winlogon',
  'smss',
  'svchost',
  'explorer',
  'systemd',
  'init',
]);

function executableBasename(value) {
  if (!value) return '';
  const normalized = String(value).replace(/\\/g, '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
  return base.endsWith('.exe') ? base.slice(0, -4) : base;
}

function isProtectedProcess(processInfo) {
  const candidates = [
    executableBasename(processInfo.name),
    executableBasename(processInfo.exe),
  ].filter(Boolean);
  return candidates.some((candidate) => PROTECTED_BASENAMES.has(candidate));
}

export class ProtectedProcessRegistry {
  /**
   * @param {{processTable:object, supervisorPid?:number, platform?:string}} dependencies
   */
  constructor(dependencies) {
    if (!dependencies?.processTable) throw new Error('processTable is required');
    this.processTable = dependencies.processTable;
    this.supervisorPid = dependencies.supervisorPid ?? process.pid;
    this.platform = dependencies.platform ?? process.platform;
  }

  /**
   * @param {object[]} processes
   * @param {number} pid
   * @returns {object[]}
   */
  ancestorChain(processes, pid) {
    const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
    const chain = [];
    const visited = new Set();
    let current = byPid.get(pid);
    while (current && !visited.has(current.pid)) {
      visited.add(current.pid);
      chain.push(current);
      if (current.ppid <= 0 || current.ppid === current.pid) break;
      current = byPid.get(current.ppid);
    }
    return chain;
  }

  /**
   * Snapshot protected ancestors and exact well-known service/editor images.
   *
   * @param {number} [rootPid]
   * @returns {object[]}
   */
  snapshot(rootPid) {
    const processes = typeof this.processTable.snapshotFresh === 'function'
      ? this.processTable.snapshotFresh()
      : this.processTable.snapshot();
    const protectedByPid = new Map();
    for (const processInfo of processes) {
      if (isProtectedProcess(processInfo)) protectedByPid.set(processInfo.pid, processInfo);
    }
    for (const ancestor of this.ancestorChain(processes, this.supervisorPid)) {
      protectedByPid.set(ancestor.pid, ancestor);
    }
    if (rootPid !== undefined) {
      for (const ancestor of this.ancestorChain(processes, rootPid)) {
        // The root itself is not an ancestor; its parent chain consists of the
        // supervisor/WorkBuddy/editor/system processes that must survive.
        if (ancestor.pid !== rootPid) protectedByPid.set(ancestor.pid, ancestor);
      }
    }
    return [...protectedByPid.values()];
  }

  /**
   * Abort the entire cleanup if any selected target is protected.
   *
   * @param {object[]} targets
   * @returns {void}
   */
  assertNoProtectedTargets(targets) {
    const protectedPids = new Set(this.snapshot().map((entry) => entry.pid));
    const hits = targets.filter((target) => protectedPids.has(target.pid));
    if (hits.length > 0) {
      const error = new Error(
        `protected process targeted; cleanup aborted: ${hits.map((entry) => entry.pid).join(', ')}`,
      );
      error.code = 'PROTECTED_TARGET';
      error.targets = hits;
      throw error;
    }
  }
}

export { PROTECTED_BASENAMES, executableBasename, isProtectedProcess };
