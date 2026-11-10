import Link from 'next/link';
import { getSessionUser } from '@/lib/auth';
import { listCategories, listNodesByCategory } from '@/server/queries';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

export default async function NodesPage() {
  const user = await getSessionUser();

  /*
   * v0.0.16：**一次**取全部分类 + **一次**取全部节点，再在内存里分组。
   *
   * 修复前是「先查分类，再对每个分类各查一次节点」的经典 N+1：
   *
   *     categories.map((c) => <NodeCategoryBlock categoryId={c.id} />)
   *       → NodeCategoryBlock 内部 await listNodesByCategory(c.id)
   *
   * 实测（本地种子库，9 个分类）：该页 **17** 个数据库事务，
   * 分类越多线性增长；每个分类一次往返，首屏 TTFB 被串行 RTT 拖长。
   *
   * 修复后：**2** 个事务（等价于两个全表小查询），与分类数无关。
   * 节点总数是几十到几百的量级，一次取回并分组的内存代价可忽略 ——
   * 用「一次多读几行」换掉「N 次往返」在这里是明确划算的。
   *
   * ⚠️ 不要为了「看起来更省」改成 N 次查询 + 缓存：节点目录是低频页，
   *    加缓存只会引入失效问题，换不来可感知的收益。
   */
  const [categories, allNodes] = await Promise.all([listCategories(), listNodesByCategory()]);

  const nodesByCategory = new Map<number, typeof allNodes>();
  for (const n of allNodes) {
    // `nodes.category_id` 在 schema 里可空（历史数据 / 待归档节点）。
    // 没有分类的节点不属于任何分组 —— 跳过而不是塞进 `null` 键，
    // 否则 `get(c.id)` 拿不到它，而它也不会出现在页面上（预期行为）。
    if (n.categoryId === null) continue;
    const list = nodesByCategory.get(n.categoryId);
    if (list) list.push(n);
    else nodesByCategory.set(n.categoryId, [n]);
  }

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>全部节点</strong>
            <div className="sep5" />
            <span className="fade">按分类浏览所有节点</span>
          </div>
          {/* v0.0.4：节点申请的 UI 入口（此前只有后端 API，没有提交入口） */}
          {user ? (
            <div className="cell">
              <Link href="/nodes/request" className="dark">
                申请新节点
              </Link>
              <div className="sep5" />
              <span className="f12 gray">提交节点申请，由管理员或版主审批</span>
            </div>
          ) : null}
        </div>
      }
    >
      {categories.map((c) => (
        <NodeCategoryBlock key={c.id} title={c.title} nodes={nodesByCategory.get(c.id) ?? []} />
      ))}
    </Wrapper>
  );
}

function NodeCategoryBlock({
  title,
  nodes,
}: {
  title: string;
  nodes: Array<{ id: number; name: string; title: string }>;
}) {
  if (nodes.length === 0) return null;

  return (
    <>
      <div className="box">
        <div className="cell section">{title}</div>
        <div className="cell">
          {nodes.map((n) => (
            <span key={n.id}>
              <Link href={`/go/${n.name}`}>{n.title}</Link>
              &nbsp;&nbsp;
            </span>
          ))}
        </div>
      </div>
      <div className="sep20" />
    </>
  );
}
