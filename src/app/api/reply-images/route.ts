import { NextResponse } from 'next/server';
import { and, desc, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { db, schema } from '@/db';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { rateLimitByUser, rateLimitSlidingByUser } from '@/lib/rate-limit';
import {
  MAX_REPLY_IMAGE_BYTES,
  deleteReplyImageFile,
  processReplyImage,
  publicUrlForReplyImage,
  replyImageMime,
  validateReplyImageBytes,
  writeReplyImageFile,
} from '@/lib/reply-images';
import { listRecentReplyImages } from '@/server/reply-threads';

export const dynamic = 'force-dynamic';

const MAX_UNUSED_KEPT = 50;
const UNUSED_TTL_MS = 24 * 60 * 60 * 1000;

function expectedExtensions(format: string): string[] {
  return format === 'jpeg' ? ['jpg', 'jpeg'] : [format];
}

async function cleanupUnusedReplyImages(userId: number): Promise<void> {
  const cutoff = new Date(Date.now() - UNUSED_TTL_MS);
  const rows = await db
    .select({
      id: schema.replyImages.id,
      storagePath: schema.replyImages.storagePath,
      createdAt: schema.replyImages.createdAt,
    })
    .from(schema.replyImages)
    .where(and(
      eq(schema.replyImages.userId, userId),
      or(
        and(isNull(schema.replyImages.usedAt), lt(schema.replyImages.createdAt, cutoff)),
        and(
          isNotNull(schema.replyImages.usedAt),
          isNull(schema.replyImages.replyId),
          lt(schema.replyImages.usedAt, cutoff),
        ),
      ),
    ))
    .orderBy(desc(schema.replyImages.createdAt));

  for (const row of rows) {
    await deleteReplyImageFile(row.storagePath);
    await db.delete(schema.replyImages).where(eq(schema.replyImages.id, row.id));
  }

  const remaining = await db
    .select({
      id: schema.replyImages.id,
      storagePath: schema.replyImages.storagePath,
    })
    .from(schema.replyImages)
    .where(and(eq(schema.replyImages.userId, userId), isNull(schema.replyImages.usedAt)))
    .orderBy(desc(schema.replyImages.createdAt))
    .offset(MAX_UNUSED_KEPT);
  for (const row of remaining) {
    await deleteReplyImageFile(row.storagePath);
    await db.delete(schema.replyImages).where(eq(schema.replyImages.id, row.id));
  }
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get('limit') ?? 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 20) : 10;
  const recentLimit = await rateLimitSlidingByUser(
    'reply_image_recent',
    user.id,
    Number(process.env.RATE_LIMIT_REPLY_IMAGE_RECENT_MAX ?? 60),
    60,
  );
  if (!recentLimit.ok) {
    return NextResponse.json(
      { ok: false, error: `请求过于频繁，请 ${recentLimit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(recentLimit.retryAfterSeconds) } },
    );
  }
  const rows = await listRecentReplyImages(user.id, limit);
  return NextResponse.json({
    ok: true,
    images: rows.map((row) => ({
      ...row,
      url: `/uploads/${row.url}`,
      markdown: `![图片](${`/uploads/${row.url}`})`,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const limit = await rateLimitByUser(
    'reply_image_upload',
    user.id,
    Number(process.env.RATE_LIMIT_REPLY_IMAGE_MAX ?? 30),
    Number(process.env.RATE_LIMIT_REPLY_IMAGE_WINDOW_SECONDS ?? 3600),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `上传过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const burst = await rateLimitSlidingByUser(
    'reply_image_burst',
    user.id,
    Number(process.env.RATE_LIMIT_REPLY_IMAGE_BURST_MAX ?? 10),
    Number(process.env.RATE_LIMIT_REPLY_IMAGE_BURST_WINDOW_SECONDS ?? 60),
  );
  if (!burst.ok) {
    return NextResponse.json(
      { ok: false, error: `上传过于频繁，请 ${burst.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(burst.retryAfterSeconds) } },
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
  if (blob.size > MAX_REPLY_IMAGE_BYTES) {
    return NextResponse.json(
      { ok: false, error: `文件过大（上限 ${Math.floor(MAX_REPLY_IMAGE_BYTES / 1024 / 1024)}MB）` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  let format: ReturnType<typeof validateReplyImageBytes>;
  try {
    format = validateReplyImageBytes(buffer);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '图片校验失败' },
      { status: 400 },
    );
  }

  const expectedMime = replyImageMime(format);
  const declaredMime = (blob.type ?? '').trim().toLowerCase();
  if (declaredMime && declaredMime !== expectedMime) {
    return NextResponse.json(
      { ok: false, error: '图片 MIME 类型与真实内容不一致' },
      { status: 400 },
    );
  }
  const originalName = typeof blob.name === 'string' ? blob.name : '';
  const dot = originalName.lastIndexOf('.');
  const extension = dot >= 0 ? originalName.slice(dot + 1).toLowerCase() : '';
  if (extension && !expectedExtensions(format).includes(extension)) {
    return NextResponse.json(
      { ok: false, error: '图片扩展名与真实内容不一致' },
      { status: 400 },
    );
  }

  let processed;
  try {
    processed = await processReplyImage(buffer, format);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '图片处理失败' },
      { status: 400 },
    );
  }

  let storagePath: string;
  try {
    storagePath = await writeReplyImageFile(user.id, processed.format, processed.data);
  } catch {
    return NextResponse.json({ ok: false, error: '图片保存失败' }, { status: 500 });
  }

  try {
    const inserted = await db
      .insert(schema.replyImages)
      .values({
        userId: user.id,
        storagePath,
        originalName: originalName ? originalName.slice(0, 255) : null,
        mimeType: replyImageMime(processed.format),
        size: processed.data.length,
        width: processed.width,
        height: processed.height,
      })
      .returning({ id: schema.replyImages.id });
    await cleanupUnusedReplyImages(user.id);
    const url = publicUrlForReplyImage(storagePath);
    return NextResponse.json({
      ok: true,
      image: {
        id: inserted[0]?.id,
        url,
        markdown: `![图片](${url})`,
        mimeType: replyImageMime(processed.format),
        width: processed.width,
        height: processed.height,
      },
    });
  } catch (err) {
    await deleteReplyImageFile(storagePath);
    console.error('[reply-images] 元数据写入失败', err);
    return NextResponse.json({ ok: false, error: '图片保存失败' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const deleteLimit = await rateLimitByUser(
    'reply_image_delete',
    user.id,
    Number(process.env.RATE_LIMIT_REPLY_IMAGE_DELETE_MAX ?? 30),
    Number(process.env.RATE_LIMIT_REPLY_IMAGE_DELETE_WINDOW_SECONDS ?? 3600),
  );
  if (!deleteLimit.ok) {
    return NextResponse.json(
      { ok: false, error: `操作过于频繁，请 ${deleteLimit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(deleteLimit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { id?: number } | null;
  const id = Number(body?.id ?? 0);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: '图片 ID 无效' }, { status: 400 });
  }
  const rows = await db
    .select({
      id: schema.replyImages.id,
      storagePath: schema.replyImages.storagePath,
      usedAt: schema.replyImages.usedAt,
    })
    .from(schema.replyImages)
    .where(and(eq(schema.replyImages.id, id), eq(schema.replyImages.userId, user.id)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ ok: false, error: '图片不存在' }, { status: 404 });
  }
  if (row.usedAt) {
    return NextResponse.json({ ok: false, error: '已使用的图片不能删除' }, { status: 409 });
  }
  await deleteReplyImageFile(row.storagePath);
  await db.delete(schema.replyImages).where(eq(schema.replyImages.id, row.id));
  return NextResponse.json({ ok: true });
}
