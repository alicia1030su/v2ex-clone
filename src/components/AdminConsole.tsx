'use client';

import { useCallback, useEffect, useState } from 'react';
import { csrfFetch } from '@/components/CsrfProvider';

/**
 * 管理后台控制台（v0.0.3）
 *
 * ## 使用的 v0.0.3 后台 API
 *
 * | 区域     | 接口                                                          |
 * |----------|---------------------------------------------------------------|
 * | 概览     | GET /api/admin/stats                                          |
 * | 用户     | GET /api/admin/users?q=&role=&status=&limit=&offset=          |
 * | 用户     | PATCH /api/admin/users/[id]/role   body { role, reason? }     |
 * | 用户     | POST  /api/admin/users/[id]/ban    body { reason? }            |
 * | 用户     | POST  /api/admin/users/[id]/unban                            |
 * | 举报     | GET  /api/admin/reports?status=                               |
 * | 举报     | POST /api/admin/reports/[id]/handle body { action, note? }    |
 * | 待办     | GET  /api/admin/pending                                       |
 * | 节点申请 | GET  /api/admin/node-requests?status=                        |
 * | 节点申请 | POST /api/admin/node-requests/[id]/approve                    |
 * | 节点申请 | POST /api/admin/node-requests/[id]/reject                     |
 * | 日志     | GET  /api/admin/logs?action=&targetType=&targetId=            |
 * | 配置     | GET  /api/admin/config                                        |
 *
 * ## 权限说明
 *
 * 页面按角色呈现不同能力（与 src/lib/permissions.ts 的矩阵一致）：
 *  - moderator：查看用户、封禁/解封、处理举报、审批节点、看日志与配置
 *  - admin    ：以上全部 + 变更他人角色
 *
 * `canChangeRole` 由服务端传入（服务端已用 isAdmin(user) 判定），
 * **前端隐藏按钮只是体验优化，adminGuardWrite 才是唯一权威**。
 * 任何操作失败都会把服务端返回的 error 原样展示。
 */

type Role = 'user' | 'moderator' | 'admin';
type UserStatus = 'active' | 'suspended' | 'banned';

type AdminUser = {
  id: number;
  username: string;
  email: string | null;
  avatar: string | null;
  role: Role;
  status: UserStatus;
  balance: number;
  createdAt: string;
  lastActiveAt: string;
};

type Report = {
  id: number;
  targetType: 'topic' | 'reply' | 'user';
  targetId: number;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
  reporterId: number;
  handledBy: number | null;
  handledAt: string | null;
  handleNote: string | null;
  createdAt: string;
};

type NodeRequest = {
  id: number;
  name: string;
  title: string;
  description: string | null;
  categoryId: number | null;
  requesterId: number;
  status: 'pending' | 'approved' | 'rejected';
  handledBy: number | null;
  handledAt: string | null;
  approvedNodeId: number | null;
  createdAt: string;
};

type AuditLog = {
  id: number;
  moderatorId: number;
  moderatorName: string;
  action: string;
  targetType: string;
  targetId: number;
  reason: string | null;
  createdAt: string;
};

type Stats = {
  totals: {
    users: number;
    topics: number;
    replies: number;
    nodes: number;
    pendingReports: number;
  };
  recent: { newUsers24h: number; newTopics24h: number };
};

type Config = {
  app: { nodeEnv: string; runtimeEnv: string; publicBaseUrl: string | null };
  database: { host?: string; port?: string; database?: string; password: string | null };
  redis: { configured: boolean; host: string | null };
  smtp: {
    configured: boolean;
    host: string | null;
    port: string | null;
    secure: boolean | null;
    from: string | null;
    user: string | null;
    pass: string | null;
  };
  security: {
    trustProxyHeaders: boolean;
    topicEditWindowMinutes: number;
    passwordResetTtlMinutes: number;
    enableDebugEndpoints: boolean;
  };
  note: string;
};

type TabKey = 'overview' | 'users' | 'reports' | 'nodes' | 'logs' | 'config';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'users', label: '用户' },
  { key: 'reports', label: '举报' },
  { key: 'nodes', label: '节点申请' },
  { key: 'logs', label: '操作日志' },
  { key: 'config', label: '系统配置' },
];

