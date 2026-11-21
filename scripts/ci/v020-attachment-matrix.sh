#!/usr/bin/env bash
# v0.0.20 P0-A：真实生产容器内的附件授权攻击矩阵。
# 只能由 .github/workflows/v020-attachment-matrix.yml 在 ubuntu runner 上执行。
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
: "${APP_PORT:=3000}"

ENV_FILE="${ENV_FILE:-.env.matrix}"
BASE_URL="${BASE_URL:-http://localhost:${APP_PORT}}"
PROXY_URL="${PROXY_URL:-http://localhost:8080}"
EVIDENCE_FILE="${EVIDENCE_FILE:-/tmp/v020-attachment-matrix.summary.md}"
COMPOSE=(docker compose --env-file "$ENV_FILE")

PASS=0
FAIL=0
PROXY_STARTED=0

cleanup() {
  if [ "$PROXY_STARTED" = "1" ]; then
    docker rm -f v2ex-matrix-proxy >/dev/null 2>&1 || true
  fi
  rm -f /tmp/v020-nginx.conf /tmp/v020-headers.$$ /tmp/v020-body.$$
}
trap cleanup EXIT

psql_exec() {
  "${COMPOSE[@]}" exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"
}

psql_value() {
  # -q 必须显式加上：psql 对 INSERT ... RETURNING 在 -t -A 下仍会输出
  # “INSERT 0 1”命令标签；不静默就会把它误当成 ID 拼进下一条 SQL。
  psql_exec -q -t -A -c "$1" | tr -d '\r\n'
}

wait_app_ready() {
  local label="$1"
  local code='000'
  for i in $(seq 1 90); do
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL}/api/health/ready" 2>/dev/null || true)
    if [ "$code" = "200" ]; then
      echo "  ✓ ${label} 就绪（第 ${i} 次探活）"
      return 0
    fi
    sleep 2
  done
  echo "  ✗ ${label} 未就绪（HTTP ${code}）"
  "${COMPOSE[@]}" logs --tail 120 app || true
  return 1
}

probe() {
  local label="$1"
  local expected="$2"
  local url="$3"
  local cookie="${4:-}"
  local expected_cache="${5:-}"
  local headers="/tmp/v020-headers.$$"
  local body="/tmp/v020-body.$$"
  local code='000'
  local cache=''

  if [ -n "$cookie" ]; then
    code=$(curl -sS --max-time 20 -D "$headers" -o "$body" -w '%{http_code}' \
      -H "Cookie: v2_session=${cookie}" "$url" 2>/dev/null || true)
  else
    code=$(curl -sS --max-time 20 -D "$headers" -o "$body" -w '%{http_code}' \
      "$url" 2>/dev/null || true)
  fi
  cache=$(sed -n 's/^[Cc]ache-[Cc]ontrol:[[:space:]]*//p' "$headers" | tr -d '\r' | tail -1)

  if [ "$code" = "$expected" ] && { [ -z "$expected_cache" ] || [ "$cache" = "$expected_cache" ]; }; then
    printf '  PASS  %-44s HTTP=%s cache=%s\n' "$label" "$code" "${cache:-<none>}"
    PASS=$((PASS + 1))
  else
    printf '  FAIL  %-44s HTTP=%s (expected %s) cache=%s (expected %s)\n' \
      "$label" "$code" "$expected" "${cache:-<none>}" "${expected_cache:-<any>}"
    FAIL=$((FAIL + 1))
  fi
}

write_upload() {
  local rel="$1"
  "${COMPOSE[@]}" exec -T app sh -c \
    "mkdir -p \"/app/data/uploads/$(dirname "$rel")\" && printf %s probe > \"/app/data/uploads/$rel\""
}

echo '===== v0.0.20 P0-A 附件授权攻击矩阵 ====='
echo "BASE_URL=${BASE_URL}"
echo "PROXY_URL=${PROXY_URL}"

wait_app_ready '初始应用'

echo '===== [A1] 镜像与 Compose 静态边界 ====='
if "${COMPOSE[@]}" exec -T app test ! -e /app/public/uploads; then
  echo '  PASS  镜像运行层不存在 /app/public/uploads'
  PASS=$((PASS + 1))
else
  echo '  FAIL  镜像运行层存在 /app/public/uploads'
  FAIL=$((FAIL + 1))
fi

