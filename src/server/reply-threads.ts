import 'server-only';
import { and, asc, count, desc, eq, gt, inArray, isNull, type SQL } from 'drizzle-orm';
import { db, schema } from '@/db';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';
import { PUBLIC_REPLY_CONDITION, PUBLIC_TOPIC_CONDITION } from '@/lib/content-visibility';
import { stripMarkdown, renderMarkdown } from '@/lib/markdown';
import { avatarUrl } from '@/components/Avatar';

export type ReplyRelationSummary = {
  id: number;
  floor: number;
  authorName: string | null;
  excerpt: string | null;
  deleted: boolean;
  inaccessible: boolean;
  createdAt: Date | null;
};

export type ReplyContextChild = ReplyRelationSummary & {
  content: string;
  html: string;
  authorId: number;
  authorAvatar: string | null;
  authorAvatarUrl: string;
  parentReplyId: number | null;
  thanks: number;
  quoteId: number | null;
};

export type ReplyContext = {
  reply: { id: number; floor: number };
  parentChain: ReplyRelationSummary[];
  childrenTotal: number;
  children: ReplyContextChild[];
};

const MAX_PARENT_CHAIN = 8;
const MAX_CONTEXT_CHILDREN = 20;

function relationVisibility(includeDeleted: boolean): SQL[] {
  const conditions: SQL[] = [PUBLIC_TOPIC_CONDITION];
  if (!includeDeleted) conditions.push(PUBLIC_REPLY_CONDITION);
  return conditions;
}

