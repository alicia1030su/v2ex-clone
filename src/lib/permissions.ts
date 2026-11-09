import type { SessionUser } from '@/lib/auth';

/**
 * 权限矩阵（v0.0.3）
 *
 * 单一事实来源：所有管理 API 都必须通过这里的判定，
 * 不得在各路由里自行判断角色，避免出现"某个接口忘了校验"。
 *
 * | 操作                          | user | moderator | admin |
 * |-------------------------------|------|-----------|-------|
 * | 查看用户列表 / 搜索            |  ✗   |    ✓      |   ✓   |
 * | 改变他人角色                   |  ✗   |    ✗      |   ✓   |
 * | 封禁 / 解封用户                |  ✗   |    ✓      |   ✓   |
 * | 对 admin 用户执行封禁          |  ✗   |    ✗      |   ✓   |
 * | 查看举报列表                   |  ✗   |    ✓      |   ✓   |
 * | 处理举报                      |  ✗   |    ✓      |   ✓   |
 * | 隐藏 / 恢复内容                |  ✗   |    ✓      |   ✓   |
 * | 节点审批                      |  ✗   |    ✓      |   ✓   |
 * | 查看节点分类                   |  ✗   |    ✓      |   ✓   |
 * | 管理节点分类（增/改/禁用）      |  ✗   |    ✗      |   ✓   |
 * | 调整积分                      |  ✗   |    ✗      |   ✓   |
 * | 查看操作日志                   |  ✗   |    ✓      |   ✓   |
 * | 查看系统配置                   |  ✗   |    ✓      |   ✓   |
 *
 * 本模块是**纯函数**，不依赖数据库 —— 因此单元测试可直接 import，
 * 无需连接数据库（也避免 server-only / db 初始化带来的副作用）。
 */
export type Permission =
  | 'users.view'
  | 'users.role'
  | 'users.ban'
  | 'users.ban_admin'
  | 'reports.view'
  | 'reports.handle'
  | 'content.hide'
  | 'nodes.approve'
  // v0.0.14：节点分类的管理链路
  //
  // 为什么拆成两个权限而不是复用 `nodes.approve`：
  //  - 分类是**结构性配置**（决定 /nodes 的分组与顺序），影响面远大于单个节点审批；
  //  - 禁用分类会让一整组节点从公共页面消失 ⇒ 只允许 admin；
  //  - 版主仍需**看到**分类（判断节点该归到哪个分类、排查"节点为何不见"），
  //    因此保留只读的 `categories.view`。
  | 'categories.view'
  | 'categories.manage'
  | 'credits.adjust'
  | 'logs.view'
  | 'config.view';

const MATRIX: Record<Permission, readonly SessionUser['role'][]> = {
  'users.view': ['moderator', 'admin'],
  'users.role': ['admin'],
  'users.ban': ['moderator', 'admin'],
  'users.ban_admin': ['admin'],
  'reports.view': ['moderator', 'admin'],
  'reports.handle': ['moderator', 'admin'],
  'content.hide': ['moderator', 'admin'],
  'nodes.approve': ['moderator', 'admin'],
  'categories.view': ['moderator', 'admin'],
  'categories.manage': ['admin'],
  'credits.adjust': ['admin'],
  'logs.view': ['moderator', 'admin'],
  'config.view': ['moderator', 'admin'],
};

/** 该权限是否允许给定角色 */
export function hasPermission(
  user: SessionUser | null | undefined,
  permission: Permission,
): boolean {
  if (!user) return false;
  return MATRIX[permission].includes(user.role);
}

/** 权限判定结果（供 API 统一返回 401/403） */
export type PermissionCheck =
  | { ok: true; user: SessionUser }
  | { ok: false; status: 401 | 403; reason: string };

/**
 * 服务端权限门控。
 *
 * 未登录 → 401（需要认证）
 * 已登录但角色不足 → 403（无权）
 */
export function checkPermission(
  user: SessionUser | null | undefined,
  permission: Permission,
): PermissionCheck {
  if (!user) {
    return { ok: false, status: 401, reason: '需要登录' };
  }
  if (!hasPermission(user, permission)) {
    return { ok: false, status: 403, reason: '权限不足' };
  }
  return { ok: true, user };
}

/**
 * 内容所有权判定。
 *
 * 作者本人可以编辑/软删除自己的内容；
 * moderator/admin 可对任何内容操作。
 */
export function canModifyOwnContent(
  user: SessionUser | null | undefined,
  authorId: number,
): boolean {
  if (!user) return false;
  if (user.id === authorId) return true;
  return user.role === 'moderator' || user.role === 'admin';
}

/** 是否是内容作者本人（不含管理角色） */
export function isContentAuthor(
  user: SessionUser | null | undefined,
  authorId: number,
): boolean {
  return !!user && user.id === authorId;
}

/**
 * 目标用户是否可被当前操作者封禁。
 *
 * 规则：
 *  - 自己不能封禁自己
 *  - moderator 不能封禁 admin
 */
export function canBanUser(
  actor: SessionUser,
  target: { id: number; role: SessionUser['role'] },
): { ok: boolean; reason?: string } {
  if (actor.id === target.id) {
    return { ok: false, reason: '不能封禁自己' };
  }
  if (target.role === 'admin' && actor.role !== 'admin') {
    return { ok: false, reason: '只有管理员可以封禁管理员' };
  }
  if (!hasPermission(actor, 'users.ban')) {
    return { ok: false, reason: '权限不足' };
  }
  return { ok: true };
}

/**
 * 管理员不能把自己降级 —— 否则可能把系统锁死（没有管理员可恢复）。
 */
export function canChangeRole(
  actor: SessionUser,
  target: { id: number; role: SessionUser['role'] },
  nextRole: SessionUser['role'],
): { ok: boolean; reason?: string } {
  if (!hasPermission(actor, 'users.role')) {
    return { ok: false, reason: '权限不足' };
  }
  if (actor.id === target.id && nextRole !== 'admin') {
    return { ok: false, reason: '不能降低自己的管理员权限（会导致无人可恢复）' };
  }
  return { ok: true };
}

/** 编辑时间窗口的上限（分钟）—— 防止误配成永久开放 */
export const MAX_EDIT_WINDOW_MINUTES = 60 * 24 * 30;

/**
 * 读取编辑时间窗口配置。
 * 默认 60 分钟；0 表示永久允许（仅管理员可用）。
 */
export function editWindowMinutes(): number {
  const raw = process.env.TOPIC_EDIT_WINDOW_MINUTES;
  const n = raw === undefined ? 60 : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 60;
  return Math.min(Math.floor(n), MAX_EDIT_WINDOW_MINUTES);
}

/**
 * 判断是否仍在允许编辑的时间窗口内。
 *
 * 管理角色（moderator/admin）不受时间限制。
 */
export function withinEditWindow(
  createdAt: Date,
  user: SessionUser | null | undefined,
): { ok: boolean; reason?: string; windowMinutes: number } {
  const windowMinutes = editWindowMinutes();
  if (user && (user.role === 'moderator' || user.role === 'admin')) {
    return { ok: true, windowMinutes };
  }
  if (windowMinutes === 0) return { ok: true, windowMinutes };
  const elapsedMs = Date.now() - new Date(createdAt).getTime();
  const limitMs = windowMinutes * 60 * 1000;
  if (elapsedMs > limitMs) {
    return {
      ok: false,
      reason: `超过编辑时限（${windowMinutes} 分钟），如需修改请联系管理员`,
      windowMinutes,
    };
  }
  return { ok: true, windowMinutes };
}
