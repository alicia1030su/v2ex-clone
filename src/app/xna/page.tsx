import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';
import { relativeTime } from '@/lib/time';
import { avatarUrl } from '@/components/Avatar';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

/**
 * VXNA 聚合页
 *
 * 原站 /xna 聚合外部博客源，DOM 结构为：
 *   .box > .inner#Tabs（分类 tab，VXNA 为当前）
 *   .cell#SecondaryTabs（来源数 + 二级来源链接）
 *   .xna-entry.cell × N
 *     .xna-entry-avatar-container
 *     .xna-entry-main-container
 *       .xna-entry-title
 *       .xna-entry-info（来源 / 作者 / 时间）
 *
 * 本页复刻该结构与交互，数据来自本站自身的聚合节点，
 * 不复制原站的第三方聚合内容。
 */
export default async function XnaPage() {
  // 聚合节点：名称为 `vxna` 的节点
  // v0.0.14 P0-1：节点本身也必须是 active —— 否则聚合页会继续为
  // 一个已隐藏的节点工作（渲染标题、链接到 `/go/vxna` 死链）。
  const nodes = await db
    .select()
    .from(schema.nodes)
    .where(and(eq(schema.nodes.name, 'vxna'), PUBLIC_NODE_CONDITION))
    .limit(1);

  const topics = nodes[0]
    ? await db
        .select({
          id: schema.topics.id,
          title: schema.topics.title,
          createdAt: schema.topics.createdAt,
          authorId: schema.users.id,
          username: schema.users.username,
          avatar: schema.users.avatar,
        })
        .from(schema.topics)
        .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
        // v0.0.14 P0-1：主题查询同样要 join nodes 并过滤 ——
        // 只过滤外层节点是不够的：主题的 nodeId 与外层查询是两个入口。
        .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
        .where(and(eq(schema.topics.nodeId, nodes[0].id), PUBLIC_NODE_CONDITION))
        .orderBy(desc(schema.topics.createdAt))
        .limit(20)
    : [];

  return (
    <Wrapper>
      <div className="box">
        <div className="inner" id="Tabs">
          <Link href="/?tab=tech" className="tab">
            技术
          </Link>
          <Link href="/?tab=create" className="tab">
            创意
          </Link>
          <Link href="/?tab=play" className="tab">
            好玩
          </Link>
          <Link href="/?tab=apple" className="tab">
            Apple
          </Link>
          <Link href="/?tab=jobs" className="tab">
            酷工作
          </Link>
          <Link href="/?tab=deals" className="tab">
            交易
          </Link>
          <Link href="/?tab=city" className="tab">
            城市
          </Link>
          <Link href="/?tab=qna" className="tab">
            问与答
          </Link>
          <Link href="/?tab=hot" className="tab">
            最热
          </Link>
          <Link href="/?tab=all" className="tab">
            全部
          </Link>
          <Link href="/?tab=r2" className="tab">
            R2
          </Link>
          <Link href="/xna" className="tab_current">
            VXNA
          </Link>
        </div>
        <div className="cell" id="SecondaryTabs">
          <div className="fr fade f12">Aggregating from {topics.length} entries</div>
          <Link href="/go/vxna">VXNA</Link> &nbsp; &nbsp;
          {/*
            v0.0.13 起 `/feed/{node}.xml` **路由已实现**（src/app/feed/[file]/route.ts），
            但本页的数据源是名为 `vxna` 的聚合节点 —— 该节点在默认 seed 里**不存在**，
            对它请求 `/feed/vxna.xml` 仍会得到 404。因此这里继续指向站点级 feed。
            用原生 <a> 而非 next/link：feed 不是页面路由，预取只会白跑一次。
          */}
          <a href="/api/feed" target="_blank" rel="noopener noreferrer">
            RSS
          </a>{' '}
          &nbsp; &nbsp;
          <Link href="/nodes">全部节点</Link>
        </div>

        {topics.length === 0 ? (
          <div className="cell">
            <span className="fade">暂无聚合内容</span>
          </div>
        ) : (
          topics.map((t) => (
            <div key={t.id} className="xna-entry cell">
              <div className="xna-entry-avatar-container">
                <Link href={`/member/${t.username}`}>
                  <img
                    src={avatarUrl(
                      { id: t.authorId, username: t.username, avatar: t.avatar },
                      48,
                    )}
                    className="avatar"
                    width={48}
                    height={48}
                    alt={t.username}
                    data-uid={t.authorId}
                  />
                </Link>
              </div>
              <div className="xna-entry-main-container">
                <div className="xna-entry-title">
                  <Link href={`/t/${t.id}`} className="topic-link">
                    {t.title}
                  </Link>
                </div>
                <div className="xna-entry-info">
                  <span className="xna-entry-source">
                    <Link href="/go/vxna" className="node">
                      VXNA
                    </Link>
                  </span>
                  <span className="fade">&nbsp;•&nbsp;</span>
                  <span className="xna-source-author">
                    <Link href={`/member/${t.username}`}>{t.username}</Link>
                  </span>
                  <span className="fade">&nbsp;•&nbsp;</span>
                  <span className="xna-entry-date">{relativeTime(t.createdAt)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Wrapper>
  );
}
