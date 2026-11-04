import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * POST /api/users/follows —— 关注用户
 *
 * body: { userId: number }
 *
 * 幂等：follows 表有 (follower_id, following_id) 唯一索引，
 * 重复关注返回幂等成功，不产生重复记录。
 * 不能关注自己。
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as { userId?: number } | null;
  const targetId = Number(body?.userId);

  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ ok: false, error: '用户 ID 无效' }, { status: 400 });
  }
  if (targetId === user.id) {
    return NextResponse.json({ ok: false, error: '不能关注自己' }, { status: 400 });
  }

  const target = await db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, targetId))
    .limit(1);
  if (!target[0]) {
    return NextResponse.json({ ok: false, error: '用户不存在' }, { status: 404 });
  }

  const inserted = await db
    .insert(schema.follows)
    .values({ followerId: user.id, followingId: targetId })
    .onConflictDoNothing()
    .returning({ id: schema.follows.id });

  const countRows = await db
    .select({ id: schema.follows.id })
    .from(schema.follows)
    .where(eq(schema.follows.followingId, targetId));

  return NextResponse.json({
    ok: true,
    alreadyFollowed: inserted.length === 0,
    following: target[0].username,
    followersCount: countRows.length,
  });
}

/**
 * DELETE /api/users/follows —— 取消关注
 * body: { userId: number }
 */
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as { userId?: number } | null;
  const targetId = Number(body?.userId);

  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ ok: false, error: '用户 ID 无效' }, { status: 400 });
  }

  const deleted = await db
    .delete(schema.follows)
    .where(
      and(
        eq(schema.follows.followerId, user.id),
        eq(schema.follows.followingId, targetId),
      ),
    )
    .returning({ id: schema.follows.id });

  const countRows = await db
    .select({ id: schema.follows.id })
    .from(schema.follows)
    .where(eq(schema.follows.followingId, targetId));

  return NextResponse.json({
    ok: true,
    removed: deleted.length > 0,
    followersCount: countRows.length,
  });
}

/**
 * GET /api/users/follows —— 我关注的用户列表
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
      tagline: schema.users.tagline,
      followedAt: schema.follows.createdAt,
    })
    .from(schema.follows)
    .innerJoin(schema.users, eq(schema.users.id, schema.follows.followingId))
    .where(eq(schema.follows.followerId, user.id))
    .orderBy(desc(schema.follows.createdAt))
    .limit(200);

  return NextResponse.json({ ok: true, following: rows });
}
