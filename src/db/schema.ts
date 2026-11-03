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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('replies_topic_floor_uidx').on(t.topicId, t.floor),
    index('replies_author_idx').on(t.authorId),
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
