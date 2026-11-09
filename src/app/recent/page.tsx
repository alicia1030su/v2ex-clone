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
 * 最新主题页（v0.0.4）
 *
 * 补齐的功能缺口：原站有 /recent（实测 HTTP 200，公开可访问），
 * v0.0.3 没有对应页面。
 *
 * 排序口径：按主题创建时间倒序（与「最近回复」不同 —— 后者按最后回复时间）。
 */
export default async function RecentPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const page = parsePageParam(p);

  const result = await listTopics({ page, perPage: PAGE_SIZE, sort: 'created' });
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
          <strong>最新主题</strong>
          <div className="sep5" />
          <span className="fade">按发布时间排序</span>
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
            <PageNav page={page} totalPages={totalPages} basePath="/recent" />
          </div>
        ) : null}
      </div>
    </Wrapper>
  );
}
