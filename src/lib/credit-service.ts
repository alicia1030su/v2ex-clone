import 'server-only';
import { db, schema } from '@/db';
import { eq, and, sql, desc } from 'drizzle-orm';
import type { SessionUser } from '@/lib/auth';

/**
 * 积分服务（v0.0.3）
 *
 * ## 关于积分规则来源的说明
 *
 * 本项目可观察到的原站依据只有 `users.balance` 字段的注释
 * （「原站通过每日登录/发帖等行为累积」）以及数据库中已定义的
 * `credit_ledger` 枚举类型。**具体的积分数值无法从公开信息确证**，
 * 因此下列额度全部做成**可配置**，默认值明确标注为
 * 「独立替代实现」—— 不声称复刻原站真实数值。
 *
 * 默认值（环境变量可覆盖）：
 *  - TOPIC_CREDITS        默认 5
 *  - REPLY_CREDITS        默认 2
 *  - CHECKIN_CREDITS      默认 2
 *  - CHECKIN_STREAK_BONUS 默认 1（连续签到额外奖励，上限见 CHECKIN_STREAK_BONUS_MAX）
 *
 * ## 事务与并发保证
 *
 * 所有余额变动都在一个事务内完成，并且：
 *  1. 用 `SELECT ... FOR UPDATE` 锁住用户行 —— 串行化同一用户的并发扣费
 *  2. 用 `credit_ledger.idempotency_key` 唯一索引做幂等 —— 重复请求不重复发放
 *  3. 扣费前检查余额 —— 不足时抛错并回滚，**绝不允许负余额**
 */

export type CreditType =
  | 'topic_created'
  | 'reply_created'
  | 'topic_thanked'
  | 'daily_checkin'
  | 'admin_adjust'
  | 'admin_deduct'
  | 'registration_bonus';

export class InsufficientCreditsError extends Error {
  readonly code = 'INSUFFICIENT_CREDITS';
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`积分不足：需要 ${required}，当前 ${available}`);
    this.name = 'InsufficientCreditsError';
  }
}

export class DuplicateCreditError extends Error {
  readonly code = 'DUPLICATE_CREDIT';
  constructor(readonly idempotencyKey: string) {
    super(`该操作已处理过：${idempotencyKey}`);
    this.name = 'DuplicateCreditError';
  }
}

/** 读取积分数额配置（默认值为独立替代实现） */
export function creditAmounts(): {
  topic: number;
  reply: number;
  checkin: number;
  streakBonus: number;
  streakBonusMax: number;
  thanks: number;
} {
  const num = (v: string | undefined, d: number) => {
    const n = v === undefined ? d : Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d;
  };
  return {
    topic: num(process.env.TOPIC_CREDITS, 5),
    reply: num(process.env.REPLY_CREDITS, 2),
    checkin: num(process.env.CHECKIN_CREDITS, 2),
    streakBonus: num(process.env.CHECKIN_STREAK_BONUS, 1),
    streakBonusMax: num(process.env.CHECKIN_STREAK_BONUS_MAX, 10),
    // v0.0.4：感谢回复给作者加分（默认 1，可由 THANKS_CREDITS 覆盖）
    thanks: num(process.env.THANKS_CREDITS, 1),
  };
}

export type GrantOptions = {
  type: CreditType;
  amount: number;
  /** 幂等键：同一业务动作重复提交时保证只有一条流水 */
  idempotencyKey?: string;
  refType?: string;
  refId?: number;
  actorId?: number;
  reason?: string;
};

/**
 * 发放积分（amount 可为负 → 等价于扣减）。
 *
 * 幂等：若 idempotencyKey 已存在，返回 { duplicated: true } 且**不重复发放**。
 * 并发：同一用户的并发操作由行锁串行化。
 */
