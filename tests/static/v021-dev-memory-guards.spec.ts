import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function read(relativePath: string) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function collectFiles(directory: string): string[] {
  const output: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...collectFiles(full));
    else output.push(full);
  }
  return output;
}

describe('v0.0.21 dev-memory static guards', () => {
  it('ships every required entry, library, schema, test, workflow, and document', () => {
    const required = [
      'tools/dev-memory/preflight.mjs',
      'tools/dev-memory/monitor.mjs',
      'tools/dev-memory/cleanup.mjs',
      'tools/dev-memory/run.mjs',
      'tools/dev-memory/benchmark.mjs',
      'tools/dev-memory/profiles.mjs',
      'tools/dev-memory/cli-args.mjs',
      'tools/dev-memory/report-store.mjs',
      'tools/dev-memory/lib/memory-probe.mjs',
      'tools/dev-memory/lib/budget-planner.mjs',
      'tools/dev-memory/lib/process-table.mjs',
      'tools/dev-memory/lib/process-table-linux.mjs',
      'tools/dev-memory/lib/process-table-windows.mjs',
      'tools/dev-memory/lib/process-table.ps1',
      'tools/dev-memory/lib/ownership-lease.mjs',
      'tools/dev-memory/lib/protected-registry.mjs',
      'tools/dev-memory/lib/safe-cleaner.mjs',
      'tools/dev-memory/lib/monitor-core.mjs',
      'tools/dev-memory/lib/worktree.mjs',
      'tools/dev-memory/schemas/preflight.schema.json',
      'tools/dev-memory/schemas/lease.schema.json',
      'tools/dev-memory/schemas/monitor.schema.json',
      'tools/dev-memory/schemas/cleanup.schema.json',
      'tools/dev-memory/schemas/benchmark.schema.json',
      'tests/dev-memory/budget.spec.ts',
      'tests/dev-memory/process-table-parsers.spec.ts',
      'tests/dev-memory/lease-fencing.spec.ts',
      'tests/dev-memory/monitor-math.spec.ts',
      'tests/dev-memory/cleanup-safety.spec.ts',
      'tests/dev-memory/run-orchestrator.spec.ts',
      '.github/workflows/dev-memory.yml',
      'docs/DEV_MEMORY_v0.0.21.md',
      'vitest.low.config.ts',
      'playwright.low.config.ts',
    ];
    const missing = required.filter((relativePath) => !fs.existsSync(path.join(ROOT, relativePath)));
    expect(missing).toEqual([]);
  });

  it('contains no broad process-image or fuzzy command-line kill primitive', () => {
    const offenders: string[] = [];
    for (const filePath of collectFiles(path.join(ROOT, 'tools', 'dev-memory'))) {
      const source = fs.readFileSync(filePath, 'utf8');
      const patterns = [
        { regex: /\btaskkill\b/i, label: 'taskkill' },
        { regex: /(?:^|\s)\/IM(?:\s|$)/i, label: 'taskkill /IM' },
        { regex: /\bpkill\s+node\b/i, label: 'pkill node' },
        { regex: /CommandLine\s*[,)]/i, label: 'process command-line selection' },
      ];
      for (const pattern of patterns) {
        if (pattern.regex.test(source)) {
          offenders.push(`${path.relative(ROOT, filePath)}: ${pattern.label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('spawns exact argv without a shell and never mutates the parent NODE_OPTIONS', () => {
    const runSource = read('tools/dev-memory/run.mjs');
    expect(runSource).toContain('shell: false');
    expect(runSource).not.toMatch(/shell:\s*true/);
    expect(runSource).not.toMatch(/process\.env\.NODE_OPTIONS\s*=/);
    expect(runSource).toContain('withHeapLimit(');
  });

  it('declares all low-memory package entries', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const name of [
      'memory:preflight',
      'memory:monitor',
      'memory:cleanup',
      'memory:run',
      'memory:benchmark',
      'dev:low',
      'build:low',
      'test:unit:low',
      'test:e2e:low',
      'visual:audit:low',
    ]) {
      expect(packageJson.scripts[name], name).toContain('tools/dev-memory/');
    }
  });

  it('derives Next concurrency only from WORKBUDDY_NEXT_CPUS', () => {
    const source = read('next.config.mjs');
    expect(source).toContain('WORKBUDDY_NEXT_CPUS');
    expect(source).toContain('experimental: { cpus: lowMemoryNextCpus }');
    expect(source).not.toContain('NEXT_PRIVATE_BUILD_WORKER');
    expect(source).not.toContain('memoryBasedWorkersCount');
  });

  it('forces one Vitest fork and one Playwright worker without changing testIgnore', () => {
    const vitest = read('vitest.low.config.ts');
    expect(vitest).toMatch(/pool:\s*'forks'/);
    expect(vitest).toMatch(/maxWorkers:\s*1/);
    expect(vitest).toMatch(/fileParallelism:\s*false/);

    const playwright = read('playwright.low.config.ts');
    expect(playwright).toMatch(/workers:\s*1/);
    expect(playwright).toMatch(/fullyParallel:\s*false/);
    expect(playwright).not.toMatch(/testIgnore\s*:/);
  });

  it('ships parseable JSON schemas with the normative schema IDs', () => {
    const expected = {
      'preflight.schema.json': 'workbuddy-dev-memory/preflight/v1',
      'lease.schema.json': 'workbuddy-dev-memory/lease/v1',
      'monitor.schema.json': 'workbuddy-dev-memory/monitor/v1',
      'cleanup.schema.json': 'workbuddy-dev-memory/cleanup/v1',
      'benchmark.schema.json': 'workbuddy-dev-memory/benchmark/v1',
    };
    for (const [fileName, id] of Object.entries(expected)) {
      const schema = JSON.parse(read(`tools/dev-memory/schemas/${fileName}`)) as { $id: string };
      expect(schema.$id).toBe(id);
    }
  });
});
