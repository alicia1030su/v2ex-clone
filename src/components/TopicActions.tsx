'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { csrfFetch } from '@/components/CsrfProvider';
import TopicEditForm from '@/components/TopicEditForm';

/**
 * 主题操作栏（v0.0.3）
 *
 * 提供：投票、编辑、软删除、管理操作（锁定/置顶/恢复）。
 *
 * ## 权限与交互
 *
 * - **服务端是唯一权威**：本组件只根据服务端返回的 `canEdit` 等标记
 *   决定是否渲染按钮，但真正的鉴权在 API 层完成。
 *   前端隐藏按钮只是体验优化，不是安全措施。
 * - 每个操作都有 **加载态 / 错误态 / 禁用态**。
 * - 操作成功后用 `router.refresh()` 让服务端组件重新取数，
 *   保证计数与状态与数据库一致（不靠前端乐观更新）。
 */

export type TopicActionUser = {
  id: number;
  role: 'user' | 'moderator' | 'admin';
};

export type TopicActionState = {
  topicId: number;
  locked: boolean;
  pinned: boolean;
  deleted: boolean;
  edited: boolean;
  editCount: number;
  votes: number;
  myVote: 'up' | 'down' | null;
  canEdit: boolean;
  canDelete: boolean;
  canModerate: boolean;
};

type Props = {
  topic: TopicActionState;
  user: TopicActionUser | null;
  /**
   * 编辑回调（可选）。
   *
   * ⚠️ v0.0.4：这个回调**从来没被页面传过**（服务端组件无法向客户端组件
   * 传函数），导致「编辑」按钮点了什么都不响应 —— 一个假按钮。
   * 现在编辑表单由组件内部管理（见 editing 状态），
   * onEdit 仅作为向后兼容的可选钩子保留。
   */
  onEdit?: () => void;
  /** 删除后的回调 */
  onDeleted?: () => void;
  /** 编辑表单的初始内容（纯文本） */
  initialContent?: string;
  /** 编辑表单的初始标题 */
  initialTitle?: string;
  /**
   * 编辑表单的初始标签（v0.0.14）。
   *
   * 由页面从 `loadTagNames(topicId)` 传入 —— 本组件**不自己取数**，
   * 也不做默认以外的推断：默认 `[]` 让调用方未接线时表单仍可用（只是没有
   * 可移除的标签 chips），不会因为少传一个 prop 就崩掉编辑入口。
   */
  initialTags?: string[];
};

