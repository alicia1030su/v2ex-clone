\set ON_ERROR_STOP on
\pset pager off

\echo '=== 1. 行数 ==='
SELECT 'users' t, count(*) n FROM users
UNION ALL SELECT 'nodes', count(*) FROM nodes
UNION ALL SELECT 'topics', count(*) FROM topics
UNION ALL SELECT 'replies', count(*) FROM replies
UNION ALL SELECT 'floor_counters', count(*) FROM floor_counters
ORDER BY 1;

\echo ''
\echo '=== 2. 外键孤儿检查（全部应为 0）==='
SELECT 'topics.node_id' k, count(*) n FROM topics t LEFT JOIN nodes n ON n.id=t.node_id WHERE n.id IS NULL
UNION ALL SELECT 'topics.author_id', count(*) FROM topics t LEFT JOIN users u ON u.id=t.author_id WHERE u.id IS NULL
UNION ALL SELECT 'replies.topic_id', count(*) FROM replies r LEFT JOIN topics t ON t.id=r.topic_id WHERE t.id IS NULL
UNION ALL SELECT 'replies.author_id', count(*) FROM replies r LEFT JOIN users u ON u.id=r.author_id WHERE u.id IS NULL
UNION ALL SELECT 'replies.deleted_by', count(*) FROM replies r WHERE r.deleted_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=r.deleted_by)
UNION ALL SELECT 'topics.deleted_by', count(*) FROM topics t WHERE t.deleted_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=t.deleted_by)
UNION ALL SELECT 'votes.user_id', count(*) FROM votes v LEFT JOIN users u ON u.id=v.user_id WHERE u.id IS NULL
UNION ALL SELECT 'votes.topic_id', count(*) FROM votes v LEFT JOIN topics t ON t.id=v.topic_id WHERE t.id IS NULL
UNION ALL SELECT 'thanks.reply_id', count(*) FROM thanks th LEFT JOIN replies r ON r.id=th.reply_id WHERE r.id IS NULL
UNION ALL SELECT 'thanks.user_id', count(*) FROM thanks th LEFT JOIN users u ON u.id=th.user_id WHERE u.id IS NULL
UNION ALL SELECT 'collections.user_id', count(*) FROM collections c LEFT JOIN users u ON u.id=c.user_id WHERE u.id IS NULL
UNION ALL SELECT 'collections.topic_id', count(*) FROM collections c WHERE c.topic_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM topics t WHERE t.id=c.topic_id)
UNION ALL SELECT 'collections.node_id', count(*) FROM collections c WHERE c.node_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.id=c.node_id)
UNION ALL SELECT 'follows.follower_id', count(*) FROM follows f LEFT JOIN users u ON u.id=f.follower_id WHERE u.id IS NULL
UNION ALL SELECT 'follows.following_id', count(*) FROM follows f LEFT JOIN users u ON u.id=f.following_id WHERE u.id IS NULL
UNION ALL SELECT 'notifications.user_id', count(*) FROM notifications n LEFT JOIN users u ON u.id=n.user_id WHERE u.id IS NULL
UNION ALL SELECT 'notifications.topic_id', count(*) FROM notifications n WHERE n.topic_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM topics t WHERE t.id=n.topic_id)
UNION ALL SELECT 'notifications.reply_id', count(*) FROM notifications n WHERE n.reply_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM replies r WHERE r.id=n.reply_id)
UNION ALL SELECT 'sessions.user_id', count(*) FROM sessions s LEFT JOIN users u ON u.id=s.user_id WHERE u.id IS NULL
UNION ALL SELECT 'credit_ledger.user_id', count(*) FROM credit_ledger l LEFT JOIN users u ON u.id=l.user_id WHERE u.id IS NULL
UNION ALL SELECT 'daily_checkins.user_id', count(*) FROM daily_checkins d LEFT JOIN users u ON u.id=d.user_id WHERE u.id IS NULL
UNION ALL SELECT 'topic_tags.topic_id', count(*) FROM topic_tags tt LEFT JOIN topics t ON t.id=tt.topic_id WHERE t.id IS NULL
UNION ALL SELECT 'topic_tags.tag_id', count(*) FROM topic_tags tt LEFT JOIN tags g ON g.id=tt.tag_id WHERE g.id IS NULL
UNION ALL SELECT 'floor_counters.topic_id', count(*) FROM floor_counters f LEFT JOIN topics t ON t.id=f.topic_id WHERE t.id IS NULL
ORDER BY 1;

\echo ''
\echo '=== 3. floor 唯一性（应为 0）==='
SELECT count(*) AS dup_topic_floor FROM (
  SELECT topic_id, floor FROM replies GROUP BY topic_id, floor HAVING count(*) > 1
) x;

