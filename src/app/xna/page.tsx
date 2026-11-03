import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
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
  // 聚合节点：名称以 xna- 开头的节点
  const nodes = await db
    .select()
    .from(schema.nodes)
    .where(eq(schema.nodes.name, 'vxna'))
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
        .where(eq(schema.topics.nodeId, nodes[0].id))
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
          <Link href="/feed/vxna.xml">RSS</Link> &nbsp; &nbsp;
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
