import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq, desc } from 'drizzle-orm';
import { rateLimitByUser } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/**
 * POST /api/node-requests —— 申请创建节点
 *
 * 普通用户可申请；申请进入 node_requests 表 status=pending，
 * 由 moderator/admin 在后台审批。**申请不会直接创建节点。**
 *
 * 已存在的节点名直接拒绝（不进入审批队列）。
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    title?: string;
    description?: string;
    categoryId?: number;
  } | null;

  const name = (body?.name ?? '').trim().toLowerCase();
  const title = (body?.title ?? '').trim();
  const description = (body?.description ?? '').trim().slice(0, 2000);
  const categoryId = Number(body?.categoryId ?? 0) || null;

  if (!NAME_RE.test(name)) {
    return NextResponse.json(
      { ok: false, error: '节点名只能包含小写字母、数字、下划线和短横线，长度 2-32' },
      { status: 400 },
    );
  }
  if (title.length < 2 || title.length > 128) {
    return NextResponse.json(
      { ok: false, error: '节点标题长度需在 2-128 之间' },
      { status: 400 },
    );
  }

  // 重名检查：已存在的节点不需要申请
  const existing = await db
    .select({ id: schema.nodes.id })
    .from(schema.nodes)
    .where(eq(schema.nodes.name, name))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ ok: false, error: '该节点名已存在' }, { status: 409 });
  }

  // 同一用户对同一节点名只能有一条待审申请
  const pending = await db
    .select({ id: schema.nodeRequests.id })
    .from(schema.nodeRequests)
    .where(eq(schema.nodeRequests.requesterId, user.id))
    .limit(50);
  if (pending.some((r) => r.id > 0)) {
    // 进一步按名称+状态检查
    const all = await db
      .select({ name: schema.nodeRequests.name, status: schema.nodeRequests.status })
      .from(schema.nodeRequests)
      .where(eq(schema.nodeRequests.requesterId, user.id));
    if (all.some((r) => r.name === name && r.status === 'pending')) {
      return NextResponse.json(
        { ok: false, error: '该节点申请已在审核中' },
        { status: 409 },
      );
    }
  }

  const limit = await rateLimitByUser(
    'node_request',
    user.id,
    Number(process.env.RATE_LIMIT_NODE_REQUEST_MAX ?? 5),
    Number(process.env.RATE_LIMIT_NODE_REQUEST_WINDOW_SECONDS ?? 86400),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `申请过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const rows = await db
    .insert(schema.nodeRequests)
    .values({
      name,
      title,
      description: description || null,
      categoryId,
      requesterId: user.id,
      status: 'pending',
    })
    .returning({ id: schema.nodeRequests.id });

  return NextResponse.json({
    ok: true,
    requestId: rows[0].id,
    message: '节点申请已提交，等待管理员审核',
  });
}

/**
 * GET /api/node-requests —— 我提交的申请列表
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(schema.nodeRequests)
    .where(eq(schema.nodeRequests.requesterId, user.id))
    .orderBy(desc(schema.nodeRequests.id))
    .limit(50);

  return NextResponse.json({ ok: true, requests: rows });
}
