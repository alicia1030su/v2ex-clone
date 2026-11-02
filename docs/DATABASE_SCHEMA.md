# DATABASE_SCHEMA — 数据库结构

> PostgreSQL 17 · Drizzle ORM
> 定义源：`src/db/schema.ts`
> 迁移文件：`drizzle/0000_init.sql`、`drizzle/0001_kv_store.sql`、`drizzle/0002_floor_counters.sql`

## 概览

共 **18 张表** + 5 个枚举类型。

```
users ──┬── topics ──── replies
        │      │            │
        │      │            ├── thanks
        │      ├── topic_tags ──── tags
        │      └── notifications
        │
        ├── notifications (接收者)
        ├── collections ──→ topics / nodes
        ├── follows
        ├── votes ──→ topics
        ├── sessions
        ├── login_attempts
        ├── moderation_logs
        └── rate_limit_buckets

categories ──── nodes ──┬── topics
                        └── collections

kv_store            （Redis 降级时的通用键值存储）
floor_counters      （楼层号原子分配器）
```

## 枚举

| 枚举 | 取值 | 用途 |
|---|---|---|
| `user_role` | `user` \| `moderator` \| `admin` | 权限分级 |
| `user_status` | `active` \| `suspended` \| `banned` | 账号状态 |
| `topic_status` | `published` \| `deleted` \| `locked` | 主题状态（软删除） |
| `node_status` | `active` \| `pending` \| `hidden` | 节点审核状态 |
| `collection_target` | `topic` \| `node` | 收藏目标类型 |
| `notification_type` | `reply` \| `mention` \| `topic_thanks` \| `node_thanks` \| `system` | 通知类型 |
| `vote_direction` | `up` \| `down` | 投票方向 |

## 表结构

### `users` — 用户

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | serial | PK | |
| `username` | varchar(32) | NOT NULL | 用户名 |
| `password_hash` | text | NOT NULL | `scrypt$salt$hash` 格式 |
| `email` | varchar(255) | UNIQUE | |
| `avatar` | varchar(512) | | 头像 URL |
| `tagline` | varchar(255) | | 头衔 |
| `bio` | text | | 简介 |
| `url` | varchar(512) | | 个人主页 |
| `location` | varchar(128) | | 所在地 |
| `role` | user_role | NOT NULL DEFAULT 'user' | |
| `status` | user_status | NOT NULL DEFAULT 'active' | |
| `balance` | integer | NOT NULL DEFAULT 0 | 积分 |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |
| `last_active_at` | timestamptz | NOT NULL DEFAULT now() | 在线人数统计依据 |

索引：
- `users_username_lower_uidx` — UNIQUE on `lower(username)`（大小写不敏感唯一）
- `users_email_uidx` — UNIQUE on `email`
- `users_created_at_idx`

### `categories` — 节点分类

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | serial PK | |
| `name` | varchar(64) NOT NULL | 分类标识（如 `tech`） |
| `title` | varchar(64) NOT NULL | 显示名（如 `技术`） |
| `sort` | integer DEFAULT 0 | 展示顺序 |
| `created_at` | timestamptz | |

### `nodes` — 节点

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | serial PK | |
| `name` | varchar(64) NOT NULL UNIQUE | 节点标识（URL 用 `/go/{name}`） |
| `title` | varchar(128) NOT NULL | 显示名 |
| `description` | text | |
| `avatar` | varchar(512) | 节点图标 |
| `parent_id` | integer | 父节点（自引用，对应原站子节点树） |
| `category_id` | integer → categories.id | 所属分类 |
| `status` | node_status DEFAULT 'active' | |
| `topics_count` | integer DEFAULT 0 | 缓存计数 |
| `feed_url` | varchar(512) | RSS 地址 |
| `created_by` | integer → users.id | |
| `created_at` | timestamptz | |

索引：`nodes_name_uidx`(UNIQUE)、`nodes_category_idx`、`nodes_parent_idx`

