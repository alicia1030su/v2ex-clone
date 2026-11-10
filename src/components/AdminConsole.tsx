'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
 * | 节点管理 | GET  /api/nodes?includeHidden=true                             |
 * | 节点管理 | PATCH /api/nodes  body { id, action: 'hide' \| 'activate' }   |
 * | 分类     | GET  /api/admin/categories                                    |
 * | 分类     | POST /api/admin/categories  body { name, title, sort }        |
 * | 分类     | PATCH /api/admin/categories/[id] body { title?, sort?, hidden? } |
 * | 日志     | GET  /api/admin/logs?action=&targetType=&targetId=            |
 * | 配置     | GET  /api/admin/config                                        |
 *
 * ## 权限说明
 *
 * 页面按角色呈现不同能力（与 src/lib/permissions.ts 的矩阵一致）：
 *  - moderator：查看用户、封禁/解封、处理举报、审批节点、看日志与配置
 *  - admin    ：以上全部 + 变更他人角色 + 隐藏/恢复节点
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

/**
 * 节点（后台「节点管理」tab）
 *
 * `GET /api/nodes?includeHidden=true` 的返回项 —— staff 可见隐藏节点。
 */
type AdminNode = {
  id: number;
  name: string;
  title: string;
  status: 'active' | 'pending' | 'hidden';
  categoryId: number | null;
  topicsCount: number;
};

/**
 * 节点分类（后台「分类」tab，v0.0.14）
 *
 * 对应 `GET /api/admin/categories` —— 服务端按白名单回显
 * `id / name / title / sort / hidden / updatedAt`（外加聚合的 nodesCount）。
 *
 * `hidden = true` 表示**已禁用**：公共页面不展示该分类，
 * 但数据与节点的分类归属保留（不做删除，避免 `nodes.category_id` 悬空）。
 */
type AdminCategory = {
  id: number;
  name: string;
  title: string;
  sort: number;
  hidden: boolean;
  updatedAt: string;
  /** 该分类下状态为 active 的节点数（仅展示用，判断能否安全禁用） */
  nodesCount: number;
};

type TabKey =
  | 'overview'
  | 'users'
  | 'credits'
  | 'reports'
  | 'nodes'
  | 'nodemgmt'
  | 'categories'
  | 'logs'
  | 'config';

/**
 * 全部 tab 定义。
 *
 * v0.0.5：「积分」tab 受 `credits.adjust` 权限控制（**仅 admin**）——
 * 用 `visibleTo` 声明可见角色，渲染时过滤。
 * 原先直接把「积分」写进静态数组，导致**版主也能看到 tab**
 * （只是点进去显示「仅管理员可操作」）—— 那是把权限做成了内容级而非入口级，
 * 既误导用户，也让「tab 是否隐藏」无法作为权限断言。
 *
 * v0.0.14：「分类」tab 对 staff **可见**（moderator 有 `categories.view`），
 * 但写操作按钮只对 `canManageCategories`（`categories.manage`，仅 admin）呈现。
 * 这是有意的分层：版主需要知道「节点为何从 /nodes 消失」，
 * 但不能下架一整组节点。
 */
const ALL_TABS: { key: TabKey; label: string; visibleTo?: Array<'admin' | 'staff'> }[] = [
  { key: 'overview', label: '概览' },
  { key: 'users', label: '用户' },
  { key: 'credits', label: '积分', visibleTo: ['admin'] },
  { key: 'reports', label: '举报' },
  { key: 'nodes', label: '节点申请' },
  { key: 'nodemgmt', label: '节点管理' },
  { key: 'categories', label: '分类' },
  { key: 'logs', label: '操作日志' },
  { key: 'config', label: '系统配置' },
];

/** 按当前用户的权限过滤 tab（moderator 看不到「积分」） */
function tabsFor(canAdjustCredits: boolean): Array<{ key: TabKey; label: string }> {
  return ALL_TABS.filter((t) => {
    if (!t.visibleTo) return true;
    if (t.visibleTo.includes('admin')) return canAdjustCredits;
    return true; // 'staff' —— 后台本就只有 staff 能进
  }).map((t) => ({ key: t.key, label: t.label }));
}

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

