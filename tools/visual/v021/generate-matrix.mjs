import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildMatrixRecords } from './spec.mjs';
import { WorktreeIdentityService } from '../../dev-memory/lib/worktree.mjs';
import { ReportStore } from '../../dev-memory/report-store.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'docs', 'evidence', 'visual', 'v0.0.21', 'fidelity-matrix.json');

function isMain() {
  return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
}

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

export function generate(options = {}) {
  const worktree = new WorktreeIdentityService().resolve(options.worktree ?? ROOT);
  const records = buildMatrixRecords({
    commit: options.commit ?? worktree.git_head,
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    fixtures: options.fixtures ?? {},
    owner: options.owner ?? 'software-engineer-2',
  });
  const output = path.resolve(options.output ?? DEFAULT_OUTPUT);
  new ReportStore().writeAtomic(output, records);
  return { output, count: records.length, commit: worktree.git_head };
}

if (isMain()) {
  try {
    const result = generate({
      worktree: argument('worktree', ROOT),
      output: argument('output'),
      commit: argument('commit'),
      capturedAt: argument('captured-at'),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
