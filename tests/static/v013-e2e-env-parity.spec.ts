import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.13：**本地「CI 等价复现」环境隔离护栏**
 *
 * ## 真实故障（2026-11-09 全量 E2E 实测：255 passed / 1 failed）
 *
 * `scripts/ci/run-e2e-locally.sh` 声称「逐字对齐 CI」，也确实用 shell
 * 注入了 `DATABASE_URL`，但**漏了 `REDIS_URL`**。本机 `.env.local` 写着
 * 开发用的 `REDIS_URL=redis://127.0.0.1:6379`，而 Next.js 的 `@next/env`
 * 会在应用代码执行前自动加载它 —— 已占位的进程变量不会被 `ENV_FILE=.env.test`
 * 里的 `REDIS_URL=` 空值覆盖。
 *
 * 结果：`/api/health/ready` 的 `checkRedis()` 判定「configured=true 但 ping
 * 不通」，按设计**如实**返回 503，`v004-endpoint-smoke` 的「不返回 5xx」
 * 用例判红。CI runner 有真实 `redis:7` service 并注入 REDIS_URL，所以 CI 全绿。
 *
 * 这是测试环境隔离缺陷，**不是产品代码回归**，也不允许通过放宽断言、
 * 跳过用例或调低探针严格性来「修绿」。正确处置是补齐 shell 注入，让本机
 * 走设计上合法的单库 `PgKV` 降级路径（`configured=false` ⇒ ready=200）。
 *
 * 本护栏把这条「shell 注入优先于 ENV_FILE」的约束固化成可执行断言，
 * 防止以后再靠人记住。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const SCRIPT = read('scripts/ci/run-e2e-locally.sh');
const PG_SH = read('tests/helpers/start-test-pg.sh');
const CI = read('.github/workflows/ci.yml');
/**
 * ⚠️ 这里**不能**读 `.env.test`：它被 `.gitignore` 忽略（第 34 行），
 * 只存在于本机，CI checkout 里没有 —— 第一版护栏在 CI 上直接
 * `ENOENT: no such file or directory, open '.../.env.test'`，
 * 导致「类型检查 / 单元测试」job 在 Tests 594 passed 的情况下判红。
 * 护栏只能断言**被版本控制跟踪**的载体：`.env.example` + 脚本本身。
 */
const ENV_EXAMPLE = read('.env.example');
const HEALTH = read('src/app/api/health/ready/route.ts');
const SMOKE = read('e2e/v004-endpoint-smoke.spec.ts');

/** 脚本里所有 `export NAME=...` 的行序（用于验证注入发生在启动应用之前） */
function exportLine(name: string): number {
  const lines = SCRIPT.split(/\r?\n/);
  return lines.findIndex((l) => new RegExp(`^export\\s+${name}=`).test(l));
}

/** `tests/static/**` 下的全部 spec（用 readdirSync 而非手工清单，避免漏新文件） */
function staticSpecFiles(): string[] {
  const dir = path.join(ROOT, 'tests', 'static');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => `tests/static/${f}`);
}

