import { NextResponse } from 'next/server';
import { adminGuardWrite } from '@/lib/admin-guard';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { canBanUser } from '@/lib/permissions';
import { writeAuditLog, AuditAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/users/[id]/ban —— 封禁用户
 *
 * 权限：users.ban（moderator / admin）；封禁 admin 需 users.ban_admin
 * 关键：**封禁后销毁该用户全部会话**（旧会话立即失效）
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await adminGuardWrite(request, 'users.ban');
  if (guard.response) return guard.response;
  const actor = guard.user;

  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ ok: false, error: '用户 ID 无效' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  const reason = body?.reason?.trim() ?? '';

  const rows = await db
    .select({ id: schema.users.id, role: schema.users.role, status: schema.users.status })
    .from(schema.users)
    .where(eq(schema.users.id, targetId))
    .limit(1);
  const target = rows[0];
  if (!target) {
    return NextResponse.json({ ok: false, error: '用户不存在' }, { status: 404 });
  }
  if (target.status === 'banned') {
    return NextResponse.json({ ok: false, error: '用户已被封禁' }, { status: 409 });
  }

  const allowed = canBanUser(actor, target);
  if (!allowed.ok) {
    return NextResponse.json({ ok: false, error: allowed.reason }, { status: 403 });
  }

  // 封禁 + 销毁全部会话（原子）
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ status: 'banned' })
      .where(eq(schema.users.id, targetId));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, targetId));
  });

  await writeAuditLog(actor.id, {
    action: AuditAction.USER_BAN,
    targetType: 'user',
    targetId: targetId,
    reason: reason || null,
  });

  return NextResponse.json({ ok: true, userId: targetId, status: 'banned' });
}
