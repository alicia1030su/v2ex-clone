'use client';

import { csrfFetch } from '@/components/CsrfProvider';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import CreditBadge from '@/components/CreditBadge';
import CheckinButton from '@/components/CheckinButton';

/**
 * 账号设置表单（v0.0.3）
 *
 * ## 使用的 v0.0.3 API
 *
 * | 用途                | 接口                                              |
 * |---------------------|---------------------------------------------------|
 * | 读取资料            | GET    /api/users/me                              |
 * | 保存资料            | PATCH  /api/users/me                              |
 * | 上传头像            | POST   /api/users/avatar  （multipart，字段名 file）|
 * | 移除头像            | DELETE /api/users/avatar                          |
 * | 修改密码            | POST   /api/settings/password                     |
 * | 积分余额与流水      | GET    /api/credits                               |
 * | 签到状态            | GET    /api/checkin                               |
 *
 * 旧的 `/api/settings/profile` 仍可用，但 v0.0.3 的资料字段是
 * tagline / bio / url / location，与 `PATCH /api/users/me` 一一对应，
 * 因此统一走后者，避免两套接口语义漂移。
 *
 * ## 交互约定
 *  - 每个表单独立的 pending / 错误状态，互不干扰
 *  - 头像上传前做客户端大小预检（服务端仍会二次校验 magic number）
 *  - 所有写操作走 csrfFetch，自动带上 x-csrf-token
 */

type User = {
  id: number;
  username: string;
  role: string;
  balance: number;
  avatar: string | null;
};

type Profile = {
  tagline: string;
  bio: string;
  url: string;
  location: string;
};

