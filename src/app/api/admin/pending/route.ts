import { NextResponse } from 'next/server';
import { adminGuard } from '@/lib/admin-guard';
import { db, schema } from '@/db';
import { desc, eq, count, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/pending —— 待审核聚合列表
 *
 * 权限：reports.view（moderator / admin）
 * 聚合三类待办：待处理举报、待审批节点申请、被隐藏但未处理的内容
 */
export async function GET(request: Request) {
  const guard = await adminGuard(request, 'reports.view');
  if (guard.response) return guard.response;

  const [reports, nodeRequests, hiddenTopics, hiddenReplies] = await Promise.all([
    db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.status, 'pending'))
      .orderBy(desc(schema.reports.id))
      .limit(50),
    db
      .select()
      .from(schema.nodeRequests)
      .where(eq(schema.nodeRequests.status, 'pending'))
      .orderBy(desc(schema.nodeRequests.id))
      .limit(50),
    // 被隐藏（已软删除）但可能需要复核的内容
    db
      .select({
        id: schema.topics.id,
        title: schema.topics.title,
        deletedAt: schema.topics.deletedAt,
        deletedBy: schema.topics.deletedBy,
      })
      .from(schema.topics)
      .where(sql`${schema.topics.deletedAt} IS NOT NULL`)
      .orderBy(desc(schema.topics.deletedAt))
      .limit(50),
    db
      .select({
        id: schema.replies.id,
        topicId: schema.replies.topicId,
        deletedAt: schema.replies.deletedAt,
        deletedBy: schema.replies.deletedBy,
      })
      .from(schema.replies)
      .where(sql`${schema.replies.deletedAt} IS NOT NULL`)
      .orderBy(desc(schema.replies.deletedAt))
      .limit(50),
  ]);

  const [reportCount, nodeRequestCount] = await Promise.all([
    db.select({ n: count() }).from(schema.reports).where(eq(schema.reports.status, 'pending')),
    db.select({ n: count() }).from(schema.nodeRequests).where(eq(schema.nodeRequests.status, 'pending')),
  ]);

  return NextResponse.json({
    ok: true,
    reports,
    nodeRequests,
    hiddenTopics,
    hiddenReplies,
    totals: {
      pendingReports: Number(reportCount[0]?.n ?? 0),
      pendingNodeRequests: Number(nodeRequestCount[0]?.n ?? 0),
    },
  });
}
