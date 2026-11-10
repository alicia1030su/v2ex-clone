import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import Wrapper from '@/components/Wrapper';
import NotificationsList from '@/components/NotificationsList';
import { listNotificationsForUser, listRecentNotifications } from '@/server/notifications';

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

  // v0.0.15 P0-1：统计与侧栏都必须走**同一个可见性判据**。
  //
  // 修复前这里直接查 `notifications` 表（三处各自写 SQL），于是：
  //   · 节点被 hidden / 主题被软删除后，未读数仍然把它们算进去；
  //   · 右栏「最新」会继续显示隐藏节点的主题标题 ——
  //     即使列表本身修好了，右栏也是一条独立的泄露路径。
  //
  // 现在三个数字（total / unread / recent）与列表共用
  // `src/server/notifications.ts` 的 join + where，口径不可能漂移。
  const { total, unread } = await listNotificationsForUser(user.id, { limit: 1 });
  const recentRows = await listRecentNotifications(user.id, 5);

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
