import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';

/**
 * 最热节点 —— 对应原站首页侧栏的「最热节点」区块
 *
 * 原站结构（实测自 home.html）：
 *   .box
 *     .cell  <span class="fade">最热节点</span>
 *     .cell  a.item_node × N
 *     .inner RSS 图标 + 链接
 */
export default async function HotNodes() {
  // 按主题数排序取前 15 个节点
  const nodes = await db
    .select({
      id: schema.nodes.id,
      name: schema.nodes.name,
      title: schema.nodes.title,
      topicsCount: schema.nodes.topicsCount,
    })
    .from(schema.nodes)
    .where(eq(schema.nodes.status, 'active'))
    .orderBy(desc(schema.nodes.topicsCount), desc(schema.nodes.id))
    .limit(15);

  if (nodes.length === 0) return null;

  return (
    <>
      <div className="sep20" />
      <div className="box">
        <div className="cell">
          <div className="fr" />
          <span className="fade">最热节点</span>
        </div>
        <div className="cell">
          {nodes.map((n) => (
            <Link key={n.id} href={`/go/${n.name}`} className="item_node">
              {n.title}
            </Link>
          ))}
        </div>
        <div className="inner">
          <Link href="/index.xml" target="_blank">
            RSS
          </Link>
        </div>
      </div>
    </>
  );
}