type CheckinState = {
  checkedInToday: boolean;
  streak: number;
  reward: number;
};

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export default function SettingsForm({ user }: { user: User }) {
  const [profile, setProfile] = useState<Profile>({
    tagline: '',
    bio: '',
    url: '',
    location: '',
  });
  const [profileLoaded, setProfileLoaded] = useState(false);

  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });

  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const [avatar, setAvatar] = useState<string | null>(user.avatar);
  const [avatarPending, setAvatarPending] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const [checkin, setCheckin] = useState<CheckinState | null>(null);

  // ---- 载入资料与签到状态 ----
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/users/me');
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          user?: {
            tagline?: string | null;
            bio?: string | null;
            url?: string | null;
            location?: string | null;
            avatar?: string | null;
          };
        };
        if (cancelled) return;
        if (res.ok && data.ok && data.user) {
          setProfile({
            tagline: data.user.tagline ?? '',
            bio: data.user.bio ?? '',
            url: data.user.url ?? '',
            location: data.user.location ?? '',
          });
          if (data.user.avatar !== undefined) setAvatar(data.user.avatar);
          setProfileLoaded(true);
        }
      } catch {
        if (!cancelled) setProfileLoaded(true);
      }

      try {
        const res = await fetch('/api/checkin');
        const data = (await res.json()) as {
          ok?: boolean;
          checkedInToday?: boolean;
          streak?: number;
          reward?: number;
        };
        if (cancelled) return;
        if (res.ok && data.ok) {
          setCheckin({
            checkedInToday: !!data.checkedInToday,
            streak: Number(data.streak ?? 0),
            reward: Number(data.reward ?? 0),
          });
        }
      } catch {
        /* 签到状态不可用时不阻塞其他功能 */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---- 保存资料 ----
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    try {
      const res = await csrfFetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setMsg({ kind: 'ok', text: '资料已保存' });
      } else {
        setMsg({ kind: 'err', text: data.error ?? '保存失败' });
      }
    } catch {
      setMsg({ kind: 'err', text: '网络错误' });
    } finally {
      setPending(false);
    }
  }

  // ---- 修改密码 ----
  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwd.next !== pwd.confirm) {
      setMsg({ kind: 'err', text: '两次输入的新密码不一致' });
      return;
    }
    if (pwd.next.length < 8) {
      setMsg({ kind: 'err', text: '新密码至少 8 位' });
      return;
    }
    setPending(true);
    setMsg(null);
    try {
      const res = await csrfFetch('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: pwd.current, next: pwd.next }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setPwd({ current: '', next: '', confirm: '' });
        setMsg({ kind: 'ok', text: '密码已修改' });
      } else {
        setMsg({ kind: 'err', text: data.error ?? '修改失败' });
      }
    } catch {
      setMsg({ kind: 'err', text: '网络错误' });
    } finally {
      setPending(false);
    }
  }

  // ---- 上传头像 ----
  async function uploadAvatar(file: File) {
    setAvatarMsg(null);

    // 客户端预检（服务端仍会按文件真实内容二次判定格式）
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarMsg({ kind: 'err', text: '文件过大（上限 2MB）' });
      return;
    }
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) {
      setAvatarMsg({ kind: 'err', text: '只支持 PNG / JPEG / WebP / GIF 格式的图片' });
      return;
    }

    setAvatarPending(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await csrfFetch('/api/users/avatar', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        avatar?: string;
        note?: string;
      };
      if (res.ok && data.ok) {
        setAvatar(data.avatar ?? null);
        setAvatarMsg({ kind: 'ok', text: data.note ?? '头像已更新' });
      } else {
        setAvatarMsg({ kind: 'err', text: data.error ?? '头像上传失败' });
      }
    } catch {
      setAvatarMsg({ kind: 'err', text: '网络错误' });
    } finally {
      setAvatarPending(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // ---- 移除头像 ----
  async function removeAvatar() {
    if (!window.confirm('确定要移除头像吗？')) return;
    setAvatarPending(true);
    setAvatarMsg(null);
    try {
      const res = await csrfFetch('/api/users/avatar', { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setAvatar(null);
        setAvatarMsg({ kind: 'ok', text: '头像已移除' });
      } else {
        setAvatarMsg({ kind: 'err', text: data.error ?? '移除头像失败' });
      }
    } catch {
      setAvatarMsg({ kind: 'err', text: '网络错误' });
    } finally {
      setAvatarPending(false);
    }
  }

  async function signout() {
    await csrfFetch('/api/auth/signout', { method: 'POST' });
    window.location.href = '/';
  }

  return (
    <>
      {msg ? (
        <div className="cell">
          <div
            className={msg.kind === 'err' ? 'problem' : 'toast'}
            style={msg.kind === 'ok' ? { position: 'static', boxShadow: 'none' } : undefined}
            role={msg.kind === 'err' ? 'alert' : 'status'}
          >
            {msg.text}
          </div>
        </div>
      ) : null}

      {/* ---- 头像 ---- */}
      <div className="cell">
        <strong>头像</strong>
        <div className="sep10" />
        <table cellPadding={5} cellSpacing={0} border={0} width="100%">
          <tbody>
            <tr>
              <td width={120} align="right" valign="top">
                当前头像
              </td>
              <td align="left">
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatar}
                    alt="我的头像"
                    width={73}
                    height={73}
                    className="avatar"
                  />
                ) : (
                  <span className="fade">尚未设置头像</span>
                )}
                <div className="sep10" />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  aria-label="选择头像图片"
                  disabled={avatarPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadAvatar(file);
                  }}
                />
                <div className="sep5" />
                <span className="f12 gray">支持 PNG / JPEG / WebP / GIF，上限 2MB</span>
              </td>
            </tr>
            <tr>
              <td align="right">&nbsp;</td>
              <td align="left">
                <button
                  type="button"
                  className="button"
                  onClick={() => void removeAvatar()}
                  disabled={avatarPending || !avatar}
                  title={!avatar ? '当前没有头像' : undefined}
                  aria-label="移除头像"
                >
                  {avatarPending ? '处理中…' : '移除头像'}
                </button>
                {avatarMsg ? (
                  <>
                    {' '}
                    <span
                      className="f12"
                      role={avatarMsg.kind === 'err' ? 'alert' : 'status'}
                      style={{ color: avatarMsg.kind === 'err' ? '#b00' : undefined }}
                    >
                      {avatarMsg.text}
                    </span>
                  </>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---- 基本资料 ---- */}
      <div className="cell">
        <strong>基本资料</strong>
        <div className="sep10" />
        <form onSubmit={saveProfile}>
          <table cellPadding={5} cellSpacing={0} border={0} width="100%">
            <tbody>
              <tr>
                <td width={120} align="right">
                  用户名
                </td>
                <td>
                  <span className="gray">{user.username}</span>
                  <span className="f12 gray"> （用户名不可修改）</span>
                </td>
              </tr>
              <tr>
                <td align="right">
                  头衔
                </td>
                <td>
                  <input
                    type="text"
                    name="tagline"
                    maxLength={255}
                    value={profile.tagline}
                    onChange={(e) => setProfile({ ...profile, tagline: e.target.value })}
                  />
                </td>
              </tr>
              <tr>
                <td align="right">
                  简介
                </td>
                <td>
                  <textarea
                    name="bio"
                    maxLength={5000}
                    value={profile.bio}
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                    style={{ minHeight: 100 }}
                  />
                </td>
              </tr>
              <tr>
                <td align="right">
                  个人主页
                </td>
                <td>
                  <input
                    type="url"
                    name="url"
                    maxLength={512}
                    placeholder="https://"
                    value={profile.url}
                    onChange={(e) => setProfile({ ...profile, url: e.target.value })}
                  />
                  <div className="sep3" />
                  <span className="f12 gray">只支持 http / https 链接</span>
                </td>
              </tr>
              <tr>
                <td align="right">
                  所在地
                </td>
                <td>
                  <input
                    type="text"
                    name="location"
                    maxLength={128}
                    value={profile.location}
                    onChange={(e) => setProfile({ ...profile, location: e.target.value })}
                  />
                </td>
              </tr>
              <tr>
                <td align="right">&nbsp;</td>
                <td>
                  <button type="submit" className="button" disabled={pending || !profileLoaded}>
                    {pending ? '保存中…' : '保存资料'}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </form>
      </div>

      {/* ---- 修改密码 ---- */}
      <div className="cell">
        <strong>修改密码</strong>
        <div className="sep10" />
        <form onSubmit={changePassword}>
          <table cellPadding={5} cellSpacing={0} border={0} width="100%">
            <tbody>
              <tr>
                <td width={120} align="right">
                  当前密码
                </td>
                <td>
                  <input
                    type="password"
                    name="current"
                    maxLength={128}
                    value={pwd.current}
                    onChange={(e) => setPwd({ ...pwd, current: e.target.value })}
                    autoComplete="current-password"
                    required
                  />
                </td>
              </tr>
              <tr>
                <td align="right">
                  新密码
                </td>
                <td>
                  <input
                    type="password"
                    name="next"
                    maxLength={128}
                    value={pwd.next}
                    onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
                    autoComplete="new-password"
                    required
                  />
                  <div className="sep3" />
                  <span className="f12 gray">至少 8 位</span>
                </td>
              </tr>
              <tr>
                <td align="right">
                  确认新密码
                </td>
                <td>
                  <input
                    type="password"
                    name="confirm"
                    maxLength={128}
                    value={pwd.confirm}
                    onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
                    autoComplete="new-password"
                    required
                  />
                </td>
              </tr>
              <tr>
                <td align="right">&nbsp;</td>
                <td>
                  <button type="submit" className="button" disabled={pending}>
                    {pending ? '提交中…' : '修改密码'}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </form>
      </div>

      {/* ---- 账号 ---- */}
      <div className="cell">
        <strong>账号</strong>
        <div className="sep10" />

        <div className="f12 gray">
          积分：<span className="f16">{user.balance}</span>
          {user.role !== 'user' ? (
            <>
              {' '}
              <span className="badge pro">
                {user.role === 'admin' ? '管理员' : '版主'}
              </span>
            </>
          ) : null}
        </div>

        {/* 积分余额与流水 */}
        <div className="sep10" />
        <CreditBadge signedIn={true} initialBalance={user.balance} showLedger />

        {/* 每日签到 */}
        <div className="sep10" />
        {checkin ? (
          <CheckinButton
            checkedIn={checkin.checkedInToday}
            streak={checkin.streak}
            reward={checkin.reward}
          />
        ) : (
          <span className="f12 gray">签到状态加载中…</span>
        )}

        <div className="sep10" />
        <button type="button" className="button" onClick={() => void signout()}>
          退出登录
        </button>

        <div className="sep10" />
        <div className="f12 gray">
          忘记密码？<Link href="/forgot">通过邮箱找回</Link>
        </div>
      </div>
    </>
  );
}
