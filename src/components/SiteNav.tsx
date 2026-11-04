import Link from 'next/link';
import { and, count, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import SearchBox from './SearchBox';
import Logo from './Logo';
import NavTools from './NavTools';

/**
 * 站点顶部导航（v0.0.4）
 *
 * 结构对应原站 `#Top > .content > .site-nav`：
 *   Logo · 搜索框 · 工具区（通知 / 收藏 / 积分 / 关注 / 管理后台 / 用户名 / 设置）
 *
 * ## v0.0.4 修复
 *
 * 原实现对**任何角色**（含 admin / moderator）都不渲染 `/admin` 链接，
 * 管理员只能靠手输 URL 进入后台 —— 是**可达性缺口**，不是权限缺陷。
 * 现在链接定义收敛到 `src/lib/nav-links.ts`，工具区渲染收敛到
 * `src/components/NavTools.tsx`，管理角色会拿到「管理后台」入口。
 *
 * 同时补上**未读通知数角标** —— 此前用户必须点进通知页才知道有没有新消息。
 * 计数由服务端算好传入，首屏即正确、不额外发请求。
 *
 * 鉴权仍然**只在服务端**做（`src/app/admin/page.tsx` + `admin-guard.ts`），
 * 前端加链接不等于放宽权限。
 */
export default async function SiteNav() {
  const user = await getSessionUser();

  // 未读通知数（仅登录用户需要）
  let unreadCount = 0;
  if (user) {
    const rows = await db
      .select({ n: count() })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, user.id),
          eq(schema.notifications.read, false),
        ),
      );
    unreadCount = Number(rows[0]?.n ?? 0);
  }

  return (
    <div id="Top">
      <div className="content">
        <div className="site-nav">
          <Link href="/" title="way to explore">
            <Logo />
          </Link>
          <SearchBox />
          <NavTools
            user={user ? { username: user.username, role: user.role } : null}
            unreadCount={unreadCount}
          />
        </div>
      </div>
    </div>
  );
}
