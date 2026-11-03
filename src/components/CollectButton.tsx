'use client';

import { csrfFetch } from '@/components/CsrfProvider';

import { useEffect, useState } from 'react';

export default function CollectButton({
  target,
  id,
  initialCollected = false,
  label = '收藏',
}: {
  target: 'topic' | 'node';
  id: number;
  initialCollected?: boolean;
  label?: string;
}) {
  const [collected, setCollected] = useState(initialCollected);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/collections?target=${target}&id=${id}`);
        if (!res.ok) return;
        const data = (await res.json()) as { items: number[] };
        if (!cancelled) setCollected((data.items ?? []).length > 0);
      } catch {
        /* 未登录时会返回空列表，保持默认状态 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target, id]);

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const res = await csrfFetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, id, action: collected ? 'remove' : 'add' }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.status === 401) {
        window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (res.ok && data.ok) {
        setCollected(!collected);
      } else {
        setError(data.error ?? '操作失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setPending(false);
    }
  }

  return (
    <span>
      <button type="button" className="button" onClick={toggle} disabled={pending}>
        {collected ? '已收藏' : label}
      </button>
      {error ? (
        <span className="f12" style={{ color: '#b00', marginLeft: 8 }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
