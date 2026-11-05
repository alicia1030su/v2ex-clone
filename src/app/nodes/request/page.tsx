import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { listCategories } from '@/server/queries';
import NodeRequestForm from '@/components/NodeRequestForm';
import Wrapper from '@/components/Wrapper';

/**
 * 节点申请页（v0.0.4）
 *
 * ## 为什么要有这个页面
 *
 * v0.0.4 之前，节点申请只有后端 API（`POST /api/node-requests`），
 * **没有任何前端入口** —— 用户根本没法提交申请。
 * 现在这个页面把「提交申请 → 等待审核 → 审批结果可见」串成闭环：
 *   - 本页提交申请
 *   - 管理员在 `/admin` 的「节点申请」tab 审批（AdminConsole 已有）
 *   - 审批结果回显在本页的「我提交的申请」里
 *
 * ## 鉴权
 *
 * 未登录 → 跳转登录页（与其它需登录页面一致）。
 * 提交动作本身还有服务端鉴权 + CSRF + 限流（三重保护）。
 */
export const dynamic = 'force-dynamic';

export default async function NodeRequestPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin?next=%2Fnodes%2Frequest');

  const categories = await listCategories();

  // 我提交过的申请（最近的 20 条）—— 让用户能看到审核进度
  const myRequests = await db
    .select({
      id: schema.nodeRequests.id,
      name: schema.nodeRequests.name,
      title: schema.nodeRequests.title,
      status: schema.nodeRequests.status,
      createdAt: schema.nodeRequests.createdAt,
    })
    .from(schema.nodeRequests)
    .where(eq(schema.nodeRequests.requesterId, user.id))
    .orderBy(desc(schema.nodeRequests.id))
    .limit(20);

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>申请节点</strong>
            <div className="sep5" />
            <span className="fade">
              社区目前有 {categories.length} 个分类。申请通过后节点立即可见。
            </span>
          </div>
          <div className="cell">
            <strong>审核流程</strong>
            <div className="sep5" />
            <span className="f12 gray">
              1. 提交申请（节点名 + 标题 + 可选描述）
              <br />
              2. 管理员或版主在后台审批
              <br />
              3. 通过后节点**真正创建**，可直接访问 /go/节点名
              <br />
              4. 未通过会显示在本页的申请列表里
            </span>
          </div>
        </div>
      }
    >
      <div className="box">
        <div className="header">
          <a href="/">V2EX</a> <span className="chevron">&nbsp;›&nbsp;</span>{' '}
          <a href="/nodes">节点</a> <span className="chevron">&nbsp;›&nbsp;</span> 申请节点
        </div>
        <NodeRequestForm
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            title: c.title,
          }))}
          myRequests={myRequests.map((r) => ({
            id: r.id,
            name: r.name,
            title: r.title,
            status: r.status,
            createdAt:
              r.createdAt instanceof Date
                ? r.createdAt.toISOString()
                : String(r.createdAt),
          }))}
        />
      </div>
    </Wrapper>
  );
}
