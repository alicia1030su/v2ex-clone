import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { relativeTime, fullTimestamp } from '@/lib/time';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin?next=%2Fnotifications');

  const rows = await db
    .select({
      id: schema.notifications.id,
      type: schema.notifications.type,
      message: schema.notifications.message,
      read: schema.notifications.read,
      createdAt: schema.notifications.createdAt,
      topicId: schema.notifications.topicId,
      actorName: schema.users.username,
    })
    .from(schema.notifications)
    .leftJoin(schema.users, eq(schema.users.id, schema.notifications.actorId))
    .where(eq(schema.notifications.userId, user.id))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50);

  const unread = rows.filter((r) => !r.read).length;

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>通知</strong>
            <div className="sep5" />
            <span className="fade">你有 {unread} 条未读通知</span>
          </div>
        </div>
      }
    >
      <div className="box">
        <div className="cell">
          <strong>我的通知</strong>
        </div>
        {rows.length === 0 ? (
          <div className="cell">
            <span className="fade">暂无通知</span>
          </div>
        ) : (
          rows.map((n) => (
            <div key={n.id} className="cell">
              <div className="fr f12 gray" title={fullTimestamp(n.createdAt)}>
                {relativeTime(n.createdAt)}
              </div>
              {n.topicId ? (
                <a href={`/t/${n.topicId}`}>{n.message}</a>
              ) : (
                <span>{n.message}</span>
              )}
              {!n.read ? <span className="badge pro" style={{ marginLeft: 6 }}>新</span> : null}
            </div>
          ))
        )}
      </div>
    </Wrapper>
  );
}
