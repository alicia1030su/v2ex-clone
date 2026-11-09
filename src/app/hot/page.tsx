import { notFound } from 'next/navigation';
import { MAX_PAGE, parsePageParam } from '@/lib/page-param';
import Wrapper from '@/components/Wrapper';
import TopicItem from '@/components/TopicItem';
import PageNav from '@/components/PageNav';
import HotTopics from '@/components/HotTopics';
import HotNodes from '@/components/HotNodes';
import { listTopics } from '@/server/queries';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

/**
 * 热门主题页（v0.0.4）
 *
 * 补齐的功能缺口：v0.0.3 只有首页侧栏的「今日热议主题」，
 * **没有独立的 /hot 页面** —— 而原站有（/hot 实测需登录，
 * 但路径与布局是公开约定的）。
 *
 * 排序口径与首页侧栏一致（votes DESC, repliesCount DESC），
 * 通过 listTopics 的 sort 选项复用同一套实现，避免两处口径漂移。
 */
export default async function HotPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const page = parsePageParam(p);

  const result = await listTopics({ page, perPage: PAGE_SIZE, sort: 'hot' });
  const totalPages = Math.min(MAX_PAGE, Math.max(1, Math.ceil(result.total / PAGE_SIZE)));

  return (
    <Wrapper
      rightbar={
        <>
          <HotTopics />
          <HotNodes />
        </>
      }
    >
      <div className="box">
        <div className="cell">
          <strong>热门主题</strong>
          <div className="sep5" />
          <span className="fade">按投票数与回复数排序</span>
        </div>

        {result.items.length === 0 ? (
          <div className="cell">
            <span className="fade">暂无主题</span>
          </div>
        ) : (
          result.items.map((t) => <TopicItem key={t.id} topic={t} />)
        )}

        {totalPages > 1 ? (
          <div className="cell">
            <PageNav page={page} totalPages={totalPages} basePath="/hot" />
          </div>
        ) : null}
      </div>
    </Wrapper>
  );
}
