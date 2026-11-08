import { NextResponse } from 'next/server';
import { db, schema } from '@/db';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { renderMarkdown } from '@/lib/markdown';
import { resolveBaseUrl } from '@/lib/feed-builder';
import { rateLimitByIp } from '@/lib/rate-limit';
import { avatarUrl } from '@/components/Avatar';
import {
  MEMBER_AVATAR_SIZES,
  NODE_AVATAR_SIZES,
  legacyNotFound,
  parseLegacyId,
  toLegacyTopic,
  type LegacyMemberInput,
  type LegacyNodeInput,
} from '@/lib/legacy-topic-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/topics/show.json —— **V2EX 旧版公开 JSON API 兼容端点**
 *
 * ## 为什么有这个端点
 *
 * `docs/PAGE_INVENTORY.md` §2.4 记录了原站「其他可发现端点」：
 * `/api/topics/show.json?id=1` 是**旧版 API 中唯一仍返回 200 的 JSON 端点**
 * （`/api/topics.json` 与 `/api/nodes.json` 均已下线 404）。
 *
 * 本项目此前把它实现为 404 —— 也就是说，任何按 V2EX 旧版 API 写好的
 * 第三方客户端 / 脚本接到本站后会直接失败。这是一个**真实的兼容性缺口**，
 * 而不是「原站有所以我们也要有」的凑数功能。
 *
 * ## 契约来源（全部实测，不是猜的）
 *
 * 2026-11-08 通过本机 xray 代理抓取原站，逐条记录在
 * `src/lib/legacy-topic-api.ts` 顶部的契约表里。要点：
 *
 *  | 请求 | 行为 |
 *  |---|---|
 *  | `?id=1` | 200，`[topic]`（长度 1） |
 *  | `?id=999999999` | **200**，`[]` |
 *  | `?id=0` / `?id=abc` | **404**，`{status:"error",message:"Object Not Found",rate_limit}` |
 *  | `?id=1&id=2&id=3` | 200，只返回 **3**（同名参数取最后一个） |
 *  | `?username=<存在>` | 200，10 条，`created` 降序 |
 *  | `?username=<不存在>` | 404，同上错误体 |
 *  | `?node_name=<存在>` | 200，10 条，`created` 降序 |
 *  | `?node_name=<不存在>` | 404，同上错误体 |
 *  | 无参数 | 404，同上错误体 |
 *  | `?id=…&node_name=…` / `?username=…&node_name=…` | 优先级 **id > username > node_name** |
 *  | `?limit=` | **被忽略**（固定 10 条） |
 *
 * 响应头：`Content-Type: application/json;charset=UTF-8`、
 * `Cache-Control: public, max-age=120`、`x-rate-limit-limit/remaining/reset`。
 *
 * ## 与原站的差异（不掩盖）
 *
 * 见 `src/lib/legacy-topic-api.ts` 顶部「本项目的映射取舍」六条：
 * `pro` 恒 0、`twitter/github/psn/btc` 恒 null、`node.header/footer/aliases` 空值、
 * 头像为确定性占位 data URI、软删除主题对公众不可见（`?id=` 命中返回 `[]`）。
 *
 * ## 安全
 *
 * - 只读、只暴露**已发布**主题（软删除一律不可见）
 * - 与原站同口径限流（600 次/小时/IP），并回写 `x-rate-limit-*` 头
 * - 所有 SQL 走 drizzle 参数化查询，无字符串拼接
 */

/** 与原站同口径的配额（实测响应头 `x-rate-limit-limit: 600`） */
const RATE_LIMIT = 600;
const RATE_WINDOW_SECONDS = 3600;

/** 原站列表模式固定返回 10 条（`limit` 参数被忽略 —— 实测） */
const LIST_LIMIT = 10;

/** 组装响应头（含限流三元组，原站有、且对客户端有用） */
function buildHeaders(rl: { count: number; limit: number; resetAt: number }): HeadersInit {
  return {
    'Content-Type': 'application/json;charset=UTF-8',
    'Cache-Control': 'public, max-age=120',
    'x-rate-limit-limit': String(rl.limit),
    'x-rate-limit-remaining': String(Math.max(0, rl.limit - rl.count)),
    'x-rate-limit-reset': String(Math.floor(rl.resetAt / 1000)),
    'X-Content-Type-Options': 'nosniff',
  };
}

/** 构造限定尺寸的头像 URL（站内同一套确定性占位实现） */
function avatarsOf(user: { id: number; username: string; avatar: string | null }) {
  const out = {} as Record<keyof typeof MEMBER_AVATAR_SIZES, string>;
  for (const [key, size] of Object.entries(MEMBER_AVATAR_SIZES)) {
    out[key as keyof typeof MEMBER_AVATAR_SIZES] = avatarUrl(user, size);
  }
  return out;
}

function nodeAvatarsOf(node: { id: number; name: string; avatar: string | null }) {
  const out = {} as Record<keyof typeof NODE_AVATAR_SIZES, string>;
  for (const [key, size] of Object.entries(NODE_AVATAR_SIZES)) {
    out[key as keyof typeof NODE_AVATAR_SIZES] = avatarUrl(
      { id: node.id, username: node.name, avatar: node.avatar },
      size,
    );
  }
  return out;
}

type TopicRow = {
  id: number;
  title: string;
  content: string;
  repliesCount: number;
  createdAt: Date;
  editedAt: Date | null;
  lastReplyAt: Date;
  deletedAt: Date | null;
};

type AuthorRow = {
  id: number;
  username: string;
  tagline: string | null;
  bio: string | null;
  url: string | null;
  location: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  avatar: string | null;
};

type NodeRow = {
  id: number;
  name: string;
  title: string;
  topicsCount: number;
  founderId: number | null;
  parentNodeName: string | null;
  avatar: string | null;
};

