'use client';

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
      const res = await fetch('/api/topics', {
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
                  name="title"
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
