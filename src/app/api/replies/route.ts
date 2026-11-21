import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { guardCsrf } from '@/lib/csrf-guard';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';
import { PUBLIC_REPLY_CONDITION, PUBLIC_TOPIC_CONDITION } from '@/lib/content-visibility';
import { getSessionUser } from '@/lib/auth';
import { rateLimitByUser } from '@/lib/rate-limit';
import { grantCredits, creditAmounts } from '@/lib/credit-service';
import { allocateFloor, ensureFloorCounter } from '@/server/floor';
import { sanitizeRedirect, seeOther } from '@/lib/redirect';
import { getFormData } from '@/lib/csrf';
import { extractMentions, buildMentionMessage } from '@/lib/mentions';
import {
  loadOwnedReplyByClientRequest,
  serializeCreatedReply,
} from '@/server/reply-submissions';

export const dynamic = 'force-dynamic';

const CLIENT_REQUEST_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_REPLY_PARENT_DEPTH = 32;

function positiveInt(value: unknown): number | null {
  const n = Number(value ?? 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseImageIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(positiveInt).filter((id): id is number => id !== null))].slice(0, 20);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const ct = request.headers.get('content-type') ?? '';
  const isJson = ct.includes('application/json');
  let topicId = 0;
  let content = '';
  let redirect = '/';
  let parentReplyId: number | null = null;
  let clientRequestId = '';
  let imageIds: number[] = [];

  if (isJson) {
    const body = (await request.json().catch(() => null)) as {
      topicId?: number;
      content?: string;
      redirect?: string;
      parentReplyId?: number | null;
      clientRequestId?: string;
      imageIds?: number[];
    } | null;
    topicId = Number(body?.topicId ?? 0);
    content = (body?.content ?? '').trim();
    redirect = sanitizeRedirect(body?.redirect);
    parentReplyId = positiveInt(body?.parentReplyId);
    clientRequestId = typeof body?.clientRequestId === 'string' ? body.clientRequestId : '';
    imageIds = parseImageIds(body?.imageIds);
  } else {
    const form = await getFormData(request);
    topicId = Number(form?.get('topicId') ?? 0);
    content = String(form?.get('content') ?? '').trim();
    redirect = sanitizeRedirect(form?.get('redirect'));
    parentReplyId = positiveInt(form?.get('parentReplyId'));
    clientRequestId = String(form?.get('clientRequestId') ?? '').trim();
  }

  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }
  if (content.length < 2) {
    return NextResponse.json({ ok: false, error: '回复内容太短' }, { status: 400 });
  }
  if (content.length > 20000) {
    return NextResponse.json({ ok: false, error: '回复内容过长' }, { status: 400 });
  }
  if (clientRequestId && !CLIENT_REQUEST_RE.test(clientRequestId)) {
    return NextResponse.json({ ok: false, error: '请求标识无效' }, { status: 400 });
  }
  // 旧表单客户端没有幂等键：服务端生成一个，本次请求仍可正常写入；
  // JSON 客户端必须复用同一键才能获得超时重试幂等。
  if (!clientRequestId) clientRequestId = randomBytes(24).toString('hex');

  const existing = await loadOwnedReplyByClientRequest(user.id, topicId, clientRequestId);
  if (existing?.conflict) {
    return NextResponse.json({ ok: false, error: '请求标识已用于其它主题' }, { status: 409 });
  }
  if (existing) {
    const reply = await serializeCreatedReply(existing.id);
    return NextResponse.json({ ok: true, redirect, replyId: existing.id, reply, duplicated: true });
  }

  const topics = await db
    .select()
    .from(schema.topics)
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(and(
      eq(schema.topics.id, topicId),
      PUBLIC_TOPIC_CONDITION,
      PUBLIC_NODE_CONDITION,
    ))
    .limit(1);
  const topic = topics[0]?.topics;
  if (!topic) {
    return NextResponse.json({ ok: false, error: '主题不存在' }, { status: 404 });
  }
  if (topic.locked) {
    return NextResponse.json({ ok: false, error: '该主题已锁定，无法回复' }, { status: 403 });
  }

  let parentAuthorId: number | null = null;
  if (parentReplyId) {
    const parents = await db
      .select({
        id: schema.replies.id,
        authorId: schema.replies.authorId,
      })
      .from(schema.replies)
      .innerJoin(schema.topics, eq(schema.topics.id, schema.replies.topicId))
      .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
      .where(and(
        eq(schema.replies.id, parentReplyId),
        eq(schema.replies.topicId, topicId),
        PUBLIC_REPLY_CONDITION,
        PUBLIC_TOPIC_CONDITION,
        PUBLIC_NODE_CONDITION,
      ))
      .limit(1);
    const parent = parents[0];
    if (!parent) {
      return NextResponse.json({ ok: false, error: '父回复不存在或不可见' }, { status: 404 });
    }
    parentAuthorId = parent.authorId;
  }

  if (parentReplyId) {
    let cursor: number | null = parentReplyId;
    let depth = 0;
    while (cursor !== null) {
      depth += 1;
      if (depth > MAX_REPLY_PARENT_DEPTH) {
        return NextResponse.json(
          { ok: false, error: `回复层级过深（最多 ${MAX_REPLY_PARENT_DEPTH} 层）` },
          { status: 400 },
        );
      }
      const ancestors = await db
        .select({ parentReplyId: schema.replies.parentReplyId })
        .from(schema.replies)
        .where(eq(schema.replies.id, cursor))
        .limit(1);
      cursor = ancestors[0]?.parentReplyId ?? null;
    }
  }

  if (imageIds.length > 0) {
    const owned = await db
      .select({ id: schema.replyImages.id, usedAt: schema.replyImages.usedAt })
      .from(schema.replyImages)
      .where(and(
        eq(schema.replyImages.userId, user.id),
        inArray(schema.replyImages.id, imageIds),
      ));
    if (owned.length !== imageIds.length || owned.some((image) => image.usedAt !== null)) {
      return NextResponse.json({ ok: false, error: '图片不存在或已被使用' }, { status: 400 });
    }
  }

  const limit = await rateLimitByUser(
    'reply',
    user.id,
    Number(process.env.RATE_LIMIT_REPLY_MAX ?? 20),
    Number(process.env.RATE_LIMIT_REPLY_WINDOW_SECONDS ?? 120),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `回复过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let inserted = false;
  let replyFloor = 0;
  let createdReplyId: number | undefined;
  let replyTotal = topic.repliesCount + 1;

  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    const floor = await allocateFloor(topicId);
    try {
      const created = await db.transaction(async (tx) => {
        const [reply] = await tx
          .insert(schema.replies)
          .values({
            topicId,
            authorId: user.id,
            content,
            floor,
            parentReplyId,
            clientRequestId,
          })
          .returning({ id: schema.replies.id });
        const createdId = reply.id;

        const updatedTopic = await tx
          .update(schema.topics)
          .set({
            repliesCount: sql`${schema.topics.repliesCount} + 1`,
            lastReplyAt: new Date(),
          })
          .where(eq(schema.topics.id, topicId))
          .returning({ repliesCount: schema.topics.repliesCount });
        const total = Number(updatedTopic[0]?.repliesCount ?? topic.repliesCount + 1);

        const notifications: Array<typeof schema.notifications.$inferInsert> = [];
        if (topic.authorId !== user.id) {
          notifications.push({
            userId: topic.authorId,
            type: 'reply',
            actorId: user.id,
            topicId,
            replyId: createdId,
            message: `${user.username} 回复了你的主题：${topic.title}`,
          });
        }
        if (
          parentAuthorId !== null &&
          parentAuthorId !== user.id &&
          parentAuthorId !== topic.authorId
        ) {
          notifications.push({
            userId: parentAuthorId,
            type: 'reply',
            actorId: user.id,
            topicId,
            replyId: createdId,
            message: `${user.username} 回复了你的楼层`,
          });
        }

        const mentionedUsernames = extractMentions(content);
        if (mentionedUsernames.length > 0) {
          const mentionedUsers = await tx
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(and(
              inArray(schema.users.username, mentionedUsernames),
              ne(schema.users.id, user.id),
            ));
          for (const mentioned of mentionedUsers) {
            notifications.push({
              userId: mentioned.id,
              type: 'mention',
              actorId: user.id,
              topicId,
              replyId: createdId,
              message: buildMentionMessage({
                actorName: user.username,
                topicTitle: topic.title,
                isReply: true,
                floor,
              }),
            });
          }
        }
        if (notifications.length > 0) {
          await tx.insert(schema.notifications).values(notifications);
        }

        if (imageIds.length > 0) {
          const claimed = await tx
            .update(schema.replyImages)
            .set({ replyId: createdId, usedAt: new Date() })
            .where(and(
              eq(schema.replyImages.userId, user.id),
              inArray(schema.replyImages.id, imageIds),
              sql`${schema.replyImages.usedAt} IS NULL`,
            ))
            .returning({ id: schema.replyImages.id });
          if (claimed.length !== imageIds.length) {
            throw new Error('图片占用冲突');
          }
        }

        return { id: createdId, total };
      });

      inserted = true;
      replyFloor = floor;
      createdReplyId = created.id;
      replyTotal = created.total;
    } catch (err) {
      const e = err as {
        code?: string;
        constraint_name?: string;
        message?: string;
        cause?: { code?: string; constraint_name?: string; message?: string };
      };
      const code = e.code ?? e.cause?.code;
      const constraint = e.constraint_name ?? e.cause?.constraint_name;
      if (code === '23505' && constraint?.includes('replies_client_request')) {
        const raced = await loadOwnedReplyByClientRequest(user.id, topicId, clientRequestId);
        if (raced && !raced.conflict) {
          const reply = await serializeCreatedReply(raced.id);
          return NextResponse.json({ ok: true, redirect, replyId: raced.id, reply, duplicated: true });
        }
      }
      if (code === '23505' || constraint?.includes('replies_topic_floor')) {
        await ensureFloorCounter(topicId);
        continue;
      }
      console.error('[replies] 插入失败:', {
        code,
        constraint,
        message: e.message ?? e.cause?.message,
        topicId,
        floor,
        authorId: user.id,
      });
      throw err;
    }
  }

  if (!inserted || !createdReplyId) {
    return NextResponse.json({ ok: false, error: '回复失败，请重试' }, { status: 500 });
  }

  try {
    await grantCredits(user.id, {
      type: 'reply_created',
      amount: creditAmounts().reply,
      idempotencyKey: `reply_created:${createdReplyId}`,
      refType: 'reply',
      refId: createdReplyId,
      reason: '发布回复',
    });
  } catch (err) {
    // 回复已提交成功；积分是副作用，不能反过来让用户重复发回复。
    // 幂等键保留，重试/对账可再次发放。
    console.error('[replies] 积分发放失败', err);
  }

  if (isJson) {
    const reply = await serializeCreatedReply(createdReplyId);
    return NextResponse.json({
      ok: true,
      redirect,
      replyId: createdReplyId,
      reply,
      replyFloor,
      replyTotal,
    });
  }
  return seeOther(redirect);
}
