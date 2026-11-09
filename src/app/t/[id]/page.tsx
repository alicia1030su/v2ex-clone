import { MAX_PAGE, parsePageParam } from '@/lib/page-param';
import { avatarUrl } from '@/components/Avatar';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { loadTagNames } from '@/server/tags';
import { getSessionUser } from '@/lib/auth';
import { canReviewHiddenNodes } from '@/lib/node-visibility';
import { renderMarkdown } from '@/lib/markdown';
import { relativeTime, fullTimestamp, formatDate } from '@/lib/time';
import { getTopicById, listReplies, REPLIES_PER_PAGE } from '@/server/queries';
import Wrapper from '@/components/Wrapper';
import HotTopics from '@/components/HotTopics';
import PageNav from '@/components/PageNav';
import CollectButton from '@/components/CollectButton';
import ReportButton from '@/components/ReportButton';
import { readCsrfToken } from '@/lib/csrf';
import TopicActions from '@/components/TopicActions';
import ReplyItem from '@/components/ReplyItem';
import { canModifyOwnContent } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function TopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { id } = await params;
  const { p } = await searchParams;
  const topicId = Number(id);
  const page = parsePageParam(p);

  if (!Number.isInteger(topicId) || topicId <= 0) notFound();

  const user = await getSessionUser();
  const csrfToken = await readCsrfToken();
  // v0.0.14 P0-1：节点被转为 pending / hidden 后，其主题对普通访问者
  // 表现为「不存在」（notFound，不泄露「这里曾有内容」）。
  //
  // 放行条件由 `canReviewHiddenNodes(user)` **显式**传入：这是审核入口的
  // 一次显式例外，不是「角色不同看到不同东西」的隐式分支。
  // `user` 必须在本次查询**之前**取到 —— 否则永远拿到 undefined，
  // staff 的审核入口会静默失效（而且失效得看起来很像正常 404）。
  const topic = await getTopicById(topicId, {
    includeHiddenNode: canReviewHiddenNodes(user),
  });
  if (!topic) notFound();

  // v0.0.5：已软删除的主题 —— **staff 仍可访问并恢复**。
  //
  // 原实现：`if (!topic || topic.status === 'deleted') notFound();`
  // 后果是删除后**连版主/管理员都进不去该页**，「恢复」按钮永远点不到
  // ⇒ 内容恢复只能靠后台或手输 URL，UI 闭环是断的
  // （`FEATURE_AUDIT_v0.0.5.md` §二 记录的真实缺陷，E2E 实测发现）。
  //
  // 修法：游客与非 staff 的普通用户仍然看不到（notFound，不泄露
  // 「这里曾有内容」）；staff 看到「已删除」页面 + 恢复按钮。
  //
  // 作者本人**不**放行 —— 原站行为是作者删掉后自己 also 看不到，
  // 恢复是管理动作，不应让作者自舞。
  if (topic.status === 'deleted') {
    const isStaff = user?.role === 'moderator' || user?.role === 'admin';
    if (!isStaff) notFound();
  }

  const nodeRows = await db
    .select()
    .from(schema.nodes)
    .where(eq(schema.nodes.id, topic.nodeId))
    .limit(1);
  const node = nodeRows[0];

  const authorRows = await db
    .select({ id: schema.users.id, username: schema.users.username, avatar: schema.users.avatar })
    .from(schema.users)
    .where(eq(schema.users.id, topic.authorId))
    .limit(1);
  const author = authorRows[0];

  // v0.0.14 P0-1：回复列表同样按节点可见性收敛。
  // staff 打开隐藏节点主题时**必须同时**放行回复，否则审核界面会
  // 「有正文、零回复」—— 看起来完全正常，实际无从判断。
  // 传的是同一个 `canReviewHiddenNodes(user)` 结果，与上面的主题查询同源。
  const canReview = canReviewHiddenNodes(user);
  const { items: replies, total: replyTotal } = await listReplies(
    topicId,
    page,
    REPLIES_PER_PAGE,
    { includeHiddenNode: canReview },
  );
  const totalPages = Math.min(MAX_PAGE, Math.max(1, Math.ceil(replyTotal / REPLIES_PER_PAGE)));
  const contentHtml = await renderMarkdown(topic.content);
  // 预先渲染回复正文（避免在 JSX 回调内 await）
  const repliesWithHtml = await Promise.all(
    replies.map(async (r) => ({ ...r, html: await renderMarkdown(r.content) })),
  );

  // v0.0.3：当前用户的投票与感谢状态（用于操作栏的初始状态）
  const myVoteRows = user
    ? await db
        .select({ direction: schema.votes.direction })
        .from(schema.votes)
        .where(and(eq(schema.votes.userId, user.id), eq(schema.votes.topicId, topicId)))
        .limit(1)
    : [];
  const myThanksRows = user
    ? await db
        .select({ replyId: schema.thanks.replyId })
        .from(schema.thanks)
        .where(eq(schema.thanks.userId, user.id))
        .limit(1000)
    : [];
  const myThanks = new Set(myThanksRows.map((r) => r.replyId));

  // v0.0.14：标签顺序必须稳定。
  // 原实现直接依赖数据库返回顺序 ⇒ 同一主题两次刷新可能顺序不同（可见瑕疵）。
  const tags = await loadTagNames(topicId).then((names) => names.map((name) => ({ name })));

  // 浏览计数
  await db
    .update(schema.topics)
    .set({ views: sql`${schema.topics.views} + 1` })
    .where(eq(schema.topics.id, topicId));

  return (
    <Wrapper
      /*
       * 主题详情右栏。
       *
       * 真实 V2EX 主题页右侧有一个 270px 宽栏位，内容为**广告**。
       * 本项目无广告系统，也不复制第三方广告素材，因此改用本站「今日热议主题」
       * 填充同一栏位 —— 目的是保持与首页/节点页一致的 770 + 270 双栏几何，
       * 而不是留一条 310px 的灰色空档（见 Wrapper.tsx 的 no-rightbar 注释）。
       * 这一处属于**有意的设计替换**，会在视觉差异文档里如实标注。
       */
      rightbar={<HotTopics />}
    >
      <div className="box" style={{ borderBottom: '0px' }}>
        <div className="header">
          <div className="fr">
            <Link href={`/member/${author?.username ?? ''}`}>
              <img
                src={avatarUrl({ id: author?.id ?? 0, username: author?.username ?? "?", avatar: author?.avatar }, 73)}
                className="avatar"
                width={73}
                height={73}
                alt={author?.username}
                data-uid={author?.id}
              />
            </Link>
          </div>
          <div className="flex-one-row gap10">
            <div>
              <Link href="/">V2EX</Link> <span className="chevron">&nbsp;›&nbsp;</span>{' '}
              {node ? (
                <>
                  <Link href={`/go/${node.name}`}>{node.title}</Link>
                </>
              ) : (
                '未知节点'
              )}
            </div>
          </div>
          <div className="sep10" />
          <h1>{topic.title}</h1>
          <small className="gray">
            <Link href={`/member/${author?.username ?? ''}`}>{author?.username}</Link> ·{' '}
            <span title={fullTimestamp(topic.createdAt)}>{relativeTime(topic.createdAt)}</span> ·{' '}
            {topic.views} 次点击
          </small>
        </div>

        <div className="cell">
          <div
            className="topic_content markdown_body"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        </div>
        <div className="cell_ops">
          <CollectButton target="topic" id={topicId} />
          {/* v0.0.5：举报入口 —— 未登录点击会引导去登录；作者本人不渲染 */}
          {topic.authorId !== user?.id ? (
            <ReportButton target="topic" id={topicId} />
          ) : null}
        </div>
      </div>

      <div className="sep20" />
      <div id="topic-replies">
        <div className="box">
          <div className="cell">
            <div className="fr" style={{ margin: '-3px -5px 0px 0px' }}>
              {tags.map((t) => (
                <Link key={t.name} href={`/tag/${encodeURIComponent(t.name)}`} className="tag">
                  <li className="fa fa-tag" /> {t.name}
                </Link>
              ))}
            </div>

          {/* v0.0.3：主题操作栏（投票 / 编辑 / 删除 / 锁定 / 置顶） */}
          <div className="cell">
            <TopicActions
              topic={{
                topicId: topic.id,
                locked: topic.locked,
                pinned: topic.pinned,
                deleted: topic.deletedAt !== null,
                edited: topic.editCount > 0,
                editCount: topic.editCount,
                votes: topic.votes,
                myVote: myVoteRows[0]?.direction ?? null,
                canEdit: canModifyOwnContent(user, topic.authorId),
                canDelete: canModifyOwnContent(user, topic.authorId),
                canModerate:
                  user?.role === 'moderator' || user?.role === 'admin',
              }}
              user={user ? { id: user.id, role: user.role } : null}
              initialContent={topic.content}
              initialTitle={topic.title}
              // v0.0.14：编辑表单需要**当前标签**才能提供「移除」入口。
              // 不传的后果不是崩溃，而是「标签只能加、不能减」——
              // 一个看起来正常、但用户无法纠正自己输入的体验缺陷。
              initialTags={tags.map((t) => t.name)}
            />
          </div>
            <span className="gray">
              {replyTotal} 条回复 &nbsp;<strong className="snow">•</strong> &nbsp;
              {fullTimestamp(topic.lastReplyAt)}
            </span>
          </div>

          {totalPages > 1 ? (
            <div className="cell ps_container">
              <PageNav page={page} totalPages={totalPages} basePath={`/t/${topicId}`} />
            </div>
          ) : null}

          {repliesWithHtml.map((r) => (
            <div key={r.id} id={`r_${r.id}`} className="cell">
              {/* v0.0.6：显式 <tbody> —— 避免 React #418 水合失败（详见 TopicItem 注释） */}
              <table cellPadding={0} cellSpacing={0} border={0} width="100%">
                <tbody>
                  <tr>
                  <td width={48} valign="top" align="center">
                    <Link href={`/member/${r.username}`}>
                      <img
                        src={avatarUrl({ id: r.userId, username: r.username, avatar: r.avatar }, 48)}
                        className="avatar"
                        width={48}
                        height={48}
                        alt={r.username}
                        data-uid={r.userId}
                      />
                    </Link>
                  </td>
                  <td width={10} valign="top" />
                  <td width="auto" valign="top" align="left">
                    <div className="fr">
                      &nbsp; &nbsp; <span className="no">{r.floor}</span>
                    </div>
                    <div className="sep3" />
                    <strong>
                      <Link href={`/member/${r.username}`} className="dark">
                        {r.username}
                      </Link>
                    </strong>{' '}
                    &nbsp;
                    <div className="badges" />
                    &nbsp; &nbsp;
                    <span className="ago" title={fullTimestamp(r.createdAt)}>
                      {relativeTime(r.createdAt)}
                    </span>
                    {r.thanks > 0 ? (
                      <>
                        {' '}
                        &nbsp;
                        <span className="small fade">❤️ {r.thanks}</span>
                      </>
                    ) : null}
                    <div className="sep5" />
                    <div className="reply_content markdown_body" dangerouslySetInnerHTML={{ __html: r.html }} />
                    {/* v0.0.3：回复操作（感谢 / 编辑 / 删除）
                        v0.0.9 修复：容器原为 .sep5 —— 那是 5px 高的空白分隔块，
                        装内容后高度仍被钉在 5px，按钮溢出到卡片高度之外，
                        被 .box{overflow:hidden} 裁掉（实测按钮 bottom 621 > 卡片 606）。
                        改用 .reply_row（padding-top:5px，高度随内容）。 */}
                    <div className="reply_row">
                      <ReplyItem
                        reply={{
                          id: r.id,
                          floor: r.floor,
                          content: r.content,
                          thanks: r.thanks,
                          edited: r.editCount > 0,
                          editCount: r.editCount,
                          deleted: r.deletedAt !== null,
                          quoteId: r.quoteId,
                          authorId: r.userId,
                          authorName: r.username,
                          createdAt: relativeTime(r.createdAt),
                        }}
                        user={user ? { id: user.id, role: user.role } : null}
                        thanked={myThanks.has(r.id)}
                        topicLocked={topic.locked}
                      />
                    </div>
                  </td>
                </tr>
                </tbody>
              </table>
            </div>
          ))}

          {totalPages > 1 ? (
            <div className="cell ps_container">
              <PageNav page={page} totalPages={totalPages} basePath={`/t/${topicId}`} />
            </div>
          ) : null}
        </div>

        {user ? (
          <>
            <div className="sep20" />
            <div className="box">
              <div className="cell">
                <form action="/api/replies" method="post">
                  <input type="hidden" name="topicId" value={topicId} />
                  <input type="hidden" name="redirect" value={`/t/${topicId}`} />
                  {/* 原生表单无法自动加请求头，必须通过隐藏字段传递 CSRF token */}
                  <input type="hidden" name="csrfToken" value={csrfToken} />
                  <textarea
                    name="content"
                    placeholder="回复内容"
                    required
                    minLength={2}
                    maxLength={20000}
                  />
                  <div className="sep10" />
                  <button type="submit" className="button">
                    提交回复
                  </button>
                </form>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="sep20" />
            <div className="box">
              <div className="cell">
                <span className="fade">请先</span> <Link href="/signin">登录</Link>{' '}
                <span className="fade">后回复</span>
              </div>
            </div>
          </>
        )}
      </div>
    </Wrapper>
  );
}
