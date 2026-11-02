import { redirect } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser, isStaff } from '@/lib/auth';
import { formatDate } from '@/lib/time';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin?next=%2Fadmin');
  if (!isStaff(user)) redirect('/');

  const stats = await db.execute(sql`
    select
      (select count(*) from topics where status = 'published') as topics,
      (select count(*) from replies) as replies,
      (select count(*) from users) as users,
      (select count(*) from nodes) as nodes,
      (select count(*) from topics where status = 'deleted') as deleted_topics
  `);

  const pendingNodes = await db
    .select()
    .from(schema.nodes)
    .where(eq(schema.nodes.status, 'pending'))
    .orderBy(desc(schema.nodes.createdAt))
    .limit(20);

  const reportedTopics = await db
    .select({
      id: schema.topics.id,
      title: schema.topics.title,
      status: schema.topics.status,
      createdAt: schema.topics.createdAt,
      author: schema.users.username,
    })
    .from(schema.topics)
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .where(sql`${schema.topics.status} <> 'published'`)
    .orderBy(desc(schema.topics.updatedAt))
    .limit(20);

  const logs = await db
    .select({
      id: schema.moderationLogs.id,
      action: schema.moderationLogs.action,
      targetType: schema.moderationLogs.targetType,
      targetId: schema.moderationLogs.targetId,
      reason: schema.moderationLogs.reason,
      createdAt: schema.moderationLogs.createdAt,
      moderator: schema.users.username,
    })
    .from(schema.moderationLogs)
    .innerJoin(schema.users, eq(schema.users.id, schema.moderationLogs.moderatorId))
    .orderBy(desc(schema.moderationLogs.createdAt))
    .limit(20);

  const row = (stats as unknown as { rows: Record<string, number>[] }).rows?.[0] ?? {};

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>管理后台</strong>
            <div className="sep5" />
            <span className="fade">
              {user.role === 'admin' ? '管理员' : '版主'} · {user.username}
            </span>
          </div>
        </div>
      }
    >
      <div className="box">
        <div className="cell">
          <strong>概览</strong>
        </div>
        <div className="cell">
          <table cellPadding={5} cellSpacing={0} border={0} width="100%">
            <tbody>
              <tr>
                <td width={120}>主题</td>
                <td>{Number(row.topics ?? 0)}</td>
                <td width={120}>回复</td>
                <td>{Number(row.replies ?? 0)}</td>
              </tr>
              <tr>
                <td>用户</td>
                <td>{Number(row.users ?? 0)}</td>
                <td>节点</td>
                <td>{Number(row.nodes ?? 0)}</td>
              </tr>
              <tr>
                <td>已删除主题</td>
                <td>{Number(row.deleted_topics ?? 0)}</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="sep20" />
      <div className="box">
        <div className="cell">
          <strong>待审节点</strong>
        </div>
        {pendingNodes.length === 0 ? (
          <div className="cell">
            <span className="fade">没有待审节点</span>
          </div>
        ) : (
          pendingNodes.map((n) => (
            <div key={n.id} className="cell">
              <span className="f12 gray">{formatDate(n.createdAt)}</span>{' '}
              <a href={`/go/${n.name}`}>{n.title}</a>{' '}
              <span className="f12 gray">({n.name})</span>
            </div>
          ))
        )}
      </div>

      <div className="sep20" />
      <div className="box">
        <div className="cell">
          <strong>已隐藏 / 已删除主题</strong>
        </div>
        {reportedTopics.length === 0 ? (
          <div className="cell">
            <span className="fade">没有需要处理的主题</span>
          </div>
        ) : (
          reportedTopics.map((t) => (
            <div key={t.id} className="cell">
              <span className="f12 gray">{formatDate(t.createdAt)}</span>{' '}
              <a href={`/t/${t.id}`}>{t.title}</a>{' '}
              <span className="f12 gray">
                by {t.author} · 状态 {t.status}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="sep20" />
      <div className="box">
        <div className="cell">
          <strong>操作日志</strong>
        </div>
        {logs.length === 0 ? (
          <div className="cell">
            <span className="fade">暂无操作日志</span>
          </div>
        ) : (
          logs.map((l) => (
            <div key={l.id} className="cell">
              <span className="f12 gray">{formatDate(l.createdAt)}</span> {l.moderator}{' '}
              {l.action} {l.targetType}#{l.targetId}
              {l.reason ? <span className="f12 gray"> — {l.reason}</span> : null}
            </div>
          ))
        )}
      </div>
    </Wrapper>
  );
}
