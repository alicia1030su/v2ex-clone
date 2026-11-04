import Logo from '@/components/Logo';
import Footer from '@/components/Footer';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import SettingsForm from '@/components/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin?next=%2Fsettings');

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
              <a href="/notifications" className="top">
                通知
              </a>
              <a href="/bookmarks" className="top">
                收藏
              </a>
              <a href="/leaderboard" className="top">
                积分
              </a>
              <a href={`/member/${user.username}`} className="top">
                {user.username}
              </a>
              <a href="/settings" className="top">
                设置
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
                <strong>账号设置</strong>
                <div className="sep5" />
                <span className="fade">修改资料、密码与账号安全</span>
              </div>
            </div>
          </div>
          <div id="Main">
            <div className="sep20" />
            <div className="box">
              <div className="header">
                <a href="/">V2EX</a> <span className="chevron">&nbsp;›&nbsp;</span> 账号设置
              </div>
              <SettingsForm user={user} />
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
