import 'server-only';
import { db, schema } from '@/db';
import { and, eq, isNull, sql, desc, asc } from 'drizzle-orm';
import type { SessionUser } from '@/lib/auth';
import { canModifyOwnContent, withinEditWindow } from '@/lib/permissions';
import { grantCredits, creditAmounts } from '@/lib/credit-service';

/**
 * 内容服务层（v0.0.3）
 *
 * 主题与回复的编辑、软删除、恢复、投票、感谢都集中在这里，
 * 保证所有 API 的行为一致（尤其是「已删除内容不泄露」与「计数一致」）。
 */

/** 统一的业务错误（API 层转成 HTTP 状态码） */
export class ContentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ContentError';
  }
}

export type TopicEditResult = {
  topicId: number;
  title: string;
  content: string;
  editCount: number;
  editedAt: Date;
};

export type ReplyEditResult = {
  replyId: number;
  content: string;
  editCount: number;
  editedAt: Date;
};

/** 编辑时间窗口的硬上限（分钟）—— 可配置但有上限，防止误配成永久 */
const MAX_EDIT_WINDOW_MINUTES = 60 * 24 * 30;

/** 校验编辑时限配置是否越界 */
function safeWindow(): number {
  const raw = process.env.TOPIC_EDIT_WINDOW_MINUTES;
  const n = raw === undefined ? 60 : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 60;
  return Math.min(Math.floor(n), MAX_EDIT_WINDOW_MINUTES);
}

/**
 * 编辑主题。
 *
 * 权限：作者本人，或 moderator/admin。
 * 时限：作者受编辑时限约束；管理角色不受限。
 * 审计：写入 edit_history（不可变快照）。
 */
export async function editTopic(
  user: SessionUser,
  topicId: number,
  input: { title?: string; content?: string },
): Promise<TopicEditResult> {
  const rows = await db
    .select()
    .from(schema.topics)
    .where(eq(schema.topics.id, topicId))
    .limit(1);
  const topic = rows[0];
  if (!topic) throw new ContentError('TOPIC_NOT_FOUND', '主题不存在', 404);
  if (topic.deletedAt) {
    throw new ContentError('TOPIC_DELETED', '主题已被删除，无法编辑', 404);
  }

  if (!canModifyOwnContent(user, topic.authorId)) {
    throw new ContentError('FORBIDDEN', '无权编辑他人的主题', 403);
  }

  const isAuthor = user.id === topic.authorId;
  if (isAuthor) {
    const window = withinEditWindow(topic.createdAt, user);
    if (!window.ok) {
      throw new ContentError('EDIT_WINDOW_EXCEEDED', window.reason ?? '超过编辑时限', 403);
    }
  }

  const newTitle = input.title !== undefined ? input.title.trim() : topic.title;
  const newContent = input.content !== undefined ? input.content.trim() : topic.content;

  if (newTitle.length < 2 || newTitle.length > 128) {
    throw new ContentError('INVALID_TITLE', '标题长度需在 2–128 字之间', 400);
  }
  if (newContent.length < 2) {
    throw new ContentError('INVALID_CONTENT', '内容太短', 400);
  }
  if (newContent.length > 50000) {
    throw new ContentError('INVALID_CONTENT', '内容过长', 400);
  }

  const now = new Date();
  const updated = await db
    .update(schema.topics)
    .set({
      title: newTitle,
      content: newContent,
      editedAt: now,
      editCount: sql`${schema.topics.editCount} + 1`,
      updatedAt: now,
    })
    .where(eq(schema.topics.id, topicId))
    .returning({
      editCount: schema.topics.editCount,
      editedAt: schema.topics.editedAt,
    });

  // 写入编辑历史（只 INSERT，不可变）
  await db.insert(schema.editHistory).values({
    targetType: 'topic',
    targetId: topicId,
    editorId: user.id,
    previousTitle: topic.title,
    previousContent: topic.content,
    newTitle,
    newContent,
  });

  return {
    topicId,
    title: newTitle,
    content: newContent,
    editCount: updated[0]?.editCount ?? 0,
    editedAt: updated[0]?.editedAt ?? now,
  };
}

/**
 * 软删除主题。
 *
 * 内容保留在库中（可恢复、可审计），但：
 *  - topics.status 改为 'deleted'
 *  - topics.deletedAt / deletedBy / deletedReason 记录操作
 *  - 所有列表与详情查询都必须过滤 deletedAt 非空的记录
 */