describe('v0.0.13 本地 E2E 环境隔离', () => {
  it('DATABASE_URL 与 REDIS_URL 都必须用 shell export 注入（不能只靠 ENV_FILE）', () => {
    expect(exportLine('DATABASE_URL')).toBeGreaterThanOrEqual(0);
    expect(exportLine('REDIS_URL')).toBeGreaterThanOrEqual(0);
    // 两个注入必须都在「npx next start」之前 —— 用真实启动命令做锚点，
    // 不能用「启动应用」字样（它在文件头部说明注释里就出现了）。
    const startApp = SCRIPT.split(/\r?\n/).findIndex((l) => /^npx next start\b/.test(l.trim()));
    expect(startApp, '脚本缺少 npx next start 启动命令').toBeGreaterThanOrEqual(0);
    expect(exportLine('DATABASE_URL')).toBeLessThan(startApp);
    expect(exportLine('REDIS_URL')).toBeLessThan(startApp);
  });

  it('本机注入的 REDIS_URL 必须是空值（走 PgKV 降级，不假装本机有 Redis）', () => {
    // 断言对象必须是**脚本里的注入行**（脚本被跟踪），而不是被 gitignore 的
    // `.env.test` —— 后者在 CI 上根本不 checkout，读了就会 ENOENT 假红。
    expect(SCRIPT).toMatch(/^export REDIS_URL=""$/m);
    expect(SCRIPT).toMatch(/^export REDIS_PASSWORD=""$/m);
    // 模板里必须保留这两个键（否则新克隆的仓库不知道要配什么）
    expect(ENV_EXAMPLE).toMatch(/^REDIS_URL=/m);
    expect(ENV_EXAMPLE).toMatch(/^REDIS_PASSWORD=/m);
  });

  it('CI 必须提供真实 Redis 并注入非空 REDIS_URL（与本机降级路径各自覆盖）', () => {
    expect(CI).toContain('redis:7-alpine');
    expect(CI).toMatch(/REDIS_URL:\s*redis:\/\//);
  });

  it('就绪探针的严格性不得被降低：configured 语义与 503 契约保持', () => {
    // 修的是环境，不是判据。以下任一被删都意味着「为了让测试变绿而放行」。
    expect(HEALTH).toContain('configured: false');
    expect(HEALTH).toContain('configured: true');
    expect(HEALTH).toContain("ready ? 200 : 503");
    expect(HEALTH).toContain('new Redis(url');
    expect(HEALTH).toContain('await client.ping()');
  });

  it('端点冒烟用例不得被跳过或放宽（自动发现 + <500 判据保持）', () => {
    // v004 是从 src/app/api **自动发现**所有 GET 路由，源码里不会出现
    // '/api/health/ready' 字面量。要防的是「扫描逻辑被改成白名单」或
    // 「把 <500 判据放宽」——而不是要求写死某个端点名。
    expect(SMOKE).toContain("path.join(root, 'src', 'app', 'api')");
    expect(SMOKE).toContain('export\\s+async\\s+function\\s+GET');
    expect(SMOKE).toContain('toBeGreaterThan(20)');
    expect(SMOKE).toContain('toBeLessThan(500)');
    expect(SMOKE).not.toMatch(/test\.skip|test\.fixme/);
    // 就绪探针本身必须仍是可被自动发现到的 GET 路由
    expect(HEALTH).toContain('export async function GET()');
  });

  it('PG 就绪判据必须能执行 SQL，且不得吞掉启动失败退出码', () => {
    // 真实故障：陈旧 postmaster.pid 让 pg_ctl 启动超时，但端口曾短暂监听，
    // 旧的 `node net.connect` 判据打出「[PASS] PostgreSQL 就绪」，
    // 紧接着 CREATE DATABASE 失败 —— 假绿。
    expect(SCRIPT).toContain("pg_can_query()");
    expect(SCRIPT).toContain("-c 'SELECT 1'");
    expect(SCRIPT).toContain('ok "PostgreSQL 就绪（SELECT 1 通过）"');
    expect(SCRIPT).not.toContain('start-test-pg.sh" start > /tmp/ci-eq-pg.log 2>&1 || true');
    // 启动失败必须传播退出码，并打印日志
    expect(SCRIPT).toMatch(/if ! bash "\$REPO_ROOT\/tests\/helpers\/start-test-pg\.sh" start/);
    expect(SCRIPT).toContain('隔离测试实例启动失败');
  });

  it('陈旧 postmaster.pid 清理必须有「PID 仍存活则拒绝」的安全闸门', () => {
    expect(PG_SH).toContain('clear_stale_pid()');
    expect(PG_SH).toContain('assert_safe_pgdata');
    expect(PG_SH).toContain('check_port_free');
    // 绝不盲删活实例的锁文件
    expect(PG_SH).toContain('仍存活 —— 拒绝清理锁文件');
    expect(PG_SH).toContain('tasklist /FI "PID eq ${owner_pid}"');
    expect(PG_SH).toMatch(/rm -f "\$pidfile"/);
    // 清理只在 do_start 内被调用
    expect(PG_SH).toMatch(/check_port_free\s*\n\s*clear_stale_pid \|\| return 1/);
  });

  it('静态护栏不得读取被 gitignore 的本地环境文件（CI checkout 里不存在）', () => {
    // 真实故障（CI run 42558882639，job「类型检查 / 单元测试」）：
    //   FAIL tests/static/v013-e2e-env-parity.spec.ts
    //   Error: ENOENT: no such file or directory, open '.../.env.test'
    // 原因：`vitest.config.ts` 的 include 是 `tests/**/*.spec.ts`，会把
    // `tests/static/**` 一并收集；而 `.gitignore` 第 34 行忽略了 `.env.test`。
    // 本地有该文件 ⇒ 本机全绿；CI 没有 ⇒ 假红。
    // 本断言扫描全部静态护栏的**真实读取调用**，防止同类问题再犯。
    const offenders: string[] = [];
    for (const rel of staticSpecFiles()) {
      const src = read(rel);
      // 只认 `read('...')` / `readFileSync('...')` 这类真实调用，不误伤注释
      for (const m of src.matchAll(/\b(?:read|readFileSync)\(\s*'([^']+)'/g)) {
        const target = m[1];
        if (/^\.env(\..+)?$/.test(target) && target !== '.env.example') {
          offenders.push(`${rel} → ${target}`);
        }
      }
    }
    expect(offenders, `静态护栏读了未跟踪的本地 env 文件：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('pg_ctl 等待上限抬高后，就绪判据不得被一起放宽（V13-18）', () => {
    // 真实故障（2026-11-09 11:02）：上一轮 E2E 被 SIGTERM 打断，数据目录处于
    // 非正常关闭 ⇒ 下次启动要先崩溃恢复 + 逐目录 fsync（日志 `syncing data
    // directory ... 10s/20s/.../60s`），累计超过 pg_ctl 默认 60s 上限，
    // 于是报 `server did not start in time` 并以 1 退出 —— 但服务其实几秒后
    // 就 ready。默认上限把「慢启动」误判成「启动失败」。
    //
    // 修法只允许抬高**等待时间**；任何就绪判据都不许放宽。本断言防的是
    // 「顺手把 pg_isready / SQL 判据一起删掉，让超时直接算成功」。
    expect(PG_SH.toLowerCase()).toContain('-t 300');
    // 抬高等待后仍必须有连接层复核，且不能无条件继续
    expect(PG_SH).toContain('pg_isready.exe');
    // 真实写法是 `if [ "$start_rc" -ne 0 ]; then` —— 判据必须带上 `[`，
    // 否则断言恒假（这是本仓第 N 次「护栏正则没对着真实语法写」的教训）。
    expect(PG_SH).toMatch(/if\s+\[\s*"\$start_rc"\s+-ne\s+0\s*\]/);
    expect(PG_SH).toContain('exit "$start_rc"');
    // 外层脚本的 SQL 判据必须仍在（超时 ≠ 就绪）
    expect(SCRIPT).toContain("-c 'SELECT 1'");
    // 绝不出现「超时即视为成功」这类无条件放行
    expect(PG_SH).not.toMatch(/pg_ctl[^\n]*-w start[^\n]*\|\|\s*true/);
  });
});
