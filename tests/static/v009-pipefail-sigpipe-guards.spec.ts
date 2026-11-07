import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * v0.0.9：`set -o pipefail` + 提前关管道（SIGPIPE）产生的**假失败**护栏
 *
 * ## 真实故障（不是假设）
 *
 * 已发布的 v0.0.9 安装包里，`deploy/backup.sh` 与 `deploy/restore.sh` 都写着：
 *
 *   if ! gzip -cd "$FILE" 2>/dev/null | head -c 4096 | grep -q . ; then
 *     die "备份内容为空"
 *
 * `head -c 4096` 读够 4 KiB 就退出并**关闭管道**，此时还在写数据的 `gzip`
 * 收到 SIGPIPE（退出码 141）；`grep -q` 命中后也提前退出，同样会打死上游。
 * 而两个脚本都开了 `set -o pipefail` ⇒ **整条流水线**取最后一个非零退出码 ⇒ 141。
 * `!` 取反后条件为真 ⇒ 判定「备份内容为空」。
 *
 * 实测 `PIPESTATUS = "141 0 0"`：head 与 grep 都成功，只有 gzip 被信号杀死。
 *
 * 后果（故障方向与用户预期完全相反）：
 *   · `backup.sh` —— 一个**完全正常**的备份被判为空，**并被 `rm -f` 删掉**；
 *   · `restore.sh` —— **拒绝恢复**一个完全正常的备份。
 * pg_dump 输出一旦超过管道缓冲（Linux 默认 64 KiB）就必然命中，
 * 即「数据越多，越备份不了、越恢复不了」。
 *
 * 为什么长期没被发现：
 *   · 本机 `verify-ops-resilience.sh` 只用**空**备份做负向断言 ——
 *     空备份在旧写法下确实返回非零，但它返回非零的原因是 gzip 被信号杀死，
 *     不是「内容为空」。用错误的判据「测对」了答案，等于假合格证；
 *   · 全新安装验收只跑到「安装完成」，不跑 backup.sh 的完整路径。
 *
 * ## 本护栏断言什么
 *
 * ① **静态**：`deploy/*.sh` 与 `scripts/**\/*.sh` 中不存在
 *    「同一行里既有 `| head -c` 又有 `| grep -q`」这类提前关管道的组合；
 * ② **行为（正向）**：用假 docker 喂一份 >64 KiB 的 pg_dump 输出，
 *    真实执行 `deploy/backup.sh`，必须以 0 退出、保留备份、通过 gzip -t；
 * ③ **行为（负向对照）**：在同一环境里重现旧写法，必须**失败** ——
 *    证明 ② 不是空测试（否则「把判据改成恒真」也能让 ② 变绿）；
 * ④ **行为**：`deploy/restore.sh` 对同一份大备份必须放行，
 *    对真正为空的备份必须以「备份内容为空」拒绝。
 *
 * ②③④ 需要 POSIX shell + gzip + awk，且需要能把带 shebang 的假 docker
 * 放进 PATH 执行。条件不满足时**显式跳过并说明**（不静默通过）。
 */

const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** 递归收集 .sh 文件（只下探一层子目录，覆盖 deploy/ 与 scripts/<组>/） */
function collectShellScripts(): string[] {
  const out: string[] = [];
  const scan = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) continue;
      if (entry.name.endsWith('.sh')) out.push(full);
    }
  };
  scan(path.join(ROOT, 'deploy'));
  const scriptsDir = path.join(ROOT, 'scripts');
  scan(scriptsDir);
  if (existsSync(scriptsDir)) {
    for (const entry of readdirSync(scriptsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) scan(path.join(scriptsDir, entry.name));
    }
  }
  return out;
}

