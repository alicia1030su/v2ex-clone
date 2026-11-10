'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { csrfFetch } from '@/components/CsrfProvider';

/**
 * 通知列表（v0.0.3）
 *
 * 数据来源：GET /api/notifications?limit=&offset=&unreadOnly=
 *   → { ok, total, unread, notifications: [{ id, type, actorId, topicId, replyId, message, read, createdAt }] }
 *
 * 写操作：
 *   - POST   /api/notifications       body { id? }   —— 给 id 标记单条，不给则全部已读
 *   - DELETE /api/notifications       body { id? }   —— 给 id 删单条，不给则清空自己的全部
 *
 * 交互约定：
 *  - 加载态 / 错误态（含重试）/ 空态
 *  - 单条操作与批量操作各自独立的 pending 标记，避免误伤
 *  - 未读用 `.badge` 标记，点击单条即标记已读
 */

type Notification = {
  id: number;
  type: 'reply' | 'mention' | 'topic_thanks' | 'node_thanks' | 'system';
  actorId: number | null;
  topicId: number | null;
  replyId: number | null;
  message: string;
  read: boolean;
  createdAt: string;
};

type ListResponse = {
  ok?: boolean;
  error?: string;
  total?: number;
  unread?: number;
  notifications?: Notification[];
};

type State =
  | { status: 'loading' }
  | { status: 'error'; text: string }
  | { status: 'ready'; items: Notification[]; total: number; unread: number };

const PAGE_SIZE = 30;

/** 通知类型 → 中文标签 */
const TYPE_LABELS: Record<string, string> = {
  reply: '回复',
  mention: '提及',
  topic_thanks: '感谢',
  node_thanks: '节点感谢',
  system: '系统',
};

/**
 * 相对时间格式化（客户端本地实现，避免为一个字符串引入服务端依赖）
 *
 * 与 @/lib/time 的行为保持一致：分钟 / 小时 / 天，超过 30 天显示日期。
 */
