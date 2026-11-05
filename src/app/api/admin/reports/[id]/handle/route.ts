import { NextResponse } from 'next/server';
import { adminGuardWrite } from '@/lib/admin-guard';
import { db, schema } from '@/db';
import { eq, isNull } from 'drizzle-orm';
import { writeAuditLog, AuditAction } from '@/lib/audit';
import { guardCommunityAction } from '@/lib/community-rate-limit';

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
  // v0.0.5：管理动作频率限制 —— 防脚本批量滥用（封号 / 改角色 / 调积分…）
  const rl = await guardCommunityAction('admin_action', guard.user?.id ?? null);
  if (rl) return rl;
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

  // ── v0.0.5：通知举报者「你的举报有结果了」──────────────────────
  //
  // 这是「用户可见的处理反馈」的最后一环。要点：
  //   * 通知发给**举报人**（report.reporterId），不是被举报者
  //   * `type: 'system'`（schema 早已定义，此前从未写入）
  //   * **绝不透露处理人身份**（actor.id 不入 message）——
  //     避免举报者骚扰或报复处理人
  //   * 消息只说结果与（若有）备注，不暴露被处理内容的细节
  //
  // 放在事务外：通知失败不应让处理回滚（处理本身已成功落库）。
  try {
    await db.insert(schema.notifications).values({
      userId: report.reporterId,
      type: 'system',
      actorId: null,
      topicId: report.targetType === 'topic' ? report.targetId : null,
      replyId: report.targetType === 'reply' ? report.targetId : null,
      message:
        action === 'accept'
          ? `你举报的内容已被处理${note ? `（${note}）` : ''}`
          : `你举报的内容经审核未违规${note ? `（${note}）` : ''}`,
    });
  } catch {
    // 通知失败不影响处理结果 —— 静默降级（管理端已可见处理状态）
  }

  await writeAuditLog(actor.id, {
    action: AuditAction.REPORT_HANDLE,
    targetType: 'report',
    targetId: reportId,
    reason: note ?? `${action}（目标：${report.targetType}#${report.targetId}）`,
  });

  return NextResponse.json({ ok: true, reportId, status: action === 'accept' ? 'accepted' : 'rejected' });
}
