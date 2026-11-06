import { redirect } from 'next/navigation';
import { getSessionUser, isStaff, isAdmin } from '@/lib/auth';
import Wrapper from '@/components/Wrapper';
import AdminConsole from '@/components/AdminConsole';

export const dynamic = 'force-dynamic';

/**
 * 管理后台（v0.0.3）
 *
 * ## 结构
 *
 * 本文件只做**服务端鉴权**与**页面骨架**，交互部分在
 * `src/components/AdminConsole.tsx`（客户端组件）。
 *
 * 之所以不整页客户端化，是因为鉴权必须在服务端完成：
 * 非 staff 访问时直接 redirect，不下发任何后台内容 ——
 * 避免「先渲染出后台框架再跳转」的闪烁，也避免未授权用户
 * 通过查看源码/网络面板拿到管理接口的可用性信息。
 *
 * ## 使用的 v0.0.3 后台 API
 *
 * 全部由 AdminConsole 调用：
 *   GET  /api/admin/stats
 *   GET  /api/admin/pending
 *   GET  /api/admin/users?q=&role=&status=&limit=&offset=
 *   PATCH /api/admin/users/[id]/role
 *   POST /api/admin/users/[id]/ban | /unban
 *   GET  /api/admin/reports?status=
 *   POST /api/admin/reports/[id]/handle
 *   GET  /api/admin/node-requests?status=
 *   POST /api/admin/node-requests/[id]/approve | /reject
 *   GET  /api/admin/logs?action=&targetType=
 *   GET  /api/admin/config
 *
 * 权限矩阵见 src/lib/permissions.ts：
 *   - moderator：查看用户、封禁/解封、处理举报、审批节点、看日志与配置
 *   - admin    ：以上全部 + 变更他人角色
 */
export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin?next=%2Fadmin');
  if (!isStaff(user)) redirect('/');

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>管理后台</strong>
            <div className="sep5" />
            <span className="fade">
              {isAdmin(user) ? '管理员' : '版主'} · {user.username}
            </span>
            <div className="sep5" />
            <span className="f12 gray">
              所有敏感操作都会写入审计日志，且服务端会再次校验权限。
            </span>
          </div>
        </div>
      }
    >
      <div className="box">
        <div className="header">
          <a href="/">V2EX</a> <span className="chevron">&nbsp;›&nbsp;</span> 管理后台
        </div>
        <AdminConsole canChangeRole={isAdmin(user)} canAdjustCredits={isAdmin(user)} />
      </div>
    </Wrapper>
  );
}
