#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.20 — 一致恢复脚本
#
# 用法：
#   ./restore.sh                                  # 恢复最新一致备份
#   ./restore.sh backups/v2ex-backup-....tar.gz
#   ./restore.sh --yes <bundle>                   # CI / 无人值守
#   ./restore.sh --force <bundle>                 # 允许覆盖已有数据 / 恢复较新备份
#   ./restore.sh --restore-env <bundle>           # 同时恢复 bundle 内的 .env
#
# 安全顺序：
#   1. 校验外层 gzip/tar、路径遍历、符号链接、外部 SHA256。
#   2. 解到 700 临时目录，校验 bundle 内 SHA256SUMS。
#   3. 校验数据库 gzip、uploads gzip/tar 与逐文件 SHA256 清单。
#   4. 校验版本兼容性与磁盘空间。
#   5. 若目标已有数据，先自动生成 pre-restore 安全备份。
#   6. 单事务恢复 PostgreSQL；uploads 先恢复到新 named volume 并复核。
#   7. 仅在新卷校验通过后切换 volume 名称，再启动 app 并做恢复后核验。
#
# 注意：bundle 内含明文凭据，必须保持 600 权限并安全存储。
# ---------------------------------------------------------------------------
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
BACKUP_DIR="$SCRIPT_DIR/backups"
VERSION_FILE="$SCRIPT_DIR/VERSION"
FORCE=0
ASSUME_YES=0
RESTORE_ENV=0
BUNDLE=""

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_BLU=$'\033[34m'; C_YEL=$'\033[33m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_BLU=''; C_YEL=''; C_BLD=''; C_RST=''
fi
info() { printf '%s[信息]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()   { printf '%s[成功]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { printf '%s[警告]%s %s\n' "$C_YEL" "$C_RST" "$*" >&2; }
die()  { printf '%s[错误]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'EOF'
用法：
  ./restore.sh [--yes] [--force] [--restore-env] [bundle.tar.gz]

  --yes          跳过交互确认（CI 使用）
  --force        允许覆盖已有数据；允许恢复比当前部署更新的备份
  --restore-env  同时用 bundle 内 .env 覆盖当前 .env（默认不覆盖）
EOF
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1; shift ;;
    --force) FORCE=1; shift ;;
    --restore-env) RESTORE_ENV=1; shift ;;
    -h|--help) usage ;;
    -*) die "未知参数：$1" ;;
    *)
      [ -z "$BUNDLE" ] || die "只能指定一个备份 bundle。"
      BUNDLE="$1"
      shift
      ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "未检测到 docker 命令。"
command -v gzip >/dev/null 2>&1 || die "未检测到 gzip。"
command -v tar >/dev/null 2>&1 || die "未检测到 tar。"
docker compose version >/dev/null 2>&1 || die "未检测到 Docker Compose v2。"
[ -f "$ENV_FILE" ] || die "未找到 .env 配置。请先完成目标主机安装。"
[ -f "$VERSION_FILE" ] || die "未找到 VERSION 文件。"

mkdir -p "$BACKUP_DIR"
[ ! -L "$BACKUP_DIR" ] || die "备份目录不能是符号链接：$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" || die "无法将备份目录权限设为 700：$BACKUP_DIR"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$BACKUP_DIR/.restore.lock"
  flock -n 9 || die "已有另一个恢复进程正在运行。"
fi

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}
POSTGRES_USER="$(read_env_value POSTGRES_USER)"
POSTGRES_USER="${POSTGRES_USER:-v2ex}"
POSTGRES_DB="$(read_env_value POSTGRES_DB)"
POSTGRES_DB="${POSTGRES_DB:-v2ex}"
CURRENT_VERSION="$(tr -d ' \r\n' < "$VERSION_FILE")"

if [ -z "$BUNDLE" ]; then
  BUNDLE="$(ls -1t "$BACKUP_DIR"/v2ex-backup-*.tar.gz 2>/dev/null | head -n 1 || true)"
  [ -n "$BUNDLE" ] || die "在 ${BACKUP_DIR} 下找不到 v2ex-backup-*.tar.gz。"
  info "未指定 bundle，使用最新备份：${BUNDLE}"