describe('deploy 脚本的 SIGPIPE 假失败护栏', () => {
  it('① 不存在「| head -c … | grep -q」这种提前关管道的组合', () => {
    const offenders: string[] = [];
    for (const file of collectShellScripts()) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, idx) => {
        // 纯注释行里出现该写法属于「说明为什么禁止」，不算违规
        if (/^\s*#/.test(line)) return;
        const closesEarly = /\|\s*head\s+-c\b/.test(line);
        const quietGrep = /\|\s*grep\s+-[A-Za-z]*q/.test(line);
        const maxCountGrep = /\|\s*grep\s+-[A-Za-z]*m\s*1\b/.test(line);
        if (closesEarly && (quietGrep || maxCountGrep)) {
          offenders.push(`${rel}:${idx + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      'pipefail 下 head -c / grep -q 提前关管道会让上游收到 SIGPIPE（141），整条流水线被判失败。\n' +
        '改用「读到 EOF」的写法（wc -c / awk），见 deploy/backup.sh 的注释。',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 行为级：假 docker + 真实 backup.sh / restore.sh
// ---------------------------------------------------------------------------

/** 一份远大于 64 KiB 管道缓冲的 pg_dump 伪输出 */
const BIG_DUMP_AWK =
  'BEGIN { print "--"; print "-- PostgreSQL database dump"; print "--"; print "";' +
  ' for (i = 0; i < 20000; i++) printf "INSERT INTO t VALUES (%d);\\n", i }';

const FAKE_DOCKER = `#!/usr/bin/env bash
cmd="$*"
case "$cmd" in
  "compose version") exit 0 ;;
esac
case "$cmd" in
  *pg_dump*)
    if [ "\${FAKE_DUMP_MODE:-big}" = "empty" ]; then
      exit 0
    fi
    awk '${BIG_DUMP_AWK}'
    exit 0
    ;;
  *psql*)
    # 恢复路径：把 stdin 全部吃掉并报告成功（本测试不连真实数据库）
    cat > /dev/null
    exit 0
    ;;
esac
exit 0
`;

function makeWorkspace(label: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), `v009-${label}-`));
  mkdirSync(path.join(dir, 'bin'), { recursive: true });
  mkdirSync(path.join(dir, 'deploy', 'backups'), { recursive: true });
  for (const s of ['backup.sh', 'restore.sh']) {
    const dst = path.join(dir, 'deploy', s);
    copyFileSync(path.join(ROOT, 'deploy', s), dst);
    chmodSync(dst, 0o755);
  }
  const dockerPath = path.join(dir, 'bin', 'docker');
  writeFileSync(dockerPath, FAKE_DOCKER, 'utf8');
  chmodSync(dockerPath, 0o755);
  writeFileSync(
    path.join(dir, 'deploy', '.env'),
    'POSTGRES_USER=v2ex\nPOSTGRES_DB=v2ex\nPOSTGRES_PASSWORD=not-a-real-password\n',
    'utf8',
  );
  return dir;
}

function run(
  dir: string,
  script: string,
  opts: { args?: string[]; input?: string; env?: Record<string, string> } = {},
) {
  const r = spawnSync('bash', [script, ...(opts.args ?? [])], {
    cwd: path.join(dir, 'deploy'),
    env: {
      ...process.env,
      // 只把假 docker 放到最前面，其余 PATH 保留（gzip/awk/sha256sum 需要真实命令）
      PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
      NO_COLOR: '1', // 关掉 ANSI，便于断言文案
      ...(opts.env ?? {}),
    },
    input: opts.input,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

/** 探测本环境能否真正跑行为级用例（不能跑就显式跳过，不静默变绿） */
function probeCapability(): string | null {
  for (const bin of ['bash', 'gzip', 'awk', 'sha256sum']) {
    const r = spawnSync('bash', ['-lc', `command -v ${bin}`], { encoding: 'utf8' });
    if (r.status !== 0) return `缺少命令 ${bin}`;
  }
  // 真去执行一次「带 shebang、无扩展名、靠 PATH 解析」的代理脚本 ——
  // 不按平台一刀切：能跑就跑（Git Bash 实测可以），跑不起来才跳过并说明原因。
  let probeDir = '';
  try {
    probeDir = mkdtempSync(path.join(os.tmpdir(), 'v009-probe-'));
    const probe = path.join(probeDir, 'v009probe');
    writeFileSync(probe, '#!/usr/bin/env bash\nprintf "probe-ok:%s" "$1"\n', 'utf8');
    chmodSync(probe, 0o755);
    const r = spawnSync('bash', ['-c', 'v009probe hello'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${probeDir}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    if (r.status !== 0 || !(r.stdout ?? '').includes('probe-ok:hello')) {
      return `本环境无法通过 PATH 执行无扩展名的 shebang 脚本（status=${r.status}）`;
    }
    return null;
  } catch (e) {
    return `能力探测失败：${(e as Error).message}`;
  } finally {
    if (probeDir) rmSync(probeDir, { recursive: true, force: true });
  }
}

const SKIP_REASON = probeCapability();

describe.skipIf(SKIP_REASON !== null)('真实 backup.sh / restore.sh 的内容校验（SIGPIPE 回归）', () => {
  let dir = '';

  beforeAll(() => {
    dir = makeWorkspace('bak');
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('② 大体积 dump 备份成功、备份被保留、内容被判为非空', () => {
    const r = run(dir, './backup.sh');
    expect(r.code, `backup.sh 退出码非 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    expect(r.stderr).not.toContain('备份内容为空');

    // 必须报出解压后字节数，且该数值证明这份 dump 确实超过了管道缓冲
    const m = /解压后 (\d+) 字节/.exec(r.stdout);
    expect(m, `未输解压后字节数\nstdout:\n${r.stdout}`).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(65536);

    const backupsDir = path.join(dir, 'deploy', 'backups');
    const gz = readdirSync(backupsDir).filter((f) => f.endsWith('.sql.gz'));
    expect(gz.length, '正常备份被删除了').toBe(1);
    const gzPath = path.join(backupsDir, gz[0]);
    expect(readFileSync(gzPath).length).toBeGreaterThan(0);
    expect(spawnSync('gzip', ['-t', gzPath]).status).toBe(0);
  });

  it('③ 负向对照：同环境重现旧写法必须失败（证明 ② 不是空测试）', () => {
    const ctl = makeWorkspace('ctl');
    try {
      const save = path.join(ctl, 'bin-dump.sql.gz');
      // 造一份与 ② 同量级的大 gz，再直接跑旧流水线
      const gen = spawnSync(
        'bash',
        ['-c', `awk '${BIG_DUMP_AWK}' | gzip -9 > ${JSON.stringify(save)}`],
        { encoding: 'utf8' },
      );
      expect(gen.status, `构造样本失败：${gen.stderr}`).toBe(0);

      const oldWay = spawnSync(
        'bash',
        [
          '-c',
          `set -o pipefail; gzip -cd ${JSON.stringify(save)} 2>/dev/null | head -c 4096 | grep -q . ; echo "rc=$? pipestatus=\${PIPESTATUS[*]}"`,
        ],
        { encoding: 'utf8' },
      );
      const out = `${oldWay.stdout}${oldWay.stderr}`;
      // 旧写法在该样本上必须失败（否则本样例根本触发不到缺陷 ⇒ ② 的通过没有意义）
      expect(out, `旧写法意外成功，样本不足以触发缺陷：${out}`).toMatch(/rc=[1-9]/);
      // 且失败原因确实是 SIGPIPE（141），不是「内容真的为空」
      expect(out).toContain('141');

      // 新写法在同一份样本上必须成功
      const newWay = spawnSync(
        'bash',
        [
          '-c',
          `set -o pipefail; n="$(gzip -cd ${JSON.stringify(save)} 2>/dev/null | wc -c | tr -d '[:space:]')"; echo "bytes=$n"`,
        ],
        { encoding: 'utf8' },
      );
      expect(newWay.status, newWay.stderr).toBe(0);
      expect(Number(/bytes=(\d+)/.exec(newWay.stdout)?.[1] ?? '0')).toBeGreaterThan(65536);
    } finally {
      rmSync(ctl, { recursive: true, force: true });
    }
  });

  it('④ restore.sh 放行正常大备份，拒绝真正为空的备份', () => {
    const backupsDir = path.join(dir, 'deploy', 'backups');
    const goodName = readdirSync(backupsDir).filter((f) => f.endsWith('.sql.gz'))[0];
    expect(goodName, '前置用例未产出备份').toBeTruthy();

    // ⚠️ 必须传**相对路径**：restore.sh 会先 cd 到自身目录，相对路径本就正确；
    //    而在 Git Bash 下把带反斜杠的 Windows 绝对路径交给 `sha256sum`，
    //    输出会带 `\` 转义前缀（`\fb52…`），把 `awk '{print $1}'` 取到的期望值
    //    污染成与真实摘要不等的字符串 —— 那是测试环境的假阳性，不是产品缺陷。
    const okRun = run(dir, './restore.sh', { args: [path.posix.join('backups', goodName)], input: 'y\n' });
    expect(
      okRun.code,
      `restore.sh 拒绝了正常备份\nstdout:\n${okRun.stdout}\nstderr:\n${okRun.stderr}`,
    ).toBe(0);
    expect(okRun.stdout).toContain('备份完整性校验通过');

    // 真正为空的备份：gzip -t 通过（结构合法），但解压后 0 字节 ⇒ 必须被拒
    const emptyName = 'v2ex-empty.sql.gz';
    const emptyGz = path.join(backupsDir, emptyName);
    const made = spawnSync('bash', ['-c', `printf '' | gzip -9 > ${JSON.stringify(emptyGz)}`], {
      encoding: 'utf8',
    });
    expect(made.status, made.stderr).toBe(0);
    expect(spawnSync('gzip', ['-t', emptyGz]).status).toBe(0);

    const badRun = run(dir, './restore.sh', {
      args: [path.posix.join('backups', emptyName)],
      input: 'y\n',
    });
    expect(badRun.code, '空备份竟然被接受').not.toBe(0);
    expect(`${badRun.stdout}${badRun.stderr}`).toContain('备份内容为空');
  });

  it('⑤ backup.sh 对真为空的 dump 仍然拒绝并删除（不放过真空）', () => {
    const empty = makeWorkspace('empty');
    try {
      const r = run(empty, './backup.sh', { env: { FAKE_DUMP_MODE: 'empty' } });
      expect(r.code, '空 dump 竟然被当作成功备份').not.toBe(0);
      expect(`${r.stdout}${r.stderr}`).toContain('备份内容为空');
      const left = readdirSync(path.join(empty, 'deploy', 'backups')).filter((f) =>
        f.endsWith('.sql.gz'),
      );
      expect(left, '空备份文件未被清理').toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

if (SKIP_REASON) {
  // 显式记录跳过原因：避免「0 个用例执行」被误读成「全部通过」
  // eslint-disable-next-line no-console
  console.warn(`[v009-pipefail-sigpipe-guards] 行为级用例已跳过：${SKIP_REASON}`);
}
