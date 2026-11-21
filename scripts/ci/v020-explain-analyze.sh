#!/usr/bin/env bash
# v0.0.20 P1：真实 PostgreSQL EXPLAIN ANALYZE 与索引取证。
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"
: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"
ENV_FILE="${ENV_FILE:-.env.perf}"
COMPOSE=(docker compose --env-file "$ENV_FILE")

psql_db() {
  "${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 "$@"
}

echo '===== 构造 10000 回复容量夹具 ====='
TOPIC_ID="$(psql_db -q -t -A -c "INSERT INTO topics (title, content, node_id, author_id) SELECT 'v020 perf topic', 'perf', (SELECT id FROM nodes ORDER BY id LIMIT 1), (SELECT id FROM users ORDER BY id LIMIT 1) RETURNING id" | tr -d '\r\n')"
[ -n "$TOPIC_ID" ] || { echo '无法创建性能主题' >&2; exit 1; }
psql_db -q -c "
  INSERT INTO replies (topic_id, author_id, content, floor, parent_reply_id)
  SELECT ${TOPIC_ID}, (SELECT id FROM users ORDER BY id LIMIT 1),
    'v020 performance reply ' || g, g,
    CASE WHEN g = 5001 THEN 1 ELSE NULL END
  FROM generate_series(1, 10000) AS g;
  UPDATE topics SET replies_count = 10000 WHERE id = ${TOPIC_ID};
"

echo '===== 父链/楼中楼查询计划 ====='
PARENT_PLAN="$(psql_db -q -c "
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT id, floor, content, deleted_at, created_at, author_id
  FROM replies
  WHERE topic_id = ${TOPIC_ID}
    AND parent_reply_id = 1
    AND deleted_at IS NULL
  ORDER BY floor
  LIMIT 20;
")"
printf '%s\n' "$PARENT_PLAN"
printf '%s\n' "$PARENT_PLAN" | grep -q 'replies_parent_topic_idx' \
  || { echo '父链查询未使用 replies_parent_topic_idx' >&2; exit 1; }

echo '===== 跨页列表查询计划 ====='
LIST_PLAN="$(psql_db -q -c "
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT r.id, r.floor, r.content
  FROM replies r
  JOIN topics t ON t.id = r.topic_id
  JOIN nodes n ON n.id = t.node_id
  WHERE r.topic_id = ${TOPIC_ID}
    AND r.deleted_at IS NULL
    AND t.status = 'published'
    AND t.deleted_at IS NULL
    AND n.status = 'active'
  ORDER BY r.floor
  LIMIT 20 OFFSET 5000;
")"
printf '%s\n' "$LIST_PLAN"

echo '===== purge queue 到期索引计划 ====='
psql_db -q -c "
  INSERT INTO attachment_purge_queue (storage_path, kind, user_id, purge_after)
  SELECT 'replies/0/v020perf' || g || '.png', 'reply_image', NULL, now() - interval '1 minute'
  FROM generate_series(1, 1000) AS g
  ON CONFLICT (storage_path) DO NOTHING;
"
QUEUE_PLAN="$(psql_db -q -c "
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT id, storage_path, kind
  FROM attachment_purge_queue
  WHERE purge_after <= now()
    AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')
  ORDER BY purge_after, id
  LIMIT 200;
")"
printf '%s\n' "$QUEUE_PLAN"
printf '%s\n' "$QUEUE_PLAN" | grep -q 'attachment_purge_queue_due_idx' \
  || { echo 'purge queue 未使用 attachment_purge_queue_due_idx' >&2; exit 1; }
psql_db -q -c "DELETE FROM attachment_purge_queue WHERE storage_path LIKE 'replies/0/v020perf%';"

echo 'EXPLAIN_ANALYZE=PASS'