fi
[ -f "$BUNDLE" ] || die "备份 bundle 不存在：${BUNDLE}"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

validate_tar_archive() {
  local archive="$1" label="$2"
  gzip -t "$archive" 2>/dev/null || die "${label} gzip 结构损坏。"
  if tar -tzf "$archive" | awk '
      { entry=$0; sub(/^\.\//, "", entry); if (entry == "") next
        if (entry ~ /^\// || entry == ".." || entry ~ /(^|\/)\.\.(\/|$)/) bad=1 }
      END { exit bad ? 1 : 0 }'; then
    :
  else
    die "${label} 包含绝对路径或 .. 路径穿越。"
  fi
  if tar -tvzf "$archive" | awk 'substr($1,1,1) ~ /^[lhcbps]$/ { bad=1 } END { exit bad ? 1 : 0 }'; then
    :
  else
    die "${label} 包含符号链接、硬链接、设备或 FIFO。"
  fi
}

version_number() {
  local v="$1" a b c
  IFS=. read -r a b c <<EOF
$v
EOF
  a="${a:-0}"; b="${b:-0}"; c="${c:-0}"
  case "$a$b$c" in
    ''|*[!0-9]*) return 1 ;;
  esac
  printf '%s' "$((a * 1000000 + b * 1000 + c))"
}

validate_tar_archive "$BUNDLE" "备份 bundle"
BUNDLE_SHA="$(sha256_file "$BUNDLE")"
SHA_SIDECAR="${BUNDLE}.sha256"
if [ -f "$SHA_SIDECAR" ]; then
  EXPECTED_BUNDLE_SHA="$(awk 'NR==1 {print $1}' "$SHA_SIDECAR")"
  [ "$EXPECTED_BUNDLE_SHA" = "$BUNDLE_SHA" ] || die "备份 bundle 外部 SHA256 不匹配。"
  ok "外部 SHA256 校验通过。"
elif [ "$FORCE" -eq 1 ]; then
  warn "缺少 .sha256 sidecar；--force 下继续，但完整性保护降级。"
else
  die "缺少 ${SHA_SIDECAR}；拒绝恢复。可使用 --force 显式降级。"
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/v2ex-restore.XXXXXX")"
chmod 700 "$STAGE"
APP_WAS_PRESENT=0
APP_REMOVED=0
NEW_VOLUME=""
OLD_VOLUME_BACKUP=""
RESTART_APP=0
SCRATCH_DB=""

cleanup() {
  local rc=$?
  if [ -n "$SCRATCH_DB" ]; then
    docker compose exec -T postgres dropdb --if-exists --username="$POSTGRES_USER" "$SCRATCH_DB" >/dev/null 2>&1 || true
  fi
  if [ "$APP_REMOVED" -eq 1 ] || [ "$RESTART_APP" -eq 1 ]; then
    docker compose up -d app >/dev/null 2>&1 || true
  fi
  if [ -n "$NEW_VOLUME" ]; then
    docker volume rm "$NEW_VOLUME" >/dev/null 2>&1 || true
  fi
  rm -rf "$STAGE" 2>/dev/null || true
  exit "$rc"
}
trap cleanup EXIT INT TERM

mkdir -p "$STAGE/bundle" "$STAGE/uploads"
tar --no-same-owner -xzf "$BUNDLE" -C "$STAGE/bundle"
BUNDLE_DIR="$STAGE/bundle"

for f in manifest.json manifest.env SHA256SUMS database.sql.gz uploads.tar.gz uploads-files.tsv env VERSION docker-compose.yml migration-journal.json; do
  [ -f "$BUNDLE_DIR/$f" ] || die "bundle 缺少必需文件：$f"
  [ ! -L "$BUNDLE_DIR/$f" ] || die "bundle 必需文件是符号链接：$f"
done
chmod 600 "$BUNDLE_DIR/env"

(
  cd "$BUNDLE_DIR"
  sha256sum -c SHA256SUMS >/dev/null
) || die "bundle 内 SHA256SUMS 校验失败。"
ok "bundle 内 SHA256SUMS 校验通过。"

if awk -F= '
    NF != 2 || $1 !~ /^[A-Z_][A-Z0-9_]*$/ || $2 ~ /[\r\n]/ { bad=1 }
    END { exit bad ? 1 : 0 }' "$BUNDLE_DIR/manifest.env"; then
  :
else
  die "manifest.env 格式非法。"
fi
# shellcheck disable=SC1091
source "$BUNDLE_DIR/manifest.env"

[ "${BACKUP_FORMAT:-}" = "v2" ] || die "不支持的备份格式：${BACKUP_FORMAT:-missing}"
for v in MIGRATIONS DB_USERS DB_TOPICS DB_REPLIES DB_AVATARS DB_REPLY_IMAGES UPLOAD_FILE_COUNT UPLOAD_BYTES; do
  case "${!v:-}" in
    ''|*[!0-9]*) die "manifest.env 中 ${v} 不是非负整数：${!v:-missing}" ;;
  esac
done
case "${APP_VERSION:-}" in
  ''|*[!0-9.]*) die "manifest.env 中 APP_VERSION 非法。" ;;
