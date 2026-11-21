import 'server-only';
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  detectImageFormat,
  mimeTypeForFormat,
  type AvatarFormat,
} from '@/lib/avatar';

/** 回复图片默认上限：5MB、4000 万像素、最长边 2400px。 */
export const MAX_REPLY_IMAGE_BYTES = Number(process.env.REPLY_IMAGE_MAX_BYTES ?? 5 * 1024 * 1024);
export const MAX_REPLY_IMAGE_PIXELS = Number(process.env.REPLY_IMAGE_MAX_PIXELS ?? 40_000_000);
export const MAX_REPLY_IMAGE_DIMENSION = Number(process.env.REPLY_IMAGE_MAX_DIMENSION ?? 2400);

export const REPLY_IMAGE_UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');
const REPLY_IMAGE_SUBDIR = 'replies';
const FORMAT_EXT: Record<AvatarFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
};

export type ProcessedReplyImage = {
  data: Buffer;
  format: AvatarFormat;
  width: number;
  height: number;
};

export function validateReplyImageBytes(buffer: Buffer): AvatarFormat {
  if (buffer.length === 0) throw new Error('文件为空');
  if (buffer.length > MAX_REPLY_IMAGE_BYTES) {
    throw new Error(`图片大小不能超过 ${Math.floor(MAX_REPLY_IMAGE_BYTES / 1024 / 1024)}MB`);
  }
  const format = detectImageFormat(buffer);
  if (!format) throw new Error('只支持 PNG / JPEG / WebP / GIF 格式的图片');
  return format;
}

export async function processReplyImage(
  buffer: Buffer,
  format: AvatarFormat,
): Promise<ProcessedReplyImage> {
  let sharp: typeof import('sharp').default;
  try {
    const mod = (await import('sharp')) as unknown as {
      default?: typeof import('sharp').default;
    };
    sharp = mod.default ?? (mod as unknown as typeof import('sharp').default);
  } catch {
    throw new Error('服务端图片处理能力不可用');
  }

  try {
    const image = sharp(buffer, {
      limitInputPixels: MAX_REPLY_IMAGE_PIXELS,
      animated: false,
    });
    const meta = await image.metadata();
    const width = Number(meta.width ?? 0);
    const height = Number(meta.height ?? 0);
    if (width <= 0 || height <= 0) throw new Error('无法读取图片尺寸');
    if (width * height > MAX_REPLY_IMAGE_PIXELS) throw new Error('图片像素数量超过限制');

    const pipeline = image.rotate().resize({
      width: MAX_REPLY_IMAGE_DIMENSION,
      height: MAX_REPLY_IMAGE_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });

    let data: Buffer;
    switch (format) {
      case 'png':
        data = await pipeline.png({ compressionLevel: 9 }).toBuffer();
        break;
      case 'jpeg':
        data = await pipeline.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
        break;
      case 'webp':
        data = await pipeline.webp({ quality: 86 }).toBuffer();
        break;
      case 'gif':
        data = await pipeline.png({ compressionLevel: 9 }).toBuffer();
        return {
          data,
          format: 'png',
          width: Math.min(width, MAX_REPLY_IMAGE_DIMENSION),
          height: Math.min(height, MAX_REPLY_IMAGE_DIMENSION),
        };
    }

    const outMeta = await sharp(data).metadata();
    return {
      data,
      format,
      width: Number(outMeta.width ?? width),
      height: Number(outMeta.height ?? height),
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('超过限制')) throw err;
    throw new Error('无法解析或处理该图片文件');
  }
}

export function buildReplyImageStoragePath(userId: number, format: AvatarFormat): string {
  const random = randomBytes(16).toString('hex');
  return `${REPLY_IMAGE_SUBDIR}/${userId}/${random}.${FORMAT_EXT[format]}`;
}

export function resolveReplyImagePath(storagePath: string): string | null {
  if (!/^replies\/\d+\/[a-f0-9]{8,64}\.(png|jpg|webp|gif)$/.test(storagePath)) return null;
  const root = path.resolve(REPLY_IMAGE_UPLOAD_ROOT);
  const target = path.resolve(root, storagePath);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

export function publicUrlForReplyImage(storagePath: string): string {
  return `/uploads/${storagePath}`;
}

export async function writeReplyImageFile(
  userId: number,
  format: AvatarFormat,
  data: Buffer,
): Promise<string> {
  const storagePath = buildReplyImageStoragePath(userId, format);
  const absolute = resolveReplyImagePath(storagePath);
  if (!absolute) throw new Error('非法的回复图片存储路径');
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, data, { flag: 'wx' });
  return storagePath;
}

export async function deleteReplyImageFile(storagePath: string): Promise<void> {
  const absolute = resolveReplyImagePath(storagePath);
  if (!absolute) return;
  try {
    await unlink(absolute);
  } catch {
    /* 文件不存在时无需处理 */
  }
}

export function replyImageMime(format: AvatarFormat): string {
  return mimeTypeForFormat(format);
}
