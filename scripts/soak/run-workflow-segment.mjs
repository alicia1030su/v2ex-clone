#!/usr/bin/env node
/**
 * GitHub-hosted runner 的单实例观测分段启动器。
 *
 * 把「启动应用 → 等待就绪 → 运行单实例工具 → 清理进程」收敛到 Node，
 * 避免在 workflow 的 run: | 里拼接多行 shell。
 *
 * 本启动器最多运行 330 分钟，绝不把分段结果表述为 24h 通过。
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_MINUTES = 330;

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`缺少 ${name}`);
  return process.argv[index + 1];
}
function positiveInteger(raw, name) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`);
  return value;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitReady(base, child) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`应用提前退出（code=${child.exitCode}）`);
    try {
      const response = await fetch(`${base}/api/health/ready`, { signal: AbortSignal.timeout(3000) });
      if (response.status === 200) return;
    } catch { /* 继续等待 */ }
    await sleep(1000);
  }
  throw new Error('应用未在 120 秒内就绪');
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const detached = process.platform !== 'win32' && child.pid;
  try {
    if (detached) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch { /* 已退出 */ }
  for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (detached) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch { /* 已退出 */ }
  }
}

async function main() {
  const minutes = positiveInteger(arg('--minutes'), '--minutes');
  const intervalSeconds = positiveInteger(arg('--interval-seconds'), '--interval-seconds');
  if (minutes > MAX_MINUTES) throw new Error(`--minutes 不能超过 ${MAX_MINUTES}`);
  if (intervalSeconds < 5) throw new Error('--interval-seconds 不能小于 5');

  const outDir = path.join(ROOT, 'soak-evidence');
  mkdirSync(outDir, { recursive: true });
  const appLogPath = path.join(outDir, 'app.log');
  const log = createWriteStream(appLogPath, { flags: 'w' });
  const base = 'http://127.0.0.1:3000';
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3000'], {
    cwd: ROOT,
    env: { ...process.env, APP_REPLICAS: '1' },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.pipe(log, { end: false });
  app.stderr.pipe(log, { end: false });

  try {
    await waitReady(base, app);
    const soakArgs = [
      'scripts/soak/single-instance.mjs',
      '--base', base,
      '--duration-ms', String(minutes * 60_000),
      '--interval-ms', String(intervalSeconds * 1000),
      '--max-duration-ms', String(MAX_MINUTES * 60_000),
      '--out', outDir,
      '--pid', String(app.pid),
    ];
    console.log(`启动单实例观测：${minutes} 分钟；这不是 24h 完成声明。`);
    const soak = spawn(process.execPath, soakArgs, { cwd: ROOT, env: process.env, stdio: 'inherit' });
    const exitCode = await new Promise((resolve, reject) => {
      soak.once('error', reject);
      soak.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    return exitCode;
  } finally {
    await stopProcess(app);
    log.end();
    try {
      const lines = readFileSync(appLogPath, 'utf8').split(/\r?\n/);
      writeFileSync(path.join(outDir, 'app-log-tail.txt'), `${lines.slice(-200).join('\n')}\n`, 'utf8');
    } catch { /* 日志尾部是辅助证据，缺失不改变主结论 */ }
  }
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(`分段启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
