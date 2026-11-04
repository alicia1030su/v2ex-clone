import 'server-only';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { guardCsrf } from '@/lib/csrf-guard';
import { checkPermission, type Permission } from '@/lib/permissions';
import type { SessionUser } from '@/lib/auth';

/**
 * 后台 API 的统一守卫
 *
 * 所有 /api/admin/* 路由必须经过这里，保证：
 *  1. **服务端权限校验**（不能只靠前端隐藏按钮）
 *  2. 未登录 → 401；已登录但角色不足 → 403（区分清楚）
 *  3. 写操作额外做 CSRF 校验
 *
 * 用法：
 *   const guard = await adminGuard(request, 'users.view');
 *   if (guard.response) return guard.response;
 *   const user = guard.user;   // 已通过鉴权
 */

export type AdminGuard =
  | { ok: true; user: SessionUser; response: null }
  | { ok: false; user: null; response: NextResponse };

/** 只读接口的守卫（不做 CSRF） */
export async function adminGuard(
  _request: Request,
  permission: Permission,
): Promise<AdminGuard> {
  const user = await getSessionUser();
  const check = checkPermission(user, permission);
  if (!check.ok) {
    return {
      ok: false,
      user: null,
      response: NextResponse.json(
        { ok: false, error: check.reason },
        { status: check.status },
      ),
    };
  }
  return { ok: true, user: check.user, response: null };
}

/** 写接口的守卫（额外做 CSRF 校验） */
export async function adminGuardWrite(
  request: Request,
  permission: Permission,
): Promise<AdminGuard> {
  const user = await getSessionUser();
  // 先做权限判断（未登录直接 401，不泄露端点存在性）
  const check = checkPermission(user, permission);
  if (!check.ok) {
    return {
      ok: false,
      user: null,
      response: NextResponse.json(
        { ok: false, error: check.reason },
        { status: check.status },
      ),
    };
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) {
    return { ok: false, user: null, response: csrfDenied };
  }

  return { ok: true, user: check.user, response: null };
}
