-- ---------------------------------------------------------------------------
-- v0.0.4 升级/恢复验证：只读数据指纹
--
-- 用法（不写任何数据）：
--   PGPASSWORD=... psql -h 127.0.0.1 -p 55433 -U v2ex -d <库名> \
--     -X -t -A -F '|' -f scripts/release/fingerprint.sql > fp.txt
--
-- 输出为每行 `key|value` 的规范化文本，按 key 排序，可直接 diff / sha256sum。
--   data.*   —— 业务数据指纹：升级前后**必须逐字节完全一致**
--   schema.* —— 结构指纹：升级后预期变化（+7 索引 / +1 扩展 / +1 迁移记录）
--
-- 本脚本只读，禁止在此文件里出现 INSERT / UPDATE / DELETE / DDL。
-- ---------------------------------------------------------------------------
WITH kv AS (
  SELECT 'data.rowcount.avatars'::text              AS k, count(*)::text AS v FROM avatars
  UNION ALL SELECT 'data.rowcount.categories',             count(*)::text FROM categories
  UNION ALL SELECT 'data.rowcount.collections',            count(*)::text FROM collections
  UNION ALL SELECT 'data.rowcount.credit_ledger',          count(*)::text FROM credit_ledger
  UNION ALL SELECT 'data.rowcount.daily_checkins',         count(*)::text FROM daily_checkins
  UNION ALL SELECT 'data.rowcount.edit_history',           count(*)::text FROM edit_history
  UNION ALL SELECT 'data.rowcount.email_logs',             count(*)::text FROM email_logs
  UNION ALL SELECT 'data.rowcount.floor_counters',         count(*)::text FROM floor_counters
  UNION ALL SELECT 'data.rowcount.follows',                count(*)::text FROM follows
  UNION ALL SELECT 'data.rowcount.kv_store',               count(*)::text FROM kv_store
  UNION ALL SELECT 'data.rowcount.login_attempts',         count(*)::text FROM login_attempts
  UNION ALL SELECT 'data.rowcount.moderation_logs',        count(*)::text FROM moderation_logs
  UNION ALL SELECT 'data.rowcount.node_requests',          count(*)::text FROM node_requests
  UNION ALL SELECT 'data.rowcount.nodes',                  count(*)::text FROM nodes
  UNION ALL SELECT 'data.rowcount.notifications',          count(*)::text FROM notifications
  UNION ALL SELECT 'data.rowcount.password_reset_tokens',  count(*)::text FROM password_reset_tokens
  UNION ALL SELECT 'data.rowcount.rate_limit_buckets',     count(*)::text FROM rate_limit_buckets
  UNION ALL SELECT 'data.rowcount.replies',                count(*)::text FROM replies
  UNION ALL SELECT 'data.rowcount.reports',                count(*)::text FROM reports
  UNION ALL SELECT 'data.rowcount.sessions',               count(*)::text FROM sessions
  UNION ALL SELECT 'data.rowcount.tags',                   count(*)::text FROM tags
  UNION ALL SELECT 'data.rowcount.thanks',                 count(*)::text FROM thanks
  UNION ALL SELECT 'data.rowcount.topic_tags',             count(*)::text FROM topic_tags
  UNION ALL SELECT 'data.rowcount.topics',                 count(*)::text FROM topics
  UNION ALL SELECT 'data.rowcount.users',                  count(*)::text FROM users
  UNION ALL SELECT 'data.rowcount.votes',                  count(*)::text FROM votes
  -- 凭据与肖像字段：迁移绝不能改写
  UNION ALL SELECT 'data.users.admin.password_hash', password_hash FROM users WHERE username = 'admin'
  UNION ALL SELECT 'data.users.admin.role',         role::text    FROM users WHERE username = 'admin'
  UNION ALL SELECT 'data.users.admin.balance',      balance::text FROM users WHERE username = 'admin'
  UNION ALL SELECT 'data.users.alice.avatar',       coalesce(avatar, '<NULL>') FROM users WHERE username = 'alice'
  UNION ALL SELECT 'data.users.alice.balance',      balance::text FROM users WHERE username = 'alice'
  UNION ALL SELECT 'data.users.bob.balance',        balance::text FROM users WHERE username = 'bob'
  UNION ALL SELECT 'data.users.balance_sum',        sum(balance)::text FROM users
  UNION ALL SELECT 'data.users.password_hash_list', string_agg(username || ':' || password_hash, ',' ORDER BY username) FROM users
  UNION ALL SELECT 'data.users.avatar_list',        string_agg(username || ':' || coalesce(avatar, '<NULL>'), ',' ORDER BY username) FROM users
  UNION ALL SELECT 'data.users.role_list',          string_agg(username || ':' || role, ',' ORDER BY username) FROM users
  -- 内容字段
  UNION ALL SELECT 'data.topics.id1.title',          title FROM topics WHERE id = 1
  UNION ALL SELECT 'data.topics.id1.content',        content FROM topics WHERE id = 1
  UNION ALL SELECT 'data.topics.id1.replies_count',  replies_count::text FROM topics WHERE id = 1
  UNION ALL SELECT 'data.topics.title_list',         string_agg(title, ',' ORDER BY id) FROM topics
  UNION ALL SELECT 'data.replies.id1.content',       content FROM replies WHERE id = 1
  UNION ALL SELECT 'data.replies.id1.floor',         floor::text FROM replies WHERE id = 1
  UNION ALL SELECT 'data.replies.content_list',      string_agg(content, ',' ORDER BY id) FROM replies
  UNION ALL SELECT 'data.nodes.name_list',           string_agg(name, ',' ORDER BY id) FROM nodes
  UNION ALL SELECT 'data.kv_store.keys',             string_agg(key, ',' ORDER BY key) FROM kv_store
  UNION ALL SELECT 'data.avatars.storage_path_list', string_agg(storage_path, ',' ORDER BY id) FROM avatars
  -- 积分账本：余额与流水都必须原样保留
  UNION ALL SELECT 'data.credit_ledger.rows',        count(*)::text FROM credit_ledger
  UNION ALL SELECT 'data.credit_ledger.amount_sum',  coalesce(sum(amount), 0)::text FROM credit_ledger
  UNION ALL SELECT 'data.credit_ledger.detail',      string_agg(user_id || ':' || type || ':' || amount || ':' || balance_before || '->' || balance_after || ':' || coalesce(idempotency_key, '-'), ',' ORDER BY id) FROM credit_ledger
  UNION ALL SELECT 'data.ledger_balance_consistency',
       (SELECT string_agg(u.username || '=' || u.balance || '/' || coalesce(l.last_after, 'NULL'), ',' ORDER BY u.username)
          FROM users u
          LEFT JOIN (SELECT user_id, (array_agg(balance_after ORDER BY id DESC))[1]::text AS last_after
                       FROM credit_ledger GROUP BY user_id) l ON l.user_id = u.id)
  -- 结构指纹（升级后预期变化）
  UNION ALL SELECT 'schema.index.count',        count(*)::text FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'schema.index.names',        string_agg(indexname, ',' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'schema.migration.rows',     count(*)::text FROM drizzle.__drizzle_migrations
  UNION ALL SELECT 'schema.migration.hashes',   string_agg(hash, ',' ORDER BY id) FROM drizzle.__drizzle_migrations
  UNION ALL SELECT 'schema.extension.pg_trgm',  count(*)::text FROM pg_extension WHERE extname = 'pg_trgm'
)
SELECT k || '|' || v FROM kv ORDER BY k;