MOUNTS=$(docker inspect v2ex-app --format '{{json .Mounts}}')
if printf '%s' "$MOUNTS" | grep -q '"Destination":"/app/data/uploads"'; then
  echo '  PASS  uploads-data 挂载到 /app/data/uploads'
  PASS=$((PASS + 1))
else
  echo "  FAIL  uploads-data 未挂载到私有路径：${MOUNTS}"
  FAIL=$((FAIL + 1))
fi
if printf '%s' "$MOUNTS" | grep -q '"Destination":"/app/public/uploads"'; then
  echo '  FAIL  uploads-data 仍挂载到 /app/public/uploads'
  FAIL=$((FAIL + 1))
else
  echo '  PASS  uploads-data 未挂载到 /app/public/uploads'
  PASS=$((PASS + 1))
fi
if "${COMPOSE[@]}" exec -T app sh -c 'test ! -w /app/public'; then
  echo '  PASS  非 root 运行用户不能写入 /app/public'
  PASS=$((PASS + 1))
else
  echo '  FAIL  非 root 运行用户可写入 /app/public'
  FAIL=$((FAIL + 1))
fi

echo '===== [A2] 构造真实数据库与文件夹具 ====='
psql_exec <<'SQL'
BEGIN;
DELETE FROM sessions WHERE id IN ('v020-owner-session', 'v020-other-session');
DELETE FROM attachment_purge_queue
WHERE user_id IN (SELECT id FROM users WHERE username IN ('v020matrix_owner', 'v020matrix_other'));
DELETE FROM reply_image_links
WHERE attachment_id IN (
  SELECT id FROM reply_images
  WHERE user_id IN (SELECT id FROM users WHERE username IN ('v020matrix_owner', 'v020matrix_other'))
);
DELETE FROM reply_images
WHERE user_id IN (SELECT id FROM users WHERE username IN ('v020matrix_owner', 'v020matrix_other'));
DELETE FROM avatars
WHERE user_id IN (SELECT id FROM users WHERE username IN ('v020matrix_owner', 'v020matrix_other'));
DELETE FROM replies
WHERE author_id IN (SELECT id FROM users WHERE username IN ('v020matrix_owner', 'v020matrix_other'));
DELETE FROM topics
WHERE author_id IN (SELECT id FROM users WHERE username IN ('v020matrix_owner', 'v020matrix_other'));
DELETE FROM nodes WHERE name IN ('v020matrix_public', 'v020matrix_hidden');
DELETE FROM categories WHERE name = 'v020matrix_cat';
DELETE FROM users WHERE username IN ('v020matrix_owner', 'v020matrix_other');
COMMIT;
SQL

OWNER_ID=$(psql_value "INSERT INTO users (username, email, password_hash) VALUES ('v020matrix_owner', 'v020matrix_owner@example.invalid', 'x') RETURNING id")
OTHER_ID=$(psql_value "INSERT INTO users (username, email, password_hash) VALUES ('v020matrix_other', 'v020matrix_other@example.invalid', 'x') RETURNING id")
CATEGORY_ID=$(psql_value "INSERT INTO categories (name, title) VALUES ('v020matrix_cat', 'V020 Matrix') RETURNING id")
PUBLIC_NODE_ID=$(psql_value "INSERT INTO nodes (name, title, category_id, status) VALUES ('v020matrix_public', 'V020 Public', ${CATEGORY_ID}, 'active') RETURNING id")
HIDDEN_NODE_ID=$(psql_value "INSERT INTO nodes (name, title, category_id, status) VALUES ('v020matrix_hidden', 'V020 Hidden', ${CATEGORY_ID}, 'hidden') RETURNING id")

PUBLIC_TOPIC_ID=$(psql_value "INSERT INTO topics (title, content, node_id, author_id, status) VALUES ('v020 matrix public', 'probe', ${PUBLIC_NODE_ID}, ${OWNER_ID}, 'published') RETURNING id")
HIDDEN_TOPIC_ID=$(psql_value "INSERT INTO topics (title, content, node_id, author_id, status) VALUES ('v020 matrix hidden', 'probe', ${HIDDEN_NODE_ID}, ${OWNER_ID}, 'published') RETURNING id")
LOCKED_TOPIC_ID=$(psql_value "INSERT INTO topics (title, content, node_id, author_id, status) VALUES ('v020 matrix locked', 'probe', ${PUBLIC_NODE_ID}, ${OWNER_ID}, 'locked') RETURNING id")

