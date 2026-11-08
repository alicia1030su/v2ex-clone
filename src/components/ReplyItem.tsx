'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { csrfFetch } from '@/components/CsrfProvider';
import ReportButton from '@/components/ReportButton';

/**
 * 回复项（v0.0.3）
 *
 * 提供：楼层锚点、引用跳转、感谢/取消感谢、编辑、软删除、管理员恢复。
 * v0.0.5：新增**举报**入口（ReportButton）。
 *
 * 与主题操作栏一致：前端只负责交互，鉴权与计数一致性由服务端保证。
 */

export type ReplyData = {
  id: number;
  floor: number;
  content: string;
  thanks: number;
  edited: boolean;
  editCount: number;
  deleted: boolean;
  quoteId: number | null;
  authorId: number;
  authorName: string;
  createdAt: string;
};

export type ReplyUser = {
  id: number;
  role: 'user' | 'moderator' | 'admin';
};

type Props = {
  reply: ReplyData;
  user: ReplyUser | null;
  /** 我是否已感谢过这条回复 */
  thanked: boolean;
  /** 被引用的回复（用于显示引用预览） */
  quoted?: { floor: number; authorName: string; excerpt: string } | null;
  /** 主题是否锁定（锁定时禁止回复操作） */
  topicLocked?: boolean;
  onChanged?: () => void;
  /**
   * 是否由本组件渲染正文。
   * false = 只渲染操作区（正文由页面用 markdown_body 渲染，保持原站视觉结构）。
   */
  renderContent?: boolean;
};

export default function ReplyItem({
  reply,
  user,
  thanked,
  quoted,
  topicLocked,
  onChanged,
  renderContent = false,
}: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(reply.thanks);
  const [isThanked, setIsThanked] = useState(thanked);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reply.content);
  // v0.0.6：恢复后用 router.refresh() 刷新服务端组件
  // （window.location.reload() 会引发导航竞态，同 TopicActions.remove()）
  const router = useRouter();

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

  async function toggleThanks() {
    const res = await act<{ thanks: number }>(
      'thanks',
      '/api/thanks',
      isThanked ? 'DELETE' : 'POST',
      { replyId: reply.id },
    );
    if (res) {
      setThanks(Number(res.thanks ?? thanks));
      setIsThanked(!isThanked);
    }
  }

  async function saveEdit() {
    const res = await act('edit', `/api/replies/${reply.id}`, 'PUT', {
      content: draft,
    });
    if (res) {
      setEditing(false);
      onChanged?.();
    }
  }

  async function remove() {
    if (!window.confirm('确定要删除这条回复吗？')) return;
    const res = await act('remove', `/api/replies/${reply.id}`, 'DELETE', {});
    if (res) onChanged?.();
  }

  async function restore() {
    const res = await act(
      'restore',
      `/api/replies/${reply.id}/restore`,
      'POST',
      {},
    );
    if (res) {
      // v0.0.6：router.refresh() 只重新拉取服务端组件数据，
      // 不换 URL、不重置客户端状态，也不会与后续导航抢槽位。
      router.refresh();
    }
  }

  const isAuthor = user?.id === reply.authorId;
  const isStaff = user?.role === 'moderator' || user?.role === 'admin';
  const canModify = !!user && (isAuthor || isStaff);

  return (
    <div className="reply-actions" id={`reply${reply.floor}`}>
      <div>
        {/* v0.0.6：楼层 / 作者 / 时间由**页面**渲染（对应原站楼层结构），
            此处不再重复渲染 —— 原实现让同一组信息在主题页出现两遍。
            仅保留本组件独有的「已编辑」标记与引用预览。 */}
        {reply.edited && !reply.deleted && (
          <span className="fade" style={{ fontSize: '12px' }}>
            （已编辑 {reply.editCount} 次）
          </span>
        )}

        {quoted && (
          <div className="reply_row">
            <a href={`#reply${quoted.floor}`} className="gray">
              ↪ 引用 {quoted.floor} 楼（{quoted.authorName}）：{quoted.excerpt}
            </a>
          </div>
        )}

        {reply.deleted ? (
          <div className="reply_row fade">此回复已被删除</div>
        ) : editing ? (
          <div className="reply_row">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              style={{ width: '100%' }}
              aria-label="编辑回复内容"
            />
            <div className="reply_row">
              <button
                type="button"
                className="button"
                onClick={saveEdit}
                disabled={pending === 'edit'}
              >
                保存
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setDraft(reply.content);
                  setEditing(false);
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : renderContent ? (
          <div className="topic_content">
            <div className="reply_row">{reply.content}</div>
          </div>
        ) : null}

        {/* 操作区 */}
        {!reply.deleted && (
          <div className="reply_row">
            <button
              type="button"
              className="button"
              onClick={toggleThanks}
              disabled={pending === 'thanks' || !user || isAuthor}
              aria-pressed={isThanked}
              aria-label={isThanked ? '取消感谢' : '感谢这条回复'}
              title={isAuthor ? '不能感谢自己的回复' : undefined}
            >
              {isThanked ? '已感谢' : '感谢'} {thanks > 0 ? thanks : ''}
            </button>

            {canModify && !topicLocked && (
              <button
                type="button"
                className="button"
                onClick={() => setEditing(true)}
                disabled={pending === 'edit'}
                aria-label="编辑回复"
              >
                编辑
              </button>
            )}

            {canModify && (
              <button
                type="button"
                className="button"
                onClick={remove}
                disabled={pending === 'remove'}
                aria-label="删除回复"
              >
                删除
              </button>
            )}

            {/* v0.0.5：举报入口 —— 未登录时点击会引导去登录；
                作者本人不应看到（服务端也会拒绝） */}
            {!isAuthor && <ReportButton target="reply" id={reply.id} />}
          </div>
        )}

        {reply.deleted && isStaff && (
          <div className="reply_row">
            <button
              type="button"
              className="button"
              onClick={restore}
              disabled={pending === 'restore'}
              aria-label="恢复回复"
            >
              恢复
            </button>
          </div>
        )}

        {error && (
          <div className="reply_row">
            <span className="fade" role="alert">
              {error}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
