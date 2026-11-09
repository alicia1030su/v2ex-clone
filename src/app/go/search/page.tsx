import Link from 'next/link';
import { and, desc, eq, ilike, or, count } from 'drizzle-orm';
import { MAX_PAGE, parsePageParam } from '@/lib/page-param';
import { db, schema } from '@/db';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';
import { TOPICS_PER_PAGE } from '@/server/queries';
import { relativeTime, fullTimestamp } from '@/lib/time';
import { avatarUrl } from '@/components/Avatar';
import NodeHeader from '@/components/NodeHeader';
import { RssIcon, JsonFeedIcon, CopyIcon } from '@/components/FeedIcons';
import Pager from '@/components/Pager';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

/**
 * 搜索结果页 —— 对应原站 /go/search?q=
 *
 * 原站结构（实测自 go_search_q_node.html）：
 *   .box.box-title.node-header     节点横幅（标题=搜索关键词，主题总数=结果数）
 *   .box
 *     .cell.ps_container            顶部分页器
 *     #TopicsNode
 *       .cell.from_{uid}.t_{id}     主题项
 *     .cell.ps_container            底部分页器
 *   #Rightbar
 *     .box  节点订阅方式（RSS / JSON Feed / Planet）
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? '').trim();
  const page = parsePageParam(params.p);

  const keyword = q || '搜索';

  // 结果统计
  //
  // v0.0.14 P0-1：列表与 count **都必须**带节点可见性条件。
  // 注意 count 只 `from(topics)` 是不够的 —— 条件引用 `nodes.status` 时
  // PostgreSQL 会报 42P01（缺少 FROM 子句项），所以 count 也要 join nodes，
  // 与列表查询保持同一组表、同一个 where 构造方式。
  const topicRows = q
    ? await db
        .select({
          id: schema.topics.id,
          title: schema.topics.title,
          votes: schema.topics.votes,
          repliesCount: schema.topics.repliesCount,
          createdAt: schema.topics.createdAt,
          lastReplyAt: schema.topics.lastReplyAt,
          authorId: schema.users.id,
          authorName: schema.users.username,
          authorAvatar: schema.users.avatar,
          nodeId: schema.nodes.id,
          nodeName: schema.nodes.name,
          nodeTitle: schema.nodes.title,
        })
        .from(schema.topics)
        .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
        .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
        .where(
          and(
            eq(schema.topics.status, 'published'),
            PUBLIC_NODE_CONDITION,
            or(
              ilike(schema.topics.title, `%${q}%`),
              ilike(schema.topics.content, `%${q}%`),
            ),
          ),
        )
        .orderBy(desc(schema.topics.lastReplyAt))
        .limit(TOPICS_PER_PAGE)
        .offset((page - 1) * TOPICS_PER_PAGE)
    : [];

  const totalRows = q
    ? await db
        .select({ n: count() })
        .from(schema.topics)
        .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
        .where(
          and(
            eq(schema.topics.status, 'published'),
            PUBLIC_NODE_CONDITION,
            or(
              ilike(schema.topics.title, `%${q}%`),
              ilike(schema.topics.content, `%${q}%`),
            ),
          ),
        )
    : [{ n: 0 }];
  const total = Number(totalRows[0]?.n ?? 0);
  const totalPages = Math.min(MAX_PAGE, Math.max(1, Math.ceil(total / TOPICS_PER_PAGE)));

  // 节点与会员匹配
  // v0.0.14 P0-1：节点匹配同样不得列出隐藏 / 待审节点 ——
  // 节点名 + 节点标题本身就是一条泄漏（且指向 404 的死链）。
  const nodeRows = q
    ? await db
        .select()
        .from(schema.nodes)
        .where(
          and(
            PUBLIC_NODE_CONDITION,
            or(ilike(schema.nodes.title, `%${q}%`), ilike(schema.nodes.name, `%${q}%`))!,
          ),
        )
        .limit(20)
    : [];

  const memberRows = q
    ? await db
        .select({ id: schema.users.id, username: schema.users.username, avatar: schema.users.avatar })
        .from(schema.users)
        .where(ilike(schema.users.username, `%${q}%`))
        .limit(20)
    : [];

  return (
    <Wrapper
      rightbar={
        /*
         * 搜索结果是动态查询，**没有对应的订阅源**。
         * 原实现照抄节点页的「节点订阅方式」盒子，指向 /feed/search.xml|json ——
         * 这两个路由不存在，实测恒 404（给用户四个死链）。
         * 现在改为站点级订阅源，并把标题改成如实的「站点订阅方式」。
         */
        <div className="box">
          <div className="pro-unit-title">站点订阅方式</div>
          <div className="cell" style={{ padding: '8px', lineHeight: '100%' }}>
            <table cellPadding={0} cellSpacing={0} border={0} width="100%">
              <tbody>
                <tr>
                  <td width={28}>
                    <a href="/api/feed" target="_blank" rel="noopener noreferrer">
                      <RssIcon size={28} />
                    </a>
                  </td>
                  <td width={10} />
                  <td width="auto" valign="middle" align="left">
                    <a href="/api/feed" target="_blank" rel="noopener noreferrer">
                      RSS
                    </a>
                  </td>
                  <td width={16} valign="middle" align="right" />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="cell" style={{ padding: '8px', lineHeight: '100%' }}>
            <table cellPadding={0} cellSpacing={0} border={0} width="100%">
              <tbody>
                <tr>
                  <td width={28}>
                    <a href="/api/feed/json" target="_blank" rel="noopener noreferrer">
                      <JsonFeedIcon size={28} />
                    </a>
                  </td>
                  <td width={10} />
                  <td width="auto" valign="middle" align="left">
                    <a href="/api/feed/json" target="_blank" rel="noopener noreferrer">
                      JSON Feed
                    </a>
                  </td>
                  <td width={16} valign="middle" align="right" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      }
    >
      {/*
        节点横幅 —— 标题为搜索关键词，主题总数为匹配结果数。
        不传 feedName：搜索结果是动态查询，**没有对应的 feed 资源**。
        原实现传 feedName="search" 会拼出 /feed/search.xml（404），
        等于给用户一个坏图标。
      */}
      <NodeHeader title={keyword} topicCount={total} />

      <div className="box">
        {totalPages > 1 ? (
          <Pager
            page={page}
            totalPages={totalPages}
            basePath="/go/search"
            query={q ? { q } : undefined}
          />
        ) : null}

        <div id="TopicsNode">
          {nodeRows.length > 0 ? (
            <>
              <div className="cell section">节点</div>
              {nodeRows.map((n) => (
                <div key={n.id} className="cell">
                  <Link href={`/go/${n.name}`}>{n.title}</Link>{' '}
                  <span className="f12 gray">({n.name})</span>
                </div>
              ))}
            </>
          ) : null}

          {memberRows.length > 0 ? (
            <>
              <div className="cell section">会员</div>
              {memberRows.map((m) => (
                <div key={m.id} className="cell">
                  <Link href={`/member/${m.username}`}>{m.username}</Link>
                </div>
              ))}
            </>
          ) : null}

          {q ? (
            <>
              <div className="cell section">主题</div>
              {topicRows.length === 0 ? (
                <div className="cell">
                  <span className="fade">没有找到相关主题</span>
                </div>
              ) : (
                topicRows.map((t) => (
                  <div key={t.id} className={`cell from_${t.authorId} t_${t.id}`}>
                    <table cellPadding={0} cellSpacing={0} border={0} width="100%">
                      <tbody>
                        <tr>
                          <td width={48} valign="top" align="center">
                            <Link href={`/member/${t.authorName}`}>
                              <img
                                src={avatarUrl(
                                  {
                                    id: t.authorId,
                                    username: t.authorName,
                                    avatar: t.authorAvatar,
                                  },
                                  48,
                                )}
                                className="avatar"
                                width={48}
                                height={48}
                                alt={t.authorName}
                                data-uid={t.authorId}
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
                                <Link href={`/member/${t.authorName}`}>{t.authorName}</Link>
                              </strong>{' '}
                              &nbsp;•&nbsp;
                              <span title={fullTimestamp(t.createdAt)}>
                                {relativeTime(t.createdAt)}
                              </span>
                            </span>
                          </td>
                          <td width={70} align="right" valign="middle">
                            <Link href={`/t/${t.id}#reply${t.repliesCount}`} className="count_livid">
                              {t.repliesCount}
                            </Link>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </>
          ) : (
            <div className="cell">
              <span className="fade">请在顶部搜索框输入关键词</span>
            </div>
          )}
        </div>

        {totalPages > 1 ? (
          <Pager
            page={page}
            totalPages={totalPages}
            basePath="/go/search"
            query={q ? { q } : undefined}
          />
        ) : null}
      </div>
    </Wrapper>
  );
}
