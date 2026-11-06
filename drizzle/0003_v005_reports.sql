-- v0.0.5 举报系统上报端 —— 补全「用户提交举报」所需的最小 schema 增量
--
-- 背景：
--   v0.0.2 起 `reports` 表已存在，且处理端（GET /api/admin/reports、
--   POST /api/admin/reports/[id]/handle、AdminConsole「举报」tab）早已可用。
--   **但用户端上报端完全缺失**：没有 `POST /api/reports`、主题/回复页没有
--   举报按钮、没有「举报原因选择」「补充说明」「防重复」「防刷」，
--   用户也看不到自己的举报处理状态 —— 整个举报闭环是断的。
--
--   本迁移补上让闭环成立的最小增量：
--     1) `reports.detail` —— 举报补充说明（可选，最长 500）
--     2) `reports_reporter_target_uidx` —— 同一用户对同一目标只能有一条
--        **进行中**的举报（防重复举报）
--     3) `reports_created_at_idx` —— 「我的举报」按时间倒序的索引
--
-- 设计决策：
--   * `reason` 仍为 text，存**中文原因标签**（由前端从固定列表选择），
--     而非自由文本 —— 这样后台统计与 `deletedReason` 文案都可读。
--     （v0.0.2 的 `reason` 是自由文本，当时无上报端故无数据兼容问题。）
--   * 唯一索引用 **WHERE status = 'pending'** 的部分索引，而不是全表唯一：
--     全表唯一会阻止用户在「举报被驳回后」再次举报同一目标，
--     而部分索引只拦「进行中」的重复 —— 符合「防重复举报」的产品语义。
--
-- 幂等：全部 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS，可重复执行。

-- ---------------------------------------------------------------------------
-- 1) 举报补充说明
-- ---------------------------------------------------------------------------
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "detail" text;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2) 防重复举报：同一用户 + 同一目标 + 进行中 ⇒ 唯一
--
-- 为什么用部分索引（WHERE status = 'pending'）：
--   全表唯一索引会让「已处理」的举报也占位，导致用户无法在举报被驳回后
--   再次举报（例如内容后来才变违规）。部分索引只约束「进行中」的这一条，
--   处理完成后即释放 —— 既防重复刷，又不阻断合理再举报。
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "reports_reporter_target_uidx"
  ON "reports" ("reporter_id", "target_type", "target_id")
  WHERE "status" = 'pending';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3) 「我的举报」列表按时间倒序
--
-- 已有 `reports_reporter_idx(reporter_id)`，但排序键是 created_at，
-- 需复合索引才能同时用于过滤与排序。
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "reports_reporter_created_idx"
  ON "reports" ("reporter_id", "created_at" DESC);--> statement-breakpoint
