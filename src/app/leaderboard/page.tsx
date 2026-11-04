import Link from 'next/link';
import Logo from '@/components/Logo';
import Footer from '@/components/Footer';
import { db, schema } from '@/db';
import { desc, eq, isNull, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '积分排行榜 · V2EX Clone',
};

/**
 * 积分排行榜页（v0.0.3）
 *
 * 数据来自服务端查询（真实数据库），不是前端 fetch ——
 * 首屏即有内容，无需等待客户端 JS。
 *
 * 积分规则说明：额度为**可配置**的独立实现，非原站确认规则。
 */
export default async function LeaderboardPage() {
  const rows = await db.execute(sql`
    SELECT
      u.id, u.username, u.avatar, u.balance,
      (SELECT count(*)::int FROM topics t
        WHERE t.author_id = u.id AND t.deleted_at IS NULL) AS topics,
      (SELECT count(*)::int FROM replies r
        WHERE r.author_id = u.id AND r.deleted_at IS NULL) AS replies,
      (SELECT count(*)::int FROM thanks th
        JOIN replies r2 ON r2.id = th.reply_id
        WHERE r2.author_id = u.id) AS thanks_received
    FROM users u
    WHERE u.status = 'active'
    ORDER BY u.balance DESC, u.created_at ASC
    LIMIT 100
  `);

  const list = (rows as unknown as Array<{
    id: number; username: string; avatar: string | null; balance: number;
    topics: number; replies: number; thanks_received: number;
  }>).map((r, i) => ({ ...r, rank: i + 1 }));

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
              <a href="/" className="top">首页</a>
              <a href="/nodes" className="top">节点</a>
              <a href="/leaderboard" className="top">积分</a>
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
                <strong>积分说明</strong>
                <div className="sep5" />
                <span className="fade">
                  积分额度为可配置规则，属本项目的独立实现，不代表原站真实数值。
                  可通过环境变量 TOPIC_CREDITS / REPLY_CREDITS / CHECKIN_CREDITS 调整。
                </span>
              </div>
            </div>
          </div>
          <div id="Main">
            <div className="sep20" />
            <div className="box">
              <div className="header">
                <a href="/">V2EX</a> <span className="chevron">&nbsp;›&nbsp;</span> 积分排行榜
              </div>
              <div className="cell">
                <table width="100%">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>用户</th>
                      <th style={{ width: 80, textAlign: 'right' }}>积分</th>
                      <th style={{ width: 60, textAlign: 'right' }}>主题</th>
                      <th style={{ width: 60, textAlign: 'right' }}>回复</th>
                      <th style={{ width: 80, textAlign: 'right' }}>被感谢</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td className="gray">{r.rank}</td>
                        <td>
                          <Link href={`/member/${r.username}`}>{r.username}</Link>
                        </td>
                        <td align="right">{r.balance}</td>
                        <td align="right">{r.topics}</td>
                        <td align="right">{r.replies}</td>
                        <td align="right">{r.thanks_received}</td>
                      </tr>
                    ))}
                    {list.length === 0 && (
                      <tr>
                        <td colSpan={6} className="fade">
                          暂无用户
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
