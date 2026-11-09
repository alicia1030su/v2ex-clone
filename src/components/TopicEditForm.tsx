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
 *
 * ## v0.0.14：标签「可增可减」
 *
 * 此前标签只能加、不能减 —— 用户在编辑框里没有任何办法去掉一个打错的标签。
 * 现在表单同时提交两个字段（服务端 `PUT /api/topics/[id]` 契约）：
 *
 * | 字段 | 语义 |
 * |---|---|
 * | `tags` | **追加**（不清空历史标签） |
 * | `removeTags` | **显式移除**（只删本条主题的关联行） |
 *
 * 两者可同时出现：服务端顺序是「先移除、再追加」，因此
 * 「删一个、加一个」在满额（已有 5 个）时也能成功 —— 若反过来先加，
 * 追加会被总量上限直接丢弃，用户看到的是「加了没反应」。
 *
 * ## 表单 `name` 的约束（V4-20 教训，**不要改**）
 *
 * `HTMLFormElement` 带 `[OverrideBuiltins]`：表单内命名控件会**遮蔽**原型上的
 * 同名属性。于是 `name="title"` / `name="id"` / `name="nodeName"` 会让
 * `form.title` 变成 HTMLInputElement，而 React 19 的水合代码里有
 * `instance.nodeName.toLowerCase()` —— 一遮蔽就抛 TypeError ⇒ 水合失败（#418）
 * ⇒ 事件处理器不绑定 ⇒ 表单退化成浏览器原生提交（写操作彻底失效）。
 *
 * 因此本表单的标签输入框用 `name="topic_tags_add"`：
 * 既不是 DOM 属性名，也不与正文/标题字段重名。
 * 回归测试见 `tests/form-name-shadowing.spec.ts`。
 */

export type TopicEditFormProps = {
  topicId: number;
  /** 初始内容（纯文本，服务端已剥离 HTML） */
  initialContent: string;
  /** 标题（仅管理角色可改，普通用户只改内容） */
  initialTitle: string;
  /** 是否可改标题 —— 管理角色才允许改标题 */
  canEditTitle: boolean;
  /**
   * 主题当前已有的标签名（v0.0.14）。
   *
   * 由服务端读库后传入（`loadTagNames`），本组件**不自己取数** ——
   * 客户端再发一次请求既慢又多一处可能漂移的实现。
   */
  initialTags?: string[];
  /** 关闭模态的回调 */
  onDone?: () => void;
};

export default function TopicEditForm({
  topicId,
  initialContent,
  initialTitle,
  canEditTitle,
  initialTags = [],
  onDone,
}: TopicEditFormProps) {
  const [content, setContent] = useState(initialContent);
  const [title, setTitle] = useState(initialTitle);
  /** 待提交的「追加标签」文本（逗号分隔，与发帖表单口径一致） */
  const [tagsToAdd, setTagsToAdd] = useState('');
  /**
   * 待提交的「移除标签」。
   *
   * 用「集合 + 点击切换」而不是「点了就消失」：误点一次可以点回去，
   * 不必关掉模态重新打开（标签一旦提交就真的从库里删掉了）。
   */
  const [tagsToRemove, setTagsToRemove] = useState<string[]>([]);
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

  function toggleRemove(tag: string) {
    setTagsToRemove((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const payload: {
        content: string;
        title?: string;
        tags?: string;
        removeTags?: string[];
      } = { content: content.trim() };
      if (canEditTitle) payload.title = title.trim();

      // 只提交「非空」的变更字段：空字符串提交给服务端等于「什么都不改」，
      // 但会让请求体里出现无意义的 `tags: ''`，排查时容易误判成"提交了标签"。
      const addTrimmed = tagsToAdd.trim();
      if (addTrimmed !== '') payload.tags = addTrimmed;
      if (tagsToRemove.length > 0) payload.removeTags = tagsToRemove;

      const res = await csrfFetch(`/api/topics/${topicId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        /** 服务端回显**库里最终**的标签（不是本次输入） */
        tags?: string[];
      };

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

  const hasAnyTag = initialTags.length > 0;

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
        {/* v0.0.4（V4-20）：name 不得与 HTMLFormElement 的 DOM 属性同名 —— 详见 NodeRequestForm 的说明。 */}
        <form onSubmit={submit}>
          {canEditTitle && (
            <div style={{ marginBottom: '12px' }}>
              <label htmlFor={`topic-title-${topicId}`}>标题</label>
              <input
                id={`topic-title-${topicId}`}
                type="text"
                name="topic_title"
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

          {/* v0.0.14：当前标签 + 移除入口（此前只能加不能减） */}
          <div style={{ marginBottom: '12px' }}>
            <span id={`topic-tags-${topicId}`}>标签</span>
            {hasAnyTag ? (
              <div
                className="topic_edit_tag_chips"
                role="group"
                aria-labelledby={`topic-tags-${topicId}`}
                style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}
              >
                {initialTags.map((tag) => {
                  const removed = tagsToRemove.includes(tag);
                  return (
                    <span
                      key={tag}
                      className="topic_edit_tag_chip"
                      data-tag={tag}
                      data-removed={removed ? 'true' : 'false'}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 6px',
                        border: '1px solid currentColor',
                        borderRadius: '3px',
                        opacity: removed ? 0.45 : 1,
                        textDecoration: removed ? 'line-through' : 'none',
                      }}
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        className="button"
                        aria-label={removed ? `撤销移除标签 ${tag}` : `移除标签 ${tag}`}
                        aria-pressed={removed}
                        disabled={pending}
                        onClick={() => toggleRemove(tag)}
                        style={{ padding: '0 4px', lineHeight: 1.2 }}
                      >
                        {removed ? '↺' : '×'}
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <span className="fade" style={{ marginLeft: '6px' }}>
                暂无标签
              </span>
            )}
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label htmlFor={`topic-tags-add-${topicId}`}>追加标签</label>
            <input
              id={`topic-tags-add-${topicId}`}
              type="text"
              /* ⚠️ 不要改成 `name="tags"`：虽然 `tags` 不是 HTMLFormElement 的
                 DOM 属性，但本仓的约定是「表单控件名不得与提交字段外的语义名重合」，
                 且 E2E 用这个 name 定位。见文件头 V4-20 说明。 */
              name="topic_tags_add"
              value={tagsToAdd}
              onChange={(e) => setTagsToAdd(e.target.value)}
              placeholder="逗号分隔，最多共 5 个"
              maxLength={200}
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
