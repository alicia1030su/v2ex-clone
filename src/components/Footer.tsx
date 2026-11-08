import Link from 'next/link';
import { getOnlineCount, getOnlinePeak } from '@/server/queries';

/**
 * 本项目的版本号（构建期由 next.config.mjs 的 env 注入）。
 *
 * 兜底值 `'unknown'` 是**刻意选的**：若配置漏了注入，页面会显式写
 * `VERSION: unknown` —— 一眼能看出异常。绝不回退到某个「看起来正常」
 * 的固定号（那会重新制造 v0.0.9 那种「页面版本与实际包不符」的问题）。
 */
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown';

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
  // v0.0.10：真实峰值（KV 累计），不再是 `online + 3835` 这种硬编码虚增
  const peak = await getOnlinePeak(online);
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
          &nbsp; <span className="fade">最高记录 {peak}</span>
          <div className="sep20" />
          创意工作者们的社区
          <div className="sep5" />
          World is powered by solitude
          <div className="sep20" />
          <span className="small fade">
            {/*
             * v0.0.10：版本号来自**构建期注入的 package.json**，不再硬编码。
             *
             * 修复前这里是 `VERSION: 3.9.8.5` —— 那是原站的版本号。
             * 用户看到的版本与实际安装的包不一致，排障时会被误导；
             * 而且「发行版真实性门禁」无法把页面显示的版本纳入核对。
             * 现在渲染值与源码同源（next.config.mjs 的 env 注入）。
             */}
            VERSION: {APP_VERSION} · {renderMs ?? 0}ms ·{' '}
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
