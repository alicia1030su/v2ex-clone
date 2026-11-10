import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { and, eq } from 'drizzle-orm';
import { guardCommunityAction } from '@/lib/community-rate-limit';
import { listNotificationsForUser } from '@/server/notifications';

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
  const limit = Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 30;
  const offset = Number(url.searchParams.get('offset') ?? 0) || 0;
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true';

  // v0.0.15 P0-1：可见性判据收敛在 `src/server/notifications.ts`。
  //
  // 修复前这里没有任何 join —— 通知的 message 是在**写入时**拼好的，
  // 里面嵌了主题标题；于是节点被 hidden / 主题被软删除之后，
  // 公共页面已经 404，通知收件箱却照常返回那条标题。
  // 「提及通知」的收件人还是**任意被 @ 的第三方**，属于真实的跨用户泄露。
  //
  // ⚠️ total / unread 与 items **同口径**：三者都从同一个带 join 的基座出发，
  //    否则会出现「列表 0 条、角标 5 条」的分页错位。
  const { items, total, unread } = await listNotificationsForUser(user.id, {
    limit,
    offset,
    unreadOnly,
  });

  return NextResponse.json({
    ok: true,
    total,
    unread,
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
  // v0.0.5：社区动作频率限制（用户 + IP 双维度）
  const rl = await guardCommunityAction('notification', user?.id ?? null);
  if (rl) return rl;

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
  // v0.0.5：社区动作频率限制（用户 + IP 双维度）
  const rl = await guardCommunityAction('notification', user?.id ?? null);
  if (rl) return rl;

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
