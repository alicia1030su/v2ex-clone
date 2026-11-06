import { NextResponse } from 'next/server';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { resolveStoragePath } from '@/lib/avatar';

export const dynamic = 'force-dynamic';

/**
 * GET /uploads/avatars/<userId>/<hash>.<ext> —— 提供用户上传的图片
 *
 * ## 为什么需要这个路由（v0.0.5 实测发现的真实缺陷）
 *
 * 头像文件被写进 `public/uploads/`，但 **Next.js 的静态资源机制只服务
 * 「构建时已存在」的文件**。`next start`（生产模式）会在启动时把
 * `public/` 快照进内存，此后**运行时写入的文件不会被服务** ——
 * 上传成功的头像立刻变成 **404**。
 *
 * 实测（v0.0.5 头像 E2E）：`POST /api/users/avatar` 返回 200 且带
 * `avatar: "/uploads/avatars/3/xxx.png"`，但随后 `GET` 该 URL 得到 **404**。
 * v0.0.4 一直没发现，是因为**头像上传从未被端到端测过**。
 *
 * ## 修法
 *
 * 用本路由从磁盘读文件并流式返回 —— 与 Next 的静态资源机制解耦。
 * 好处：
 *  - 运行时上传立即可访问
 *  - Docker 部署时 `public/uploads` 由**卷挂载**提供，本路由直接读挂载点，
 *    天然支持持久化与多实例共享
 *
 * ## 安全
 *
 * - 路径**必须**匹配 `avatars/<数字>/<hex>.<ext>`（`resolveStoragePath` 强制校验），
 *   杜绝路径穿越
 * - 只允许四种图片扩展名
 * - 回 `X-Content-Type-Options: nosniff`，防止 MIME 嗅探
 * - 回 `Cache-Control: public, max-age=31536000, immutable`
 *   （文件名含随机 hash，内容不可变 ⇒ 可长期缓存）
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await context.params;

  // 期望形如 ['avatars', '3', 'xxx.png']
  if (!Array.isArray(segments) || segments.length !== 3) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  const storagePath = segments.join('/');
  const absolute = resolveStoragePath(storagePath);
  if (!absolute) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  let size: number;
  try {
    const st = statSync(absolute);
    if (!st.isFile()) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    size = st.size;
  } catch {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  // 扩展名 → MIME（与服务端落盘时的扩展名一一对应）
  const ext = storagePath.slice(storagePath.lastIndexOf('.') + 1).toLowerCase();
  const mime =
    ext === 'png'
      ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'gif'
            ? 'image/gif'
            : null;
  if (!mime) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  const stream = Readable.toWeb(
    createReadStream(absolute),
  ) as unknown as ReadableStream;

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(size),
      // 禁止 MIME 嗅探（防止上传的 SVG/HTML 被当脚本执行）
      'X-Content-Type-Options': 'nosniff',
      // 文件名含随机 hash ⇒ 内容不可变 ⇒ 可长期缓存
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
