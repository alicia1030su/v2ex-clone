import 'server-only';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_ROOT } from '@/lib/upload-storage';

export const REPLY_IMAGE_UPLOAD_ROOT = UPLOAD_ROOT;

export function resolveReplyImagePath(storagePath: string): string | null {
  if (!/^replies\/\d+\/[a-f0-9]{8,64}\.(png|jpg|webp|gif)$/.test(storagePath)) return null;
  const root = path.resolve(REPLY_IMAGE_UPLOAD_ROOT);
  const target = path.resolve(root, storagePath);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

export async function deleteReplyImageFile(storagePath: string): Promise<void> {
  const absolute = resolveReplyImagePath(storagePath);
  if (!absolute) throw new Error('非法回复图片存储路径');
  try {
    await unlink(absolute);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
