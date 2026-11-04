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
  TOPIC_EDIT: 'topic.edit',
  TOPIC_DELETE: 'topic.delete',
  TOPIC_RESTORE: 'topic.restore',
  TOPIC_LOCK: 'topic.lock',
  TOPIC_UNLOCK: 'topic.unlock',
  TOPIC_PIN: 'topic.pin',
  TOPIC_UNPIN: 'topic.unpin',
  TOPIC_HIDE: 'topic.hide',
  TOPIC_SHOW: 'topic.show',
  // 回复
  REPLY_EDIT: 'reply.edit',
  REPLY_DELETE: 'reply.delete',
  REPLY_RESTORE: 'reply.restore',
  REPLY_HIDE: 'reply.hide',
  REPLY_SHOW: 'reply.show',
  // 用户
  USER_BAN: 'user.ban',
  USER_UNBAN: 'user.unban',
  USER_ROLE_CHANGE: 'user.role_change',
  USER_CREDITS_ADJUST: 'user.credits_adjust',
  // 举报与节点
  REPORT_HANDLE: 'report.handle',
  NODE_REQUEST_APPROVE: 'node_request.approve',
  NODE_REQUEST_REJECT: 'node_request.reject',
  NODE_HIDE: 'node.hide',
  NODE_SHOW: 'node.show',
  // 内容
  CONTENT_HIDE: 'content.hide',
  CONTENT_SHOW: 'content.show',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export type TargetType =
  | 'topic'
  | 'reply'
  | 'user'
  | 'node'
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
