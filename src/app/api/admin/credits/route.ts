import { NextResponse } from 'next/server';
import { adminGuardWrite } from '@/lib/admin-guard';
import { adminAdjustCredits } from '@/lib/credit-service';
import { writeAuditLog, AuditAction } from '@/lib/audit';
import { guardCommunityAction } from '@/lib/community-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/credits —— 管理员调整用户积分（v0.0.5 新增）
 *
 * body: { userId: number, amount: number（非零整数，正=加负=减）, reason: string（≥2 字） }
 *
 * 权限：`credits.adjust`（**仅 admin** —— moderator 不能动积分）
 *
 * ## 为什么这个端点必须存在
 *
 * `src/lib/credit-service.ts` 的 `adminAdjustCredits()` **早已完整实现**
 * （FOR UPDATE 行锁 + 余额不足拒绝 + 只 INSERT 的 `credit_ledger` 账本 +
 *  `balanceBefore`/`balanceAfter` 快照），`src/lib/permissions.ts` 也有
 * `credits.adjust` 权限项 —— 但**没有任何调用方、没有 API、没有 UI**，
 * 导致 `FEATURE_MATRIX.md` 里「管理员调整积分及审计 ✅」是**不实标注**。
 *
 * 本端点把这条链路接上：service → API → UI → 审计。
 *
 * ## 安全设计
 *
 * - `adminGuardWrite`：先校验 `credits.adjust` 权限，再做 CSRF 校验
 * - 理由必填（≥2 字）—— 积分是敏感资产，无理由操作不允许
 * - 扣减受「余额不足拒绝」约束（service 层 `InsufficientCreditsError`）
 * - 调整结果写**不可篡改账本**（`credit_ledger` 只 INSERT）
 * - 另写 `AuditAction.USER_CREDITS_ADJUST` 审计日志
 *   —— 该枚举早已定义但此前无人触发，本端点让它真正生效
 */
export async function POST(request: Request) {
  const guard = await adminGuardWrite(request, 'credits.adjust');
  if (guard.response) return guard.response;
  // v0.0.5：管理动作频率限制 —— 防脚本批量滥用（封号 / 改角色 / 调积分…）
  const rl = await guardCommunityAction('admin_action', guard.user?.id ?? null);
  if (rl) return rl;
  const actor = guard.user;

  const body = (await request.json().catch(() => null)) as {
    userId?: unknown;
    amount?: unknown;
    reason?: unknown;
  } | null;

  const userId = Number(body?.userId ?? 0);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ ok: false, error: '用户 ID 无效' }, { status: 400 });
  }

  const amount = Number(body?.amount ?? 0);
  if (!Number.isInteger(amount) || amount === 0) {
    return NextResponse.json({ ok: false, error: '调整数额必须是非零整数' }, { status: 400 });
  }
  // 防止极端值（单次调整上限 100 万，避免误输入造成不可逆后果）
  if (Math.abs(amount) > 1_000_000) {
    return NextResponse.json({ ok: false, error: '单次调整数额不能超过 1,000,000' }, { status: 400 });
  }

  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 2 || reason.length > 200) {
    return NextResponse.json({ ok: false, error: '调整理由长度需在 2-200 之间' }, { status: 400 });
  }

  try {
    const result = await adminAdjustCredits(actor, userId, amount, reason);

    await writeAuditLog(actor.id, {
      action: AuditAction.USER_CREDITS_ADJUST,
      targetType: 'user',
      targetId: userId,
      reason: `${amount > 0 ? '+' : ''}${amount}：${reason}`,
    });

    return NextResponse.json({
      ok: true,
      userId,
      amount,
      balance: result.balance,
      balanceBefore: result.balanceBefore,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '调整失败';
    // 余额不足 / 用户不存在 → 400；其余 500
    const status = /余额不足|用户不存在/.test(msg) ? 400 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
