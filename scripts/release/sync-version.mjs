#!/usr/bin/env node
/**
 * v0.0.7：版本载体一次性同步（任务书 §七）
 *
 * ## 为什么需要它
 *
 * 版本号散落在 10+ 个文件里（package.json / deploy/VERSION / .env.example /
 * install.sh / install.ps1 / docker-compose.yml / README.md / CHANGELOG.md …）。
 * 手工同步必然漏项 —— 而「安装包里的版本号与 Git Tag 不一致」是发行事故里
 * 最难解释的一类（用户拿着 0.0.5 的包、里面写着 0.0.4）。
 *
 * ## 纪律（G-VER-01）
 *
 * - **最终 SHA 固定之前不得运行本脚本**（dev 态保持上一稳定版本是预期状态）；
 * - 运行后必须重新验证**同一个提交**（脚本自带 --verify 模式）；
 * - 严禁「只改 ZIP 文件名冒充版本更新」—— 本脚本改的是**源码载体**，
 *   候选包必须由同步后的提交重新构建。
 *
 * ## 用法
 *
 *   node scripts/release/sync-version.mjs 0.0.7            # 同步
 *   node scripts/release/sync-version.mjs 0.0.7 --verify   # 只校验不改
 *   node scripts/release/sync-version.mjs 0.0.7 --dry-run  # 只看会改什么
 *
 * 退出码：0 = 成功 / 1 = 校验失败或载体缺失
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(process.cwd());
const argv = process.argv.slice(2);
const target = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const flags = new Set(argv.filter((a) => a.startsWith('--')));

if (!target) {
  console.error('用法: node scripts/release/sync-version.mjs <x.y.z> [--verify|--dry-run]');
  process.exit(1);
}
const MAJOR = `v${target}`;

/** 载体定义：文件 → 替换规则 */
const CARRIERS = [
  {
    file: 'package.json',
    label: 'npm 版本',
    apply: (s) => s.replace(/("version"\s*:\s*")[^"]+(")/, `$1${target}$2`),
    verify: (s) => new RegExp(`"version"\\s*:\\s*"${target.replace(/\./g, '\\.')}"`).test(s),
  },
  {
    file: 'deploy/VERSION',
    label: '部署版本文件',
    apply: (s) => `${target}\n`,
    verify: (s) => s.trim() === target,
  },
  {
    file: 'deploy/.env.example',
    label: '环境变量示例',
    // 实际格式：V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.4（无引号）
    // ⚠️ 镜像路径含斜杠 ⇒ 用 [^\s:]+ 而不是 [^:\/]+（后者匹配不到命名空间）
    apply: (s) => s.replace(/(V2EX_IMAGE=ghcr\.io\/[^\s:]+:)[^\s]+/, `$1${MAJOR}`),
    verify: (s) => new RegExp(`V2EX_IMAGE=ghcr\\.io/[^\\s:]+:${MAJOR.replace(/\./g, '\\.')}\\s*$`, 'm').test(s),
  },
  {
    file: 'deploy/install.sh',
    label: 'Linux 安装脚本',
    apply: (s) =>
      s
        .replace(/(APP_VERSION\s*=\s*")[^"]+(")/, `$1${target}$2`)
        .replace(/(DEFAULT_IMAGE\s*=\s*"[^":]+:)[^"]+(")/, `$1${MAJOR}$2`),
    verify: (s) =>
      new RegExp(`APP_VERSION\\s*=\\s*"${target.replace(/\./g, '\\.')}"`).test(s) &&
      s.includes(`:${MAJOR}"`),
  },
  {
    file: 'deploy/install.ps1',
    label: 'Windows 安装脚本',
    apply: (s) =>
      s
        .replace(/(\$AppVersion\s*=\s*')[^']+(')/, `$1${target}$2`)
        .replace(/(\$DefaultImage\s*=\s*'[^':]+:)[^']+(')/, `$1${MAJOR}$2`),
    verify: (s) =>
      new RegExp(`\\$AppVersion\\s*=\\s*'${target.replace(/\./g, '\\.')}'`).test(s) &&
      s.includes(`:${MAJOR}'`),
  },
  {
    file: 'deploy/docker-compose.yml',
    label: 'Compose 默认镜像',
    apply: (s) => s.replace(/(v2ex-clone:)v\d+\.\d+\.\d+/, `$1${MAJOR}`),
    verify: (s) => s.includes(`v2ex-clone:${MAJOR}`),
  },
  {
    /*
     * ⚠️ v0.0.10：**必须覆盖 `deploy/README.md`**。
     *
     * 这个文件的标题行是 `# V2EX Clone vX.Y.Z — 一键部署包`，属于**发布物内**
     * 的版本载体（打包时随 ZIP 一起发给用户）。此前它从未被本脚本覆盖，
     * 于是一直停在 `v0.0.9`，直到发布流水线的「包内版本一致性校验（N2）」
     * 把它抓出来：
     *   ##[error]README.md 标题首行版本标注不是 v0.0.10：'# V2EX Clone v0.0.9 — 一键部署包'
     *
     * 这也说明 N2 检查是有价值的 —— 它比 sync-version 的载体清单更宽，
     * 能捞到「清单漏项」。但**清单漏项本身也要修**，否则每次发版都靠
     * 流水线兜底，等于把「同步」这件事交给运气。
     */
    file: 'deploy/README.md',
    label: '部署包 README 标题',
    apply: (s) => s.replace(/^(#\s+V2EX Clone v)\d+\.\d+\.\d+/m, `$1${target}`),
    verify: (s) => new RegExp(`^#\\s+V2EX Clone v${target.replace(/\./g, '\\.')}`, 'm').test(s),
  },
  {
    file: 'README.md',
    label: 'README 当前版本',
    apply: (s) =>
      s
        .replace(/(## 当前版本：v)\d+\.\d+\.\d+/, `$1${target}`)
        .replace(/(V2EX Clone v)\d+\.\d+\.\d+/g, `$1${target}`),
    verify: (s) => s.includes(`## 当前版本：v${target}`),
  },
];

/** 读取 / 写入（保留原换行风格） */
function read(p) {
  return readFileSync(path.join(ROOT, p), 'utf8');
}
function write(p, s) {
  writeFileSync(path.join(ROOT, p), s, 'utf8');
}

console.log(`\n════ 版本载体同步 → ${target} ════\n`);

// ---- 1. 前置检查：工作区必须干净（版本同步必须落在确定的内容上）----
if (!flags.has('--verify')) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    if (status.trim() && !flags.has('--force')) {
      console.error('✗ 工作区有未提交改动 —— 版本同步必须落在干净的工作区上。');
      console.error('  先提交（或 stash），或用 --force 确认你确实要在脏树上同步。');
      console.error(status.trim().split('\n').slice(0, 10).join('\n'));
      process.exit(1);
    }
  } catch {
    /* git 不可用时放行（CI 外环境） */
  }
}

let failed = 0;
const changed = [];

for (const c of CARRIERS) {
  const p = path.join(ROOT, c.file);
  if (!existsSync(p)) {
    console.log(`✗ ${c.label}（${c.file}）—— 文件不存在`);
    failed++;
    continue;
  }
  const before = read(c.file);

  if (flags.has('--verify')) {
    const ok = c.verify(before);
    console.log(`${ok ? '✓' : '✗'} ${c.label}（${c.file}）${ok ? '' : `—— 未同步到 ${target}`}`);
    if (!ok) failed++;
    continue;
  }

  const after = c.apply(before);
  if (after === before) {
    // 没变化：可能是已经是目标版本，也可能是规则没匹配上
    const ok = c.verify(before);
    console.log(`${ok ? '✓' : '⚠'} ${c.label}（${c.file}）—— ${ok ? '已是目标版本' : '规则未匹配（请检查载体格式）'}`);
    if (!ok) failed++;
    continue;
  }

  if (flags.has('--dry-run')) {
    console.log(`· ${c.label}（${c.file}）—— 将更新`);
    changed.push(c.file);
  } else {
    write(c.file, after);
    const ok = c.verify(after);
    console.log(`${ok ? '✓' : '✗'} ${c.label}（${c.file}）—— 已写入`);
    if (!ok) failed++;
    changed.push(c.file);
  }
}

// ---- 2. 同步后必须重新验证**同一个提交** ----
if (!flags.has('--verify') && !flags.has('--dry-run') && failed === 0) {
  console.log('\n════ 写后复验（同一提交）════');
  for (const c of CARRIERS) {
    const ok = existsSync(path.join(ROOT, c.file)) && c.verify(read(c.file));
    console.log(`${ok ? '✓' : '✗'} ${c.label}`);
    if (!ok) failed++;
  }
}

console.log(
  `\n════ 结果：${failed === 0 ? '全部通过' : `${failed} 项失败`}` +
    `${changed.length ? `（改动 ${changed.length} 个文件）` : ''} ════\n`,
);

if (failed > 0) process.exit(1);

if (!flags.has('--verify') && !flags.has('--dry-run')) {
  console.log('后续必做（任务书 §七）：');
  console.log('  1. git checkout -b release/v' + target + ' && git commit -am "chore(release): 同步版本载体到 ' + target + '"');
  console.log('  2. 重新运行完整测试（该提交上）');
  console.log('  3. 由**同步后的提交**重新构建候选包（严禁只改 ZIP 文件名）');
  console.log('  4. 验证：Windows 安装 / Linux Docker 安装 / 旧候选升级 / 备份恢复 / 卷保留 / 口令不变');
  console.log('  5. 镜像 Digest + ZIP SHA256 校验\n');
}
