import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser, isAdmin, isStaff } from '@/lib/auth';
import { rateLimitByUser } from '@/lib/rate-limit';
import { listNodes, listCategories, nodeBreadcrumb } from '@/lib/node-service';

export const dynamic = 'force-dynamic';

const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/**
 * GET /api/nodes —— 节点列表
 *
 * 查询参数：
 *  - categoryId：只取该分类下的节点
 *  - parentId：只取该父节点下的子节点
 *  - includeHidden：staff 可查看被隐藏的节点
 *  - withCategories：同时返回分类列表
 *  - withBreadcrumb=<nodeId>：同时返回某节点的面包屑
 *
 * 响应含每个节点的未删除主题数与最新回复时间（实时统计，不依赖缓存字段）。
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  const isStaffUser = isStaff(user);

  const url = new URL(request.url);
  const categoryIdParam = url.searchParams.get('categoryId');
  const parentIdParam = url.searchParams.get('parentId');
  const breadcrumbParam = url.searchParams.get('withBreadcrumb');

  const categoryId =
    categoryIdParam !== null && categoryIdParam !== ''
      ? Number(categoryIdParam)
      : undefined;
  const parentId =
    parentIdParam !== null && parentIdParam !== ''
      ? Number(parentIdParam)
      : undefined;

  if (categoryId !== undefined && !Number.isInteger(categoryId)) {
    return NextResponse.json({ ok: false, error: '分类 ID 无效' }, { status: 400 });
  }
  if (parentId !== undefined && !Number.isInteger(parentId)) {
    return NextResponse.json({ ok: false, error: '父节点 ID 无效' }, { status: 400 });
  }

  // ⚠️ limit / offset 必须从查询串读取并传给服务层。
  // v0.0.3 的服务层 listNodes 支持这两个参数，但路由**从未传递**，
  // 导致 ?limit=3 仍然返回全部节点（实测返回 23 条）——
  // 分页形同虚设。服务层的钳制（1..500）在此生效。
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const limit = limitParam !== null && limitParam !== '' ? Number(limitParam) : undefined;
  const offset = offsetParam !== null && offsetParam !== '' ? Number(offsetParam) : undefined;
  if (limit !== undefined && !Number.isFinite(limit)) {
    return NextResponse.json({ ok: false, error: 'limit 无效' }, { status: 400 });
  }
  if (offset !== undefined && !Number.isFinite(offset)) {
    return NextResponse.json({ ok: false, error: 'offset 无效' }, { status: 400 });
  }

  const nodes = await listNodes({
    categoryId,
    parentId,
    includeHidden: isStaffUser && url.searchParams.get('includeHidden') === 'true',
    limit,
    offset,
  });

  const result: Record<string, unknown> = { ok: true, nodes };

  if (url.searchParams.get('withCategories') === 'true') {
    result.categories = await listCategories();
  }

  if (breadcrumbParam) {
    const bid = Number(breadcrumbParam);
    if (Number.isInteger(bid) && bid > 0) {
      result.breadcrumb = await nodeBreadcrumb(bid);
    }
  }

  // 节点列表变动不频繁，给 60 秒缓存
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' },
  });
}

/** 创建节点：管理员直接生效；版主创建后进入待审 */
export async function POST(request: Request) {
  // CSRF 校验：写操作必须携带与 Cookie 匹配的 token
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }
  if (!isStaff(user)) {
    return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 });
  }

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
    return NextResponse.json({ ok: false, error: '节点标题长度需在 2-128 之间' }, { status: 400 });
  }
  if (categoryId != null) {
    const cat = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.id, categoryId))
      .limit(1);
    if (!cat.length) {
      return NextResponse.json({ ok: false, error: '分类不存在' }, { status: 400 });
    }
  }

  // 重名检查放在限流之前：重复名请求不应消耗限流配额
  const existing = await db
    .select({ id: schema.nodes.id })
    .from(schema.nodes)
    .where(eq(schema.nodes.name, name))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ ok: false, error: '该节点名已被占用' }, { status: 409 });
  }

  const limit = await rateLimitByUser(
    'create_node',
    user.id,
    Number(process.env.RATE_LIMIT_CREATE_NODE_MAX ?? 10),
    Number(process.env.RATE_LIMIT_CREATE_NODE_WINDOW_SECONDS ?? 60),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `操作过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429 },
    );
  }

  const status = isAdmin(user) ? 'active' : 'pending';

  const [row] = await db
    .insert(schema.nodes)
    .values({
      name,
      title,
      description,
      categoryId,
      status,
      createdBy: user.id,
    })
    .returning({ id: schema.nodes.id, name: schema.nodes.name });

  await db.insert(schema.moderationLogs).values({
    moderatorId: user.id,
    action: status === 'active' ? 'node.create' : 'node.create_pending',
    targetType: 'node',
    targetId: row.id,
    reason: `创建节点 ${row.name}`,
  });

  return NextResponse.json(
    { ok: true, id: row.id, name: row.name, status, redirect: `/go/${row.name}` },
    { status: 201 },
  );
}

/** 审核节点：仅管理员 */
export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 });
  }

  // ⚠️ v0.0.4 修复真实安全缺陷：**PATCH 此前完全没有 CSRF 校验**。
  //
  //   同一个文件的 POST（创建节点）有 guardCsrf，但 PATCH（隐藏/恢复节点）
  //   漏掉了 —— 而 PATCH 是**写操作**且能改变全站可见性。
  //   攻击者只要诱导已登录的管理员访问一个恶意页面，
  //   就能用跨站请求把节点批量隐藏掉。
  //
  //   校验顺序与 adminGuard 一致：**先判角色（401/403），再判 CSRF（403）**，
  //   避免向未授权调用方泄露「端点存在但缺 token」这类信息。
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const body = (await request.json().catch(() => null)) as {
    id?: number;
    action?: 'approve' | 'hide' | 'activate';
    reason?: string;
  } | null;

  const id = Number(body?.id ?? 0);
  const action = body?.action;
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: '节点 ID 无效' }, { status: 400 });
  }

  const statusMap = {
    approve: 'active',
    activate: 'active',
    hide: 'hidden',
  } as const;
  const nextStatus = action ? statusMap[action] : undefined;
  if (!nextStatus) {
    return NextResponse.json({ ok: false, error: '未知操作' }, { status: 400 });
  }

  const target = await db
    .select({ id: schema.nodes.id, name: schema.nodes.name })
    .from(schema.nodes)
    .where(eq(schema.nodes.id, id))
    .limit(1);
  if (!target.length) {
    return NextResponse.json({ ok: false, error: '节点不存在' }, { status: 404 });
  }

  await db
    .update(schema.nodes)
    .set({ status: nextStatus })
    .where(eq(schema.nodes.id, id));

  await db.insert(schema.moderationLogs).values({
    moderatorId: user.id,
    action: `node.${action}`,
    targetType: 'node',
    targetId: id,
    reason: body?.reason ?? null,
  });

  return NextResponse.json({ ok: true, status: nextStatus });
}
