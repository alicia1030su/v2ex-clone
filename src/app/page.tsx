import Link from 'next/link';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { MAX_PAGE, parsePageParam } from '@/lib/page-param';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';
import { HOME_TABS, SECONDARY_TABS } from '@/lib/nav';
import { listTopics, type TopicListItem } from '@/server/queries';
import TopicItem from '@/components/TopicItem';
import PageNav from '@/components/PageNav';
import HotTopics from '@/components/HotTopics';
import HotNodes from '@/components/HotNodes';
import SiteOfTheDay from '@/components/SiteOfTheDay';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; p?: string }>;
}) {
  const params = await searchParams;
  const user = await getSessionUser();

  // v0.0.9：`/` 默认展示「全部」主题，因此默认 tabKey 必须是 'all' ——
  // 原为 'home'（不存在于 HOME_TABS），导致首页**没有任何 tab 处于选中态**，
  // 导航条上一片灰字，与参考截图（有一个深色圆角选中块）明显不同。
  const tabKey = params.tab ?? 'all';
  const page = parsePageParam(params.p);

  // 找到当前 tab 对应的节点集合
  const tab = HOME_TABS.find((t) => t.key === tabKey);
  let nodeNames: string[] = tab?.nodes ?? [];

  if (tabKey === 'hot') {
    // 最热：按「节点内全部主题的 votes + replies 之和」给节点排序，取前 20 个节点。
    //
    // v0.0.9 修复：原先写的是 `groupBy(nodes.name).orderBy(desc(topics.votes))` ——
    // `topics.votes` 既不在 GROUP BY 里也不是聚合函数，PostgreSQL 直接报
    // `column "topics.votes" must appear in the GROUP BY clause or be used in an
    // aggregate function` ⇒ **「最热」tab 恒 500**。因为首页默认 tab 不是它，
    // 这条死链一直没被发现（视觉核验时逐 tab 走查才暴露）。
    const hot = await db
      .select({ name: schema.nodes.name })
      .from(schema.topics)
      .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
      .where(
        and(
          eq(schema.topics.status, 'published'),
          // v0.0.14 P0-1：「节点排行」本身也是公共面 —— 隐藏节点不得上榜，
          // 否则榜单里会出现一个点进去 404 的节点名（既是泄漏也是坏链接）。
          PUBLIC_NODE_CONDITION,
        ),
      )
      .groupBy(schema.nodes.name)
      .orderBy(
        desc(sql<number>`sum(${schema.topics.votes} + ${schema.topics.repliesCount})`),
      )
      .limit(20);
    nodeNames = hot.map((h) => h.name);
  }

  let listResult: { items: TopicListItem[]; total: number } = { items: [], total: 0 };
  if (nodeNames.length > 0) {
    const nodeRows = await db
      .select({ id: schema.nodes.id, name: schema.nodes.name })
      .from(schema.nodes)
      .where(and(inArray(schema.nodes.name, nodeNames), PUBLIC_NODE_CONDITION));
    const nodeIds = nodeRows.map((n) => n.id);
    if (nodeIds.length === 1) {
      listResult = await listTopics({ nodeId: nodeIds[0], page, perPage: PAGE_SIZE });
    } else if (nodeIds.length > 1) {
      listResult = await listTopicsByIds(nodeIds, page, PAGE_SIZE);
    }
  } else {
    // 全部：所有节点
    listResult = await listAllTopics(page, PAGE_SIZE);
  }

  const totalPages = Math.min(MAX_PAGE, Math.max(1, Math.ceil(listResult.total / PAGE_SIZE)));

  return (
    <Wrapper
      rightbar={
        <>
          <div className="box">
            <div className="cell">
              <strong>V2EX = way to explore</strong>
              <div className="sep5" />
              <span className="fade">V2EX 是一个关于分享和探索的地方</span>
            </div>
            <div className="inner">
              <div className="sep5" />
              <div style={{ textAlign: 'center' }}>
                <Link href="/signup" className="super normal button">
                  现在注册
                </Link>
              </div>
              <div className="sep5" />
              <div className="sep10" />
              已注册用户请 &nbsp;
              <Link href="/signin">登录</Link>
            </div>
          </div>
          <HotTopics />
          <HotNodes />
          <SiteOfTheDay />
        </>
      }
    >
      <div className="box">
        <div className="cell">
          {HOME_TABS.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={t.key === tabKey ? 'tab_current' : 'tab'}
            >
              {t.label}
            </Link>
          ))}
          &nbsp;
          <Link href="/xna" className="tab">
            VXNA
          </Link>
        </div>
        <div className="cell" id="SecondaryTabs">
          {/* v0.0.6：分隔符从 `&nbsp;&nbsp;&nbsp;` 改为**可换行的普通空格** ——
              `&nbsp;` 是不可断空格，连成序列后会锁死整行宽度
              （实测 Firefox@320 溢出 14px）。间距改由 CSS 的 margin 提供。 */}
          {SECONDARY_TABS.map((t) => (
            <span key={t.name}>
              <Link href={`/go/${t.name}`}>{t.title}</Link>
            </span>
          ))}
        </div>

        {listResult.items.length === 0 ? (
          <div className="cell">
            <span className="fade">暂无主题</span>
          </div>
        ) : (
          listResult.items.map((t) => <TopicItem key={t.id} topic={t} />)
        )}

        {totalPages > 1 ? (
          <div className="cell">
            <PageNav page={page} totalPages={totalPages} basePath="/" tab={tabKey} />
          </div>
        ) : null}
      </div>
    </Wrapper>
  );
}

async function listAllTopics(page: number, perPage: number) {
  const { listTopics: list } = await import('@/server/queries');
  return list({ page, perPage });
}

async function listTopicsByIds(nodeIds: number[], page: number, perPage: number) {
  const { listTopicsByNodeIds } = await import('@/server/queries');
  return listTopicsByNodeIds(nodeIds, page, perPage);
}
