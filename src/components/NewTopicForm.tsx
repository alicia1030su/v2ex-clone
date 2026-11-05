'use client';

import { csrfFetch } from '@/components/CsrfProvider';

import { useMemo, useState } from 'react';

type NodeOpt = { id: number; name: string; title: string; categoryId: number | null };
type Category = { id: number; name: string; title: string };

export default function NewTopicForm({
  nodes,
  categories,
}: {
  nodes: NodeOpt[];
  categories: Category[];
}) {
  const [nodeId, setNodeId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<number, NodeOpt[]>();
    for (const c of categories) map.set(c.id, []);
    const orphan: NodeOpt[] = [];
    for (const n of nodes) {
      const bucket = n.categoryId != null ? map.get(n.categoryId) : undefined;
      if (bucket) bucket.push(n);
      else orphan.push(n);
    }
    return { map, orphan };
  }, [nodes, categories]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!nodeId) {
      setMsg('请选择节点');
      return;
    }
    if (title.trim().length < 4) {
      setMsg('标题至少 4 个字符');
      return;
    }
    if (content.trim().length < 10) {
      setMsg('正文至少 10 个字符');
      return;
    }
    setPending(true);
    try {
      const res = await csrfFetch('/api/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: Number(nodeId), title, content }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; redirect?: string };
      if (res.ok && data.ok) {
        window.location.href = data.redirect ?? '/';
        return;
      }
      setMsg(data.error ?? '发布失败');
    } catch {
      setMsg('网络错误，请重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="cell">
      {msg ? (
        <div className="problem" id="problem">
          {msg}
        </div>
      ) : null}
      {/* v0.0.4（V4-20）：name 不得与 HTMLFormElement 的 DOM 属性同名 —— 详见 NodeRequestForm 的说明。 */}
  // ⚠️ v0.0.4（V4-20 / R-27）：表单内 input 的 `name` **不得**与
  // `HTMLFormElement` 的 DOM 属性同名（`nodeName` / `title` / `id` / `action` …）。
  // HTML 规范给 HTMLFormElement 加了 `[OverrideBuiltins]` —— 表单内的命名控件
  // 会遮蔽原型上的同名属性，于是 `form.title` 变成 input 元素而不是字符串。
  // Next.js 15.5 内置的 React 19 水合代码调用 `instance.nodeName.toLowerCase()`，
  // 遇到这种遮蔽就抛 TypeError → 水合失败（#418）→ 事件处理器不绑定。
  // 详见 src/components/NodeRequestForm.tsx 的完整说明。
      <form onSubmit={submit}>
        <table cellPadding={5} cellSpacing={0} border={0} width="100%">
          <tbody>
            <tr>
              <td width={120} align="right">
                节点
              </td>
              <td>
                <select
                  name="nodeId"
                  id="nodeId"
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                  required
                >
                  <option value="">请选择节点</option>
                  {categories.map((c) => {
                    const list = grouped.map.get(c.id) ?? [];
                    if (list.length === 0) return null;
                    return (
                      <optgroup key={c.id} label={c.title}>
                        {list.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.title}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                  {grouped.orphan.length > 0 ? (
                    <optgroup label="其他">
                      {grouped.orphan.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.title}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </td>
            </tr>
            <tr>
              <td align="right">
                标题
              </td>
              <td>
                <input
                  type="text"
                  name="topic_title"
                  id="title"
                  maxLength={128}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </td>
            </tr>
            <tr>
              <td align="right" valign="top">
                正文
              </td>
              <td>
                <textarea
                  name="content"
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  required
                />
              </td>
            </tr>
            <tr>
              <td align="right">&nbsp;</td>
              <td>
                <button type="submit" className="button" disabled={pending}>
                  {pending ? '发布中…' : '发布'}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </form>
    </div>
  );
}
