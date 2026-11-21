'use client';

import { useEffect, useRef, useState } from 'react';
import { csrfFetch } from '@/components/CsrfProvider';
import type { CreatedReplyPayload } from '@/server/reply-submissions';

export type ReplyParentTarget = {
  id: number;
  floor: number;
  authorName: string;
};

export type RecentReplyImage = {
  id: number;
  url: string;
  markdown: string;
  width: number | null;
  height: number | null;
};

type Props = {
  topicId: number;
  topicLocked: boolean;
  user: { id: number; username: string; avatarUrl: string };
  parentTarget: ReplyParentTarget | null;
  onDirtyChange: (dirty: boolean) => void;
  onTargetNotice: (message: string) => void;
  onCancelParent: () => void;
  onSubmitted: (reply: CreatedReplyPayload, replyTotal: number) => void;
};

type ReplyResponse = {
  ok?: boolean;
  error?: string;
  reply?: CreatedReplyPayload;
  replyTotal?: number;
  duplicated?: boolean;
};

const DRAFT_PREFIX = 'v2ex-reply-draft:';
const IMAGE_MARKDOWN_PREFIX = '![图片](';

export default function ReplyComposer({
  topicId,
  topicLocked,
  user,
  parentTarget,
  onDirtyChange,
  onTargetNotice,
  onCancelParent,
  onSubmitted,
}: Props) {
  const [content, setContent] = useState('');
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentImages, setRecentImages] = useState<RecentReplyImage[]>([]);
  const [insertedUrls, setInsertedUrls] = useState<Set<string>>(new Set());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef<string | null>(null);
  const draftKey = `${DRAFT_PREFIX}${topicId}:${user.id}`;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey) ?? '';
      if (saved) {
        setContent(saved);
        onDirtyChange(true);
        setInsertedUrls(new Set(
          [...saved.matchAll(/!\[图片\]\((\/uploads\/replies\/[^)]+)\)/g)].map((m) => m[1]),
        ));
      }
    } catch {
      /* 隐私模式下 localStorage 可能不可用；内存草稿仍有效 */
    }
    void loadRecentImages();
    // draftKey/onDirtyChange 是本组件的稳定输入；故意只在挂载时恢复一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRecentImages() {
    try {
      const res = await fetch('/api/reply-images?limit=10');
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        images?: RecentReplyImage[];
      } | null;
      if (res.ok && data?.ok && Array.isArray(data.images)) {
        setRecentImages(data.images);
      }
    } catch {
      /* 最近图片不可用不影响回复 */
    }
  }

  function updateContent(next: string) {
    setContent(next);
    const dirty = next.trim().length > 0;
    onDirtyChange(dirty);
    try {
      if (dirty) window.localStorage.setItem(draftKey, next);
      else window.localStorage.removeItem(draftKey);
    } catch {
      /* 忽略存储失败 */
    }
    setInsertedUrls(new Set(
      [...next.matchAll(/!\[图片\]\((\/uploads\/replies\/[^)]+)\)/g)].map((m) => m[1]),
    ));
  }

  function appendMarkdown(markdown: string) {
    const next = content
      ? `${content}${content.endsWith('\n') ? '' : '\n'}${markdown}`
      : markdown;
    updateContent(next);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function toggleImage(image: RecentReplyImage) {
    if (insertedUrls.has(image.url)) {
      updateContent(content.replace(`${IMAGE_MARKDOWN_PREFIX}${image.url})`, '').trimEnd());
    } else {
      appendMarkdown(image.markdown);
    }
  }

  async function uploadFiles(files: File[]) {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    setUploading(true);
    setError(null);
    let nextContent = content;
    try {
      for (const file of images) {
        const form = new FormData();
        form.append('file', file);
        const res = await csrfFetch('/api/reply-images', { method: 'POST', body: form });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          image?: RecentReplyImage;
        } | null;
        if (!res.ok || !data?.ok || !data.image) {
          throw new Error(data?.error ?? `上传失败（HTTP ${res.status}）`);
        }
        setRecentImages((prev) => [data.image!, ...prev].slice(0, 20));
        nextContent = nextContent
          ? `${nextContent}${nextContent.endsWith('\n') ? '' : '\n'}${data.image.markdown}`
          : data.image.markdown;
        updateContent(nextContent);
      }
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function reconcileTimeout(clientRequestId: string): Promise<ReplyResponse | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(
          `/api/replies/submission?topicId=${encodeURIComponent(topicId)}&clientRequestId=${encodeURIComponent(clientRequestId)}`,
          { cache: 'no-store' },
        );
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          found?: boolean;
          reply?: CreatedReplyPayload;
        } | null;
        if (res.ok && data?.ok && data.found && data.reply) {
          return { ok: true, reply: data.reply };
        }
      } catch {
        /* 继续短暂核对 */
      }
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
    return null;
  }

  async function submit() {
    if (pending || uploading || topicLocked || content.trim().length < 2) return;
    setPending(true);
    setError(null);
    const clientRequestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = clientRequestId;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);

    try {
      const res = await csrfFetch('/api/replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicId,
          content,
          redirect: `/t/${topicId}`,
          parentReplyId: parentTarget?.id ?? null,
          clientRequestId,
          imageIds: recentImages
            .filter((image) => insertedUrls.has(image.url))
            .map((image) => image.id),
        }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as ReplyResponse | null;
      if (!res.ok || !data?.ok || !data.reply) {
        const message = res.status === 401
          ? '登录已失效，请重新登录；草稿已保留'
          : data?.error ?? `发送失败（HTTP ${res.status}）`;
        setError(message);
        return;
      }
      finishSuccess(data.reply, Number(data.replyTotal ?? 0));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('网络超时，正在核对发送结果…');
        const reconciled = await reconcileTimeout(clientRequestId);
        if (reconciled?.reply) {
          finishSuccess(reconciled.reply, 0);
          return;
        }
        setError('发送结果暂未确认；草稿已保留，可安全重试（不会重复回复）');
        return;
      }
      setError(err instanceof Error ? err.message : '网络错误；草稿已保留');
    } finally {
      window.clearTimeout(timeout);
      setPending(false);
    }
  }

  function finishSuccess(reply: CreatedReplyPayload, replyTotal: number) {
    updateContent('');
    requestIdRef.current = null;
    setError(null);
    onSubmitted(reply, replyTotal);
  }

  const canSubmit = content.trim().length >= 2 && !pending && !uploading && !topicLocked;

  return (
    <div className="reply-composer">
      {parentTarget ? (
        <div className="reply-composer-target" role="status">
          正在回复 <strong>#{parentTarget.floor}</strong> {parentTarget.authorName}
          <button
            type="button"
            className="button reply-composer-cancel"
            onClick={() => {
              onDirtyChange(content.trim().length > 0);
              onTargetNotice('');
              onCancelParent();
            }}
          >
            取消关联
          </button>
        </div>
      ) : null}

      <div
        className={`reply-composer-drop${dragging ? ' is-dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void uploadFiles([...event.dataTransfer.files]);
        }}
      >
        <textarea
          ref={textareaRef}
          id="reply-content"
          name="content"
          aria-label="回复内容"
          placeholder={topicLocked ? '主题已锁定，无法回复' : '回复内容'}
          required
          minLength={2}
          maxLength={20000}
          value={content}
          disabled={topicLocked}
          onChange={(event) => updateContent(event.target.value)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
            if (files.length > 0) {
              event.preventDefault();
              void uploadFiles(files);
            }
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="reply-composer-tools">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              if (files.length > 0) void uploadFiles(files);
            }}
          />
          <button
            type="button"
            className="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || topicLocked}
          >
            {uploading ? '上传中…' : '选择图片'}
          </button>
          <span className="fade">也可拖入或粘贴截图 · Ctrl/⌘ + Enter 发送</span>
        </div>
      </div>

      {recentImages.length > 0 ? (
        <div className="reply-recent-images" aria-label="最近上传图片">
          {recentImages.map((image) => {
            const inserted = insertedUrls.has(image.url);
            return (
              <div className="reply-recent-image" key={image.id}>
                <button
                  type="button"
                  className={`reply-recent-thumb${inserted ? ' is-inserted' : ''}`}
                  onClick={() => toggleImage(image)}
                  aria-pressed={inserted}
                  title={inserted ? '点击移除' : '点击插入'}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt={inserted ? '已插入，点击移除' : '最近图片，点击插入'} />
                </button>
                <button
                  type="button"
                  className="reply-recent-preview"
                  onClick={() => setPreviewUrl(image.url)}
                  aria-label="预览图片"
                >
                  预览
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {error ? <div className="reply-composer-error" role="alert">{error}</div> : null}

      <div className="sep10" />
      <button type="button" className="button" onClick={() => void submit()} disabled={!canSubmit}>
        {pending ? '发送中…' : '提交回复'}
      </button>

      {previewUrl ? (
        <div
          className="reply-image-preview-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setPreviewUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="回复图片预览" />
          <button type="button" className="button" onClick={() => setPreviewUrl(null)}>关闭</button>
        </div>
      ) : null}
    </div>
  );
}
