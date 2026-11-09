import { NextResponse } from 'next/server';
import { adminGuardWrite } from '@/lib/admin-guard';
import { guardCommunityAction } from '@/lib/community-rate-limit';
import { writeAuditLog, AuditAction } from '@/lib/audit';
import { CategoryError, getCategoryById, toCategoryDto, updateCategory } from '@/server/categories';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/categories/[id] —— 更新分类（title / sort / hidden）
 *
 * ## 权限
 *
 * `categories.manage`（**仅 admin**），经 `adminGuardWrite` 校验
 * —— 它同时包含 CSRF 校验，因此这里**不再手写** CSRF。
 *
 * ## 为什么只有 PATCH，没有 DELETE
 *
 * 「下架分类」= `hidden: true`。删行会让 `nodes.category_id` 指向不存在的分类
 * （外键冲突或节点失去归属）。禁用既保数据又保归属，且可一键恢复。
 *
 * ## 审计动作的选择
 *
 * `hidden` 的真假会改变全站展示，因此单独记 `CATEGORY_HIDE` / `CATEGORY_SHOW`；
 * 只改标题或排序记 `CATEGORY_UPDATE` —— 三者语义不同，不能混成一条。
 *
 * ## 响应字段白名单
 *
 * 只回显 `id / name / title / sort / hidden / updatedAt`。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await adminGuardWrite(request, 'categories.manage');
  if (guard.response) return guard.response;
  const rl = await guardCommunityAction('admin_action', guard.user.id);
  if (rl) return rl;
  const actor = guard.user;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    sort?: unknown;
    hidden?: unknown;
  } | null;

  try {
    const before = await snapshot(id);
    const category = await updateCategory(id, {
      title: body?.title,
      sort: body?.sort,
      hidden: body?.hidden,
    });

    const action =
      body?.hidden === true
        ? AuditAction.CATEGORY_HIDE
        : body?.hidden === false
          ? AuditAction.CATEGORY_SHOW
          : AuditAction.CATEGORY_UPDATE;

    await writeAuditLog(actor.id, {
      action,
      targetType: 'category',
      targetId: category.id,
      reason: describeChange(before, category),
    });

    return NextResponse.json({ ok: true, category: toCategoryDto(category) });
  } catch (err) {
    return categoryErrorResponse(err, '更新分类失败');
  }
}

/** 变更前的快照（用于生成可读的审计原因；读取失败不阻断主流程） */
async function snapshot(
  id: string,
): Promise<{ title: string; sort: number; hidden: boolean } | null> {
  try {
    const row = await getCategoryById(id);
    return row ? { title: row.title, sort: row.sort, hidden: row.hidden } : null;
  } catch {
    // 非法 id 等情况下快照拿不到 —— 审计原因退化成「无字段变化」不影响主流程
    return null;
  }
}

/** 生成审计原因：只列出**实际变化**的字段，便于事后追溯 */
function describeChange(
  before: { title: string; sort: number; hidden: boolean } | null,
  after: { name: string; title: string; sort: number; hidden: boolean },
): string {
  const parts: string[] = [];
  if (before) {
    if (before.title !== after.title) parts.push(`标题「${before.title}」→「${after.title}」`);
    if (before.sort !== after.sort) parts.push(`排序 ${before.sort} → ${after.sort}`);
    if (before.hidden !== after.hidden) parts.push(after.hidden ? '禁用该分类' : '启用该分类');
  }
  if (parts.length === 0) parts.push('无字段变化');
  return `分类 ${after.name}：${parts.join('；')}`;
}

/** 与服务层一致的错误映射（见 `src/app/api/admin/categories/route.ts` 的同名函数） */
function categoryErrorResponse(err: unknown, fallback: string): NextResponse {
  if (err instanceof CategoryError) {
    return NextResponse.json(
      { ok: false, error: err.message, code: err.code },
      { status: err.status },
    );
  }
  const detail = err instanceof Error ? err.message : String(err);
  console.error('[admin/categories/[id]] 未预期错误', { fallback, detail });
  return NextResponse.json({ ok: false, error: `${fallback}：${detail}` }, { status: 500 });
}
