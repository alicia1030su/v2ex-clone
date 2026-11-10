'use client';

import { csrfFetch } from '@/components/CsrfProvider';

import { useState } from 'react';

export default function SignUpForm({ error }: { error?: string }) {
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(error ?? null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (form.password !== form.confirm) {
      setMsg('两次输入的密码不一致');
      return;
    }
    setPending(true);
    try {
      const res = await csrfFetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username,
          email: form.email,
          password: form.password,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; redirect?: string };
      if (res.ok && data.ok) {
        window.location.href = data.redirect ?? '/';
        return;
      }
      setMsg(data.error ?? '注册失败');
    } catch {
      setMsg('网络错误，请重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {msg ? (
        <div className="problem" id="problem">
          {msg}
        </div>
      ) : null}
      <form onSubmit={submit} className="auth-form">
        <table cellPadding={5} cellSpacing={0} border={0} width="100%">
          <tbody>
            <tr>
              <td width={120} align="right">
                用户名
              </td>
              <td>
                <input
                  type="text"
                  name="username"
                  id="username"
                  maxLength={32}
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  autoComplete="username"
                  required
                />
              </td>
            </tr>
            <tr>
              <td align="right">
                邮箱
              </td>
              <td>
                <input
                  type="email"
                  name="email"
                  id="email"
                  maxLength={255}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                />
              </td>
            </tr>
            <tr>
              <td align="right">
                密码
              </td>
              <td>
                <input
                  type="password"
                  name="password"
                  id="password"
                  maxLength={128}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="new-password"
                  required
                />
              </td>
            </tr>
            <tr>
              <td align="right">
                确认密码
              </td>
              <td>
                <input
                  type="password"
                  name="confirm"
                  id="confirm"
                  maxLength={128}
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  autoComplete="new-password"
                  required
                />
              </td>
            </tr>
            <tr>
              <td align="right">&nbsp;</td>
              <td>
                <button type="submit" className="button" disabled={pending}>
                  {pending ? '注册中…' : '注册'}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </form>
    </>
  );
}
