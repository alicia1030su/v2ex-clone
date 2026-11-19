import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * v0.0.17 P0-3 候选包可复现性：**真实构建三次，SHA256 必须完全相同**
 * ============================================================================
 *
 * ## 缺陷本体（v0.0.16 实测）
 *
 * 候选包用的是 `zip -qr`：
 *
 * ```bash
 * ( cd "$DEPLOY_STAGE" && zip -qr "$ZIP_PATH" . )
 * ```
 *
 * `zip` 把每个文件的**实际 mtime** 写进 ZIP 头。同一源码、同一工具链、
 * 连续构建三次，得到**三个不同的 SHA256**：
 *
 * ```
 * 0b8242b20b27d841292b1ff92142e1ccafd8d0398e43ce4153bdf041576b2ffe
 * b6f766671e71fec081d751f709bc0f422e04208fd9a9d4472583a8528de34870
 * 5b52c17d385b630e885c10d344d118a9309f3b29e69831d889a659b217c740e3
 * ```
 *
 * 后果：**「候选包是不是同一份」无法用哈希回答**，只能逐字节人肉比对。
 * 这直接违背「产物可追溯」的前提 —— 你没法用 SHA256 证明候选包与某次
 * 验收结果是同一份。
 *
 * ## 修法
 *
 * 候选包改用与正式包**同一个打包器** `package-deploy-zip.mjs`：
 * 固定时间戳（2026-11-08 12:00）、固定条目顺序（路径排序）、
 * 固定权限（Unix mode 显式写入中央目录）、store 模式（不压缩）。
 *
 * ⚠️ 注意：**不要求**候选包与正式包字节相同 —— 它们的文件名与镜像引用
 * 不同（`v2ex-clone-candidate:v<ver>` vs `ghcr.io/...:v<ver>`），
 * 本来就不是同一个产物。要求的是**各自可复现**，且共用可审计的打包规则。
 *
 * ## 本 spec 真的构建三次（不是字符串匹配）
 *
 * 把 `deploy/` 复制到临时目录，用同一个打包器连打三次，
 * 断言三个 SHA256 **完全相同**。这是唯一能证明「可复现」的方式。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const PACKER = path.join(ROOT, 'scripts/release/package-deploy-zip.mjs');
const BUILD_CANDIDATE = readFileSync(path.join(ROOT, 'scripts/release/build-candidate.sh'), 'utf8');

/**
 * 版本号必须**取自源码载体**，不能写死。
 *
 * 第一版写死 `'0.0.17'`，而当时 `deploy/VERSION` 还是 `0.0.16`
 * ⇒ 打包器的「包内版本载体一致」校验先判红，三次比较根本没跑到。
 * 这不是打包器的错 —— 它本来就应该拦住版本与内容不符的包。
 */
const VERSION = readFileSync(path.join(ROOT, 'deploy/VERSION'), 'utf8').trim();

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** 把 deploy/ 复制成一份可打包的 stage 目录（排除运行时产物） */
function stageDeploy(dir: string): string {
  const stage = path.join(dir, 'stage');
  mkdirSync(stage, { recursive: true });
  cpSync(path.join(ROOT, 'deploy'), stage, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(path.join(ROOT, 'deploy'), src);
      if (!rel) return true;
      // 排除凭据与运行数据（打包器也会排除，这里提前清掉避免误打包）
      if (rel === 'backups' || rel.startsWith('backups' + path.sep)) return false;
      return true;
    },
  });
  // 确保必需文件存在（打包器会断言）
  const envExample = path.join(stage, '.env.example');
  if (!existsSync(envExample)) {
    throw new Error('stage 里缺少 .env.example —— 本 spec 的前提不成立，需检查 deploy/ 内容');
  }
  return stage;
}

function packOnce(stage: string, outDir: string, version: string): string {
  execFileSync(
    process.execPath,
    [PACKER, '--version', version, '--out', outDir, '--src', stage, '--name', 'candidate'],
    { cwd: ROOT, stdio: 'pipe' },
  );
  const zip = path.join(outDir, `v2ex-clone-v${version}-candidate.zip`);
  if (!existsSync(zip)) throw new Error(`打包器未产出预期文件：${zip}`);
  return zip;
}

