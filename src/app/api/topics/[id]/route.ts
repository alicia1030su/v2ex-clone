import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq, and } from 'drizzle-orm';
import {
  editTopic,
  softDeleteTopic,
  getTopicDetail,
  ContentError,
} from '@/lib/content-service';
import { writeAuditLog, AuditAction } from '@/lib/audit';
import { guardCommunityAction } from '@/lib/community-rate-limit';
import { attachTags, detachTags, loadTagNames } from '@/server/tags';

export const dynamic = 'force-dynamic';

/**
 * GET /api/topics/[id] —— 主题详情（含回复列表）
 *
 * 软删除处理：已删除主题对普通访问者返回 404（表现得像不存在），
 * 仅 staff 或作者本人可用 ?includeDeleted=true 看到，并带 deleted 标记。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const topicId = Number(id);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }

  const user = await getSessionUser();
  const url = new URL(request.url);
  const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
  const replyLimit = Number(url.searchParams.get('replyLimit') ?? 100);
  const replyOffset = Number(url.searchParams.get('replyOffset') ?? 0);

  const { topic, replies, replyTotal } = await getTopicDetail(topicId, user, {
    includeDeleted,
    replyLimit: Number.isFinite(replyLimit) ? replyLimit : 100,
    replyOffset: Number.isFinite(replyOffset) ? replyOffset : 0,
  });

  if (!topic) {
    return NextResponse.json({ ok: false, error: '主题不存在' }, { status: 404 });
  }

  // 取作者信息
  const authorRows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
    })
    .from(schema.users)
    .where(eq(schema.users.id, topic.authorId))
    .limit(1);

  // 取当前用户的投票与感谢状态
  let myVote: string | null = null;
  const myThanks: number[] = [];
  if (user) {
    const voteRows = await db
      .select({ direction: schema.votes.direction })
      .from(schema.votes)
      .where(
        and(eq(schema.votes.userId, user.id), eq(schema.votes.topicId, topicId)),
      )
      .limit(1);
    myVote = voteRows[0]?.direction ?? null;

    const thanksRows = await db
      .select({ replyId: schema.thanks.replyId })
      .from(schema.thanks)
      .where(eq(schema.thanks.userId, user.id))
      .limit(500);
    myThanks.push(...thanksRows.map((r) => r.replyId));
  }

  return NextResponse.json({
    ok: true,
    topic: {
      id: topic.id,
      title: topic.title,
      content: topic.content,
      nodeId: topic.nodeId,
      authorId: topic.authorId,
      author: authorRows[0] ?? null,
      status: topic.status,
      repliesCount: topic.repliesCount,
      views: topic.views,
      votes: topic.votes,
      locked: topic.locked,
      pinned: topic.pinned,
      edited: topic.editCount > 0,
      editCount: topic.editCount,
      editedAt: topic.editedAt,
      deleted: topic.deletedAt !== null,
      deletedAt: topic.deletedAt,
      deletedReason: topic.deletedReason,
      lastReplyAt: topic.lastReplyAt,
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt,
    },
    replies: replies.map((r) => ({
      id: r.id,
      topicId: r.topicId,
      authorId: r.authorId,
      content: r.content,
      floor: r.floor,
      thanks: r.thanks,
      quoteId: r.quoteId,
      edited: r.editCount > 0,
      editCount: r.editCount,
      editedAt: r.editedAt,
      deleted: r.deletedAt !== null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    replyTotal,
    myVote,
    myThanks,
  });
}

/**
 * PUT /api/topics/[id] —— 编辑主题
 *
 * 权限：作者本人（受编辑时限）或 moderator/admin。
 * 每次编辑写入 edit_history。
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;
  // v0.0.5：社区动作频率限制（用户 + IP 双维度）
  const rl = await guardCommunityAction('topic_mutation', user?.id ?? null);
  if (rl) return rl;

  const { id } = await params;
  const topicId = Number(id);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    title?: string;
    content?: string;
    /** v0.0.14：本次追加的标签（不传 = 不动已有标签；传空数组 = 也不动） */
    tags?: string[] | string;
    /**
     * v0.0.14：本次**显式移除**的标签。
     *
     * 为什么需要独立字段：`tags` 是追加语义（见 `src/server/tags.ts`），
     * 用它表达"移除"就会退化成"清空重写"，一次误操作会抹掉历史标签。
     * 两者可同时出现：先移除、再追加，最终仍受总量 5 个约束。
     */
    removeTags?: string[] | string;
  } | null;

  // v0.0.14：**只提交标签变更也是合法请求**。
  //
  // 原判断只认 title / content / tags，于是「我只想删掉一个标签」这种请求
  // 会被 400 挡住（前端删完标签点保存 ⇒ 报"没有需要修改的内容"）。
  // 这是体验缺陷，不是安全边界：真正的鉴权在下面 `editTopic()` 里。
  if (
    !body ||
    (body.title === undefined &&
      body.content === undefined &&
      body.tags === undefined &&
      body.removeTags === undefined)
  ) {
    return NextResponse.json({ ok: false, error: '没有需要修改的内容' }, { status: 400 });
  }

  try {
    // ⚠️ v0.0.14（P0-2 配套）：**先鉴权、再写标签**。
    //
    // 原实现把 `attachTags()` 放在 `editTopic()` **之前**，理由是
    //「正文校验失败时标签已经写进去，属于部分成功；反之正文成功而标签丢失
    // 是静默错误」。这个理由**只对了一半**，却漏掉了一个真实的安全问题：
    //
    //   `editTopic()` 是**唯一的**授权 + 编辑时限校验点
    //   （作者本人 / moderator / admin、`TOPIC_EDIT_WINDOW_MINUTES`）。
    //   它在标签写入**之后**才执行 ⇒ 任何登录用户都可以用一个
    //   `{ "tags": ["xxx"] }` 请求给**别人的主题**打上/删掉标签：
    //   正文那条路会 403，**标签却已经落库了**。
    //   这不是"部分成功"，这是「一个 403 的请求改了数据」。
    //
    // 现在改为「先 editTopic（鉴权 + 校验 + 写正文）→ 再写标签」：
    //   · 未授权 / 超时限 ⇒ 直接 403，标签一个字都不动（安全）；
    //   · 正文非法 ⇒ 400，标签也不动（原子性更好：整条请求要么都生效，要么都不生效）；
    //   · 正文成功但标签写失败 ⇒ 记日志并在响应里回 `tags: undefined`
    //     （前端 `window.location.reload()` 后以库里真实数据为准，不会显示假标签）。
    //
    // 代价：一次"纯标签编辑"也会 `editCount + 1`。这是刻意取舍 ——
    // 比"再写一份权限判断"（必然与 content-service 漂移，V13-01 的教训）安全得多。
    const result = await editTopic(user, topicId, {
      title: body.title,
      content: body.content,
    });

    // v0.0.14：标签是「追加」语义 —— 编辑正文不应该把历史标签一起抹掉。
    //
    // v0.0.14（P0-2 配套）：**先移除、再追加**。
    // 顺序不能反：「删一个、加一个」时若先追加，`attachTags` 会因为
    // 「已有 5 个」把新标签全部丢弃，用户看到的是"加不上"。
    // 两个操作各自是独立事务（各自 `FOR UPDATE` 锁主题行），中间可能被其它
    // 请求插入 —— 但总量上限由 `attachTags` 在锁内重新计算，
    // 任何交错都不会让某主题超过 5 个标签。
    let appliedTags: string[] | undefined;
    if (body.tags !== undefined || body.removeTags !== undefined) {
      try {
        if (body.removeTags !== undefined) {
          await detachTags(topicId, body.removeTags);
        }
        if (body.tags !== undefined) {
          await attachTags(topicId, body.tags);
        }

        // 回显**库里最终的**标签，而不是本次输入：
        // 输入可能被额度截断、被移除、也还含此前已有的标签。只回显输入会让
        // 前端以为"额度没生效"（P0-2 最容易漏掉的一半）。
        appliedTags = await loadTagNames(topicId);
      } catch (err) {
        // 正文已经保存成功，这里不再把整条请求判失败 ——
        // 但**绝不**回显一个"看起来成功"的标签数组：`undefined` 让前端知道
        // 「标签状态未知」，刷新后以库为准。
        console.error('[topics] 编辑时标签写入失败（正文已更新）', err);
        appliedTags = undefined;
      }
    }

    // v0.0.5：补写**操作审计**。
    //
    // ⚠️ `editTopic()` 只写 `edit_history`（内容快照，不可变）——
    //    那是「内容改了什么」，**不是**「谁在什么时候改的」。
    //    任务书 §十一 要求「重要行为审计」；
    //    `AuditAction.TOPIC_EDIT` 此前**定义了却从未被调用**。
    //
    // ⚠️ v0.0.14：文案必须按**事实**判，不能按**请求形状**判。
    //
    //    修复前是 `body.title !== undefined ? '编辑标题' : body.content !== undefined ? '编辑正文' : '编辑标签'`。
    //    而 `TopicEditForm` **总是**提交 `content`（payload 无条件带正文），
    //    所以用户「只删一个标签」时 `body.content !== undefined` 为真 ⇒
    //    审计写 **「编辑正文」**，而正文逐字没变（`editTopic` 的空改动分支
    //    已经证明它没变、也没写库）。也就是说：`edit_history` 干净了，
    //    `audit_logs` 里仍是一条指向"改正文"的**错因记录** ——
    //    审计表说假话，与空快照是同一类缺陷。
    //
    //    判据改为服务层返回的 `result.changed`（它刚比过库内值，逐字段给出）。
    //    为什么不让路由自己再查一次库比对：
    //      ① 多一次往返；② 存在「两次读之间被别人改了」的竞态，
    //      读到的值未必是本请求写下的值 —— 那是「按请求形状猜」的同类错误，
    //      只是把猜测挪到了另一个地方。
    //
    //    四种落点（**传了 ≠ 变了**，所以必须逐字段判）：
    //      · 标题真的变了 ⇒ 「编辑标题」（标题与正文都变时优先报标题，与旧行为一致）
    //      · 只有正文变了 ⇒ 「编辑正文」
    //      · 内容一个字段都没变、本次只动了标签 ⇒ 「编辑标签」
    //      · 内容没变、也没带标签字段 ⇒ 「无实际改动」
    //
    //    ⚠️ 最后一种在正常流程里不该发生（空请求会被上面 400 拦掉），
    //    但一旦出现，审计必须如实记录「什么都没改」，而不是随便挑一个像样的文案。
    const auditReason = result.changed.title
      ? '编辑标题'
      : result.changed.content
        ? '编辑正文'
        : body.tags !== undefined || body.removeTags !== undefined
          ? '编辑标签'
          : '无实际改动';
    await writeAuditLog(user.id, {
      action: AuditAction.TOPIC_EDIT,
      targetType: 'topic',
      targetId: topicId,
      reason: auditReason,
    });

    return NextResponse.json({ ok: true, topic: result, tags: appliedTags });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[topics] 编辑失败:', err);
    return NextResponse.json({ ok: false, error: '编辑失败，请重试' }, { status: 500 });
  }
}

/**
 * DELETE /api/topics/[id] —— 软删除主题
 *
 * 内容保留在库中（可恢复），但普通列表与详情一律不可见。
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;
  // v0.0.5：社区动作频率限制（用户 + IP 双维度）
  const rl = await guardCommunityAction('topic_mutation', user?.id ?? null);
  if (rl) return rl;

  const { id } = await params;
  const topicId = Number(id);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  const reason = typeof body?.reason === 'string' ? body.reason : undefined;

  try {
    const result = await softDeleteTopic(user, topicId, reason);
    // 记录审计（作者自删与管理删除都记录，便于追溯）
    await writeAuditLog(user.id, {
      action: AuditAction.TOPIC_DELETE,
      targetType: 'topic',
      targetId: topicId,
      reason: reason ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ContentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[topics] 删除失败:', err);
    return NextResponse.json({ ok: false, error: '删除失败，请重试' }, { status: 500 });
  }
}