async function selectRelationRows(
  topicId: number,
  ids: number[],
  includeDeleted: boolean,
): Promise<ReplyRelationSummary[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: schema.replies.id,
      floor: schema.replies.floor,
      content: schema.replies.content,
      deletedAt: schema.replies.deletedAt,
      createdAt: schema.replies.createdAt,
      authorName: schema.users.username,
    })
    .from(schema.replies)
    .innerJoin(schema.users, eq(schema.users.id, schema.replies.authorId))
    .innerJoin(schema.topics, eq(schema.topics.id, schema.replies.topicId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(and(
      eq(schema.replies.topicId, topicId),
      inArray(schema.replies.id, ids),
      PUBLIC_NODE_CONDITION,
      ...relationVisibility(includeDeleted),
    ))
    .orderBy(asc(schema.replies.floor));
  return rows.map((row) => ({
    id: row.id,
    floor: row.floor,
    authorName: row.authorName,
    excerpt: row.deletedAt ? null : stripMarkdown(row.content, 120),
    deleted: row.deletedAt !== null,
    inaccessible: false,
    createdAt: row.createdAt,
  }));
}

/**
 * 为当前页回复批量补充父回复摘要。
 *
 * 只查询当前页实际引用到的 parent id（一次 IN 查询），不会加载整主题。
 * 父回复在别的页、已软删或因权限不可见时返回不带正文的占位摘要。
 */
export async function hydrateReplyParents<
  T extends { id: number; parentReplyId: number | null },
>(
  topicId: number,
  replies: T[],
  opts: { includeDeleted?: boolean } = {},
): Promise<Map<number, ReplyRelationSummary>> {
  const parentIds = [...new Set(
    replies
      .map((reply) => reply.parentReplyId)
      .filter((id): id is number => Number.isInteger(id) && (id ?? 0) > 0),
  )];
  const rows = await selectRelationRows(topicId, parentIds, opts.includeDeleted === true);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const result = new Map<number, ReplyRelationSummary>();
  for (const parentId of parentIds) {
    result.set(parentId, byId.get(parentId) ?? {
      id: parentId,
      floor: 0,
      authorName: null,
      excerpt: null,
      deleted: false,
      inaccessible: true,
      createdAt: null,
    });
  }
  return result;
}

async function findVisibleReply(
  topicId: number,
  replyId: number,
  includeDeleted: boolean,
): Promise<{ id: number; floor: number; parentReplyId: number | null } | null> {
  const rows = await db
    .select({
      id: schema.replies.id,
      floor: schema.replies.floor,
      parentReplyId: schema.replies.parentReplyId,
    })
    .from(schema.replies)
    .innerJoin(schema.topics, eq(schema.topics.id, schema.replies.topicId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(and(
      eq(schema.replies.topicId, topicId),
      eq(schema.replies.id, replyId),
      PUBLIC_NODE_CONDITION,
      ...relationVisibility(includeDeleted),
    ))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 按需读取一条回复的父链与直接子回复。
 *
 * 跨页策略：经典分页不变；树形/楼中楼只在用户展开时请求本接口，
 * 父链最多 8 层、直接子回复每次最多 20 条，绝不一次性加载整主题。
 */
export async function getReplyContext(
  topicId: number,
  replyId: number,
  opts: { includeDeleted?: boolean; childCursor?: number } = {},
): Promise<ReplyContext | null> {
  const includeDeleted = opts.includeDeleted === true;
  const reply = await findVisibleReply(topicId, replyId, includeDeleted);
  if (!reply) return null;

  const parentChain: ReplyRelationSummary[] = [];
  let cursor = reply.parentReplyId;
  const seen = new Set<number>([reply.id]);
  while (cursor && parentChain.length < MAX_PARENT_CHAIN && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = await findVisibleReply(topicId, cursor, includeDeleted);
    if (!parent) {
      parentChain.push({
        id: cursor,
        floor: 0,
        authorName: null,
        excerpt: null,
        deleted: false,
        inaccessible: true,
        createdAt: null,
      });
      break;
    }
    const summaries = await selectRelationRows(topicId, [parent.id], includeDeleted);
    const summary = summaries[0] ?? {
      id: parent.id,
      floor: parent.floor,
      authorName: null,
      excerpt: null,
      deleted: false,
      inaccessible: true,
      createdAt: null,
    };
    parentChain.push(summary);
    cursor = parent.parentReplyId;
  }

  const childConditions: SQL[] = [
    eq(schema.replies.topicId, topicId),
    eq(schema.replies.parentReplyId, reply.id),
    PUBLIC_TOPIC_CONDITION,
  ];
  if (!includeDeleted) childConditions.push(PUBLIC_REPLY_CONDITION);
  if (Number.isInteger(opts.childCursor) && (opts.childCursor ?? 0) > 0) {
    childConditions.push(gt(schema.replies.floor, opts.childCursor ?? 0));
  }

  const totalRows = await db
    .select({ n: count() })
    .from(schema.replies)
    .innerJoin(schema.topics, eq(schema.topics.id, schema.replies.topicId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(and(
      eq(schema.replies.topicId, topicId),
      eq(schema.replies.parentReplyId, reply.id),
      PUBLIC_NODE_CONDITION,
      ...relationVisibility(includeDeleted),
    ));
  const childrenTotal = Number(totalRows[0]?.n ?? 0);

  const childRows = await db
    .select({
      id: schema.replies.id,
      floor: schema.replies.floor,
      content: schema.replies.content,
      deletedAt: schema.replies.deletedAt,
      createdAt: schema.replies.createdAt,
      authorId: schema.users.id,
      authorName: schema.users.username,
      authorAvatar: schema.users.avatar,
      parentReplyId: schema.replies.parentReplyId,
      thanks: schema.replies.thanks,
      quoteId: schema.replies.quoteId,
    })
    .from(schema.replies)
    .innerJoin(schema.users, eq(schema.users.id, schema.replies.authorId))
    .innerJoin(schema.topics, eq(schema.topics.id, schema.replies.topicId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(and(...childConditions, PUBLIC_NODE_CONDITION))
    .orderBy(asc(schema.replies.floor))
    .limit(MAX_CONTEXT_CHILDREN);
  const children: ReplyContextChild[] = await Promise.all(childRows.map(async (row) => ({
    id: row.id,
    floor: row.floor,
    authorId: row.authorId,
    authorName: row.authorName,
    authorAvatar: row.authorAvatar,
    authorAvatarUrl: avatarUrl({ id: row.authorId, username: row.authorName, avatar: row.authorAvatar }, 48),
    parentReplyId: row.parentReplyId,
    content: row.content,
    html: await renderMarkdown(row.content),
    excerpt: row.deletedAt ? null : stripMarkdown(row.content, 120),
    deleted: row.deletedAt !== null,
    inaccessible: false,
    createdAt: row.createdAt,
    thanks: row.thanks,
    quoteId: row.quoteId,
  })));

  return { reply, parentChain, childrenTotal, children };
}

/** 最近上传图片；limit 由调用方按桌面/移动端选择。 */
export async function listRecentReplyImages(userId: number, limit = 10) {
  const safeLimit = Math.min(Math.max(limit, 1), 20);
  return db
    .select({
      id: schema.replyImages.id,
      url: schema.replyImages.storagePath,
      mimeType: schema.replyImages.mimeType,
      width: schema.replyImages.width,
      height: schema.replyImages.height,
      usedAt: schema.replyImages.usedAt,
      createdAt: schema.replyImages.createdAt,
    })
    .from(schema.replyImages)
    .where(and(
      eq(schema.replyImages.userId, userId),
      eq(schema.replyImages.state, 'active'),
      isNull(schema.replyImages.usedAt),
    ))
    .orderBy(desc(schema.replyImages.createdAt))
    .limit(safeLimit);
}