export async function softDeleteTopic(
  user: SessionUser,
  topicId: number,
  reason?: string,
): Promise<{ topicId: number; deletedAt: Date }> {
  const rows = await db
    .select()
    .from(schema.topics)
    .where(eq(schema.topics.id, topicId))
    .limit(1);
  const topic = rows[0];
  if (!topic) throw new ContentError('TOPIC_NOT_FOUND', '主题不存在', 404);
  if (topic.deletedAt) {
    throw new ContentError('ALREADY_DELETED', '主题已被删除', 409);
  }

  if (!canModifyOwnContent(user, topic.authorId)) {
    throw new ContentError('FORBIDDEN', '无权删除他人的主题', 403);
  }

  const now = new Date();
  await db
    .update(schema.topics)
    .set({
      status: 'deleted',
      deletedAt: now,
      deletedBy: user.id,
      deletedReason: reason?.trim() || null,
      updatedAt: now,
    })
    .where(eq(schema.topics.id, topicId));

  return { topicId, deletedAt: now };
}

/** 恢复主题（仅 moderator/admin） */
export async function restoreTopic(
  user: SessionUser,
  topicId: number,
): Promise<{ topicId: number }> {
  const rows = await db
    .select()
    .from(schema.topics)
    .where(eq(schema.topics.id, topicId))
    .limit(1);
  const topic = rows[0];
  if (!topic) throw new ContentError('TOPIC_NOT_FOUND', '主题不存在', 404);
  if (!topic.deletedAt) {
    throw new ContentError('NOT_DELETED', '主题未被删除', 409);
  }
  if (user.role !== 'moderator' && user.role !== 'admin') {
    throw new ContentError('FORBIDDEN', '只有管理员或版主可以恢复主题', 403);
  }

  await db
    .update(schema.topics)
    .set({
      status: 'published',
      deletedAt: null,
      deletedBy: null,
      deletedReason: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.topics.id, topicId));

  return { topicId };
}

/** 编辑回复 */
export async function editReply(
  user: SessionUser,
  replyId: number,
  input: { content?: string },
): Promise<ReplyEditResult> {
  const rows = await db
    .select()
    .from(schema.replies)
    .where(eq(schema.replies.id, replyId))
    .limit(1);
  const reply = rows[0];
  if (!reply) throw new ContentError('REPLY_NOT_FOUND', '回复不存在', 404);
  if (reply.deletedAt) {
    throw new ContentError('REPLY_DELETED', '回复已被删除', 404);
  }

  if (!canModifyOwnContent(user, reply.authorId)) {
    throw new ContentError('FORBIDDEN', '无权编辑他人的回复', 403);
  }

  const isAuthor = user.id === reply.authorId;
  if (isAuthor) {
    const window = withinEditWindow(reply.createdAt, user);
    if (!window.ok) {
      throw new ContentError('EDIT_WINDOW_EXCEEDED', window.reason ?? '超过编辑时限', 403);
    }
  }

  const newContent = (input.content ?? reply.content).trim();
  if (newContent.length < 2) throw new ContentError('INVALID_CONTENT', '内容太短', 400);
  if (newContent.length > 20000) {
    throw new ContentError('INVALID_CONTENT', '内容过长', 400);
  }

  const now = new Date();
  const updated = await db
    .update(schema.replies)
    .set({
      content: newContent,
      editedAt: now,
      editCount: sql`${schema.replies.editCount} + 1`,
      updatedAt: now,
    })
    .where(eq(schema.replies.id, replyId))
    .returning({
      editCount: schema.replies.editCount,
      editedAt: schema.replies.editedAt,
    });

  await db.insert(schema.editHistory).values({
    targetType: 'reply',
    targetId: replyId,
    editorId: user.id,
    previousContent: reply.content,
    newContent,
  });

  return {
    replyId,
    content: newContent,
    editCount: updated[0]?.editCount ?? 0,
    editedAt: updated[0]?.editedAt ?? now,
  };
}

