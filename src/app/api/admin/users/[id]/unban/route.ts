import { NextResponse } from 'next/server';
import { adminGuardWrite } from '@/lib/admin-guard';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { writeAuditLog, AuditAction } from '@/lib/audit';
import { guardCommunityAction } from '@/lib/community-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/users/[id]/unban —— 解除封禁
 *
 * 权限：users.ban（moderator / admin）
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await adminGuardWrite(request, 'users.ban');
  if (guard.response) return guard.response;
  // v0.0.5：管理动作频率限制 —— 防脚本批量滥用（封号 / 改角色 / 调积分…）
  const rl = await guardCommunityAction('admin_action', guard.user?.id ?? null);
  if (rl) return rl;
  const actor = guard.user;

  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ ok: false, error: '用户 ID 无效' }, { status: 400 });
  }

  const rows = await db
    .select({ id: schema.users.id, status: schema.users.status })
    .from(schema.users)
    .where(eq(schema.users.id, targetId))
    .limit(1);
  const target = rows[0];
  if (!target) {
    return NextResponse.json({ ok: false, error: '用户不存在' }, { status: 404 });
  }
  if (target.status !== 'banned' && target.status !== 'suspended') {
    return NextResponse.json({ ok: false, error: '用户未被封禁' }, { status: 409 });
  }

  await db
    .update(schema.users)
    .set({ status: 'active' })
    .where(eq(schema.users.id, targetId));

  await writeAuditLog(actor.id, {
    action: AuditAction.USER_UNBAN,
    targetType: 'user',
    targetId: targetId,
  });

  return NextResponse.json({ ok: true, userId: targetId, status: 'active' });
}
