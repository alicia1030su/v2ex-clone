import 'server-only';
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 头像上传的校验与落盘
 *
 * ## 威胁模型与对策
 *
 * | 威胁 | 对策 |
 * |---|---|
 * | 上传可执行脚本 / HTML | 只接受 PNG/JPEG/WebP/GIF，且**按文件真实内容**（magic number）判定，不信 MIME 声明 |
 * | 路径穿越（`../../etc/passwd`） | 存储路径**完全由服务端生成**（随机哈希 + 固定扩展名），用户上传的 filename 只作展示用途，不参与任何路径拼接 |
 * | 覆盖已有文件（DoS / 投毒） | 随机文件名 + `wx` 独占创建标志（已存在则失败），不会覆盖 |
 * | 超大文件打爆磁盘 | 上传体积上限 2MB，且落盘前按字节数硬校验 |
 * | 图片炸弹（解压炸弹） | 用 sharp 处理时限制 `limitInputPixels`，解码失败一律拒绝 |
 *
 * ## 存储布局
 *
 * 二进制文件放在 `public/uploads/avatars/<userId>/<random>.<ext>`，
 * 数据库 `avatars.storage_path` 记录相对路径（如 `avatars/3/a1b2….png`），
 * `users.avatar` 保存可访问的 URL（`/uploads/avatars/3/a1b2….png`）。
 */

export type AvatarFormat = 'png' | 'jpeg' | 'webp' | 'gif';

/** 允许的头像格式 */
export const ALLOWED_AVATAR_FORMATS: readonly AvatarFormat[] = ['png', 'jpeg', 'webp', 'gif'];

/** 头像体积上限（2MB） */
export const MAX_AVATAR_BYTES = Number(process.env.AVATAR_MAX_BYTES ?? 2 * 1024 * 1024);

/** 头像输出边长（正方形，与原站一致） */
export const AVATAR_SIZE = Number(process.env.AVATAR_SIZE ?? 256);

/** 文件存放根目录（public 下的 uploads） */
export const AVATAR_UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');

/** 头像文件在 public/uploads 下的子目录 */
const AVATAR_SUBDIR = 'avatars';

/** 允许的头像文件扩展名（与格式一一对应，扩展名由服务端决定） */
const FORMAT_EXT: Record<AvatarFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
};

/** 格式对应的 MIME */
const FORMAT_MIME: Record<AvatarFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * 按文件真实内容（magic number）判定图片格式。
 *
 * 完全**不依赖**客户端声明的 MIME —— 声明可以随意伪造，
 * 而文件头字节骗不了人。
 *
 * @returns 识别出的格式；不是受支持的图片则返回 null
 */