/** 软删除回复 */
export async function softDeleteReply(
  user: SessionUser,
  replyId: number,
  reason?: string,
): Promise<{ replyId: number; deletedAt: Date }> {
  const rows = await db
    .select()
    .from(schema.replies)
    .where(eq(schema.replies.id, replyId))
    .limit(1);
  const reply = rows[0];
  if (!reply) throw new ContentError('REPLY_NOT_FOUND', '回复不存在', 404);
  if (reply.deletedAt) {
    throw new ContentError('ALREADY_DELETED', '回复已被删除', 409);
  }

  if (!canModifyOwnContent(user, reply.authorId)) {
    throw new ContentError('FORBIDDEN', '无权删除他人的回复', 403);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.replies)
      .set({
        deletedAt: now,
        deletedBy: user.id,
        deletedReason: reason?.trim() || null,
        updatedAt: now,
      })
      .where(eq(schema.replies.id, replyId));

    // 同步主题的回复计数（保持与实际未删除回复一致）
    await tx.execute(sql`
      UPDATE topics SET replies_count = (
        SELECT count(*)::int FROM replies
        WHERE replies.topic_id = ${reply.topicId} AND replies.deleted_at IS NULL
      ), updated_at = now()
      WHERE id = ${reply.topicId}
    `);
  });

  return { replyId, deletedAt: now };
}

/** 恢复回复（仅 moderator/admin） */
export async function restoreReply(
  user: SessionUser,
  replyId: number,
): Promise<{ replyId: number }> {
  const rows = await db
    .select()
    .from(schema.replies)
    .where(eq(schema.replies.id, replyId))
    .limit(1);
  const reply = rows[0];
  if (!reply) throw new ContentError('REPLY_NOT_FOUND', '回复不存在', 404);
  if (!reply.deletedAt) {
    throw new ContentError('NOT_DELETED', '回复未被删除', 409);
  }
  if (user.role !== 'moderator' && user.role !== 'admin') {
    throw new ContentError('FORBIDDEN', '只有管理员可以恢复回复', 403);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.replies)
      .set({ deletedAt: null, deletedBy: null, deletedReason: null, updatedAt: new Date() })
      .where(eq(schema.replies.id, replyId));

    await tx.execute(sql`
      UPDATE topics SET replies_count = (
        SELECT count(*)::int FROM replies
        WHERE replies.topic_id = ${reply.topicId} AND replies.deleted_at IS NULL
      ), updated_at = now()
      WHERE id = ${reply.topicId}
    `);
  });

  return { replyId };
}

/**
 * 感谢回复。
 *
 * 幂等：thanks 表有 (user_id, reply_id) 唯一索引。
 * 重复感谢返回 duplicated=true，计数不变。
 * 一致性：replies.thanks 必须与 thanks 表行数一致 —— 用原子递增维护。
 *
 * v0.0.4：感谢会**给回复作者加积分**（`topic_thanked` 流水）并发**通知**，
 * 补齐「感谢 → 积分 → 通知」的闭环 —— 此前 `topic_thanked` 流水类型
 * 与 `topic_thanks` 通知类型在 schema 里定义了却**从未被写入过**。
 */
export async function thankReply(
  user: SessionUser,
  replyId: number,
): Promise<{ replyId: number; thanks: number; duplicated: boolean }> {
  const replyRows = await db
    .select({
      id: schema.replies.id,
      authorId: schema.replies.authorId,
      topicId: schema.replies.topicId,
    })
    .from(schema.replies)
    .where(and(eq(schema.replies.id, replyId), isNull(schema.replies.deletedAt)))
    .limit(1);
  const reply = replyRows[0];
  if (!reply) throw new ContentError('REPLY_NOT_FOUND', '回复不存在', 404);
  if (reply.authorId === user.id) {
    throw new ContentError('SELF_THANK', '不能感谢自己的回复', 400);
  }

  const inserted = await db
    .insert(schema.thanks)
    .values({ userId: user.id, replyId })
    .onConflictDoNothing()
    .returning({ id: schema.thanks.id });

  if (inserted.length === 0) {
    // 已感谢过 —— 幂等返回当前计数
    const rows = await db
      .select({ thanks: schema.replies.thanks })
      .from(schema.replies)
      .where(eq(schema.replies.id, replyId))
      .limit(1);
    return { replyId, thanks: rows[0]?.thanks ?? 0, duplicated: true };
  }

  const updated = await db
    .update(schema.replies)
    .set({ thanks: sql`${schema.replies.thanks} + 1` })
    .where(eq(schema.replies.id, replyId))
    .returning({ thanks: schema.replies.thanks });

  // —— 感谢的积分与通知闭环（v0.0.4）——
  //
  // 幂等键 `topic_thanked:{replyId}` 保证同一条回复**只被感谢一次**
  // 就只发一次积分（thanks 表的唯一索引已经保证了「只插入一条」，
  // 这里再由幂等键保证「只发放一次」—— 两者职责不同，缺一不可）。
  await grantCredits(reply.authorId, {
    type: 'topic_thanked',
    amount: creditAmounts().thanks,
    idempotencyKey: `topic_thanked:${replyId}`,
    refType: 'reply',
    refId: replyId,
    actorId: user.id,
    reason: '收到感谢',
  });

  await db.insert(schema.notifications).values({
    userId: reply.authorId,
    type: 'topic_thanks',
    actorId: user.id,
    topicId: reply.topicId,
    replyId,
    message: `${user.username} 感谢了你的回复`,
  });

  return { replyId, thanks: updated[0]?.thanks ?? 0, duplicated: false };
}

