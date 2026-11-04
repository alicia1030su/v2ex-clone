'use client';

import { useCallback, useEffect, useState } from 'react';
import { csrfFetch } from '@/components/CsrfProvider';

/**
 * 积分余额显示（v0.0.3）
 *
 * 数据来源：GET /api/credits → { ok, balance, total, ledger, rules }
 *
 * 用途：
 *  - 侧栏 / 设置页展示当前积分余额
 *  - 展开后显示最近的积分流水（签到、发帖、回复、被感谢等）
 *
 * 交互约定：
 *  - 加载态：显示占位符「—」，不闪 0
 *  - 错误态：显示错误文案 + 手动重试按钮
 *  - 未登录：组件接收 `signedIn=false` 时直接隐藏积分区（不发起请求）
 *
 * 积分规则说明由服务端 `rules` 字段返回（可配置），
 * 这里如实展示服务端给的数值，不在前端硬编码。
 */

type LedgerEntry = {
  id: number;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  refType: string | null;
  refId: number | null;
  reason: string | null;
  createdAt: string;
};

type CreditsResponse = {
  ok?: boolean;
  error?: string;
  balance?: number;
  total?: number;
  ledger?: LedgerEntry[];
  rules?: {
    topic?: number;
    reply?: number;
    checkin?: number;
    streakBonus?: number;
    streakBonusMax?: number;
    note?: string;
  };
};

type State =
  | { status: 'loading' }
  | { status: 'error'; text: string }
  | {
      status: 'ready';
      balance: number;
      total: number;
      ledger: LedgerEntry[];
      rules?: CreditsResponse['rules'];
    };

/** 流水类型 → 中文标签（未知类型原样展示，避免信息丢失） */
const LEDGER_LABELS: Record<string, string> = {
  topic_created: '发布主题',
  reply_created: '回复',
  topic_thanked: '主题被感谢',
  daily_checkin: '每日签到',
  admin_adjust: '管理员调整',
  admin_deduct: '管理员扣除',
  registration_bonus: '注册奖励',
};

export default function CreditBadge({
  signedIn = true,
  initialBalance,
  showLedger = false,
}: {
  /** 未登录时传 false —— 组件会整块隐藏（不显示误导性的「积分 0」） */
  signedIn?: boolean;
  /** 服务端已知的余额（可省，省略则由组件自行拉取） */
  initialBalance?: number;
  /** 是否展示积分流水明细 */
  showLedger?: boolean;
}) {
  const [state, setState] = useState<State>(
    initialBalance !== undefined
      ? { status: 'ready', balance: initialBalance, total: 0, ledger: [] }
      : { status: 'loading' },
  );
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    // 已有服务端给出的余额时不闪「—」，避免无谓的加载闪烁
    setState((prev) =>
      prev.status === 'ready' ? prev : { status: 'loading' },
    );
    try {
      const res = await fetch('/api/credits?limit=20');
      const data = (await res.json()) as CreditsResponse;
      if (!res.ok || !data.ok) {
        setState({ status: 'error', text: data.error ?? '积分加载失败' });
        return;
      }
      setState({
        status: 'ready',
        balance: Number(data.balance ?? 0),
        total: Number(data.total ?? 0),
        ledger: data.ledger ?? [],
        rules: data.rules,
      });
    } catch {
      setState({ status: 'error', text: '网络错误，请稍后重试' });
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void load();
  }, [signedIn, load]);

  // 未登录：整块隐藏，避免出现「积分 0」的误导
  if (!signedIn) return null;

  return (
    <div className="credit-badge">
      <div className="sep5" />
      <span className="f12 gray">积分</span>{' '}
      <span className="f16">{state.status === 'ready' ? state.balance : '—'}</span>

      {state.status === 'error' ? (
        <div className="sep5">
          <span className="f12 gray" role="alert">
            {state.text}
          </span>{' '}
          <button
            type="button"
            className="button"
            onClick={() => void load()}
            aria-label="重新加载积分"
          >
            重试
          </button>
        </div>
      ) : null}

      {state.status === 'ready' && showLedger ? (
        <>
          <div className="sep5">
            <button
              type="button"
              className="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? '收起积分流水' : '展开积分流水'}
            >
              {expanded ? '收起流水' : `积分流水（${state.total}）`}
            </button>
          </div>

          {expanded ? (
            <div className="sep5">
              {state.ledger.length === 0 ? (
                <div className="f12 gray">暂无积分流水</div>
              ) : (
                state.ledger.map((e) => (
                  <div key={e.id} className="f12 gray">
                    {LEDGER_LABELS[e.type] ?? e.type} · {e.amount > 0 ? '+' : ''}
                    {e.amount} · 余 {e.balanceAfter}
                    {e.reason ? ` · ${e.reason}` : ''}
                  </div>
                ))
              )}

              {state.rules?.note ? (
                <div className="sep5 f12 gray">{state.rules.note}</div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
