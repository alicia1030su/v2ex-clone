/**
 * V2EX Clone — 数据库 Schema (Drizzle ORM / PostgreSQL)
 *
 * 表结构依据原站观察到的业务行为建模：
 *  - 节点 (nodes) 归属分类 (categories)，有 avatar / title / description / topics 数
 *  - 主题 (topics) 属于节点，有 replies / views / 收藏 / 点赞
 *  - 回复 (replies) 属于主题，有楼层号 (floor) 与感谢数 (thanks)
 *  - 用户 (users) 有积分 (balance)、头像、等级
 *  - 收藏 (collections) 区分 topic / node 两种目标（对应原站"收藏主题"与"加入收藏"）
 *  - 通知 (notifications) 对应原站 /notifications
 *  - 关注 (follows) 对应原站"关注用户"（注意：与节点收藏不同，原站为两种独立概念）
 */
import {
  pgTable,
  pgEnum,
  serial,
  integer,
  bigint,
  text,
  timestamp,
  varchar,
  boolean,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum('user_role', ['user', 'moderator', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'suspended', 'banned']);
export const topicStatus = pgEnum('topic_status', ['published', 'deleted', 'locked']);
export const nodeStatus = pgEnum('node_status', ['active', 'pending', 'hidden']);
export const collectionTarget = pgEnum('collection_target', ['topic', 'node']);
export const notificationType = pgEnum('notification_type', [
  'reply',
  'mention',
  'topic_thanks',
  'node_thanks',
  'system',
]);
export const voteDirection = pgEnum('vote_direction', ['up', 'down']);

/**
 * v0.0.3 新增枚举
 *
 * 说明：软删除不使用新的 enum 值，而是复用已有的 `topic_status`：
 *  - 'deleted'  = 软删除（内容保留在库中，普通 API 不可见）
 *  - 'locked'   = 已锁定（同时可与 deleted 组合，见 topics.deletedAt）
 * 为避免破坏 v0.0.2 已有数据，topic_status 未新增枚举值。
 */

/** 举报对象类型 */
export const reportTargetType = pgEnum('report_target_type', ['topic', 'reply', 'user']);

/** 举报处理状态 */
export const reportStatus = pgEnum('report_status', ['pending', 'accepted', 'rejected']);

/** 积分流水类型（不可篡改账本的分类） */
export const ledgerEntryType = pgEnum('ledger_entry_type', [
  'topic_created',
  'reply_created',
  'topic_thanked',
  'daily_checkin',
  'admin_adjust',
  'admin_deduct',
  'registration_bonus',
]);

/** 节点申请状态（节点创建需审批） */
export const nodeRequestStatus = pgEnum('node_request_status', ['pending', 'approved', 'rejected']);

/** 邮件用途（找回密码等） */
export const emailPurpose = pgEnum('email_purpose', ['password_reset']);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    username: varchar('username', { length: 32 }).notNull(),
    /** 大小写不敏感的唯一索引由 lower(username) 唯一索引保证（见下） */
    passwordHash: text('password_hash').notNull(),
    email: varchar('email', { length: 255 }),
    avatar: varchar('avatar', { length: 512 }),
    tagline: varchar('tagline', { length: 255 }),
    bio: text('bio'),
    url: varchar('url', { length: 512 }),
    location: varchar('location', { length: 128 }),
    role: userRole('role').notNull().default('user'),
    status: userStatus('status').notNull().default('active'),
    /** 积分：原站通过每日登录/发帖等行为累积 */
    balance: integer('balance').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_username_lower_uidx').on(sql`lower(${t.username})`),
    uniqueIndex('users_email_uidx').on(t.email),
    index('users_created_at_idx').on(t.createdAt),
  ],
);

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  title: varchar('title', { length: 64 }).notNull(),
  /** 排序权重，对应原站左侧节点分类的展示顺序 */
  sort: integer('sort').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const nodes = pgTable(
  'nodes',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 64 }).notNull(),
    title: varchar('title', { length: 128 }).notNull(),
    description: text('description'),
    avatar: varchar('avatar', { length: 512 }),
    /** 父节点：原站节点树存在子节点 */
    parentId: integer('parent_id'),
    categoryId: integer('category_id').references(() => categories.id),
    status: nodeStatus('status').notNull().default('active'),
    /** 缓存计数，由触发器/应用层维护 */
    topicsCount: integer('topics_count').notNull().default(0),
    /** 节点 RSS 地址 */
    feedUrl: varchar('feed_url', { length: 512 }),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('nodes_name_uidx').on(t.name),
    index('nodes_category_idx').on(t.categoryId),
    index('nodes_parent_idx').on(t.parentId),
  ],
);