\echo '=== 4. floor 连续性：每主题 max(floor) == 该主题回复总数 ==='
SELECT count(*) AS mismatched FROM (
  SELECT t.id,
         (SELECT count(*) FROM replies r WHERE r.topic_id=t.id) AS cnt,
         (SELECT max(floor) FROM replies r WHERE r.topic_id=t.id) AS mx
  FROM topics t
) z WHERE cnt <> mx;

\echo '=== 4b. floor 从 1 连续无空洞（应为 0）==='
SELECT count(*) AS holes FROM (
  SELECT topic_id, max(floor) mx, count(*) cnt FROM replies GROUP BY topic_id
) z WHERE mx <> cnt;

\echo '=== 5. floor_counters 与实际 max(floor) 一致 ==='
SELECT count(*) AS mismatch FROM floor_counters f
LEFT JOIN (SELECT topic_id, max(floor) mx FROM replies GROUP BY topic_id) r USING (topic_id)
WHERE f.last_floor <> r.mx;

\echo ''
\echo '=== 6. 软删除比例 ==='
SELECT 'topics' tbl,
       count(*) total,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) deleted,
       round(100.0*count(*) FILTER (WHERE deleted_at IS NOT NULL)/count(*), 2) pct
FROM topics
UNION ALL
SELECT 'replies', count(*), count(*) FILTER (WHERE deleted_at IS NOT NULL),
       round(100.0*count(*) FILTER (WHERE deleted_at IS NOT NULL)/count(*), 2)
FROM replies;

\echo '=== 7. replies_count 只计未删除回复（应为 0 条不符）==='
SELECT count(*) AS bad FROM topics t
WHERE t.replies_count <> (SELECT count(*) FROM replies r WHERE r.topic_id=t.id AND r.deleted_at IS NULL);

\echo '=== 8. 软删除主题的 status 应为 deleted ==='
SELECT count(*) AS bad FROM topics WHERE deleted_at IS NOT NULL AND status <> 'deleted';

\echo ''
\echo '=== 9. 账本自洽：balance_before + amount = balance_after（应为 0）==='
SELECT count(*) AS bad FROM credit_ledger WHERE balance_before + amount <> balance_after;

\echo '=== 10. 账本自洽：相邻流水首尾相接（应为 0）==='
SELECT count(*) AS bad FROM (
  SELECT user_id, id, balance_after, balance_before,
         lag(balance_after) OVER (PARTITION BY user_id ORDER BY id) AS prev_after
  FROM credit_ledger
) z WHERE prev_after IS NOT NULL AND prev_after <> balance_before;

\echo '=== 11. 账本自洽：末条 balance_after == users.balance（应为 0）==='
SELECT count(*) AS bad FROM (
  SELECT l.user_id, max(l.balance_after) OVER (PARTITION BY l.user_id) AS final_bal, u.balance
  FROM credit_ledger l JOIN users u ON u.id = l.user_id
) z WHERE final_bal <> balance;

\echo '=== 12. 账本自洽：首条 balance_before == 0（应为 0）==='
SELECT count(*) AS bad FROM (
  SELECT user_id, balance_before,
         row_number() OVER (PARTITION BY user_id ORDER BY id) AS rn
  FROM credit_ledger
) z WHERE rn = 1 AND balance_before <> 0;

\echo '=== 13. 余额非负（应为 0）==='
SELECT count(*) AS bad FROM users WHERE balance < 0;

\echo ''
\echo '=== 14. idempotency_key 唯一（应为 0）==='
SELECT count(*) AS dup FROM (
  SELECT idempotency_key FROM credit_ledger WHERE idempotency_key IS NOT NULL
  GROUP BY idempotency_key HAVING count(*) > 1
) x;

\echo '=== 15. daily_checkins (user_id, checkin_date) 唯一（应为 0）==='
SELECT count(*) AS dup FROM (
  SELECT user_id, checkin_date FROM daily_checkins GROUP BY user_id, checkin_date HAVING count(*) > 1
) x;

\echo ''
\echo '=== 16. nodes.parent_id 无环：父 id 必须恒小于子 id（应为 0）==='
SELECT count(*) AS self_or_forward_ref FROM nodes WHERE parent_id IS NOT NULL AND parent_id >= id;

\echo '=== 16b. nodes.parent_id 无环（递归检测：从根往下走，路径中不得重复出现节点自身）==='
WITH RECURSIVE chain AS (
  SELECT id, parent_id, ARRAY[id] AS path FROM nodes WHERE parent_id IS NOT NULL
  UNION ALL
  SELECT n.id, n.parent_id, c.path || n.id
  FROM nodes n JOIN chain c ON n.id = c.parent_id
  WHERE NOT (n.id = ANY(c.path))
)
-- 环 = 某个 id 在路径中出现了两次以上
SELECT count(*) AS cycles FROM (
  SELECT id FROM chain
  GROUP BY id, path
  HAVING cardinality(path) <> cardinality(ARRAY(SELECT unnest(path)))
) x;

