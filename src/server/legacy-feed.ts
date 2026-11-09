import 'server-only';
import { db, schema } from '@/db';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { normalizeBaseUrl } from '@/lib/feed-builder';
import { avatarUrl } from '@/components/Avatar';
import { PUBLIC_NODE_CONDITION } from '@/server/legacy-assemblers';
import {
  LEGACY_FEED_ITEMS,
  atomIdOf,
  type LegacyFeedChannel,
  type LegacyFeedEntry,
} from '@/lib/legacy-feed-format';

/**
 * 旧版 `/feed/{node}.xml` 与 `/feed/{node}.json` 的**数据装配层**
 *
 * 格式构造在 `src/lib/legacy-feed-format.ts`（纯函数、可静态单测）；
 * 本文件只负责查库并组装成 `LegacyFeedChannel`。
 *
 * 第一版把两者写在同一文件里，静态护栏一 import 就撞 `server-only` 保护
 * —— 那本身就是「层次没切干净」的信号。
 *
 * ## 与站内 `/api/feed` 的区别
 *
 * 站内是 RSS 2.0 + JSON Feed 1.1、30 条；旧版是 Atom 1.0 + JSON Feed 1.0、
 * **50 条**，条目 id/link 形状也不同。两者服务不同客户端，并存而不互相替代。
 *
 * ## 合规
 *
 * 只输出**本项目自己的数据**；原站只用来确认「字段名 / 元素顺序 / 条数」。
 */

export async function loadLegacyFeed(opts: {
  origin: string;
  /** 节点名；省略 = 全站 */
  nodeName?: string;
  limit?: number;
}): Promise<LegacyFeedChannel | null> {
  const base = normalizeBaseUrl(opts.origin);
  const limit = opts.limit ?? LEGACY_FEED_ITEMS;

  const conditions = [
    // 软删除主题不得出现在 Feed 里（与站内 /api/feed 同一口径）
    isNull(schema.topics.deletedAt),
    ne(schema.topics.status, 'deleted'),
  ];

  let channelTitle = 'V2EX Clone';
  let channelSubtitle = 'way to explore';
  let nodeAvatar: string | null = null;
  let nodeIdSeed = 1;
  let nodeName: string | null = null;

  if (opts.nodeName) {
    const nodeRows = await db
      .select({
        id: schema.nodes.id,
        name: schema.nodes.name,
        title: schema.nodes.title,
        description: schema.nodes.description,
        avatar: schema.nodes.avatar,
      })
      .from(schema.nodes)
      .where(and(PUBLIC_NODE_CONDITION, eq(schema.nodes.name, opts.nodeName.toLowerCase())))
      .limit(1);
    const node = nodeRows[0];
    if (!node) return null;
    nodeIdSeed = node.id;
    nodeName = node.name;
    channelTitle = node.title;
    channelSubtitle = node.description?.trim() || channelSubtitle;
    nodeAvatar = node.avatar;
    conditions.push(eq(schema.topics.nodeId, node.id));
  }

  const rows = await db
    .select({
      id: schema.topics.id,
      title: schema.topics.title,
      content: schema.topics.content,
      createdAt: schema.topics.createdAt,
      lastReplyAt: schema.topics.lastReplyAt,
      repliesCount: schema.topics.repliesCount,
      authorId: schema.users.id,
      authorName: schema.users.username,
      authorAvatar: schema.users.avatar,
    })
    .from(schema.topics)
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    // 全站 Feed 也要收敛：节点转为 pending/hidden 后，其主题不再进入公共订阅
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    .where(and(...conditions, PUBLIC_NODE_CONDITION))
    // 原站 Feed 按「最后回复时间」倒序（首条即最近活跃）
    .orderBy(desc(schema.topics.lastReplyAt))
    .limit(limit);

  const { renderMarkdown } = await import('@/lib/markdown');
  const htmlList = await Promise.all(rows.map((r) => renderMarkdown(r.content)));

  const entries: LegacyFeedEntry[] = rows.map((row, i) => {
    const url = `${base}/t/${row.id}`;
    return {
      topicId: row.id,
      title: row.title,
      // 原站条目 link 带楼层锚点
      link: `${url}#reply${row.repliesCount}`,
      atomId: atomIdOf(base, row.id, row.createdAt),
      jsonId: url,
      contentHtml: htmlList[i],
      publishedAt: row.createdAt,
      updatedAt: row.lastReplyAt,
      authorName: row.authorName,
      authorUrl: `${base}/member/${encodeURIComponent(row.authorName)}`,
      authorAvatarLarge: avatarUrl(
        { id: row.authorId, username: row.authorName, avatar: row.authorAvatar },
        73,
      ),
      repliesCount: row.repliesCount,
    };
  });

  const homePageUrl = nodeName ? `${base}/go/${nodeName}` : base;
  const iconSeed = { id: nodeIdSeed, username: nodeName ?? 'v2ex', avatar: nodeAvatar };
  const icon = nodeAvatar ?? avatarUrl(iconSeed, 48);
  const logo = nodeAvatar ?? avatarUrl(iconSeed, 73);

  return {
    title: channelTitle,
    subtitle: channelSubtitle,
    homePageUrl,
    selfLinkAtom: nodeName ? `${base}/feed/${nodeName}.xml` : `${base}/feed/all.xml`,
    selfLinkJson: nodeName ? `${base}/feed/${nodeName}.json` : `${base}/feed/all.json`,
    iconUrl: icon,
    logoUrl: logo,
    updatedAt: entries[0]?.updatedAt ?? new Date(),
    entries,
  };
}
