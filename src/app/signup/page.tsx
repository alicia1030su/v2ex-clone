import Logo from '@/components/Logo';
import Footer from '@/components/Footer';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import SignUpForm from '@/components/SignUpForm';

export const dynamic = 'force-dynamic';

export default async function SignUpPage() {
  const user = await getSessionUser();
  if (user) redirect('/');

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
              <div className="cell">
                <strong>V2EX = way to explore</strong>
                <div className="sep5" />
                <span className="fade">V2EX 是一个关于分享和探索的地方</span>
              </div>
            </div>
          </div>
          <div id="Main">
            <div className="sep20" />
            <div className="box">
              <div className="header">
                <a href="/">V2EX</a> <span className="chevron">&nbsp;›&nbsp;</span> 注册
              </div>
              <SignUpForm />
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
