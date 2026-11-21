import { copyFile, lstat, mkdir, readdir, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * v0.0.20 启动前迁移：把 v0.0.19 及更早版本写在 public/uploads 的文件
 * 移到私有 uploads 根。必须在 next start 快照 public/ 之前完成。
 *
 * 安全约束：
 *   · legacy 根本身或内部出现符号链接 ⇒ 拒绝启动；
 *   · 目标已存在同名文件 ⇒ 拒绝覆盖；
 *   · 每个文件复制后校验字节数；
 *   · 只有全部文件复制并校验成功后才删除 legacy 文件。
 */
const legacyRoot = path.resolve(process.cwd(), 'public', 'uploads');
const targetRoot = path.resolve(
  process.env.UPLOAD_ROOT ?? path.join(process.cwd(), 'data', 'uploads'),
);

if (targetRoot === legacyRoot || targetRoot.startsWith(legacyRoot + path.sep)) {
  throw new Error('UPLOAD_ROOT 不能位于 public/uploads 内部');
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertNoSymlink(target) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) {
    throw new Error(`拒绝迁移包含符号链接的上传目录：${target}`);
  }
}

async function copyTree(source, target) {
  await assertNoSymlink(source);
  await mkdir(target, { recursive: true });
  const entries = await readdir(source);
  let copied = 0;

  for (const entry of entries) {
    const sourcePath = path.join(source, entry);
    const targetPath = path.join(target, entry);
    const stat = await lstat(sourcePath);

    if (stat.isSymbolicLink()) {
      throw new Error(`拒绝迁移符号链接：${sourcePath}`);
    }
    if (stat.isDirectory()) {
      copied += await copyTree(sourcePath, targetPath);
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`拒绝迁移非普通文件：${sourcePath}`);
    }
    if (await pathExists(targetPath)) {
      throw new Error(`迁移目标已存在，拒绝覆盖：${targetPath}`);
    }

    await copyFile(sourcePath, targetPath);
    const copiedStat = await lstat(targetPath);
    if (copiedStat.size !== stat.size) {
      throw new Error(`迁移复制大小不一致：${sourcePath}`);
    }
    copied += 1;
  }

  return copied;
}

async function removeTree(target) {
  const stat = await lstat(target);
  if (stat.isDirectory()) {
    const entries = await readdir(target);
    for (const entry of entries) {
      await removeTree(path.join(target, entry));
    }
    await rmdir(target);
    return;
  }
  await unlink(target);
}

if (!(await pathExists(legacyRoot))) {
  process.exit(0);
}

await assertNoSymlink(legacyRoot);
const copied = await copyTree(legacyRoot, targetRoot);
await removeTree(legacyRoot);
console.log(`[upload-migration] 已将 ${copied} 个文件从 public/uploads 迁移到 ${targetRoot}`);