const ROLE_LABELS: Record<string, string> = {
  user: '用户',
  moderator: '版主',
  admin: '管理员',
};

const STATUS_LABELS: Record<string, string> = {
  active: '正常',
  suspended: '停用',
  banned: '已封禁',
};

const USER_PAGE_SIZE = 30;

function fmtDate(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AdminConsole({ canChangeRole }: { canChangeRole: boolean }) {
  const [tab, setTab] = useState<TabKey>('overview');
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 概览
  const [stats, setStats] = useState<Stats | null>(null);
  const [pendingReports, setPendingReports] = useState<number | null>(null);
  const [pendingNodeRequests, setPendingNodeRequests] = useState<number | null>(null);

  // 用户
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userQuery, setUserQuery] = useState({ q: '', role: '', status: '', offset: 0 });

  // 举报
  const [reports, setReports] = useState<Report[]>([]);
  const [reportStatus, setReportStatus] = useState('pending');

  // 节点申请
  const [nodeRequests, setNodeRequests] = useState<NodeRequest[]>([]);
  const [nodeStatus, setNodeStatus] = useState('pending');

  // 日志
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logFilter, setLogFilter] = useState({ action: '', targetType: '' });

  // 配置
  const [config, setConfig] = useState<Config | null>(null);

  // ---- 加载：概览与待办 ----
  const loadOverview = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/pending'),
      ]);
      const sd = (await s.json()) as { ok?: boolean; error?: string } & Partial<Stats>;
      const pd = (await p.json()) as {
        ok?: boolean;
        error?: string;
        totals?: { pendingReports: number; pendingNodeRequests: number };
      };
      if (s.ok && sd.ok && sd.totals && sd.recent) {
        setStats({ totals: sd.totals, recent: sd.recent });
      } else {
        setMsg({ kind: 'err', text: sd.error ?? '概览加载失败' });
      }
      if (p.ok && pd.ok && pd.totals) {
        setPendingReports(pd.totals.pendingReports);
        setPendingNodeRequests(pd.totals.pendingNodeRequests);
      }
    } catch {
      setMsg({ kind: 'err', text: '网络错误，请稍后重试' });
    }
  }, []);

  // ---- 加载：用户列表 ----
  const loadUsers = useCallback(
    async (offset: number) => {
      const params = new URLSearchParams({
        limit: String(USER_PAGE_SIZE),
        offset: String(offset),
      });
      if (userQuery.q.trim()) params.set('q', userQuery.q.trim());
      if (userQuery.role) params.set('role', userQuery.role);
      if (userQuery.status) params.set('status', userQuery.status);
      try {
        const res = await fetch(`/api/admin/users?${params.toString()}`);
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          total?: number;
          users?: AdminUser[];
        };
        if (!res.ok || !data.ok) {
          setMsg({ kind: 'err', text: data.error ?? '用户列表加载失败' });
          return;
        }
        setUsers(data.users ?? []);
        setUserTotal(Number(data.total ?? 0));
      } catch {
        setMsg({ kind: 'err', text: '网络错误，请稍后重试' });
      }
    },
    [userQuery.q, userQuery.role, userQuery.status],
  );

  // ---- 加载：举报 ----
  const loadReports = useCallback(async (status: string) => {
    try {
      const res = await fetch(`/api/admin/reports?status=${status}`);
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        reports?: Report[];
      };
      if (!res.ok || !data.ok) {
        setMsg({ kind: 'err', text: data.error ?? '举报列表加载失败' });
        return;
      }
      setReports(data.reports ?? []);
    } catch {
      setMsg({ kind: 'err', text: '网络错误，请稍后重试' });
    }
  }, []);

  // ---- 加载：节点申请 ----
  const loadNodeRequests = useCallback(async (status: string) => {
    try {
      const res = await fetch(`/api/admin/node-requests?status=${status}`);
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        requests?: NodeRequest[];
      };
      if (!res.ok || !data.ok) {
        setMsg({ kind: 'err', text: data.error ?? '节点申请加载失败' });
        return;
      }
      setNodeRequests(data.requests ?? []);
    } catch {
      setMsg({ kind: 'err', text: '网络错误，请稍后重试' });
    }
  }, []);

  // ---- 加载：日志 ----
  const loadLogs = useCallback(async (action: string, targetType: string) => {
    const params = new URLSearchParams({ limit: '50' });
    if (action) params.set('action', action);
    if (targetType) params.set('targetType', targetType);
    try {
      const res = await fetch(`/api/admin/logs?${params.toString()}`);
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        logs?: AuditLog[];
      };
      if (!res.ok || !data.ok) {
        setMsg({ kind: 'err', text: data.error ?? '日志加载失败' });
        return;
      }
      setLogs(data.logs ?? []);
    } catch {
      setMsg({ kind: 'err', text: '网络错误，请稍后重试' });
    }
  }, []);

  // ---- 加载：配置 ----
  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/config');
      const data = (await res.json()) as { ok?: boolean; error?: string } & Partial<Config>;
      if (!res.ok || !data.ok) {
        setMsg({ kind: 'err', text: data.error ?? '配置加载失败' });
        return;
      }
      setConfig(data as Config);
    } catch {
      setMsg({ kind: 'err', text: '网络错误，请稍后重试' });
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  // ---- tab 切换时按需加载 ----
  useEffect(() => {
    if (tab === 'users') void loadUsers(userQuery.offset);
    else if (tab === 'reports') void loadReports(reportStatus);
    else if (tab === 'nodes') void loadNodeRequests(nodeStatus);
    else if (tab === 'logs') void loadLogs(logFilter.action, logFilter.targetType);
    else if (tab === 'config') void loadConfig();
  }, [
    tab,
    loadUsers,
    userQuery.offset,
    loadReports,
    reportStatus,
    loadNodeRequests,
    nodeStatus,
    loadLogs,
    logFilter.action,
    logFilter.targetType,
    loadConfig,
  ]);

  // ---- 写操作 ----
  async function act(
    key: string,
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: unknown,
  ): Promise<boolean> {
    setPending(key);
    setMsg(null);
    try {
      const res = await csrfFetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || data.ok === false) {
        setMsg({ kind: 'err', text: data.error ?? `操作失败（HTTP ${res.status}）` });
        return false;
      }
      setMsg({ kind: 'ok', text: data.message ?? '操作成功' });
      return true;
    } catch {
      setMsg({ kind: 'err', text: '网络错误，请重试' });
      return false;
    } finally {
      setPending(null);
    }
  }

  async function changeRole(userId: number, role: Role) {
    const ok = await act(`role-${userId}`, `/api/admin/users/${userId}/role`, 'PATCH', { role });
    if (ok) void loadUsers(userQuery.offset);
  }

  async function banUser(userId: number, username: string) {
    const reason = window.prompt(`封禁 ${username} 的原因（可留空）：`);
    if (reason === null) return;
    const ok = await act(`ban-${userId}`, `/api/admin/users/${userId}/ban`, 'POST', { reason });
    if (ok) void loadUsers(userQuery.offset);
  }

  async function unbanUser(userId: number) {
    const ok = await act(`unban-${userId}`, `/api/admin/users/${userId}/unban`, 'POST');
    if (ok) void loadUsers(userQuery.offset);
  }

  async function handleReport(id: number, action: 'accept' | 'reject') {
    const note =
      action === 'accept'
        ? window.prompt('接受举报将隐藏对应内容。处理说明（可留空）：')
        : window.prompt('驳回举报说明（可留空）：');
    if (note === null) return;
    const ok = await act(`report-${id}`, `/api/admin/reports/${id}/handle`, 'POST', {
      action,
      note,
    });
    if (ok) {
      void loadReports(reportStatus);
      void loadOverview();
    }
  }

  async function approveNode(id: number) {
    const ok = await act(`node-approve-${id}`, `/api/admin/node-requests/${id}/approve`, 'POST');
    if (ok) {
      void loadNodeRequests(nodeStatus);
      void loadOverview();
    }
  }

  async function rejectNode(id: number) {
    const ok = await act(`node-reject-${id}`, `/api/admin/node-requests/${id}/reject`, 'POST');
    if (ok) {
      void loadNodeRequests(nodeStatus);
      void loadOverview();
    }
  }

  return (
    <>
      <div className="cell tab-alt-container">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-alt${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
          >
            {t.label}
            {t.key === 'reports' && pendingReports ? `（${pendingReports}）` : ''}
            {t.key === 'nodes' && pendingNodeRequests ? `（${pendingNodeRequests}）` : ''}
          </button>
        ))}
      </div>

      {msg ? (
        <div className="cell">
          <div
            className={msg.kind === 'err' ? 'problem' : 'toast'}
            style={msg.kind === 'ok' ? { position: 'static', boxShadow: 'none' } : undefined}
            role={msg.kind === 'err' ? 'alert' : 'status'}
          >
            {msg.text}
          </div>
        </div>
      ) : null}

      {/* ---------------- 概览 ---------------- */}
      {tab === 'overview' ? (
        <div className="cell">
          <strong>社区概览</strong>
          <div className="sep10" />
          {stats ? (
            <table cellPadding={5} cellSpacing={0} border={0} width="100%">
              <tbody>
                <tr>
                  <td width={120}>用户</td>
                  <td>{stats.totals.users}</td>
                  <td width={160}>主题</td>
                  <td>{stats.totals.topics}</td>
                </tr>
                <tr>
                  <td>回复</td>
                  <td>{stats.totals.replies}</td>
                  <td>节点</td>
                  <td>{stats.totals.nodes}</td>
                </tr>
                <tr>
                  <td>待处理举报</td>
                  <td>{stats.totals.pendingReports}</td>
                  <td>待审批节点申请</td>
                  <td>{pendingNodeRequests ?? '—'}</td>
                </tr>
                <tr>
                  <td>近 24 小时新用户</td>
                  <td>{stats.recent.newUsers24h}</td>
                  <td>近 24 小时新主题</td>
                  <td>{stats.recent.newTopics24h}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <span className="fade">正在加载概览…</span>
          )}
        </div>
      ) : null}

      {/* ---------------- 用户 ---------------- */}
      {tab === 'users' ? (
        <>
          <div className="cell">
            <table cellPadding={5} cellSpacing={0} border={0} width="100%">
              <tbody>
                <tr>
                  <td width={120} align="right">
                    搜索
                  </td>
                  <td>
                    <input
                      type="text"
                      value={userQuery.q}
                      placeholder="用户名或邮箱"
                      aria-label="搜索用户"
                      onChange={(e) => setUserQuery({ ...userQuery, q: e.target.value, offset: 0 })}
                    />
                  </td>
                </tr>
                <tr>
                  <td align="right">角色</td>
                  <td>
                    <select
                      value={userQuery.role}
                      aria-label="按角色筛选"
                      onChange={(e) =>
                        setUserQuery({ ...userQuery, role: e.target.value, offset: 0 })
                      }
                    >
                      <option value="">全部</option>
                      <option value="user">用户</option>
                      <option value="moderator">版主</option>
                      <option value="admin">管理员</option>
                    </select>
                  </td>
                </tr>
                <tr>
                  <td align="right">状态</td>
                  <td>
                    <select
                      value={userQuery.status}
                      aria-label="按状态筛选"
                      onChange={(e) =>
                        setUserQuery({ ...userQuery, status: e.target.value, offset: 0 })
                      }
                    >
                      <option value="">全部</option>
                      <option value="active">正常</option>
                      <option value="suspended">停用</option>
                      <option value="banned">已封禁</option>
                    </select>
                  </td>
                </tr>
                <tr>
                  <td align="right">&nbsp;</td>
                  <td>
                    <button
                      type="button"
                      className="button"
                      onClick={() => void loadUsers(0)}
                      aria-label="搜索用户"
                    >
                      搜索
                    </button>{' '}
                    <span className="f12 gray">共 {userTotal} 位用户</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {users.length === 0 ? (
            <div className="cell">
              <span className="fade">没有符合条件的用户</span>
            </div>
          ) : (
            users.map((u) => (
              <div key={u.id} className="cell">
                <div className="fr">
                  <span className="f12 gray">
                    UID {u.id} · 加入于 {fmtDate(u.createdAt)}
                  </span>
                </div>

                <div>
                  <a href={`/member/${u.username}`}>{u.username}</a>{' '}
                  <span className="badge">{ROLE_LABELS[u.role] ?? u.role}</span>{' '}
                  <span
                    className="badge"
                    style={u.status === 'active' ? { background: '#3d8a56' } : undefined}
                  >
                    {STATUS_LABELS[u.status] ?? u.status}
                  </span>{' '}
                  <span className="f12 gray">积分 {u.balance}</span>
                </div>

                <div className="sep5">
                  {canChangeRole ? (
                    <>
                      <select
                        value={u.role}
                        aria-label={`变更 ${u.username} 的角色`}
                        disabled={pending === `role-${u.id}`}
                        onChange={(e) => void changeRole(u.id, e.target.value as Role)}
                        style={{ width: 'auto', display: 'inline-block' }}
                      >
                        <option value="user">用户</option>
                        <option value="moderator">版主</option>
                        <option value="admin">管理员</option>
                      </select>{' '}
                    </>
                  ) : null}

                  {u.status === 'banned' ? (
                    <button
                      type="button"
                      className="button"
                      onClick={() => void unbanUser(u.id)}
                      disabled={pending === `unban-${u.id}`}
                      aria-label={`解封 ${u.username}`}
                    >
                      {pending === `unban-${u.id}` ? '处理中…' : '解封'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button"
                      onClick={() => void banUser(u.id, u.username)}
                      disabled={pending === `ban-${u.id}`}
                      aria-label={`封禁 ${u.username}`}
                    >
                      {pending === `ban-${u.id}` ? '处理中…' : '封禁'}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          <div className="cell ps_container">
            <div style={{ textAlign: 'center' }}>
              {userQuery.offset > 0 ? (
                <button
                  type="button"
                  className="page_normal"
                  onClick={() =>
                    setUserQuery({
                      ...userQuery,
                      offset: Math.max(0, userQuery.offset - USER_PAGE_SIZE),
                    })
                  }
                  aria-label="上一页"
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  ‹ 上一页
                </button>
              ) : (
                <span className="page_normal" style={{ opacity: 0.45 }}>
                  ‹ 上一页
                </span>
              )}{' '}
              <span className="page_current">{Math.floor(userQuery.offset / USER_PAGE_SIZE) + 1}</span>{' '}
              {users.length === USER_PAGE_SIZE ? (
                <button
                  type="button"
                  className="page_normal"
                  onClick={() =>
                    setUserQuery({ ...userQuery, offset: userQuery.offset + USER_PAGE_SIZE })
                  }
                  aria-label="下一页"
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  下一页 ›
                </button>
              ) : (
                <span className="page_normal" style={{ opacity: 0.45 }}>
                  下一页 ›
                </span>
              )}
            </div>
          </div>
        </>
      ) : null}

      {/* ---------------- 举报 ---------------- */}
      {tab === 'reports' ? (
        <>
          <div className="cell tab-alt-container">
            {['pending', 'accepted', 'rejected'].map((s) => (
              <button
                key={s}
                type="button"
                className={`tab-alt${reportStatus === s ? ' active' : ''}`}
                onClick={() => setReportStatus(s)}
                aria-pressed={reportStatus === s}
              >
                {s === 'pending' ? '待处理' : s === 'accepted' ? '已接受' : '已驳回'}
              </button>
            ))}
          </div>

          {reports.length === 0 ? (
            <div className="cell">
              <span className="fade">没有相关举报</span>
            </div>
          ) : (
            reports.map((r) => (
              <div key={r.id} className="cell">
                <div className="fr f12 gray">{fmtDate(r.createdAt)}</div>
                <div>
                  举报 #{r.id} · 目标{' '}
                  {r.targetType === 'topic'
                    ? `主题 #${r.targetId}`
                    : r.targetType === 'reply'
                      ? `回复 #${r.targetId}`
                      : `用户 #${r.targetId}`}{' '}
                  <span className="badge">{r.status}</span>
                </div>
                <div className="f12 gray">{r.reason}</div>
                {r.targetType === 'topic' ? (
                  <div className="f12">
                    <a href={`/t/${r.targetId}`}>查看主题</a>
                  </div>
                ) : null}

                {r.status === 'pending' ? (
                  <div className="sep5">
                    <button
                      type="button"
                      className="button"
                      onClick={() => void handleReport(r.id, 'accept')}
                      disabled={pending === `report-${r.id}`}
                      aria-label="接受举报并隐藏内容"
                    >
                      {pending === `report-${r.id}` ? '处理中…' : '接受并隐藏'}
                    </button>{' '}
                    <button
                      type="button"
                      className="button"
                      onClick={() => void handleReport(r.id, 'reject')}
                      disabled={pending === `report-${r.id}`}
                      aria-label="驳回举报"
                    >
                      驳回
                    </button>
                  </div>
                ) : r.handleNote ? (
                  <div className="sep5 f12 gray">处理说明：{r.handleNote}</div>
                ) : null}
              </div>
            ))
          )}
        </>
      ) : null}

      {/* ---------------- 节点申请 ---------------- */}
      {tab === 'nodes' ? (
        <>
          <div className="cell tab-alt-container">
            {['pending', 'approved', 'rejected'].map((s) => (
              <button
                key={s}
                type="button"
                className={`tab-alt${nodeStatus === s ? ' active' : ''}`}
                onClick={() => setNodeStatus(s)}
                aria-pressed={nodeStatus === s}
              >
                {s === 'pending' ? '待审批' : s === 'approved' ? '已通过' : '已拒绝'}
              </button>
            ))}
          </div>

          {nodeRequests.length === 0 ? (
            <div className="cell">
              <span className="fade">没有相关节点申请</span>
            </div>
          ) : (
            nodeRequests.map((n) => (
              <div key={n.id} className="cell">
                <div className="fr f12 gray">{fmtDate(n.createdAt)}</div>
                <div>
                  <strong>{n.title}</strong>{' '}
                  <span className="f12 gray">({n.name})</span>{' '}
                  <span className="badge">{n.status}</span>
                </div>
                {n.description ? <div className="f12 gray">{n.description}</div> : null}

                {n.status === 'pending' ? (
                  <div className="sep5">
                    <button
                      type="button"
                      className="button"
                      onClick={() => void approveNode(n.id)}
                      disabled={pending === `node-approve-${n.id}`}
                      aria-label={`批准节点申请 ${n.title}`}
                    >
                      {pending === `node-approve-${n.id}` ? '处理中…' : '批准'}
                    </button>{' '}
                    <button
                      type="button"
                      className="button"
                      onClick={() => void rejectNode(n.id)}
                      disabled={pending === `node-reject-${n.id}`}
                      aria-label={`拒绝节点申请 ${n.title}`}
                    >
                      拒绝
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </>
      ) : null}

      {/* ---------------- 操作日志 ---------------- */}
      {tab === 'logs' ? (
        <>
          <div className="cell">
            <table cellPadding={5} cellSpacing={0} border={0} width="100%">
              <tbody>
                <tr>
                  <td width={120} align="right">
                    动作
                  </td>
                  <td>
                    <input
                      type="text"
                      value={logFilter.action}
                      placeholder="如 user.ban"
                      aria-label="按动作筛选日志"
                      onChange={(e) => setLogFilter({ ...logFilter, action: e.target.value })}
                    />
                  </td>
                </tr>
                <tr>
                  <td align="right">目标类型</td>
                  <td>
                    <select
                      value={logFilter.targetType}
                      aria-label="按目标类型筛选日志"
                      onChange={(e) => setLogFilter({ ...logFilter, targetType: e.target.value })}
                    >
                      <option value="">全部</option>
                      <option value="topic">主题</option>
                      <option value="reply">回复</option>
                      <option value="user">用户</option>
                      <option value="report">举报</option>
                      <option value="node_request">节点申请</option>
                    </select>
                  </td>
                </tr>
                <tr>
                  <td align="right">&nbsp;</td>
                  <td>
                    <button
                      type="button"
                      className="button"
                      onClick={() => void loadLogs(logFilter.action, logFilter.targetType)}
                      aria-label="筛选日志"
                    >
                      筛选
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {logs.length === 0 ? (
            <div className="cell">
              <span className="fade">没有相关日志</span>
            </div>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="cell">
                <div className="fr f12 gray">{fmtDate(l.createdAt)}</div>
                <div>
                  <strong>{l.moderatorName}</strong> {l.action} {l.targetType}#{l.targetId}
                </div>
                {l.reason ? <div className="f12 gray">{l.reason}</div> : null}
              </div>
            ))
          )}
        </>
      ) : null}

      {/* ---------------- 系统配置 ---------------- */}
      {tab === 'config' ? (
        <>
          {!config ? (
            <div className="cell">
              <span className="fade">正在加载配置…</span>
            </div>
          ) : (
            <>
              <div className="cell">
                <strong>运行环境</strong>
                <div className="sep10" />
                <table cellPadding={5} cellSpacing={0} border={0} width="100%">
                  <tbody>
                    <tr>
                      <td width={200}>NODE_ENV</td>
                      <td>{config.app.nodeEnv}</td>
                    </tr>
                    <tr>
                      <td>运行时环境</td>
                      <td>{config.app.runtimeEnv}</td>
                    </tr>
                    <tr>
                      <td>站点地址</td>
                      <td>{config.app.publicBaseUrl ?? '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="cell">
                <strong>数据库与缓存</strong>
                <div className="sep10" />
                <table cellPadding={5} cellSpacing={0} border={0} width="100%">
                  <tbody>
                    <tr>
                      <td width={200}>数据库主机</td>
                      <td>
                        {config.database.host ?? '—'}
                        {config.database.port ? `:${config.database.port}` : ''}
                        {config.database.database ? ` / ${config.database.database}` : ''}
                      </td>
                    </tr>
                    <tr>
                      <td>数据库口令</td>
                      <td>{config.database.password ?? '—'}</td>
                    </tr>
                    <tr>
                      <td>Redis</td>
                      <td>
                        {config.redis.configured
                          ? `已配置（${config.redis.host ?? '—'}）`
                          : '未配置'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="cell">
                <strong>邮件服务</strong>
                <div className="sep10" />
                <table cellPadding={5} cellSpacing={0} border={0} width="100%">
                  <tbody>
                    <tr>
                      <td width={200}>状态</td>
                      <td>{config.smtp.configured ? '已配置' : '未配置'}</td>
                    </tr>
                    <tr>
                      <td>主机</td>
                      <td>{config.smtp.host ?? '—'}</td>
                    </tr>
                    <tr>
                      <td>端口</td>
                      <td>{config.smtp.port ?? '—'}</td>
                    </tr>
                    <tr>
                      <td>发件人</td>
                      <td>{config.smtp.from ?? '—'}</td>
                    </tr>
                    <tr>
                      <td>账号 / 口令</td>
                      <td>
                        {config.smtp.user ?? '—'} / {config.smtp.pass ?? '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="cell">
                <strong>安全策略</strong>
                <div className="sep10" />
                <table cellPadding={5} cellSpacing={0} border={0} width="100%">
                  <tbody>
                    <tr>
                      <td width={200}>信任代理头</td>
                      <td>{config.security.trustProxyHeaders ? '是' : '否'}</td>
                    </tr>
                    <tr>
                      <td>编辑时限（分钟）</td>
                      <td>{config.security.topicEditWindowMinutes}</td>
                    </tr>
                    <tr>
                      <td>重置令牌有效期（分钟）</td>
                      <td>{config.security.passwordResetTtlMinutes}</td>
                    </tr>
                    <tr>
                      <td>调试端点</td>
                      <td>{config.security.enableDebugEndpoints ? '已启用' : '未启用'}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="sep10" />
                <div className="f12 gray">{config.note}</div>
              </div>
            </>
          )}
        </>
      ) : null}
    </>
  );
}
