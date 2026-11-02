import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { HOME_TABS, SECONDARY_TABS } from '@/lib/nav';
import { listTopics, type TopicListItem } from '@/server/queries';
import TopicItem from '@/components/TopicItem';
import PageNav from '@/components/PageNav';
import HotTopics from '@/components/HotTopics';
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

  const tabKey = params.tab ?? 'home';
  const page = Math.max(1, Number(params.p ?? 1) || 1);

  // 找到当前 tab 对应的节点集合
  const tab = HOME_TABS.find((t) => t.key === tabKey);
  let nodeNames: string[] = tab?.nodes ?? [];

  if (tabKey === 'hot') {
    // 最热：按 votes + replies 排序
    const hot = await db
      .select({ name: schema.nodes.name })
      .from(schema.topics)
      .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
      .where(eq(schema.topics.status, 'published'))
      .groupBy(schema.nodes.name)
      .orderBy(desc(schema.topics.votes))
      .limit(20);
    nodeNames = hot.map((h) => h.name);
  }

  let listResult: { items: TopicListItem[]; total: number } = { items: [], total: 0 };
  if (nodeNames.length > 0) {
    const nodeRows = await db
      .select({ id: schema.nodes.id, name: schema.nodes.name })
      .from(schema.nodes)
      .where(inArray(schema.nodes.name, nodeNames));
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

  const totalPages = Math.max(1, Math.ceil(listResult.total / PAGE_SIZE));

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
          {SECONDARY_TABS.map((t) => (
            <span key={t.name}>
              <Link href={`/go/${t.name}`}>{t.title}</Link>
              &nbsp;&nbsp;&nbsp;
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
