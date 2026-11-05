import 'server-only';
import { NextResponse } from 'next/server';
import { rateLimit, rateLimitByUser, rateLimitByIp } from './rate-limit';

/**
 * 社区动作的频率限制（v0.0.5）
 *
 * ## 为什么需要这个模块
 *
 * v0.0.5 安全审计发现：**12 个用户可触发的写端点完全没有限流**：
 *
 * | 端点 | 动作 |
 * |---|---|
 * | `POST /api/collections` | 收藏 |
 * | `POST /api/votes` | 投票 |
 * | `POST /api/users/follows` | 关注 / 取关 |
 * | `PATCH /api/settings/profile` | 改资料 |
 * | `PATCH|DELETE /api/topics/[id]` | 编辑 / 删除主题 |
 * | `PATCH|DELETE /api/replies/[id]` | 编辑 / 删除回复 |
 *
 * 发帖 / 回复 / 签到 / 举报 / 节点申请 已有独立限流，
 * 但上面这些「轻量写操作」**一个都没有** ——
 * 意味着登录用户可以用脚本在**几秒内**刷几十万次投票 / 关注 / 收藏，
 * 造成数据库压力与数据污染（且这些操作都会写积分 / 通知）。
 *
 * ## 设计原则
 *
 * 1. **按用户 + 按 IP 双维度** —— 只按用户挡不住多账号，只按 IP 挡不住 NAT 后的正常用户
 * 2. **阈值可配** —— 全部走 `process.env`，带合理默认值
 * 3. **失败要明确** —— 返回 429 + `Retry-After` 头
 * 4. **不因限流而静默成功** —— 用户必须知道被限流了
 */

/** 各动作的默认阈值（每分钟） */
export const COMMUNITY_ACTION_LIMITS = {
  /** 投票 */
  vote: { max: 60, windowSeconds: 60 },
  /** 感谢 */
  thanks: { max: 60, windowSeconds: 60 },
  /** 收藏 */
  collection: { max: 60, windowSeconds: 60 },
  /** 关注 / 取关 */
  follow: { max: 30, windowSeconds: 60 },
  /** 编辑 / 删除主题 */
  topic_mutation: { max: 20, windowSeconds: 60 },
  /** 编辑 / 删除回复 */
  reply_mutation: { max: 30, windowSeconds: 60 },
  /** 修改个人资料 */
  profile_update: { max: 10, windowSeconds: 300 },
  /** 管理动作（锁定 / 置顶 / 恢复） */
  moderation: { max: 60, windowSeconds: 60 },
  /** 通知已读 */
  notification: { max: 120, windowSeconds: 60 },
  /** 退出登录 */
  signout: { max: 30, windowSeconds: 60 },
  /**
   * 管理动作（封禁 / 改角色 / 调积分 / 审核举报 / 审批节点）
   *
   * 管理端也需要限流 —— 否则一个被盗的管理员会话
   * （或脚本）可以在几秒内封掉整个社区的账号。
   */
  admin_action: { max: 60, windowSeconds: 60 },
} as const;

export type CommunityAction = keyof typeof COMMUNITY_ACTION_LIMITS;

/**
 * 对一次社区动作做频率限制检查。
 *
 * @param action 动作名（决定阈值）
 * @param userId 当前用户 ID（未登录传 null）
 * @param customIdentifier 自定义限流标识（可选）。
 *   用于「拿不到 userId 但有别的稳定标识」的场景 ——
 *   例如退出登录接口用 `sessionId`（此时会话即将销毁，不宜再查库取 userId）。
 *   传入后**取代** userId 作为用户维度的标识。
 * @returns 429 响应；未超限则返回 null
 */
export async function guardCommunityAction(
  action: CommunityAction,
  userId: number | null,
  customIdentifier?: string,
): Promise<NextResponse | null> {
  const cfg = COMMUNITY_ACTION_LIMITS[action];

  // 阈值允许用 env 覆盖（运营调参不必改代码）
  const max = Number(
    process.env[`RATE_LIMIT_${action.toUpperCase()}_MAX`] ?? cfg.max,
  );
  const windowSeconds = Number(
    process.env[`RATE_LIMIT_${action.toUpperCase()}_WINDOW_SECONDS`] ??
      cfg.windowSeconds,
  );

  // ── 用户维度 ──
  if (customIdentifier) {
    // 自定义标识（如 sessionId）—— 走通用 rateLimit
    const byCustom = await rateLimit(
      `community_${action}`,
      customIdentifier,
      max,
      windowSeconds,
    );
    if (!byCustom.ok) {
      return tooManyRequests(byCustom.retryAfterSeconds, action, '会话');
    }
  } else if (userId !== null) {
    const byUser = await rateLimitByUser(
      `community_${action}`,
      userId,
      max,
      windowSeconds,
    );
    if (!byUser.ok) {
      return tooManyRequests(byUser.retryAfterSeconds, action, '用户');
    }
  }

  // ── IP 维度（对未登录动作同样生效）──
  const byIp = await rateLimitByIp(
    `community_${action}_ip`,
    // IP 阈值放宽到用户的 3 倍 —— 正常用户很少共享 IP，
    // 但办公室 / 校园网这类 NAT 环境不该被误伤。
    max * 3,
    windowSeconds,
  );
  if (!byIp.ok) {
    return tooManyRequests(byIp.retryAfterSeconds, action, 'IP');
  }

  return null;
}

/** 构造 429 响应 */
function tooManyRequests(
  retryAfterSeconds: number,
  action: string,
  dimension: string,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: `操作过于频繁，请 ${retryAfterSeconds} 秒后再试`,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
        'X-RateLimit-Action': action,
        'X-RateLimit-Dimension': dimension,
      },
    },
  );
}