### `topics` — 主题

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | serial PK | |
| `title` | varchar(128) NOT NULL | |
| `content` | text NOT NULL | Markdown 原文 |
| `node_id` | integer → nodes.id NOT NULL | |
| `author_id` | integer → users.id NOT NULL | |
| `status` | topic_status DEFAULT 'published' | |
| `replies_count` | integer DEFAULT 0 | 缓存计数 |
| `views` | integer DEFAULT 0 | 浏览次数 |
| `votes` | integer DEFAULT 0 | 顶踩汇总 |
| `locked` | boolean DEFAULT false | 锁定后禁止回复 |
| `pinned` | boolean DEFAULT false | 置顶 |
| `last_reply_at` | timestamptz DEFAULT now() | 最后回复时间（列表排序依据） |
| `created_at` / `updated_at` | timestamptz | |

索引：`topics_node_idx`、`topics_author_idx`、`topics_created_at_idx`、
`topics_last_reply_at_idx`、`topics_node_last_reply_idx`（复合，覆盖节点页排序）

### `replies` — 回复

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | serial PK | |
| `topic_id` | integer → topics.id NOT NULL ON DELETE CASCADE | |
| `author_id` | integer → users.id NOT NULL | |
| `content` | text NOT NULL | |
| `floor` | integer NOT NULL | 楼层号，从 1 开始 |
| `thanks` | integer DEFAULT 0 | 感谢数（❤️） |
| `quote_id` | integer | 引用回复的楼层 |
| `created_at` / `updated_at` | timestamptz | |

索引：`replies_topic_floor_uidx` — UNIQUE on `(topic_id, floor)` ← **并发安全的关键约束**

### `floor_counters` — 楼层号分配器

| 列 | 类型 | 说明 |
|---|---|---|
| `topic_id` | integer PK | |
| `last_floor` | integer DEFAULT 0 | 已分配的最大楼层号 |

用途：以 `INSERT ... ON CONFLICT DO UPDATE SET last_floor = last_floor + 1 RETURNING last_floor`
实现原子分配，避免并发回复读到相同的 `max(floor)` 而产生重复楼层。

### `collections` — 收藏

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | serial PK | |
| `user_id` | integer → users.id NOT NULL ON DELETE CASCADE | |
| `target` | collection_target NOT NULL | `topic` 或 `node` |
| `topic_id` | integer → topics.id ON DELETE CASCADE | 收藏主题时使用 |
| `node_id` | integer → nodes.id ON DELETE CASCADE | 收藏节点时使用 |
| `created_at` | timestamptz | |

索引：`collections_topic_uidx` UNIQUE `(user_id, topic_id)`、
`collections_node_uidx` UNIQUE `(user_id, node_id)`、`collections_user_idx`

> **业务规则**：原站的「收藏主题」与「加入收藏（节点）」是两个独立概念
> （依据原站 `/t/645662` 讨论帖的明确区分），故用 `target` 字段区分。

### `follows` — 关注用户

| 列 | 类型 |
|---|---|
| `id` | serial PK |
| `follower_id` | integer → users.id NOT NULL ON DELETE CASCADE |
| `following_id` | integer → users.id NOT NULL ON DELETE CASCADE |
| `created_at` | timestamptz |

索引：`follows_pair_uidx` UNIQUE `(follower_id, following_id)`、`follows_following_idx`

### `notifications` — 通知

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | serial PK | |
| `user_id` | integer → users.id NOT NULL ON DELETE CASCADE | 接收者 |
| `type` | notification_type NOT NULL | |
| `actor_id` | integer → users.id | 触发者 |
| `topic_id` | integer → topics.id ON DELETE CASCADE | |
| `reply_id` | integer → replies.id ON DELETE CASCADE | |
| `message` | text NOT NULL | |
| `read` | boolean DEFAULT false | |
| `created_at` | timestamptz | |

索引：`notifications_user_idx` on `(user_id, read)`

### `votes` — 主题投票