esac

BACKUP_VERSION_NUM="$(version_number "$APP_VERSION")" || die "备份版本无法比较：$APP_VERSION"
CURRENT_VERSION_NUM="$(version_number "$CURRENT_VERSION")" || die "当前版本无法比较：$CURRENT_VERSION"
if [ "$BACKUP_VERSION_NUM" -gt "$CURRENT_VERSION_NUM" ] && [ "$FORCE" -eq 0 ]; then
  die "备份版本 v${APP_VERSION} 比目标部署 v${CURRENT_VERSION} 更新；如确认兼容请使用 --force。"
fi
info "备份版本 v${APP_VERSION}（迁移 ${MIGRATIONS} 条）→ 目标 v${CURRENT_VERSION}。"

gzip -t "$BUNDLE_DIR/database.sql.gz" 2>/dev/null || die "数据库备份 gzip 结构损坏。"
DUMP_BYTES="$(gzip -cd "$BUNDLE_DIR/database.sql.gz" | awk '{ bytes += length($0) + 1 } END { print bytes + 0 }')"
[ "$DUMP_BYTES" -gt 0 ] || die "数据库备份内容为空。"
validate_tar_archive "$BUNDLE_DIR/uploads.tar.gz" "uploads 归档"
tar --no-same-owner -xzf "$BUNDLE_DIR/uploads.tar.gz" -C "$STAGE/uploads"
[ -z "$(find "$STAGE/uploads" -type l -print -quit)" ] || die "uploads 归档解压后出现符号链接。"

ACTUAL_UPLOADS="$STAGE/uploads-files.actual.tsv"
(
  cd "$STAGE/uploads"
  find . -type f | LC_ALL=C sort | while IFS= read -r f; do
    rel="${f#./}"
    size=$(wc -c < "$f")
    sha=$(sha256sum "$f" | cut -d ' ' -f 1)
    printf '%s\t%s\t%s\n' "$rel" "$size" "$sha"
  done
) > "$ACTUAL_UPLOADS"
sort "$BUNDLE_DIR/uploads-files.tsv" > "$STAGE/uploads-files.expected.sorted.tsv"
sort "$ACTUAL_UPLOADS" > "$STAGE/uploads-files.actual.sorted.tsv"
if ! diff -u "$STAGE/uploads-files.expected.sorted.tsv" "$STAGE/uploads-files.actual.sorted.tsv" > "$STAGE/uploads.diff"; then
  cat "$STAGE/uploads.diff"
  die "uploads 逐文件 SHA256/大小清单校验失败。"
fi
ACTUAL_UPLOAD_COUNT="$(wc -l < "$ACTUAL_UPLOADS" | tr -d ' ')"
[ "$ACTUAL_UPLOAD_COUNT" -eq "$UPLOAD_FILE_COUNT" ] || die "uploads 文件数量与 manifest 不一致。"
ok "数据库与 uploads 归档、逐文件 SHA256 校验通过。"

