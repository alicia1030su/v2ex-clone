import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { machineId } from './worktree.mjs';

const MIB = 1024 * 1024;
const CGROUP_SENTINEL_RATIO = 1.5;

/**
 * @typedef {Object} CgroupSnapshot
 * @property {1|2|null} version
 * @property {number|null} limit_bytes
 * @property {number|null} current_bytes
 * @property {string} source
 * @property {string[]} errors
 */

/**
 * @typedef {Object} MemorySnapshot
 * @property {string} measured_at
 * @property {string} platform
 * @property {number} physical_memory_bytes
 * @property {number} free_memory_bytes
 * @property {CgroupSnapshot|null} cgroup
 * @property {number} physical_mb
 * @property {number|null} cgroup_limit_mb
 * @property {number} effective_limit_mb
 * @property {number} current_available_mb
 * @property {string[]} errors
 */

function bytesToMB(bytes) {
  return Math.max(0, Math.floor(bytes / MIB));
}

function parseFiniteBytes(value, label) {
  const text = String(value).trim();
  if (text === '' || text === 'max') return null;
  // cgroup v1 commonly reports this sentinel for an unlimited hierarchy.
  if (text === '9223372036854771712') return null;
  if (!/^\d+$/.test(text)) throw new Error(`${label} is not a byte count: ${text}`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is outside the safe integer range: ${text}`);
  }
  return parsed;
}

/**
 * Read physical memory, cgroup limits, and currently available memory.
 */
export class MemoryProbe {
  /**
   * @param {{
   *   platform?: string,
   *   fs?: Pick<fs, 'existsSync'|'readFileSync'>,
   *   os?: Pick<os, 'totalmem'|'freemem'>,
   *   cgroupRoot?: string,
   *   procRoot?: string,
   *   now?: () => Date,
   * }} [dependencies]
   */
  constructor(dependencies = {}) {
    this.platform = dependencies.platform ?? process.platform;
    this.fs = dependencies.fs ?? fs;
    this.os = dependencies.os ?? os;
    this.cgroupRoot = dependencies.cgroupRoot ?? '/sys/fs/cgroup';
    this.procRoot = dependencies.procRoot ?? '/proc';
    this.now = dependencies.now ?? (() => new Date());
  }

  /**
   * @param {string} filePath
   * @returns {string|null}
   */
  readText(filePath) {
    try {
      if (!this.fs.existsSync(filePath)) return null;
      return this.fs.readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Read the current process cgroup path for v1/v2, when available.
   *
   * @returns {{v2:string|null, v1:string|null}}
   */
  readSelfCgroupPaths() {
    const raw = this.readText(`${this.procRoot}/self/cgroup`);
    if (raw === null) return { v2: null, v1: null };
    let v2 = null;
    let v1 = null;
    for (const line of raw.split(/\r?\n/)) {
      const [controllers, pathValue] = line.split(':', 3);
      if (controllers === '' || pathValue === undefined) continue;
      if (controllers === '0') v2 = pathValue;
      if (controllers.split(',').includes('memory')) v1 = pathValue;
    }
    return { v2, v1 };
  }

  /**
   * Read one cgroup limit/current pair without hiding measurement failures.
   *
   * @param {1|2} version
   * @param {string} limitPath
   * @param {string} currentPath
   * @returns {CgroupSnapshot}
   */
  readCgroupCandidate(version, limitPath, currentPath) {
    /** @type {string[]} */
    const errors = [];
    let limitBytes = null;
    let currentBytes = null;
    const limitText = this.readText(limitPath);
    if (limitText === null) {
      errors.push('CGROUP_LIMIT_UNMEASURABLE');
    } else {
      try {
        limitBytes = parseFiniteBytes(limitText, `cgroup v${version} memory limit`);
      } catch {
        errors.push('CGROUP_LIMIT_UNMEASURABLE');
      }
    }

    if (limitBytes !== null) {
      const currentText = this.readText(currentPath);
      if (currentText === null) {
        errors.push('CGROUP_CURRENT_UNMEASURABLE');
      } else {
        try {
          currentBytes = parseFiniteBytes(currentText, `cgroup v${version} memory current`);
          if (currentBytes === null) errors.push('CGROUP_CURRENT_UNMEASURABLE');
        } catch {
          errors.push('CGROUP_CURRENT_UNMEASURABLE');
        }
      }
    }

    return {
      version,
      limit_bytes: limitBytes,
      current_bytes: currentBytes,
      source: limitPath,
      errors,
    };
  }

  /**
   * Read Linux cgroup v2 or v1 memory information.
   *
   * @returns {CgroupSnapshot|null}
   */
  readCgroup() {
    if (this.platform !== 'linux') return null;
    const selfCgroupPath = `${this.procRoot}/self/cgroup`;
    if (this.fs.existsSync(selfCgroupPath) && this.readText(selfCgroupPath) === null) {
      return {
        version: null,
        limit_bytes: null,
        current_bytes: null,
        source: selfCgroupPath,
        errors: ['CGROUP_PATH_UNMEASURABLE'],
      };
    }
    const selfPaths = this.readSelfCgroupPaths();

    const v2Candidates = [];
    if (selfPaths.v2 && selfPaths.v2 !== '/') {
      v2Candidates.push(`${this.cgroupRoot}${selfPaths.v2}/memory.max`);
      v2Candidates.push(`${this.cgroupRoot}${selfPaths.v2}/memory.current`);
    }
    v2Candidates.push(`${this.cgroupRoot}/memory.max`, `${this.cgroupRoot}/memory.current`);

    for (let index = 0; index < v2Candidates.length; index += 2) {
      if (!this.fs.existsSync(v2Candidates[index])) continue;
      return this.readCgroupCandidate(2, v2Candidates[index], v2Candidates[index + 1]);
    }

    const v1Candidates = [];
    if (selfPaths.v1 && selfPaths.v1 !== '/') {
      v1Candidates.push(`${this.cgroupRoot}/memory${selfPaths.v1}/memory.limit_in_bytes`);
      v1Candidates.push(`${this.cgroupRoot}/memory${selfPaths.v1}/memory.usage_in_bytes`);
    }
    v1Candidates.push(
      `${this.cgroupRoot}/memory/memory.limit_in_bytes`,
      `${this.cgroupRoot}/memory/memory.usage_in_bytes`,
    );

    for (let index = 0; index < v1Candidates.length; index += 2) {
      if (!this.fs.existsSync(v1Candidates[index])) continue;
      return this.readCgroupCandidate(1, v1Candidates[index], v1Candidates[index + 1]);
    }

    return null;
  }

  /**
   * @returns {MemorySnapshot}
   */
  probe() {
    /** @type {string[]} */
    const errors = [];
    const physicalMemoryBytes = this.os.totalmem();
    const freeMemoryBytes = this.os.freemem();
    if (!Number.isSafeInteger(physicalMemoryBytes) || physicalMemoryBytes <= 0) {
      errors.push('PHYSICAL_MEMORY_UNMEASURABLE');
    }
    if (!Number.isSafeInteger(freeMemoryBytes) || freeMemoryBytes < 0) {
      errors.push('FREE_MEMORY_UNMEASURABLE');
    }
    if (this.platform !== 'linux' && this.platform !== 'win32') {
      errors.push('UNSUPPORTED_PLATFORM');
    }

    const cgroup = this.readCgroup();
    if (cgroup?.errors?.length) errors.push(...cgroup.errors);
    let cgroupLimitBytes = cgroup?.limit_bytes ?? null;
    if (
      cgroupLimitBytes !== null &&
      physicalMemoryBytes > 0 &&
      cgroupLimitBytes > physicalMemoryBytes * CGROUP_SENTINEL_RATIO
    ) {
      cgroupLimitBytes = null;
    }

    const physicalMB = bytesToMB(Math.max(0, physicalMemoryBytes));
    const cgroupLimitMB = cgroupLimitBytes === null ? null : bytesToMB(cgroupLimitBytes);
    const effectiveLimitMB = Math.min(
      physicalMB,
      cgroupLimitMB === null ? physicalMB : cgroupLimitMB,
    );
    const freeMB = bytesToMB(Math.max(0, freeMemoryBytes));
    let cgroupAvailableMB = null;
    if (cgroupLimitBytes !== null && cgroup?.current_bytes !== null && cgroup.current_bytes !== undefined) {
      cgroupAvailableMB = bytesToMB(Math.max(0, cgroupLimitBytes - cgroup.current_bytes));
    }
    const currentAvailableMB = Math.min(
      freeMB,
      cgroupAvailableMB === null ? freeMB : cgroupAvailableMB,
    );

    if (effectiveLimitMB <= 0) errors.push('EFFECTIVE_LIMIT_UNMEASURABLE');

    return {
      measured_at: this.now().toISOString(),
      platform: this.platform,
      physical_memory_bytes: Math.max(0, physicalMemoryBytes),
      free_memory_bytes: Math.max(0, freeMemoryBytes),
      cgroup,
      physical_memory_mb: physicalMB,
      physical_mb: physicalMB,
      cgroup_limit_mb: cgroupLimitMB,
      effective_limit_mb: effectiveLimitMB,
      current_available_mb: currentAvailableMB,
      errors,
    };
  }

  /**
   * @returns {string}
   */
  machineId() {
    return machineId({ platform: this.platform });
  }
}

export { bytesToMB, parseFiniteBytes, MIB };
