import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { and, desc, eq, ne } from 'drizzle-orm';
import {
  detectImageFormat,
  processAvatar,
  resolveStoragePath,
  writeAvatarFile,
  publicUrlForStoragePath,
  MAX_AVATAR_BYTES,
  AVATAR_SIZE,
} from '@/lib/avatar';
import { rateLimitByUser } from '@/lib/rate-limit';
import { guardCommunityAction } from '@/lib/community-rate-limit';
import {
  enqueueAttachmentPurge,
  purgeAttachmentQueue,
} from '@/server/attachment-purge';

export const dynamic = 'force-dynamic';

/**
 * POST /api/users/avatar —— 上传头像
 *
 * 安全要求（全部在服务端强制）：
 *  1. **按文件真实内容判定格式**（magic number），不信任客户端声明的 MIME
 *  2. 大小上限（默认 2MB）
 *  3. **存储路径完全由服务端生成**（用户 ID + 随机 hex + 固定扩展名）
 *     —— 杜绝路径穿越与覆盖
 *  4. 替换旧头像时删除旧文件
 *  5. 伪造 magic number 但无法解码的文件会被拒绝
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const limit = await rateLimitByUser(
    'avatar_upload',
    user.id,
    Number(process.env.RATE_LIMIT_AVATAR_MAX ?? 10),
    Number(process.env.RATE_LIMIT_AVATAR_WINDOW_SECONDS ?? 3600),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `上传过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式无效' }, { status: 400 });
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ ok: false, error: '缺少文件' }, { status: 400 });
  }

  const blob = file as File;
  if (blob.size === 0) {
    return NextResponse.json({ ok: false, error: '文件为空' }, { status: 400 });
  }
  if (blob.size > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `文件过大（上限 ${Math.floor(MAX_AVATAR_BYTES / 1024 / 1024)}MB）`,
      },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await blob.arrayBuffer());

  // 按真实内容判定格式
  const format = detectImageFormat(buffer);
  if (!format) {
    return NextResponse.json(
      { ok: false, error: '只支持 PNG / JPEG / WebP / GIF 格式的图片' },
      { status: 400 },
    );
  }

  // 裁剪 + 缩放（sharp 不可用时降级为保存原图）
  let processed;
  try {
    processed = await processAvatar(buffer, format);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '图片处理失败' },
      { status: 400 },
    );
  }

  // 存储路径由服务端生成（writeAvatarFile 内部生成随机路径，不接收任何用户可控片段）
  const storagePath = await writeAvatarFile(user.id, processed.format, processed.data);

  // 记录元数据、切换当前头像、撤销旧头像并入队，全部在一个事务内完成。
  const publicUrl = publicUrlForStoragePath(storagePath);
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.avatars).values({
        userId: user.id,
        storagePath,
        originalName: typeof blob.name === 'string' ? blob.name.slice(0, 255) : null,
        mimeType:
          processed.format === 'jpeg'
            ? 'image/jpeg'
            : processed.format === 'png'
              ? 'image/png'
              : processed.format === 'webp'
                ? 'image/webp'
                : 'image/gif',
        size: processed.data.length,
        width: processed.width,
        height: processed.height,
      });

      await tx
        .update(schema.users)
        .set({ avatar: publicUrl })
        .where(eq(schema.users.id, user.id));

      const oldRows = await tx
        .select({ storagePath: schema.avatars.storagePath })
        .from(schema.avatars)
        .where(and(
          eq(schema.avatars.userId, user.id),
          ne(schema.avatars.storagePath, storagePath),
        ));
      for (const old of oldRows) {
        await enqueueAttachmentPurge(tx, {
          storagePath: old.storagePath,
          kind: 'avatar',
          userId: user.id,
        });
      }
      await tx
        .delete(schema.avatars)
        .where(and(
          eq(schema.avatars.userId, user.id),
          ne(schema.avatars.storagePath, storagePath),
        ));
    });
  } catch (err) {
    // 新文件尚未形成可见引用，可直接回滚落盘。
    try {
      const { deleteAvatarFile } = await import('@/lib/avatar');
      await deleteAvatarFile(storagePath);
    } catch {
      /* 保留孤立文件供 purge/人工回收，不掩盖原始错误 */
    }
    console.error('[avatar] 元数据写入失败', err);
    return NextResponse.json({ ok: false, error: '图片保存失败' }, { status: 500 });
  }

  void purgeAttachmentQueue(20).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    avatar: publicUrl,
    width: processed.width,
    height: processed.height,
    size: processed.data.length,
    resized: processed.resized,
    note: processed.resized
      ? undefined
      : `未安装图片处理库，已保存原图（目标尺寸 ${AVATAR_SIZE}×${AVATAR_SIZE}）`,
  });
}

/**
 * DELETE /api/users/avatar —— 移除头像
 */
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;
  // v0.0.5：社区动作频率限制（移除头像）
  const rl = await guardCommunityAction('collection', user?.id ?? null);
  if (rl) return rl;

  try {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ storagePath: schema.avatars.storagePath })
        .from(schema.avatars)
        .where(eq(schema.avatars.userId, user.id));

      await tx.delete(schema.avatars).where(eq(schema.avatars.userId, user.id));
      await tx.update(schema.users).set({ avatar: null }).where(eq(schema.users.id, user.id));
      for (const row of rows) {
        await enqueueAttachmentPurge(tx, {
          storagePath: row.storagePath,
          kind: 'avatar',
          userId: user.id,
        });
      }
    });
  } catch (err) {
    console.error('[avatar] 删除失败', err);
    return NextResponse.json({ ok: false, error: '删除失败' }, { status: 500 });
  }

  void purgeAttachmentQueue(20).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
