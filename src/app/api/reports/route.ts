import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { isReportReason, REPORT_REASONS } from '@/lib/report-reasons';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { rateLimitByUser } from '@/lib/rate-limit';
import { writeAuditLog, AuditAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** 补充说明最大长度 */
const DETAIL_MAX = 500;

/**
 * POST /api/reports —— 用户提交举报（v0.0.5 新增）
 *
 * body: { targetType: 'topic' | 'reply' | 'user', targetId: number,
 *         reason: string（REPORT_REASONS 之一）, detail?: string }
 *
 * 权限：登录用户。**不能举报自己的内容。**
 *
 * 防护：
 *   - CSRF（guardCsrf）
 *   - 限流（默认 10 次 / 小时，可用 RATE_LIMIT_REPORT_* 覆盖）
 *   - 防重复：`reports_reporter_target_uidx` 部分唯一索引
 *     （同一用户 + 同一目标 + status='pending'）—— 冲突返回 409
 *   - 目标必须存在且未被删除
 *   - reason 必须是固定列表之一（见 REPORT_REASONS）
 *
 * 隐私：举报人身份**只**对 moderator / admin 可见（GET /api/admin/reports）。
 *       本端点与「我的举报」列表绝不返回他人的举报记录。
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as {
    targetType?: unknown;
    targetId?: unknown;
    reason?: unknown;
    detail?: unknown;
  } | null;

  const targetType = String(body?.targetType ?? '');
  if (targetType !== 'topic' && targetType !== 'reply' && targetType !== 'user') {
    return NextResponse.json(
      { ok: false, error: 'targetType 必须是 topic、reply 或 user' },
      { status: 400 },
    );
  }

  const targetId = Number(body?.targetId ?? 0);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ ok: false, error: '举报目标 ID 无效' }, { status: 400 });
  }

  const reason = body?.reason;
  if (!isReportReason(reason)) {
    return NextResponse.json(
      { ok: false, error: `举报原因无效，必须是：${REPORT_REASONS.join('、')}` },
      { status: 400 },
    );
  }

  const detail = typeof body?.detail === 'string' ? body.detail.trim().slice(0, DETAIL_MAX) : '';
  if (detail.length > DETAIL_MAX) {
    return NextResponse.json(
      { ok: false, error: `补充说明最长 ${DETAIL_MAX} 字` },
      { status: 400 },
    );
  }

  // ── 目标必须存在，且不能举报自己的内容 ──────────────────────────
  if (targetType === 'topic') {
    const rows = await db
      .select({ id: schema.topics.id, authorId: schema.topics.authorId })
      .from(schema.topics)
      .where(eq(schema.topics.id, targetId))
      .limit(1);
    const target = rows[0];
    if (!target) {
      return NextResponse.json({ ok: false, error: '主题不存在' }, { status: 404 });
    }
    if (target.authorId === user.id) {
      return NextResponse.json({ ok: false, error: '不能举报自己的内容' }, { status: 400 });
    }
  } else if (targetType === 'reply') {
    const rows = await db
      .select({ id: schema.replies.id, authorId: schema.replies.authorId })
      .from(schema.replies)
      .where(eq(schema.replies.id, targetId))
      .limit(1);
    const target = rows[0];
    if (!target) {
      return NextResponse.json({ ok: false, error: '回复不存在' }, { status: 404 });
    }
    if (target.authorId === user.id) {
      return NextResponse.json({ ok: false, error: '不能举报自己的内容' }, { status: 400 });
    }
  } else {
    const rows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, targetId))
      .limit(1);
    if (!rows[0]) {
      return NextResponse.json({ ok: false, error: '用户不存在' }, { status: 404 });
    }
    if (targetId === user.id) {
      return NextResponse.json({ ok: false, error: '不能举报自己' }, { status: 400 });
    }
  }

  // ── 限流：防恶意刷举报 ────────────────────────────────────────
  const limit = await rateLimitByUser(
    'report',
    user.id,
    Number(process.env.RATE_LIMIT_REPORT_MAX ?? 10),
    Number(process.env.RATE_LIMIT_REPORT_WINDOW_SECONDS ?? 3600),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `举报过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  // ── 写入（防重复由部分唯一索引保证）────────────────────────────
  let reportId: number;
  try {
    const rows = await db
      .insert(schema.reports)
      .values({
        targetType,
        targetId,
        reporterId: user.id,
        reason,
        detail: detail || null,
        status: 'pending',
      })
      .returning({ id: schema.reports.id });
    reportId = rows[0].id;
  } catch (err) {
    // 唯一索引冲突（23505）= 已有一条进行中的举报
    const pgCode = (err as { code?: string } | null)?.code;
    if (pgCode === '23505') {
      return NextResponse.json(
        { ok: false, error: '你已举报过该内容，正在处理中' },
        { status: 409 },
      );
    }
    throw err;
  }

  // 举报提交也落审计（可追溯「谁举报了什么」——
  // 处理端另有 AuditAction.REPORT_HANDLE，两者构成完整链路）
  await writeAuditLog(user.id, {
    action: AuditAction.REPORT_SUBMIT,
    targetType: 'report',
    targetId: reportId,
    reason: `${targetType}#${targetId}：${reason}`,
  });

  return NextResponse.json({
    ok: true,
    reportId,
    message: '举报已提交，管理员会尽快处理',
  });
}

/**
 * GET /api/reports —— 我的举报列表
 *
 * 只返回**当前登录用户自己**的举报（绝不返回他人的）——
 * 这是「举报者身份不泄露」的第一道防线。
 *
 * 返回内容含 status 与 handleNote（处理备注），
 * 即「用户可见的处理反馈」。**不含处理人 ID 与处理人用户名。**
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20) || 20, 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const rows = await db
    .select({
      id: schema.reports.id,
      targetType: schema.reports.targetType,
      targetId: schema.reports.targetId,
      reason: schema.reports.reason,
      detail: schema.reports.detail,
      status: schema.reports.status,
      handleNote: schema.reports.handleNote,
      handledAt: schema.reports.handledAt,
      createdAt: schema.reports.createdAt,
    })
    .from(schema.reports)
    .where(eq(schema.reports.reporterId, user.id))
    .orderBy(desc(schema.reports.id))
    .limit(limit)
    .offset(offset);

  const totalRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.reports)
    .where(eq(schema.reports.reporterId, user.id));

  // 附带目标标题（让用户知道举报的是哪条）—— 只查自己的举报指向的目标，
  // 不泄露任何他人信息。
  const topicIds = rows.filter((r) => r.targetType === 'topic').map((r) => r.targetId);
  const replyIds = rows.filter((r) => r.targetType === 'reply').map((r) => r.targetId);

  const topicTitles = new Map<number, string>();
  if (topicIds.length > 0) {
    const t = await db
      .select({ id: schema.topics.id, title: schema.topics.title })
      .from(schema.topics)
      .where(inArray(schema.topics.id, topicIds));
    for (const row of t) topicTitles.set(row.id, row.title);
  }

  const replySnippets = new Map<number, string>();
  if (replyIds.length > 0) {
    const r = await db
      .select({
        id: schema.replies.id,
        content: schema.replies.content,
        topicId: schema.replies.topicId,
      })
      .from(schema.replies)
      .where(inArray(schema.replies.id, replyIds));
    for (const row of r) {
      const title = topicTitles.get(row.topicId);
      replySnippets.set(
        row.id,
        (title ? `《${title}》中的回复` : `主题 #${row.topicId} 中的回复`) +
          `：${row.content.slice(0, 40)}${row.content.length > 40 ? '…' : ''}`,
      );
    }
  }

  const items = rows.map((r) => ({
    ...r,
    targetLabel:
      r.targetType === 'topic'
        ? (topicTitles.get(r.targetId) ?? `主题 #${r.targetId}`)
        : r.targetType === 'reply'
          ? (replySnippets.get(r.targetId) ?? `回复 #${r.targetId}`)
          : `用户 #${r.targetId}`,
  }));

  return NextResponse.json({
    ok: true,
    total: Number(totalRows[0]?.n ?? 0),
    reports: items,
  });
}
