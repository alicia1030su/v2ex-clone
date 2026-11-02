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
            <div id="Main">
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