| 列 | 类型 |
|---|---|
| `id` | serial PK |
| `user_id` | integer → users.id NOT NULL ON DELETE CASCADE |
| `topic_id` | integer → topics.id NOT NULL ON DELETE CASCADE |
| `direction` | vote_direction NOT NULL |
| `created_at` | timestamptz |

索引：`votes_user_topic_uidx` UNIQUE `(user_id, topic_id)`

### `thanks` — 回复感谢

| 列 | 类型 |
|---|---|
| `id` | serial PK |
| `user_id` | integer → users.id NOT NULL ON DELETE CASCADE |
| `reply_id` | integer → replies.id NOT NULL ON DELETE CASCADE |
| `created_at` | timestamptz |

索引：`thanks_user_reply_uidx` UNIQUE `(user_id, reply_id)`

### `sessions` — 会话

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | varchar(64) PK | 随机 32 字节 hex |
| `user_id` | integer → users.id NOT NULL ON DELETE CASCADE | |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | 14 天后过期 |
| `user_agent` | text | |
| `ip` | varchar(64) | |

索引：`sessions_user_idx`

### `login_attempts` — 登录尝试记录

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | serial PK | |
| `identifier` | varchar(255) NOT NULL | 用户名 |
| `ip` | varchar(64) NOT NULL | |
| `success` | boolean NOT NULL | |
| `created_at` | timestamptz | |

索引：`login_attempts_identifier_ip_idx` on `(identifier, ip)`

### `moderation_logs` — 管理操作日志

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | serial PK | |
| `moderator_id` | integer → users.id NOT NULL | 操作人 |
| `action` | varchar(64) NOT NULL | 如 `node.create` / `node.hide` |
| `target_type` | varchar(32) NOT NULL | `node` / `topic` |
| `target_id` | integer NOT NULL | |
| `reason` | text | |
| `created_at` | timestamptz | |

索引：`moderation_logs_target_idx` on `(target_type, target_id)`

### `tags` / `topic_tags` — 标签

`tags(id, name UNIQUE)`；`topic_tags(topic_id, tag_id)` 复合主键。

### `rate_limit_buckets` — 限流计数（Redis 降级）

| 列 | 类型 |
|---|---|
| `key` | varchar(255) PK |
| `count` | integer DEFAULT 0 |
| `window_start` | timestamptz DEFAULT now() |

### `kv_store` — 通用键值存储（Redis 降级）

| 列 | 类型 |
|---|---|
| `key` | varchar(255) PK |
| `value` | text NOT NULL |
| `expires_at` | timestamptz |

用途：验证码答案、会话辅助数据。无 Redis 时自动启用。

## 迁移命令

```bash
# 生成新迁移（修改 schema.ts 后）
npm run db:generate

# 应用迁移
npm run db:migrate

# 初始化种子数据
npm run db:seed
```

## 设计决策

1. **软删除**：主题用 `status='deleted'` 而非物理删除，便于审计与恢复。
2. **计数缓存**：`topics.replies_count`、`nodes.topics_count` 为冗余计数，
   写入路径同步更新，读路径不实时 COUNT，保证列表页性能。
3. **楼层号分配**：使用独立 `floor_counters` 表而非 `max(floor)+1`，
   后者在并发下必然产生重复。唯一索引 `(topic_id, floor)` 是最后一道防线。
4. **大小写不敏感唯一**：`users_username_lower_uidx` 使用表达式索引，
   保证 `Admin` 与 `admin` 冲突。
5. **限流键设计**：登录/注册使用 `IP + 用户名` 组合键，
   避免同一出口 IP 下的正常用户互相影响，同时仍能拦截针对单账号的暴力破解。
6. **Redis 可选**：`src/lib/kv.ts` 抽象出 KV 接口，
   有 Redis 用 Redis，无 Redis 自动降级到 PostgreSQL 的 `kv_store` / `rate_limit_buckets`，
   两种实现语义一致。
