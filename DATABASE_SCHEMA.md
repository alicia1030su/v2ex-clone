# 数据库结构（DATABASE_SCHEMA）

> 本表由**运行中的数据库**读取生成（`information_schema` / `pg_catalog`），
> 与 `src/db/schema.ts` 及 `drizzle/*.sql` 迁移保持一致。

- 表总数：**26**
- 枚举类型：**12**
- 迁移文件：`drizzle/0000_init.sql`（v0.0.2 基线）、`drizzle/0001_striped_magdalene.sql`（v0.0.3）

## 枚举类型

| 枚举 | 取值 |
|---|---|
| `collection_target` | topic, node |
| `email_purpose` | password_reset |
| `ledger_entry_type` | topic_created, reply_created, topic_thanked, daily_checkin, admin_adjust, admin_deduct, registration_bonus |
| `node_request_status` | pending, approved, rejected |
| `node_status` | active, pending, hidden |
| `notification_type` | reply, mention, topic_thanks, node_thanks, system |
| `report_status` | pending, accepted, rejected |
| `report_target_type` | topic, reply, user |
| `topic_status` | published, deleted, locked |
| `user_role` | user, moderator, admin |
| `user_status` | active, suspended, banned |
| `vote_direction` | up, down |

## 表结构

| 表 | 列数 | 主键 | 说明 |
|---|---|---|---|
| `avatars` | 9 | id | ★ v0.0.3 头像文件元数据 |
| `categories` | 5 | id | 节点分类 |
| `collections` | 6 | id | 收藏（主题或节点） |
| `credit_ledger` | 12 | id | ★ v0.0.3 积分流水（不可篡改账本） |
| `daily_checkins` | 6 | id | ★ v0.0.3 每日签到 |
| `edit_history` | 9 | id | ★ v0.0.3 编辑历史快照（只 INSERT） |
| `email_logs` | 7 | id | ★ v0.0.3 邮件发送日志（脱敏） |
| `floor_counters` | 2 | topic_id | 楼层号原子分配器 |
| `follows` | 4 | id | 关注关系（follower → following） |
| `kv_store` | 3 | key | 通用键值存储（Redis 降级） |
| `login_attempts` | 5 | id | 登录尝试记录（限流/审计） |
| `moderation_logs` | 7 | id | 管理操作审计日志 |
| `node_requests` | 11 | id | ★ v0.0.3 节点创建申请 |
| `nodes` | 12 | id | 节点（归属分类，可有父节点） |
| `notifications` | 9 | id | 通知（已读/未读） |
| `password_reset_tokens` | 8 | id | ★ v0.0.3 密码重置令牌（只存哈希） |
| `rate_limit_buckets` | 3 | key | 限流桶（PostgreSQL 降级存储） |
| `replies` | 14 | id | 回复（楼层号唯一索引；v0.0.3 加软删除与编辑字段） |
| `reports` | 10 | id | ★ v0.0.3 举报与处理记录 |
| `sessions` | 6 | id | 会话 |
| `tags` | 2 | id | 标签 |
| `thanks` | 4 | id | 回复感谢（一人一回复唯一） |
| `topic_tags` | 2 | topic_id, tag_id | 主题-标签关联 |
| `topics` | 19 | id | 主题（v0.0.3 加软删除与编辑字段） |
| `users` | 14 | id | 用户（余额、角色、状态、头像、资料） |
| `votes` | 5 | id | 主题投票（一人一主题唯一） |

## v0.0.3 新增字段

| 表 | 字段 | 类型 | 用途 |
|---|---|---|---|
| `topics` | `deleted_at` | timestamptz | 软删除时间（NULL = 未删除） |
| `topics` | `deleted_by` | integer | 软删除操作人 |
| `topics` | `deleted_reason` | text | 软删除原因 |
| `topics` | `edited_at` | timestamptz | 最后编辑时间 |
| `topics` | `edit_count` | integer | 编辑次数 |
| `replies` | `deleted_at` | timestamptz | 软删除时间 |
| `replies` | `deleted_by` | integer | 软删除操作人 |
| `replies` | `deleted_reason` | text | 软删除原因 |
| `replies` | `edited_at` | timestamptz | 最后编辑时间 |
| `replies` | `edit_count` | integer | 编辑次数 |

## 关键索引与约束

| 名称 | 表 | 类型 | 作用 |
|---|---|---|---|
| ✅ `replies_topic_floor_uidx` | `replies` | UNIQUE | 保证同一主题内楼层号不重复（并发回复安全） |
| ✅ `votes_user_topic_uidx` | `votes` | UNIQUE | 一人一主题只有一票（投票幂等） |
| ✅ `thanks_user_reply_uidx` | `thanks` | UNIQUE | 一人一回复只感谢一次（感谢幂等） |
| ✅ `credit_ledger_idem_uidx` | `credit_ledger` | UNIQUE | 积分幂等键（重复请求不重复发放） |
| ✅ `daily_checkins_user_date_uidx` | `daily_checkins` | UNIQUE | 一天只能签到一次 |
| ✅ `password_reset_tokens_hash_uidx` | `password_reset_tokens` | UNIQUE | 令牌哈希唯一 |
| ✅ `collections_topic_uidx` | `collections` | UNIQUE | 同一用户对同一主题只收藏一次 |
| ✅ `collections_node_uidx` | `collections` | UNIQUE | 同一用户对同一节点只收藏一次 |
| ✅ `follows_pair_uidx` | `follows` | UNIQUE | 同一对关注关系只存在一次 |
| ✅ `topics_node_deleted_idx` | `topics` | INDEX | 按节点 + 未删除 + 最后回复排序（列表查询） |

## 迁移策略

### v0.0.2 → v0.0.3 原地升级

```bash
# 1. 备份（升级前必做）
docker compose exec -T postgres pg_dump -U v2ex v2ex | gzip > backup-$(date +%Y%m%d).sql.gz

# 2. 拉取新镜像（entrypoint 阶段 1 自动执行迁移）
docker compose pull && docker compose up -d

# 3. 验证（表数量应为 26，管理员口令不变）
docker compose exec -T postgres psql -U v2ex -d v2ex -c "\dt"
```

**幂等性**：`0001` 迁移的所有语句都做了幂等保护 ——

- `CREATE TABLE` / `CREATE INDEX` / `ADD COLUMN` → `IF NOT EXISTS`
- `CREATE TYPE` / `ADD CONSTRAINT` → 包入 `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`

实测：连续应用 3 次全部 `exit=0`，最终 26 表 / 38 约束。

### 升级不触碰的数据

| 数据 | 升级时是否变更 | 说明 |
|---|---|---|
| 现有数据库 | ❌ 不删除 | 迁移只做 ADD COLUMN / CREATE TABLE |
| 现有数据卷 | ❌ 不清空 | `docker compose down` 不带 `-v` |
| 管理员口令 | ❌ 不重置 | `seed.ts` 幂等，不覆盖已有口令 |
| 用户头像与附件 | ❌ 不覆盖 | 头像存于 `public/uploads/`，迁移不触碰 |
| 用户主题与回复 | ❌ 不破坏 | 只加字段，旧数据列有默认值 |

