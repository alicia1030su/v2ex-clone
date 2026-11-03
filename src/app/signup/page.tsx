import Logo from '@/components/Logo';
import Footer from '@/components/Footer';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import SignUpForm from '@/components/SignUpForm';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'V2EX › 注册新用户' };

/**
 * 注册页
 *
 * 结构对齐原站 /signup（实测）：
 *   #Main
 *     .box (y=65, h=409)
 *       .cell        标题「V2EX › 注册新用户」
 *       .cell        说明文字
 *       .cell        第三方注册按钮（灰色背景区域）
 *       .cell        补充说明（列表）
 *   #Rightbar       高度为 0（原站此页无侧栏内容）
 *
 * 原站的账号创建已迁移到第三方（Solana / Google），
 * 本项目实现等效的用户名密码注册，并把两种入口并列展示。
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect('/');
  const params = await searchParams;

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
          </div>
          <div id="Main">
            <div className="sep20" />
            <div className="box">
              <div className="header">
                <a href="/">V2EX</a> <span className="chevron">&nbsp;›&nbsp;</span> 注册新用户
              </div>

              <div className="cell">
                欢迎来到 V2EX，这里是创意工作者的数字化公共空间。
              </div>
              <div className="cell">
                你可以通过以下方式注册成为新用户。
              </div>
              <div className="cell">
                如果你之前已经使用电子邮件注册，那么请从{' '}
                <a href="/signin">这里 登录</a>。
              </div>

              {/* 第三方注册入口 —— 与原站布局一致；未接入第三方凭据时为禁用态 */}
              <div className="cell signup-providers">
                <div className="signup-provider">
                  <span className="signup-provider-icon solana">S</span>
                  <span>通过 Solana 注册</span>
                </div>
                <div className="signup-provider">
                  <span className="signup-provider-icon google">G</span>
                  <span>通过 Google 注册</span>
                </div>
              </div>

              <div className="cell">
                <SignUpForm error={params.error} />
              </div>

              <div className="cell">
                <ul className="f12 gray signup-notes">
                  <li>如果你之前已经使用电子邮件注册，那么请从 登录 进入。</li>
                  <li>本站为独立复刻项目，未接入第三方账号；请使用上方的用户名与邮箱注册。</li>
                </ul>
              </div>
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
