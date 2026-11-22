import { execFileSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { hashProcessIdentity } from './process-table-linux.mjs';

const MIB = 1024 * 1024;
const POWERSHELL_SCRIPT = fileURLToPath(new URL('./process-table.ps1', import.meta.url));
const RESPONSE_BYTES = 1024 * 1024;

/**
 * A dedicated worker owns the long-lived PowerShell host. The main thread uses
 * shared memory plus Atomics.wait for a synchronous ProcessTable API without
 * paying PowerShell startup on every sample.
 */
const WINDOWS_PROCESS_WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { spawn } = require('node:child_process');

let child = null;
let current = null;
let queue = [];
let busy = false;
let fatalError = null;
let stdout = '';

function respond(text) {
  if (!current) return;
  const encoded = Buffer.from(String(text), 'utf8');
  if (encoded.length > current.bytes.length) {
    encoded = Buffer.from('response too large', 'utf8');
  }
  current.bytes.set(encoded);
  Atomics.store(current.cell, 1, encoded.length);
  Atomics.store(current.cell, 0, 1);
  Atomics.notify(current.cell, 0);
  current = null;
  busy = false;
  setImmediate(pump);
}

function pump() {
  if (busy || queue.length === 0 || fatalError) return;
  current = queue.shift();
  busy = true;
  if (current.request === null) return;
  if (current.request === '__exit__') {
    respond('BYE');
    try { child.stdin.end(); } catch (_) {}
    return;
  }
  try {
    child.stdin.write(current.request + '\n');
  } catch (error) {
    respond(JSON.stringify({ error: error.message, processes: [] }));
  }
}

function handleLine(line) {
  const clean = String(line).replace(/\r$/, '');
  if (clean === '') return;
  respond(clean);
}

child = spawn(workerData.powershell, [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  workerData.scriptPath,
  '-Mode',
  'Serve',
], {
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => {
  stdout += chunk.toString('utf8');
  while (true) {
    const newline = stdout.indexOf('\n');
    if (newline === -1) break;
    const line = stdout.slice(0, newline);
    stdout = stdout.slice(newline + 1);
    handleLine(line);
  }
});
child.stderr.resume();
child.once('error', (error) => {
  fatalError = error;
  respond(JSON.stringify({ error: error.message, processes: [] }));
});
child.once('exit', (code, signal) => {
  fatalError = new Error('PowerShell process-table host exited (' + code + '/' + signal + ')');
  respond(JSON.stringify({ error: fatalError.message, processes: [] }));
});

parentPort.on('message', (message) => {
  const cell = new Int32Array(message.buffer, 0, 2);
  const bytes = new Uint8Array(message.buffer, 8);
  if (fatalError) {
    current = { request: message.request, cell, bytes };
    respond(JSON.stringify({ error: fatalError.message, processes: [] }));
    return;
  }
  queue.push({ request: message.request, cell, bytes });
  pump();
});
`;

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Convert a CIM `/Date(...)` value or ISO timestamp to UTC ISO 8601.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function parseCimDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const text = String(value);
  const cim = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(text);
  if (cim) {
    const date = new Date(Number(cim[1]));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeWindowsProcess(raw) {
  const pid = numberOrNull(raw.ProcessId ?? raw.pid);
  const ppid = numberOrNull(raw.ParentProcessId ?? raw.ppid);
  if (pid === null || ppid === null) return null;
  const workingSet = numberOrNull(raw.WorkingSetSize ?? raw.rss_bytes) ?? 0;
  const executablePath = raw.ExecutablePath ?? raw.exe ?? null;
  const info = {
    pid,
    ppid,
    name: String(raw.Name ?? raw.name ?? 'UNKNOWN'),
    exe: executablePath === '' ? null : executablePath,
    // Windows does not expose an arbitrary process cwd through standard APIs.
    cwd: 'UNKNOWN',
    start_time: parseCimDate(raw.CreationDate ?? raw.start_time),
    start_ticks: null,
    rss_mb: Number((workingSet / MIB).toFixed(1)),
  };
  info.identity_hash = hashProcessIdentity(info, 'win32');
  return info;
}

/**
 * Parse JSON emitted by the repository-owned PowerShell process probe.
 *
 * @param {string} text
 * @returns {object[]}
 */
export function parseWindowsSnapshot(text) {
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (clean === '') return [];
  const decoded = JSON.parse(clean);
  let rows;
  if (Array.isArray(decoded)) rows = decoded;
  else if (Array.isArray(decoded.processes)) rows = decoded.processes;
  else if (decoded.processes && typeof decoded.processes === 'object') rows = [decoded.processes];
  else if (decoded.ProcessId !== undefined) rows = [decoded];
  else rows = [];
  return rows.map(normalizeWindowsProcess).filter((row) => row !== null);
}

/** Windows Win32_Process implementation backed by the fixed PowerShell probe. */
export class WindowsProcessTable {
  /**
   * @param {{
   *   execFile?:typeof execFileSync,
   *   powershell?:string,
   *   scriptPath?:string,
   *   timeoutMs?:number,
   *   persistent?:boolean,
   * }} [dependencies]
   */
  constructor(dependencies = {}) {
    this.platform = 'win32';
    // An injected execFile keeps parser tests deterministic. Production uses a
    // long-lived PowerShell host so startup is not paid on every 1 Hz sample.
    this.execFile = dependencies.execFile ?? null;
    this.powershell = dependencies.powershell ?? 'powershell.exe';
    this.scriptPath = dependencies.scriptPath ?? POWERSHELL_SCRIPT;
    this.timeoutMs = dependencies.timeoutMs ?? 15_000;
    this.persistent = dependencies.persistent ?? true;
    this.worker = null;
    this.serverError = null;
    this.disposed = false;
    this.cachedSnapshot = null;
    this.cachedAt = 0;
    this.pendingRefresh = null;
    process.once('exit', () => this.dispose());
    if (this.persistent && this.execFile === null) this.startServer();
  }

  /** @returns {void} */
  startServer() {
    this.worker = new Worker(WINDOWS_PROCESS_WORKER, {
      eval: true,
      workerData: {
        powershell: this.powershell,
        scriptPath: this.scriptPath,
      },
    });
    this.worker.once('error', (error) => {
      this.serverError = error;
    });
    this.worker.unref();
    const ready = this.exchange(null);
    if (ready.trim() !== 'READY') {
      throw new Error(`Windows process-table server failed to become ready: ${ready || this.serverError?.message}`);
    }
  }

  /**
   * @param {string|null} request
   * @returns {string}
   */
  exchange(request) {
    if (this.worker === null || this.disposed) {
      throw new Error(this.serverError?.message ?? 'Windows process-table server is not running');
    }
    const buffer = new SharedArrayBuffer(8 + RESPONSE_BYTES);
    const cell = new Int32Array(buffer, 0, 2);
    this.worker.postMessage({ request, buffer });
    const waitResult = Atomics.wait(cell, 0, 0, this.timeoutMs);
    if (cell[0] !== 1) {
      throw new Error(
        waitResult === 'timed-out'
          ? `Windows process-table query timed out after ${this.timeoutMs} ms`
          : this.serverError?.message ?? 'Windows process-table query failed',
      );
    }
    const length = Math.min(cell[1], RESPONSE_BYTES);
    return Buffer.from(new Uint8Array(buffer, 8, length)).toString('utf8');
  }

  /** @returns {void} */
  requestRefresh() {
    if (this.pendingRefresh !== null || this.worker === null || this.disposed) return;
    const buffer = new SharedArrayBuffer(8 + RESPONSE_BYTES);
    const cell = new Int32Array(buffer, 0, 2);
    this.worker.postMessage({ request: 'all', buffer });
    this.pendingRefresh = { buffer, cell, requestedAt: Date.now() };
  }

  /** @returns {object[]|null} */
  consumeRefresh() {
    if (this.pendingRefresh === null || this.pendingRefresh.cell[0] !== 1) return null;
    const pending = this.pendingRefresh;
    this.pendingRefresh = null;
    const length = Math.min(pending.cell[1], RESPONSE_BYTES);
    const line = Buffer.from(new Uint8Array(pending.buffer, 8, length)).toString('utf8');
    const decoded = JSON.parse(line);
    if (decoded.error) throw new Error(`Windows process-table query failed: ${decoded.error}`);
    this.cachedSnapshot = parseWindowsSnapshot(line);
    this.cachedAt = Date.now();
    return this.cachedSnapshot;
  }

  /**
   * Return the most recent completed tree snapshot. A refresh runs in the
   * dedicated worker so a slow WMI query never delays the 1 Hz monitor tick.
   *
   * @returns {object[]}
   */
  snapshotCached() {
    this.consumeRefresh();
    if (this.cachedSnapshot === null || Date.now() - this.cachedAt > 1_000) {
      this.requestRefresh();
    }
    if (this.cachedSnapshot !== null) return this.cachedSnapshot;

    // First call has no cache to serve. Wait for this one refresh so callers
    // never receive an empty tree merely because the worker is warming up.
    if (this.pendingRefresh === null) return [];
    const pending = this.pendingRefresh;
    const waitResult = Atomics.wait(pending.cell, 0, 0, this.timeoutMs);
    if (pending.cell[0] !== 1) {
      throw new Error(
        waitResult === 'timed-out'
          ? `Windows process-table query timed out after ${this.timeoutMs} ms`
          : this.serverError?.message ?? 'Windows process-table query failed',
      );
    }
    return this.consumeRefresh() ?? [];
  }

  /**
   * @param {number|null} pid
   * @returns {object[]}
   */
  query(pid = null) {
    if (this.execFile !== null) {
      const args = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this.scriptPath,
      ];
      if (pid !== null) args.push('-ProcessId', String(pid));
      const output = this.execFile(
        this.powershell,
        args,
        {
          encoding: 'utf8',
          timeout: this.timeoutMs,
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      return parseWindowsSnapshot(output);
    }

    const line = this.exchange(pid === null ? 'all' : String(pid));
    const decoded = JSON.parse(line);
    if (decoded.error) throw new Error(`Windows process-table query failed: ${decoded.error}`);
    return parseWindowsSnapshot(line);
  }

  /** @returns {object[]} */
  snapshot() {
    return this.snapshotCached();
  }

  /**
   * Force a complete, current tree snapshot. Safety checks use this instead of
   * the monitor cache.
   *
   * @returns {object[]}
   */
  snapshotFresh() {
    const line = this.exchange('all');
    const decoded = JSON.parse(line);
    if (decoded.error) throw new Error(`Windows process-table query failed: ${decoded.error}`);
    this.cachedSnapshot = parseWindowsSnapshot(line);
    this.cachedAt = Date.now();
    // Ignore any older background refresh that was queued before this forced
    // snapshot; otherwise it could overwrite fresher safety data.
    this.pendingRefresh = null;
    return this.cachedSnapshot;
  }

  /**
   * @param {number} pid
   * @returns {object|null}
   */
  snapshotOne(pid) {
    return this.query(pid).find((entry) => entry.pid === pid) ?? null;
  }

  /**
   * Fast direct-child identity for the spawn -> lease window. The supervisor
   * supplies the authoritative PPID; cleanup still performs a CIM recheck.
   *
   * @param {number} pid
   * @param {number} ppid
   * @returns {object|null}
   */
  snapshotDirectChild(pid, ppid) {
    const line = this.exchange(`fast:${pid}:${ppid}`);
    const decoded = JSON.parse(line);
    if (decoded.error) return null;
    return parseWindowsSnapshot(line).find((entry) => entry.pid === pid) ?? null;
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

  /** @returns {void} */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.worker !== null) {
      try {
        this.exchange('__exit__');
      } catch {
        // The worker may already have failed or exited.
      }
      void this.worker.terminate();
    }
    this.worker = null;
    this.pendingRefresh = null;
  }
}