/** 取消感谢 */
export async function unthankReply(
  user: SessionUser,
  replyId: number,
): Promise<{ replyId: number; thanks: number; removed: boolean }> {
  const deleted = await db
    .delete(schema.thanks)
    .where(and(eq(schema.thanks.userId, user.id), eq(schema.thanks.replyId, replyId)))
    .returning({ id: schema.thanks.id });

  if (deleted.length === 0) {
    const rows = await db
      .select({ thanks: schema.replies.thanks })
      .from(schema.replies)
      .where(eq(schema.replies.id, replyId))
      .limit(1);
    return { replyId, thanks: rows[0]?.thanks ?? 0, removed: false };
  }

  // 计数不能减到负数
  const updated = await db
    .update(schema.replies)
    .set({ thanks: sql`GREATEST(${schema.replies.thanks} - 1, 0)` })
    .where(eq(schema.replies.id, replyId))
    .returning({ thanks: schema.replies.thanks });

  return { replyId, thanks: updated[0]?.thanks ?? 0, removed: true };
}

/**
 * 投票。
 *
 * 幂等：
 *  - 唯一索引 (user_id, topic_id) 保证一人一主题只有一条票
 *  - 重复同向投票 → duplicated=true，票数不变
 *  - 改变方向 → 更新方向，票数按差额调整
 *
 * 汇总：topics.votes = up 票数 - down 票数
 */
export async function voteTopic(
  user: SessionUser,
  topicId: number,
  direction: 'up' | 'down',
): Promise<{ topicId: number; votes: number; myVote: string; changed: boolean }> {
  const topicRows = await db
    .select({ id: schema.topics.id })
    .from(schema.topics)
    .where(and(eq(schema.topics.id, topicId), isNull(schema.topics.deletedAt)))
    .limit(1);
  if (!topicRows[0]) throw new ContentError('TOPIC_NOT_FOUND', '主题不存在', 404);

  const existing = await db
    .select({ id: schema.votes.id, direction: schema.votes.direction })
    .from(schema.votes)
    .where(and(eq(schema.votes.userId, user.id), eq(schema.votes.topicId, topicId)))
    .limit(1);

  const current = existing[0];

  if (current && current.direction === direction) {
    // 幂等：同向重复投票不改变计数
    const rows = await db
      .select({ votes: schema.topics.votes })
      .from(schema.topics)
      .where(eq(schema.topics.id, topicId))
      .limit(1);
    return {
      topicId,
      votes: rows[0]?.votes ?? 0,
      myVote: direction,
      changed: false,
    };
  }

  if (current) {
    // 改票：方向变化，票数差额 = ±2
    const delta = direction === 'up' ? 2 : -2;
    await db.transaction(async (tx) => {
      await tx
        .update(schema.votes)
        .set({ direction })
        .where(and(eq(schema.votes.userId, user.id), eq(schema.votes.topicId, topicId)));
      await tx
        .update(schema.topics)
        .set({ votes: sql`${schema.topics.votes} + ${delta}` })
        .where(eq(schema.topics.id, topicId));
    });
  } else {
    // 首票
    const delta = direction === 'up' ? 1 : -1;
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.votes)
        .values({ userId: user.id, topicId, direction })
        .onConflictDoNothing()
        .returning({ id: schema.votes.id });
      if (inserted.length > 0) {
        await tx
          .update(schema.topics)
          .set({ votes: sql`${schema.topics.votes} + ${delta}` })
          .where(eq(schema.topics.id, topicId));
      }
    });
  }

  const rows = await db
    .select({ votes: schema.topics.votes })
    .from(schema.topics)
    .where(eq(schema.topics.id, topicId))
    .limit(1);
  return { topicId, votes: rows[0]?.votes ?? 0, myVote: direction, changed: true };
}