\echo '=== 17. nodes.parent_id 存在性（应为 0）==='
SELECT count(*) AS orphan FROM nodes n WHERE n.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM nodes p WHERE p.id = n.parent_id);

\echo '=== 18. 每个节点的 category_id 存在（应为 0）==='
SELECT count(*) AS orphan FROM nodes n WHERE n.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = n.category_id);

\echo ''
\echo '=== 19. votes 汇总 == topics.votes（应为 0）==='
SELECT count(*) AS bad FROM topics t
WHERE t.votes <> COALESCE((SELECT sum(CASE WHEN direction='up' THEN 1 ELSE -1 END) FROM votes v WHERE v.topic_id=t.id), 0);

\echo '=== 20. replies.thanks == thanks 表行数（应为 0）==='
SELECT count(*) AS bad FROM replies r
WHERE r.thanks <> (SELECT count(*) FROM thanks th WHERE th.reply_id = r.id);

\echo '=== 21. nodes.topics_count == 未删除主题数（应为 0）==='
SELECT count(*) AS bad FROM nodes n
WHERE n.topics_count <> (SELECT count(*) FROM topics t WHERE t.node_id=n.id AND t.deleted_at IS NULL);

\echo ''
\echo '=== 22. follows 无自环（应为 0）==='
SELECT count(*) AS self_follow FROM follows WHERE follower_id = following_id;

\echo '=== 23. votes (user_id, topic_id) 唯一（应为 0）==='
SELECT count(*) AS dup FROM (SELECT user_id, topic_id FROM votes GROUP BY user_id, topic_id HAVING count(*) > 1) x;

\echo '=== 24. collections (user_id, topic_id) 唯一（应为 0）==='
SELECT count(*) AS dup FROM (SELECT user_id, topic_id FROM collections WHERE topic_id IS NOT NULL GROUP BY user_id, topic_id HAVING count(*) > 1) x;

\echo '=== 25. collections (user_id, node_id) 唯一（应为 0）==='
SELECT count(*) AS dup FROM (SELECT user_id, node_id FROM collections WHERE node_id IS NOT NULL GROUP BY user_id, node_id HAVING count(*) > 1) x;

\echo ''
\echo '=== 26. 时间戳分布（过去 2 年内，非 now）==='
SELECT 'topics.created_at' c, min(created_at) mn, max(created_at) mx FROM topics
UNION ALL SELECT 'replies.created_at', min(created_at), max(created_at) FROM replies
UNION ALL SELECT 'users.created_at', min(created_at), max(created_at) FROM users
UNION ALL SELECT 'nodes.created_at', min(created_at), max(created_at) FROM nodes;

\echo '=== 27. 角色分布（admin/moderator 至少各 1）==='
SELECT role, count(*) FROM users GROUP BY role ORDER BY role;

\echo '=== 28. 活跃关系表行数 ==='
SELECT 'follows' t, count(*) n FROM follows
UNION ALL SELECT 'collections', count(*) FROM collections
UNION ALL SELECT 'votes', count(*) FROM votes
UNION ALL SELECT 'notifications', count(*) FROM notifications
UNION ALL SELECT 'sessions', count(*) FROM sessions
UNION ALL SELECT 'daily_checkins', count(*) FROM daily_checkins
UNION ALL SELECT 'credit_ledger', count(*) FROM credit_ledger
UNION ALL SELECT 'thanks', count(*) FROM thanks;

\echo ''
\echo '=== 29. password_hash 格式合法性（全部应为 t）==='
SELECT count(*) FILTER (WHERE password_hash LIKE 'scrypt$%') AS fmt_ok,
       count(*) AS total,
       count(DISTINCT password_hash) AS distinct_hashes
FROM users;

\echo '=== 30. 确定性指纹 ==='
SELECT 'users' t, COALESCE(sum(('x' || substr(md5(rowtext),1,8))::bit(32)::int)::bigint,0) s
  FROM (SELECT concat_ws('|', username, role, status, balance, created_at)::text rowtext FROM users) x
UNION ALL
SELECT 'nodes', COALESCE(sum(('x' || substr(md5(rowtext),1,8))::bit(32)::int)::bigint,0)
  FROM (SELECT concat_ws('|', name, parent_id, category_id, status, created_at)::text rowtext FROM nodes) x
UNION ALL
SELECT 'topics', COALESCE(sum(('x' || substr(md5(rowtext),1,8))::bit(32)::int)::bigint,0)
  FROM (SELECT concat_ws('|', title, node_id, author_id, status, views, created_at)::text rowtext FROM topics) x
UNION ALL
SELECT 'replies', COALESCE(sum(('x' || substr(md5(rowtext),1,8))::bit(32)::int)::bigint,0)
  FROM (SELECT concat_ws('|', topic_id, author_id, floor, content, created_at)::text rowtext FROM replies) x;
