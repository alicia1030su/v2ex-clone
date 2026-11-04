'use client';

import { useState } from 'react';
import { csrfFetch } from '@/components/CsrfProvider';

/**
 * 找回密码表单（v0.0.3）
 *
 * 调用 POST /api/auth/forgot-password body { email } → { ok, message }
 *
 * ## 防邮箱枚举
 *
 * 服务端对「邮箱存在」与「邮箱不存在」返回**完全相同**的响应体与状态码，
 * 差异只在服务端耗时。前端因此**不得**根据响应做任何「该邮箱是否存在」的推断 ——
 * 无论成功与否都展示服务端返回的同一条 message。
 *
 * ## 交互约定
 *  - 提交中禁用按钮并显示「发送中…」
 *  - 失败展示服务端 error
 *  - 成功后展示统一提示，并保留输入框便于用户核对邮箱
 */
export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) {
      setMsg({ kind: 'err', text: '请填写邮箱地址' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setMsg({ kind: 'err', text: '邮箱格式不正确' });
      return;
    }

    setPending(true);
    setMsg(null);
    try {
      const res = await csrfFetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (res.ok && data.ok) {
        // 成功与否展示同一条服务端消息（防枚举）
        setMsg({
          kind: 'ok',
          text: data.message ?? '如果该邮箱已注册，重置链接已发送（若邮件服务已配置）',
        });
      } else {
        setMsg({ kind: 'err', text: data.error ?? '发送失败，请稍后重试' });
      }
    } catch {
      setMsg({ kind: 'err', text: '网络错误，请稍后重试' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="cell">
      {msg ? (
        <div
          className={msg.kind === 'err' ? 'problem' : 'toast'}
          style={msg.kind === 'ok' ? { position: 'static', boxShadow: 'none' } : undefined}
          role={msg.kind === 'err' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}

      <form onSubmit={submit}>
        <table cellPadding={5} cellSpacing={0} border={0} width="100%">
          <tbody>
            <tr>
              <td width={120} align="right">
                邮箱
              </td>
              <td align="left">
                <input
                  type="email"
                  name="email"
                  id="email"
                  maxLength={255}
                  placeholder="注册时使用的邮箱"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <div className="sep3" />
                <span className="f12 gray">
                  重置链接会发送到该邮箱。出于安全考虑，无论邮箱是否存在都会显示相同的提示。
                </span>
              </td>
            </tr>
            <tr>
              <td align="right">&nbsp;</td>
              <td align="left">
                <button type="submit" className="button" disabled={pending}>
                  {pending ? '发送中…' : '发送重置链接'}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </form>
    </div>
  );
}