/** 取消投票 */
export async function unvoteTopic(
  user: SessionUser,
  topicId: number,
): Promise<{ topicId: number; votes: number; removed: boolean }> {
  const existing = await db
    .select({ id: schema.votes.id, direction: schema.votes.direction })
    .from(schema.votes)
    .where(and(eq(schema.votes.userId, user.id), eq(schema.votes.topicId, topicId)))
    .limit(1);
  if (!existing[0]) {
    const rows = await db
      .select({ votes: schema.topics.votes })
      .from(schema.topics)
      .where(eq(schema.topics.id, topicId))
      .limit(1);
    return { topicId, votes: rows[0]?.votes ?? 0, removed: false };
  }

  const delta = existing[0].direction === 'up' ? -1 : 1;
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.votes)
      .where(and(eq(schema.votes.userId, user.id), eq(schema.votes.topicId, topicId)));
    await tx
      .update(schema.topics)
      .set({ votes: sql`${schema.topics.votes} + ${delta}` })
      .where(eq(schema.topics.id, topicId));
  });

  const rows = await db
    .select({ votes: schema.topics.votes })
    .from(schema.topics)
    .where(eq(schema.topics.id, topicId))
    .limit(1);
  return { topicId, votes: rows[0]?.votes ?? 0, removed: true };
}

/**
 * 主题详情（含回复列表）。
 *
 * 软删除过滤：
 *  - 默认**不返回**已删除的回复
 *  - includeDeleted=true 时仅对 staff 或作者本人开放
 */
export async function getTopicDetail(
  topicId: number,
  viewer: SessionUser | null,
  opts: { includeDeleted?: boolean; replyLimit?: number; replyOffset?: number } = {},
): Promise<{
  topic: typeof schema.topics.$inferSelect | null;
  replies: Array<typeof schema.replies.$inferSelect>;
  replyTotal: number;
}> {
  const topicRows = await db
    .select()
    .from(schema.topics)
    .where(eq(schema.topics.id, topicId))
    .limit(1);
  const topic = topicRows[0] ?? null;

  if (!topic) return { topic: null, replies: [], replyTotal: 0 };

  const isStaff = viewer?.role === 'admin' || viewer?.role === 'moderator';
  const isAuthor = !!viewer && viewer.id === topic.authorId;
  const canSeeDeleted = opts.includeDeleted === true && (isStaff || isAuthor);

  if (topic.deletedAt && !canSeeDeleted) {
    // 已删除的主题对普通访问者表现为「不存在」
    return { topic: null, replies: [], replyTotal: 0 };
  }

  const replyLimit = Math.min(Math.max(opts.replyLimit ?? 100, 1), 200);
  const replyOffset = Math.max(opts.replyOffset ?? 0, 0);

  const conditions = [eq(schema.replies.topicId, topicId)];
  if (!canSeeDeleted) {
    conditions.push(isNull(schema.replies.deletedAt));
  }

  const replies = await db
    .select()
    .from(schema.replies)
    .where(and(...conditions))
    .orderBy(asc(schema.replies.floor))
    .limit(replyLimit)
    .offset(replyOffset);

  // ⚠️ 条件片段必须用 sql`` 包装。
  // 直接写字符串会被 drizzle 当作**参数值**绑定成 $2，占位符而非 SQL 片段，
  // PostgreSQL 直接报 42601「语法错误 在 "$2" 或附近的」。
  // 这让 GET /api/topics/[id] 在生产构建下必然 500 ——
  // 而 v0.0.3 的单元测试与 E2E 都没有调用过这个端点。
  const deletedFilter = canSeeDeleted ? sql`` : sql`AND deleted_at IS NULL`;

  const countRows = await db.execute(sql`
    SELECT count(*)::int AS n FROM replies
    WHERE topic_id = ${topicId}
      ${deletedFilter}
  `);
  const replyTotal = Number(
    (countRows as unknown as Array<{ n: number }>)[0]?.n ?? 0,
  );

  return { topic, replies, replyTotal };
}