AVAILABLE_KB="$(df -Pk "$SCRIPT_DIR" | awk 'NR==2 {print $4}')"
STAGED_KB="$(du -sk "$STAGE" | awk '{print $1}')"
REQUIRED_KB=$((STAGED_KB + 512 * 1024))
[ "$AVAILABLE_KB" -ge "$REQUIRED_KB" ] || die "磁盘空间不足：需要约 ${REQUIRED_KB}KB，可用 ${AVAILABLE_KB}KB。"
info "磁盘空间检查通过（暂存 ${STAGED_KB}KB / 可用 ${AVAILABLE_KB}KB）。"

# 在临时数据库中完整重放 dump。只有语义可恢复且关键行数与 manifest 一致，
# 才允许触碰目标数据库。
SCRATCH_DB="v2ex_restore_verify_$(date -u +%s)"
info "在临时数据库 ${SCRATCH_DB} 重放 dump..."
docker compose exec -T postgres createdb --username="$POSTGRES_USER" "$SCRATCH_DB" >/dev/null
if ! gzip -dc "$BUNDLE_DIR/database.sql.gz" \
    | docker compose exec -T postgres psql \
        --username="$POSTGRES_USER" \
        --dbname="$SCRATCH_DB" \
        --single-transaction \
        --quiet \
        -v ON_ERROR_STOP=1 >/dev/null; then
  die "临时数据库重放失败；目标数据尚未修改。"
fi
SCRATCH_USERS="$(docker compose exec -T postgres psql --username="$POSTGRES_USER" --dbname="$SCRATCH_DB" -X -t -A -c 'SELECT count(*) FROM users;' | tr -d ' \r\n')"
SCRATCH_TOPICS="$(docker compose exec -T postgres psql --username="$POSTGRES_USER" --dbname="$SCRATCH_DB" -X -t -A -c 'SELECT count(*) FROM topics;' | tr -d ' \r\n')"
SCRATCH_REPLIES="$(docker compose exec -T postgres psql --username="$POSTGRES_USER" --dbname="$SCRATCH_DB" -X -t -A -c 'SELECT count(*) FROM replies;' | tr -d ' \r\n')"
[ "$SCRATCH_USERS" -eq "$DB_USERS" ] || die "临时库 users=%s 与 manifest=%s 不一致。" "$SCRATCH_USERS" "$DB_USERS"
[ "$SCRATCH_TOPICS" -eq "$DB_TOPICS" ] || die "临时库 topics=%s 与 manifest=%s 不一致。" "$SCRATCH_TOPICS" "$DB_TOPICS"
[ "$SCRATCH_REPLIES" -eq "$DB_REPLIES" ] || die "临时库 replies=%s 与 manifest=%s 不一致。" "$SCRATCH_REPLIES" "$DB_REPLIES"
docker compose exec -T postgres dropdb --if-exists --username="$POSTGRES_USER" "$SCRATCH_DB" >/dev/null
SCRATCH_DB=""
ok "临时数据库重放与关键行数核验通过。"

APP_CID="$(docker compose ps -q app 2>/dev/null || true)"
[ -n "$APP_CID" ] || die "找不到 app 容器，无法定位 uploads volume。"
UPLOADS_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data/uploads"}}{{.Name}}{{end}}{{end}}' "$APP_CID")"
[ -n "$UPLOADS_VOLUME" ] || die "找不到 /app/data/uploads 的 named volume。"
APP_WAS_PRESENT=1

DB_USERS_CURRENT="$(docker compose exec -T postgres psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -X -t -A -c 'SELECT count(*) FROM users;' 2>/dev/null | tr -d ' \r\n' || true)"
case "$DB_USERS_CURRENT" in
  ''|*[!0-9]*) DB_USERS_CURRENT=0 ;;
