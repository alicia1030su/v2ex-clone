import { redirect } from 'next/navigation';
import { and, count, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import Wrapper from '@/components/Wrapper';
import NotificationsList from '@/components/NotificationsList';

export const dynamic = 'force-dynamic';

/**
 * 通知页（v0.0.3）
 *
 * 服务端只做两件事：
 *  1. 鉴权（未登录 → 跳转登录页）
 *  2. 统计未读数，用于侧栏展示
 *
 * 列表本身由客户端组件 `NotificationsList` 通过
 * `GET /api/notifications` 拉取 —— 因为还需要
 * 「标记已读 / 删除单条 / 全部已读 / 清空」这些写操作与分页，
 * 整块交给客户端组件可以避免整页刷新。
 */
export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin?next=%2Fnotifications');

  const unreadRows = await db
    .select({ n: count() })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, user.id),
        eq(schema.notifications.read, false),
      ),
    );
  const unread = Number(unreadRows[0]?.n ?? 0);

  const totalRows = await db
    .select({ n: count() })
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, user.id));
  const total = Number(totalRows[0]?.n ?? 0);

  // 侧栏「最近的通知」——最新 5 条（服务端直查，保证首屏有内容）
  const recentRows = await db
    .select({
      id: schema.notifications.id,
      message: schema.notifications.message,
      read: schema.notifications.read,
      createdAt: schema.notifications.createdAt,
      topicId: schema.notifications.topicId,
    })
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, user.id))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(5);

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>通知</strong>
            <div className="sep5" />
            <span className="fade">
              共 {total} 条，你有 {unread} 条未读通知
            </span>
          </div>
          {recentRows.length > 0 ? (
            <div className="cell">
              <strong>最新</strong>
              <div className="sep5" />
              {recentRows.map((n) => (
                <div key={n.id} className="f12 gray">
                  {n.topicId ? (
                    <a href={`/t/${n.topicId}`}>{n.message}</a>
                  ) : (
                    <span>{n.message}</span>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      }
    >
      <div className="box">
        <div className="cell">
          <strong>我的通知</strong>
        </div>
        <NotificationsList />
      </div>
    </Wrapper>
  );
}
