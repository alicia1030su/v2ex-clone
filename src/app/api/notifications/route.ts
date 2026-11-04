import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { and, desc, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications —— 当前用户的通知列表（分页）
 *
 * 查询参数：limit（默认 30，最大 100）、offset、unreadOnly
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit') ?? 30);
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 30, 1),
    100,
  );
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true';

  const where = unreadOnly
    ? and(eq(schema.notifications.userId, user.id), eq(schema.notifications.read, false))
    : eq(schema.notifications.userId, user.id);

  const items = await db
    .select({
      id: schema.notifications.id,
      type: schema.notifications.type,
      actorId: schema.notifications.actorId,
      topicId: schema.notifications.topicId,
      replyId: schema.notifications.replyId,
      message: schema.notifications.message,
      read: schema.notifications.read,
      createdAt: schema.notifications.createdAt,
    })
    .from(schema.notifications)
    .where(where)
    .orderBy(desc(schema.notifications.id))
    .limit(limit)
    .offset(offset);

  const [totalRows, unreadRows] = await Promise.all([
    db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, user.id)),
    db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, user.id),
          eq(schema.notifications.read, false),
        ),
      ),
  ]);

  return NextResponse.json({
    ok: true,
    total: totalRows.length,
    unread: unreadRows.length,
    notifications: items,
  });
}

/**
 * POST /api/notifications/read —— 标记已读
 *
 * body: { id?: number }  —— 给了 id 则标记单条，不给则标记全部
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as { id?: number } | null;
  const id = body?.id !== undefined ? Number(body.id) : undefined;

  if (id !== undefined) {
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: '通知 ID 无效' }, { status: 400 });
    }
    const updated = await db
      .update(schema.notifications)
      .set({ read: true })
      .where(
        and(
          eq(schema.notifications.id, id),
          eq(schema.notifications.userId, user.id),
        ),
      )
      .returning({ id: schema.notifications.id });
    return NextResponse.json({ ok: true, updated: updated.length });
  }

  // 全部标记已读
  const updated = await db
    .update(schema.notifications)
    .set({ read: true })
    .where(
      and(
        eq(schema.notifications.userId, user.id),
        eq(schema.notifications.read, false),
      ),
    )
    .returning({ id: schema.notifications.id });

  return NextResponse.json({ ok: true, updated: updated.length });
}

/**
 * DELETE /api/notifications —— 删除通知
 *
 * body: { id?: number } —— 给了 id 则删单条，不给则清空自己的全部通知
 */
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as { id?: number } | null;
  const id = body?.id !== undefined ? Number(body.id) : undefined;

  if (id !== undefined) {
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: '通知 ID 无效' }, { status: 400 });
    }
    // 只能删自己的通知
    const deleted = await db
      .delete(schema.notifications)
      .where(
        and(
          eq(schema.notifications.id, id),
          eq(schema.notifications.userId, user.id),
        ),
      )
      .returning({ id: schema.notifications.id });
    if (deleted.length === 0) {
      return NextResponse.json({ ok: false, error: '通知不存在' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted: deleted.length });
  }

  const deleted = await db
    .delete(schema.notifications)
    .where(eq(schema.notifications.userId, user.id))
    .returning({ id: schema.notifications.id });

  return NextResponse.json({ ok: true, deleted: deleted.length });
}
