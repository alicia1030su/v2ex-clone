#!/usr/bin/env node
/**
 * v0.0.18 P1-1：单实例连续运行观测工具
 *
 * 诚实边界：
 *   · 只有同一应用实例、同一 OS 进程连续观测 >= 24h，且全部必需证据齐全，
 *     才能输出 status=pass / claim24h=true；
 *   · 时长不足、指纹或备份恢复探针缺失 => not-completed（退出码 3）；
 *   · HTTP/依赖失败、实例漂移、指纹不一致、探针失败 => fail（退出码 1）；
 *   · GitHub-hosted runner 单 job 上限约 6h，分段 workflow 最多观测 5.5h，
 *     因此它只能产出证据，不能宣称完成 24h。
 *
 * 不记录口令、Cookie、连接串或数据库原始内容。
 */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const SOAK_24H_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 1_000;
const HTTP_TIMEOUT_MS = 10_000;

export function parseArgs(argv) {
  const opts = {
    base: '',
    durationMs: 0,
    intervalMs: DEFAULT_INTERVAL_MS,
    out: '',
    pid: null,
    instanceId: null,
    healthPath: '/api/health/ready',
    pagePath: '/',
    opsPath: '/api/admin/ops',
    pgHost: process.env.PGHOST ?? '',
    pgPort: process.env.PGPORT ?? '5432',
    pgUser: process.env.PGUSER ?? '',
    pgDatabase: process.env.PGDATABASE ?? '',
    skipProbe: false,
    maxDurationMs: null,
    overwrite: false,
    help: false,
  };
  const value = (i, name) => {
    if (i + 1 >= argv.length) throw new Error(`缺少 ${name} 的值`);
    return argv[i + 1];
  };
  const integer = (raw, name, min = 1) => {
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < min) throw new Error(`${name} 必须是 >= ${min} 的整数`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--base': opts.base = value(i, arg); i++; break;
      case '--duration-ms': opts.durationMs = integer(value(i, arg), arg); i++; break;
      case '--interval-ms': opts.intervalMs = integer(value(i, arg), arg, MIN_INTERVAL_MS); i++; break;
      case '--out': opts.out = value(i, arg); i++; break;
      case '--pid': opts.pid = integer(value(i, arg), arg); i++; break;
      case '--instance-id': opts.instanceId = value(i, arg); i++; break;
      case '--health-path': opts.healthPath = value(i, arg); i++; break;
      case '--page-path': opts.pagePath = value(i, arg); i++; break;
      case '--ops-path': opts.opsPath = value(i, arg); i++; break;
      case '--pg-host': opts.pgHost = value(i, arg); i++; break;
      case '--pg-port': opts.pgPort = value(i, arg); i++; break;
      case '--pg-user': opts.pgUser = value(i, arg); i++; break;
      case '--pg-database': opts.pgDatabase = value(i, arg); i++; break;
      case '--skip-probe': opts.skipProbe = true; break;
      case '--max-duration-ms': opts.maxDurationMs = integer(value(i, arg), arg); i++; break;
      case '--overwrite': opts.overwrite = true; break;
      case '-h':
      case '--help': opts.help = true; break;
      default: throw new Error(`未知参数：${arg}`);
    }
  }
  if (opts.help) return opts;
  let base;
  try { base = new URL(opts.base); } catch { throw new Error('--base 必须是合法的 HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('--base 只支持 HTTP(S)');
  opts.base = base.toString().replace(/\/$/, '');
  if (!opts.durationMs) throw new Error('缺少 --duration-ms');
  if (!opts.out) throw new Error('缺少 --out');
  if (opts.maxDurationMs && opts.durationMs > opts.maxDurationMs) {
    throw new Error(`--duration-ms 超过本运行器上限 ${opts.maxDurationMs}`);
  }
  for (const key of ['healthPath', 'pagePath', 'opsPath']) {
    if (!opts[key].startsWith('/') || opts[key].startsWith('//')) throw new Error(`${key} 必须是站内绝对路径`);
  }
  return opts;
}

export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('运行已被信号中止'));
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(new Error('运行已被信号中止'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function request(url, init = {}) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 页面不是 JSON，合法 */ }
    return {
      status: response.status,
      latencyMs: Date.now() - startedAt,
      json,
      headers: response.headers,
    };
  } catch (error) {
    return {
      status: 0,
      latencyMs: Date.now() - startedAt,
      json: null,
      headers: null,
      error: error instanceof Error ? error.name : 'request_failed',
    };
  }
}

