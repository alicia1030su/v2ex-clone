'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReplyItem from '@/components/ReplyItem';
import ReplyComposer, {
  type ReplyParentTarget,
} from '@/components/ReplyComposer';
import { csrfFetch } from '@/components/CsrfProvider';
import type { CreatedReplyPayload } from '@/server/reply-submissions';
import type { ReplyDisplayMode } from '@/server/reply-preferences';

export type ReplyListItem = {
  id: number;
  floor: number;
  content: string;
  html: string;
  thanks: number;
  edited: boolean;
  editCount: number;
  deleted: boolean;
  quoteId: number | null;
  parentReplyId: number | null;
  authorId: number;
  authorName: string;
  authorAvatarUrl: string;
  createdAtLabel: string;
};

export type ReplyParentSummary = {
  id: number;
  floor: number;
  authorName: string | null;
  excerpt: string | null;
  deleted: boolean;
  inaccessible: boolean;
  createdAt: string | null;
};

type CurrentUser = {
  id: number;
  username: string;
  role: 'user' | 'moderator' | 'admin';
  avatarUrl: string;
};

type Props = {
  topicId: number;
  topicLocked: boolean;
  initialItems: ReplyListItem[];
  initialParents: Record<string, ReplyParentSummary>;
  initialTotal: number;
  initialMode: ReplyDisplayMode;
  currentUser: CurrentUser | null;
  thankedIds: number[];
};

type ContextResponse = {
  ok?: boolean;
  error?: string;
  parentChain?: ReplyParentSummary[];
  childrenTotal?: number;
  children?: Array<ReplyParentSummary & {
    content: string;
    html: string;
    authorId: number;
    authorAvatarUrl: string;
    parentReplyId: number | null;
    thanks: number;
    quoteId: number | null;
  }>;
};

const MODE_OPTIONS: Array<{ value: ReplyDisplayMode; label: string }> = [
  { value: 'classic', label: '经典平铺' },
  { value: 'quote', label: '引用条' },
  { value: 'badge', label: '角标与预览' },
  { value: 'nested', label: '楼中楼' },
  { value: 'tree', label: '树形缩进' },
  { value: 'lines', label: '对话连线' },
  { value: 'excerpt', label: '引用楼层' },
];

const LOCAL_MODE_KEY = 'v2ex-reply-display-mode';
const MAX_TREE_DEPTH = 4;

function contextChildToItem(child: NonNullable<ContextResponse['children']>[number]): ReplyListItem {
  return {
    id: child.id,
    floor: child.floor,
    content: child.content,
    html: child.html,
    thanks: child.thanks,
    edited: false,
    editCount: 0,
    deleted: child.deleted,
    quoteId: child.quoteId,
    parentReplyId: child.parentReplyId,
    authorId: child.authorId,
    authorName: child.authorName ?? '未知用户',
    authorAvatarUrl: child.authorAvatarUrl,
    createdAtLabel: '刚刚',
  };
}

function ParentReference({
  parent,
  mode,
  active,
  onActivate,
  onLoadContext,
}: {
  parent: ReplyParentSummary;
  mode: ReplyDisplayMode;
  active: boolean;
  onActivate: () => void;
  onLoadContext: () => void;
}) {
  if (parent.inaccessible) {
    return <div className="reply-parent-reference is-inaccessible">父回复不可见</div>;
  }
  if (parent.deleted) {
    return <div className="reply-parent-reference is-deleted">父回复已删除</div>;
  }
  if (mode === 'badge') {
    return (
      <span className="reply-parent-badge-wrap">
        <button
          type="button"
          className="reply-parent-badge"
          aria-expanded={active}
          onClick={onActivate}
          onMouseEnter={onActivate}
          onFocus={onActivate}
        >
          #{parent.floor}
        </button>
        {active ? (
          <span className="reply-parent-popover" role="tooltip">
            <strong>#{parent.floor} {parent.authorName}</strong>
            <span>{parent.excerpt}</span>
          </span>
        ) : null}
      </span>
    );
  }
  if (mode === 'excerpt') {
    return (
      <details className="reply-parent-excerpt" onToggle={onLoadContext}>
        <summary>引用 #{parent.floor} {parent.authorName}</summary>
        <blockquote>{parent.excerpt}</blockquote>
      </details>
    );
  }
  return (
    <div className="reply-parent-reference">
      <span>↪ 引用 #{parent.floor}（{parent.authorName}）</span>
      {parent.excerpt ? <span className="reply-parent-excerpt-text">：{parent.excerpt}</span> : null}
      <button type="button" className="reply-context-link" onClick={onLoadContext}>查看上下文</button>
    </div>
  );
}

