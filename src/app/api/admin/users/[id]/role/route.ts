import { NextResponse } from 'next/server';
import { adminGuardWrite } from '@/lib/admin-guard';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { canChangeRole } from '@/lib/permissions';
import { writeAuditLog, AuditAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/users/[id]/role —— 变更用户角色
 *
 * 权限：users.role（仅 admin）
 * 保护：管理员不能把自己降级（会导致系统无人可恢复）
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await adminGuardWrite(request, 'users.role');
  if (guard.response) return guard.response;
  const actor = guard.user;

  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ ok: false, error: '用户 ID 无效' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    role?: string;
    reason?: string;
  } | null;
  const nextRole = String(body?.role ?? '');
  if (nextRole !== 'user' && nextRole !== 'moderator' && nextRole !== 'admin') {
    return NextResponse.json({ ok: false, error: '角色无效' }, { status: 400 });
  }

  const rows = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, targetId))
    .limit(1);
  const target = rows[0];
  if (!target) {
    return NextResponse.json({ ok: false, error: '用户不存在' }, { status: 404 });
  }

  const allowed = canChangeRole(actor, target, nextRole);
  if (!allowed.ok) {
    return NextResponse.json({ ok: false, error: allowed.reason }, { status: 403 });
  }

  await db
    .update(schema.users)
    .set({ role: nextRole })
    .where(eq(schema.users.id, targetId));

  await writeAuditLog(actor.id, {
    action: AuditAction.USER_ROLE_CHANGE,
    targetType: 'user',
    targetId: targetId,
    reason: body?.reason ?? `${target.role} → ${nextRole}`,
  });

  return NextResponse.json({ ok: true, userId: targetId, role: nextRole });
}