export async function login(base, credentials, fetchImpl = request) {
  if (!credentials?.username || !credentials?.password) throw new Error('缺少管理员登录凭据');
  const response = await fetchImpl(`${base}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ username: credentials.username, password: credentials.password }),
  });
  if (response.status !== 200 || response.json?.ok !== true) {
    throw new Error(`管理员登录失败（HTTP ${response.status}）`);
  }
  const raw = typeof response.headers?.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers?.get('set-cookie') ?? ''];
  const session = raw.flatMap((line) => line.split(/,\s*(?=[^;]+=)/)).find((line) => line.startsWith('v2_session='));
  if (!session) throw new Error('登录响应没有 v2_session Cookie');
  return session.split(';', 1)[0];
}

function processIdentity(sample) {
  if (!sample?.available) return null;
  return JSON.stringify({ pid: sample.pid, start: sample.startIdentity });
}

let clockTicks = null;
async function linuxProcess(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const end = stat.lastIndexOf(')');
  if (end < 0) throw new Error('invalid_proc_stat');
  const fields = stat.slice(end + 2).trim().split(/\s+/);
  // fields[0] = state（stat 第 3 列）；utime=第14列=>index11，starttime=第22列=>index19。
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  const startTicks = Number(fields[19]);
  const rssPages = Number(fields[21]);
  if (![utime, stime, startTicks, rssPages].every(Number.isFinite)) throw new Error('invalid_proc_numbers');
  if (clockTicks === null) {
    const { stdout } = await execFileAsync('getconf', ['CLK_TCK']);
    clockTicks = Number(stdout.trim());
    if (!Number.isFinite(clockTicks) || clockTicks <= 0) throw new Error('invalid_clk_tck');
  }
  const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  return {
    available: true,
    platform: 'linux',
    pid,
    startIdentity: `${bootId}:${startTicks}`,
    memoryRssBytes: rssPages * 4096,
    cpuTimeMs: Math.round(((utime + stime) * 1000) / clockTicks),
  };
}

async function windowsProcess(pid) {
  const command = [
    `$p = Get-Process -Id ${pid} -ErrorAction Stop;`,
    "[pscustomobject]@{Id=$p.Id;Start=$p.StartTime.ToUniversalTime().ToString('o');Rss=$p.WorkingSet64;Cpu=$p.CPU}",
    '| ConvertTo-Json -Compress',
  ].join(' ');
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
  const value = JSON.parse(stdout);
  return {
    available: true,
    platform: 'win32',
    pid: Number(value.Id),
    startIdentity: String(value.Start),
    memoryRssBytes: Number(value.Rss),
    cpuTimeMs: Math.round(Number(value.Cpu) * 1000),
  };
}

async function darwinProcess(pid) {
  const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart=,rss=,time=']);
  const match = stdout.trim().match(/^(.+?)\s+(\d+)\s+(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) throw new Error('invalid_ps_output');
  const cpuSeconds = Number(match[3]) * 60 + Number(match[4]);
  return {
    available: true,
    platform: 'darwin',
    pid,
    startIdentity: match[1],
    memoryRssBytes: Number(match[2]) * 1024,
    cpuTimeMs: Math.round(cpuSeconds * 1000),
  };
}

export async function sampleProcess(pid) {
  try {
    if (process.platform === 'linux') return await linuxProcess(pid);
    if (process.platform === 'win32') return await windowsProcess(pid);
    if (process.platform === 'darwin') return await darwinProcess(pid);
    return { available: false, platform: process.platform, pid, error: 'unsupported_platform' };
  } catch (error) {
    return {
      available: false,
      platform: process.platform,
      pid,
      error: error instanceof Error ? error.message : 'process_sample_failed',
    };
  }
}

export function pgArgs(options, database = options.pgDatabase) {
  return ['-h', options.pgHost, '-p', options.pgPort, '-U', options.pgUser, '-d', database];
}

function pgEnv() {
  return { ...process.env, PGCONNECT_TIMEOUT: '5' };
}

export function fingerprintSql(tables = ['users', 'topics', 'replies']) {
  if (!tables.length || tables.some((table) => !/^[a-z_][a-z0-9_]*$/.test(table))) {
    throw new Error('指纹表名只能是小写 SQL 标识符');
  }
  const unions = tables.map((table) => `SELECT * FROM ${table}`).join(' UNION ALL ');
  return `SELECT md5(COALESCE(string_agg(md5(row_to_json(x)::text), '' ORDER BY md5(row_to_json(x)::text)), '')) FROM (${unions}) AS x;`;
}

export async function fingerprintPostgres(options, runner = execFileAsync) {
  const { stdout } = await runner('psql', [...pgArgs(options), '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', fingerprintSql()], {
    env: pgEnv(),
    maxBuffer: 1024 * 1024,
  });
  const fingerprint = stdout.trim();
  if (!/^[a-f0-9]{32}$/.test(fingerprint)) throw new Error('数据库指纹输出格式非法');
  return fingerprint;
}

function createdbArgs(options, database) {
  return ['-h', options.pgHost, '-p', options.pgPort, '-U', options.pgUser, database];
}

export async function backupRestoreProbe(options, runner = execFileAsync) {
  const suffix = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const temporaryDatabase = `v2ex_soak_probe_${suffix}`;
  const workDir = mkdtempSync(path.join(tmpdir(), 'v2ex-soak-probe-'));
  const dumpPath = path.join(workDir, 'probe.dump');
  const env = pgEnv();
  const sourceFingerprint = await fingerprintPostgres(options, runner);
  let restoredFingerprint = null;
  let dumpBytes = 0;
  let cleanupError = null;
  try {
    await runner('createdb', createdbArgs(options, temporaryDatabase), { env });
    await runner('pg_dump', [...pgArgs(options), '--format=custom', '--file', dumpPath], { env });
    dumpBytes = readFileSync(dumpPath).byteLength;
    if (dumpBytes === 0) throw new Error('备份文件为空');
    await runner('pg_restore', ['--exit-on-error', '--dbname', temporaryDatabase,
      '-h', options.pgHost, '-p', options.pgPort, '-U', options.pgUser, dumpPath], { env });
    restoredFingerprint = await fingerprintPostgres({ ...options, pgDatabase: temporaryDatabase }, runner);
    if (restoredFingerprint !== sourceFingerprint) throw new Error('恢复后数据指纹不一致');
    return { status: 'passed', sourceFingerprint, restoredFingerprint, dumpBytes, temporaryDatabase };
  } finally {
    // 只清理本工具随机创建、且带固定前缀的临时库；绝不触碰源库或其它数据库。
    try { await runner('dropdb', createdbArgs(options, temporaryDatabase), { env }); }
    catch (error) { cleanupError = error; }
    rmSync(workDir, { recursive: true, force: true });
    if (cleanupError) throw new Error('temporary_database_cleanup_failed');
  }
}

export async function collectSample(base, opts, cookie, baseline, previous) {
  const [health, page, ops] = await Promise.all([
    request(`${base}${opts.healthPath}`),
    request(`${base}${opts.pagePath}`),
    request(`${base}${opts.opsPath}`, { headers: { Cookie: cookie } }),
  ]);
  const scope = ops.json?.scope;
  const pid = Number(scope?.pid);
  const processSample = Number.isSafeInteger(pid) && pid > 0 ? await sampleProcess(pid) : {
    available: false, pid: null, error: 'ops_scope_pid_missing',
  };
  const sample = {
    at: new Date().toISOString(),
    health: {
      status: health.status,
      latencyMs: health.latencyMs,
      ready: health.json?.status === 'ready',
      dbOk: health.json?.checks?.db?.ok === true,
      redisConfigured: health.json?.checks?.redis?.configured === true,
      redisOk: health.json?.checks?.redis?.ok === true,
      error: health.error ?? null,
    },
    page: { status: page.status, latencyMs: page.latencyMs, error: page.error ?? null },
    ops: {
      status: ops.status,
      latencyMs: ops.latencyMs,
      instanceId: typeof scope?.instanceId === 'string' ? scope.instanceId : null,
      pid: Number.isSafeInteger(pid) ? pid : null,
      startedAt: typeof scope?.startedAt === 'string' ? scope.startedAt : null,
      uptimeSeconds: Number.isFinite(scope?.uptimeSeconds) ? Number(scope.uptimeSeconds) : null,
      dbOk: ops.json?.dependencies?.db?.ok === true,
      redisConfigured: ops.json?.dependencies?.redis?.configured === true,
      redisOk: ops.json?.dependencies?.redis?.ok === true,
      postgresOk: ops.json?.dependencies?.postgres?.ok === true,
      postgresTotal: Number.isFinite(ops.json?.dependencies?.postgres?.total)
        ? Number(ops.json.dependencies.postgres.total) : null,
      replicasDeclared: Number.isFinite(scope?.replicasDeclared) ? Number(scope.replicasDeclared) : null,
      error: ops.error ?? null,
    },
    process: processSample,
    errors: [],
  };
  if (health.status !== 200 || !sample.health.ready || !sample.health.dbOk) sample.errors.push('health_not_ready');
  if (sample.health.redisConfigured && !sample.health.redisOk) sample.errors.push('health_redis_failed');
  if (page.status !== 200) sample.errors.push('page_not_200');
  if (ops.status !== 200) sample.errors.push('ops_not_200');
  if (!sample.ops.instanceId || !sample.ops.startedAt || !sample.ops.pid) sample.errors.push('ops_scope_incomplete');
  if (sample.ops.status === 200 && (!sample.ops.dbOk || !sample.ops.postgresOk)) sample.errors.push('ops_dependency_failed');
  if (sample.ops.redisConfigured && !sample.ops.redisOk) sample.errors.push('ops_redis_failed');
  if (sample.ops.replicasDeclared !== 1) sample.errors.push('replica_scope_not_single');
  if (!processSample.available) sample.errors.push('process_sample_unavailable');
  if (baseline) {
    if (sample.ops.instanceId !== baseline.instanceId) sample.errors.push('instance_id_drift');
    if (sample.ops.pid !== baseline.pid) sample.errors.push('ops_pid_drift');
    if (sample.ops.startedAt !== baseline.startedAt) sample.errors.push('started_at_drift');
    if (processIdentity(processSample) !== processIdentity(baseline.process)) sample.errors.push('os_process_drift');
    if (sample.ops.uptimeSeconds !== null && baseline.uptimeSeconds !== null
      && sample.ops.uptimeSeconds + 2 < baseline.uptimeSeconds) sample.errors.push('uptime_reset');
    if (previous?.ops?.uptimeSeconds !== null && previous?.ops?.uptimeSeconds !== undefined
      && sample.ops.uptimeSeconds !== null && sample.ops.uptimeSeconds + 2 < previous.ops.uptimeSeconds) {
      sample.errors.push('uptime_not_monotonic');
    }
  }
  if (opts.pid && sample.ops.pid !== opts.pid) sample.errors.push('configured_pid_mismatch');
  if (opts.instanceId && sample.ops.instanceId !== opts.instanceId) sample.errors.push('configured_instance_mismatch');
  return sample;
}

function maxNumber(samples, getter) {
  const values = samples.map(getter).filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

export function deriveStatus({ actualDurationMs, samples, errors, drift, fingerprint, probe }) {
  const reasons = [];
  if (errors.length) reasons.push('probe_errors');
  if (drift.length) reasons.push('instance_drift');
  if (fingerprint?.status === 'mismatch') reasons.push('data_fingerprint_mismatch');
  if (fingerprint?.status === 'error') reasons.push('data_fingerprint_error');
  if (probe?.status === 'failed') reasons.push('backup_restore_probe_failed');
  if (reasons.length) return { status: 'fail', claim24h: false, reasons };
  if (actualDurationMs < SOAK_24H_MS) reasons.push('duration_lt_24h');
  if (fingerprint?.status !== 'match') reasons.push('data_fingerprint_not_matched');
  if (probe?.status !== 'passed') reasons.push('backup_restore_probe_not_passed');
  if (samples.length < 2) reasons.push('insufficient_samples');
  if (reasons.length) return { status: 'not-completed', claim24h: false, reasons };
  return { status: 'pass', claim24h: true, reasons: [] };
}

function writeSummary(outDir, summary) {
  const finalPath = path.join(outDir, 'summary.json');
  const temporaryPath = `${finalPath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, finalPath);
}

function gitHead() {
  try { return execFileAsync('git', ['rev-parse', 'HEAD']).then(({ stdout }) => stdout.trim()); }
  catch { return null; }
}

export async function runSoak(opts, dependencies = {}) {
  const now = dependencies.now ?? (() => Date.now());
  const sleep = dependencies.sleep ?? delay;
  const collect = dependencies.collect ?? collectSample;
  const fingerprint = dependencies.fingerprint ?? fingerprintPostgres;
  const probe = dependencies.probe ?? backupRestoreProbe;
  const credentials = dependencies.credentials ?? {
    username: process.env.SOAK_ADMIN_USERNAME,
    password: process.env.SOAK_ADMIN_PASSWORD,
  };
  const outDir = path.resolve(opts.out);
  mkdirSync(outDir, { recursive: true });
  const samplesPath = path.join(outDir, 'samples.jsonl');
  const summaryPath = path.join(outDir, 'summary.json');
  if (!opts.overwrite) {
    for (const file of [samplesPath, summaryPath]) {
      try {
        if (readFileSync(file, 'utf8').length > 0) throw new Error(`证据文件已存在：${file}（如需覆盖请显式 --overwrite）`);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  } else {
    writeFileSync(samplesPath, '', 'utf8');
  }
  appendFileSync(samplesPath, '', 'utf8');

  const controller = new AbortController();
  const stop = (signal) => { controller.abort(new Error(`signal_${signal}`)); };
  const onSigint = () => stop('SIGINT');
  const onSigterm = () => stop('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  const errors = [];
  const drift = [];
  const samples = [];
  let cookie = null;
  let baseline = null;
  let fingerprintResult = { status: 'not-run', reason: 'postgres_not_configured' };
  let probeResult = { status: 'not-run', reason: opts.skipProbe ? 'skipped' : 'postgres_not_configured' };
  let stopReason = null;
  let observationStartedAt = null;
  const pgConfigured = Boolean(opts.pgHost && opts.pgUser && opts.pgDatabase);
  const monitorStartedAt = new Date(now()).toISOString();

  async function record(sample) {
    samples.push(sample);
    appendFileSync(samplesPath, `${JSON.stringify(sample)}\n`, 'utf8');
    for (const error of sample.errors ?? []) {
      if (error.includes('drift') || error.includes('reset') || error.includes('monotonic') || error.includes('mismatch')) {
        drift.push(error);
      } else if (!errors.includes(error)) {
        errors.push(error);
      }
    }
  }

  try {
    cookie = await (dependencies.login ?? login)(opts.base, credentials);
    const first = await collect(opts.base, opts, cookie, null, null);
    await record(first);
    baseline = {
      instanceId: first.ops.instanceId,
      pid: first.ops.pid,
      startedAt: first.ops.startedAt,
      uptimeSeconds: first.ops.uptimeSeconds,
      process: first.process,
    };
    if (pgConfigured && !opts.skipProbe) {
      try {
        fingerprintResult = { status: 'match', baseline: await fingerprint(opts), final: null };
      } catch (error) {
        fingerprintResult = { status: 'error', reason: error instanceof Error ? error.name : 'fingerprint_failed' };
      }
    }

    const observationStart = now();
    observationStartedAt = observationStart;
    const deadline = observationStart + opts.durationMs;
    let previous = first;
    let probeAttempted = false;
    while (now() < deadline) {
      const remaining = deadline - now();
      try {
        await sleep(Math.min(opts.intervalMs, remaining), controller.signal);
      } catch (error) {
        stopReason = error instanceof Error ? error.message : 'interrupted';
        break;
      }
      if (controller.signal.aborted) { stopReason = 'interrupted'; break; }
      const sample = await collect(opts.base, opts, cookie, baseline, previous);
      await record(sample);
      previous = sample;
      const elapsed = now() - observationStartedAt;
      if (pgConfigured && !opts.skipProbe && !probeAttempted && elapsed >= Math.floor(opts.durationMs / 2)) {
        probeAttempted = true;
        try {
          probeResult = { status: 'passed', ...(await probe(opts)) };
        } catch (error) {
          probeResult = { status: 'failed', reason: error instanceof Error ? error.message : 'probe_failed' };
        }
      }
    }
    if (controller.signal.aborted && !stopReason) stopReason = 'interrupted';
    const finalSample = await collect(opts.base, opts, cookie, baseline, previous);
    await record(finalSample);
    if (pgConfigured && !opts.skipProbe) {
      try {
        const final = await fingerprint(opts);
        fingerprintResult.final = final;
        fingerprintResult.status = fingerprintResult.baseline === final ? 'match' : 'mismatch';
      } catch (error) {
        fingerprintResult = { ...fingerprintResult, status: 'error', reason: error instanceof Error ? error.name : 'fingerprint_failed' };
      }
    }
    const actualDurationMs = Math.max(0, now() - observationStartedAt);
    const verdict = deriveStatus({ actualDurationMs, samples, errors, drift, fingerprint: fingerprintResult, probe: probeResult });
    const summary = {
      schema: 'v2ex-clone-soak-single-instance/v1',
      status: verdict.status,
      claim24h: verdict.claim24h,
      reasonCodes: verdict.reasons,
      monitorStartedAt,
      observationStartedAt: new Date(observationStartedAt).toISOString(),
      observationEndedAt: new Date(now()).toISOString(),
      actualDurationMs,
      targetDurationMs: opts.durationMs,
      requiredDurationMs: SOAK_24H_MS,
      intervalMs: opts.intervalMs,
      sampleCount: samples.length,
      errors: [...new Set(errors)],
      drift: [...new Set(drift)],
      instance: baseline,
      processIdentity: processIdentity(baseline?.process),
      maxima: {
        memoryRssBytes: maxNumber(samples, (s) => s.process?.memoryRssBytes),
        cpuTimeMs: maxNumber(samples, (s) => s.process?.cpuTimeMs),
        healthLatencyMs: maxNumber(samples, (s) => s.health?.latencyMs),
        pageLatencyMs: maxNumber(samples, (s) => s.page?.latencyMs),
        opsLatencyMs: maxNumber(samples, (s) => s.ops?.latencyMs),
        postgresConnections: maxNumber(samples, (s) => s.ops?.postgresTotal),
      },
      dataFingerprint: fingerprintResult,
      backupRestoreProbe: probeResult,
      redis: {
        configured: samples.some((s) => s.health?.redisConfigured || s.ops?.redisConfigured),
        allConfiguredChecksPassed: samples.every((s) => !s.health?.redisConfigured || s.health.redisOk),
      },
      stopReason,
      sourceCommit: await gitHead(),
      nodeVersion: process.version,
      platform: process.platform,
    };
    writeSummary(outDir, summary);
    return { summary, exitCode: verdict.status === 'pass' ? 0 : verdict.status === 'fail' ? 1 : 3 };
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'runner_error';
    const summary = {
      schema: 'v2ex-clone-soak-single-instance/v1',
      status: 'fail',
      claim24h: false,
      reasonCodes: ['runner_error'],
      monitorStartedAt,
      observationStartedAt: observationStartedAt === null ? null : new Date(observationStartedAt).toISOString(),
      observationEndedAt: new Date(now()).toISOString(),
      actualDurationMs: observationStartedAt === null ? 0 : Math.max(0, now() - observationStartedAt),
      targetDurationMs: opts.durationMs,
      requiredDurationMs: SOAK_24H_MS,
      intervalMs: opts.intervalMs,
      sampleCount: samples.length,
      errors: [code],
      drift: [...new Set(drift)],
      instance: baseline,
      processIdentity: processIdentity(baseline?.process),
      dataFingerprint: fingerprintResult,
      backupRestoreProbe: probeResult,
      stopReason,
      sourceCommit: await gitHead(),
      nodeVersion: process.version,
      platform: process.platform,
    };
    writeSummary(outDir, summary);
    return { summary, exitCode: 1 };
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (error) {
    console.error(`参数错误：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    console.log('node scripts/soak/single-instance.mjs --base <url> --duration-ms <ms> --out <dir> [options]');
    console.log('退出码：0=24h pass；1=fail；2=参数错误；3=not-completed（不得当作 24h 通过）');
    return;
  }
  try {
    const result = await runSoak(opts);
    console.log(`status=${result.summary.status} claim24h=${result.summary.claim24h} durationMs=${result.summary.actualDurationMs}`);
    console.log(`reasons=${result.summary.reasonCodes.join(',') || 'none'}`);
    console.log(`evidence=${path.resolve(opts.out)}`);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(`运行失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
