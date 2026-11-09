import 'server-only';
import { db, schema } from '@/db';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';
import { avatarUrl } from '@/components/Avatar';
import {
  MEMBER_AVATAR_SIZES,
  NODE_AVATAR_SIZES,
  toLegacyMember,
  toLegacyNode,
  unixSeconds,
  type LegacyMember,
  type LegacyMemberInput,
  type LegacyNode,
  type LegacyNodeInput,
} from '@/lib/legacy-topic-api';

/**
 * 旧版 API 的**共用数据装配器**（v0.0.13 / V13-01）
 *
 * ## 为什么必须只有一份
 *
 * v0.0.13 之前，每个旧版端点各自拼装 `member` / `node`：
 *   · `/api/topics/show.json` 与 `latest.json` 共用 `legacy-topics.ts`
 *   · `/api/nodes/all.json`、`/api/nodes/show.json` 各自查 stars、各自生成头像
 *   · `/api/members/show.json` 又单独生成一次 member 头像
 *
 * 结果是**同一个实体在不同端点里可能不同**：
 * `nodes/show.json` 不限制 `status='active'`，而 `nodes/all.json` 限制；
 * `latest.json` 第一版把 `node.stars` 写成 0（见 `legacy-topics.ts` 文件头）。
 * 这类偏差站内页面完全看不出来，只有第三方客户端交叉核对才会发现。
 *
 * 现在统一到本文件：
 *   1. 头像尺寸表 / 字段映射只有一份（`toLegacyMember` / `toLegacyNode`）
 *   2. 节点查询、收藏计数、可见性条件只有一份（`loadLegacyNodeRecords`
 *      与 `PUBLIC_NODE_CONDITION`）
 *   3. 用户可见性条件只有一份（`PUBLIC_USER_STATUSES`）
 *
 * ## 公共可见性策略（隐私）
 *
 * 旧版 API 是**匿名只读**接口，一律不输出：邮箱、密码哈希、会话令牌、
 * 积分余额，以及非 active 节点的任何信息。用户被封禁（banned）/停用
 * （suspended）后，其**个人资料端点**不再公开；已发布的历史内容仍可见
 * （与原站「内容保留」的口径一致），但内嵌 `member` 只含公开字段。
 * 该策略的自动化断言见 `tests/static/v013-legacy-privacy.spec.ts`。
 *
 * v0.0.13 收尾：`PUBLIC_NODE_CONDITION` 是**全部**旧版 / Feed 公共端点
 * 唯一的节点可见性来源。此前只有目录类端点经过 `loadLegacyNodeRecords`，
 * 主题 / Feed 路径未过滤 ⇒ 同一 `pending` / `hidden` 节点在目录里查不到，
 * 却能从 `topics/show.json?node_name=` 与节点 Feed 取到（真实跨接口泄漏）。
 * 现在所有路径都引用同一条件，从结构上杜绝口径漂移。
 */

/** 公开资料端点可用的用户状态（封禁/停用用户的资料不公开） */
export const PUBLIC_USER_STATUSES = ['active'] as const;

/**
 * 旧版 / Feed 公共端点**统一**的节点可见性条件 —— 本体在
 * `src/lib/node-visibility.ts`，这里只做 re-export，保持旧版端点原有 import 路径。
 *
 * 为什么本体要单独放一个纯模块：`src/lib/feed-builder.ts` 也必须引用同一条件
 * （站内 `/api/feed`、`/api/feed/atom`、`/api/feed/json` 不能吐非 active 节点的主题），
 * 但该模块刻意**注入** `db` 以便单元测试指向专用库。若它反向 import 本文件，
 * 就会连带 `import '@/db'` 建一个连到开发库的连接池，破坏那个设计。
 * 纯模块只依赖 `drizzle-orm` 与 schema，无副作用，两边都能安全引用。
 *
 * 全仓**只有一处**定义这个条件；6 条旧版 / Feed 公共路径 + 站内 Feed 构建器
 * 全部引用它，由 `tests/static/v013-legacy-privacy.spec.ts` 逐文件钉死。
 */
export { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';

export type LegacyMemberRow = {
  id: number;
  username: string;
  tagline: string | null;
  bio: string | null;
  url: string | null;
  location: string | null;
  avatar: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  /** 传入时用于隐私降级：非 active 用户的可选资料字段一律不公开 */
  status?: string;
};

export type LegacyNodeRow = {
  id: number;
  name: string;
  title: string;
  topicsCount: number;
  avatar: string | null;
  createdBy: number | null;
  /** 仅 `nodes/list.json` 的 `created` 投影需要；主题内嵌 node 不需要 */
  createdAt?: Date;
  parentNodeName: string | null;
};

/** 节点列表端点的完整记录：旧版 16 键 + `created`（`nodes/list.json` 的投影字段） */
export type LegacyNodeRecord = LegacyNode & { created: number };

/** 组装指定尺寸的头像 URL 集合（站内同一套确定性占位实现） */
export function memberAvatars(
  user: { id: number; username: string; avatar: string | null },
): Record<keyof typeof MEMBER_AVATAR_SIZES, string> {
  const out = {} as Record<keyof typeof MEMBER_AVATAR_SIZES, string>;
  for (const [key, size] of Object.entries(MEMBER_AVATAR_SIZES)) {
    out[key as keyof typeof MEMBER_AVATAR_SIZES] = avatarUrl(user, size);
  }
  return out;
}

/** 节点头像（三档，与站内 `<Avatar>` 同源） */
export function nodeAvatars(
  node: { id: number; name: string; avatar: string | null },
): Record<keyof typeof NODE_AVATAR_SIZES, string> {
  const out = {} as Record<keyof typeof NODE_AVATAR_SIZES, string>;
  for (const [key, size] of Object.entries(NODE_AVATAR_SIZES)) {
    out[key as keyof typeof NODE_AVATAR_SIZES] = avatarUrl(
      { id: node.id, username: node.name, avatar: node.avatar },
      size,
    );
  }
  return out;
}

/** 行 → 旧版 member 输入（唯一的字段映射入口） */
export function legacyMemberInputFromRow(row: LegacyMemberRow): LegacyMemberInput {
  // 封禁 / 停用用户的「可选资料」不再从匿名只读接口泄露。
  // 用户名与 id 仍保留（历史内容需要作者标识），但自填资料字段一律置空。
  const restricted = row.status !== undefined && row.status !== 'active';
  return {
    id: row.id,
    username: row.username,
    tagline: restricted ? null : row.tagline,
    bio: restricted ? null : row.bio,
    url: restricted ? null : row.url,
    location: restricted ? null : row.location,
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
    avatars: memberAvatars(row),
  };
}

/** 行 + 收藏数 → 旧版 node 输入（唯一的字段映射入口） */
export function legacyNodeInputFromRow(row: LegacyNodeRow, stars: number): LegacyNodeInput {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    topicsCount: row.topicsCount,
    stars,
    founderId: row.createdBy,
    parentNodeName: row.parentNodeName,
    avatars: nodeAvatars(row),
  };
}

