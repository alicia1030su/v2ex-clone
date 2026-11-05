-- v0.0.4 性能索引 —— 来源：真实社区规模压测（10000 用户 / 1000 节点 /
-- 100000 主题 / 1000000 回复）下的 EXPLAIN ANALYZE 实测。
--
-- 背景：
--   v0.0.3 的积分排行榜用**相关子查询**统计活跃度：
--     (SELECT COUNT(*) FROM replies r WHERE r.author_id = t.author_id)
--     (SELECT COUNT(*) FROM thanks th JOIN replies r2 ON r2.id = th.reply_id
--       WHERE r2.author_id = t.author_id)
--   这两个子查询对**每个作者各执行一次**。
--   实测（10 万主题 / 100 万回复）：耗时 **241.98 秒**，
--   成本估算 38,943,939 —— /api/leaderboard 端点实际不可用。
--
--   查询本身已改写为「三个独立聚合 + JOIN」（见 src/lib/credit-service.ts
--   的 leaderboard()），耗时降到 0.74 秒。
--   本迁移补上让聚合能走索引的部分索引，进一步降到 0.46 秒。
--
-- 幂等：全部使用 IF NOT EXISTS，可重复执行。

-- ---------------------------------------------------------------------------
-- thanks.reply_id —— 「被感谢数」统计的必要索引
--
-- 实测：thanks 表只有 thanks_user_reply_uidx(user_id, reply_id) 复合索引，
--   reply_id 作为第二列，在「按 reply_id 反查」时无法有效使用。
--   加单列索引后，thanks → replies 的连接可走 Index Scan。
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "thanks_reply_id_idx" ON "thanks" USING btree ("reply_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- replies.author_id WHERE deleted_at IS NULL —— 未删除回复数统计
--
-- 实测：原 replies_author_idx 索引包含软删除行，
--   统计「未删除回复数」时仍需过滤大量行。
--   部分索引只覆盖存活行，体积更小、命中率更高。
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "replies_author_alive_idx" ON "replies" USING btree ("author_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- topics.author_id WHERE deleted_at IS NULL —— 未删除主题数统计
-- 同上：部分索引只覆盖存活主题。
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "topics_author_alive_idx" ON "topics" USING btree ("author_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- votes.topic_id —— 防御性索引
--
-- 当前代码路径**不需要**它：所有 votes 查询都是
--   WHERE user_id = ? AND topic_id = ?  （复合索引 votes_user_topic_uidx 完全命中），
--   票数汇总走 topics.votes 增量字段，不做 count(*)。
--
--   但实测中「按 topic_id 统计票数」在 100 万 votes 下是
--   Parallel Seq Scan（扫 28 万行过滤出 3 行，耗时 137ms）。
--   加这个索引是为将来可能出现的「某主题的投票明细」「数据一致性校验」
--   等场景预留，避免那时才发现退化。
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "votes_topic_id_idx" ON "votes" USING btree ("topic_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- replies.topic_id —— 「按主题统计回复数」的防御性索引
-- 现有 replies_topic_deleted_idx 与 replies_topic_floor_uidx 均为复合索引，
-- 单独按 topic_id 前缀查询时不如单列索引紧凑。
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "replies_topic_id_idx" ON "replies" USING btree ("topic_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 全文模糊搜索：pg_trgm 三值索引
--
-- 实测（10 万主题）：搜索条件 `title ILIKE '%linux%' OR content ILIKE '%linux%'`
--   用普通 B-tree 索引**无效**（前导通配符无法用索引定位），
--   EXPLAIN 实测 **Seq Scan 扫 10 万行 = 803ms**。
--
--   pg_trgm 的 GIN 三值索引能处理前导通配符：
--   加索引后 EXPLAIN 实测 **Bitmap Index Scan = 0.064ms**（约 12000 倍）。
--
-- 容错：pg_trgm 是 PostgreSQL 扩展，创建需要相应权限。
--   权限不足时**跳过 trigram 索引**（用 DO 块捕获异常），
--   搜索退化为全表扫描但功能仍可用 —— 不因为性能优化而让迁移失败。
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'pg_trgm 扩展创建失败（权限不足），跳过 trigram 索引；搜索将退化为全表扫描';
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "topics_title_trgm_idx"
      ON "topics" USING gin ("title" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "topics_content_trgm_idx"
      ON "topics" USING gin ("content" gin_trgm_ops);
  END IF;
END $$;--> statement-breakpoint
