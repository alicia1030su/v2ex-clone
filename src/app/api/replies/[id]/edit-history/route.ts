import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { listEditHistory } from '@/lib/content-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/repliess/[id]/edit-history —— 编辑历史
 *
 * 仅内容作者本人或 moderator/admin 可查看。
 * 编辑历史包含编辑前后的完整内容快照，属于敏感信息。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ ok: false, error: 'ID 无效' }, { status: 400 });
  }

  const isStaff = user.role === 'moderator' || user.role === 'admin';

  // 确认内容归属
  const table = schema.replies;
  const rows = await db
    .select({ authorId: table.authorId })
    .from(table)
    .where(eq(table.id, targetId))
    .limit(1);

  if (!rows[0]) {
    return NextResponse.json({ ok: false, error: '内容不存在' }, { status: 404 });
  }

  if (!isStaff && rows[0].authorId !== user.id) {
    return NextResponse.json({ ok: false, error: '权限不足' }, { status: 403 });
  }

  const history = await listEditHistory('reply', targetId);
  return NextResponse.json({ ok: true, history });
}
