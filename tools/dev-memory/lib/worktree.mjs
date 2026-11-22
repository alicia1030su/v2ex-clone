import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SHA256_PATTERN = /^[0-9a-f]{40}$/;

/** Return a normalized realpath or throw a descriptive error. */
function realpathOrThrow(value, label) {
  try {
    return realpathSync(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot resolve ${label} realpath: ${reason}`);
  }
}

/**
 * Resolve and fence worktree identity.
 */
export class WorktreeIdentityService {
  /**
   * @param {{execFile?: typeof execFileSync, cwd?: string}} [dependencies]
   */
  constructor(dependencies = {}) {
    this.execFile = dependencies.execFile ?? execFileSync;
    this.cwd = dependencies.cwd ?? process.cwd();
  }

  /**
   * @param {string[]} args
   * @param {string} cwd
   * @returns {string}
   */
  git(args, cwd) {
    return this.execFile('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();
  }

  /**
   * Resolve a worktree and its exact Git identity.
   *
   * @param {string} [input]
   * @returns {{root:string, git_head:string, git_tree:string, branch:string}}
   */
  resolve(input = '.') {
    const requested = path.resolve(this.cwd, input);
    let stats;
    try {
      stats = statSync(requested);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`worktree does not exist: ${requested} (${reason})`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`worktree is not a directory: ${requested}`);
    }

    const root = realpathOrThrow(requested, 'worktree');
    let topLevel;
    try {
      topLevel = realpathOrThrow(this.git(['rev-parse', '--show-toplevel'], root), 'git top-level');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`worktree is not a Git repository: ${root} (${reason})`);
    }
    if (path.resolve(topLevel) !== path.resolve(root)) {
      throw new Error(`worktree must be the Git top-level directory (requested=${root}, top=${topLevel})`);
    }

    const gitHead = this.git(['rev-parse', 'HEAD'], root);
    const gitTree = this.git(['rev-parse', 'HEAD^{tree}'], root);
    const branch = this.git(['branch', '--show-current'], root) || 'HEAD';
    if (!SHA256_PATTERN.test(gitHead) || !SHA256_PATTERN.test(gitTree)) {
      throw new Error('Git did not return a full SHA-1 identity');
    }
    return { root, git_head: gitHead, git_tree: gitTree, branch };
  }

  /**
   * @param {{root:string, git_head:string, git_tree:string, branch?:string}} left
   * @param {{root:string, git_head:string, git_tree:string, branch?:string}} right
   * @returns {boolean}
   */
  sameWorktree(left, right) {
    if (!left || !right) return false;
    const normalize = (value) => {
      const resolved = path.resolve(value);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    return (
      normalize(left.root) === normalize(right.root) &&
      left.git_head === right.git_head &&
      left.git_tree === right.git_tree
    );
  }
}

/**
 * Stable, non-secret machine identifier.
 *
 * @param {{platform?: string, arch?: string, hostname?: string}} [source]
 * @returns {string}
 */
export function machineId(source = {}) {
  const platform = source.platform ?? process.platform;
  const arch = source.arch ?? process.arch;
  const hostname = source.hostname ?? os.hostname();
  const digest = createHash('sha256')
    .update(`${platform}\0${arch}\0${hostname}`)
    .digest('hex')
    .slice(0, 20);
  return `wb-${digest}`;
}

/**
 * Hash an environment without persisting any secret value.
 *
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} env
 * @returns {string}
 */
export function environmentFingerprint(env) {
  const entries = Object.entries(env)
    .filter((entry) => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const hash = createHash('sha256');
  for (const [key, value] of entries) {
    hash.update(`${key.length}:${key}${String(value).length}:${String(value)}\0`);
  }
  return `sha256:${hash.digest('hex')}`;
}
