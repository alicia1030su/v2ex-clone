import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';
import { getSessionUser } from '@/lib/auth';
import { rateLimitByUser } from '@/lib/rate-limit';
import { grantCredits, creditAmounts } from '@/lib/credit-service';
import { allocateFloor, ensureFloorCounter } from '@/server/floor';
import { sanitizeRedirect, seeOther } from '@/lib/redirect';
import { getFormData } from '@/lib/csrf';
import { extractMentions, buildMentionMessage } from '@/lib/mentions';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  // CSRF 校验（置于鉴权之后：未登录请求直接 401，不泄露端点存在性）
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const ct = request.headers.get('content-type') ?? '';
  let topicId = 0;
  let content = '';
  let redirect = '/';

  if (ct.includes('application/json')) {
    const body = (await request.json().catch(() => null)) as {
      topicId?: number;
      content?: string;
      redirect?: string;
    } | null;
    topicId = Number(body?.topicId ?? 0);
    content = (body?.content ?? '').trim();
    redirect = sanitizeRedirect(body?.redirect);
  } else {
    // 复用 CSRF 校验时已解析的表单数据（Request body 只能读取一次）
    const form = await getFormData(request);
    topicId = Number(form?.get('topicId') ?? 0);
    content = String(form?.get('content') ?? '').trim();
    redirect = sanitizeRedirect(form?.get('redirect'));
  }

  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json({ ok: false, error: '主题 ID 无效' }, { status: 400 });
  }
  if (content.length < 2) {
    return NextResponse.json({ ok: false, error: '回复内容太短' }, { status: 400 });
  }
  if (content.length > 20000) {
    return NextResponse.json({ ok: false, error: '回复内容过长' }, { status: 400 });
  }

  // 资源存在性校验放在限流之前：
  // 对不存在/已锁定主题的请求不应消耗限流配额。
  //
  // v0.0.14 P0-1：**必须** join nodes 并过滤节点状态。
  // 否则「隐藏节点的主题」仍可被回复 —— 回复本身会写入通知、
  // 给作者加积分，并让回复者从 `/member/{自己}` 看到该主题的标题，
  // 等于把一条被封存的内容重新带回公共面。
  //
  // 不可见 ⇒ 与「主题不存在」完全同样的 404（不区分「存在但被隐藏」，
  // 否则 403/404 的差别本身就是存在性信标）。
  const topics = await db
    .select()
    .from(schema.topics)
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(and(eq(schema.topics.id, topicId), PUBLIC_NODE_CONDITION))
    .limit(1);
  const topic = topics[0]?.topics;
  if (!topic || topic.status === 'deleted') {
    return NextResponse.json({ ok: false, error: '主题不存在' }, { status: 404 });
  }
  if (topic.locked) {
    return NextResponse.json({ ok: false, error: '该主题已锁定，无法回复' }, { status: 403 });
  }

  const limit = await rateLimitByUser(
    'reply',
    user.id,
    Number(process.env.RATE_LIMIT_REPLY_MAX ?? 20),
    Number(process.env.RATE_LIMIT_REPLY_WINDOW_SECONDS ?? 120),
  );
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `回复过于频繁，请 ${limit.retryAfterSeconds} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  // 分配楼层号：使用独立计数表的原子 UPSERT，避免并发冲突
  //
  // ⚠️ v0.0.4 修复楼层跳号（真实压测发现）。
  //   原实现插入时用 `floor: floor + attempt` —— 但 allocateFloor **本身已经
  //   把计数表递增了**，这里再叠加 attempt 的偏移，导致：
  //     - 实际写入的楼层与计数表脱节（写入值永远比计数表小）
  //     - 计数表落后于实际最大楼层 → 下次分配又拿到已被占用的楼层 → 冲突
  //     - 冲突后 ensureFloorCounter 重置计数表 → 循环
  //   实测：连发 5 条回复得到楼层 26、24、22、20、18（**跳号 5 个**）。
  //
  //   现在：**楼层号只由 allocateFloor 分配一次**，插入严格使用该值；
  //   冲突时重新分配（不复用旧值），不再做 +attempt 偏移。
  let inserted = false;
  let replyFloor = 0;
  /** 新回复的 id（供 JSON 响应返回；表单提交路径可能没有） */
  let createdReplyId: number | undefined;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    const floor = await allocateFloor(topicId);
    try {
      const [reply] = await db
        .insert(schema.replies)
        .values({
          topicId,
          authorId: user.id,
          content,
          floor,
        })
        .returning({ id: schema.replies.id });
      inserted = true;
      replyFloor = floor;
      createdReplyId = reply.id;

      await db
        .update(schema.topics)
        .set({
          repliesCount: sql`${schema.topics.repliesCount} + 1`,
          lastReplyAt: new Date(),
        })
        .where(eq(schema.topics.id, topicId));

      // 通知主题作者
      if (topic.authorId !== user.id) {
        await db.insert(schema.notifications).values({
          userId: topic.authorId,
          type: 'reply',
          actorId: user.id,
          topicId,
          replyId: reply.id,
          message: `${user.username} 回复了你的主题：${topic.title}`,
        });
      }

      // ── @ 提及通知（v0.0.5 补齐）──────────────────────────────
      //
      // `notificationType` 枚举里一直有 `mention`，UI 也一直有「提及」标签，
      // 但此前**没有任何代码写入它** ⇒ 半成品功能。本轮补齐。
      //
      // 边界（详见 src/lib/mentions.ts）：
      //  - 只对**真实存在**的用户发通知
      //  - 不给自己发
      //  - 同一条内容里 @ 同一用户只通知一次
      //  - 单条内容最多 10 个提及通知
      const mentionedUsernames = extractMentions(content);
      if (mentionedUsernames.length > 0) {
        const mentionedUsers = await db
          .select({ id: schema.users.id, username: schema.users.username })
          .from(schema.users)
          .where(
            and(
              inArray(schema.users.username, mentionedUsernames),
              ne(schema.users.id, user.id),
            ),
          );

        if (mentionedUsers.length > 0) {
          await db.insert(schema.notifications).values(
            mentionedUsers.map((u) => ({
              userId: u.id,
              type: 'mention' as const,
              actorId: user.id,
              topicId,
              replyId: reply.id,
              message: buildMentionMessage({
                actorName: user.username,
                topicTitle: topic.title,
                isReply: true,
                floor: replyFloor,
              }),
            })),
          );
        }
      }

      // 回复积分（v0.0.4 补齐闭环）
      //
      // ⚠️ 此前**回复完全不给积分** —— 排行榜页与积分规则页都写着
      // 「发布主题与回复都可以获得积分」，但回复路径没有发放逻辑，
      // 属于文档与实现不一致。额度由 REPLY_CREDITS 配置（默认 2），
      // 幂等键保证同一回复不会重复发放。
      await grantCredits(user.id, {
        type: 'reply_created',
        amount: creditAmounts().reply,
        idempotencyKey: `reply_created:${reply.id}`,
        refType: 'reply',
        refId: reply.id,
        reason: '发布回复',
      });
    } catch (err) {
      // drizzle 会把 Postgres 错误包在 cause 中，需同时检查两层
      const e = err as {
        code?: string;
        constraint_name?: string;
        message?: string;
        cause?: { code?: string; constraint_name?: string; message?: string };
      };
      const code = e.code ?? e.cause?.code;
      const constraint = e.constraint_name ?? e.cause?.constraint_name;
      if (code === '23505' || constraint?.includes('replies_topic_floor')) {
        // 楼层冲突。
        //
        // 计数器与实际楼层不一致时（历史数据导入、seed 写入固定楼层、
        // 计数器表落后），连续 5 个候选楼层可能**全部**已被占用。
        //
        // 此时把计数表抬到「实际最大楼层」的水位，再重新分配。
        //
        // ⚠️ v0.0.4：**不再**用 `floor + attempt` 做偏移试探 ——
        //   偏移会写入与计数表脱节的楼层号，正是跳号的来源。
        //   现在每轮循环都重新调用 allocateFloor 拿一个权威楼层。
        await ensureFloorCounter(topicId);
        continue;
      }
      console.error('[replies] 插入失败:', {
        code,
        constraint,
        message: e.message ?? e.cause?.message,
        topicId,
        floor: floor + attempt,
        authorId: user.id,
      });
      throw err;
    }
  }

  if (!inserted) {
    return NextResponse.json({ ok: false, error: '回复失败，请重试' }, { status: 500 });
  }

  if (ct.includes('application/json')) {
    // ⚠️ v0.0.5：补 `replyId` 字段（同 topics API 的理由 ——
    //    原响应只有 `redirect`，调用方要解析字符串才能拿到 id）。
    //    `replyId` 可能是 undefined（表单提交路径没有 inserted 变量），
    //    所以用可选字段。
    return NextResponse.json({
      ok: true,
      redirect,
      ...(createdReplyId ? { replyId: createdReplyId } : {}),
    });
  }
  // ⚠️ v0.0.8 安全加固（P0）：303 使用**站内相对 Location**（`/t/123`）。
  //
  // 演进记录（三次修复，全部有取证证据）：
  //   v0.0.6  `new URL(redirect, request.url)`  —— Next 在 next start 下按
  //            **服务器自身 hostname**（localhost）重建 request.url ⇒ 用户被
  //            带到错误 host（浏览器出现两个 v2_csrf cookie ⇒ 后续写操作 403）。
  //   v0.0.7  改用请求头 Host/x-forwarded-host 构造绝对 URL —— 修好了换 host，
  //            但引入 **Host Header Poisoning** 面：不可信代理/直连场景下
  //            攻击者可控制 Location 的域名与协议（303 缓存投毒 / 反代跳错域名）。
  //   v0.0.8  相对 Location —— RFC 7231 §7.1.2 允许；浏览器按**实际请求 URL**
  //            解析 ⇒ host 与协议永远正确，且**不经任何请求头** ⇒ 无投毒面。
  //
  // 证据：docs/SECURITY_AUDIT_v0.0.8.md（攻击矩阵实测）。
  return seeOther(redirect);
}
