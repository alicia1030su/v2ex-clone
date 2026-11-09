import { NextResponse } from 'next/server';
import { adminGuard, adminGuardWrite } from '@/lib/admin-guard';
import { guardCommunityAction } from '@/lib/community-rate-limit';
import { writeAuditLog, AuditAction } from '@/lib/audit';
import {
  CategoryError,
  createCategory,
  listAllCategories,
  toCategoryDto,
} from '@/server/categories';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/categories —— 分类列表（含已禁用）+ 各分类节点数
 * POST /api/admin/categories —— 新建分类
 *
 * ## 权限
 *
 * | 方法 | 权限                 | 允许角色            |
 * |------|----------------------|---------------------|
 * | GET  | `categories.view`    | moderator / admin   |
 * | POST | `categories.manage`  | **仅 admin**        |
 *
 * 角色判定**只在** `src/lib/permissions.ts` 的矩阵里 ——
 * 本文件不得出现 `role === 'admin'` 这类手写判断，
 * 否则「某个接口忘了校验」的风险就回来了（`adminGuard*` 是唯一入口）。
 *
 * ## 为什么没有 DELETE
 *
 * 分类被 `nodes.category_id` 外键引用。删分类会让节点失去归属
 * （或直接外键冲突）。「下架一个分类」的正确语义是 `hidden = true`：
 * 数据保留、节点归属保留、公共页面不展示。
 *
 * ## 响应字段白名单
 *
 * 只回显 `id / name / title / sort / hidden / updatedAt`（见 `toCategoryDto`）。
 */

export async function GET(request: Request) {
  const guard = await adminGuard(request, 'categories.view');
  if (guard.response) return guard.response;

  const categories = await listAllCategories();

  return NextResponse.json({
    ok: true,
    // nodesCount 是聚合计数（非敏感），后台列表需要它来判断「这个分类下还有没有节点」
    categories: categories.map((c) => ({ ...toCategoryDto(c), nodesCount: c.nodesCount })),
  });
}

export async function POST(request: Request) {
  const guard = await adminGuardWrite(request, 'categories.manage');
  if (guard.response) return guard.response;
  // 管理动作频率限制 —— 防脚本批量创建分类（与其它 admin 写端点一致）
  const rl = await guardCommunityAction('admin_action', guard.user.id);
  if (rl) return rl;
  const actor = guard.user;

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    title?: unknown;
    sort?: unknown;
  } | null;

  try {
    const category = await createCategory({
      name: body?.name,
      title: body?.title,
      sort: body?.sort,
    });

    await writeAuditLog(actor.id, {
      action: AuditAction.CATEGORY_CREATE,
      targetType: 'category',
      targetId: category.id,
      reason: `创建分类 ${category.name}（${category.title}）`,
    });

    return NextResponse.json({ ok: true, category: toCategoryDto(category) }, { status: 201 });
  } catch (err) {
    return categoryErrorResponse(err, '创建分类失败');
  }
}

/**
 * 把服务层错误统一转成 HTTP 响应。
 *
 * **不静默**：`CategoryError` 的 `message` 是给管理员看的具体原因
 * （如「分类名 xxx 已存在」），原样回显；未知错误才降级为通用文案，
 * 并附带真实错误信息，避免后台出现「操作失败」却查不到原因。
 */
function categoryErrorResponse(err: unknown, fallback: string): NextResponse {
  if (err instanceof CategoryError) {
    return NextResponse.json(
      { ok: false, error: err.message, code: err.code },
      { status: err.status },
    );
  }
  const detail = err instanceof Error ? err.message : String(err);
  console.error('[admin/categories] 未预期错误', { fallback, detail });
  return NextResponse.json({ ok: false, error: `${fallback}：${detail}` }, { status: 500 });
}