export default function ReplyList({
  topicId,
  topicLocked,
  initialItems,
  initialParents,
  initialTotal,
  initialMode,
  currentUser,
  thankedIds,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [parents] = useState(initialParents);
  const [total, setTotal] = useState(initialTotal);
  const [mode, setMode] = useState<ReplyDisplayMode>(initialMode);
  const [parentTarget, setParentTarget] = useState<ReplyParentTarget | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [badgePreview, setBadgePreview] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [loadedChildren, setLoadedChildren] = useState<Record<number, ReplyListItem[]>>({});
  const [childrenTotals, setChildrenTotals] = useState<Record<number, number>>({});
  const [childCursors, setChildCursors] = useState<Record<number, number>>({});
  const [contextFor, setContextFor] = useState<number | null>(null);
  const [contextChain, setContextChain] = useState<Record<number, ReplyParentSummary[]>>({});
  const [contextLoading, setContextLoading] = useState<number | null>(null);

  useEffect(() => {
    if (currentUser) return;
    try {
      const saved = window.localStorage.getItem(LOCAL_MODE_KEY);
      if (saved && MODE_OPTIONS.some((option) => option.value === saved)) {
        setMode(saved as ReplyDisplayMode);
      }
    } catch {
      /* 本地偏好不可用时保持经典模式 */
    }
  }, [currentUser]);

  useEffect(() => {
    const node = document.getElementById('reply-total-count');
    if (node) node.textContent = String(total);
  }, [total]);

  const allItems = useMemo(() => {
    const seen = new Set<number>();
    const result: ReplyListItem[] = [];
    for (const item of [...items, ...Object.values(loadedChildren).flat()]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        result.push(item);
      }
    }
    return result;
  }, [items, loadedChildren]);

  const itemById = useMemo(
    () => new Map(allItems.map((item) => [item.id, item])),
    [allItems],
  );

  const childrenByParent = useMemo(() => {
    const map = new Map<number, ReplyListItem[]>();
    for (const item of allItems) {
      if (item.parentReplyId === null) continue;
      const list = map.get(item.parentReplyId) ?? [];
      list.push(item);
      map.set(item.parentReplyId, list);
    }
    return map;
  }, [allItems]);

  function persistMode(next: ReplyDisplayMode) {
    setMode(next);
    try {
      window.localStorage.setItem(LOCAL_MODE_KEY, next);
    } catch {
      /* 服务端用户仍会保存成功 */
    }
    if (!currentUser) return;
    void csrfFetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyDisplayMode: next }),
    }).then(async (res) => {
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setMode(initialMode);
        setNotice(data?.error ?? '模式保存失败，已恢复服务端偏好');
      }
    }).catch(() => {
      setMode(initialMode);
      setNotice('模式保存失败，已恢复服务端偏好');
    });
  }

  function chooseParent(item: ReplyListItem) {
    if (dirty) {
      setNotice('已输入内容，保留原回复目标；请先取消关联后再切换楼层。');
      return;
    }
    setParentTarget({ id: item.id, floor: item.floor, authorName: item.authorName });
    setNotice('');
    window.setTimeout(() => document.getElementById('reply-content')?.focus(), 0);
  }

  async function loadContext(replyId: number) {
    setContextLoading(replyId);
    setContextFor(replyId);
    try {
      const res = await fetch(`/api/topics/${topicId}/replies/${replyId}/context`, { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as ContextResponse | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? '上下文加载失败');
      setContextChain((prev) => ({ ...prev, [replyId]: data.parentChain ?? [] }));
      setChildrenTotals((prev) => ({ ...prev, [replyId]: Number(data.childrenTotal ?? 0) }));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '上下文加载失败');
    } finally {
      setContextLoading(null);
    }
  }

  async function loadChildren(parentId: number) {
    const cursor = childCursors[parentId] ?? 0;
    setContextLoading(parentId);
    try {
      const suffix = cursor > 0 ? `?cursor=${cursor}` : '';
      const res = await fetch(`/api/topics/${topicId}/replies/${parentId}/context${suffix}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as ContextResponse | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? '楼中楼加载失败');
      const children = (data.children ?? []).map(contextChildToItem);
      setLoadedChildren((prev) => {
        const existing = prev[parentId] ?? [];
        const seen = new Set(existing.map((item) => item.id));
        return {
          ...prev,
          [parentId]: [...existing, ...children.filter((item) => !seen.has(item.id))],
        };
      });
      setChildrenTotals((prev) => ({ ...prev, [parentId]: Number(data.childrenTotal ?? 0) }));
      const last = children.at(-1);
      if (last) setChildCursors((prev) => ({ ...prev, [parentId]: last.floor }));
      setContextChain((prev) => ({ ...prev, [parentId]: data.parentChain ?? [] }));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '楼中楼加载失败');
    } finally {
      setContextLoading(null);
    }
  }

  function handleSubmitted(reply: CreatedReplyPayload, replyTotal: number) {
    if (!items.some((item) => item.id === reply.id)) {
      const next: ReplyListItem = {
        id: reply.id,
        floor: reply.floor,
        content: reply.content,
        html: reply.html,
        thanks: reply.thanks,
        edited: reply.edited,
        editCount: reply.editCount,
        deleted: reply.deleted,
        quoteId: reply.quoteId,
        parentReplyId: reply.parentReplyId,
        authorId: reply.authorId,
        authorName: reply.authorName,
        authorAvatarUrl: currentUser?.avatarUrl ?? '',
        createdAtLabel: '刚刚',
      };
      setItems((prev) => [...prev, next]);
      setTotal((prev) => (replyTotal > 0 ? replyTotal : prev + 1));
    }
    setParentTarget(null);
    setDirty(false);
    setNotice('');
    window.setTimeout(() => {
      document.getElementById(`r_${reply.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  function treeDepth(item: ReplyListItem): number {
    let depth = 0;
    let cursor = item.parentReplyId;
    const seen = new Set<number>();
    while (cursor !== null && depth < MAX_TREE_DEPTH && !seen.has(cursor)) {
      seen.add(cursor);
      depth += 1;
      cursor = itemById.get(cursor)?.parentReplyId ?? null;
    }
    return Math.min(depth, MAX_TREE_DEPTH);
  }

  function relatedIds(id: number): Set<number> {
    const related = new Set<number>([id]);
    const item = itemById.get(id);
    let cursor = item?.parentReplyId ?? null;
    while (cursor !== null) {
      related.add(cursor);
      cursor = itemById.get(cursor)?.parentReplyId ?? null;
    }
    for (const candidate of allItems) {
      if (candidate.parentReplyId === id) related.add(candidate.id);
    }
    return related;
  }

  function hasCollapsedAncestor(item: ReplyListItem): boolean {
    let cursor = item.parentReplyId;
    const seen = new Set<number>();
    while (cursor !== null && !seen.has(cursor)) {
      if (collapsed.has(cursor)) return true;
      seen.add(cursor);
      cursor = itemById.get(cursor)?.parentReplyId ?? null;
    }
    return false;
  }

  function renderCard(item: ReplyListItem, options: { nested?: boolean; depth?: number } = {}) {
    const parent = item.parentReplyId !== null ? parents[String(item.parentReplyId)] : undefined;
    const related = highlighted === null ? null : relatedIds(item.id);
    const isHighlighted = related?.has(item.id) ?? false;
    const isDimmed = highlighted !== null && !isHighlighted;
    const children = childrenByParent.get(item.id) ?? [];
    const hasChildren = children.length > 0 || (childrenTotals[item.id] ?? 0) > children.length;
    const isCollapsed = collapsed.has(item.id);
    return (
      <div key={item.id}>
        <div
          id={`r_${item.id}`}
          className={[
            'cell',
            'reply-card',
            `reply-mode-${mode}`,
            options.nested ? 'is-nested-reply' : '',
            item.parentReplyId !== null ? 'has-reply-parent' : '',
            options.depth ? 'has-tree-depth' : '',
            highlighted !== null && isHighlighted ? 'is-thread-highlighted' : '',
            isDimmed ? 'is-thread-dimmed' : '',
          ].filter(Boolean).join(' ')}
          style={options.depth ? { '--reply-depth': options.depth } as React.CSSProperties : undefined}
          data-reply-id={item.id}
          onMouseEnter={() => mode === 'lines' && setHighlighted(item.id)}
          onMouseLeave={() => mode === 'lines' && setHighlighted(null)}
        >
          <table cellPadding={0} cellSpacing={0} border={0} width="100%">
            <tbody>
              <tr>
                <td width={48} valign="top" align="center">
                  <a href={`/member/${item.authorName}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.authorAvatarUrl}
                      className="avatar"
                      width={48}
                      height={48}
                      alt={item.authorName}
                      data-uid={item.authorId}
                    />
                  </a>
                </td>
                <td width={10} valign="top" />
                <td width="auto" valign="top" align="left">
                  <div className="fr">
                    &nbsp; &nbsp; <span className="no">{item.floor}</span>
                  </div>
                  <div className="sep3" />
                  <strong>
                    <a href={`/member/${item.authorName}`} className="dark">{item.authorName}</a>
                  </strong>{' '}
                  &nbsp; &nbsp;
                  <span className="ago">{item.createdAtLabel}</span>
                  {item.thanks > 0 ? <span className="small fade">❤️ {item.thanks}</span> : null}
                  {mode === 'badge' && parent ? (
                    <ParentReference
                      parent={parent}
                      mode={mode}
                      active={badgePreview === parent.id}
                      onActivate={() => setBadgePreview((prev) => prev === parent.id ? null : parent.id)}
                      onLoadContext={() => void loadContext(item.id)}
                    />
                  ) : null}
                  <div className="sep5" />
                  {mode !== 'badge' && parent && ['quote', 'nested', 'tree', 'excerpt'].includes(mode) ? (
                    <ParentReference
                      parent={parent}
                      mode={mode}
                      active={false}
                      onActivate={() => undefined}
                      onLoadContext={() => void loadContext(item.id)}
                    />
                  ) : null}
                  <div className="reply_content markdown_body" dangerouslySetInnerHTML={{ __html: item.html }} />
                  <div className="reply_row">
                    <ReplyItem
                      reply={{
                        id: item.id,
                        floor: item.floor,
                        content: item.content,
                        thanks: item.thanks,
                        edited: item.edited,
                        editCount: item.editCount,
                        deleted: item.deleted,
                        quoteId: item.quoteId,
                        parentReplyId: item.parentReplyId,
                        authorId: item.authorId,
                        authorName: item.authorName,
                        createdAt: item.createdAtLabel,
                      }}
                      user={currentUser}
                      thanked={thankedIds.includes(item.id)}
                      topicLocked={topicLocked}
                      onReply={() => chooseParent(item)}
                      onChanged={() => router.refresh()}
                    />
                  </div>
                  {(mode === 'tree' || mode === 'nested') && hasChildren ? (
                    <div className="reply_row reply-thread-controls">
                      <button
                        type="button"
                        className="button"
                        onClick={() => setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })}
                        aria-expanded={!isCollapsed}
                      >
                        {isCollapsed ? '展开楼中楼' : '收起楼中楼'}
                      </button>
                      {children.length < (childrenTotals[item.id] ?? children.length) ? (
                        <button
                          type="button"
                          className="button"
                          disabled={contextLoading === item.id}
                          onClick={() => void loadChildren(item.id)}
                        >
                          {contextLoading === item.id ? '加载中…' : '加载更多楼中楼'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {contextFor === item.id ? (
                    <div className="reply-context-panel" role="region" aria-label="回复上下文">
                      {contextLoading === item.id ? <span>加载中…</span> : null}
                      {(contextChain[item.id] ?? []).map((parent) => (
                        <div key={parent.id} className="reply-context-row">
                          #{parent.floor} {parent.authorName}
                          {parent.excerpt ? `：${parent.excerpt}` : parent.inaccessible ? '：不可见' : ''}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderItems() {
    if (mode === 'nested') {
      const rendered = new Set<number>();
      const result: React.ReactNode[] = [];
      for (const item of allItems) {
        if (rendered.has(item.id)) continue;
        const parentVisible = item.parentReplyId !== null && itemById.has(item.parentReplyId);
        if (parentVisible) continue;
        const renderWithChildren = (entry: ReplyListItem, nested = false) => {
          rendered.add(entry.id);
          result.push(renderCard(entry, { nested }));
          for (const child of childrenByParent.get(entry.id) ?? []) {
            if (!rendered.has(child.id)) renderWithChildren(child, true);
          }
        };        renderWithChildren(item);
      }
      return result;
    }

    if (mode === 'tree') {
      return allItems
        .slice()
        .sort((a, b) => a.floor - b.floor)
        .filter((item) => !hasCollapsedAncestor(item))
        .map((item) => renderCard(item, { depth: Math.min(treeDepth(item), MAX_TREE_DEPTH) }));
    }

    return items.map((item) => renderCard(item));
  }

  return (
    <div className={`reply-list reply-list-${mode}`}>
      <div className="cell reply-mode-bar">
        <label htmlFor="reply-display-mode">回复显示</label>
        <select
          id="reply-display-mode"
          value={mode}
          onChange={(event) => persistMode(event.target.value as ReplyDisplayMode)}
        >
          {MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <span className="fade">仅改变阅读方式，不修改回复数据</span>
      </div>

      {notice ? <div className="cell reply-mode-notice" role="status">{notice}</div> : null}
      {renderItems()}

      {currentUser ? (
        <div className="box reply-composer-box">
          <div className="cell">
            <ReplyComposer
              topicId={topicId}
              topicLocked={topicLocked}
              user={currentUser}
              parentTarget={parentTarget}
              onDirtyChange={setDirty}
              onTargetNotice={setNotice}
              onCancelParent={() => setParentTarget(null)}
              onSubmitted={handleSubmitted}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
