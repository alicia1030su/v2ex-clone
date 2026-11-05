import { buildNavLinks, type NavUser } from '@/lib/nav-links';

/**
 * 导航栏右侧工具区（v0.0.4）
 *
 * 结构对应原站 `#Top > .content > .site-nav > .tools`：
 * 一组 `<a class="top">` 链接，右对齐。
 *
 * ## 为什么要抽成独立组件
 *
 * 导航链接原本在**五处**各写一遍（SiteNav / settings / go-new / signin /
 * signup / reset-password / StaticPage），导致：
 *   - 管理员入口（`/admin`）加不进去 —— 要改七个地方，漏一个就不生效
 *   - 各页面的登录态导航**不一致**（settings 有「积分」，go/new 没有）
 *
 * 现在链接定义集中在 `src/lib/nav-links.ts`（纯函数，可单测），
 * 渲染集中在本组件 —— 改一处，全站生效。
 *
 * ## 未读通知数
 *
 * `unreadCount` 由**服务端**算好传入（见 `src/components/SiteNav.tsx`）：
 * 服务端已经查过库，不额外发请求，首屏即正确、不会闪烁。
 * 未读数是「通知」链接的角标 —— 让用户知道有未读消息，
 * 而不是必须点进通知页才知道。
 *
 * 注意：本组件**不做鉴权**。能否进入 `/admin` 由服务端
 * `src/app/admin/page.tsx` 的 `isStaff(user)` 判定决定；
 * 导航里没有链接 ≠ 有权限，有链接也 ≠ 绕过鉴权。
 */
export default function NavTools({
  user,
  unreadCount = 0,
}: {
  user: NavUser;
  /** 未读通知数；未登录时忽略 */
  unreadCount?: number;
}) {
  const links = buildNavLinks(user);

  return (
    <div className="tools">
      {links.map((l) => (
        <a key={`${l.href}:${l.label}`} href={l.href} className="top">
          {l.label}
          {l.href === '/notifications' && unreadCount > 0 ? (
            <span className="badge pro" style={{ marginLeft: 4 }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </a>
      ))}
    </div>
  );
}