export const topics = pgTable(
  'topics',
  {
    id: serial('id').primaryKey(),
    title: varchar('title', { length: 128 }).notNull(),
    content: text('content').notNull(),
    nodeId: integer('node_id')
      .notNull()
      .references(() => nodes.id),
    authorId: integer('author_id')
      .notNull()
      .references(() => users.id),
    status: topicStatus('status').notNull().default('published'),
    /** 缓存计数 */
    repliesCount: integer('replies_count').notNull().default(0),
    views: integer('views').notNull().default(0),
    /** 顶/踩汇总 */
    votes: integer('votes').notNull().default(0),
    /** 是否锁定：锁定后禁止新回复 */
    locked: boolean('locked').notNull().default(false),
    /** 是否置顶 */
    pinned: boolean('pinned').notNull().default(false),
    /** v0.0.3：软删除标记。内容保留在库中，但普通 API 与列表一律不可见。 */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** v0.0.3：软删除操作人（管理员或作者本人） */
    deletedBy: integer('deleted_by').references(() => users.id),
    /** v0.0.3：软删除原因 */
    deletedReason: text('deleted_reason'),
    /** v0.0.3：最后编辑时间 */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    /** v0.0.3：编辑次数 */
    editCount: integer('edit_count').notNull().default(0),
    lastReplyAt: timestamp('last_reply_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('topics_node_idx').on(t.nodeId),
    index('topics_author_idx').on(t.authorId),
    index('topics_created_at_idx').on(t.createdAt),
    index('topics_last_reply_at_idx').on(t.lastReplyAt),
    index('topics_node_last_reply_idx').on(t.nodeId, t.lastReplyAt),
    // v0.0.3：列表查询恒定过滤未删除主题，索引含 deletedAt 以便走索引
    index('topics_node_deleted_idx').on(t.nodeId, t.deletedAt, t.lastReplyAt),
  ],
);

export const replies = pgTable(
  'replies',
  {
    id: serial('id').primaryKey(),
    topicId: integer('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    authorId: integer('author_id')
      .notNull()
      .references(() => users.id),
    content: text('content').notNull(),
    /** 楼层号，从 1 开始，对应原站回复区的 #replyN 锚点 */
    floor: integer('floor').notNull(),
    /** 感谢数（❤️ 计数） */
    thanks: integer('thanks').notNull().default(0),
    /** 引用回复的楼层 */
    quoteId: integer('quote_id'),
    /** v0.0.3：软删除标记。内容保留在库中，但普通 API 与列表一律不可见。 */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** v0.0.3：软删除操作人 */
    deletedBy: integer('deleted_by').references(() => users.id),
    /** v0.0.3：软删除原因 */
    deletedReason: text('deleted_reason'),
    /** v0.0.3：最后编辑时间 */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    /** v0.0.3：编辑次数 */
    editCount: integer('edit_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('replies_topic_floor_uidx').on(t.topicId, t.floor),
    index('replies_author_idx').on(t.authorId),
    // v0.0.3：楼层计数在并发下用 ON CONFLICT 原子递增，此索引支持按楼层定位
    index('replies_topic_deleted_idx').on(t.topicId, t.deletedAt),
  ],
);

export const collections = pgTable(
  'collections',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    target: collectionTarget('target').notNull(),
    topicId: integer('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    nodeId: integer('node_id').references(() => nodes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('collections_topic_uidx').on(t.userId, t.topicId),
    uniqueIndex('collections_node_uidx').on(t.userId, t.nodeId),
    index('collections_user_idx').on(t.userId),
  ],
);

export const follows = pgTable(
  'follows',
  {
    id: serial('id').primaryKey(),
    followerId: integer('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followingId: integer('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('follows_pair_uidx').on(t.followerId, t.followingId),
    index('follows_following_idx').on(t.followingId),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    /** 触发者 */
    actorId: integer('actor_id').references(() => users.id),
    topicId: integer('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    replyId: integer('reply_id').references(() => replies.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.read)],
);

export const votes = pgTable(
  'votes',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: integer('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    direction: voteDirection('direction').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('votes_user_topic_uidx').on(t.userId, t.topicId)],
);

export const thanks = pgTable(
  'thanks',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    replyId: integer('reply_id')
      .notNull()
      .references(() => replies.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('thanks_user_reply_uidx').on(t.userId, t.replyId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
    ip: varchar('ip', { length: 64 }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: serial('id').primaryKey(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    ip: varchar('ip', { length: 64 }).notNull(),
    success: boolean('success').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_attempts_identifier_ip_idx').on(t.identifier, t.ip)],
);

export const tags = pgTable(
  'tags',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 64 }).notNull(),
  },
  (t) => [uniqueIndex('tags_name_uidx').on(t.name)],
);

export const topicTags = pgTable(
  'topic_tags',
  {
    topicId: integer('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.tagId] })],
);

export const moderationLogs = pgTable(
  'moderation_logs',
  {
    id: serial('id').primaryKey(),
    moderatorId: integer('moderator_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 32 }).notNull(),
    targetId: integer('target_id').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('moderation_logs_target_idx').on(t.targetType, t.targetId)],
);

export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  key: varchar('key', { length: 255 }).primaryKey(),
  count: integer('count').notNull().default(0),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
});

// 引入 sql 供唯一索引表达式使用
import { sql } from 'drizzle-orm';

/** 通用键值存储 —— Redis 不可用时的降级实现（验证码答案等） */
export const kvStore = pgTable('kv_store', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

/** 楼层号原子分配器 —— 并发回复时保证 (topic_id, floor) 唯一 */
export const floorCounters = pgTable('floor_counters', {
  topicId: integer('topic_id').primaryKey(),
  lastFloor: integer('last_floor').notNull().default(0),
});

// ---------------------------------------------------------------------------
// v0.0.3 新增表
// ---------------------------------------------------------------------------

/**
 * 编辑历史（主题与回复共用）
 *
 * 每次编辑写入一行，保留编辑前后的内容快照，用于审计与「此内容已被编辑」提示。
 * 不可变：没有 UPDATE 路径，只有 INSERT。
 */
export const editHistory = pgTable(
  'edit_history',
  {
    id: serial('id').primaryKey(),
    /** 'topic' | 'reply' */
    targetType: varchar('target_type', { length: 16 }).notNull(),
    targetId: integer('target_id').notNull(),
    /** 编辑者 */
    editorId: integer('editor_id')
      .notNull()
      .references(() => users.id),
    /** 编辑前标题（仅主题） */
    previousTitle: text('previous_title'),
    /** 编辑前正文 */
    previousContent: text('previous_content'),
    /** 编辑后标题（仅主题） */
    newTitle: text('new_title'),
    /** 编辑后正文 */
    newContent: text('new_content'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('edit_history_target_idx').on(t.targetType, t.targetId),
    index('edit_history_editor_idx').on(t.editorId),
  ],
);

/**
 * 密码重置令牌
 *
 * - 仅存哈希（sha256），数据库泄露也无法直接用于重置
 * - expiresAt 到期即失效
 * - usedAt 非空表示已使用（防重放）
 * - revokedAt 非空表示被管理员撤销
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 十六进制 */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** 请求来源 IP（审计用） */
    requestIp: varchar('request_ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('password_reset_tokens_hash_uidx').on(t.tokenHash),
    index('password_reset_tokens_user_idx').on(t.userId),
  ],
);

/**
 * 积分流水（不可篡改账本）
 *
 * 设计要点：
 * 1. 只 INSERT，从不 UPDATE / DELETE —— 没有对应的 ORM 更新路径
 * 2. balanceAfter 记录变动后的余额快照，可用于对账
 * 3. 幂等键 idempotencyKey 唯一，防止重复请求造成重复奖励
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: ledgerEntryType('type').notNull(),
    /** 本次变动数量（正为增加，负为扣减） */
    amount: integer('amount').notNull(),
    /** 变动前余额 */
    balanceBefore: integer('balance_before').notNull(),
    /** 变动后余额 */
    balanceAfter: integer('balance_after').notNull(),
    /** 关联对象（如 topic id / reply id） */
    refType: varchar('ref_type', { length: 32 }),
    refId: integer('ref_id'),
    /** 幂等键：同一业务动作重复提交时保证只有一条流水 */
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    /** 操作者（管理员调整时为管理员，否则为用户本人） */
    actorId: integer('actor_id').references(() => users.id),
    /** 管理员调整的理由 */
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('credit_ledger_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('credit_ledger_idem_uidx').on(t.idempotencyKey),
  ],
);

/**
 * 每日签到
 *
 * (user_id, checkin_date) 唯一 —— 同一天重复签到不会重复发放奖励。
 */
export const dailyCheckins = pgTable(
  'daily_checkins',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 签到日期（UTC 日期，YYYY-MM-DD） */
    checkinDate: varchar('checkin_date', { length: 10 }).notNull(),
    /** 本次获得的积分 */
    reward: integer('reward').notNull().default(0),
    /** 连续签到天数 */
    streak: integer('streak').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('daily_checkins_user_date_uidx').on(t.userId, t.checkinDate),
    index('daily_checkins_date_idx').on(t.checkinDate),
  ],
);

/**
 * 举报
 */
export const reports = pgTable(
  'reports',
  {
    id: serial('id').primaryKey(),
    targetType: reportTargetType('target_type').notNull(),
    targetId: integer('target_id').notNull(),
    /** 举报人 */
    reporterId: integer('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    /**
     * 举报补充说明（可选，最长 500）
     *
     * v0.0.5 新增 —— `reason` 存**中文原因标签**（前端从固定列表选择），
     * 用户自由发挥的部分放这里。
     */
    detail: text('detail'),
    status: reportStatus('status').notNull().default('pending'),
    /** 处理人 */
    handledBy: integer('handled_by').references(() => users.id),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    handleNote: text('handle_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reports_status_idx').on(t.status, t.createdAt),
    index('reports_target_idx').on(t.targetType, t.targetId),
    index('reports_reporter_idx').on(t.reporterId),
    // v0.0.5：「我的举报」按时间倒序（过滤 + 排序一次走索引）
    index('reports_reporter_created_idx').on(t.reporterId, t.createdAt.desc()),
  ],
);
// 举报原因的固定列表与校验在 `src/lib/report-reasons.ts`（纯数据模块，
// 服务端 API 与客户端举报表单共用，避免把 drizzle 运行时带进浏览器 bundle）。

/**
 * 节点创建申请（节点需审批后才可见）
 */
export const nodeRequests = pgTable(
  'node_requests',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 64 }).notNull(),
    title: varchar('title', { length: 128 }).notNull(),
    description: text('description'),
    /** 期望所属分类 */
    categoryId: integer('category_id').references(() => categories.id),
    /** 申请创建的用户 */
    requesterId: integer('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: nodeRequestStatus('status').notNull().default('pending'),
    handledBy: integer('handled_by').references(() => users.id),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    /** 审批通过后创建的节点 id */
    approvedNodeId: integer('approved_node_id').references(() => nodes.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('node_requests_status_idx').on(t.status, t.createdAt),
    index('node_requests_requester_idx').on(t.requesterId),
  ],
);

/**
 * 头像文件元数据
 *
 * 实际图片二进制存于磁盘（public/uploads/avatars/），此表记录元数据与归属。
 * 存储路径由服务端生成（不含用户可控部分），杜绝路径穿越。
 */
export const avatars = pgTable(
  'avatars',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 服务器端相对存储路径，如 'avatars/3/a1b2c3.png' */
    storagePath: varchar('storage_path', { length: 256 }).notNull(),
    /** 原始文件名（仅展示用，不参与路径拼接） */
    originalName: varchar('original_name', { length: 255 }),
    /** MIME 类型 */
    mimeType: varchar('mime_type', { length: 64 }).notNull(),
    /** 字节数 */
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('avatars_user_idx').on(t.userId),
    uniqueIndex('avatars_path_uidx').on(t.storagePath),
  ],
);

/**
 * 邮件发送日志（测试环境用本地邮件服务，真实发送受 SMTP 配置控制）
 */
export const emailLogs = pgTable(
  'email_logs',
  {
    id: serial('id').primaryKey(),
    /** 收件人（脱敏存储：仅保留域部分与首字母） */
    recipientMasked: varchar('recipient_masked', { length: 128 }).notNull(),
    purpose: emailPurpose('purpose').notNull(),
    /** 是否真正投递（未配置 SMTP 时为 false） */
    delivered: boolean('delivered').notNull().default(false),
    /** 未投递原因 */
    skipReason: varchar('skip_reason', { length: 128 }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_logs_user_idx').on(t.userId)],
);
