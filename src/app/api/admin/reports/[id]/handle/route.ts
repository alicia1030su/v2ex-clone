import { NextResponse } from 'next/server';
import { adminGuardWrite } from '@/lib/admin-guard';
import { db, schema } from '@/db';
import { eq, isNull } from 'drizzle-orm';
import { writeAuditLog, AuditAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/reports/[id]/handle —— 处理举报
 *
 * body: { action: 'accept' | 'reject', note?: string }
 *
 * 权限：reports.handle（moderator / admin）
 * 接受举报时按目标类型隐藏内容（设 deleted_at）。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await adminGuardWrite(request, 'reports.handle');
  if (guard.response) return guard.response;
  const actor = guard.user;

  const { id } = await params;
  const reportId = Number(id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return NextResponse.json({ ok: false, error: '举报 ID 无效' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    action?: string;
    note?: string;
  } | null;
  const action = String(body?.action ?? '');
  if (action !== 'accept' && action !== 'reject') {
    return NextResponse.json({ ok: false, error: 'action 必须是 accept 或 reject' }, { status: 400 });
  }
  const note = body?.note?.trim() ?? null;

  const rows = await db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .limit(1);
  const report = rows[0];
  if (!report) {
    return NextResponse.json({ ok: false, error: '举报不存在' }, { status: 404 });
  }
  if (report.status !== 'pending') {
    return NextResponse.json({ ok: false, error: '该举报已处理' }, { status: 409 });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.reports)
      .set({
        status: action === 'accept' ? 'accepted' : 'rejected',
        handledBy: actor.id,
        handledAt: new Date(),
        handleNote: note,
      })
      .where(eq(schema.reports.id, reportId));

    // 接受举报 → 隐藏对应内容
    if (action === 'accept') {
      if (report.targetType === 'topic') {
        await tx
          .update(schema.topics)
          .set({
            status: 'deleted',
            deletedAt: new Date(),
            deletedBy: actor.id,
            deletedReason: `举报处理：${report.reason}`,
          })
          .where(eq(schema.topics.id, report.targetId));
      } else if (report.targetType === 'reply') {
        await tx
          .update(schema.replies)
          .set({
            deletedAt: new Date(),
            deletedBy: actor.id,
            deletedReason: `举报处理：${report.reason}`,
          })
          .where(eq(schema.replies.id, report.targetId));
      }
    }
  });

  await writeAuditLog(actor.id, {
    action: AuditAction.REPORT_HANDLE,
    targetType: 'report',
    targetId: reportId,
    reason: note ?? `${action}（目标：${report.targetType}#${report.targetId}）`,
  });

  return NextResponse.json({ ok: true, reportId, status: action === 'accept' ? 'accepted' : 'rejected' });
}