esac
UPLOADS_CURRENT="$(docker run --rm --entrypoint sh -v "${UPLOADS_VOLUME}:/data:ro" postgres:17-alpine -c 'find /data -type f | wc -l' | tr -d ' \r\n')"
TARGET_HAS_DATA=0
if [ "$DB_USERS_CURRENT" -gt 0 ] || [ "$UPLOADS_CURRENT" -gt 0 ]; then
  TARGET_HAS_DATA=1
fi

if [ "$TARGET_HAS_DATA" -eq 1 ] && [ "$FORCE" -eq 0 ]; then
  die "目标已有数据（users=${DB_USERS_CURRENT} / uploads=${UPLOADS_CURRENT}）。确认覆盖请使用 --force；脚本会先自动生成安全备份。"
fi

if [ "$TARGET_HAS_DATA" -eq 1 ]; then
  SAFETY="$BACKUP_DIR/pre-restore-$(date -u +%Y%m%d-%H%M%S).tar.gz"
  info "目标已有数据，先生成 pre-restore 安全备份..."
  "$SCRIPT_DIR/backup.sh" --output "$SAFETY" >/dev/null
  [ -s "$SAFETY" ] || die "pre-restore 安全备份未生成。"
  ok "安全备份已生成：${SAFETY}"
fi

if [ "$ASSUME_YES" -eq 0 ]; then
  printf '即将恢复 %s 到 %s。该操作会覆盖数据库并切换 uploads 卷。[y/N] ' "$BUNDLE" "$POSTGRES_DB"
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) die "已取消。" ;;
  esac
fi

if [ "$RESTORE_ENV" -eq 1 ]; then
  cp "$ENV_FILE" "${ENV_FILE}.pre-restore-$(date -u +%Y%m%d-%H%M%S)"
  chmod 600 "${ENV_FILE}.pre-restore-"* 2>/dev/null || true
  cp "$BUNDLE_DIR/env" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  warn "已按 --restore-env 覆盖 .env；请确认 PostgreSQL/Redis 凭据与目标卷匹配。"
fi

info "停止并移除 app 容器（保留数据卷）..."
docker compose stop app >/dev/null
docker compose rm -f app >/dev/null
APP_REMOVED=1

info "在单事务中恢复 PostgreSQL..."
if ! gzip -dc "$BUNDLE_DIR/database.sql.gz" \
    | docker compose exec -T postgres psql \
        --username="$POSTGRES_USER" \
        --dbname="$POSTGRES_DB" \
        --single-transaction \
        --quiet \
        -v ON_ERROR_STOP=1; then
  die "PostgreSQL 恢复失败；原 uploads 卷尚未改动。"
fi
ok "PostgreSQL 恢复完成。"

info "把 uploads 恢复到新 named volume 并复核..."
STAMP="$(date -u +%Y%m%d-%H%M%S)"
NEW_VOLUME="${UPLOADS_VOLUME}.restore-${STAMP}"
docker volume create "$NEW_VOLUME" >/dev/null
if ! docker run --rm -i --entrypoint tar \
      -v "${NEW_VOLUME}:/data" \
      postgres:17-alpine -C /data -xzf - < "$BUNDLE_DIR/uploads.tar.gz"; then
  die "uploads 恢复到新卷失败；原 uploads 卷尚未切换。"
fi
docker run --rm --entrypoint chown -v "${NEW_VOLUME}:/data" postgres:17-alpine -R 1001:1001 /data >/dev/null

