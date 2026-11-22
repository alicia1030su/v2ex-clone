import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';

const PAGE_SIZE = 4096;
const MIB = 1024 * 1024;

function canonicalIdentity(info, platform = 'linux') {
  const exe = info.exe === null || info.exe === undefined
    ? null
    : (platform === 'win32' ? String(info.exe).toLowerCase() : String(info.exe));
  return {
    pid: Number(info.pid),
    ppid: Number(info.ppid),
    start_ticks: info.start_ticks === null || info.start_ticks === undefined
      ? null
      : Number(info.start_ticks),
    start_time: info.start_time ?? null,
    exe,
  };
}

/**
 * Stable process identity hash. RSS and cwd are intentionally excluded because
 * they can change while a process remains the same execution.
 *
 * @param {object} info
 * @param {string} [platform]
 * @returns {string}
 */
export function hashProcessIdentity(info, platform = 'linux') {
  const digest = createHash('sha256')
    .update(JSON.stringify(canonicalIdentity(info, platform)))
    .digest('hex');
  return `sha256:${digest}`;
}

/**
 * Parse the tricky `/proc/<pid>/stat` format. The comm field is wrapped in
 * parentheses and may itself contain spaces or parentheses.
 *
 * @param {string} raw
 * @param {number} [fallbackPid]
 * @returns {{pid:number|null, name:string, state:string, ppid:number, start_ticks:number, rss_pages:number}}
 */
export function parseLinuxStat(raw, fallbackPid) {
  const open = raw.indexOf('(');
  const close = raw.lastIndexOf(')');
  if (open <= 0 || close <= open) throw new Error('invalid /proc stat record');
  const pidText = raw.slice(0, open).trim();
  const pid = pidText === '' ? (fallbackPid ?? null) : Number(pidText);
  if (pid !== null && (!Number.isSafeInteger(pid) || pid <= 0)) {
    throw new Error(`invalid pid in /proc stat: ${pidText}`);
  }
  const name = raw.slice(open + 1, close);
  const fields = raw.slice(close + 1).trim().split(/\s+/);
  const state = fields[0] ?? '';
  const ppid = Number(fields[1]);
  const startTicks = Number(fields[19]);
  const rssPages = Number(fields[21]);
  if (!Number.isSafeInteger(ppid) || ppid < 0) throw new Error('invalid ppid in /proc stat');
  if (!Number.isSafeInteger(startTicks) || startTicks < 0) {
    throw new Error('invalid starttime in /proc stat');
  }
  if (!Number.isSafeInteger(rssPages) || rssPages < 0) {
    throw new Error('invalid rss in /proc stat');
  }
  return {
    pid,
    name,
    state,
    ppid,
    start_ticks: startTicks,
    rss_pages: rssPages,
  };
}

function safeReadlink(fileSystem, filePath) {
  try {
    return fileSystem.readlinkSync(filePath);
  } catch {
    return null;
  }
}

function safeRead(fileSystem, filePath) {
  try {
    return fileSystem.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Linux `/proc` implementation. */
export class LinuxProcessTable {
  /**
   * @param {{fs?: Pick<fs, 'readdirSync'|'readFileSync'|'readlinkSync'>, procRoot?:string, pageSize?:number}} [dependencies]
   */
  constructor(dependencies = {}) {
    this.platform = 'linux';
    this.fs = dependencies.fs ?? fs;
    this.procRoot = dependencies.procRoot ?? '/proc';
    this.pageSize = dependencies.pageSize ?? PAGE_SIZE;
    this.bootTimeSeconds = null;
  }

  /** @returns {number|null} */
  readBootTime() {
    if (this.bootTimeSeconds !== null) return this.bootTimeSeconds;
    const stat = safeRead(this.fs, `${this.procRoot}/stat`);
    if (stat !== null) {
      const match = /^btime\s+(\d+)\s*$/m.exec(stat);
      if (match) this.bootTimeSeconds = Number(match[1]);
    }
    return this.bootTimeSeconds;
  }

  /**
   * @param {number} startTicks
   * @returns {string|null}
   */
  startTimeFromTicks(startTicks) {
    const boot = this.readBootTime();
    if (boot === null) return null;
    const ticksPerSecond = Number(os.sysconf?.('SC_CLK_TCK') ?? 100);
    const milliseconds = (boot + startTicks / ticksPerSecond) * 1000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  /**
   * @param {number} pid
   * @returns {object|null}
   */
  snapshotOne(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    const stat = safeRead(this.fs, `${this.procRoot}/${pid}/stat`);
    if (stat === null) return null;
    const parsed = parseLinuxStat(stat, pid);
    const info = {
      pid,
      ppid: parsed.ppid,
      name: parsed.name,
      exe: safeReadlink(this.fs, `${this.procRoot}/${pid}/exe`),
      cwd: safeReadlink(this.fs, `${this.procRoot}/${pid}/cwd`) ?? 'UNKNOWN',
      start_time: this.startTimeFromTicks(parsed.start_ticks),
      start_ticks: parsed.start_ticks,
      rss_mb: Number(((parsed.rss_pages * this.pageSize) / MIB).toFixed(1)),
    };
    info.identity_hash = hashProcessIdentity(info, 'linux');
    return info;
  }

  /** @returns {object[]} */
  snapshot() {
    // Failure to enumerate /proc is a monitoring failure, not evidence that
    // every process exited. Let the caller record and fail closed.
    const entries = this.fs.readdirSync(this.procRoot);
    const processes = [];
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const info = this.snapshotOne(Number(entry));
      if (info !== null) processes.push(info);
    }
    return processes;
  }

  /**
   * @param {number} pid
   * @returns {boolean}
   */
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code === 'EPERM';
    }
  }

  /**
   * @param {number} pid
   * @param {string} signal
   */
  signal(pid, signal) {
    process.kill(pid, signal);
  }
}