PUBLIC_REPLY_ID=$(psql_value "INSERT INTO replies (topic_id, author_id, floor, content) VALUES (${PUBLIC_TOPIC_ID}, ${OWNER_ID}, 1, 'public probe') RETURNING id")
SOFT_REPLY_ID=$(psql_value "INSERT INTO replies (topic_id, author_id, floor, content, deleted_at) VALUES (${PUBLIC_TOPIC_ID}, ${OWNER_ID}, 2, 'soft deleted probe', now()) RETURNING id")
HIDDEN_REPLY_ID=$(psql_value "INSERT INTO replies (topic_id, author_id, floor, content) VALUES (${HIDDEN_TOPIC_ID}, ${OWNER_ID}, 1, 'hidden node probe') RETURNING id")
LOCKED_REPLY_ID=$(psql_value "INSERT INTO replies (topic_id, author_id, floor, content) VALUES (${LOCKED_TOPIC_ID}, ${OWNER_ID}, 1, 'locked topic probe') RETURNING id")

PENDING_PATH="replies/${OWNER_ID}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"
ACTIVE_PATH="replies/${OWNER_ID}/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png"
SUPERSEDED_PATH="replies/${OWNER_ID}/cccccccccccccccccccccccccccccccc.png"
SOFT_PATH="replies/${OWNER_ID}/dddddddddddddddddddddddddddddddd.png"
HIDDEN_PATH="replies/${OWNER_ID}/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png"
LOCKED_PATH="replies/${OWNER_ID}/ffffffffffffffffffffffffffffffff.png"
DELETED_PATH="replies/${OWNER_ID}/11111111111111111111111111111111.png"
PURGED_PATH="replies/${OWNER_ID}/22222222222222222222222222222222.png"
CURRENT_AVATAR="avatars/${OWNER_ID}/33333333333333333333333333333333.png"
OLD_AVATAR="avatars/${OWNER_ID}/44444444444444444444444444444444.png"

for rel in \
  "$PENDING_PATH" "$ACTIVE_PATH" "$SUPERSEDED_PATH" "$SOFT_PATH" \
  "$HIDDEN_PATH" "$LOCKED_PATH" "$DELETED_PATH" "$PURGED_PATH" \
  "$CURRENT_AVATAR" "$OLD_AVATAR"; do
  write_upload "$rel"
done

psql_exec <<SQL
INSERT INTO sessions (id, user_id, expires_at) VALUES
  ('v020-owner-session', ${OWNER_ID}, now() + interval '1 day'),
  ('v020-other-session', ${OTHER_ID}, now() + interval '1 day');

INSERT INTO reply_images
  (user_id, storage_path, mime_type, size, width, height, state, purged_at)
VALUES
  (${OWNER_ID}, '${PENDING_PATH}', 'image/png', 5, 1, 1, 'active', NULL),
  (${OWNER_ID}, '${ACTIVE_PATH}', 'image/png', 5, 1, 1, 'active', NULL),
  (${OWNER_ID}, '${SUPERSEDED_PATH}', 'image/png', 5, 1, 1, 'superseded', NULL),
  (${OWNER_ID}, '${SOFT_PATH}', 'image/png', 5, 1, 1, 'active', NULL),
  (${OWNER_ID}, '${HIDDEN_PATH}', 'image/png', 5, 1, 1, 'active', NULL),
  (${OWNER_ID}, '${LOCKED_PATH}', 'image/png', 5, 1, 1, 'active', NULL),
  (${OWNER_ID}, '${DELETED_PATH}', 'image/png', 5, 1, 1, 'deleted', NULL),
  (${OWNER_ID}, '${PURGED_PATH}', 'image/png', 5, 1, 1, 'purged', now());

INSERT INTO reply_image_links (reply_id, attachment_id)
SELECT ${PUBLIC_REPLY_ID}, id FROM reply_images WHERE storage_path IN ('${ACTIVE_PATH}', '${SUPERSEDED_PATH}', '${DELETED_PATH}', '${PURGED_PATH}');
INSERT INTO reply_image_links (reply_id, attachment_id)
SELECT ${SOFT_REPLY_ID}, id FROM reply_images WHERE storage_path = '${SOFT_PATH}';
INSERT INTO reply_image_links (reply_id, attachment_id)
SELECT ${HIDDEN_REPLY_ID}, id FROM reply_images WHERE storage_path = '${HIDDEN_PATH}';
INSERT INTO reply_image_links (reply_id, attachment_id)
SELECT ${LOCKED_REPLY_ID}, id FROM reply_images WHERE storage_path = '${LOCKED_PATH}';

