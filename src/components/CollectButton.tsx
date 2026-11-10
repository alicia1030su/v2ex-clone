'use client';

import { csrfFetch } from '@/components/CsrfProvider';

import { useEffect, useRef, useState } from 'react';

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

  /**
   * v0.0.16：用户是否已经**主动操作过**。
   *
   * ## 修的是什么
   *
   * 挂载时会拉一次「我是否已收藏」来校准初始状态。这份拉取与用户的点击
   * **是并发的**：如果用户在 fetch 返回之前点了「收藏」，
   * 那么后端已经写入成功、UI 也切到「已收藏」，
   * 但随后那个**更早发出**的 fetch 返回「未收藏」，
   * 于是 `setCollected(false)` 把刚生效的状态**覆盖回去**。
   *
   * 表现：点了收藏 → 变成「已收藏」→ 一两秒后自己变回「收藏」，
   * 刷新页面又显示已收藏（数据库是对的，UI 是错的）。
   *
   * 修法：一旦用户亲手操作过，挂载时的那次校准结果就**不再采纳** ——
   * 以用户操作的响应为准。这不依赖任何时序假设（不用 timeout / 不用 sleep）。
   */
  const userActedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/collections?target=${target}&id=${id}`);
        if (!res.ok) return;
        const data = (await res.json()) as { items: number[] };
        // 用户已经点过了 ⇒ 丢弃这次「历史快照」，不要覆盖更新的状态
        if (!cancelled && !userActedRef.current) {
          setCollected((data.items ?? []).length > 0);
        }
      } catch {
        /* 未登录时会返回空列表，保持默认状态 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target, id]);

  async function toggle() {
    // 并发点击保护：pending 期间重复点击会发出两个 POST。
    // 「收藏」虽在后端是幂等的（add 已存在时不报错），但两个请求
    // 会以不同顺序返回，UI 最终状态取决于谁后到 —— 不可预测。
    if (pending) return;
    userActedRef.current = true;
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
