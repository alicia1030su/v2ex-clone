import 'server-only';
import { db, schema } from '@/db';
import { eq, desc, and, type SQL } from 'drizzle-orm';

/**
 * 管理操作审计日志
 *
 * 所有管理员/版主的敏感操作都必须经过这里落库，
 * 保证「谁、在什么时候、对什么对象、做了什么、为什么」可追溯。
 */

/** 审计动作常量 —— 避免各处手写字符串导致拼写漂移 */
export const AuditAction = {
  // 主题
  //
  // ⚠️ v0.0.5：删除了 `TOPIC_HIDE` / `TOPIC_SHOW` ——
  // 它们**从来没有对应的功能实现**（纯死枚举）。
  // 隐藏内容的实际路径是「举报受理 ⇒ 置 deleted_at」，
  // 记的是 `REPORT_HANDLE`（见 admin/reports/[id]/handle）。
  //
  // 保留未实现的 Action 会造成两个误导：
  //  1. 读代码的人以为「隐藏主题」是个已实现的功能
  //  2. 审计查询里出现永不出现的 action 值
  //
  // 现在有**回归护栏**（tests/v005-security-audit.spec.ts）：
  // 「所有审计 Action 都必须被真正调用」——
  // 将来新增 Action 若忘记实现，测试立刻红。
  TOPIC_EDIT: 'topic.edit',
  TOPIC_DELETE: 'topic.delete',
  TOPIC_RESTORE: 'topic.restore',
  TOPIC_LOCK: 'topic.lock',
  TOPIC_UNLOCK: 'topic.unlock',
  TOPIC_PIN: 'topic.pin',
  TOPIC_UNPIN: 'topic.unpin',
  // 回复
  REPLY_EDIT: 'reply.edit',
  REPLY_DELETE: 'reply.delete',
  REPLY_RESTORE: 'reply.restore',
  // 用户
  USER_BAN: 'user.ban',
  USER_UNBAN: 'user.unban',
  USER_ROLE_CHANGE: 'user.role_change',
  USER_CREDITS_ADJUST: 'user.credits_adjust',
  // 举报与节点
  REPORT_SUBMIT: 'report.submit',
  REPORT_HANDLE: 'report.handle',
  NODE_REQUEST_APPROVE: 'node_request.approve',
  NODE_REQUEST_REJECT: 'node_request.reject',
  // 节点分类（v0.0.14）
  //
  // 分类是结构性配置：改名 / 改排序影响全站节点目录的展示，
  // 禁用（hidden）会让一整组节点从公共页面消失。
  // 因此四个动作都要留痕，且「禁用 / 启用」单独成 action ——
  // 否则审计查询里无法区分「改了标题」与「下架了一整组节点」。
  CATEGORY_CREATE: 'category.create',
  CATEGORY_UPDATE: 'category.update',
  CATEGORY_HIDE: 'category.hide',
  CATEGORY_SHOW: 'category.show',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export type TargetType =
  | 'topic'
  | 'reply'
  | 'user'
  | 'node'
  /** v0.0.14：节点分类（`categories`） */
  | 'category'
  | 'report'
  | 'node_request'
  | 'credits'
  | 'system';

export type AuditEntry = {
  action: AuditActionValue | string;
  targetType: TargetType | string;
  targetId: number;
  reason?: string | null;
};

/**
 * 写入一条审计日志。
 *
 * 注意：**审计写入失败不应中断主业务**（例如目标已被并发删除），
 * 因此这里只捕获异常并记录到控制台，不向上抛。
 * 但对「积分调整」这类资金相关操作，调用方应自行确认写入成功。
 */
export async function writeAuditLog(
  moderatorId: number,
  entry: AuditEntry,
): Promise<void> {
  try {
    await db.insert(schema.moderationLogs).values({
      moderatorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      reason: entry.reason ?? null,
    });
  } catch (err) {
    console.error('[audit] 写入审计日志失败', {
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 批量写入审计日志（同一事务内的多次操作） */
export async function writeAuditLogs(
  moderatorId: number,
  entries: AuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await db.insert(schema.moderationLogs).values(
      entries.map((e) => ({
        moderatorId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        reason: e.reason ?? null,
      })),
    );
  } catch (err) {
    console.error('[audit] 批量写入审计日志失败', err);
  }
}

/** 查询审计日志（分页 + 可选过滤） */
export async function listAuditLogs(opts: {
  limit?: number;
  offset?: number;
  action?: string;
  targetType?: string;
  targetId?: number;
}): Promise<{ total: number; items: Array<{
  id: number;
  moderatorId: number;
  moderatorName: string;
  action: string;
  targetType: string;
  targetId: number;
  reason: string | null;
  createdAt: Date;
}> }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const conditions: SQL[] = [];
  if (opts.action) conditions.push(eq(schema.moderationLogs.action, opts.action));
  if (opts.targetType) conditions.push(eq(schema.moderationLogs.targetType, opts.targetType));
  if (opts.targetId !== undefined) {
    conditions.push(eq(schema.moderationLogs.targetId, opts.targetId));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await db
    .select({
      id: schema.moderationLogs.id,
      moderatorId: schema.moderationLogs.moderatorId,
      moderatorName: schema.users.username,
      action: schema.moderationLogs.action,
      targetType: schema.moderationLogs.targetType,
      targetId: schema.moderationLogs.targetId,
      reason: schema.moderationLogs.reason,
      createdAt: schema.moderationLogs.createdAt,
    })
    .from(schema.moderationLogs)
    .innerJoin(schema.users, eq(schema.users.id, schema.moderationLogs.moderatorId))
    .where(where)
    .orderBy(desc(schema.moderationLogs.id))
    .limit(limit)
    .offset(offset);

  const countRows = await db
    .select({ n: schema.moderationLogs.id })
    .from(schema.moderationLogs)
    .where(where);

  return { total: countRows.length, items };
}
