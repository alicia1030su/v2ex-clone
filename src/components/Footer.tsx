import Link from 'next/link';
import { getOnlineCount } from '@/server/queries';

/**
 * 页脚 —— 对应原站 #Bottom
 *
 * 结构（实测自原站 signin.html）：
 *   #Bottom > .content > .inner
 *     .fr            赞助商图标（右浮动）
 *     strong         链接组（关于 · 帮助文档 · 自助推广系统 · 博客 · API · FAQ · Privacy · Solana）+ 在线人数
 *     创意工作者们的社区
 *     World is powered by solitude
 *     small.fade     VERSION: x · 耗时 · UTC/PVG/LAX/JFK 时间 · ♥ Do have faith in what you're doing.
 */
export default async function Footer({ renderMs }: { renderMs?: number }) {
  const online = await getOnlineCount();
  const now = new Date();

  return (
    <div id="Bottom">
      <div className="content">
        <div className="inner">
          <div className="sep10" />
          <strong>
            <Link href="/about" className="dark">
              关于
            </Link>{' '}
            &nbsp; <span className="snow">·</span> &nbsp;
            <Link href="/faq" className="dark">
              FAQ
            </Link>{' '}
            &nbsp; <span className="snow">·</span> &nbsp;
            <Link href="/privacy" className="dark">
              Privacy
            </Link>{' '}
            &nbsp; <span className="snow">·</span> &nbsp; {online} 人在线
          </strong>{' '}
          &nbsp; <span className="fade">最高记录 {online + 3835}</span>
          <div className="sep20" />
          创意工作者们的社区
          <div className="sep5" />
          World is powered by solitude
          <div className="sep20" />
          <span className="small fade">
            VERSION: 3.9.8.5 · {renderMs ?? 0}ms ·{' '}
            <Link href="/worldclock#utc">UTC {fmtTime(now, 'UTC')}</Link> ·{' '}
            <Link href="/worldclock#pvg">PVG {fmtTime(now, 'Asia/Shanghai')}</Link> ·{' '}
            <Link href="/worldclock#lax">LAX {fmtTime(now, 'America/Los_Angeles')}</Link> ·{' '}
            <Link href="/worldclock#jfk">JFK {fmtTime(now, 'America/New_York')}</Link>
            <br />♥ Do have faith in what you&apos;re doing.
          </span>
          <div className="sep10" />
        </div>
      </div>
    </div>
  );
}

function fmtTime(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).format(date);
  } catch {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}`;
  }
}
