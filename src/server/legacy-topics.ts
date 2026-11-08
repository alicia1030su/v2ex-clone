import 'server-only';
import { db, schema } from '@/db';
import { and, desc, eq, isNull, inArray, sql } from 'drizzle-orm';
import { renderMarkdown } from '@/lib/markdown';
import { avatarUrl } from '@/components/Avatar';
import {
  MEMBER_AVATAR_SIZES,
  NODE_AVATAR_SIZES,
  toLegacyTopic,
  type LegacyMemberInput,
  type LegacyNodeInput,
  type LegacyTopic,
} from '@/lib/legacy-topic-api';

/**
 * 旧版 V2EX 主题载荷的**共用装配器**
 *
 * ## 为什么不写在路由里
 *
 * `/api/topics/show.json` 与 `/api/topics/latest.json` 返回**同构**的主题对象，
 * 只有「筛选条件」与「条数」不同。第一版实现把装配逻辑抄了两份，
 * 立刻出现了一个真实缺陷：`latest.json` 那份为了省一次查询，
 * 把 `node.stars` 写成 `0`、`node.parent_node_name` 写成 `null` ——
 * 于是同一个节点在两个端点里返回**不同的值**，第三方客户端交叉核对会发现
 * 「这个节点在这里 0 收藏、在那里 5 收藏」。
 *
 * 抽成一个装配器后，两个端点必然一致；以后新增第三个端点也不会再抄一遍。
 *
 * ## 一次性取全（避免 N+1）
 *
 * 一条 SQL 取「主题 + 作者 + 节点 + 父节点名」，
 * 再两条批量查询取「每主题最后回复者」与「每节点收藏数」。
 * 无论返回 1 条还是 35 条，数据库往返次数恒为 **3**。
 */

export type LegacyTopicFilter =
  | { kind: 'id'; id: number }
  | { kind: 'username'; username: string }
  | { kind: 'node'; nodeName: string }
  | { kind: 'latest' };

export type LoadLegacyTopicsOptions = {
  filter: LegacyTopicFilter;
  /** 返回条数上限（原站实测：show.json 10 条、latest.json 35 条） */
  limit: number;
  origin: string;
};

/** 组装指定尺寸的头像 URL 集合（站内同一套确定性占位实现） */
function memberAvatars(user: { id: number; username: string; avatar: string | null }) {
  const out = {} as Record<keyof typeof MEMBER_AVATAR_SIZES, string>;
  for (const [key, size] of Object.entries(MEMBER_AVATAR_SIZES)) {
    out[key as keyof typeof MEMBER_AVATAR_SIZES] = avatarUrl(user, size);
  }
  return out;
}

function nodeAvatars(node: { id: number; name: string; avatar: string | null }) {
  const out = {} as Record<keyof typeof NODE_AVATAR_SIZES, string>;
  for (const [key, size] of Object.entries(NODE_AVATAR_SIZES)) {
    out[key as keyof typeof NODE_AVATAR_SIZES] = avatarUrl(
      { id: node.id, username: node.name, avatar: node.avatar },
      size,
    );
  }
  return out;
}

/** 批量取「每个主题最后一位回复者」（零回复的主题不在 map 里） */
async function lastReplyers(topicIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (topicIds.length === 0) return map;

  const rows = await db
    .select({
      topicId: schema.replies.topicId,
      floor: schema.replies.floor,
      username: schema.users.username,
    })
    .from(schema.replies)
    .innerJoin(schema.users, eq(schema.users.id, schema.replies.authorId))
    .where(and(inArray(schema.replies.topicId, topicIds), isNull(schema.replies.deletedAt)))
    .orderBy(desc(schema.replies.floor));

  for (const row of rows) {
    // 已按 floor 降序 —— 首次出现即最后一楼
    if (!map.has(row.topicId)) map.set(row.topicId, row.username);
  }
  return map;
}

/** 批量取节点收藏数（原站 `node.stars` 语义） */
async function nodeStars(nodeIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (nodeIds.length === 0) return map;

  const rows = await db
    .select({ nodeId: schema.collections.nodeId, cnt: sql<number>`count(*)::int` })
    .from(schema.collections)
    .where(
      and(eq(schema.collections.target, 'node'), inArray(schema.collections.nodeId, nodeIds)),
    )
    .groupBy(schema.collections.nodeId);

  for (const row of rows) {
    if (row.nodeId !== null) map.set(row.nodeId, Number(row.cnt));
  }
  return map;
}