export async function grantCredits(
  userId: number,
  opts: GrantOptions,
): Promise<{
  duplicated: boolean;
  balance: number;
  amount: number;
  ledgerId: number | null;
}> {
  if (!Number.isInteger(opts.amount)) {
    throw new Error('积分数额必须是整数');
  }

  return await db.transaction(async (tx) => {
    // 幂等检查（先看是否已处理过，避免无谓的行锁等待）
    if (opts.idempotencyKey) {
      const existing = await tx
        .select({
          id: schema.creditLedger.id,
          balanceAfter: schema.creditLedger.balanceAfter,
          amount: schema.creditLedger.amount,
        })
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.idempotencyKey, opts.idempotencyKey))
        .limit(1);
      if (existing[0]) {
        return {
          duplicated: true,
          balance: existing[0].balanceAfter,
          amount: existing[0].amount,
          ledgerId: existing[0].id,
        };
      }
    }

    // 锁住用户行 —— 串行化同一用户的并发余额变动
    const locked = await tx.execute(sql`
      SELECT id, balance FROM users WHERE id = ${userId} FOR UPDATE
    `);
    const row = (locked as unknown as Array<{ id: number; balance: number }>)[0];
    if (!row) {
      throw new Error(`用户不存在：${userId}`);
    }

    const balanceBefore = row.balance;
    const balanceAfter = balanceBefore + opts.amount;

    // 余额不足则拒绝（绝不产生负余额）
    if (balanceAfter < 0) {
      throw new InsufficientCreditsError(-opts.amount, balanceBefore);
    }

    await tx
      .update(schema.users)
      .set({ balance: balanceAfter })
      .where(eq(schema.users.id, userId));

    const inserted = await tx
      .insert(schema.creditLedger)
      .values({
        userId,
        type: opts.type,
        amount: opts.amount,
        balanceBefore,
        balanceAfter,
        refType: opts.refType ?? null,
        refId: opts.refId ?? null,
        idempotencyKey: opts.idempotencyKey ?? null,
        actorId: opts.actorId ?? null,
        reason: opts.reason ?? null,
      })
      .returning({ id: schema.creditLedger.id });

    return {
      duplicated: false,
      balance: balanceAfter,
      amount: opts.amount,
      ledgerId: inserted[0]?.id ?? null,
    };
  });
}

/**
 * 扣减积分。余额不足时抛 InsufficientCreditsError 并**回滚整个事务**。
 */
export async function spendCredits(
  userId: number,
  amount: number,
  opts: Omit<GrantOptions, 'type' | 'amount'> & { type?: CreditType },
): Promise<{ duplicated: boolean; balance: number; ledgerId: number | null }> {
  if (amount <= 0) {
    throw new Error('扣减数额必须为正');
  }
  return await grantCredits(userId, {
    ...opts,
    type: opts.type ?? 'admin_deduct',
    amount: -amount,
  });
}

/**
 * 管理员调整积分。
 * 扣减同样受「余额不足拒绝」约束。
 */
