'use client';

import { useState } from 'react';
import { csrfFetch } from '@/components/CsrfProvider';

/**
 * 节点申请表单（v0.0.4）
 *
 * ## 为什么要有这个组件
 *
 * v0.0.4 之前，后端节点申请链路是**完整**的：
 *   - `POST /api/node-requests`（用户提交申请 → node_requests 表 status=pending）
 *   - `GET  /api/admin/node-requests`（管理列表）
 *   - `POST /api/admin/node-requests/[id]/approve`（**真正创建节点**并回填 approved_node_id）
 *   - `POST /api/admin/node-requests/[id]/reject`
 *
 * 但**前端一个入口都没有** —— 用户无法提交申请，管理员在后台能看到申请
 * （`AdminConsole` 的「节点申请」tab）却收不到任何新申请。
 * 这是一条**断头路**：后端有半条链，前端半条链都没有。
 *
 * ## 表单规则（与服务端 `POST /api/node-requests` 保持一致）
 *
 *  - 节点名：只允许小写字母、数字、下划线、短横线，长度 2-32
 *  - 标题：长度 2-128
 *  - 分类：可选（服务端 categoryId 为空则不分类）
 *
 * 前端校验是**体验优化**，服务端校验才是权威 ——
 * 两边规则写成一样的，是为了让用户第一次就填对，而不是提交后才被拒。
 *
 * ## 提交结果
 *
 *  - 成功 → 显示「已提交，等待管理员审核」，并把输入框置灰防重复提交
 *  - 失败（409 已存在 / 已在审核中 / 429 限流）→ 如实展示服务端原因
 */
export type NodeRequestFormProps = {
  /** 分类列表（id / name / title） */
  categories: Array<{ id: number; name: string; title: string }>;
  /** 我之前提交的申请（用于展示审核进度，避免重复申请） */
  myRequests: Array<{
    id: number;
    name: string;
    title: string;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: string;
  }>;
};

const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

const STATUS_LABELS: Record<string, string> = {
  pending: '审核中',
  approved: '已通过',
  rejected: '已拒绝',
};

export default function NodeRequestForm({ categories, myRequests }: NodeRequestFormProps) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const nameValid = NAME_RE.test(name.trim());
  const titleValid = title.trim().length >= 2 && title.trim().length <= 128;
  const canSubmit = nameValid && titleValid && !pending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setMsg(null);

    if (!nameValid) {
      setError('节点名只能包含小写字母、数字、下划线和短横线，长度 2-32');
      return;
    }
    if (!titleValid) {
      setError('节点标题长度需在 2-128 之间');
      return;
    }

    setPending(true);
    try {
      const res = await csrfFetch('/api/node-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim().toLowerCase(),
          title: title.trim(),
          description: description.trim(),
          categoryId: categoryId ? Number(categoryId) : 0,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || data.ok === false) {
        setError(data.error ?? `提交失败（HTTP ${res.status}）`);
        return;
      }
      setMsg(data.message ?? '节点申请已提交，等待管理员审核');
      // 清空表单，防止重复提交
      setName('');
      setTitle('');
      setDescription('');
      setCategoryId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误，请重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="cell">
      {error ? (
        <div className="problem" id="problem" role="alert">
          {error}
        </div>
      ) : null}
      {msg ? (
        <div className="toast" role="status" style={{ position: 'static', boxShadow: 'none' }}>
          {msg}
        </div>
      ) : null}

      {/*
        ⚠️ v0.0.4 修复（V4-20 / R-27）：表单内 input 的 `name` **不得**与
        `HTMLFormElement` 的 DOM 属性同名。

        HTML 规范给 `HTMLFormElement` 加了 `[OverrideBuiltins]` ——
        表单内的**命名控件**会通过「命名属性访问」遮蔽原型上的同名属性。
        于是 `<form>` 里放一个 `name="nodeName"` 的 input 之后：

            form.nodeName   // → HTMLInputElement（不是字符串 "FORM"）

        而 Next.js 15.5 内置的 React 19 水合代码里有这一行
        （react-dom-client.production.js 的 canHydrateInstance）：

            instance.nodeName.toLowerCase() !== type.toLowerCase()

        `nodeName` 此时是 Element → `.toLowerCase()` 不存在 → 抛
        `TypeError: nodeName.toLowerCase is not a function` →
        React 水合失败（error #418）→ **事件处理器不绑定** →
        表单走浏览器原生 GET 提交 → 写操作完全失效。

        本地实测（Chromium）：`name="nodeName"` / `title` / `id` / `action`
        四者都会遮蔽；`nodeName` 是唯一直接触发 react-dom 崩溃的那个。
        → 因此这里改用 `node_slug`（不与任何 DOM 属性同名），并保留
        `id="nodeName"` 供样式与测试定位（`id` 属性不参与命名属性访问）。
      */}
      <form onSubmit={submit} id="node-request-form">
        <table cellPadding={5} cellSpacing={0} border={0} width="100%">
          <tbody>
            <tr>
              <td width={120} align="right">
                节点名
              </td>
              <td>
                <input
                  type="text"
                  name="node_slug"
                  id="node_slug"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="小写字母、数字、下划线、短横线"
                  aria-label="节点名"
                  maxLength={32}
                />
                <div className="f12 gray">
                  创建后不可更改，将成为 /go/节点名 的访问地址
                </div>
              </td>
            </tr>
            <tr>
              <td align="right">节点标题</td>
              <td>
                <input
                  type="text"
                  name="node_title"
                  id="node_title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="显示在导航与列表中的名称"
                  aria-label="节点标题"
                  maxLength={128}
                />
              </td>
            </tr>
            <tr>
              <td align="right">分类</td>
              <td>
                <select
                  name="categoryId"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  aria-label="节点分类"
                >
                  <option value="">不指定分类</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <td align="right" valign="top">
                节点描述
              </td>
              <td>
                <textarea
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="这个节点主要讨论什么？（可选）"
                  aria-label="节点描述"
                  rows={4}
                  maxLength={2000}
                  style={{ width: '100%' }}
                />
              </td>
            </tr>
            <tr>
              <td align="right">&nbsp;</td>
              <td>
                <button type="submit" className="button" disabled={!canSubmit}>
                  {pending ? '提交中…' : '提交申请'}
                </button>{' '}
                <span className="f12 gray">
                  申请提交后进入待审队列，由管理员或版主审批
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </form>

      {myRequests.length > 0 ? (
        <>
          <div className="sep10" />
          <strong>我提交的申请</strong>
          <div className="sep5" />
          {myRequests.map((r) => (
            <div key={r.id} className="f12 gray">
              <span className="badge">{STATUS_LABELS[r.status] ?? r.status}</span>{' '}
              {r.title} <span className="fade">({r.name})</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
