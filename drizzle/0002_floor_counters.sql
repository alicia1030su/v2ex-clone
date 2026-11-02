-- 楼层号原子分配器：每个主题一个计数器行，通过 UPSERT 原子递增
CREATE TABLE IF NOT EXISTS "floor_counters" (
	"topic_id" integer PRIMARY KEY NOT NULL,
	"last_floor" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- 用现有回复数据初始化计数
INSERT INTO floor_counters (topic_id, last_floor)
SELECT topic_id, coalesce(max(floor), 0) FROM replies GROUP BY topic_id
ON CONFLICT (topic_id) DO UPDATE SET last_floor = EXCLUDED.last_floor;