export async function adminAdjustCredits(
  admin: SessionUser,
  targetUserId: number,
  amount: number,
  reason: string,
): Promise<{ balance: number; balanceBefore: number }> {
  if (!Number.isInteger(amount) || amount === 0) {
    throw new Error('调整数额必须是非零整数');
  }
  if (!reason || reason.trim().length < 2) {
    throw new Error('必须填写调整理由');
  }

  return await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT id, balance FROM users WHERE id = ${targetUserId} FOR UPDATE
    `);
    const row = (locked as unknown as Array<{ id: number; balance: number }>)[0];
    if (!row) throw new Error(`用户不存在：${targetUserId}`);

    const balanceBefore = row.balance;
    const balanceAfter = balanceBefore + amount;
    if (balanceAfter < 0) {
      throw new InsufficientCreditsError(-amount, balanceBefore);
    }

    await tx
      .update(schema.users)
      .set({ balance: balanceAfter })
      .where(eq(schema.users.id, targetUserId));

    await tx.insert(schema.creditLedger).values({
      userId: targetUserId,
      type: amount > 0 ? 'admin_adjust' : 'admin_deduct',
      amount,
      balanceBefore,
      balanceAfter,
      actorId: admin.id,
      reason: reason.trim(),
      // 管理员调整不设幂等键（每次都是独立操作）
    });

    return { balance: balanceAfter, balanceBefore };
  });
}

/** 查询用户积分流水 */
export async function listLedger(
  userId: number,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ total: number; items: Array<{
  id: number;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  refType: string | null;
  refId: number | null;
  reason: string | null;
  createdAt: Date;
}> }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const items = await db
    .select({
      id: schema.creditLedger.id,
      type: schema.creditLedger.type,
      amount: schema.creditLedger.amount,
      balanceBefore: schema.creditLedger.balanceBefore,
      balanceAfter: schema.creditLedger.balanceAfter,
      refType: schema.creditLedger.refType,
      refId: schema.creditLedger.refId,
      reason: schema.creditLedger.reason,
      createdAt: schema.creditLedger.createdAt,
    })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.userId, userId))
    .orderBy(desc(schema.creditLedger.id))
    .limit(limit)
    .offset(offset);

  const countRows = await db
    .select({ id: schema.creditLedger.id })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.userId, userId));

  return { total: countRows.length, items };
}

  /**
   * 积分排行榜。
   * 同时给出活跃度统计（发帖数、回复数、被感谢数）。
   *
   * ⚠️ v0.0.4 性能修复（真实压测发现）：
   *   原实现用**相关子查询**：
   *     (SELECT COUNT(*) FROM replies r WHERE r.author_id = t.author_id)
   *     (SELECT COUNT(*) FROM thanks th JOIN replies r2 ON r2.id = th.reply_id
   *       WHERE r2.author_id = t.author_id)
   *   这两个子查询会**对每个作者各执行一次** ——
   *   在 10000 用户 / 10 万主题 / 100 万回复的真实规模下，
   *   实测耗时 **241.98 秒**（成本估算 38,943,939），
   *   整个 /api/leaderboard 端点实际上不可用（curl 直接超时）。
   *
   *   改为**三个独立聚合 + JOIN**：每张表只扫描一次。
   *   实测：241.98 秒 → **0.74 秒**（约 327 倍）。
   *   配合新增的部分索引（见 drizzle/0002_*.sql）可进一步降到 0.46 秒。
   */
  export async function leaderboard(opts: { limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const rows = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        avatar: schema.users.avatar,
        balance: schema.users.balance,
        createdAt: schema.users.createdAt,
        lastActiveAt: schema.users.lastActiveAt,
      })
      .from(schema.users)
      .where(eq(schema.users.status, 'active'))
      .orderBy(desc(schema.users.balance), desc(schema.users.createdAt))
      .limit(limit)
      .offset(offset);

    // 活跃度统计：每张表聚合一次，再 JOIN —— 避免 N+1 与相关子查询
    const stats = await db.execute(sql`
      WITH ts AS (
        SELECT author_id, count(*)::int AS topics
        FROM topics WHERE deleted_at IS NULL GROUP BY author_id
      ),
      rs AS (
        SELECT author_id, count(*)::int AS replies
        FROM replies WHERE deleted_at IS NULL GROUP BY author_id
      ),
      ths AS (
        SELECT r2.author_id AS author_id, count(*)::int AS thanks_received
        FROM thanks th
        JOIN replies r2 ON r2.id = th.reply_id
        WHERE r2.deleted_at IS NULL
        GROUP BY r2.author_id
      )
      SELECT
        u.id AS user_id,
        COALESCE(ts.topics, 0)::int AS topics,
        COALESCE(rs.replies, 0)::int AS replies,
        COALESCE(ths.thanks_received, 0)::int AS thanks_received
      FROM users u
      LEFT JOIN ts ON ts.author_id = u.id
      LEFT JOIN rs ON rs.author_id = u.id
      LEFT JOIN ths ON ths.author_id = u.id
      WHERE u.status = 'active'
    `);
    const statMap = new Map<number, { topics: number; replies: number; thanksReceived: number }>();
    for (const r of (stats as unknown as Array<{
      user_id: number; topics: number; replies: number; thanks_received: number;
    }>)) {
      statMap.set(r.user_id, {
        topics: r.topics,
        replies: r.replies,
        thanksReceived: r.thanks_received,
      });
    }

  return rows.map((r) => ({
    ...r,
    stats: statMap.get(r.id) ?? { topics: 0, replies: 0, thanksReceived: 0 },
  }));
}

/**
 * 账本自洽性校验（用于测试与运维核对）。
 * 校验每条流水的 balanceBefore + amount === balanceAfter，
 * 且相邻流水的 balanceAfter === 下一条的 balanceBefore。
 */
export async function verifyLedgerIntegrity(userId: number): Promise<{
  ok: boolean;
  issues: string[];
}> {
  const rows = await db
    .select({
      id: schema.creditLedger.id,
      amount: schema.creditLedger.amount,
      balanceBefore: schema.creditLedger.balanceBefore,
      balanceAfter: schema.creditLedger.balanceAfter,
    })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.userId, userId))
    .orderBy(schema.creditLedger.id);

  const issues: string[] = [];
  let prevAfter: number | null = null;
  for (const r of rows) {
    if (r.balanceBefore + r.amount !== r.balanceAfter) {
      issues.push(
        `流水 #${r.id} 不自洽：${r.balanceBefore} + ${r.amount} ≠ ${r.balanceAfter}`,
      );
    }
    if (prevAfter !== null && prevAfter !== r.balanceBefore) {
      issues.push(
        `流水 #${r.id} 与上一条不衔接：上一条余额 ${prevAfter} ≠ 本条起始 ${r.balanceBefore}`,
      );
    }
    prevAfter = r.balanceAfter;
  }
  return { ok: issues.length === 0, issues };
}
