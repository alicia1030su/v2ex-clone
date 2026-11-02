'use client';

import { useCallback, useEffect, useState } from 'react';

type Captcha = {
  id: string;
  field: string;
  image: string;
  placeholder: string;
};

export default function SignInForm({
  next,
  error,
  initialCaptcha,
}: {
  next: string;
  error?: string;
  initialCaptcha?: Captcha;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [captcha, setCaptcha] = useState<Captcha | null>(initialCaptcha ?? null);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(error ?? null);

  const loadCaptcha = useCallback(async () => {
    try {
      const res = await fetch('/api/captcha');
      if (!res.ok) return;
      const data = (await res.json()) as { ok?: boolean } & Captcha;
      if (data.ok && data.id) {
        setCaptcha({
          id: data.id,
          field: data.field,
          image: data.image,
          placeholder: data.placeholder,
        });
        setCaptchaText('');
      }
    } catch {
      /* 验证码加载失败不阻塞登录表单 */
    }
  }, []);

  useEffect(() => {
    void loadCaptcha();
  }, [loadCaptcha]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          next,
          captchaId: captcha?.id,
          captchaField: captcha?.field,
          captchaText,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; redirect?: string };
      if (res.ok && data.ok) {
        window.location.href = data.redirect ?? next;
        return;
      }
      setMsg(data.error ?? '登录失败');
      // 验证码一次性，失败后需刷新
      void loadCaptcha();
    } catch {
      setMsg('网络错误，请重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="cell">
      {msg ? (
        <div className="problem" id="problem">
          {msg}
        </div>
      ) : null}
      <form onSubmit={submit}>
        <table cellPadding={5} cellSpacing={0} border={0} width="100%">
          <tbody>
            <tr>
              <td width={120} align="right">
                用户名
              </td>
              <td width="auto" align="left">
                <input
                  type="text"
                  name="username"
                  id="username"
                  maxLength={32}
                  placeholder="用户名或电子邮件地址"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </td>
            </tr>
            <tr>
              <td align="right">
                密码
              </td>
              <td align="left">
                <input
                  type="password"
                  name="password"
                  id="password"
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </td>
            </tr>
            {captcha ? (
              <tr>
                <td align="right" valign="top">
                  你是机器人吗？
                </td>
                <td align="left">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    id="captcha-image"
                    width={320}
                    height={80}
                    src={captcha.image}
                    alt="CAPTCHA"
                    onClick={() => void loadCaptcha()}
                    style={{ display: 'block', borderRadius: 3 }}
                  />
                  <div className="sep10" />
                  <input
                    type="text"
                    name={captcha.field}
                    id={captcha.field}
                    maxLength={8}
                    placeholder={captcha.placeholder}
                    value={captchaText}
                    onChange={(e) => setCaptchaText(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </td>
              </tr>
            ) : null}
            <tr>
              <td align="right" />
              <td align="left">
                <button type="submit" className="button" disabled={pending}>
                  {pending ? '登录中…' : '登录'}
                </button>
              </td>
            </tr>
            <tr>
              <td align="right" />
              <td align="left">
                <a href="/forgot">我忘记密码了</a>
              </td>
            </tr>
          </tbody>
        </table>
      </form>
    </div>
  );
}
