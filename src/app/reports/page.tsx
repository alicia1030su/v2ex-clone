import { redirect } from 'next/navigation';
import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { relativeTime } from '@/lib/time';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

/** 举报状态的中文标签 */
const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  accepted: '已受理',
  rejected: '未违规',
};

/** 举报目标类型的中文标签 */
const TARGET_LABEL: Record<string, string> = {
  topic: '主题',
  reply: '回复',
  user: '用户',
};

/**
 * 我的举报（v0.0.5 新增）
 *
 * 这是「用户可见的处理反馈」的载体：举报提交后，用户在这里看到
 *   - 举报的是什么（目标标题，不泄露他人隐私）
 *   - 处理状态（待处理 / 已受理 / 未违规）
 *   - 处理备注（handleNote，moderator/admin 填写）
 *
 * **隐私边界**：
 *   - 只查 `reporterId = 当前用户`，绝不返回他人举报
 *   - **不显示处理人 ID 与用户名** —— 避免举报者骚扰/报复处理人
 *   - 不显示被举报者的任何信息
 *
 * 查询策略：先取举报记录，再**按目标类型分别**取标题
 * （不用 `leftJoin(topics, eq(topics.id, reports.targetId))` ——
 *   那会把 reply 目标错配到同 id 的 topic 上）。
 */
export default async function MyReportsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin?next=%2Freports');

  const rows = await db
    .select({
      id: schema.reports.id,
      targetType: schema.reports.targetType,
      targetId: schema.reports.targetId,
      reason: schema.reports.reason,
      detail: schema.reports.detail,
      status: schema.reports.status,
      handleNote: schema.reports.handleNote,
      handledAt: schema.reports.handledAt,
      createdAt: schema.reports.createdAt,
    })
    .from(schema.reports)
    .where(eq(schema.reports.reporterId, user.id))
    .orderBy(desc(schema.reports.id))
    .limit(100);

  // ── 按目标类型分别取标题 ───────────────────────────────────────
  const topicIds = rows.filter((r) => r.targetType === 'topic').map((r) => r.targetId);
  const replyIds = rows.filter((r) => r.targetType === 'reply').map((r) => r.targetId);

  const topicTitles = new Map<number, string>();
  if (topicIds.length > 0) {
    const t = await db
      .select({ id: schema.topics.id, title: schema.topics.title })
      .from(schema.topics)
      .where(inArray(schema.topics.id, topicIds));
    for (const row of t) topicTitles.set(row.id, row.title);
  }

  /** replyId → 所属主题标题 */
  const replyTopicTitles = new Map<number, string>();
  if (replyIds.length > 0) {
    const r = await db
      .select({ id: schema.replies.id, topicId: schema.replies.topicId })
      .from(schema.replies)
      .where(inArray(schema.replies.id, replyIds));
    const topicIdsOfReplies = [...new Set(r.map((x) => x.topicId))];
    if (topicIdsOfReplies.length > 0) {
      const t = await db
        .select({ id: schema.topics.id, title: schema.topics.title })
        .from(schema.topics)
        .where(inArray(schema.topics.id, topicIdsOfReplies));
      const byTopic = new Map(t.map((x) => [x.id, x.title]));
      for (const row of r) replyTopicTitles.set(row.id, byTopic.get(row.topicId) ?? '');
    }
  }

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>我的举报</strong>
            <div className="sep5" />
            <span className="fade">共 {rows.length} 条</span>
            <div className="sep5" />
            <span className="fade">
              举报处理由管理员与版主执行。为保护处理人，这里不显示处理人信息。
            </span>
          </div>
        </div>
      }
    >
      <div className="box">
        <div className="cell">
          <strong>我的举报</strong>
        </div>
        {rows.length === 0 ? (
          <div className="cell">
            <span className="fade">还没有提交过举报</span>
          </div>
        ) : (
          rows.map((r) => {
            const targetLabel =
              r.targetType === 'topic'
                ? (topicTitles.get(r.targetId) ?? `主题 #${r.targetId}`)
                : r.targetType === 'reply'
                  ? `《${replyTopicTitles.get(r.targetId) || `#${r.targetId}`}》中的回复`
                  : `用户 #${r.targetId}`;
            return (
              <div key={r.id} className="cell">
                <div className="fr f12 gray">{relativeTime(r.createdAt)}</div>
                <div>
                  <span className="fade">[{TARGET_LABEL[r.targetType] ?? r.targetType}]</span>{' '}
                  {targetLabel}
                </div>
                <div className="sep3">
                  <span className="fade">原因：{r.reason}</span>
                  {r.detail ? <span className="fade"> · {r.detail}</span> : null}
                </div>
                <div className="sep3">
                  <span
                    className="f12"
                    style={{
                      color:
                        r.status === 'accepted'
                          ? '#070'
                          : r.status === 'rejected'
                            ? '#666'
                            : '#a60',
                    }}
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  {r.handleNote ? (
                    <span className="f12 fade"> · 处理备注：{r.handleNote}</span>
                  ) : null}
                  {r.handledAt ? (
                    <span className="f12 fade"> · {relativeTime(r.handledAt)}</span>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Wrapper>
  );
}
