import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { MAX_PAGE, parsePageParam } from '@/lib/page-param';
import { db, schema } from '@/db';
import { safeDecode } from '@/lib/safe-decode';
import { listTopicsByTag, TOPICS_PER_PAGE } from '@/server/queries';
import TopicItem from '@/components/TopicItem';
import PageNav from '@/components/PageNav';
import Wrapper from '@/components/Wrapper';

export const dynamic = 'force-dynamic';

/**
 * 标签页 —— 对应原站主题详情中的 /tag/{name} 链接
 */
export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { name } = await params;
  const { p } = await searchParams;
  const page = parsePageParam(p);
  // 标签名必须在这里解码：**实测证明 Next.js 的 App Router 不会预解码
  // 动态段参数** —— 删掉这行后 `/tag/%E5%89%8D%E7%AB%AF`（中文标签）
  // 会直接 404。这个结论是跑出来的，不是读文档猜的：
  // `e2e/v014-tags.spec.ts` 的「中文标签百分号编码路径必须能命中」用例
  // 在删除解码后立即失败，恢复后通过。
  //
  // `safeDecode` 而不是裸 `decodeURIComponent`：标签名理论上可能含字面量 `%`
  // （`/tag/100%25`），裸 decode 会抛 `URIError: URI malformed` ⇒ 整页 500。
  // 解码失败时退回原值，让「查不到该标签」走正常的 404。
  const tagName = safeDecode(name);

  const tagRows = await db
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.name, tagName))
    .limit(1);
  // 标签不存在 ⇒ 404（不渲染空页：空页会让用户以为「这个标签存在但没有内容」）
  if (!tagRows[0]) notFound();

  // ⚠️ v0.0.14 P0-1：列表查询已收敛到 `listTopicsByTag()`。
  //
  // 原先这里是**页面内联**的 SQL，与 `listTopics()` 是两套实现，于是：
  //   · 它漏掉了节点可见性条件 ⇒ 隐藏节点的主题仍能从标签页读到；
  //   · 它无法被真库测试直接调用 ⇒ 这类「不该出现的东西没出现」的缺陷
  //     只能靠肉眼点页面，而肉眼恰好看不出来。
  //
  // 现在页面只负责「标签不存在 ⇒ 404」与渲染，列表 / 计数全部由
  // `src/server/queries.ts` 的 `listTopicsByTag()` 负责，与其它公共列表
  // 共用同一套可见性口径（`PUBLIC_NODE_CONDITION`）。
  //
  // 分页总数来自 `listTopicsByTag()` 内部的**独立 count** ——
  // 不是 `items.length`（那会把 totalPages 恒定为 1，第 2 页永远不可达；
  // v0.0.14 已修过一次，不要回退）。
  const { items: list, total } = await listTopicsByTag(tagName, page, TOPICS_PER_PAGE);

  const totalPages = Math.min(MAX_PAGE, Math.max(1, Math.ceil(total / TOPICS_PER_PAGE)));

  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>标签</strong>
            <div className="sep5" />
            <span className="fade">{tagName}</span>
          </div>
        </div>
      }
    >
      <div className="box">
        <div className="cell">
          <strong>标签：{tagName}</strong>
        </div>
        {list.length === 0 ? (
          <div className="cell">
            <span className="fade">该标签下暂无主题</span>
          </div>
        ) : (
          // `listTopicsByTag()` 返回的就是 `TopicListItem`，直接交给共用组件渲染 ——
          // 再手拼一次字段等于又造一处「同一实体不同页面形状不同」的口径。
          list.map((t) => <TopicItem key={t.id} topic={t} />)
        )}
        {totalPages > 1 ? (
          <div className="cell">
            <PageNav
              page={page}
              totalPages={totalPages}
              basePath={`/tag/${encodeURIComponent(tagName)}`}
            />
          </div>
        ) : null}
      </div>
    </Wrapper>
  );
}
