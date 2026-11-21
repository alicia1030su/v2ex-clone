#!/usr/bin/env bash
# v0.0.20 P0-B：真实 Docker 灾难恢复韧性演练。
# 只由 .github/workflows/v020-dr-resilience.yml 在 ubuntu runner 执行。
set -euo pipefail
umask 077

ROOT="${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"
: "${APP_PORT:=3000}"
: "${COMPOSE_PROJECT_NAME:=v2ex-dr}"

ENV_FILE="${ENV_FILE:-.env.dr}"
BASE_URL="${BASE_URL:-http://localhost:${APP_PORT}}"
EVIDENCE_FILE="${EVIDENCE_FILE:-/tmp/v020-dr-resilience.summary.md}"
COMPOSE=(docker compose --env-file "$ENV_FILE")
export COMPOSE_PROJECT_NAME

PASS=0; FAIL=0
DR_DEPLOY="/tmp/v020-dr-deploy"
DR_DEPLOY_BADAPP="/tmp/v020-dr-deploy-badapp"
TMPFS_MOUNT="/tmp/v020-dr-tmpfs"
NORMAL_BUNDLE="/tmp/v020-dr-normal.tar.gz"
LARGE_BUNDLE="/tmp/v020-dr-large.tar.gz"
MARK="v020dr-$(date +%s)-$$"

pass() { PASS=$((PASS+1)); printf '  PASS  %s\n' "$*"; }
fail() { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$*"; }
info() { printf '  %s\n' "$*"; }

psql_db() {
  "${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -t -A -c "$1" | tr -d '\r\n'
}

wait_ready() {
  local label="$1" code='000'
  for i in $(seq 1 90); do
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "${BASE_URL}/api/health/ready" 2>/dev/null || true)
    [ "$code" = "200" ] && { info "${label} 就绪（第 ${i} 次）"; return 0; }
    sleep 2
  done
  fail "${label} 未就绪（HTTP ${code}）"
  "${COMPOSE[@]}" logs --tail 100 app || true
  return 1
}

write_probe_file() {
  local rel="$1" bytes="${2:-1024}"
  "${COMPOSE[@]}" exec -T app sh -c \
    "mkdir -p \"/app/data/uploads/$(dirname "$rel")\" && head -c '$bytes' /dev/urandom > \"/app/data/uploads/$rel\""
}

echo '===== v0.0.20 P0-B 灾难恢复韧性演练 ====='
wait_ready '初始应用'

rm -rf "$DR_DEPLOY" "$DR_DEPLOY_BADAPP"
mkdir -p "$DR_DEPLOY"
cp -a deploy/. "$DR_DEPLOY/"
cp "$ENV_FILE" "$DR_DEPLOY/.env"
chmod 600 "$DR_DEPLOY/.env"

# 写入可验证的业务标识与真实附件引用。
OWNER_ID="$(psql_db "INSERT INTO users (username, password_hash) VALUES ('${MARK}_owner', 'x') RETURNING id")"
NODE_ID="$(psql_db "SELECT id FROM nodes ORDER BY id LIMIT 1")"
TOPIC_ID="$(psql_db "INSERT INTO topics (title, content, node_id, author_id) VALUES ('${MARK} topic', 'dr probe', ${NODE_ID}, ${OWNER_ID}) RETURNING id")"
REPLY_ID="$(psql_db "INSERT INTO replies (topic_id, author_id, floor, content) VALUES (${TOPIC_ID}, ${OWNER_ID}, 1, 'dr probe') RETURNING id")"
ATTACH_REL="replies/${OWNER_ID}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"
write_probe_file "$ATTACH_REL" 4096
IMAGE_ID="$(psql_db "INSERT INTO reply_images (user_id, storage_path, mime_type, size, width, height, state) VALUES (${OWNER_ID}, '${ATTACH_REL}', 'image/png', 4096, 1, 1, 'active') RETURNING id")"
psql_db "INSERT INTO reply_image_links (reply_id, attachment_id) VALUES (${REPLY_ID}, ${IMAGE_ID})" >/dev/null
info "标识=${MARK} owner=${OWNER_ID} attachment=${ATTACH_REL}"

fingerprint() {
  psql_db "SELECT count(*)||'|'||coalesce(md5(string_agg(id::text,',' ORDER BY id)),'') FROM users"
}