function relativeTime(input: string): string {
  const ts = new Date(input).getTime();
  if (Number.isNaN(ts)) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return m > 0 ? `${h} 小时 ${m} 分钟前` : `${h} 小时前`;
  }
  if (diff < 30 * 86400) {
    const d = Math.floor(diff / 86400);
    const h = Math.floor((diff % 86400) / 3600);
    return h > 0 ? `${d} 天 ${h} 小时前` : `${d} 天前`;
  }
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function NotificationsList() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(
    async (nextOffset: number, onlyUnread: boolean) => {
      setState({ status: 'loading' });
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        });
        if (onlyUnread) params.set('unreadOnly', 'true');
        const res = await fetch(`/api/notifications?${params.toString()}`);
        const data = (await res.json()) as ListResponse;
        if (!res.ok || !data.ok) {
          setState({ status: 'error', text: data.error ?? '通知加载失败' });
          return;
        }
        setState({
          status: 'ready',
          items: data.notifications ?? [],
          total: Number(data.total ?? 0),
          unread: Number(data.unread ?? 0),
        });
      } catch {
        setState({ status: 'error', text: '网络错误，请稍后重试' });
      }
    },
    [],
  );

  useEffect(() => {
    void load(offset, unreadOnly);
  }, [load, offset, unreadOnly]);

  async function markRead(id: number) {
    setPending(`read-${id}`);
    setMsg(null);
    try {
      const res = await csrfFetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMsg({ kind: 'err', text: data.error ?? '标记已读失败' });
        return;
      }
      // 本地同步该条状态，避免整表重拉。
      // 注意「仅未读」视图下，标记已读后该条已不符合筛选条件 —— 必须移除，
      // 否则会留下一条永远显示「已读」的记录（再次点击标记已读也无意义）。
      setState((prev) =>
        prev.status === 'ready'
          ? {
              ...prev,
              unread: Math.max(0, prev.unread - 1),
              items: unreadOnly
                ? prev.items.filter((n) => n.id !== id)
                : prev.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
            }
          : prev,
      );
    } catch {
      setMsg({ kind: 'err', text: '网络错误，请重试' });
    } finally {
      setPending(null);
    }
  }

  async function markAllRead() {
    setPending('read-all');
    setMsg(null);
    try {
      const res = await csrfFetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMsg({ kind: 'err', text: data.error ?? '全部标记已读失败' });
        return;
      }
      await load(offset, unreadOnly);
      setMsg({ kind: 'ok', text: '已全部标记为已读' });
    } catch {
      setMsg({ kind: 'err', text: '网络错误，请重试' });
    } finally {
      setPending(null);
    }
  }

  async function removeOne(id: number) {
    setPending(`del-${id}`);
    setMsg(null);
    try {
      const res = await csrfFetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMsg({ kind: 'err', text: data.error ?? '删除失败' });
        return;
      }
      await load(offset, unreadOnly);
    } catch {
      setMsg({ kind: 'err', text: '网络错误，请重试' });
    } finally {
      setPending(null);
    }
  }

  async function clearAll() {
    if (!window.confirm('确定要清空全部通知吗？此操作不可撤销。')) return;
    setPending('clear');
    setMsg(null);
    try {
      const res = await csrfFetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMsg({ kind: 'err', text: data.error ?? '清空失败' });
        return;
      }
      setOffset(0);
      await load(0, unreadOnly);
      setMsg({ kind: 'ok', text: '通知已清空' });
    } catch {
      setMsg({ kind: 'err', text: '网络错误，请重试' });
    } finally {
      setPending(null);
    }
  }

  const unread = state.status === 'ready' ? state.unread : 0;
  const total = state.status === 'ready' ? state.total : 0;
  const items = state.status === 'ready' ? state.items : [];
  const hasMore = items.length === PAGE_SIZE;

  return (
    <div className="notifications-list">
      <div className="cell tab-alt-container">
        <div className="fr">
          <span className="f12 gray">共 {total} 条 · 未读 {unread}</span>
        </div>

        <button
          type="button"
          className={`tab-alt${unreadOnly ? '' : ' active'}`}
          onClick={() => {
            setUnreadOnly(false);
            setOffset(0);
          }}
          aria-pressed={!unreadOnly}
        >
          全部
        </button>
        <button
          type="button"
          className={`tab-alt${unreadOnly ? ' active' : ''}`}
          onClick={() => {
            setUnreadOnly(true);
            setOffset(0);
          }}
          aria-pressed={unreadOnly}
        >
          仅未读
        </button>
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

      {state.status === 'loading' ? (
        <div className="cell">
          <span className="fade">正在加载通知…</span>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="cell">
          <div className="problem" role="alert">
            {state.text}
          </div>
          <button
            type="button"
            className="button"
            onClick={() => void load(offset, unreadOnly)}
            aria-label="重新加载通知"
          >
            重新加载
          </button>
        </div>
      ) : null}

      {state.status === 'ready' && items.length === 0 ? (
        <div className="cell">
          <span className="fade">{unreadOnly ? '没有未读通知' : '暂无通知'}</span>
        </div>
      ) : null}

      {state.status === 'ready' && items.length > 0 ? (
        <>
          {items.map((n) => {
            const href = n.topicId
              ? `/t/${n.topicId}${n.replyId ? `#reply${n.replyId}` : ''}`
              : null;
            return (
              <div key={n.id} className="cell">
                <div className="fr f12 gray">
                  <span className="badge">{TYPE_LABELS[n.type] ?? n.type}</span>{' '}
                  <span title={new Date(n.createdAt).toLocaleString('zh-CN')}>
                    {relativeTime(n.createdAt)}
                  </span>
                </div>

                <div>
                  {href ? <Link href={href}>{n.message}</Link> : <span>{n.message}</span>}
                  {!n.read ? <span className="badge pro" style={{ marginLeft: 6 }}>新</span> : null}
                </div>

                <div className="reply_row">
                  {!n.read ? (
                    <button
                      type="button"
                      className="button"
                      onClick={() => void markRead(n.id)}
                      disabled={pending === `read-${n.id}`}
                      aria-label="标记为已读"
                    >
                      {pending === `read-${n.id}` ? '处理中…' : '标记已读'}
                    </button>
                  ) : null}{' '}
                  <button
                    type="button"
                    className="button"
                    onClick={() => void removeOne(n.id)}
                    disabled={pending === `del-${n.id}`}
                    aria-label="删除这条通知"
                  >
                    {pending === `del-${n.id}` ? '删除中…' : '删除'}
                  </button>
                </div>
              </div>
            );
          })}

          <div className="cell">
            <button
              type="button"
              className="button"
              onClick={() => void markAllRead()}
              disabled={pending === 'read-all' || unread === 0}
              title={unread === 0 ? '没有未读通知' : undefined}
              aria-label="全部标记为已读"
            >
              {pending === 'read-all' ? '处理中…' : '全部标记已读'}
            </button>{' '}
            <button
              type="button"
              className="button"
              onClick={() => void clearAll()}
              disabled={pending === 'clear' || total === 0}
              title={total === 0 ? '没有通知' : undefined}
              aria-label="清空全部通知"
            >
              {pending === 'clear' ? '清空中…' : '清空全部'}
            </button>
          </div>

          <div className="cell ps_container">
            <div style={{ textAlign: 'center' }}>
              {offset > 0 ? (
                <button
                  type="button"
                  className="page_normal"
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
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
              <span className="page_current">{Math.floor(offset / PAGE_SIZE) + 1}</span>{' '}
              {hasMore ? (
                <button
                  type="button"
                  className="page_normal"
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
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
    </div>
  );
}
