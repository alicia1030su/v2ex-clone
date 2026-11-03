'use client';

import { csrfFetch } from '@/components/CsrfProvider';

import { useState } from 'react';

type User = {
  id: number;
  username: string;
  role: string;
  balance: number;
  avatar: string | null;
};

export default function SettingsForm({ user }: { user: User }) {
  const [profile, setProfile] = useState({
    tagline: '',
    bio: '',
    url: '',
    location: '',
  });
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    try {
      const res = await csrfFetch('/api/settings/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      setMsg(
        res.ok && data.ok
          ? { kind: 'ok', text: '资料已保存' }
          : { kind: 'err', text: data.error ?? '保存失败' },
      );
    } catch {
      setMsg({ kind: 'err', text: '网络错误' });
    } finally {
      setPending(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwd.next !== pwd.confirm) {
      setMsg({ kind: 'err', text: '两次输入的新密码不一致' });
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
      const data = (await res.json()) as { ok?: boolean; error?: string };
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
          >
            {msg.text}
          </div>
        </div>
      ) : null}

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
                  <button type="submit" className="button" disabled={pending}>
                    保存资料
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </form>
      </div>

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
                    required
                  />
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
                    required
                  />
                </td>
              </tr>
              <tr>
                <td align="right">&nbsp;</td>
                <td>
                  <button type="submit" className="button" disabled={pending}>
                    修改密码
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </form>
      </div>

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
        <div className="sep10" />
        <button type="button" className="button" onClick={signout}>
          退出登录
        </button>
      </div>
    </>
  );
}