echo '===== [B1] 生成真实一致备份 ====='
rm -f "$NORMAL_BUNDLE" "$NORMAL_BUNDLE.sha256"
if (cd "$DR_DEPLOY" && bash backup.sh --output "$NORMAL_BUNDLE") >/tmp/v020-dr-backup.log 2>&1; then
  pass "backup.sh 产出一致 bundle（$(stat -c%s "$NORMAL_BUNDLE") 字节）"
else
  fail "backup.sh 失败"; tail -40 /tmp/v020-dr-backup.log; exit 1
fi
[ -s "$NORMAL_BUNDLE.sha256" ] && pass '外部 SHA256 sidecar 存在' || fail '缺少外部 SHA256 sidecar'

echo '===== [B2] PostgreSQL 断连：恢复必须在修改目标前失败 ====='
BEFORE_DB_OUTAGE="$(fingerprint)"
"${COMPOSE[@]}" stop postgres >/dev/null
set +e
(cd "$DR_DEPLOY" && bash restore.sh --yes "$NORMAL_BUNDLE") >/tmp/v020-dr-db-outage.log 2>&1
RC_DB_OUTAGE=$?
set -e
"${COMPOSE[@]}" start postgres >/dev/null
wait_ready 'PostgreSQL 恢复后'
AFTER_DB_OUTAGE="$(fingerprint)"
if [ "$RC_DB_OUTAGE" -ne 0 ]; then pass "DB 断连时 restore 返回非零（${RC_DB_OUTAGE}）"; else fail 'DB 断连时 restore 假成功'; fi
if [ "$BEFORE_DB_OUTAGE" = "$AFTER_DB_OUTAGE" ]; then pass 'DB 断连失败后业务指纹不变'; else fail 'DB 断连失败后业务指纹变化'; fi

echo '===== [B3] 磁盘不足：必须在切换前失败且目标不变 ====='
LARGE_REL="replies/${OWNER_ID}/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.bin"
write_probe_file "$LARGE_REL" $((48 * 1024 * 1024))
rm -f "$LARGE_BUNDLE" "$LARGE_BUNDLE.sha256"
if (cd "$DR_DEPLOY" && bash backup.sh --output "$LARGE_BUNDLE") >/tmp/v020-dr-large-backup.log 2>&1; then
  info "大 bundle=$(stat -c%s "$LARGE_BUNDLE") 字节"
else
  fail '大 bundle 备份失败'; tail -40 /tmp/v020-dr-large-backup.log; exit 1
fi
"${COMPOSE[@]}" exec -T app rm -f "/app/data/uploads/$LARGE_REL"

sudo mkdir -p "$TMPFS_MOUNT"
sudo mount -t tmpfs -o size=32m tmpfs "$TMPFS_MOUNT"
mkdir -p "$TMPFS_MOUNT/deploy"
cp -a deploy/. "$TMPFS_MOUNT/deploy/"
cp "$ENV_FILE" "$TMPFS_MOUNT/deploy/.env"
chmod 600 "$TMPFS_MOUNT/deploy/.env"
BEFORE_DISK="$(fingerprint)"
set +e
(cd "$TMPFS_MOUNT/deploy" && TMPDIR="$TMPFS_MOUNT" bash restore.sh --yes "$LARGE_BUNDLE") >/tmp/v020-dr-disk.log 2>&1
RC_DISK=$?
set -e
sudo umount "$TMPFS_MOUNT"
AFTER_DISK="$(fingerprint)"
if [ "$RC_DISK" -ne 0 ]; then pass "磁盘不足时 restore 返回非零（${RC_DISK}）"; else fail '磁盘不足时 restore 假成功'; fi
if [ "$BEFORE_DISK" = "$AFTER_DISK" ]; then pass '磁盘不足失败后业务指纹不变'; else fail '磁盘不足失败后业务指纹变化'; fi
if grep -qiE '磁盘空间不足|No space left|写.*失败|解压' /tmp/v020-dr-disk.log; then pass '失败原因指向磁盘/暂存空间'; else fail '磁盘不足失败原因不明确'; fi

