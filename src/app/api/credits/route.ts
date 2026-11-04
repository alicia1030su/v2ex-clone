import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { listLedger, creditAmounts } from '@/lib/credit-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/credits —— 当前用户的积分余额与流水
 *
 * 查询参数：limit（默认 50，最大 200）、offset
 *
 * 响应同时返回当前生效的积分规则配置（便于前端展示"为什么是这个数"）。
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);

  const { total, items } = await listLedger(user.id, {
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  return NextResponse.json({
    ok: true,
    balance: user.balance,
    total,
    ledger: items.map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount,
      balanceBefore: e.balanceBefore,
      balanceAfter: e.balanceAfter,
      refType: e.refType,
      refId: e.refId,
      reason: e.reason,
      createdAt: e.createdAt,
    })),
    // 当前生效的规则（默认值为独立替代实现，非原站确认规则）
    rules: {
      ...creditAmounts(),
      note: '积分数值为本项目独立实现的可配置规则，非原站确认值',
    },
  });
}
