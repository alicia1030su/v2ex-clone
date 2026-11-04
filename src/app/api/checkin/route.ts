import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq, and, desc, sql } from 'drizzle-orm';
import { grantCredits, creditAmounts } from '@/lib/credit-service';
import { rateLimitByUser } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** 取 UTC 日期字符串 YYYY-MM-DD */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * POST /api/checkin —— 每日签到
 *
 * 幂等：daily_checkins 表 (user_id, checkin_date) 唯一索引，
 * 同一天重复签到**不会重复发放积分**（返回已签到状态）。
 *
 * 连续签到：查询该用户上一次签到日期，若为昨天则 streak +1，否则重置为 1。
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  // 限流：即使重复签到也不应消耗过多配额，但需要防止高频请求刷接口
  const limit = await rateLimitByUser(
    'checkin',
    user.id,
    Number(process.env.RATE_LIMIT_CHECKIN_MAX ?? 20),
    Number(process.env.RATE_LIMIT_CHECKIN_WINDOW_SECONDS ?? 3600),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `签到请求过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const today = todayUtc();
  const amounts = creditAmounts();

  // 先查是否已签到（幂等检查）
  const existing = await db
    .select()
    .from(schema.dailyCheckins)
    .where(
      and(
        eq(schema.dailyCheckins.userId, user.id),
        eq(schema.dailyCheckins.checkinDate, today),
      ),
    )
    .limit(1);

  if (existing[0]) {
    return NextResponse.json({
      ok: true,
      alreadyCheckedIn: true,
      reward: 0,
      streak: existing[0].streak,
      balance: user.balance,
      message: `今天已经签到过了（连续 ${existing[0].streak} 天）`,
    });
  }

  // 计算连续签到天数
  const recent = await db
    .select()
    .from(schema.dailyCheckins)
    .where(eq(schema.dailyCheckins.userId, user.id))
    .orderBy(desc(schema.dailyCheckins.checkinDate))
    .limit(1);

  let streak = 1;
  if (recent[0]) {
    const last = new Date(`${recent[0].checkinDate}T00:00:00Z`).getTime();
    const now = new Date(`${today}T00:00:00Z`).getTime();
    const dayDiff = Math.round((now - last) / 86400_000);
    if (dayDiff === 1) {
      streak = recent[0].streak + 1;
    }
  }

  // 连续签到额外奖励（有上限）
  const bonus =
    streak > 1 ? Math.min(amounts.streakBonus, amounts.streakBonusMax) : 0;
  const reward = amounts.checkin + bonus;

  // 写入签到记录（唯一索引兜底并发）
  const inserted = await db
    .insert(schema.dailyCheckins)
    .values({ userId: user.id, checkinDate: today, reward, streak })
    .onConflictDoNothing()
    .returning({ id: schema.dailyCheckins.id });

  if (inserted.length === 0) {
    // 并发下别人先签到了
    const now = await db
      .select()
      .from(schema.dailyCheckins)
      .where(
        and(
          eq(schema.dailyCheckins.userId, user.id),
          eq(schema.dailyCheckins.checkinDate, today),
        ),
      )
      .limit(1);
    return NextResponse.json({
      ok: true,
      alreadyCheckedIn: true,
      reward: 0,
      streak: now[0]?.streak ?? 1,
      balance: user.balance,
      message: '今天已经签到过了',
    });
  }

  // 发放积分（幂等键保证重复请求不重复发放）
  const result = await grantCredits(user.id, {
    type: 'daily_checkin',
    amount: reward,
    idempotencyKey: `daily_checkin:${user.id}:${today}`,
    refType: 'checkin',
    refId: inserted[0].id,
  });

  return NextResponse.json({
    ok: true,
    alreadyCheckedIn: false,
    reward,
    streak,
    balance: result.balance,
    message: `签到成功，获得 ${reward} 积分（连续 ${streak} 天）`,
  });
}

/**
 * GET /api/checkin —— 查询签到状态
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const today = todayUtc();
  const rows = await db
    .select()
    .from(schema.dailyCheckins)
    .where(eq(schema.dailyCheckins.userId, user.id))
    .orderBy(desc(schema.dailyCheckins.checkinDate))
    .limit(30);

  const todayRow = rows.find((r) => r.checkinDate === today);
  const streak = todayRow?.streak ?? 0;

  return NextResponse.json({
    ok: true,
    checkedInToday: !!todayRow,
    streak,
    today,
    reward: todayRow?.reward ?? 0,
    recent: rows,
  });
}
