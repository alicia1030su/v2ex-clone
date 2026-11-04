import { NextResponse } from 'next/server';
import { adminGuard } from '@/lib/admin-guard';
import { db, schema } from '@/db';
import { count, eq, gte, isNull, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/stats —— 基础社区统计
 *
 * 权限：config.view（moderator / admin）
 */
export async function GET(request: Request) {
  const guard = await adminGuard(request, 'config.view');
  if (guard.response) return guard.response;

  const dayAgo = new Date(Date.now() - 86400_000);

  const [users, topics, replies, nodes, pendingReports, newUsersToday, newTopicsToday] =
    await Promise.all([
      db.select({ n: count() }).from(schema.users),
      db.select({ n: count() }).from(schema.topics).where(isNull(schema.topics.deletedAt)),
      db.select({ n: count() }).from(schema.replies).where(isNull(schema.replies.deletedAt)),
      db.select({ n: count() }).from(schema.nodes),
      db.select({ n: count() }).from(schema.reports).where(eq(schema.reports.status, 'pending')),
      db.select({ n: count() }).from(schema.users).where(gte(schema.users.createdAt, dayAgo)),
      db.select({ n: count() }).from(schema.topics).where(gte(schema.topics.createdAt, dayAgo)),
    ]);

  return NextResponse.json({
    ok: true,
    totals: {
      users: Number(users[0]?.n ?? 0),
      topics: Number(topics[0]?.n ?? 0),
      replies: Number(replies[0]?.n ?? 0),
      nodes: Number(nodes[0]?.n ?? 0),
      pendingReports: Number(pendingReports[0]?.n ?? 0),
    },
    recent: {
      newUsers24h: Number(newUsersToday[0]?.n ?? 0),
      newTopics24h: Number(newTopicsToday[0]?.n ?? 0),
    },
  });
}
