import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { renderMarkdown } from '@/lib/markdown';

export type CreatedReplyPayload = {
  id: number;
  topicId: number;
  floor: number;
  content: string;
  html: string;
  authorId: number;
  authorName: string;
  authorAvatar: string | null;
  parentReplyId: number | null;
  quoteId: number | null;
  thanks: number;
  edited: boolean;
  editCount: number;
  deleted: boolean;
  createdAt: string;
};

export async function loadOwnedReplyByClientRequest(
  userId: number,
  topicId: number,
  clientRequestId: string,
) {
  const rows = await db
    .select({ id: schema.replies.id, topicId: schema.replies.topicId })
    .from(schema.replies)
    .where(and(
      eq(schema.replies.authorId, userId),
      eq(schema.replies.clientRequestId, clientRequestId),
    ))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.topicId !== topicId) return { conflict: true as const };
  return { conflict: false as const, id: row.id };
}

export async function serializeCreatedReply(replyId: number): Promise<CreatedReplyPayload | null> {
  const rows = await db
    .select({
      id: schema.replies.id,
      topicId: schema.replies.topicId,
      floor: schema.replies.floor,
      content: schema.replies.content,
      authorId: schema.users.id,
      authorName: schema.users.username,
      authorAvatar: schema.users.avatar,
      parentReplyId: schema.replies.parentReplyId,
      quoteId: schema.replies.quoteId,
      thanks: schema.replies.thanks,
      editCount: schema.replies.editCount,
      deletedAt: schema.replies.deletedAt,
      createdAt: schema.replies.createdAt,
    })
    .from(schema.replies)
    .innerJoin(schema.users, eq(schema.users.id, schema.replies.authorId))
    .where(eq(schema.replies.id, replyId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    topicId: row.topicId,
    floor: row.floor,
    content: row.content,
    html: await renderMarkdown(row.content),
    authorId: row.authorId,
    authorName: row.authorName,
    authorAvatar: row.authorAvatar,
    parentReplyId: row.parentReplyId,
    quoteId: row.quoteId,
    thanks: row.thanks,
    edited: row.editCount > 0,
    editCount: row.editCount,
    deleted: row.deletedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
