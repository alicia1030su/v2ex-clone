import StaticPage from '@/components/StaticPage';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'V2EX › World Clock' };

const ZONES = [
  { id: 'utc', label: 'UTC', tz: 'UTC' },
  { id: 'pvg', label: 'PVG (上海)', tz: 'Asia/Shanghai' },
  { id: 'lax', label: 'LAX (洛杉矶)', tz: 'America/Los_Angeles' },
  { id: 'jfk', label: 'JFK (纽约)', tz: 'America/New_York' },
  { id: 'lhr', label: 'LHR (伦敦)', tz: 'Europe/London' },
  { id: 'nrt', label: 'NRT (东京)', tz: 'Asia/Tokyo' },
  { id: 'sfo', label: 'SFO (旧金山)', tz: 'America/Los_Angeles' },
  { id: 'cdg', label: 'CDG (巴黎)', tz: 'Europe/Paris' },
];

function fmt(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone,
    }).format(date);
  } catch {
    return '--:--:--';
  }
}

function fmtDate(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return '';
  }
}

export default function WorldClockPage() {
  const now = new Date();

  return (
    <StaticPage title="World Clock" breadcrumb="World Clock">
      <h1>World Clock</h1>
      <div className="sep10" />

      <table className="cell" cellPadding={0} cellSpacing={0} border={0} width="100%">
        <tbody>
          {ZONES.map((z) => (
            <tr key={z.id} id={z.id}>
              <td width="50%">
                <a href={`#${z.id}`}>{z.label}</a>
              </td>
              <td width="25%" className="f12 gray">
                {fmtDate(now, z.tz)}
              </td>
              <td width="25%" className="f16">
                {fmt(now, z.tz)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sep10" />
      <p className="f12 fade">
        本页时间由服务端按 Asia/Shanghai 时区渲染，刷新页面即可获取最新时间。
      </p>
    </StaticPage>
  );
}
