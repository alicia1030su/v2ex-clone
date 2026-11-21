#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.20 — 一致备份脚本
#
# 用法：
#   ./backup.sh
#   ./backup.sh --output /path/to/v2ex-backup.tar.gz
#
# 备份内容（单一 tar.gz bundle）：
#   1. PostgreSQL 全量逻辑备份
#   2. uploads named volume（头像 + 回复图片 + 其它运行时上传文件）
#   3. .env 配置（含明文凭据，bundle 权限 600）
#   4. manifest.json（版本、迁移数、业务计数、文件计数/大小/SHA256）
#   5. bundle 内 SHA256SUMS 与 bundle 外部 .sha256
#
# 一致性策略：
#   备份期间短暂停止 app 容器，确保数据库与上传文件落在同一“无写入”时刻。
#   PostgreSQL 与 Redis 继续运行；脚本无论成功失败都会恢复 app。
#   这会带来秒级到分钟级停写窗口，但避免拼出数据库与文件互相错位的不可恢复备份。
# ---------------------------------------------------------------------------
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
BACKUP_DIR="$SCRIPT_DIR/backups"
VERSION_FILE="$SCRIPT_DIR/VERSION"
OUTPUT_OVERRIDE=""

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_BLU=$'\033[34m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_BLU=''; C_BLD=''; C_RST=''
fi
info() { printf '%s[信息]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()   { printf '%s[成功]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { printf '%s[警告]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; }
die()  { printf '%s[错误]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'EOF'
用法：
  ./backup.sh [--output /path/to/v2ex-backup.tar.gz]

默认输出：./backups/v2ex-backup-YYYYmmdd-HHMMSS.tar.gz
EOF
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    -o|--output)
      [ -n "${2:-}" ] || usage
      OUTPUT_OVERRIDE="$2"
      shift 2
      ;;
    -h|--help) usage ;;
    *) die "未知参数：$1" ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "未检测到 docker 命令。"
command -v gzip >/dev/null 2>&1 || die "未检测到 gzip。"
command -v tar >/dev/null 2>&1 || die "未检测到 tar。"
docker compose version >/dev/null 2>&1 || die "未检测到 Docker Compose v2。"
[ -f "$ENV_FILE" ] || die "未找到 .env 配置。请先运行 ./install.sh。"
[ -f "$VERSION_FILE" ] || die "未找到 VERSION 文件。"

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}
POSTGRES_USER="$(read_env_value POSTGRES_USER)"
POSTGRES_USER="${POSTGRES_USER:-v2ex}"
POSTGRES_DB="$(read_env_value POSTGRES_DB)"
POSTGRES_DB="${POSTGRES_DB:-v2ex}"
APP_VERSION="$(tr -d ' \r\n' < "$VERSION_FILE")"
case "$APP_VERSION" in
  ''|*[!0-9.]*) die "VERSION 文件内容非法：$APP_VERSION" ;;
esac

mkdir -p "$BACKUP_DIR"
[ ! -L "$BACKUP_DIR" ] || die "备份目录不能是符号链接：$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" || die "无法将备份目录权限设为 700：$BACKUP_DIR"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$BACKUP_DIR/.backup.lock"
  flock -n 9 || die "已有另一个备份进程正在运行。"
