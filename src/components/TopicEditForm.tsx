'use client';

import { useState, useEffect } from 'react';
import { csrfFetch } from '@/components/CsrfProvider';

/**
 * 主题编辑模态框（v0.0.4）
 *
 * 存在的理由 —— 修复一个**假按钮**：
 *   v0.0.3 的 TopicActions 渲染了「编辑」按钮，`onClick={onEdit}`，
 *   但主题详情页（服务端组件）**无法向客户端组件传函数**，
 *   于是 onEdit 永远是 undefined —— 按钮点了**什么都不发生**。
 *   该端点（PUT /api/topics/[id]）明明已实现并可用，
 *   但用户从界面上**根本触达不到**。
 *
 * 为什么用模态框而不是内联表单：
 *   内联在主题内容区里的表单，会被正文的浮动元素覆盖 ——
 *   实测「保存修改」按钮被 <strong class="snow">•</strong> 拦截了指针事件，
 *   点击永远落不上去。fixed 模态脱离文档流，不存在层叠竞争。
 *
 * 鉴权与编辑时限由服务端强制（见 content-service.ts 的 editTopic）：
 *   - 只有作者本人或管理角色能改
 *   - 编辑窗口（TOPIC_EDIT_WINDOW_MINUTES）之外普通用户不能改
 */

export type TopicEditFormProps = {
  topicId: number;
  /** 初始内容（纯文本，服务端已剥离 HTML） */
  initialContent: string;
  /** 标题（仅管理角色可改，普通用户只改内容） */
  initialTitle: string;
  /** 是否可改标题 —— 管理角色才允许改标题 */
  canEditTitle: boolean;
  /** 关闭模态的回调 */
  onDone?: () => void;
};

export default function TopicEditForm({
  topicId,
  initialContent,
  initialTitle,
  canEditTitle,
  onDone,
}: TopicEditFormProps) {
  const [content, setContent] = useState(initialContent);
  const [title, setTitle] = useState(initialTitle);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESC 关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onDone?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone, pending]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const payload: { content: string; title?: string } = { content: content.trim() };
      if (canEditTitle) payload.title = title.trim();

      const res = await csrfFetch(`/api/topics/${topicId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        setError(data.error ?? '保存失败，请重试');
        return;
      }

      // 成功后重新取数（服务端组件需要刷新才能显示新内容）
      window.location.reload();
      onDone?.();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="topic_edit_modal"
      role="dialog"
      aria-modal="true"
      aria-label="编辑主题"
      onClick={(e) => {
        // 点击遮罩关闭
        if (e.target === e.currentTarget && !pending) onDone?.();
      }}
    >
      <div className="topic_edit_panel">
        <h3>编辑主题</h3>
        <form onSubmit={submit}>
          {canEditTitle && (
            <div style={{ marginBottom: '12px' }}>
              <label htmlFor={`topic-title-${topicId}`}>标题</label>
              <input
                id={`topic-title-${topicId}`}
                type="text"
                name="title"
                maxLength={128}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
          )}
          <div style={{ marginBottom: '12px' }}>
            <label htmlFor={`topic-content-${topicId}`}>内容</label>
            <textarea
              id={`topic-content-${topicId}`}
              name="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              minLength={2}
              maxLength={20000}
              rows={10}
            />
          </div>
          {error && (
            <div className="topic_edit_error" role="alert">
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" className="button" disabled={pending}>
              {pending ? '保存中…' : '保存修改'}
            </button>
            <button type="button" className="button" onClick={onDone} disabled={pending}>
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
