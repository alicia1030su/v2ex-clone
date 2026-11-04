import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq, desc } from 'drizzle-orm';
import {
  detectImageFormat,
  processAvatar,
  resolveStoragePath,
  writeAvatarFile,
  deleteAvatarFile,
  publicUrlForStoragePath,
  MAX_AVATAR_BYTES,
  AVATAR_SIZE,
} from '@/lib/avatar';
import { rateLimitByUser } from '@/lib/rate-limit';

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

  // 记录元数据
  await db.insert(schema.avatars).values({
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

  // 更新用户头像字段
  const publicUrl = publicUrlForStoragePath(storagePath);
  await db
    .update(schema.users)
    .set({ avatar: publicUrl })
    .where(eq(schema.users.id, user.id));

  // 删除旧头像文件（保留数据库元数据作为历史）
  const oldRows = await db
    .select({ storagePath: schema.avatars.storagePath })
    .from(schema.avatars)
    .where(eq(schema.avatars.userId, user.id))
    .orderBy(desc(schema.avatars.id))
    .limit(20);

  const oldPaths = oldRows.map((r) => r.storagePath).filter((p) => p !== storagePath);
  for (const p of oldPaths) {
    const abs = resolveStoragePath(p);
    if (abs) await deleteAvatarFile(abs);
  }

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

  const rows = await db
    .select({ storagePath: schema.avatars.storagePath })
    .from(schema.avatars)
    .where(eq(schema.avatars.userId, user.id));

  for (const r of rows) {
    const abs = resolveStoragePath(r.storagePath);
    if (abs) await deleteAvatarFile(abs);
  }

  await db.update(schema.users).set({ avatar: null }).where(eq(schema.users.id, user.id));

  return NextResponse.json({ ok: true });
}
