import Logo from '@/components/Logo';
import Footer from '@/components/Footer';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { createCaptcha, captchaFieldName } from '@/server/captcha';
import { isCaptchaDisabled } from '@/lib/runtime-flags';
import SignInForm from '@/components/SignInForm';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect('/');
  const params = await searchParams;

  // 服务端预生成验证码（与原站一致：CAPTCHA 在首屏 HTML 中即存在）
  // 隔离测试环境下不生成也不渲染 —— 服务端校验同样被禁用，两侧保持一致
  const captchaDisabled = isCaptchaDisabled();
  const captcha = captchaDisabled
    ? null
    : await createCaptcha().then((c) => ({
        id: c.id,
        image: c.image,
        field: captchaFieldName(c.id),
      }));

  return (
    <>
      <div id="Top">
        <div className="content">
          <div className="site-nav">
            <a href="/" title="way to explore">
              <Logo />
            </a>
            <div id="search-container">
              <input id="search" type="text" maxLength={128} autoComplete="off" tabIndex={1} />
            </div>
            <div className="tools">
              <a href="/" className="top">
                首页
              </a>
              <a href="/signup" className="top">
                注册
              </a>
              <a href="/signin" className="top">
                登录
              </a>
            </div>
          </div>
        </div>
      </div>

      <div id="Wrapper">
        <div className="content">
          <div id="Leftbar" />
          <div id="Rightbar">
            <div className="sep20" />
            <div className="box">
              <div className="header">其他登录方式</div>
              <div className="cell" style={{ textAlign: 'center' }}>
                <div className="sign_in_methods">
                  <div className="sign_in_with" style={{ opacity: 0.55, cursor: 'not-allowed' }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        margin: '0 auto 6px auto',
                        borderRadius: '50%',
                        background: '#fff',
                        border: '1px solid var(--box-border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        color: '#4285f4',
                      }}
                    >
                      G
                    </div>
                    <div className="sign_in_with_label">Sign in with Google</div>
                  </div>
                  <div className="sign_in_with" style={{ opacity: 0.55, cursor: 'not-allowed' }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        margin: '0 auto 6px auto',
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg,#9945ff,#14f195)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        color: '#fff',
                      }}
                    >
                      S
                    </div>
                    <div className="sign_in_with_label">Sign in with Solana</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div id="Main">
            <div className="sep20" />
            <div className="box">
              <div className="header">
                <a href="/">V2EX</a> <span className="chevron">&nbsp;›&nbsp;</span> 登录 &nbsp;
                <li className="fa fa-lock" />
              </div>
              <SignInForm
                next={params.next ?? '/'}
                error={params.error}
                initialCaptcha={
                  captcha
                    ? {
                        id: captcha.id,
                        field: captcha.field,
                        image: captcha.image,
                        placeholder: '请输入上图中的验证码，点击可以更换图片',
                      }
                    : undefined
                }
              />
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