INSERT INTO avatars (user_id, storage_path, mime_type, size, width, height) VALUES
  (${OWNER_ID}, '${CURRENT_AVATAR}', 'image/png', 5, 1, 1),
  (${OWNER_ID}, '${OLD_AVATAR}', 'image/png', 5, 1, 1);
UPDATE users SET avatar = '/uploads/${CURRENT_AVATAR}' WHERE id = ${OWNER_ID};
SQL

echo "  owner_id=${OWNER_ID} other_id=${OTHER_ID}"

echo '===== [A3] 启动真实反向代理 ====='
NETWORK=$(docker inspect v2ex-app --format '{{range $name,$_ := .NetworkSettings.Networks}}{{$name}}{{end}}')
cat > /tmp/v020-nginx.conf <<'NGINX'
server {
  listen 80;
  location / {
    proxy_pass http://v2ex-app:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Cookie $http_cookie;
  }
}
NGINX
docker run -d --name v2ex-matrix-proxy --network "$NETWORK" \
  -p 8080:80 -v /tmp/v020-nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:1.27-alpine >/dev/null
PROXY_STARTED=1
for i in $(seq 1 30); do
  PROXY_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "${PROXY_URL}/api/health/ready" 2>/dev/null || true)
  [ "$PROXY_CODE" = "200" ] && break
  sleep 1
done
if [ "$PROXY_CODE" = "200" ]; then
  echo '  PASS  Nginx 反向代理可用'
  PASS=$((PASS + 1))
else
  echo "  FAIL  Nginx 反向代理未就绪（HTTP ${PROXY_CODE}）"
  docker ps -a --filter name=v2ex-matrix-proxy --format '  state={{.Status}} ports={{.Ports}}' || true
  docker logs --tail 80 v2ex-matrix-proxy 2>&1 || true
  FAIL=$((FAIL + 1))
fi

echo '===== [A4] 直接访问授权矩阵 ====='
probe 'current avatar / anonymous' 200 "${BASE_URL}/uploads/${CURRENT_AVATAR}" '' 'public, max-age=60, must-revalidate'
probe 'current avatar / other user' 200 "${BASE_URL}/uploads/${CURRENT_AVATAR}" 'v020-other-session' 'public, max-age=60, must-revalidate'
probe 'old avatar / owner' 404 "${BASE_URL}/uploads/${OLD_AVATAR}" 'v020-owner-session'

probe 'pending / owner' 200 "${BASE_URL}/uploads/${PENDING_PATH}" 'v020-owner-session' 'private, no-store'
probe 'pending / other user' 404 "${BASE_URL}/uploads/${PENDING_PATH}" 'v020-other-session'
probe 'pending / anonymous' 404 "${BASE_URL}/uploads/${PENDING_PATH}"

probe 'active public / anonymous' 200 "${BASE_URL}/uploads/${ACTIVE_PATH}" '' 'public, max-age=60, must-revalidate'
probe 'active public / other user' 200 "${BASE_URL}/uploads/${ACTIVE_PATH}" 'v020-other-session' 'public, max-age=60, must-revalidate'
probe 'superseded stale link / owner' 200 "${BASE_URL}/uploads/${SUPERSEDED_PATH}" 'v020-owner-session' 'private, no-store'
probe 'superseded stale link / anonymous' 404 "${BASE_URL}/uploads/${SUPERSEDED_PATH}"
probe 'soft-deleted reply / owner' 200 "${BASE_URL}/uploads/${SOFT_PATH}" 'v020-owner-session' 'private, no-store'
probe 'soft-deleted reply / anonymous' 404 "${BASE_URL}/uploads/${SOFT_PATH}"
probe 'hidden node / owner' 200 "${BASE_URL}/uploads/${HIDDEN_PATH}" 'v020-owner-session' 'private, no-store'
probe 'hidden node / anonymous' 404 "${BASE_URL}/uploads/${HIDDEN_PATH}"
probe 'locked topic / owner' 200 "${BASE_URL}/uploads/${LOCKED_PATH}" 'v020-owner-session' 'private, no-store'
probe 'locked topic / anonymous' 404 "${BASE_URL}/uploads/${LOCKED_PATH}"
probe 'deleted / owner' 404 "${BASE_URL}/uploads/${DELETED_PATH}" 'v020-owner-session'
probe 'purged / anonymous' 404 "${BASE_URL}/uploads/${PURGED_PATH}"

