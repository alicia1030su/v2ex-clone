/**
 * 顶部导航链接定义（v0.0.4）
 *
 * ## 为什么要有这个模块
 *
 * v0.0.4 之前，导航栏的链接在**五处各写一遍**：
 *   - `src/components/SiteNav.tsx`（绝大多数页面经 Wrapper 使用）
 *   - `src/app/settings/page.tsx`、`src/app/go/new/page.tsx`（登录态自绘导航）
 *   - `src/app/signin`、`src/app/signup`、`src/app/reset-password`、
 *     `src/components/StaticPage.tsx`（游客态导航）
 *
 * 后果是 **「管理员在导航栏看不到后台入口」** 这个真实缺陷：
 * 没有任何一处渲染 `/admin` 链接，管理员只能靠手输 URL 进入后台。
 * 补链接时如果继续在多处各写一遍，下次改导航就会再次漏掉。
 *
 * 因此这里把链接定义收敛到**单一事实来源**：
 *   - `buildNavLinks(user)` —— 按登录态与角色生成链接数组（纯数据，可单测）
 *   - `src/components/NavTools.tsx` —— 负责渲染成 `<div class="tools">`
 *
 * ## 权限红线
 *
 * **导航栏里出现 `/admin` 链接 ≠ 放宽权限。**
 * 后台的真正鉴权在服务端：
 *   - `src/app/admin/page.tsx` 的 `isStaff(user)` 判定（游客 → /signin，非 staff → /）
 *   - `src/lib/admin-guard.ts` 的 `adminGuard` / `adminGuardWrite`（每个接口再校验一次）
 *
 * 导航链接只解决「可达性」—— 让**有权限的人找得到入口**；
 * 不在导航里出现链接的人**依然拿不到任何权限**。
 */

/** 导航链接 */
export type NavLink = {
  href: string;
  /** 链接文字 */
  label: string;
};

/**
 * 参与导航渲染的用户信息。
 *
 * 只取需要的字段，避免把整个 SessionUser 传给客户端组件。
 */
export type NavUser =
  | {
      username: string;
      role: 'user' | 'moderator' | 'admin';
    }
  | null;

/** 是否为管理角色（moderator / admin）—— 与 `src/lib/auth.ts` 的 isStaff 保持一致 */
export function isStaffRole(user: NavUser): boolean {
  return user?.role === 'admin' || user?.role === 'moderator';
}

/**
 * 全局内容入口（v0.0.14）：热门 / 最新
 *
 * ## 为什么要有这一项
 *
 * `/hot` 与 `/recent` 两个页面**早已实现**（热门排序 / 时间倒序），
 * 但全站没有任何链接指向它们 —— 只能靠手输 URL 进入，属于「孤儿页」。
 * 对比 v0.0.4 的 `/admin` 入口缺失，是同一类缺陷：
 * **页面存在 ≠ 用户可达**。
 *
 * ## 为什么抽成共享常量而不是在两个分支里各写一遍
 *
 * 游客与登录用户都要看到这两个入口。若各写一遍，
 * 下次调整（改文案 / 改路径 / 加第三个入口）就会漏掉一处 ——
 * 这正是本模块（单一事实来源）要消除的问题。
 * 抽成常量后，`/hot` 与 `/recent` 在本文件里**各只出现一次**。
 *
 * ## 为什么放在「首页」之后
 *
 * 热门 / 最新是**全局内容视图**，与「首页」同级；
 * 而通知 / 收藏 / 关注 / 设置属于用户自己的工具区。
 * 把内容入口混进工具区会让导航的语义层次消失。
 */
const CONTENT_LINKS: readonly NavLink[] = [
  { href: '/hot', label: '热门' },
  { href: '/recent', label: '最新' },
];

/**
 * 生成导航链接列表。
 *
 * 游客：首页 / 热门 / 最新 / 注册 / 登录
 * 登录用户：首页 / 热门 / 最新 / 通知 / 收藏 / 积分 / 关注 / 我的举报
 *           / [管理后台] / 用户名 / 设置
 *
 * @param user 当前登录用户；null 表示游客
 */
export function buildNavLinks(user: NavUser): NavLink[] {
  if (!user) {
    return [
      { href: '/', label: '首页' },
      ...CONTENT_LINKS,
      { href: '/signup', label: '注册' },
      { href: '/signin', label: '登录' },
    ];
  }

  const links: NavLink[] = [
    { href: '/', label: '首页' },
    ...CONTENT_LINKS,
    { href: '/notifications', label: '通知' },
    { href: '/bookmarks', label: '收藏' },
    { href: '/leaderboard', label: '积分' },
    // 关注动态：已关注用户发布的主题（后端 GET /api/users/follows/topics）
    { href: '/following', label: '关注' },
    // v0.0.5：我的举报（用户可见的处理反馈）
    { href: '/reports', label: '我的举报' },
  ];

  // 管理后台入口 —— **仅对 moderator / admin 呈现**
  //
  // 服务端鉴权是唯一权威：`/admin` 页面用 `isStaff(user)` 判定，
  // 非 staff 访问会被 redirect 到 `/`；每个后台接口还有 adminGuard 兜底。
  // 这里只是让有权限的人**找得到入口**。
  if (isStaffRole(user)) {
    links.push({ href: '/admin', label: '管理后台' });
  }

  links.push({ href: `/member/${user.username}`, label: user.username });
  links.push({ href: '/settings', label: '设置' });

  return links;
}
