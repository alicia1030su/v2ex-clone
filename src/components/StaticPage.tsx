import Link from 'next/link';
import Logo from '@/components/Logo';
import Footer from '@/components/Footer';
import NavTools from '@/components/NavTools';

/**
 * 静态信息页骨架
 *
 * 结构对齐原站（实测自 about.html / faq.html）：
 *   #Top > .content > .site-nav
 *   #Wrapper > .content
 *     #Rightbar  （可选侧栏）
 *     #Main
 *       .sep20
 *       .box
 *         .header  面包屑（V2EX › 标题）
 *         .inner
 *           .page   正文
 */
export default function StaticPage({
  title,
  breadcrumb,
  children,
  rightbar,
}: {
  title: string;
  breadcrumb: string;
  children: React.ReactNode;
  rightbar?: React.ReactNode;
}) {
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
            <NavTools user={null} />
          </div>
        </div>
      </div>

      <div id="Wrapper">
        <div className="content">
          <div id="Leftbar" />
          {rightbar ? (
            <>
              <div id="Rightbar">
                <div className="sep20" />
                {rightbar}
              </div>
              <div id="Main">
                <div className="sep20" />
                <div className="box">
                  <div className="header">
                    <Link href="/">V2EX</Link> <span className="chevron">&nbsp;›&nbsp;</span>{' '}
                    {breadcrumb}
                  </div>
                  <div className="inner">
                    <div className="page">{children}</div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div id="Main">
              <div className="sep20" />
              <div className="box">
                <div className="header">
                  <Link href="/">V2EX</Link> <span className="chevron">&nbsp;›&nbsp;</span>{' '}
                  {breadcrumb}
                </div>
                <div className="inner">
                  <div className="page">{children}</div>
                </div>
              </div>
            </div>
          )}
          <div className="c" />
          <div className="sep20" />
        </div>
      </div>
      <Footer />
    </>
  );
}
