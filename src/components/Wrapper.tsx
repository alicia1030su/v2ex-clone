import SiteNav from './SiteNav';
import Footer from './Footer';

export default function Wrapper({
  children,
  rightbar,
}: {
  children: React.ReactNode;
  rightbar?: React.ReactNode;
}) {
  return (
    <>
      <SiteNav />
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
                {children}
              </div>
            </>
          ) : (
            /*
             * 无右栏时不要保留右侧 310px 边距。
             *
             * `#Main` 的 `margin-right: 310px` 是为了给 270px 右栏 + 20px 间隔让位；
             * 没有右栏却仍保留这个边距，页面右侧会出现一条**纯灰色的空档**
             * （实测 /t/<id> 与 /xna：内容列右边缘到页面右边缘有 310px 空白），
             * 与真实 V2EX 的紧凑布局不符。加 `no-rightbar` 后收窄为对称留白。
             */
            <div id="Main" className="no-rightbar">
              <div className="sep20" />
              {children}
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