/** 旧版 member 对象（所有端点共用） */
export function assembleLegacyMember(row: LegacyMemberRow, origin: string): LegacyMember {
  return toLegacyMember(legacyMemberInputFromRow(row), origin);
}

/** 旧版 node 对象（所有端点共用） */
export function assembleLegacyNode(row: LegacyNodeRow, stars: number, origin: string): LegacyNode {
  return toLegacyNode(legacyNodeInputFromRow(row, stars), origin);
}

/** 批量取节点收藏数（原站 `node.stars` 语义），只查给定 id 集合 */
export async function loadNodeStars(nodeIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (nodeIds.length === 0) return map;
  const rows = await db
    .select({ nodeId: schema.collections.nodeId, cnt: sql<number>`count(*)::int` })
    .from(schema.collections)
    .where(and(eq(schema.collections.target, 'node'), inArray(schema.collections.nodeId, nodeIds)))
    .groupBy(schema.collections.nodeId);
  for (const row of rows) {
    if (row.nodeId !== null) map.set(row.nodeId, Number(row.cnt));
  }
  return map;
}

export type LegacyNodeOrder = 'id-asc' | 'id-desc' | 'name-desc' | 'name-asc';

export type LoadLegacyNodeOptions = {
  origin: string;
  /** 按 id 或 name 过滤；缺省 = 全部 */
  filter?: { kind: 'id' | 'name'; value: number | string };
  /** 多个条件**任一命中即可**（`nodes/show.json` 的 `?name=&id=` 实测语义） */
  matchAny?: Array<{ kind: 'id' | 'name'; value: number | string }>;
  order?: LegacyNodeOrder;
};

/**
 * 装载**全部**旧版节点记录（只含 active 节点）。
 *
 * `nodes/all.json`、`nodes/show.json`、`nodes/list.json` 三个端点都走这里，
 * 因此 `stars` / `founder_id` / 头像 / 可见性不可能出现口径漂移。
 */
export async function loadLegacyNodeRecords(
  opts: LoadLegacyNodeOptions,
): Promise<LegacyNodeRecord[]> {
  const order = opts.order ?? 'id-asc';
  const parentName = sql<string | null>`(select pn.name from nodes pn where pn.id = ${schema.nodes.parentId})`;

  const conditions = [PUBLIC_NODE_CONDITION];
  if (opts.filter?.kind === 'id') conditions.push(eq(schema.nodes.id, Number(opts.filter.value)));
  if (opts.filter?.kind === 'name') {
    conditions.push(eq(schema.nodes.name, String(opts.filter.value).toLowerCase()));
  }
  if (opts.matchAny?.length) {
    const any = or(
      ...opts.matchAny.map((f) =>
        f.kind === 'id'
          ? eq(schema.nodes.id, Number(f.value))
          : eq(schema.nodes.name, String(f.value).toLowerCase()),
      ),
    );
    if (any) conditions.push(any);
  }

  const orderBy =
    order === 'id-desc'
      ? desc(schema.nodes.id)
      : order === 'name-desc'
        ? desc(schema.nodes.name)
        : order === 'name-asc'
          ? asc(schema.nodes.name)
          : asc(schema.nodes.id);

  const rows: LegacyNodeRow[] = await db
    .select({
      id: schema.nodes.id,
      name: schema.nodes.name,
      title: schema.nodes.title,
      topicsCount: schema.nodes.topicsCount,
      avatar: schema.nodes.avatar,
      createdBy: schema.nodes.createdBy,
      createdAt: schema.nodes.createdAt,
      parentNodeName: parentName,
    })
    .from(schema.nodes)
    .where(and(...conditions))
    .orderBy(orderBy);

  if (rows.length === 0) return [];
  const stars = await loadNodeStars(rows.map((r) => r.id));

  return rows.map((row) => ({
    ...assembleLegacyNode(row, stars.get(row.id) ?? 0, opts.origin),
    created: unixSeconds(row.createdAt),
  }));
}

/** 去掉 `created`，得到公开端点使用的 16 键旧版 node 对象 */
export function publicLegacyNode(record: LegacyNodeRecord): LegacyNode {
  const { created: _created, ...node } = record;
  return node;
}
