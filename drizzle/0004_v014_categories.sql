-- v0.0.14：分类管理链路补齐
--
-- ## 为什么需要这次迁移
--
-- `categories` 表从 v0.0.1 起就存在，`/nodes` 页面也按分类分组展示节点，
-- 但**生产代码里没有任何写入落点**（只有 `scripts/seed.ts`）——
-- 真实部署中管理员无法创建 / 改名 / 排序 / 禁用分类，
-- 属于「表与页面齐全、管理链路不通」的缺口。
--
-- 本次迁移只做**加法**（新增列 + 索引），不删除、不改名任何既有列，
-- 因此对 v0.0.13 及更早的库是**可直接升级**的。
--
-- ## 幂等性
--
-- 全部 `IF NOT EXISTS`，重复执行不会报错 —— 现场手工补迁移时不至于炸库。
--
-- ## 刻意不做的两件事
--
-- 1. **不给 `name` 加唯一索引**：历史数据可能已有重名分类（各环境由不同
--    版本的 seed 写入），加唯一索引会让升级迁移**直接失败**。
--    并发创建由 `src/server/categories.ts` 的 `pg_advisory_xact_lock`
--    串行化 + 应用层查重保证。
-- 2. **不做任何回填 UPDATE**：`hidden` 默认 false 正是期望的「全部启用」语义；
--    `updated_at` 默认 now() 使存量行的时间戳即升级时刻，语义上可接受
--    （真正的历史变更时间在 moderation_logs 审计日志里）。

ALTER TABLE categories ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();--> statement-breakpoint
CREATE INDEX IF NOT EXISTS categories_sort_idx ON categories (sort, id);