/**
 * 按筛选条件装配旧版主题载荷。
 *
 * @returns 长度 0..limit 的数组（调用方负责 404 / `[]` 的语义区分）
 */
export async function loadLegacyTopics(
  opts: LoadLegacyTopicsOptions,
): Promise<LegacyTopic[]> {
  const { filter, limit, origin } = opts;

  const parentName = sql<string | null>`(select pn.name from nodes pn where pn.id = ${schema.nodes.parentId})`;

  // 大小写转换在 `sql` 模板**外**完成 —— 安全守卫禁止模板插值里出现函数调用
  const usernameLower = filter.kind === 'username' ? filter.username.toLowerCase() : undefined;
  const nodeNameLower = filter.kind === 'node' ? filter.nodeName.toLowerCase() : undefined;

  const rows = await db
    .select({
      topic: {
        id: schema.topics.id,
        title: schema.topics.title,
        content: schema.topics.content,
        repliesCount: schema.topics.repliesCount,
        createdAt: schema.topics.createdAt,
        editedAt: schema.topics.editedAt,
        lastReplyAt: schema.topics.lastReplyAt,
        deletedAt: schema.topics.deletedAt,
      },
      author: {
        id: schema.users.id,
        username: schema.users.username,
        tagline: schema.users.tagline,
        bio: schema.users.bio,
        url: schema.users.url,
        location: schema.users.location,
        createdAt: schema.users.createdAt,
        lastActiveAt: schema.users.lastActiveAt,
        avatar: schema.users.avatar,
      },
      node: {
        id: schema.nodes.id,
        name: schema.nodes.name,
        title: schema.nodes.title,
        topicsCount: schema.nodes.topicsCount,
        founderId: schema.nodes.createdBy,
        avatar: schema.nodes.avatar,
      },
      parentNodeName: parentName,
    })
    .from(schema.topics)
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(
      and(
        // 公众视图：软删除主题一律不可见（本项目安全策略）
        isNull(schema.topics.deletedAt),
        filter.kind === 'id' ? eq(schema.topics.id, filter.id) : undefined,
        usernameLower !== undefined
          ? sql`lower(${schema.users.username}) = ${usernameLower}`
          : undefined,
        nodeNameLower !== undefined ? eq(schema.nodes.name, nodeNameLower) : undefined,
      ),
    )
    .orderBy(desc(schema.topics.createdAt))
    .limit(filter.kind === 'id' ? 1 : limit);

  if (rows.length === 0) return [];

  const topicIds = rows.map((r) => r.topic.id);
  const nodeIds = [...new Set(rows.map((r) => r.node.id))];
  const [lastBy, stars, rendered] = await Promise.all([
    lastReplyers(topicIds),
    nodeStars(nodeIds),
    Promise.all(rows.map((r) => renderMarkdown(r.topic.content))),
  ]);

  return rows.map((row, i) => {
    const member: LegacyMemberInput = {
      id: row.author.id,
      username: row.author.username,
      tagline: row.author.tagline,
      bio: row.author.bio,
      url: row.author.url,
      location: row.author.location,
      createdAt: row.author.createdAt,
      lastActiveAt: row.author.lastActiveAt,
      avatars: memberAvatars(row.author),
    };

    const node: LegacyNodeInput = {
      id: row.node.id,
      name: row.node.name,
      title: row.node.title,
      topicsCount: row.node.topicsCount,
      stars: stars.get(row.node.id) ?? 0,
      founderId: row.node.founderId,
      parentNodeName: row.parentNodeName,
      avatars: nodeAvatars(row.node),
    };

    return toLegacyTopic(
      {
        id: row.topic.id,
        title: row.topic.title,
        content: row.topic.content,
        contentHtml: rendered[i],
        repliesCount: row.topic.repliesCount,
        createdAt: row.topic.createdAt,
        editedAt: row.topic.editedAt,
        lastReplyAt: row.topic.lastReplyAt,
        deleted: row.topic.deletedAt !== null,
        lastReplyBy: lastBy.get(row.topic.id) ?? null,
        member,
        node,
      },
      origin,
    );
  });
}
