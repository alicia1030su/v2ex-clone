import 'server-only';
import { db, schema } from '@/db';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { renderMarkdown } from '@/lib/markdown';
import { unixSeconds, type LegacyMember } from '@/lib/legacy-topic-api';
import {
  assembleLegacyMember,
  PUBLIC_NODE_CONDITION,
} from '@/server/legacy-assemblers';

/**
 * 旧版 `/api/replies/show.json` 的**数据装配层**（v0.0.13 / V13-03）
 *
 * ## 契约（2026-11-09 低频只读实测）
 *
 * | 请求 | 原站 |
 * |---|---|
 * | 无 `topic_id` | **200 `[]`**（不是 404） |
 * | `?topic_id=1` | 200，178 条，`id` 升序，`created` 升序 |
 * | `?topic_id=999999999` / `?topic_id=0` / `?topic_id=abc` | **200 `[]`** |
 * | `?topic_id=1&topic_id=2` | 200，全部 `topic_id=2`（**同名参数取最后一个**） |
 * | `?topic_id=1&page=2&page_size=1` | 200，body 与裸 `topic_id=1` **逐字节相同**（分页参数被忽略） |
 * | 响应头 | `application/json;charset=UTF-8`、`Cache-Control: public, max-age=60` |
 *
 * 元素 8 键：`id, topic_id, member_id, member, content, content_rendered,
 * created, last_modified`。实测 `member_id === member.id`（本实现保证）。
 * 原站返回的 178 条中 id 有缺号（4、9…）⇒ **软删除回复不出现在公共接口**。
 *
 * ## 隐私与安全
 *
 * - 只输出已发布、未软删除主题的回复；软删除回复一律不可见
 * - 非 active 节点下的回复不进入公共接口：与全部旧版 / Feed 路径共用
 *   `PUBLIC_NODE_CONDITION`，避免同一节点在不同端点可见性漂移
 * - `content_rendered` 走站内 `renderMarkdown`（sanitize-html 清洗），
 *   不把 Markdown 原文拼进 HTML
 * - 载荷不含 email / password_hash / 会话令牌 / 积分；
 *   封禁 / 停用用户的自填资料字段由共用装配器置空
 */

/** 单次响应硬上限（原站无上限；本项目防止超大响应，已登记为有意偏离） */
export const LEGACY_REPLIES_HARD_LIMIT = 1000;

export type LegacyReply = {
  id: number;
  topic_id: number;
  member_id: number;
  member: LegacyMember;
  content: string;
  content_rendered: string;
  created: number;
  last_modified: number;
};

export async function loadLegacyReplies(
  topicId: number,
  origin: string,
): Promise<LegacyReply[]> {
  const rows = await db
    .select({
      reply: {
        id: schema.replies.id,
        topicId: schema.replies.topicId,
        content: schema.replies.content,
        createdAt: schema.replies.createdAt,
        editedAt: schema.replies.editedAt,
        deletedAt: schema.replies.deletedAt,
      },
      author: {
        id: schema.users.id,
        username: schema.users.username,
        tagline: schema.users.tagline,
        bio: schema.users.bio,
        url: schema.users.url,
        location: schema.users.location,
        status: schema.users.status,
        createdAt: schema.users.createdAt,
        lastActiveAt: schema.users.lastActiveAt,
        avatar: schema.users.avatar,
      },
    })
    .from(schema.replies)
    .innerJoin(schema.users, eq(schema.users.id, schema.replies.authorId))
    .innerJoin(schema.topics, eq(schema.topics.id, schema.replies.topicId))
    // 收敛到 active 节点：否则 hidden 节点下主题的回复仍可按 topic_id 取到
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(
      and(
        eq(schema.replies.topicId, topicId),
        isNull(schema.replies.deletedAt),
        isNull(schema.topics.deletedAt),
        ne(schema.topics.status, 'deleted'),
        PUBLIC_NODE_CONDITION,
      ),
    )
    .orderBy(asc(schema.replies.id))
    .limit(LEGACY_REPLIES_HARD_LIMIT);

  if (rows.length === 0) return [];

  const rendered = await Promise.all(rows.map((r) => renderMarkdown(r.reply.content)));

  return rows.map((row, i) => ({
    id: row.reply.id,
    topic_id: row.reply.topicId,
    member_id: row.author.id,
    member: assembleLegacyMember(row.author, origin),
    content: row.reply.content,
    content_rendered: rendered[i],
    created: unixSeconds(row.reply.createdAt),
    // 未编辑时等于 created（与主题端点 last_modified 口径一致）
    last_modified: unixSeconds(row.reply.editedAt ?? row.reply.createdAt),
  }));
}