echo '===== [B4] 卷切换后 SIGTERM：保留旧卷，不伪装跨资源原子回滚 ====='
cp -a "$DR_DEPLOY" "$DR_DEPLOY_BADAPP"
sed -i 's#^APP_URL=.*#APP_URL=http://127.0.0.1:9#' "$DR_DEPLOY_BADAPP/.env"
set +e
(cd "$DR_DEPLOY_BADAPP" && bash restore.sh --yes "$NORMAL_BUNDLE") >/tmp/v020-dr-sigterm.log 2>&1 &
RESTORE_PID=$!
set -e
SWITCHED=0
for _ in $(seq 1 120); do
  if grep -q '切换 uploads volume' /tmp/v020-dr-sigterm.log 2>/dev/null; then SWITCHED=1; break; fi
  sleep 1
done
if [ "$SWITCHED" -eq 1 ]; then
  pass '已观测到 uploads volume 切换点'
  kill -TERM "$RESTORE_PID" 2>/dev/null || true
else
  fail '未在时限内观测到 volume 切换点'
  kill -TERM "$RESTORE_PID" 2>/dev/null || true
fi
set +e
wait "$RESTORE_PID"
RC_SIGTERM=$?
set -e
if [ "$RC_SIGTERM" -ne 0 ]; then pass "SIGTERM 中断 restore 返回非零（${RC_SIGTERM}）"; else fail 'SIGTERM 后 restore 假成功'; fi
OLD_VOLUME_COUNT="$(docker volume ls --format '{{.Name}}' | grep -c "${COMPOSE_PROJECT_NAME}.*uploads-data.*pre-restore-" || true)"
if [ "$OLD_VOLUME_COUNT" -ge 1 ]; then pass "旧 uploads 卷被保留（${OLD_VOLUME_COUNT} 个）"; else fail '未找到保留的旧 uploads 卷'; fi
AFTER_SIGTERM="$(fingerprint)"
if [ "$AFTER_SIGTERM" = "$BEFORE_DISK" ]; then pass 'SIGTERM 后业务数据仍与备份一致'; else fail 'SIGTERM 后业务数据不一致'; fi

# 用正确 APP_URL 强制重建 app，再验证数据库与附件双向一致。
"${COMPOSE[@]}" up -d --force-recreate app >/dev/null
wait_ready 'SIGTERM 后恢复'
if (cd "$DR_DEPLOY" && bash reconcile-attachments.sh) >/tmp/v020-dr-reconcile.log 2>&1; then
  pass 'SIGTERM 后附件数据库/物理文件对账通过'
else
  fail 'SIGTERM 后附件对账失败'; cat /tmp/v020-dr-reconcile.log
fi

echo '===== [B5] Docker 守护进程重启后持久化 ====='
sudo systemctl restart docker
for _ in $(seq 1 60); do
  docker info >/dev/null 2>&1 && break
  sleep 2
done
docker info >/dev/null 2>&1 || { fail 'Docker 守护进程未恢复'; exit 1; }
"${COMPOSE[@]}" up -d >/dev/null
wait_ready 'Docker 重启后'
AFTER_DOCKER_RESTART="$(fingerprint)"
if [ "$AFTER_DOCKER_RESTART" = "$AFTER_SIGTERM" ]; then pass 'Docker 重启后业务指纹不变'; else fail 'Docker 重启后业务指纹变化'; fi
if (cd "$DR_DEPLOY" && bash reconcile-attachments.sh) >/tmp/v020-dr-reconcile-restart.log 2>&1; then
  pass 'Docker 重启后附件对账通过'
else
  fail 'Docker 重启后附件对账失败'; cat /tmp/v020-dr-reconcile-restart.log
fi

{
  echo '# v0.0.20 P0-B 灾难恢复韧性演练'
  echo
  echo "- Passed: ${PASS}"
  echo "- Failed: ${FAIL}"
  echo "- Marker: ${MARK}"
  echo
  echo '边界声明：PostgreSQL 恢复与 uploads Volume 切换不是跨资源原子事务；脚本只保证前置失败不触碰目标、切换失败回滚卷名、并保留旧卷供人工处置。'
  if [ "$FAIL" -eq 0 ]; then echo '结论：PASS'; else echo '结论：FAIL'; fi
} > "$EVIDENCE_FILE"
cat "$EVIDENCE_FILE"
[ "$FAIL" -eq 0 ]
