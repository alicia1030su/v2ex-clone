-- v0.0.20：附件当前引用关系、状态机与延迟清理队列。
-- 只做加法；reply_images.reply_id/used_at 保留历史归属，不再承担“当前引用”语义。

ALTER TABLE reply_images
  ADD COLUMN IF NOT EXISTS state varchar(16) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS purge_after timestamptz,
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

-- 条件式添加，避免 DROP CONSTRAINT IF EXISTS 在约束不存在时产生 NOTICE，
-- 从而被 drizzle-kit 误判为迁移失败。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'reply_images'::regclass
      AND conname = 'reply_images_state_check'
  ) THEN
    ALTER TABLE reply_images
      ADD CONSTRAINT reply_images_state_check
      CHECK (state IN ('active', 'superseded', 'deleted', 'purged'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS reply_image_links (
  reply_id integer NOT NULL REFERENCES replies(id) ON DELETE CASCADE,
  attachment_id integer NOT NULL REFERENCES reply_images(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reply_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS reply_image_links_attachment_idx
  ON reply_image_links (attachment_id, reply_id);

CREATE TABLE IF NOT EXISTS attachment_purge_queue (
  id serial PRIMARY KEY,
  storage_path varchar(256) NOT NULL UNIQUE,
  kind varchar(16) NOT NULL,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  purge_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by varchar(64),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachment_purge_queue_kind_check
    CHECK (kind IN ('avatar', 'reply_image'))
);

CREATE INDEX IF NOT EXISTS attachment_purge_queue_due_idx
  ON attachment_purge_queue (purge_after, id);

-- 保守回填：正文仍引用该 URL 的建立当前链接；有历史归属但正文无引用的
-- 先进入 superseded + 7 天宽限期，恢复后立即可访问性已经撤销。
INSERT INTO reply_image_links (reply_id, attachment_id)
SELECT r.id, ri.id
FROM reply_images ri
JOIN replies r ON r.id = ri.reply_id
WHERE r.deleted_at IS NULL
  AND r.author_id = ri.user_id
  AND position('```' in r.content) = 0
  AND position('~~~' in r.content) = 0
  AND r.content ~ ('!\[[^]]*\]\(/uploads/' || ri.storage_path || '\)')
ON CONFLICT (reply_id, attachment_id) DO NOTHING;

UPDATE reply_images ri
SET state = CASE
      WHEN EXISTS (
        SELECT 1 FROM reply_image_links l WHERE l.attachment_id = ri.id
      ) THEN 'active'
      WHEN ri.reply_id IS NOT NULL THEN 'superseded'
      ELSE 'active'
    END,
    purge_after = CASE
      WHEN EXISTS (
        SELECT 1 FROM reply_image_links l WHERE l.attachment_id = ri.id
      ) THEN NULL
      WHEN ri.reply_id IS NOT NULL THEN now() + interval '7 days'
      ELSE NULL
    END
WHERE ri.state = 'active';

INSERT INTO attachment_purge_queue (storage_path, kind, user_id, purge_after)
SELECT ri.storage_path, 'reply_image', ri.user_id, ri.purge_after
FROM reply_images ri
WHERE ri.state = 'superseded'
  AND ri.purge_after IS NOT NULL
ON CONFLICT (storage_path) DO NOTHING;
