import Link from 'next/link';
import { leaderboard } from '@/lib/credit-service';
import { getSessionUser } from '@/lib/auth';
import Wrapper from '@/components/Wrapper';
import PageNav from '@/components/PageNav';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '积分排行榜 · V2EX Clone',
};

/** 每页条目数 */
const PAGE_SIZE = 50;

/**
 * 积分排行榜页（v0.0.3）
 *
 * ## 数据来源
 *
 * 复用 `src/lib/credit-service.ts` 的 `leaderboard()` ——
 * 与 `GET /api/leaderboard` **同一个服务函数**，
 * 因此页面与 API 返回的排名口径完全一致（按余额降序、
 * 同余额按注册时间升序、被封禁用户不参与排行）。
 *
 * 不在这里另写一份 SQL：排行榜口径一旦在两处各写一遍，
 * 迟早会出现「页面和 API 排名不一样」的问题。
 *
 * 首屏由服务端渲染，无需等待客户端 JS。
 *
 * 积分规则说明：额度为**可配置**的独立实现，非原站确认规则。
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const page = Math.max(1, Number(p ?? 1) || 1);

  const user = await getSessionUser();

  const rows = await leaderboard({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });

  // leaderboard() 不返回总数，这里用「是否取满一页」推断是否有下一页
  const hasNext = rows.length === PAGE_SIZE;
  const totalPages = Math.max(1, hasNext ? page + 1 : page);

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>积分说明</strong>
            <div className="sep5" />
            <span className="fade">
              积分额度为可配置规则，属本项目的独立实现，不代表原站真实数值。
              可通过环境变量 TOPIC_CREDITS / REPLY_CREDITS / CHECKIN_CREDITS 调整。
            </span>
          </div>
          {user ? (
            <div className="cell">
              <strong>你的积分</strong>
              <div className="sep5" />
              <span className="f16">{user.balance}</span>
              <div className="sep5" />
              <span className="f12 gray">
                每日签到、发布主题与回复都可以获得积分，见{' '}
                <Link href="/settings">账号设置</Link>。
              </span>
            </div>
          ) : null}
        </div>
      }
    >
      <div className="box">
        <div className="header">
          <Link href="/">V2EX</Link> <span className="chevron">&nbsp;›&nbsp;</span> 积分排行榜
        </div>

        {rows.length === 0 ? (
          <div className="cell">
            <span className="fade">暂无用户</span>
          </div>
        ) : (
          <>
            {rows.map((r, i) => (
              <div key={r.id} className="cell item">
                <table cellPadding={0} cellSpacing={0} border={0} width="100%">
                  <tr>
                    <td width={48} valign="top" align="center">
                      <span className="no f16">{page * PAGE_SIZE - PAGE_SIZE + i + 1}</span>
                    </td>
                    <td width={10} />
                    <td width="auto" valign="middle">
                      <span className="item_title">
                        <Link href={`/member/${r.username}`} className="topic-link">
                          {r.username}
                        </Link>
                      </span>
                      <div className="sep5" />
                      <span className="topic_info">
                        主题 <strong>{r.stats.topics}</strong> · 回复{' '}
                        <strong>{r.stats.replies}</strong> · 被感谢{' '}
                        <strong>{r.stats.thanksReceived}</strong>
                      </span>
                    </td>
                    <td width={90} align="right" valign="middle">
                      <span className="f16">{r.balance}</span>
                      <div className="f12 gray">积分</div>
                    </td>
                  </tr>
                </table>
              </div>
            ))}

            {totalPages > 1 ? (
              <div className="cell">
                <PageNav page={page} totalPages={totalPages} basePath="/leaderboard" />
              </div>
            ) : null}
          </>
        )}
      </div>
    </Wrapper>
  );
}
