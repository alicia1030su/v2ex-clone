import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getNodeByName, listTopics, TOPICS_PER_PAGE } from '@/server/queries';
import { relativeTime, fullTimestamp } from '@/lib/time';
import { avatarUrl } from '@/components/Avatar';
import { RssIcon, JsonFeedIcon, CopyIcon } from '@/components/FeedIcons';
import CollectButton from '@/components/CollectButton';
import PageNav from '@/components/PageNav';
import Pager from '@/components/Pager';
import NodeHeader from '@/components/NodeHeader';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

export default async function NodePage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { name } = await params;
  const { p } = await searchParams;
  const page = Math.max(1, Number(p ?? 1) || 1);

  const node = await getNodeByName(name);
  if (!node) notFound();

  const { items, total } = await listTopics({
    nodeId: node.id,
    page,
    perPage: TOPICS_PER_PAGE,
  });
  const totalPages = Math.max(1, Math.ceil(total / TOPICS_PER_PAGE));

  // 子节点（原站节点页侧栏的「子节点」区块）
  const children = await db
    .select()
    .from(schema.nodes)
    .where(eq(schema.nodes.parentId, node.id))
    .limit(20);

  return (
    <Wrapper
      rightbar={
        <>
          <div className="box">
            <div className="pro-unit-title">节点订阅方式</div>
            <div className="cell" style={{ padding: '8px', lineHeight: '100%' }}>
              <table cellPadding={0} cellSpacing={0} border={0} width="100%">
                <tbody>
                  <tr>
                    <td width={28}>
                      <a href={`/api/nodes/${node.name}/feed`} target="_blank" rel="noopener noreferrer">
                        <RssIcon size={28} />
                      </a>
                    </td>
                    <td width={10} />
                    <td width="auto" valign="middle" align="left">
                      <a href={`/api/nodes/${node.name}/feed`} target="_blank" rel="noopener noreferrer">
                        RSS
                      </a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="cell" style={{ padding: '8px', lineHeight: '100%' }}>
              <table cellPadding={0} cellSpacing={0} border={0} width="100%">
                <tbody>
                  <tr>
                    <td width={28}>
                      <a
                        href={`/api/nodes/${node.name}/feed?format=json`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <JsonFeedIcon size={28} />
                      </a>
                    </td>
                    <td width={10} />
                    <td width="auto" valign="middle" align="left">
                      <a
                        href={`/api/nodes/${node.name}/feed?format=json`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        JSON Feed
                      </a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {children.length > 0 ? (
            <>
              <div className="sep20" />
              <div className="box">
                <div className="cell-top">
                  <span className="f12 gray">子节点</span>
                </div>
                <div className="nodes-sidebar-container">
                  {children.map((n) => (
                    <Link key={n.id} href={`/go/${n.name}`} className="node-sidebar-item">
                      {n.title}
                    </Link>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </>
      }
    >
      {/* 节点头部 —— 对应原站 .box-title.node-header */}
      <NodeHeader
        title={node.title}
        topicCount={total}
        feedName={node.name}
        avatar={node.avatar}
      />
      <div className="cell_ops">
        <CollectButton target="node" id={node.id} label="加入收藏" />
      </div>

      <div className="box">
        {totalPages > 1 ? (
          <Pager page={page} totalPages={totalPages} basePath={`/go/${node.name}`} />
        ) : null}

        <div id="TopicsNode">
          {items.length === 0 ? (
            <div className="cell">
              <span className="fade">该节点暂无主题</span>
            </div>
          ) : (
            items.map((t) => (
              <div key={t.id} className={`cell from_${t.author.id} t_${t.id}`}>
                <table cellPadding={0} cellSpacing={0} border={0} width="100%">
                  <tbody>
                    <tr>
                      <td width={48} valign="top" align="center">
                        <Link href={`/member/${t.author.username}`}>
                          <img
                            src={avatarUrl(
                              {
                                id: t.author.id,
                                username: t.author.username,
                                avatar: t.author.avatar,
                              },
                              48,
                            )}
                            className="avatar"
                            width={48}
                            height={48}
                            alt={t.author.username}
                            data-uid={t.author.id}
                          />
                        </Link>
                      </td>
                      <td width={10} />
                      <td width="auto" valign="middle">
                        <span className="item_title">
                          <Link
                            href={`/t/${t.id}#reply${t.repliesCount}`}
                            className="topic-link"
                            id={`topic-link-${t.id}`}
                          >
                            {t.title}
                          </Link>
                        </span>
                        <div className="sep5" />
                        <span className="topic_info">
                          <strong>
                            <Link href={`/member/${t.author.username}`}>{t.author.username}</Link>
                          </strong>{' '}
                          &nbsp;•&nbsp;
                          <span title={fullTimestamp(t.createdAt)}>
                            {relativeTime(t.createdAt)}
                          </span>
                          {t.lastReplier ? (
                            <>
                              {' '}
                              &nbsp;•&nbsp; 最后回复来自{' '}
                              <strong>
                                <Link href={`/member/${t.lastReplier.username}`}>
                                  {t.lastReplier.username}
                                </Link>
                              </strong>
                            </>
                          ) : null}
                        </span>
                      </td>
                      <td width={70} align="right" valign="middle">
                        <Link
                          href={`/t/${t.id}#reply${t.repliesCount}`}
                          className="count_livid"
                        >
                          {t.repliesCount}
                        </Link>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>

        {totalPages > 1 ? (
          <Pager page={page} totalPages={totalPages} basePath={`/go/${node.name}`} />
        ) : null}
      </div>
    </Wrapper>
  );
}
