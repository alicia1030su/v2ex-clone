/**
 * 生成发布 ZIP 并**断言包内脚本权限**（v0.0.10）
 *
 * ## 为什么不能用 `zip -r`
 *
 * `zip` 会把 Git 索引里的文件模式原样写进 ZIP 的外部属性：
 *   - `100644`（0644）⇒ 解压后 `./install.sh` 直接 Permission denied；
 *   - `100755`（0755）⇒ 正常执行。
 *
 * v0.0.1~v0.0.9 的**全部**发布包都在这上面翻过车（BUG_REGISTER V9-09）：
 * Git 里是 100644，ZIP 里就是 0644，用户照文档 `chmod +x install.sh` 能跑主流程，
 * 但 `./start.sh` / `./backup.sh` / `./restore.sh` 仍然报错。
 *
 * 源码权限位已在 v0.0.9 之后修为 100755，但**只改源码不够** ——
 * 这条链路有三段（Git 模式 → ZIP 外部属性 → 解压后磁盘权限），
 * 任何一段回归都会静默产生「下载下来不能跑」的包，而 CI 里的安装验证
 * 用的是工作区文件（有 0755），根本测不到 ZIP 这一段。
 *
 * ## 本脚本做三件事
 *
 * 1. **强制写入 0755** 外部属性（不依赖 Git 模式 —— 即使有人 checkout 时
 *    丢了 exec 位，包仍然是对的）；
 * 2. **当场回读校验**：用 `unzip -Z` 解析每个 `.sh` 的 Unix mode，不等 0755 就失败；
 * 3. **真解压到临时目录**，用 `fs.stat().mode` 校验磁盘权限（而不是只看 ZIP 元数据）。
 *
 * ## 用法
 *
 *   node scripts/release/package-deploy-zip.mjs --version 0.0.10 --out dist/
 *
 * 退出码非 0 ⇒ 产物不可用于发布。
 */
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

const argv = process.argv.slice(2);
const get = (n, d = null) => {
  const eq = argv.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const ROOT = path.resolve(get('root', process.cwd()));
const VERSION = get('version');
const OUT_DIR = path.resolve(get('out', path.join(ROOT, 'dist')));
const SRC_DIR = get('src', 'deploy');

if (!VERSION) {
  console.error('✗ 缺少 --version');
  process.exit(2);
}

/** 打包时必须排除的东西（凭据 / 生成配置 / 运行数据） */
const EXCLUDES = [
  '.env',
  '.env.local',
  '.env.test',
  '.env.production',
  '.env.development',
  '.env.backup',
  'INSTALL_CREDENTIALS.txt',
  'backups',
];

/** 必须存在于包内的文件（缺一个就判失败） */
const REQUIRED = [
  'docker-compose.yml',
  '.env.example',
  'install.sh',
  'install.ps1',
  'start.sh',
  'stop.sh',
  'update.sh',
  'backup.sh',
  'restore.sh',
  'health-check.sh',
  'README.md',
  'INSTALL.md',
  'VERSION',
  'LICENSE',
];

/**
 * 极简 ZIP 写入器（store 模式）
 *
 * 为什么不用第三方库：仓库不想为「打个包」增加一个生产依赖，
 * 而 `zip` 命令在 Windows runner 上不可靠。store 模式（不压缩）保持
 * 文件内容逐字节可校验，且脚本体积很小，无损于产物体积可接受范围。
 */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  // 固定时间戳，保证同一输入产出**同一字节**的 ZIP（可复现构建）
  const dosTime = ((12 << 11) | (0 << 5) | 0) & 0xffff; // 12:00:00
  const dosDate = (((2026 - 1980) << 9) | (11 << 5) | 8) & 0xffff; // 2026-11-08

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 flag
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    // ⚠️ 关键：version made by 的高字节 = Unix（3），配合 external attr 的
    //    高 16 位写文件模式，解压器才会按 0755 落盘。
    cd.writeUInt16LE((3 << 8) | 20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    // ⚠️ 必须 `>>> 0`：JS 位运算按 **int32** 求值，0755<<16 = 0x81ED0000
    //    在 int32 下是负数 ⇒ writeUInt32LE 抛 ERR_OUT_OF_RANGE。
    cd.writeUInt32LE((e.mode << 16) >>> 0, 38); // external attributes
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, cdBuf, end]);
}

function walk(dir, base) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDES.includes(name.name)) continue;
    const abs = path.join(dir, name.name);
    const rel = path.posix.join(base, name.name);
    if (name.isDirectory()) {
      out.push(...walk(abs, rel));
    } else if (name.isFile()) {
      out.push({ rel, abs });
    }
  }
  return out;
}

