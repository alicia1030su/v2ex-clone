'use client';

import { csrfFetch } from '@/components/CsrfProvider';
import { REPORT_REASONS } from '@/lib/report-reasons';
import { useState } from 'react';

/**
 * ReportButton —— 举报按钮（v0.0.5 新增）
 *
 * 用于主题与回复的操作区。点开内联表单（不用 window.prompt）：
 *   - 举报原因（固定列表，单选）
 *   - 补充说明（可选，最长 500）
 *
 * 行为：
 *   - 未登录 → 引导去登录，登录后返回当前页（与 CollectButton 一致）
 *   - 不能举报自己的内容 → 服务端返回 400，这里展示错误
 *   - 重复举报 → 服务端返回 409，展示「已举报过，正在处理中」
 *   - 成功后按钮变为「已举报」并禁用
 *
 * 隐私：本组件只提交**目标**与**原因**，不提交也不展示任何举报人信息。
 *       举报人身份只对 moderator / admin 在后台可见。
 */
export default function ReportButton({
  target,
  id,
  label = '举报',
}: {
  target: 'topic' | 'reply';
  id: number;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [detail, setDetail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await csrfFetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: target, targetId: id, reason, detail }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (res.status === 401) {
        window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (res.ok && data.ok) {
        setDone(true);
        setOpen(false);
        setDetail('');
      } else {
        setError(data.error ?? '提交失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <span className="fade" title="管理员会尽快处理">
        已举报
      </span>
    );
  }

  return (
    <span>
      <button
        type="button"
        className="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-expanded={open}
      >
        {label}
      </button>
      {open ? (
        <span
          className="report-pop"
          role="dialog"
          aria-label="举报"
          style={{
            display: 'inline-block',
            marginLeft: 8,
            padding: '8px 10px',
            border: '1px solid #ccc',
            background: '#fff',
            verticalAlign: 'top',
          }}
        >
          <div style={{ marginBottom: 6 }}>
            {REPORT_REASONS.map((r) => (
              <label key={r} style={{ marginRight: 10, whiteSpace: 'nowrap' }}>
                <input
                  type="radio"
                  name={`report-reason-${target}-${id}`}
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                />
                <span style={{ marginLeft: 3 }}>{r}</span>
              </label>
            ))}
          </div>
          <div>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value.slice(0, 500))}
              placeholder="补充说明（选填，最多 500 字）"
              rows={3}
              style={{ width: 260, display: 'block' }}
            />
          </div>
          <div style={{ marginTop: 6 }}>
            <button type="button" className="button" onClick={submit} disabled={pending}>
              {pending ? '提交中…' : '提交举报'}
            </button>{' '}
            <button type="button" onClick={() => setOpen(false)} disabled={pending}>
              取消
            </button>
            {error ? (
              <span className="f12" style={{ color: '#b00', marginLeft: 8 }} role="alert">
                {error}
              </span>
            ) : null}
          </div>
        </span>
      ) : null}
    </span>
  );
}