/** 一次查询取回主题 + 作者 + 节点 + 父节点名（避免 N+1） */
async function loadTopics(filter: {
  id?: number;
  username?: string;
  nodeName?: string;
}) {
  const parent = sql<string | null>`(select pn.name from nodes pn where pn.id = ${schema.nodes.parentId})`;

  // ⚠️ 大小写转换必须放在 `sql` 模板**外面**：
  //    `tests/v005-security-audit.spec.ts` 的守卫禁止模板插值里出现
  //    函数调用（疑似字符串拼接）。这里提前算好，插值只剩一个纯参数。
  const usernameLower = filter.username?.toLowerCase();

  const base = db
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
      parentNodeName: parent,
    })
    .from(schema.topics)
    .innerJoin(schema.users, eq(schema.users.id, schema.topics.authorId))
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
    // 公众视图：软删除主题一律不可见（本项目安全策略，见文件头）
    .where(
      and(
        isNull(schema.topics.deletedAt),
        filter.id !== undefined ? eq(schema.topics.id, filter.id) : undefined,
        usernameLower !== undefined
          ? sql`lower(${schema.users.username}) = ${usernameLower}`
          : undefined,
        filter.nodeName !== undefined ? eq(schema.nodes.name, filter.nodeName) : undefined,
      ),
    )
    .orderBy(desc(schema.topics.createdAt))
    .limit(filter.id !== undefined ? 1 : LIST_LIMIT);

  return base;
}

/** 批量取「每个主题最后一位回复者」（零回复不返回该 topic 的条目） */
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
    // 已按 floor 降序，首次出现即最后一楼
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
      and(
        eq(schema.collections.target, 'node'),
        inArray(schema.collections.nodeId, nodeIds),
      ),
    )
    .groupBy(schema.collections.nodeId);

  for (const row of rows) {
    if (row.nodeId !== null) map.set(row.nodeId, Number(row.cnt));
  }
  return map;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  // ── 限流（与原站同口径 600/小时/IP）──
  const rl = await rateLimitByIp('legacy-api-topics-show', RATE_LIMIT, RATE_WINDOW_SECONDS);
  const headers = buildHeaders(rl);
  if (!rl.ok) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Rate Limit Exceeded',
        rate_limit: {
          used: rl.count,
          quota: rl.limit,
          reset_at: Math.floor(rl.resetAt / 1000),
        },
      },
      { status: 429, headers: { ...headers, 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const origin = resolveBaseUrl(request.url);
  const idValues = url.searchParams.getAll('id');
  const username = url.searchParams.get('username');
  const nodeName = url.searchParams.get('node_name');

  // ── 优先级：id > username > node_name（实测确认）──
  let rows: Awaited<ReturnType<typeof loadTopics>>;

  if (idValues.length > 0) {
    const id = parseLegacyId(idValues);
    // `?id=abc` / `?id=0` ⇒ 404（实测），与「合法 id 但不存在 ⇒ 200 []」不同
    if (id === null) {
      return NextResponse.json(
        legacyNotFound(rl.count, rl.limit, Math.floor(rl.resetAt / 1000)),
        { status: 404, headers },
      );
    }
    rows = await loadTopics({ id });
  } else if (username) {
    // 用户不存在 ⇒ 404（实测）。大小写不敏感（与站内登录口径一致）。
    const usernameLower = username.toLowerCase();
    const exists = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.username}) = ${usernameLower}`)
      .limit(1);
    if (exists.length === 0) {
      return NextResponse.json(
        legacyNotFound(rl.count, rl.limit, Math.floor(rl.resetAt / 1000)),
        { status: 404, headers },
      );
    }
    rows = await loadTopics({ username });
  } else if (nodeName) {
    const nodeNameLower = nodeName.toLowerCase();
    const exists = await db
      .select({ id: schema.nodes.id })
      .from(schema.nodes)
      .where(eq(schema.nodes.name, nodeNameLower))
      .limit(1);
    if (exists.length === 0) {
      return NextResponse.json(
        legacyNotFound(rl.count, rl.limit, Math.floor(rl.resetAt / 1000)),
        { status: 404, headers },
      );
    }
    rows = await loadTopics({ nodeName: nodeNameLower });
  } else {
    // 无参数 ⇒ 404（实测）
    return NextResponse.json(
      legacyNotFound(rl.count, rl.limit, Math.floor(rl.resetAt / 1000)),
      { status: 404, headers },
    );
  }

  const topicIds = rows.map((r) => r.topic.id);
  const nodeIds = [...new Set(rows.map((r) => r.node.id))];
  const [lastBy, stars] = await Promise.all([lastReplyers(topicIds), nodeStars(nodeIds)]);

  // 渲染正文（每主题一次；与原站 `content_rendered` 同语义）
  const rendered = await Promise.all(
    rows.map((r) => renderMarkdown(r.topic.content)),
  );

  const payload = rows.map((row, i) => {
    const member: LegacyMemberInput = {
      id: row.author.id,
      username: row.author.username,
      tagline: row.author.tagline,
      bio: row.author.bio,
      url: row.author.url,
      location: row.author.location,
      createdAt: row.author.createdAt,
      lastActiveAt: row.author.lastActiveAt,
      avatars: avatarsOf(row.author),
    };

    const node: LegacyNodeInput = {
      id: row.node.id,
      name: row.node.name,
      title: row.node.title,
      topicsCount: row.node.topicsCount,
      stars: stars.get(row.node.id) ?? 0,
      founderId: row.node.founderId,
      parentNodeName: row.parentNodeName,
      avatars: nodeAvatarsOf(row.node),
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

  return new Response(JSON.stringify(payload), { status: 200, headers });
}
