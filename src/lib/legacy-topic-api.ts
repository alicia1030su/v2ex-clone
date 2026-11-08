/**
 * V2EX 旧版公开 JSON API 的**载荷映射**（纯函数，不依赖数据库）
 *
 * ## 契约来源（不是猜的）
 *
 * 2026-11-08 通过本机 xray 代理（`127.0.0.1:10001`）对原站实测：
 *
 * | 请求 | 实测结果 |
 * |---|---|
 * | `?id=1` | 200，数组长度 1 |
 * | `?id=999999999` | **200**，数组长度 0（`[]`） |
 * | `?id=0` / `?id=abc` | **404**，`{"status":"error","message":"Object Not Found",…}` |
 * | `?username=reoah2` | 200，10 条，`created` 降序 |
 * | `?node_name=programmer` | 200，10 条，`created` 降序 |
 * | `?username=不存在` / `?node_name=不存在` | 404，同上错误体 |
 * | 无参数 | 404，同上错误体 |
 * | `?id=1&id=2&id=3` | 200，**只返回 3**（同名参数取**最后**一个） |
 * | `?id=1&node_name=programmer` | 200，只返回 1（**id 优先**） |
 * | `?username=x&node_name=y` | 200，按 username（**username 优先于 node_name**） |
 * | `?node_name=x&limit=3` | 200，仍返回 **10** 条（limit 被忽略） |
 *
 * 响应头实测：`Content-Type: application/json;charset=UTF-8`、
 * `Cache-Control: public, max-age=120`、
 * `x-rate-limit-limit/remaining/reset`（配额 600/小时）。
 *
 * ## 字段形状（逐字段取自实测响应）
 *
 * 顶层：`content, content_rendered, created, deleted, id, last_modified,
 * last_reply_by, last_touched, member, node, replies, title, url`
 *
 * - `created` / `last_modified` / `last_touched` 均为 **Unix 秒**
 * - `deleted` 为 **整数 0/1**（不是布尔）
 * - `replies` 为整数
 * - `last_reply_by` 在**零回复**时为 **空字符串 `''`**（实测确认）
 * - `content` 是**未渲染**的纯文本/Markdown 源
 * - `content_rendered` 是 HTML
 *
 * ## 本项目的映射取舍（**与原站不同之处，全部显式标注**）
 *
 * 1. 原站 `member.pro` 是「Pro 会员到期时间」（非 Pro 为 0）。本项目无 Pro 体系，
 *    恒为 0 —— 不虚构到期时间。
 * 2. 原站 `member.twitter/github/psn/btc` 本项目未采集，恒为 `null`
 *    （原站未填时同样返回 `null`，形状一致）。
 * 3. 原站 `node.stars` 是节点收藏数。本项目用 `collections(target='node')`
 *    的真实计数，语义一致。
 * 4. 原站 `node.header/footer/aliases` 本项目未建模 ⇒ `''` / `''` / `[]`（空值而非假数据）。
 * 5. 头像：原站是 CDN URL；本项目无外链头像资源，返回**确定性占位 SVG 的
 *    data URI**（与站内 `<Avatar>` 完全同源同图），六个尺寸各自真实生成。
 * 6. **软删除主题**：本项目安全策略要求对公众不可见 ⇒ 列表模式不返回，
 *    `?id=` 命中软删除主题时返回 `[]`（表现得像不存在）。原站返回什么未经实测，
 *    这里选择**更保守**的一侧，并在文档中写明未实测。
 */

/** 旧版 API 中「对象不存在」的错误体（实测形状） */
export type LegacyErrorBody = {
  status: 'error';
  message: 'Object Not Found';
  rate_limit: { used: number; quota: number; reset_at: number };
};

/** 原站错误体的固定文案（实测） */
export const LEGACY_NOT_FOUND_MESSAGE = 'Object Not Found' as const;

/** 旧版 API 中单个主题的形状（字段名与原站逐字一致） */
export type LegacyTopic = {
  id: number;
  title: string;
  url: string;
  content: string;
  content_rendered: string;
  replies: number;
  member: LegacyMember;
  node: LegacyNode;
  created: number;
  last_modified: number;
  last_touched: number;
  last_reply_by: string;
  deleted: number;
};

export type LegacyMember = {
  id: number;
  username: string;
  url: string;
  tagline: string | null;
  bio: string | null;
  created: number;
  last_modified: number;
  location: string | null;
  website: string | null;
  twitter: null;
  github: null;
  psn: null;
  btc: null;
  pro: 0;
  avatar_mini: string;
  avatar_normal: string;
  avatar_large: string;
  avatar_xlarge: string;
  avatar_xxlarge: string;
  avatar_xxxlarge: string;
};

export type LegacyNode = {
  id: number;
  name: string;
  url: string;
  title: string;
  title_alternative: string;
  topics: number;
  stars: number;
  header: string;
  footer: string;
  founder_id: number;
  root: boolean;
  parent_node_name: string;
  aliases: string[];
  avatar_mini: string;
  avatar_normal: string;
  avatar_large: string;
};

