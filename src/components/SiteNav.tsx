import Link from 'next/link';
import { getSessionUser } from '@/lib/auth';
import SearchBox from './SearchBox';
import Logo from './Logo';

export default async function SiteNav() {
  const user = await getSessionUser();

  return (
    <div id="Top">
      <div className="content">
        <div className="site-nav">
          <Link href="/" title="way to explore">
            <Logo />
          </Link>
          <SearchBox />
          <div className="tools">
            {user ? (
              <>
                <Link href="/" className="top">
                  首页
                </Link>
                <Link href="/notifications" className="top">
                  通知
                </Link>
                <Link href="/bookmarks" className="top">
                  收藏
                </Link>
                <Link href="/leaderboard" className="top">
                  积分
                </Link>
                <Link href={`/member/${user.username}`} className="top">
                  {user.username}
                </Link>
                <Link href="/settings" className="top">
                  设置
                </Link>
              </>
            ) : (
              <>
                <Link href="/" className="top">
                  首页
                </Link>
                <Link href="/signup" className="top">
                  注册
                </Link>
                <Link href="/signin" className="top">
                  登录
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