/**
 * 主题锁定 / 解锁。
 * 仅 moderator/admin（由调用方路由层校验，服务层再兜底一次）。
 */
export async function lockTopic(
  user: SessionUser,
  topicId: number,
): Promise<{ topicId: number; locked: boolean }> {
  if (user.role !== 'moderator' && user.role !== 'admin') {
    throw new ContentError('FORBIDDEN', '权限不足', 403);
  }
  const rows = await db
    .select({ id: schema.topics.id, deletedAt: schema.topics.deletedAt })
    .from(schema.topics)
    .where(eq(schema.topics.id, topicId))
    .limit(1);
  if (!rows[0]) throw new ContentError('TOPIC_NOT_FOUND', '主题不存在', 404);
  if (rows[0].deletedAt) {
    throw new ContentError('TOPIC_DELETED', '主题已被删除', 404);
  }

  await db
    .update(schema.topics)
    .set({ locked: true, updatedAt: new Date() })
    .where(eq(schema.topics.id, topicId));
  return { topicId, locked: true };
}

export async function unlockTopic(
  user: SessionUser,
  topicId: number,
): Promise<{ topicId: number; locked: boolean }> {
  if (user.role !== 'moderator' && user.role !== 'admin') {
    throw new ContentError('FORBIDDEN', '权限不足', 403);
  }
  const rows = await db
    .select({ id: schema.topics.id })
    .from(schema.topics)
    .where(eq(schema.topics.id, topicId))
    .limit(1);
  if (!rows[0]) throw new ContentError('TOPIC_NOT_FOUND', '主题不存在', 404);

  await db
    .update(schema.topics)
    .set({ locked: false, updatedAt: new Date() })
    .where(eq(schema.topics.id, topicId));
  return { topicId, locked: false };
}

/** 主题置顶 / 取消置顶 */
export async function pinTopic(
  user: SessionUser,
  topicId: number,
): Promise<{ topicId: number; pinned: boolean }> {
  if (user.role !== 'moderator' && user.role !== 'admin') {
    throw new ContentError('FORBIDDEN', '权限不足', 403);
  }
  const rows = await db
    .select({ id: schema.topics.id, deletedAt: schema.topics.deletedAt })
    .from(schema.topics)
    .where(eq(schema.topics.id, topicId))
    .limit(1);
  if (!rows[0]) throw new ContentError('TOPIC_NOT_FOUND', '主题不存在', 404);
  if (rows[0].deletedAt) {
    throw new ContentError('TOPIC_DELETED', '主题已被删除', 404);
  }

  await db
    .update(schema.topics)
    .set({ pinned: true, updatedAt: new Date() })
    .where(eq(schema.topics.id, topicId));
  return { topicId, pinned: true };
}

export async function unpinTopic(
  user: SessionUser,
  topicId: number,
): Promise<{ topicId: number; pinned: boolean }> {
  if (user.role !== 'moderator' && user.role !== 'admin') {
    throw new ContentError('FORBIDDEN', '权限不足', 403);
  }
  const rows = await db
    .select({ id: schema.topics.id })
    .from(schema.topics)
    .where(eq(schema.topics.id, topicId))
    .limit(1);
  if (!rows[0]) throw new ContentError('TOPIC_NOT_FOUND', '主题不存在', 404);

  await db
    .update(schema.topics)
    .set({ pinned: false, updatedAt: new Date() })
    .where(eq(schema.topics.id, topicId));
  return { topicId, pinned: false };
}

/** 查询某主题的编辑历史（作者或 staff 可见） */
export async function listEditHistory(
  targetType: 'topic' | 'reply',
  targetId: number,
  limit = 50,
) {
  return await db
    .select({
      id: schema.editHistory.id,
      editorId: schema.editHistory.editorId,
      editorName: schema.users.username,
      previousTitle: schema.editHistory.previousTitle,
      newTitle: schema.editHistory.newTitle,
      previousContent: schema.editHistory.previousContent,
      newContent: schema.editHistory.newContent,
      createdAt: schema.editHistory.createdAt,
    })
    .from(schema.editHistory)
    .innerJoin(schema.users, eq(schema.users.id, schema.editHistory.editorId))
    .where(
      and(
        eq(schema.editHistory.targetType, targetType),
        eq(schema.editHistory.targetId, targetId),
      ),
    )
    .orderBy(desc(schema.editHistory.id))
    .limit(Math.min(Math.max(limit, 1), 200));
}