/** 头像尺寸：原站 member 六档、node 三档（实测） */
export const MEMBER_AVATAR_SIZES = {
  mini: 24,
  normal: 48,
  large: 73,
  xlarge: 128,
  xxlarge: 192,
  xxxlarge: 256,
} as const;

export const NODE_AVATAR_SIZES = { mini: 24, normal: 48, large: 73 } as const;

/** Date → Unix 秒（原站三个时间字段都是秒级整数） */
export function unixSeconds(value: Date | string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** 站内相对路径 → 绝对 URL（旧版 API 的所有 url 字段都是绝对地址） */
export function absolute(origin: string, path: string): string {
  const base = origin.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export type LegacyMemberInput = {
  id: number;
  username: string;
  tagline: string | null;
  bio: string | null;
  url: string | null;
  location: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  /** 各尺寸头像 URL（由调用方用站内同一套 avatarUrl 生成） */
  avatars: Record<keyof typeof MEMBER_AVATAR_SIZES, string>;
};

export type LegacyNodeInput = {
  id: number;
  name: string;
  title: string;
  topicsCount: number;
  stars: number;
  founderId: number | null;
  parentNodeName: string | null;
  avatars: Record<keyof typeof NODE_AVATAR_SIZES, string>;
};

export type LegacyTopicInput = {
  id: number;
  title: string;
  content: string;
  /** 已渲染并清洗过的 HTML（由路由用站内 renderMarkdown 生成） */
  contentHtml: string;
  repliesCount: number;
  createdAt: Date;
  editedAt: Date | null;
  lastReplyAt: Date;
  deleted: boolean;
  lastReplyBy: string | null;
  member: LegacyMemberInput;
  node: LegacyNodeInput;
};

/**
 * 构造旧版 API 的 member 对象。
 */
export function toLegacyMember(input: LegacyMemberInput, origin: string): LegacyMember {
  return {
    id: input.id,
    username: input.username,
    url: absolute(origin, `/member/${encodeURIComponent(input.username)}`),
    tagline: input.tagline,
    bio: input.bio,
    created: unixSeconds(input.createdAt),
    // 原站该字段是「资料最后修改时间」；本项目未单独建模 ⇒ 用 lastActiveAt 近似
    last_modified: unixSeconds(input.lastActiveAt),
    location: input.location,
    website: input.url,
    twitter: null,
    github: null,
    psn: null,
    btc: null,
    // 无 Pro 体系 ⇒ 恒 0（原站非 Pro 亦为 0，形状一致）
    pro: 0,
    avatar_mini: input.avatars.mini,
    avatar_normal: input.avatars.normal,
    avatar_large: input.avatars.large,
    avatar_xlarge: input.avatars.xlarge,
    avatar_xxlarge: input.avatars.xxlarge,
    avatar_xxxlarge: input.avatars.xxxlarge,
  };
}

/**
 * 构造旧版 API 的 node 对象。
 */
export function toLegacyNode(input: LegacyNodeInput, origin: string): LegacyNode {
  return {
    id: input.id,
    name: input.name,
    url: absolute(origin, `/go/${input.name}`),
    title: input.title,
    title_alternative: input.title,
    topics: input.topicsCount,
    stars: input.stars,
    // 未建模 ⇒ 空字符串（不是编造的文案）
    header: '',
    footer: '',
    founder_id: input.founderId ?? 0,
    root: input.parentNodeName === null,
    parent_node_name: input.parentNodeName ?? '',
    aliases: [],
    avatar_mini: input.avatars.mini,
    avatar_normal: input.avatars.normal,
    avatar_large: input.avatars.large,
  };
}

/**
 * 构造旧版 API 的单个主题对象。
 */
export function toLegacyTopic(input: LegacyTopicInput, origin: string): LegacyTopic {
  return {
    id: input.id,
    title: input.title,
    url: absolute(origin, `/t/${input.id}`),
    content: input.content,
    content_rendered: input.contentHtml,
    replies: input.repliesCount,
    member: toLegacyMember(input.member, origin),
    node: toLegacyNode(input.node, origin),
    created: unixSeconds(input.createdAt),
    // 原站 last_modified 在未编辑时等于 created（实测：未编辑主题两值相同）
    last_modified: unixSeconds(input.editedAt ?? input.createdAt),
    last_touched: unixSeconds(input.lastReplyAt),
    // 零回复时原站是空字符串（实测），不是 null
    last_reply_by: input.lastReplyBy ?? '',
    deleted: input.deleted ? 1 : 0,
  };
}

/**
 * 构造 404 错误体（形状与实测一致）。
 */
export function legacyNotFound(
  used: number,
  quota: number,
  resetAtUnix: number,
): LegacyErrorBody {
  return {
    status: 'error',
    message: LEGACY_NOT_FOUND_MESSAGE,
    rate_limit: { used, quota, reset_at: resetAtUnix },
  };
}

/**
 * 解析 `?id=` 的取值规则：**同名参数取最后一个**（实测 `?id=1&id=2&id=3` ⇒ 只返回 3）。
 *
 * @returns 合法正整数则返回该数字；否则返回 null（调用方按「对象不存在」处理）
 */
export function parseLegacyId(values: string[]): number | null {
  if (values.length === 0) return null;
  const raw = values[values.length - 1];
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
