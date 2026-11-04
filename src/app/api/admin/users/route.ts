import { NextResponse } from 'next/server';
import { adminGuard } from '@/lib/admin-guard';
import { db, schema } from '@/db';
import { desc, eq, or, ilike, and, count, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/users —— 用户列表与搜索
 *
 * 权限：users.view（moderator / admin）
 * 查询参数：q（用户名或邮箱模糊搜索）、role、status、limit、offset
 */
export async function GET(request: Request) {
  const guard = await adminGuard(request, 'users.view');
  if (guard.response) return guard.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const role = url.searchParams.get('role') ?? '';
  const status = url.searchParams.get('status') ?? '';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const conditions = [];
  if (q) {
    // 参数化模糊查询 —— 用户输入不会拼进 SQL
    conditions.push(
      or(ilike(schema.users.username, `%${q}%`), ilike(schema.users.email, `%${q}%`)),
    );
  }
  if (role === 'user' || role === 'moderator' || role === 'admin') {
    conditions.push(eq(schema.users.role, role));
  }
  if (status === 'active' || status === 'suspended' || status === 'banned') {
    conditions.push(eq(schema.users.status, status));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      email: schema.users.email,
      avatar: schema.users.avatar,
      role: schema.users.role,
      status: schema.users.status,
      balance: schema.users.balance,
      createdAt: schema.users.createdAt,
      lastActiveAt: schema.users.lastActiveAt,
    })
    .from(schema.users)
    .where(where)
    .orderBy(desc(schema.users.id))
    .limit(limit)
    .offset(offset);

  const totalRows = await db
    .select({ n: count() })
    .from(schema.users)
    .where(where);

  return NextResponse.json({
    ok: true,
    total: Number(totalRows[0]?.n ?? 0),
    users: items,
  });
}
