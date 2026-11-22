import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
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

const FORBIDDEN_PATTERNS = [
  { regex: /\btaskkill\b/i, label: 'taskkill' },
  { regex: /(?:^|\s)\/IM(?:\s|$)/i, label: 'taskkill /IM' },
  { regex: /\bpkill(?:\s+-\S+)*\s+node(?:\.exe)?\b/i, label: 'pkill node' },
  { regex: /\bkillall\s+node(?:\.exe)?\b/i, label: 'killall node' },
  {
    regex: /\bStop-Process\b[^\r\n]*-Name\s+['"]?(?:node|workbuddy|code|cursor|postgres|redis)\b/i,
    label: 'PowerShell image-name kill',
  },
  { regex: /\bprocess\.kill\(\s*-\d+\s*,/i, label: 'process-group kill' },
  { regex: /\bprocess\.kill\(\s*0\s*,\s*['"]SIG/i, label: 'broad zero-PID kill' },
  { regex: /\bkill\s+(?:-[A-Za-z0-9]+\s+)*(?:-1|0)(?:\s|$)/i, label: 'broad shell kill' },
  { regex: /CommandLine\s*[,)]/i, label: 'process command-line selection' },
] as const;

/** Return unsafe process-selection constructs found under a tool directory. */
export function findForbiddenConstructs(directory: string): string[] {
  const offenders: string[] = [];
  for (const filePath of collectFiles(directory)) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.regex.test(source)) {
        offenders.push(`${path.relative(ROOT, filePath)}: ${pattern.label}`);
      }
    }
  }
  return offenders;
}

/** Detect mutations of the parent/global NODE_OPTIONS environment variable. */
export function findGlobalNodeOptionsMutations(source: string): string[] {
  const patterns = [
    /\bprocess\s*\.\s*env\s*\.\s*NODE_OPTIONS\s*(?:=|\|\|=|\?\?=)/i,
    /\bprocess\s*\.\s*env\s*\[\s*['"]NODE_OPTIONS['"]\s*\]\s*(?:=|\|\|=|\?\?=)/i,
    /\bObject\s*\.\s*assign\s*\(\s*process\s*\.\s*env\s*,[\s\S]{0,200}?NODE_OPTIONS\s*:/i,
    /(?:^|\n)\s*export\s+NODE_OPTIONS\s*=/i,
  ];
  return patterns.filter((pattern) => pattern.test(source)).map(() => 'global NODE_OPTIONS mutation');
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

  it('contains no broad process-image, process-group, or fuzzy command-line kill primitive', () => {
    expect(findForbiddenConstructs(path.join(ROOT, 'tools', 'dev-memory'))).toEqual([]);
  });

  it.each([
    "process.kill(-1, 'SIGKILL');",
    'pkill -9 node;',
    'killall node;',
    'Stop-Process -Name node;',
  ])('detects injected unsafe process selection: %s', (construct) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wb qa guard injection '));
    try {
      fs.writeFileSync(path.join(directory, 'unsafe.mjs'), construct);
      expect(findForbiddenConstructs(directory).length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    "process.env.NODE_OPTIONS = '--max-old-space-size=9999';",
    "process.env['NODE_OPTIONS'] = '--max-old-space-size=9999';",
    'export NODE_OPTIONS="--max-old-space-size=9999";',
  ])('detects injected global NODE_OPTIONS mutation: %s', (construct) => {
    expect(findGlobalNodeOptionsMutations(construct).length).toBeGreaterThan(0);
  });

  it('spawns exact argv without a shell and never mutates the parent NODE_OPTIONS', () => {
    const runSource = read('tools/dev-memory/run.mjs');
    expect(runSource).toContain('shell: false');
    expect(runSource).not.toMatch(/shell:\s*true/);
    expect(runSource).toContain('withHeapLimit(');
    for (const filePath of collectFiles(path.join(ROOT, 'tools', 'dev-memory'))) {
      expect(findGlobalNodeOptionsMutations(fs.readFileSync(filePath, 'utf8')), filePath).toEqual([]);
    }
  });

  it('never deletes artifacts, logs, reports, or user data from the cleaner', () => {
    const cleaner = read('tools/dev-memory/lib/safe-cleaner.mjs');
    expect(cleaner).not.toMatch(/\b(?:rmSync|rmdirSync|unlinkSync|rm|rmdir)\s*\(/);
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

  it('pins the approved Vitest and Playwright versions in the lockfile', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, { version?: string }>;
    };
    expect(lock.packages['node_modules/vitest']?.version).toBe('5.0.5');
    expect(lock.packages['node_modules/@playwright/test']?.version).toBe('1.64.1');
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
    expect(vitest).not.toMatch(/testIgnore\s*:/);

    const playwright = read('playwright.low.config.ts');
    expect(playwright).toMatch(/workers:\s*1/);
    expect(playwright).toMatch(/fullyParallel:\s*false/);
    expect(playwright).not.toMatch(/testIgnore\s*:/);
  });

  it('keeps the dual-platform workflow scoped to guards and real cleanup smoke tests', () => {
    const workflow = read('.github/workflows/dev-memory.yml');
    expect(workflow).toContain('os: [windows-latest, ubuntu-latest]');
    expect(workflow).toContain("NODE_VERSION: '22.23.4'");
    expect(workflow).toContain('tests/dev-memory/*.spec.ts');
    expect(workflow).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(workflow).not.toContain('npm run build');
    expect(workflow).not.toContain('next build');
    expect(workflow).not.toContain('playwright test');
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
