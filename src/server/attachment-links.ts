import 'server-only';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { enqueueAttachmentPurge } from '@/server/attachment-purge';

const REPLY_IMAGE_PATH_RE = /^replies\/\d+\/[a-f0-9]{8,64}\.(png|jpg|webp|gif)$/;
const REPLY_IMAGE_MARKDOWN_RE = /!\[[^\]]*]\((\/uploads\/(replies\/[^)\s]+))\)/g;
const DEFAULT_PURGE_GRACE_SECONDS = 7 * 24 * 60 * 60;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class AttachmentLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentLinkError';
  }
}

/** 从回复正文提取服务端规范的回复图片 URL。 */
export function extractReplyImageStoragePaths(content: string): string[] {
  const paths = new Set<string>();
  for (const match of content.matchAll(REPLY_IMAGE_MARKDOWN_RE)) {
    const storagePath = match[2];
    if (REPLY_IMAGE_PATH_RE.test(storagePath)) paths.add(storagePath);
  }
  return [...paths];
}

/**
 * 将回复正文中的图片 URL 与“本人拥有的 attachment id”做严格双向映射，
 * 然后增量维护 reply_image_links 与附件状态机。
 *
 * 调用方必须在同一个事务内完成回复写入/编辑，保证正文与链接永不漂移。
 */
export async function syncReplyImageLinks(
  tx: Tx,
  input: {
    replyId: number;
    userId: number;
    content: string;
    imageIds: number[];
  },
): Promise<void> {
  const paths = extractReplyImageStoragePaths(input.content);
  const requestedIds = [...new Set(input.imageIds)];

  if (paths.length !== requestedIds.length) {
    throw new AttachmentLinkError('回复正文图片与图片 ID 列表不一致');
  }

  // 与 purge worker 使用同一把按 storage_path 的咨询锁，避免“刚重新引用就被删除”。
  for (const storagePath of [...paths].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${storagePath}, 0))`);
  }

  let candidates: Array<{
    id: number;
    storagePath: string;
    userId: number;
    state: string;
  }> = [];
  if (paths.length > 0) {
    candidates = await tx
      .select({
        id: schema.replyImages.id,
        storagePath: schema.replyImages.storagePath,
        userId: schema.replyImages.userId,
        state: schema.replyImages.state,
      })
      .from(schema.replyImages)
      .where(and(
        eq(schema.replyImages.userId, input.userId),
        ne(schema.replyImages.state, 'purged'),
        sql`NOT EXISTS (
          SELECT 1 FROM attachment_purge_queue q
          WHERE q.storage_path = ${schema.replyImages.storagePath}
            AND q.kind = 'reply_image'
            AND q.locked_at IS NOT NULL
        )`,
        or(
          inArray(schema.replyImages.storagePath, paths),
          inArray(schema.replyImages.id, requestedIds),
        ),
      ));
  }

  const byPath = new Map(candidates.map((row) => [row.storagePath, row]));
  const resolvedIds: number[] = [];
  for (const storagePath of paths) {
    const image = byPath.get(storagePath);
    if (!image || !requestedIds.includes(image.id)) {
      throw new AttachmentLinkError('图片不存在、不属于当前用户或已失效');
    }
    resolvedIds.push(image.id);
  }

  if (new Set(resolvedIds).size !== requestedIds.length) {
    throw new AttachmentLinkError('图片 ID 与回复正文无法一一对应');
  }

  const oldLinks = await tx
    .select({ attachmentId: schema.replyImageLinks.attachmentId })
    .from(schema.replyImageLinks)
    .where(eq(schema.replyImageLinks.replyId, input.replyId))
    .for('update');
  const oldIds = oldLinks.map((row) => row.attachmentId);

  if (resolvedIds.length > 0) {
    await tx
      .insert(schema.replyImageLinks)
      .values(resolvedIds.map((attachmentId) => ({
        replyId: input.replyId,
        attachmentId,
      })))
      .onConflictDoNothing();
  }

  const removedIds = oldIds.filter((id) => !resolvedIds.includes(id));
  if (removedIds.length > 0) {
    await tx
      .delete(schema.replyImageLinks)
      .where(and(
        eq(schema.replyImageLinks.replyId, input.replyId),
        inArray(schema.replyImageLinks.attachmentId, removedIds),
      ));
  }

  const now = new Date();
  if (resolvedIds.length > 0) {
    await tx
      .update(schema.replyImages)
      .set({
        state: 'active',
        purgeAfter: null,
        purgedAt: null,
        usedAt: sql`coalesce(${schema.replyImages.usedAt}, now())`,
        replyId: sql`coalesce(${schema.replyImages.replyId}, ${input.replyId})`,
      })
      .where(and(
        inArray(schema.replyImages.id, resolvedIds),
        ne(schema.replyImages.state, 'purged'),
      ));
    await tx
      .delete(schema.attachmentPurgeQueue)
      .where(and(
        eq(schema.attachmentPurgeQueue.kind, 'reply_image'),
        inArray(schema.attachmentPurgeQueue.storagePath,
          candidates
            .filter((row) => resolvedIds.includes(row.id))
            .map((row) => row.storagePath),
        ),
      ));
  }

  const affectedIds = [...new Set([...oldIds, ...resolvedIds])];
  for (const attachmentId of affectedIds) {
    const linkCountRows = await tx
      .select({ count: sqlCount })
      .from(schema.replyImageLinks)
      .where(eq(schema.replyImageLinks.attachmentId, attachmentId));
    const count = Number(linkCountRows[0]?.count ?? 0);
    if (count > 0) continue;

    const imageRows = await tx
      .select({
        storagePath: schema.replyImages.storagePath,
        userId: schema.replyImages.userId,
      })
      .from(schema.replyImages)
      .where(and(
        eq(schema.replyImages.id, attachmentId),
        ne(schema.replyImages.state, 'purged'),
      ))
      .limit(1);
    const image = imageRows[0];
    if (!image) continue;

    const purgeAfter = new Date(now.getTime() + purgeGraceSeconds() * 1000);
    await tx
      .update(schema.replyImages)
      .set({ state: 'superseded', purgeAfter })
      .where(eq(schema.replyImages.id, attachmentId));
    await enqueueAttachmentPurge(tx, {
      storagePath: image.storagePath,
      kind: 'reply_image',
      userId: image.userId,
      purgeAfter,
    });
  }
}

function purgeGraceSeconds(): number {
  const value = Number(process.env.ATTACHMENT_PURGE_GRACE_SECONDS ?? DEFAULT_PURGE_GRACE_SECONDS);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_PURGE_GRACE_SECONDS;
}

// 单独定义常量，避免在 select 中重复构造 SQL count。
const sqlCount = sql<number>`count(*)::int`;