function main() {
  const srcAbs = path.join(ROOT, SRC_DIR);
  try {
    statSync(srcAbs);
  } catch {
    console.error(`✗ 源目录不存在：${srcAbs}`);
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const files = walk(srcAbs, SRC_DIR);
  const entries = files.map((f) => {
    const isShell = f.rel.endsWith('.sh');
    return {
      name: f.rel,
      data: readFileSync(f.abs),
      // 目录不加条目（解压器会自动创建）；文件模式：脚本 0755，其余 0644
      mode: isShell ? 0o100755 : 0o100644,
    };
  });

  // ── 前置断言：必需文件齐全 ──
  const present = new Set(entries.map((e) => path.posix.basename(e.name)));
  const missing = REQUIRED.filter((r) => !present.has(r));
  if (missing.length) {
    console.error(`✗ 缺少必需文件：${missing.join(', ')}`);
    process.exit(1);
  }

  const zipName = `v2ex-clone-v${VERSION}-deploy.zip`;
  const zipPath = path.join(OUT_DIR, zipName);

  writeFileSync(zipPath, buildZip(entries));

  /*
   * ── 回读校验 1：直接解析 ZIP **中央目录**里的 Unix mode ──
   *
   * 不用 `unzip -Z` 的文本输出：它的列宽随版本变化，用正则抓「4 位数字」
   * 会抓到**字节数**而不是权限位（实测：`much 6693` 被误判成 mode=6693）。
   * 直接读中央目录是唯一无歧义的判据，且不依赖系统是否装了 unzip。
   */
  const pool = readFileSync(zipPath);
  const eocd = pool.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) {
    console.error('✗ 找不到 ZIP 中央目录结尾（EOCD）—— 产物结构损坏');
    process.exit(1);
  }
  const total = pool.readUInt16LE(eocd + 10);
  let p = pool.readUInt32LE(eocd + 16);
  const entriesInfo = [];
  for (let i = 0; i < total; i++) {
    if (pool.readUInt32LE(p) !== 0x02014b50) {
      console.error('✗ 中央目录条目签名不符');
      process.exit(1);
    }
    const madeBy = pool.readUInt16LE(p + 4);
    const mode = (pool.readUInt32LE(p + 38) >>> 16) & 0xffff;
    const nameLen = pool.readUInt16LE(p + 28);
    const extraLen = pool.readUInt16LE(p + 30);
    const commentLen = pool.readUInt16LE(p + 32);
    const name = pool.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entriesInfo.push({ name, mode, host: madeBy >> 8 });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const shells = entriesInfo.filter((e) => e.name.endsWith('.sh'));
  if (!shells.length) {
    console.error('✗ 包内没有任何 .sh —— 打包规则失效');
    process.exit(1);
  }
  const badMode = shells.filter((e) => e.mode !== 0o100755 || e.host !== 3);
  if (badMode.length) {
    console.error(
      '✗ ZIP 内脚本的 Unix 模式不对：' +
        badMode.map((e) => `${e.name}=0o${e.mode.toString(8)}(host=${e.host})`).join(', '),
    );
    process.exit(1);
  }
  console.log(`✓ ZIP 中央目录：${shells.length} 个 .sh 的 Unix 模式均为 0o100755`);

  // ── 回读校验 2：真解压，校验磁盘权限（仅 POSIX —— Windows 的 NTFS 无 exec 位）──
  if (process.platform !== 'win32') {
    const tmp = mkdtempSync(path.join(tmpdir(), 'v0010-zip-'));
    try {
      execFileSync('unzip', ['-q', zipPath, '-d', tmp]);
      const exDir = path.join(tmp, SRC_DIR);
      const onDisk = readdirSync(exDir).filter((n) => n.endsWith('.sh'));
      const notExec = onDisk.filter((n) => (statSync(path.join(exDir, n)).mode & 0o111) === 0);
      if (notExec.length) {
        console.error(`✗ 解压后脚本无执行位：${notExec.join(', ')}`);
        process.exit(1);
      }
      console.log(`✓ 真实解压后 ${onDisk.length} 个 .sh 均带执行位（未预先 chmod）`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else {
    console.log('  [info] Windows 无 POSIX exec 位，跳过磁盘权限校验（由 CI 的 ubuntu runner 覆盖）');
  }

  // ── 回读校验 3：解压后的内容断言（版本载体 / 无凭据）──
  const tmp2 = mkdtempSync(path.join(tmpdir(), 'v0010-zipc-'));
  try {
    execFileSync('unzip', ['-q', zipPath, '-d', tmp2]);
    const exDir = path.join(tmp2, SRC_DIR);

    const vFile = readFileSync(path.join(exDir, 'VERSION'), 'utf8').trim();
    if (vFile !== VERSION) {
      console.error(`✗ 包内 VERSION=${vFile}，期望 ${VERSION}`);
      process.exit(1);
    }
    const compose = readFileSync(path.join(exDir, 'docker-compose.yml'), 'utf8');
    if (!compose.includes(`:v${VERSION}`)) {
      console.error(`✗ docker-compose.yml 未引用 :v${VERSION}`);
      process.exit(1);
    }
    const installSh = readFileSync(path.join(exDir, 'install.sh'), 'utf8');
    if (!installSh.includes(`APP_VERSION="${VERSION}"`)) {
      console.error(`✗ install.sh 的 APP_VERSION 不是 ${VERSION}`);
      process.exit(1);
    }
    console.log(`✓ 包内版本载体一致（VERSION / docker-compose.yml / install.sh = ${VERSION})`);

    const leaked = walk(tmp2, '').filter(
      (f) =>
        /\.env$/i.test(f.rel) ||
        /INSTALL_CREDENTIALS/i.test(f.rel) ||
        f.rel.includes('/backups/') ||
        /\.pem$|\.key$/i.test(f.rel),
    );
    if (leaked.length) {
      console.error(`✗ 包内含凭据/运行数据：${leaked.map((f) => f.rel).join(', ')}`);
      process.exit(1);
    }
    console.log('✓ 包内无 .env / 凭据 / backups');
  } finally {
    rmSync(tmp2, { recursive: true, force: true });
  }

  const sha = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
  writeFileSync(path.join(OUT_DIR, 'SHA256SUMS'), `${sha}  ${zipName}\n`);
  console.log(`\n✓ 产物：${zipPath}`);
  console.log(`✓ SHA256：${sha}`);
}

main();