export default function AdminConsole({
  canChangeRole,
  canAdjustCredits,
  canManageCategories,
}: {
  canChangeRole: boolean;
  /** v0.0.5：能否调整积分（`credits.adjust` 权限，仅 admin） */
  canAdjustCredits: boolean;
  /**
   * v0.0.14：能否管理分类（`categories.manage` 权限，仅 admin）。
   *
   * 版主有 `categories.view` ⇒ 能看到列表（排查「节点为何从 /nodes 消失」），
   * 但看不到任何写按钮。前端隐藏**只是体验优化**，
   * 服务端 `adminGuardWrite(request, 'categories.manage')` 才是唯一权威。
   */
  canManageCategories: boolean;
}) {
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
  /**
   * 已应用的查询条件（用于拉数据）。
   * 与表单里的输入状态分开 —— 否则每敲一个字符都会触发一次请求。
   */
  const [appliedQuery, setAppliedQuery] = useState({ q: '', role: '', status: '', offset: 0 });
  /** 表单输入状态（仅本地，不触发请求） */
  const [userForm, setUserForm] = useState({ q: '', role: '', status: '' });

  // 积分调整（v0.0.5）
  /**
   * 只有 admin 能调积分（`credits.adjust` 权限），
   * 因此本 tab 与处理函数都受 `canAdjustCredits` 控制。
   */
  const [creditForm, setCreditForm] = useState({ userId: '', amount: '', reason: '' });

  // 举报
  const [reports, setReports] = useState<Report[]>([]);
  const [reportStatus, setReportStatus] = useState('pending');

  // 节点申请
  const [nodeRequests, setNodeRequests] = useState<NodeRequest[]>([]);
  const [nodeStatus, setNodeStatus] = useState('pending');

  // 节点管理（含隐藏节点）
  const [allNodes, setAllNodes] = useState<AdminNode[]>([]);
  const [nodeFilter, setNodeFilter] = useState('');

  // 日志
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logFilter, setLogFilter] = useState({ action: '', targetType: '' });

  // 分类管理（v0.0.14）
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  /** 新建表单（受控；提交成功后清空） */
  const [categoryForm, setCategoryForm] = useState({ name: '', title: '', sort: '0' });
  /**
   * 行内编辑草稿：记录哪些分类正在编辑（key = 分类 id）。
   *
   * 用「草稿 Map + 编辑集合」而不是「直接改 categories 状态」，
   * 是为了让「取消编辑」不留下脏值 —— 取消时直接丢弃草稿即可。
   */
  const [categoryDrafts, setCategoryDrafts] = useState<
    Record<number, { title: string; sort: string }>
  >({});
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);

  // 配置
  const [config, setConfig] = useState<Config | null>(null);

  /** 节点管理 tab 的过滤结果（按名称或标题模糊匹配） */
  const filteredNodes = useMemo(() => {
    const q = nodeFilter.trim().toLowerCase();
    if (!q) return allNodes;
    return allNodes.filter(
      (n) =>
        n.name.toLowerCase().includes(q) || n.title.toLowerCase().includes(q),
    );
  }, [allNodes, nodeFilter]);

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
      if (appliedQuery.q.trim()) params.set('q', appliedQuery.q.trim());
      if (appliedQuery.role) params.set('role', appliedQuery.role);
      if (appliedQuery.status) params.set('status', appliedQuery.status);
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
    [appliedQuery.q, appliedQuery.role, appliedQuery.status],
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

  // ---- 加载：节点管理（含隐藏节点）----
  const loadAllNodes = useCallback(async () => {
    try {
      // includeHidden=true 只对 staff 生效（服务端 isStaff(user) 判定），
      // 普通版主/管理员都能看到隐藏节点；普通用户拿不到 staff 身份，
      // 服务端会退化成只返回 active 节点。
      const res = await fetch('/api/nodes?includeHidden=true&limit=500');
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        nodes?: AdminNode[];
      };
      if (!res.ok || !data.ok) {
        setMsg({ kind: 'err', text: data.error ?? '节点列表加载失败' });
        return;
      }
      setAllNodes(data.nodes ?? []);
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

  // ---- 加载：分类（v0.0.14）----
  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/categories');
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        categories?: AdminCategory[];
      };
      if (!res.ok || !data.ok) {
        // 错误必须显示真实文本 —— 静默会让「分类页空白」无从排查
        setMsg({ kind: 'err', text: data.error ?? '分类列表加载失败' });
        return;
      }
      setCategories(data.categories ?? []);
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
    if (tab === 'users') void loadUsers(appliedQuery.offset);
    else if (tab === 'reports') void loadReports(reportStatus);
    else if (tab === 'nodes') void loadNodeRequests(nodeStatus);
    else if (tab === 'nodemgmt') void loadAllNodes();
    else if (tab === 'categories') void loadCategories();
    else if (tab === 'logs') void loadLogs(logFilter.action, logFilter.targetType);
    else if (tab === 'config') void loadConfig();
  }, [
    tab,
    loadUsers,
    appliedQuery.offset,
    loadReports,
    reportStatus,
    loadNodeRequests,
    nodeStatus,
    loadAllNodes,
    loadCategories,
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
    if (ok) void loadUsers(appliedQuery.offset);
  }

  async function banUser(userId: number, username: string) {
    const reason = window.prompt(`封禁 ${username} 的原因（可留空）：`);
    if (reason === null) return;
    const ok = await act(`ban-${userId}`, `/api/admin/users/${userId}/ban`, 'POST', { reason });
    if (ok) void loadUsers(appliedQuery.offset);
  }

  async function unbanUser(userId: number) {
    const ok = await act(`unban-${userId}`, `/api/admin/users/${userId}/unban`, 'POST');
    if (ok) void loadUsers(appliedQuery.offset);
  }

  /**
   * 调整用户积分（v0.0.5）
   *
   * 调 `POST /api/admin/credits`（权限 `credits.adjust`，**仅 admin**）。
   * service 层 `adminAdjustCredits()` 负责行锁 + 余额校验 + 不可篡改账本，
   * 这里只做表单校验与结果展示。
   *
   * 高危操作：提交前用 `window.confirm` 二次确认（任务书 §三要求
   * 「敏感操作二次确认」），并把 UID、数额、理由都显式列出来供核对。
   */
  async function adjustCredits() {
    const userId = Number(creditForm.userId);
    const amount = Number(creditForm.amount);
    const reason = creditForm.reason.trim();
    if (!Number.isInteger(userId) || userId <= 0) {
      setMsg({ kind: 'err', text: '请填写有效的用户 UID' });
      return;
    }
    if (!Number.isInteger(amount) || amount === 0) {
      setMsg({ kind: 'err', text: '调整数额必须是非零整数（正数增加，负数扣减）' });
      return;
    }
    if (Math.abs(amount) > 1_000_000) {
      setMsg({ kind: 'err', text: '单次调整数额不能超过 1,000,000' });
      return;
    }
    if (reason.length < 2 || reason.length > 200) {
      setMsg({ kind: 'err', text: '调整理由长度需在 2-200 之间' });
      return;
    }

    const confirmed = window.confirm(
      `确认调整积分？\n\n用户 UID：${userId}\n数额：${amount > 0 ? '+' : ''}${amount}\n理由：${reason}\n\n此操作会写入不可篡改的积分账本与审计日志。`,
    );
    if (!confirmed) return;

    const ok = await act('adjust-credits', '/api/admin/credits', 'POST', {
      userId,
      amount,
      reason,
    });
    if (ok) {
      setCreditForm({ userId: '', amount: '', reason: '' });
      // 刷新用户列表，让积分变化立即可见
      void loadUsers(appliedQuery.offset);
    }
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

  /**
   * 隐藏 / 恢复既有节点。
   *
   * 走 `PATCH /api/nodes { id, action }` —— **仅管理员**（服务端 isAdmin 判定）。
   * 隐藏后节点对普通访问者不可见（`getNodeByName` 过滤非 active 状态）。
   */
  async function setNodeVisibility(
    id: number,
    action: 'hide' | 'activate',
  ) {
    const ok = await act(`node-status-${id}`, '/api/nodes', 'PATCH', { id, action });
    if (ok) {
      void loadAllNodes();
      void loadOverview();
    }
  }

  // ---- 分类写操作（v0.0.14）----
  //
  // 全部经 `act()` → `csrfFetch()`，与其它后台写操作**同一套 CSRF 机制**；
  // 失败时 `act()` 会把服务端返回的真实错误文本塞进 msg 显示出来。
  // 服务端权限：`categories.manage`（仅 admin）。

  /** 新建分类。name / title / sort 的最终校验在服务端（这里只做空值预检，避免无谓请求） */
  async function createNewCategory() {
    const name = categoryForm.name.trim();
    const title = categoryForm.title.trim();
    if (!name || !title) {
      setMsg({ kind: 'err', text: '分类名与标题都必须填写' });
      return;
    }
    const ok = await act('category-create', '/api/admin/categories', 'POST', {
      name,
      title,
      // 空串交给服务端按默认值 0 处理（避免 Number('') === 0 的隐式语义混进来）
      sort: categoryForm.sort.trim() === '' ? 0 : Number(categoryForm.sort),
    });
    if (ok) {
      setCategoryForm({ name: '', title: '', sort: '0' });
      void loadCategories();
    }
  }

  /** 保存行内编辑（title / sort） */
  async function saveCategory(id: number) {
    const draft = categoryDrafts[id];
    if (!draft) return;
    const ok = await act(`category-save-${id}`, `/api/admin/categories/${id}`, 'PATCH', {
      title: draft.title.trim(),
      sort: draft.sort.trim() === '' ? 0 : Number(draft.sort),
    });
    if (ok) {
      setEditingCategoryId(null);
      setCategoryDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void loadCategories();
    }
  }

  /**
   * 禁用 / 启用分类。
   *
   * 禁用只是 `hidden = true` —— **不删数据**，节点归属保留、可一键恢复。
   * 禁用前提示该分类下的节点数，让操作者知道影响面。
   */
  async function setCategoryHidden(category: AdminCategory, hidden: boolean) {
    if (
      hidden &&
      !window.confirm(
        `确认禁用分类「${category.title}」？\n\n该分类下有 ${category.nodesCount} 个节点。\n` +
          '禁用后分类不再出现在公共页面（节点数据与归属保留，可随时恢复）。',
      )
    ) {
      return;
    }
    const ok = await act(`category-hide-${category.id}`, `/api/admin/categories/${category.id}`, 'PATCH', {
      hidden,
    });
    if (ok) void loadCategories();
  }

  return (
    <>
      <div className="cell tab-alt-container">
        {tabsFor(canAdjustCredits).map((t) => (
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
                      value={userForm.q}
                      placeholder="用户名或邮箱"
                      aria-label="搜索用户"
                      onChange={(e) => setUserForm({ ...userForm, q: e.target.value })}
                    />
                  </td>
                </tr>
                <tr>
                  <td align="right">角色</td>
                  <td>
                    <select
                      value={userForm.role}
                      aria-label="按角色筛选"
                      onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
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
                      value={userForm.status}
                      aria-label="按状态筛选"
                      onChange={(e) => setUserForm({ ...userForm, status: e.target.value })}
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
                      onClick={() => {
                        // 应用筛选条件（重置到第一页）
                        setAppliedQuery({ ...userForm, offset: 0 });
                      }}
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

                <div className="reply_row">
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
              {appliedQuery.offset > 0 ? (
                <button
                  type="button"
                  className="page_normal"
                  onClick={() =>
                    setAppliedQuery({
                      ...appliedQuery,
                      offset: Math.max(0, appliedQuery.offset - USER_PAGE_SIZE),
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
              <span className="page_current">
                {Math.floor(appliedQuery.offset / USER_PAGE_SIZE) + 1}
              </span>{' '}
              {users.length === USER_PAGE_SIZE ? (
                <button
                  type="button"
                  className="page_normal"
                  onClick={() =>
                    setAppliedQuery({
                      ...appliedQuery,
                      offset: appliedQuery.offset + USER_PAGE_SIZE,
                    })
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

      {/* ---------------- 积分（v0.0.5，仅 admin） ---------------- */}
      {tab === 'credits' ? (
        canAdjustCredits ? (
          <>
            <div className="cell">
              <strong>调整用户积分</strong>
              <div className="sep10" />
              <table cellPadding={5} cellSpacing={0} border={0} width="100%">
                <tbody>
                  <tr>
                    <td width={120} align="right">
                      用户 UID
                    </td>
                    <td>
                      <input
                        type="number"
                        value={creditForm.userId}
                        onChange={(e) =>
                          setCreditForm({ ...creditForm, userId: e.target.value })
                        }
                        placeholder="用户数字 ID（可在「用户」tab 查看）"
                        aria-label="用户 UID"
                        style={{ width: 260 }}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td align="right">数额</td>
                    <td>
                      <input
                        type="number"
                        value={creditForm.amount}
                        onChange={(e) =>
                          setCreditForm({ ...creditForm, amount: e.target.value })
                        }
                        placeholder="正数增加，负数扣减"
                        aria-label="调整数额"
                        style={{ width: 160 }}
                      />
                      <span className="f12 gray" style={{ marginLeft: 8 }}>
                        单次上限 1,000,000
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td align="right">理由</td>
                    <td>
                      <input
                        type="text"
                        value={creditForm.reason}
                        onChange={(e) =>
                          setCreditForm({ ...creditForm, reason: e.target.value })
                        }
                        placeholder="必填，2-200 字（写入不可篡改账本与审计日志）"
                        aria-label="调整理由"
                        style={{ width: 360 }}
                        maxLength={200}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td align="right">&nbsp;</td>
                    <td>
                      <button
                        type="button"
                        className="button"
                        onClick={() => void adjustCredits()}
                        disabled={pending === 'adjust-credits'}
                        aria-label="提交积分调整"
                      >
                        {pending === 'adjust-credits' ? '处理中…' : '提交调整'}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="cell">
              <span className="fade">
                积分调整会写入 <code>credit_ledger</code>（只追加、不可篡改，
                含调整前后余额快照）与管理员审计日志。
                扣减受「余额不足拒绝」约束。此功能**仅管理员**可用，版主无权限。
              </span>
            </div>
          </>
        ) : (
          <div className="cell">
            <span className="fade">积分调整仅管理员可操作。</span>
          </div>
        )
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
                  <div className="reply_row">
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
                  <div className="reply_row">
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

      {/* ---------------- 节点管理（隐藏 / 恢复既有节点） ---------------- */}
      {tab === 'nodemgmt' ? (
        <>
          <div className="cell">
            <table cellPadding={5} cellSpacing={0} border={0} width="100%">
              <tbody>
                <tr>
                  <td width={120} align="right">
                    筛选
                  </td>
                  <td>
                    <input
                      type="text"
                      value={nodeFilter}
                      placeholder="按节点名或标题过滤"
                      aria-label="过滤节点"
                      onChange={(e) => setNodeFilter(e.target.value)}
                    />
                  </td>
                </tr>
                <tr>
                  <td align="right">&nbsp;</td>
                  <td>
                    <span className="f12 gray">
                      共 {allNodes.length} 个节点（含隐藏）。隐藏的节点对普通访问者不可见。
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {filteredNodes.length === 0 ? (
            <div className="cell">
              <span className="fade">没有符合条件的节点</span>
            </div>
          ) : (
            filteredNodes.map((n) => (
              <div key={n.id} className="cell">
                <div className="fr f12 gray">
                  UID {n.id} · {n.topicsCount} 主题
                </div>
                <div>
                  <strong>{n.title}</strong>{' '}
                  <span className="f12 gray">({n.name})</span>{' '}
                  <span
                    className="badge"
                    style={n.status === 'active' ? { background: '#3d8a56' } : undefined}
                  >
                    {n.status === 'active' ? '正常' : n.status === 'hidden' ? '已隐藏' : '待审'}
                  </span>
                </div>

                {/* 隐藏/恢复是**管理员专属**操作（服务端 PATCH /api/nodes 要求 isAdmin）。
                    版主可见列表但没有按钮 —— 前端隐藏只是体验优化，
                    服务端仍是唯一权威。 */}
                {canChangeRole ? (
                  <div className="reply_row">
                    {n.status === 'hidden' ? (
                      <button
                        type="button"
                        className="button"
                        onClick={() => void setNodeVisibility(n.id, 'activate')}
                        disabled={pending === `node-status-${n.id}`}
                        aria-label={`恢复节点 ${n.title}`}
                      >
                        {pending === `node-status-${n.id}` ? '处理中…' : '恢复节点'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="button"
                        onClick={() => void setNodeVisibility(n.id, 'hide')}
                        disabled={pending === `node-status-${n.id}`}
                        aria-label={`隐藏节点 ${n.title}`}
                      >
                        {pending === `node-status-${n.id}` ? '处理中…' : '隐藏节点'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="sep5 f12 gray">
                    隐藏/恢复节点是管理员专属操作
                  </div>
                )}
              </div>
            ))
          )}
        </>
      ) : null}

      {/* ---------------- 分类管理（v0.0.14：增 / 改名 / 排序 / 禁用） ---------------- */}
      {tab === 'categories' ? (
        <>
          {/* 新建表单 —— 仅 `categories.manage`（admin）可见 */}
          {canManageCategories ? (
            <div className="cell">
              <strong>新建分类</strong>
              <div className="sep10" />
              <table cellPadding={5} cellSpacing={0} border={0} width="100%">
                <tbody>
                  <tr>
                    <td width={120} align="right">
                      分类名
                    </td>
                    <td>
                      <input
                        type="text"
                        value={categoryForm.name}
                        placeholder="如 tech（小写字母/数字/下划线/短横线，2-32）"
                        aria-label="新分类名称"
                        maxLength={32}
                        onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td align="right">标题</td>
                    <td>
                      <input
                        type="text"
                        value={categoryForm.title}
                        placeholder="如 技术（展示给用户，1-64）"
                        aria-label="新分类标题"
                        maxLength={64}
                        onChange={(e) =>
                          setCategoryForm({ ...categoryForm, title: e.target.value })
                        }
                      />
                    </td>
                  </tr>
                  <tr>
                    <td align="right">排序</td>
                    <td>
                      <input
                        type="number"
                        value={categoryForm.sort}
                        aria-label="新分类排序"
                        min={-10000}
                        max={10000}
                        step={1}
                        style={{ width: 120 }}
                        onChange={(e) =>
                          setCategoryForm({ ...categoryForm, sort: e.target.value })
                        }
                      />{' '}
                      <span className="f12 gray">越小越靠前（-10000 ~ 10000）</span>
                    </td>
                  </tr>
                  <tr>
                    <td align="right">&nbsp;</td>
                    <td>
                      <button
                        type="button"
                        className="button"
                        onClick={() => void createNewCategory()}
                        disabled={pending === 'category-create'}
                        aria-label="创建分类"
                      >
                        {pending === 'category-create' ? '处理中…' : '创建'}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          {categories.length === 0 ? (
            <div className="cell">
              <span className="fade">暂无分类数据</span>
            </div>
          ) : (
            categories.map((c) => {
              const draft = categoryDrafts[c.id];
              const isEditing = editingCategoryId === c.id;
              return (
                <div key={c.id} className="cell">
                  <div className="fr f12 gray">
                    ID {c.id} · {c.nodesCount} 个节点 · 更新于 {fmtDate(c.updatedAt)}
                  </div>
                  <div>
                    <strong>{c.title}</strong>{' '}
                    <span className="f12 gray">({c.name})</span>{' '}
                    <span className="badge">排序 {c.sort}</span>{' '}
                    <span
                      className="badge"
                      style={c.hidden ? undefined : { background: '#3d8a56' }}
                    >
                      {c.hidden ? '已禁用' : '启用中'}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="reply_row">
                      <input
                        type="text"
                        value={draft?.title ?? c.title}
                        aria-label={`编辑 ${c.name} 的标题`}
                        maxLength={64}
                        style={{ width: 240 }}
                        onChange={(e) =>
                          setCategoryDrafts((prev) => ({
                            ...prev,
                            [c.id]: { title: e.target.value, sort: draft?.sort ?? String(c.sort) },
                          }))
                        }
                      />{' '}
                      <input
                        type="number"
                        value={draft?.sort ?? String(c.sort)}
                        aria-label={`编辑 ${c.name} 的排序`}
                        min={-10000}
                        max={10000}
                        step={1}
                        style={{ width: 100 }}
                        onChange={(e) =>
                          setCategoryDrafts((prev) => ({
                            ...prev,
                            [c.id]: { title: draft?.title ?? c.title, sort: e.target.value },
                          }))
                        }
                      />{' '}
                      <button
                        type="button"
                        className="button"
                        onClick={() => void saveCategory(c.id)}
                        disabled={pending === `category-save-${c.id}`}
                        aria-label={`保存 ${c.name}`}
                      >
                        {pending === `category-save-${c.id}` ? '处理中…' : '保存'}
                      </button>{' '}
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          setEditingCategoryId(null);
                          setCategoryDrafts((prev) => {
                            const next = { ...prev };
                            delete next[c.id];
                            return next;
                          });
                        }}
                        aria-label={`取消编辑 ${c.name}`}
                      >
                        取消
                      </button>
                    </div>
                  ) : canManageCategories ? (
                    <div className="reply_row">
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          setEditingCategoryId(c.id);
                          setCategoryDrafts((prev) => ({
                            ...prev,
                            [c.id]: { title: c.title, sort: String(c.sort) },
                          }));
                        }}
                        aria-label={`编辑分类 ${c.name}`}
                      >
                        编辑
                      </button>{' '}
                      {c.hidden ? (
                        <button
                          type="button"
                          className="button"
                          onClick={() => void setCategoryHidden(c, false)}
                          disabled={pending === `category-hide-${c.id}`}
                          aria-label={`启用分类 ${c.name}`}
                        >
                          {pending === `category-hide-${c.id}` ? '处理中…' : '启用'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="button"
                          onClick={() => void setCategoryHidden(c, true)}
                          disabled={pending === `category-hide-${c.id}`}
                          aria-label={`禁用分类 ${c.name}`}
                        >
                          {pending === `category-hide-${c.id}` ? '处理中…' : '禁用'}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="sep5 f12 gray">分类管理是管理员专属操作（版主只读）</div>
                  )}
                </div>
              );
            })
          )}

          <div className="cell">
            <span className="fade">
              禁用分类<b>不删除数据</b>：节点仍保留分类归属，只是该分类不再出现在
              公共页面（<code>/nodes</code>、发帖选节点等）。因此系统不提供「删除分类」。
              每次创建 / 修改 / 禁用都会写入审计日志。
            </span>
          </div>
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
                      {/* v0.0.14：分类操作（category.create / update / hide / show）
                          若不在这里加，管理员就无法按目标类型筛出分类变更 */}
                      <option value="category">节点分类</option>
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
