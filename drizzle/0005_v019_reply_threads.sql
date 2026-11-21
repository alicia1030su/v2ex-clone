-- v0.0.19：回复父子关联、展示偏好、请求幂等与回复图片元数据
--
-- ## 兼容性
--
-- 本迁移只做加法：历史回复的 parent_reply_id / client_request_id 均为 NULL，
-- 楼层号、主题与回复正文完全不变；旧 API 客户端忽略新增字段即可继续工作。
--
-- ## 幂等性
--
-- 列、索引、表与约束全部可重复执行；触发器函数使用 CREATE OR REPLACE，
-- 触发器通过 pg_trigger 存在性检查后创建。重复执行不会丢数据。

ALTER TABLE replies ADD COLUMN IF NOT EXISTS parent_reply_id integer;--> statement-breakpoint
ALTER TABLE replies ADD COLUMN IF NOT EXISTS client_request_id varchar(64);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS replies_parent_topic_idx ON replies (topic_id, parent_reply_id, floor);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS replies_client_request_uidx
  ON replies (client_request_id) WHERE client_request_id IS NOT NULL;--> statement-breakpoint

DO $add_parent_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'replies_parent_reply_id_fkey'
      AND conrelid = 'replies'::regclass
  ) THEN
    ALTER TABLE replies
      ADD CONSTRAINT replies_parent_reply_id_fkey
      FOREIGN KEY (parent_reply_id) REFERENCES replies(id) ON DELETE SET NULL;
  END IF;
END
$add_parent_fk$;--> statement-breakpoint

DO $add_parent_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'replies_parent_not_self_check'
      AND conrelid = 'replies'::regclass
  ) THEN
    ALTER TABLE replies
      ADD CONSTRAINT replies_parent_not_self_check
      CHECK (parent_reply_id IS NULL OR parent_reply_id <> id);
  END IF;
END
$add_parent_check$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION v2ex_validate_reply_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_topic integer;
  cursor_id integer;
  depth integer := 0;
BEGIN
  IF NEW.parent_reply_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS NOT NULL AND NEW.parent_reply_id = NEW.id THEN
    RAISE EXCEPTION '回复不能引用自己';
  END IF;

  SELECT topic_id INTO parent_topic FROM replies WHERE id = NEW.parent_reply_id;
  IF parent_topic IS NULL THEN
    RAISE EXCEPTION '父回复不存在';
  END IF;
  IF parent_topic <> NEW.topic_id THEN
    RAISE EXCEPTION '父回复必须属于同一主题';
  END IF;

  -- 纵深保护：API 不允许修改 parent_reply_id，但数据库层仍拒绝任何
  -- 人工更新构造出的环，并限制单次校验成本。
  cursor_id := NEW.parent_reply_id;
  WHILE cursor_id IS NOT NULL LOOP
    IF NEW.id IS NOT NULL AND cursor_id = NEW.id THEN
      RAISE EXCEPTION '回复父子关系不能成环';
    END IF;
    SELECT parent_reply_id, topic_id INTO cursor_id, parent_topic
      FROM replies WHERE id = cursor_id;
    IF parent_topic IS NOT NULL AND parent_topic <> NEW.topic_id THEN
      RAISE EXCEPTION '父回复必须属于同一主题';
    END IF;
    depth := depth + 1;
    IF depth > 10000 THEN
      RAISE EXCEPTION '回复父子链过深';
    END IF;
  END LOOP;

  RETURN NEW;
END
$function$;--> statement-breakpoint

DO $add_parent_trigger$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'replies_validate_parent_trigger'
      AND tgrelid = 'replies'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER replies_validate_parent_trigger
      BEFORE INSERT OR UPDATE OF parent_reply_id, topic_id ON replies
      FOR EACH ROW EXECUTE FUNCTION v2ex_validate_reply_parent();
  END IF;
END
$add_parent_trigger$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reply_display_mode varchar(16) NOT NULL DEFAULT 'classic',
  theme_preference varchar(16) NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_preferences_reply_display_mode_check
    CHECK (reply_display_mode IN ('classic', 'quote', 'badge', 'nested', 'tree', 'lines', 'excerpt')),
  CONSTRAINT user_preferences_theme_preference_check
    CHECK (theme_preference IN ('light', 'dark', 'system'))
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS reply_images (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_id integer REFERENCES replies(id) ON DELETE SET NULL,
  storage_path varchar(256) NOT NULL,
  original_name varchar(255),
  mime_type varchar(64) NOT NULL,
  size integer NOT NULL,
  width integer,
  height integer,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS reply_images_storage_path_uidx
  ON reply_images (storage_path);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reply_images_user_created_idx
  ON reply_images (user_id, created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reply_images_reply_idx
  ON reply_images (reply_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reply_images_unused_created_idx
  ON reply_images (created_at) WHERE used_at IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS rate_limit_sliding_hits (
  id serial PRIMARY KEY,
  key varchar(255) NOT NULL,
  hit_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rate_limit_sliding_key_time_idx
  ON rate_limit_sliding_hits (key, hit_at);