export default function TopicActions({
  topic,
  user,
  onEdit,
  onDeleted,
  initialContent = '',
  initialTitle = '',
  initialTags = [],
}: Props) {
  // v0.0.5：删除后用 `router.refresh()` 让服务端组件重新渲染
  // （见 remove() 内的注释）—— 不用 `window.location.reload()`，
  // 后者会与正在进行/随后的导航抢同一个导航槽位。
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [votes, setVotes] = useState(topic.votes);
  const [myVote, setMyVote] = useState(topic.myVote);
  const [locked, setLocked] = useState(topic.locked);
  const [pinned, setPinned] = useState(topic.pinned);
  /** 编辑表单是否展开（v0.0.4：编辑入口必须真的能用，不能是假按钮） */
  const [editing, setEditing] = useState(false);

  async function act<T = Record<string, unknown>>(
    key: string,
    url: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body?: unknown,
  ): Promise<T | null> {
    setPending(key);
    setError(null);
    try {
      const res = await csrfFetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        [k: string]: unknown;
      };
      if (!res.ok || data.ok === false) {
        setError(data.error ?? `操作失败（HTTP ${res.status}）`);
        return null;
      }
      return data as T;
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
      return null;
    } finally {
      setPending(null);
    }
  }

  async function vote(direction: 'up' | 'down') {
    const res = await act<{ votes: number; myVote: 'up' | 'down' | null }>(
      'vote',
      '/api/votes',
      'POST',
      { topicId: topic.topicId, direction },
    );
    if (res) {
      setVotes(Number(res.votes ?? votes));
      setMyVote((res.myVote as 'up' | 'down' | null) ?? direction);
    }
  }

  async function unvote() {
    const res = await act<{ votes: number }>('vote', '/api/votes', 'DELETE', {
      topicId: topic.topicId,
    });
    if (res) {
      setVotes(Number(res.votes ?? votes));
      setMyVote(null);
    }
  }

  async function remove() {
    if (!window.confirm('确定要删除这个主题吗？删除后可以由管理员恢复。')) return;
    const res = await act('delete', `/api/topics/${topic.topicId}`, 'DELETE', {});
    if (!res) return;

    // v0.0.5：删除成功后**必须让 UI 反映新状态**。
    //
    // 原实现只调 `onDeleted?.()`，而页面从来没传过这个回调
    // （服务端组件无法向客户端组件传函数），结果：
    //   删除成功 → 服务端已软删除 → 但页面 `topic.deleted` 仍是 false
    //   ⇒ 「恢复」按钮永远不出现 ⇒ 用户必须手动刷新才能恢复
    // 这是 v0.0.5 E2E 实测发现的真实缺陷（`FEATURE_AUDIT_v0.0.5.md` §二）。
    //
    // 修法：有回调就交给回调；没有回调（当前所有调用方）就
    // **`router.refresh()`** —— 让服务端组件用新数据重新渲染。
    //
    // ⚠️ v0.0.5：最初用的是 `window.location.reload()`，但它会引发
    // **导航竞态**：整页 reload 与测试/用户的后续 `page.goto()`
    // 抢同一个导航 ⇒ Playwright 报
    // `Navigation to "/" is interrupted by another navigation to "/t/221"`。
    //
    // `router.refresh()` 只重新拉取**服务端组件**的数据（不换 URL、
    // 不重置客户端状态），既能刷新「恢复」按钮的出现，又不会打断任何
    // 正在进行或随后的导航。
    if (onDeleted) {
      onDeleted();
    } else {
      router.refresh();
    }
  }

  async function restore() {
    const res = await act('restore', `/api/topics/${topic.topicId}/restore`, 'POST', {});
    if (res) {
      // v0.0.6：与 remove() 保持一致用 router.refresh()。
      // window.location.reload() 会引发导航竞态（v0.0.5 在 remove() 上
      // 实测过：整页 reload 与后续 page.goto() 抢同一个导航槽位）。
      if (onDeleted) {
        onDeleted();
      } else {
        router.refresh();
      }
    }
  }

  async function toggleLock() {
    const slug = locked ? 'unlock' : 'lock';
    const res = await act(slug, `/api/topics/${topic.topicId}/${slug}`, 'POST', {});
    if (res) setLocked(!locked);
  }

  async function togglePin() {
    const slug = pinned ? 'unpin' : 'pin';
    const res = await act(slug, `/api/topics/${topic.topicId}/${slug}`, 'POST', {});
    if (res) setPinned(!pinned);
  }

  if (!user) return null;

  return (
    <>
      <div className="topic_actions" role="group" aria-label="主题操作">
      {/* 投票 */}
      <button
        type="button"
        className="button"
        aria-pressed={myVote === 'up'}
        aria-label="赞同"
        disabled={pending === 'vote'}
        onClick={() => (myVote ? unvote() : vote('up'))}
      >
        {myVote === 'up' ? '✓ ' : ''}赞 {votes > 0 ? votes : ''}
      </button>

        {topic.canEdit && (
          <button
            type="button"
            className="button"
            disabled={pending === 'edit'}
            onClick={() => {
              setEditing(!editing);
              onEdit?.();
            }}
            aria-label="编辑主题"
            aria-expanded={editing}
          >
            {topic.edited ? `编辑 (${topic.editCount})` : '编辑'}
          </button>
        )}

      {topic.canDelete && (
        <button
          type="button"
          className="button"
          disabled={pending === 'delete'}
          onClick={remove}
          aria-label="删除主题"
        >
          删除
        </button>
      )}

      {topic.canModerate && topic.deleted && (
        <button
          type="button"
          className="button"
          disabled={pending === 'restore'}
          onClick={restore}
          aria-label="恢复主题"
        >
          恢复
        </button>
      )}

      {topic.canModerate && !topic.deleted && (
        <>
          <button
            type="button"
            className="button"
            disabled={pending === 'lock'}
            onClick={toggleLock}
            aria-label={locked ? '解锁主题' : '锁定主题'}
          >
            {locked ? '解锁' : '锁定'}
          </button>
          <button
            type="button"
            className="button"
            disabled={pending === 'pin'}
            onClick={togglePin}
            aria-label={pinned ? '取消置顶' : '置顶主题'}
          >
            {pinned ? '取消置顶' : '置顶'}
          </button>
        </>
      )}

        {error && (
          <span className="fade" role="alert" style={{ marginLeft: '8px' }}>
            {error}
          </span>
        )}
      </div>

      {/* v0.0.4：编辑模态框 —— 修复「编辑」按钮点了没反应的假按钮问题。
          用 fixed 模态而非内联表单，避免被正文浮动元素遮挡导致点不到。 */}
      {editing && topic.canEdit && (
        <TopicEditForm
          topicId={topic.topicId}
          initialContent={initialContent}
          initialTitle={initialTitle}
          initialTags={initialTags}
          canEditTitle={topic.canModerate}
          onDone={() => setEditing(false)}
        />
      )}
    </>
  );
}
