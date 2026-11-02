-- 通用键值存储表（Redis 降级实现使用）
CREATE TABLE IF NOT EXISTS "kv_store" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kv_store_expires_at_idx" ON "kv_store" ("expires_at");