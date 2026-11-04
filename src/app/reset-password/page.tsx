'use client';

import { csrfFetch } from '@/components/CsrfProvider';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Logo from '@/components/Logo';
import Footer from '@/components/Footer';
import Link from 'next/link';

/**
 * 重置密码页（v0.0.3）
 *
 * 流程：
 *  1. 从 URL 取 token（邮件链接形如 /reset-password?token=xxx）
 *  2. 挂载时调用 GET /api/auth/reset-password?token=... 校验令牌（**不消费**）
 *  3. 令牌有效 → 显示新密码表单；无效 → 显示失效原因与重新申请入口
 *  4. 提交 POST /api/auth/reset-password { token, newPassword }
 *
 * 安全说明：
 *  - 令牌只存在于 URL 与内存 state，不写入 localStorage / sessionStorage
 *  - 校验接口只读不消费，真正的消费发生在提交时（服务端原子消费，防重放）
 *  - 重置成功后服务端会销毁该用户全部会话，前端跳转到登录页
 */

type CheckState =
  | { status: 'checking' }
  | { status: 'valid'; expiresAt?: string }
  | { status: 'invalid'; reason: string };

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [check, setCheck] = useState<CheckState>({ status: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setCheck({ status: 'invalid', reason: '重置链接无效：缺少令牌参数' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/auth/reset-password?token=${encodeURIComponent(token)}`,
        );
        const data = (await res.json()) as {
          ok?: boolean;
          valid?: boolean;
          error?: string;
          expiresAt?: string;
        };
        if (cancelled) return;
        if (res.ok && data.ok && data.valid) {
          setCheck({ status: 'valid', expiresAt: data.expiresAt });
        } else {
          setCheck({
            status: 'invalid',
            reason: data.error ?? '重置链接无效或已失效',
          });
        }
      } catch {
        if (!cancelled) setCheck({ status: 'invalid', reason: '网络错误，请稍后重试' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (password.length < 8) {
      setMsg({ kind: 'err', text: '密码至少 8 位' });
      return;
    }
    if (password !== confirm) {
      setMsg({ kind: 'err', text: '两次输入的新密码不一致' });
      return;
    }

    setPending(true);
    try {
      const res = await csrfFetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (res.ok && data.ok) {
        setMsg({ kind: 'ok', text: data.message ?? '密码已重置，请使用新密码登录' });
        setPassword('');
        setConfirm('');
        // 服务端已销毁全部会话，稍候跳转到登录页
        setTimeout(() => router.push('/signin?reset=1'), 1200);
        return;
      }
      setMsg({ kind: 'err', text: data.error ?? '重置失败，请重试' });
      if (res.status === 400) {
        setCheck({ status: 'invalid', reason: data.error ?? '重置链接无效或已失效' });
      }
    } catch {
      setMsg({ kind: 'err', text: '网络错误，请重试' });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div id="Top">
        <div className="content">
          <div className="site-nav">
            <Link href="/" title="way to explore">
              <Logo />
            </Link>
            <div id="search-container">
              <input id="search" type="text" maxLength={128} autoComplete="off" tabIndex={1} />
            </div>
            <div className="tools">
              <Link href="/" className="top">
                首页
              </Link>
              <Link href="/signup" className="top">
                注册
              </Link>
              <Link href="/signin" className="top">
                登录
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div id="Wrapper">
        <div className="content">
          <div id="Leftbar" />
          <div id="Main">
            <div className="sep20" />
            <div className="box">
              <div className="header">
                <Link href="/">V2EX</Link> <span className="chevron">&nbsp;›&nbsp;</span> 重置密码
              </div>

              {check.status === 'checking' ? (
                <div className="cell">
                  <span className="fade">正在校验重置链接…</span>
                </div>
              ) : null}

              {check.status === 'invalid' ? (
                <div className="cell">
                  <div className="problem" id="problem">
                    {check.reason}
                  </div>
                  <div className="sep10" />
                  <Link href="/forgot" className="button">
                    重新申请重置链接
                  </Link>{' '}
                  <Link href="/signin" className="button">
                    返回登录
                  </Link>
                </div>
              ) : null}

              {check.status === 'valid' ? (
                <div className="cell">
                  {msg ? (
                    <div
                      className={msg.kind === 'err' ? 'problem' : 'toast'}
                      id="problem"
                      style={
                        msg.kind === 'ok'
                          ? { position: 'static', boxShadow: 'none' }
                          : undefined
                      }
                    >
                      {msg.text}
                    </div>
                  ) : null}
                  <form onSubmit={submit}>
                    <table cellPadding={5} cellSpacing={0} border={0} width="100%">
                      <tbody>
                        <tr>
                          <td width={120} align="right">
                            新密码
                          </td>
                          <td align="left">
                            <input
                              type="password"
                              name="newPassword"
                              id="newPassword"
                              maxLength={128}
                              autoComplete="new-password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
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
                          <td align="left">
                            <input
                              type="password"
                              name="confirmPassword"
                              id="confirmPassword"
                              maxLength={128}
                              autoComplete="new-password"
                              value={confirm}
                              onChange={(e) => setConfirm(e.target.value)}
                              required
                            />
                          </td>
                        </tr>
                        <tr>
                          <td align="right">&nbsp;</td>
                          <td align="left">
                            <button type="submit" className="button" disabled={pending}>
                              {pending ? '重置中…' : '重置密码'}
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </form>
                  <div className="sep10" />
                  <div className="f12 gray">
                    重置成功后，你的所有登录会话都会失效，需要重新登录。
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="c" />
          <div className="sep20" />
        </div>
      </div>
      <Footer />
    </>
  );
}