echo '===== [A5] 反向代理授权一致性 ====='
probe 'proxy active public / anonymous' 200 "${PROXY_URL}/uploads/${ACTIVE_PATH}" '' 'public, max-age=60, must-revalidate'
probe 'proxy pending / owner cookie' 200 "${PROXY_URL}/uploads/${PENDING_PATH}" 'v020-owner-session' 'private, no-store'
probe 'proxy pending / anonymous' 404 "${PROXY_URL}/uploads/${PENDING_PATH}"
probe 'proxy superseded / anonymous' 404 "${PROXY_URL}/uploads/${SUPERSEDED_PATH}"

echo '===== [A6] Next 图片优化器不得缓存或绕过附件授权 ====='
ACTIVE_OPT_URL="${BASE_URL}/_next/image?url=%2Fuploads%2Freplies%2F${OWNER_ID}%2Fbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png&w=640&q=75"
PENDING_OPT_URL="${BASE_URL}/_next/image?url=%2Fuploads%2Freplies%2F${OWNER_ID}%2Faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png&w=640&q=75"
probe 'next/image active attachment' 404 "$ACTIVE_OPT_URL"
probe 'next/image pending attachment' 404 "$PENDING_OPT_URL" 'v020-owner-session'

echo '===== [A7] 重启后授权与卷仍一致 ====='
"${COMPOSE[@]}" restart app >/dev/null
wait_app_ready '重启后应用'
probe 'restart active public / anonymous' 200 "${BASE_URL}/uploads/${ACTIVE_PATH}" '' 'public, max-age=60, must-revalidate'
probe 'restart pending / anonymous' 404 "${BASE_URL}/uploads/${PENDING_PATH}"
probe 'restart pending / owner' 200 "${BASE_URL}/uploads/${PENDING_PATH}" 'v020-owner-session' 'private, no-store'

echo '===== [A8] 静态 public/uploads 负向对照（测试后立即删除） ====='
CANARY_REL="replies/${OWNER_ID}/deadbeefdeadbeefdeadbeefdeadbeef.png"
"${COMPOSE[@]}" exec -u root -T app sh -c \
  "mkdir -p '/app/public/uploads/$(dirname "$CANARY_REL")' && printf %s canary > '/app/public/uploads/$CANARY_REL'"
"${COMPOSE[@]}" restart app >/dev/null
wait_app_ready '静态 canary 重启后应用'
probe 'public canary is statically visible (sensitivity)' 200 "${BASE_URL}/uploads/${CANARY_REL}"

"${COMPOSE[@]}" exec -u root -T app sh -c \
  "rm -f '/app/public/uploads/$CANARY_REL' && rmdir '/app/public/uploads/$(dirname "$CANARY_REL")' 2>/dev/null || true"
"${COMPOSE[@]}" restart app >/dev/null
wait_app_ready '删除 canary 后应用'
probe 'removed canary is no longer visible' 404 "${BASE_URL}/uploads/${CANARY_REL}"
probe 'post-canary active attachment still authorized' 200 "${BASE_URL}/uploads/${ACTIVE_PATH}" '' 'public, max-age=60, must-revalidate'

{
  echo '# v0.0.20 P0-A 附件授权攻击矩阵'
  echo
  echo "- Base URL: ${BASE_URL}"
  echo "- Proxy URL: ${PROXY_URL}"
  echo "- Passed: ${PASS}"
  echo "- Failed: ${FAIL}"
  echo
  if [ "$FAIL" -eq 0 ]; then
    echo '结论：PASS —— 直接路由、Next 图片优化器与反向代理均未发现附件授权绕过。'
  else
    echo '结论：FAIL —— 存在未闭合的附件授权或静态资源边界。'
  fi
} > "$EVIDENCE_FILE"
cat "$EVIDENCE_FILE"

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
