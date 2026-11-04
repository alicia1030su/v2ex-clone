import Link from 'next/link';
import { getSessionUser } from '@/lib/auth';
import { listCategories, listNodesByCategory } from '@/server/queries';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

export default async function NodesPage() {
  const user = await getSessionUser();
  const categories = await listCategories();

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
        <NodeCategoryBlock key={c.id} categoryId={c.id} title={c.title} />
      ))}
    </Wrapper>
  );
}

async function NodeCategoryBlock({ categoryId, title }: { categoryId: number; title: string }) {
  const nodes = await listNodesByCategory(categoryId);
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
