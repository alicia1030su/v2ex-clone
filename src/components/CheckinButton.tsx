'use client';

import { useState } from 'react';
import { csrfFetch } from '@/components/CsrfProvider';

/**
 * 每日签到按钮（v0.0.3）
 *
 * 幂等：服务端对同一天重复签到返回 alreadyCheckedIn，不重复发放积分。
 * 组件据此显示不同状态，不做前端乐观加分。
 */
export default function CheckinButton({
  checkedIn,
  streak,
  reward,
}: {
  checkedIn: boolean;
  streak: number;
  reward: number;
}) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState({ checkedIn, streak, reward });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkin() {
    setPending(true);
    setError(null);
    try {
      const res = await csrfFetch('/api/checkin', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        alreadyCheckedIn?: boolean;
        reward?: number;
        streak?: number;
        balance?: number;
        message?: string;
      };
      if (!res.ok || data.ok === false) {
        setError(data.error ?? `签到失败（HTTP ${res.status}）`);
        return;
      }
      setState({
        checkedIn: true,
        streak: data.streak ?? state.streak,
        reward: data.reward ?? state.reward,
      });
      setMsg(data.message ?? '签到成功');
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="checkin-box">
      <button
        type="button"
        className="button"
        onClick={checkin}
        disabled={pending || state.checkedIn}
        aria-label="每日签到"
      >
        {state.checkedIn ? '今日已签到' : '签到'}
      </button>
      <span className="fade" style={{ marginLeft: '8px' }}>
        连续 {state.streak} 天
        {state.checkedIn && state.reward > 0 ? ` · 获得 ${state.reward} 积分` : ''}
      </span>
      {msg && (
        <span className="fade" role="status" style={{ marginLeft: '8px' }}>
          {msg}
        </span>
      )}
      {error && (
        <span className="fade" role="alert" style={{ marginLeft: '8px' }}>
          {error}
        </span>
      )}
    </div>
  );
}