fi

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
BUNDLE_NAME="v2ex-backup-${TIMESTAMP}.tar.gz"
if [ -n "$OUTPUT_OVERRIDE" ]; then
  case "$OUTPUT_OVERRIDE" in
    /*) BUNDLE_PATH="$OUTPUT_OVERRIDE" ;;
    *)  BUNDLE_PATH="$SCRIPT_DIR/$OUTPUT_OVERRIDE" ;;
  esac
  BUNDLE_NAME="$(basename "$BUNDLE_PATH")"
  mkdir -p "$(dirname "$BUNDLE_PATH")"
  chmod 700 "$(dirname "$BUNDLE_PATH")" 2>/dev/null || true
else
  BUNDLE_PATH="$BACKUP_DIR/$BUNDLE_NAME"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/v2ex-backup.XXXXXX")"
chmod 700 "$TMP_DIR"
APP_WAS_RUNNING=0
APP_CID=""
UPLOADS_VOLUME=""

cleanup() {
  local rc=$?
  if [ "$APP_WAS_RUNNING" -eq 1 ]; then
    docker compose start app >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR" 2>/dev/null || true
  exit "$rc"
}
trap cleanup EXIT INT TERM

APP_CID="$(docker compose ps -q app 2>/dev/null || true)"
[ -n "$APP_CID" ] || die "找不到 app 容器。请先运行 ./install.sh 或 ./start.sh。"
UPLOADS_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data/uploads"}}{{.Name}}{{end}}{{end}}' "$APP_CID")"
[ -n "$UPLOADS_VOLUME" ] || die "找不到 /app/data/uploads 的 named volume。"
APP_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$APP_CID")"
APP_REPO_DIGEST="$(docker inspect --format '{{index .RepoDigests 0}}' "$APP_CID" 2>/dev/null || true)"
COMPOSE_PROJECT="$(read_env_value COMPOSE_PROJECT_NAME)"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-v2ex}"

if [ "$(docker inspect --format '{{.State.Running}}' "$APP_CID" 2>/dev/null || echo false)" = "true" ]; then
  info "停止 app 容器，进入一致备份窗口..."
  docker compose stop app >/dev/null
  APP_WAS_RUNNING=1
else
  info "app 容器已停止；继续生成一致备份。"
fi

# --- 1. PostgreSQL ---------------------------------------------------------
info "备份 PostgreSQL（${POSTGRES_USER}@${POSTGRES_DB}）..."
if ! docker compose exec -T postgres pg_dump \
      --username="$POSTGRES_USER" \
      --dbname="$POSTGRES_DB" \
      --no-owner --no-acl \
      --clean --if-exists \
    | gzip -9 > "$TMP_DIR/database.sql.gz"; then
  die "PostgreSQL 备份失败。"
fi
gzip -t "$TMP_DIR/database.sql.gz" 2>/dev/null || die "PostgreSQL 备份 gzip 结构损坏。"
DUMP_BYTES="$(gzip -cd "$TMP_DIR/database.sql.gz" | awk '{ bytes += length($0) + 1 } END { print bytes + 0 }')"
[ "$DUMP_BYTES" -gt 0 ] || die "PostgreSQL 备份内容为空。"
ok "PostgreSQL 备份完成（解压后 ${DUMP_BYTES} 字节）。"

# --- 2. uploads volume -----------------------------------------------------
info "备份 uploads volume（${UPLOADS_VOLUME}）..."
if ! docker run --rm --entrypoint tar \
      -v "${UPLOADS_VOLUME}:/data:ro" \
      postgres:17-alpine -C /data -czf - . > "$TMP_DIR/uploads.tar.gz"; then
  die "uploads 卷备份失败。"
fi
gzip -t "$TMP_DIR/uploads.tar.gz" 2>/dev/null || die "uploads 归档 gzip 结构损坏。"

# 逐文件清单：相对路径、字节数、SHA256。上传路径由服务端生成且不含空白，
# 但这里仍用 tab 分隔并拒绝换行，避免清单注入。
docker run --rm --entrypoint sh \
  -v "${UPLOADS_VOLUME}:/data:ro" \
  postgres:17-alpine -c '
    set -eu
    find /data -type f | LC_ALL=C sort | while IFS= read -r f; do
      rel=${f#/data/}
      size=$(wc -c < "$f")
      sha=$(sha256sum "$f" | cut -d " " -f 1)
      printf "%s\t%s\t%s\n" "$rel" "$size" "$sha"
    done
  ' > "$TMP_DIR/uploads-files.tsv"
if awk -F '\t' 'NF != 3 || $1 ~ /[\r\n]/ { bad=1 } END { exit bad ? 1 : 0 }' "$TMP_DIR/uploads-files.tsv"; then
  :
else
  die "uploads 文件清单包含非法条目。"
fi
UPLOAD_FILE_COUNT="$(wc -l < "$TMP_DIR/uploads-files.tsv" | tr -d ' ')"
UPLOAD_BYTES="$(awk -F '\t' '{ sum += $2 } END { print sum + 0 }' "$TMP_DIR/uploads-files.tsv")"
ok "uploads 备份完成（${UPLOAD_FILE_COUNT} 个文件 / ${UPLOAD_BYTES} 字节）。"

# --- 3. 配置与迁移元数据 ---------------------------------------------------
cp "$ENV_FILE" "$TMP_DIR/env"
cp "$VERSION_FILE" "$TMP_DIR/VERSION"
cp "$SCRIPT_DIR/docker-compose.yml" "$TMP_DIR/docker-compose.yml"
docker cp "$APP_CID:/app/drizzle/meta/_journal.json" "$TMP_DIR/migration-journal.json" >/dev/null
chmod 600 "$TMP_DIR/env" "$TMP_DIR/VERSION" "$TMP_DIR/docker-compose.yml" "$TMP_DIR/migration-journal.json"

MIGRATIONS="$(docker compose exec -T postgres psql \
  --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -X -t -A \
  -c 'SELECT count(*) FROM drizzle.__drizzle_migrations;' | tr -d ' \r\n')"
case "$MIGRATIONS" in
  ''|*[!0-9]*) die "读取数据库迁移版本失败：$MIGRATIONS" ;;
esac

DB_USERS="$(docker compose exec -T postgres psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -X -t -A -c 'SELECT count(*) FROM users;' | tr -d ' \r\n')"
DB_TOPICS="$(docker compose exec -T postgres psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -X -t -A -c 'SELECT count(*) FROM topics;' | tr -d ' \r\n')"
DB_REPLIES="$(docker compose exec -T postgres psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -X -t -A -c 'SELECT count(*) FROM replies;' | tr -d ' \r\n')"
DB_AVATARS="$(docker compose exec -T postgres psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -X -t -A -c 'SELECT count(*) FROM avatars;' | tr -d ' \r\n')"
DB_REPLY_IMAGES="$(docker compose exec -T postgres psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -X -t -A -c 'SELECT count(*) FROM reply_images;' | tr -d ' \r\n')"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}
file_size() { wc -c < "$1" | tr -d ' '; }

CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DB_SHA="$(sha256_file "$TMP_DIR/database.sql.gz")"
UPLOADS_SHA="$(sha256_file "$TMP_DIR/uploads.tar.gz")"
UPLOADS_LIST_SHA="$(sha256_file "$TMP_DIR/uploads-files.tsv")"
ENV_SHA="$(sha256_file "$TMP_DIR/env")"
VERSION_SHA="$(sha256_file "$TMP_DIR/VERSION")"
COMPOSE_SHA="$(sha256_file "$TMP_DIR/docker-compose.yml")"
JOURNAL_SHA="$(sha256_file "$TMP_DIR/migration-journal.json")"

cat > "$TMP_DIR/manifest.env" <<EOF
BACKUP_FORMAT=v2
CREATED_AT=${CREATED_AT}
APP_VERSION=${APP_VERSION}
APP_IMAGE_ID=${APP_IMAGE_ID}
APP_REPO_DIGEST=${APP_REPO_DIGEST:-unknown}
COMPOSE_PROJECT=${COMPOSE_PROJECT}
UPLOADS_VOLUME=${UPLOADS_VOLUME}
REDIS_POLICY=rebuildable-cache-not-backed-up
MIGRATIONS=${MIGRATIONS}
DB_USERS=${DB_USERS}
DB_TOPICS=${DB_TOPICS}
DB_REPLIES=${DB_REPLIES}
DB_AVATARS=${DB_AVATARS}
DB_REPLY_IMAGES=${DB_REPLY_IMAGES}
UPLOAD_FILE_COUNT=${UPLOAD_FILE_COUNT}
UPLOAD_BYTES=${UPLOAD_BYTES}
EOF

cat > "$TMP_DIR/manifest.json" <<EOF
{
  "format": "v2ex-backup/v2",
  "createdAt": "${CREATED_AT}",
  "appVersion": "${APP_VERSION}",
  "runtime": {
    "imageId": "${APP_IMAGE_ID}",
    "repoDigest": "${APP_REPO_DIGEST:-unknown}",
    "composeProject": "${COMPOSE_PROJECT}",
    "uploadsVolume": "${UPLOADS_VOLUME}",
    "redisPolicy": "rebuildable-cache-not-backed-up"
  },
  "migrations": ${MIGRATIONS},
  "database": {
    "file": "database.sql.gz",
    "size": $(file_size "$TMP_DIR/database.sql.gz"),
    "sha256": "${DB_SHA}",
    "counts": {
      "users": ${DB_USERS},
      "topics": ${DB_TOPICS},
      "replies": ${DB_REPLIES},
      "avatars": ${DB_AVATARS},
      "replyImages": ${DB_REPLY_IMAGES}
    }
  },
  "uploads": {
    "volume": "${UPLOADS_VOLUME}",
    "file": "uploads.tar.gz",
    "size": $(file_size "$TMP_DIR/uploads.tar.gz"),
    "sha256": "${UPLOADS_SHA}",
    "fileCount": ${UPLOAD_FILE_COUNT},
    "uncompressedBytes": ${UPLOAD_BYTES},
    "manifest": "uploads-files.tsv",
    "manifestSha256": "${UPLOADS_LIST_SHA}"
  },
  "config": {
    "file": "env",
    "size": $(file_size "$TMP_DIR/env"),
    "sha256": "${ENV_SHA}",
    "note": "含明文凭据；仅用于人工保全，不默认覆盖目标主机 .env"
  },
  "deployment": {
    "versionFile": "VERSION",
    "versionSha256": "${VERSION_SHA}",
    "composeFile": "docker-compose.yml",
    "composeSha256": "${COMPOSE_SHA}",
    "migrationJournal": "migration-journal.json",
    "migrationJournalSha256": "${JOURNAL_SHA}"
  }
}
EOF

(
  cd "$TMP_DIR"
  sha256sum database.sql.gz uploads.tar.gz uploads-files.tsv env VERSION docker-compose.yml migration-journal.json manifest.env manifest.json > SHA256SUMS
)

# --- 4. 组装 bundle --------------------------------------------------------
BUNDLE_TMP="${BUNDLE_PATH}.tmp.$$"
rm -f "$BUNDLE_TMP"
if ! tar -C "$TMP_DIR" -czf "$BUNDLE_TMP" .; then
  rm -f "$BUNDLE_TMP"
  die "备份 bundle 组装失败。"
fi
gzip -t "$BUNDLE_TMP" 2>/dev/null || { rm -f "$BUNDLE_TMP"; die "备份 bundle gzip 结构损坏。"; }
BUNDLE_SHA="$(sha256_file "$BUNDLE_TMP")"
printf '%s  %s\n' "$BUNDLE_SHA" "$BUNDLE_NAME" > "${BUNDLE_TMP}.sha256"
chmod 600 "$BUNDLE_TMP" "${BUNDLE_TMP}.sha256"
mv "$BUNDLE_TMP" "$BUNDLE_PATH"
mv "${BUNDLE_TMP}.sha256" "${BUNDLE_PATH}.sha256"

# --- 5. 恢复服务 -----------------------------------------------------------
if [ "$APP_WAS_RUNNING" -eq 1 ]; then
  info "恢复 app 容器..."
  if ! docker compose start app >/dev/null; then
    die "备份已生成，但 app 容器恢复失败。请执行 ./start.sh 并检查日志。"
  fi
  APP_WAS_RUNNING=0
fi

ok "一致备份完成：${BUNDLE_PATH}"
printf '  SHA256 : %s\n' "$BUNDLE_SHA"
printf '  版本   : %s（迁移 %s 条）\n' "$APP_VERSION" "$MIGRATIONS"
printf '  数据   : users=%s topics=%s replies=%s avatars=%s reply_images=%s\n' \
  "$DB_USERS" "$DB_TOPICS" "$DB_REPLIES" "$DB_AVATARS" "$DB_REPLY_IMAGES"
printf '  上传   : %s 个文件 / %s 字节\n' "$UPLOAD_FILE_COUNT" "$UPLOAD_BYTES"
printf '\n'
info "异机保存示例（请改用你的安全主机与密钥）："
info "  scp -p ${BUNDLE_PATH} ${BUNDLE_PATH}.sha256 user@secure-host:/secure/path/"
info "备份含明文凭据，必须保持 600 权限，严禁上传到公开 Artifact 或版本库。"