describe('v0.0.17 P0-3 候选包：三次构建 SHA256 必须完全相同', () => {
  it('同一 stage、同一版本，连续构建三次 → 三个 SHA256 完全一致', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'v017-repro-'));
    try {
      const stage = stageDeploy(dir);
      const hashes: string[] = [];
      for (let i = 1; i <= 3; i++) {
        /*
         * ⚠️ 两次构建之间**必须跨过 ZIP 时间戳的 2 秒粒度**（FAT/DOS 时间）。
         *
         * 否则这个用例会「假绿」：三次构建落在同一秒内时，即使打包器写的是
         * 真实 mtime，三次的 dosTime 也相同 ⇒ 产物相同 ⇒ 用例通过，
         * 而它本应证明「mtime 不会进入产物」。
         *
         * 实测确认：把固定时间戳改回真实时间、且不加这点等待，
         * 「三次一致」那条**仍然通过**，「无关文件」那条才判红。
         * 判据只靠运气兜住缺陷，等于没兜住。
         */
        if (i > 1) execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 2500)']);
        const outDir = path.join(dir, `out${i}`);
        hashes.push(sha256(packOnce(stage, outDir, VERSION)));
      }

      expect(hashes[0], '第一次构建产物为空').toHaveLength(64);
      expect(
        new Set(hashes).size,
        `三次构建得到 ${new Set(hashes).size} 个不同的 SHA256 —— 不可复现：\n` +
          hashes.map((h, i) => `  #${i + 1} ${h}`).join('\n') +
          '\n最常见原因是打包时写入了文件 mtime（`zip -qr` 就是这样）。',
      ).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('打两次之间插入一个**无关文件**到仓库根，产物仍不变（只认 stage 内内容）', () => {
    /*
     * 反向验证：打包器不得扫描仓库根、不得把仓库状态（比如 git 时间、
     * 其它目录的 mtime）带进产物。它只应看 --src 指向的目录。
     */
    const dir = mkdtempSync(path.join(tmpdir(), 'v017-repro2-'));
    const noise = path.join(ROOT, '.v017-repro-noise');
    try {
      const stage = stageDeploy(dir);
      const h1 = sha256(packOnce(stage, path.join(dir, 'a'), VERSION));

      mkdirSync(noise, { recursive: true });
      const { writeFileSync } = require('node:fs') as typeof import('node:fs');
      writeFileSync(path.join(noise, 'x.txt'), 'noise');

      const h2 = sha256(packOnce(stage, path.join(dir, 'b'), VERSION));
      expect(h2, '仓库里多了一个无关目录就改变了产物 —— 打包输入不纯').toBe(h1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(noise, { recursive: true, force: true });
    }
  });
});

describe('v0.0.17 P0-3 候选包构建脚本：必须走确定性打包器', () => {
  it('不得再出现 `zip -qr`（那是 mtime 进入 ZIP 的入口）', () => {
    // 只看**可执行代码**，不看注释（注释里解释这个坑是合法的）
    const code = BUILD_CANDIDATE.split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(
      /zip\s+-(?:q|r|9|Z)/.test(code),
      'build-candidate.sh 又用回了 `zip` —— 文件 mtime 会进入 ZIP，产物不可复现',
    ).toBe(false);
  });

  it('必须调用 package-deploy-zip.mjs，且 `--name candidate`', () => {
    expect(BUILD_CANDIDATE).toContain('package-deploy-zip.mjs');
    expect(BUILD_CANDIDATE, '候选包必须用 --name candidate 命名').toMatch(/--name candidate/);
    expect(BUILD_CANDIDATE, '必须把 stage 目录传给打包器').toMatch(/--src\s+"?\$DEPLOY_STAGE/);
  });

  it('打包失败必须 die（不得留下半成品继续往下走）', () => {
    expect(BUILD_CANDIDATE).toMatch(/die\s+"候选 ZIP 打包失败/);
  });
});

describe('v0.0.17 P0-3 正式包与候选包：共用规则但不要求字节相同', () => {
  it('两者必须出自同一个打包器（否则规则会漂移）', () => {
    // 正式包由 release.yml 调用 package-deploy-zip.mjs；候选包由 build-candidate.sh 调用
    const WF = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
    expect(WF).toContain('package-deploy-zip.mjs');
    expect(BUILD_CANDIDATE).toContain('package-deploy-zip.mjs');
  });

  it('两者文件名不同（用途不同，不能混淆）', () => {
    expect(BUILD_CANDIDATE).toMatch(/v2ex-clone-v\$\{VERSION\}-\$\{?[A-Z]*KIND?|candidate\.zip/);
    // 正式包名由打包器内部拼接
    const PACKER_SRC = readFileSync(PACKER, 'utf8');
    expect(PACKER_SRC).toMatch(/v2ex-clone-v\$\{VERSION\}-\$\{NAME_KIND\}\.zip/);
  });
});