NEW_VOLUME_LIST="$STAGE/new-volume-files.tsv"
docker run --rm --entrypoint sh -v "${NEW_VOLUME}:/data:ro" postgres:17-alpine -c '
  set -eu
  find /data -type f | LC_ALL=C sort | while IFS= read -r f; do
    rel=${f#/data/}
    size=$(wc -c < "$f")
    sha=$(sha256sum "$f" | cut -d " " -f 1)
    printf "%s\t%s\t%s\n" "$rel" "$size" "$sha"
  done
' > "$NEW_VOLUME_LIST"
sort "$NEW_VOLUME_LIST" > "$STAGE/new-volume-files.sorted.tsv"
if ! diff -u "$STAGE/uploads-files.expected.sorted.tsv" "$STAGE/new-volume-files.sorted.tsv" > "$STAGE/new-volume.diff"; then
  cat "$STAGE/new-volume.diff"
  die "新 uploads 卷逐文件校验失败；原卷尚未切换。"
fi
ok "新 uploads 卷校验通过（${UPLOAD_FILE_COUNT} 个文件）。"

OLD_VOLUME_BACKUP="${UPLOADS_VOLUME}.pre-restore-${STAMP}"
info "切换 uploads volume：${UPLOADS_VOLUME} → ${NEW_VOLUME}"
docker volume rename "$UPLOADS_VOLUME" "$OLD_VOLUME_BACKUP"
if ! docker volume rename "$NEW_VOLUME" "$UPLOADS_VOLUME"; then
  docker volume rename "$OLD_VOLUME_BACKUP" "$UPLOADS_VOLUME" || true
  NEW_VOLUME=""
  die "新 uploads 卷切换失败；已尝试回滚原卷。"
fi
NEW_VOLUME=""
RESTART_APP=1

info "启动 app 并等待健康..."
if ! docker compose up -d app >/dev/null; then
  die "app 启动失败。数据库与新 uploads 卷已恢复，请检查 docker compose logs app。"
fi
APP_REMOVED=0
APP_URL_VALUE="$(read_env_value APP_URL)"
APP_URL_VALUE="${APP_URL_VALUE:-http://localhost:$(read_env_value APP_PORT)}"
APP_URL_VALUE="${APP_URL_VALUE:-http://localhost:3000}"
READY=0
for _ in $(seq 1 80); do
  if curl -fsS -o /dev/null --max-time 5 "$APP_URL_VALUE" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 3
done
[ "$READY" -eq 1 ] || die "app 未在 240 秒内就绪。"
RESTART_APP=0

info "执行恢复后数据库计数核验..."
DB_USERS_AFTER="$(docker compose exec -T postgres psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -X -t -A -c 'SELECT count(*) FROM users;' | tr -d ' \r\n')"
DB_TOPICS_AFTER="$(docker compose exec -T postgres psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -X -t -A -c 'SELECT count(*) FROM topics;' | tr -d ' \r\n')"
DB_REPLIES_AFTER="$(docker compose exec -T postgres psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -X -t -A -c 'SELECT count(*) FROM replies;' | tr -d ' \r\n')"
[ "$DB_USERS_AFTER" -eq "$DB_USERS" ] || die "恢复后 users 数量不一致：${DB_USERS_AFTER} != ${DB_USERS}"
[ "$DB_TOPICS_AFTER" -eq "$DB_TOPICS" ] || die "恢复后 topics 数量不一致：${DB_TOPICS_AFTER} != ${DB_TOPICS}"
[ "$DB_REPLIES_AFTER" -eq "$DB_REPLIES" ] || die "恢复后 replies 数量不一致：${DB_REPLIES_AFTER} != ${DB_REPLIES}"

UPLOADS_AFTER="$(docker run --rm --entrypoint sh -v "${UPLOADS_VOLUME}:/data:ro" postgres:17-alpine -c 'find /data -type f | wc -l' | tr -d ' \r\n')"
[ "$UPLOADS_AFTER" -eq "$UPLOAD_FILE_COUNT" ] || die "恢复后 uploads 文件数不一致：${UPLOADS_AFTER} != ${UPLOAD_FILE_COUNT}"

ok "恢复完成并通过恢复后核验。"
printf '  数据库 : users=%s topics=%s replies=%s\n' "$DB_USERS_AFTER" "$DB_TOPICS_AFTER" "$DB_REPLIES_AFTER"
printf '  上传   : %s 个文件（逐文件 SHA256 已核验）\n' "$UPLOADS_AFTER"
if [ -n "$OLD_VOLUME_BACKUP" ]; then
  printf '  原卷   : %s（确认无误后可手工删除）\n' "$OLD_VOLUME_BACKUP"
fi
