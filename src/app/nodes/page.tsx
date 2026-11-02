import Link from 'next/link';
import { listCategories, listNodesByCategory } from '@/server/queries';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

export default async function NodesPage() {
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