export function detectImageFormat(buffer: Buffer): AvatarFormat | null {
  if (buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // GIF: "GIF87a" / "GIF89a"
  if (
    buffer.subarray(0, 3).toString('ascii') === 'GIF' &&
    buffer.subarray(3, 6).toString('ascii') === '87a'
  ) {
    return 'gif';
  }
  if (
    buffer.subarray(0, 3).toString('ascii') === 'GIF' &&
    buffer.subarray(3, 6).toString('ascii') === '89a'
  ) {
    return 'gif';
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }

  return null;
}

/** 格式对应的 MIME（供数据库记录） */
export function mimeTypeForFormat(format: AvatarFormat): string {
  return FORMAT_MIME[format];
}

/**
 * 生成服务端存储路径。
 *
 * 路径完全由服务端决定：`<userId>/<32字节随机hex>.<固定扩展名>`。
 * **不接收任何用户可控的路径片段** —— 从根上杜绝路径穿越。
 */
export function buildStoragePath(userId: number, format: AvatarFormat): string {
  const random = randomBytes(16).toString('hex');
  return `${AVATAR_SUBDIR}/${userId}/${random}.${FORMAT_EXT[format]}`;
}

/** 把相对存储路径解析成磁盘绝对路径（带越界检查） */
export function resolveStoragePath(storagePath: string): string | null {
  // 只允许形如 avatars/<数字>/<hex>.<ext> 的路径
  if (!/^avatars\/\d+\/[a-f0-9]{8,64}\.(png|jpg|webp|gif)$/.test(storagePath)) {
    return null;
  }
  const root = path.resolve(AVATAR_UPLOAD_ROOT);
  const target = path.resolve(root, storagePath);
  // 越界检查：解析后的路径必须仍在上传根目录内
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/** 由存储路径生成可访问 URL */
export function publicUrlForStoragePath(storagePath: string): string {
  return `/uploads/${storagePath}`;
}

/** 从 URL 反推存储路径（用于删除旧头像） */
export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = '/uploads/';
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const rel = url.slice(idx + marker.length);
  if (!/^avatars\/\d+\/[a-f0-9]{8,64}\.(png|jpg|webp|gif)$/.test(rel)) return null;
  return rel;
}

/**
 * sharp 是 Next.js 的 optionalDependency，可能不存在。
 * 这里做**软依赖**处理：拿不到就跳过裁剪，保存原图。
 */
async function loadSharp(): Promise<typeof import('sharp').default | null> {
  try {
    const mod = (await import('sharp')) as unknown as {
      default?: typeof import('sharp').default;
    };
    return mod.default ?? (mod as unknown as typeof import('sharp').default);
  } catch {
    return null;
  }
}

export type ProcessedAvatar = {
  /** 最终落盘的字节 */
  data: Buffer;
  /** 实际使用的格式（可能因转码而变化） */
  format: AvatarFormat;
  width: number | null;
  height: number | null;
  /** 是否做了裁剪/缩放（sharp 不可用时为 false） */
  resized: boolean;
  /** 源图（裁剪前）像素宽度 —— sharp 不可用时为 null */
  sourceWidth?: number | null;
  /** 源图（裁剪前）像素高度 —— sharp 不可用时为 null */
  sourceHeight?: number | null;
};

/**
 * 处理上传的头像：裁剪成正方形并缩放。
 *
 * 找不到 sharp 时降级为保存原图（记录原始尺寸）。
 */
export async function processAvatar(
  buffer: Buffer,
  format: AvatarFormat,
): Promise<ProcessedAvatar> {
  const sharp = await loadSharp();
  if (!sharp) {
    const dims = readDimensionsFallback(buffer, format);
    return { data: buffer, format, width: dims.width, height: dims.height, resized: false };
  }

  try {
    // `limitInputPixels` —— 图片炸弹防护（解压炸弹会撑爆内存）
    const image = sharp(buffer, { limitInputPixels: 100_000_000, animated: false });
    const meta = await image.metadata();

    // ── ① EXIF 方向校正（v0.0.5）───────────────────────────────
    //
    // 手机拍的照片把方向记在 EXIF 的 `Orientation` 标签里（值 6 表示
    // 「顺时针 90°」）。**不校正就直接裁剪**，出来的头像是躺着的。
    //
    // sharp 的 `rotate()` 不带参数时，会**自动按 EXIF Orientation 旋转**
    // 并**丢弃**该标签 —— 正是我们要的行为。
    const oriented = image.rotate();

    // ── ② 裁剪成正方形并缩放 ──
    const pipeline = oriented.resize(AVATAR_SIZE, AVATAR_SIZE, {
      fit: 'cover',
      position: 'centre',
      // 允许放大：头像统一为 AVATAR_SIZE × AVATAR_SIZE
      withoutEnlargement: false,
    });

    // ── ③ 重新编码 + **剥离全部元数据**（v0.0.5）───────────────
    //
    // ⚠️ EXIF 里可能带 **GPS 坐标**（手机照片几乎必有）、相机型号、
    //    拍摄时间、软件版本等隐私信息。头像会被公开分发
    //    （`public/uploads/` 且 URL 可猜/可分享）⇒ **绝不能保留**。
    //
    // sharp 默认**不**写元数据（除非显式 `withMetadata()`），
    // 所以这里只要**不要**调用 `withMetadata()` 即可。
    // 这里显式写出来是为了让意图在代码里可见，不依赖默认值。
    let data: Buffer;
    switch (format) {
      case 'png':
        // PNG：压缩 + 去掉所有文本块
        data = await pipeline.png({ compressionLevel: 9 }).toBuffer();
        break;
      case 'jpeg':
        // JPEG：`mozjpeg` 编码器体积更小；不调用 withMetadata ⇒ 剥离 EXIF
        data = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
        break;
      case 'webp':
        data = await pipeline.webp({ quality: 85 }).toBuffer();
        break;
      case 'gif':
        // ⚠️ 动画 GIF 只保留**第一帧**（`animated: false`）。
        //    这是有意的：动图当头像没有意义，且体积不可控。
        data = await pipeline.gif().toBuffer();
        break;
    }

    return {
      data,
      format,
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      resized: true,
      /** 源图的像素尺寸（裁剪前），用于日志与调试 */
      sourceWidth: meta.width ?? null,
      sourceHeight: meta.height ?? null,
    };
  } catch {
    // 解码失败（例如伪造了 magic number 的文件）→ 拒绝上传
    throw new Error('无法解析该图片文件');
  }
}

/**
 * 无 sharp 时的尺寸读取（只支持能可靠解析的格式）。
 */
export function readDimensionsFallback(
  buffer: Buffer,
  format: AvatarFormat,
): { width: number | null; height: number | null } {
  try {
    if (format === 'png' && buffer.length >= 24) {
      // IHDR 宽高在 16..24 字节（大端）
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (format === 'gif' && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (format === 'jpeg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        // SOF0/1/2 携带尺寸
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    /* 解析失败返回 null */
  }
  return { width: null, height: null };
}

/**
 * 把头像写入磁盘。
 *
 * @param userId  头像归属用户
 * @param format  已校验过的真实格式
 * @param data    图片字节
 * @returns 相对存储路径
 */
export async function writeAvatarFile(
  userId: number,
  format: AvatarFormat,
  data: Buffer,
): Promise<string> {
  const storagePath = buildStoragePath(userId, format);
  const absolute = resolveStoragePath(storagePath);
  if (!absolute) {
    throw new Error('非法的存储路径');
  }

  await mkdir(path.dirname(absolute), { recursive: true });

  // 'wx' —— 独占创建，文件已存在则失败，杜绝覆盖
  await writeFile(absolute, data, { flag: 'wx' });

  return storagePath;
}

/** 删除磁盘上的头像文件（失败时静默忽略） */
export async function deleteAvatarFile(storagePath: string | null): Promise<void> {
  if (!storagePath) return;
  const absolute = resolveStoragePath(storagePath);
  if (!absolute) return;
  try {
    await unlink(absolute);
  } catch {
    /* 文件不存在时无需处理 */
  }
}

/**
 * 校验上传的字节。
 *
 * @returns 识别出的格式；不合规时抛出带中文提示的错误
 */
export function validateAvatarBytes(buffer: Buffer): AvatarFormat {
  if (buffer.length === 0) {
    throw new Error('文件为空');
  }
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw new Error(`图片大小不能超过 ${Math.floor(MAX_AVATAR_BYTES / 1024 / 1024)}MB`);
  }
  const format = detectImageFormat(buffer);
  if (!format) {
    throw new Error('只支持 PNG、JPEG、WebP、GIF 格式的图片');
  }
  return format;
}
