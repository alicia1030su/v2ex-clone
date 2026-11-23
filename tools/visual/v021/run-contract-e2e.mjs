import { spawn } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';
import { createProcessTable, verifyProcessIdentity } from '../../dev-memory/lib/process-table.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const port = Number(process.env.V021_E2E_PORT || 3212);
const baseUrl = process.env.V021_E2E_BASE_URL || `http://127.0.0.1:${port}`;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function signalExact(processTable, expected, signal) {
  const fresh = processTable.snapshotOne(expected.pid);
  if (!fresh || !verifyProcessIdentity(expected, fresh, process.platform)) {
    throw new Error(`identity changed before ${signal} for pid ${expected.pid}`);
  }
  processTable.signal(expected.pid, signal);
}

async function waitForReady(child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`managed server exited before ready (${child.exitCode}/${child.signalCode})`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health/ready`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(250);
  }
  throw new Error(`managed server did not become ready: ${baseUrl}`);
}

async function stopServer(child, processTable) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const root = processTable.snapshotOne(child.pid);
  if (!root || root.ppid !== process.pid) {
    throw new Error('managed server root is not owned by this runner');
  }
  signalExact(processTable, root, 'SIGTERM');
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    await sleep(100);
  }
  if (child.exitCode === null && child.signalCode === null) {
    signalExact(processTable, root, 'SIGKILL');
  }
}

dotenv.config({ path: path.join(ROOT, '.env.test'), quiet: true });
const env = {
  ...process.env,
  APP_NOW: '2026-11-06T04:00:00.000Z',
  SEED_TIME_ANCHOR: '2026-11-06T04:00:00.000Z',
  APP_RUNTIME_ENV: 'test',
  TEST_ENV_ISOLATED: '1',
  DISABLE_CAPTCHA: '1',
  APP_URL: baseUrl,
  NEXT_PUBLIC_APP_URL: baseUrl,
  LOCAL_BASE: baseUrl,
};
const processTable = createProcessTable();
const server = spawn(process.execPath, [
  path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'),
  'start',
  '-p',
  String(port),
], {
  cwd: ROOT,
  env,
  shell: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.resume();
server.stderr.resume();
let tests = null;
try {
  await waitForReady(server);
  tests = spawn(process.execPath, [
    path.join(ROOT, 'node_modules', 'playwright', 'cli.js'),
    'test',
    'e2e/v021-visual-contract.spec.ts',
    '--config',
    'playwright.low.config.ts',
    '--workers=1',
  ], {
    cwd: ROOT,
    env,
    shell: false,
    windowsHide: true,
    stdio: 'inherit',
  });
  const code = await new Promise((resolve, reject) => {
    tests.on('error', reject);
    tests.on('exit', resolve);
  });
  process.exitCode = code ?? 1;
} finally {
  if (tests && tests.exitCode === null) tests.kill('SIGTERM');
  await stopServer(server, processTable);
  processTable.impl?.dispose?.();
}
