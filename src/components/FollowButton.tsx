'use client';

import { useState } from 'react';
import { csrfFetch } from '@/components/CsrfProvider';

/**
 * 关注 / 取消关注按钮（v0.0.4）
 *
 * ## 为什么要有这个组件
 *
 * v0.0.3/v0.0.4 之前，后端关注接口是齐全的
 * （`POST/DELETE /api/users/follows`、`GET /api/users/follows`、
 * `GET /api/users/follows/topics`），但**前端一个关注按钮都没有** ——
 * 用户在个人主页上无法关注任何人，只能靠直接调 API。
 * 这就是风险登记 R-24「关注无 UI 入口」。
 *
 * ## 接口契约
 *
 * | 操作      | 请求                                          | 响应                                     |
 * |-----------|-----------------------------------------------|------------------------------------------|
 * | 关注      | `POST /api/users/follows` `{ userId }`        | `{ ok, alreadyFollowed, following, followersCount }` |
 * | 取消关注  | `DELETE /api/users/follows` `{ userId }`      | `{ ok, removed, followersCount }`        |
 *
 * ## 幂等与状态一致性
 *
 *  - 重复关注是**幂等**的（服务端 `onConflictDoNothing` + 唯一索引），
 *    返回 `alreadyFollowed: true` —— 不产生第二条记录。
 *  - 取消不存在的关注同样幂等（返回 `removed: false`）。
 *  - 操作成功后**以服务端返回的 `followersCount` 为准**，
 *    不做本地乐观累加 —— 避免并发下计数漂移。
 *  - 失败时**不改变本地状态**，界面永远反映真实服务端状态。
 *
 * ## 初始状态从哪来
 *
 * `initiallyFollowing` 与 `initialFollowersCount` 由**服务端**算好传入
 * （见 `src/app/member/[username]/page.tsx`）：
 *  - 服务端已查过库，不需要客户端再发一次请求就能拿到正确初始状态；
 *  - 首屏即正确，不会出现「先显示未关注、加载完才变已关注」的闪烁。
 *
 * ## 权限
 *
 * 服务端要求登录（未登录 → 401），且**不能关注自己**（→ 400）。
 * 组件在服务端已知是「自己」时**根本不渲染按钮**，
 * 但真正的拦截仍在服务端 —— 前端隐藏只是体验优化，不是安全措施。
 */
export type FollowButtonProps = {
  /** 目标用户 id */
  userId: number;
  /** 目标用户名（用于 aria-label 与提示文案） */
  username: string;
  /** 当前登录用户 id；未登录时传 null */
  currentUserId: number | null;
  /** 我是否已经关注了目标用户（服务端算好） */
  initiallyFollowing: boolean;
  /** 目标用户的关注者总数（服务端算好） */
  initialFollowersCount: number;
};

export default function FollowButton({
  userId,
  username,
  currentUserId,
  initiallyFollowing,
  initialFollowersCount,
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initiallyFollowing);
  const [followersCount, setFollowersCount] = useState(initialFollowersCount);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  /** 目标用户就是我自己 —— 不能关注自己，服务端也会拒绝 */
  const isSelf = currentUserId !== null && currentUserId === userId;

  async function toggle() {
    if (pending) return;
    setPending(true);
    setError(null);
    setMsg(null);

    // 记录本次操作前的状态 —— 失败时用它回滚
    const wasFollowing = following;

    try {
      const res = await csrfFetch('/api/users/follows', {
        method: wasFollowing ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        alreadyFollowed?: boolean;
        removed?: boolean;
        followersCount?: number;
      };

      if (!res.ok || data.ok === false) {
        // 失败 → 状态保持不变（本来就是不变），只展示服务端原因
        setError(data.error ?? `操作失败（HTTP ${res.status}）`);
        return;
      }

      // 成功的语义是确定的：
      //  - 走的是 POST  → 现在**正在关注**
      //  - 走的是 DELETE → 现在**没有关注**（removed=false 表示本来就没有）
      const nowFollowing = !wasFollowing;
      setFollowing(nowFollowing);

      // 计数以服务端为准；服务端没返回时按 ±1 推导（最后手段）
      setFollowersCount(
        typeof data.followersCount === 'number'
          ? data.followersCount
          : Math.max(0, initialFollowersCount + (nowFollowing ? 1 : -1)),
      );

      setMsg(nowFollowing ? `已关注 ${username}` : `已取消关注 ${username}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误，请重试');
    } finally {
      setPending(false);
    }
  }

  // 未登录 / 关注自己 —— 不渲染按钮（服务端仍会拒绝，属体验优化）
  if (currentUserId === null || isSelf) return null;

  return (
    <span className="follow-button">
      <button
        type="button"
        className="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={following}
        aria-label={following ? `取消关注 ${username}` : `关注 ${username}`}
      >
        {pending ? '处理中…' : following ? '已关注' : '关注'}
      </button>
      <span className="f12 gray" style={{ marginLeft: 8 }}>
        {followersCount} 位关注者
      </span>
      {msg ? (
        <span className="f12 gray" role="status" style={{ marginLeft: 8 }}>
          {msg}
        </span>
      ) : null}
      {error ? (
        <span className="f12" role="alert" style={{ color: '#b00', marginLeft: 8 }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
