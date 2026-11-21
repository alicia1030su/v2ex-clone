#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.20 — v0.0.19 旧版纯数据库 dump 兼容恢复
#
# 旧备份只含 PostgreSQL dump，不含 uploads。它永远不能被当作 v0.0.20 一致
# bundle。本脚本只在用户显式选择 --legacy-db-only 时运行：
#   · 恢复前对当前实例生成完整安全 bundle；
#   · 严格扫描 psql 元命令与高风险 SQL；
#   · 以非超级用户角色在 scratch DB 重放，再转换为 custom dump；
#   · 用 pg_restore --single-transaction 恢复目标数据库；
#   · 不改动 uploads Volume；
#   · 启动 app（entrypoint 会执行新迁移）；
#   · 执行附件双向对账。
# ---------------------------------------------------------------------------
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
ENV_FILE="$SCRIPT_DIR/.env"
BACKUP_DIR="$SCRIPT_DIR/backups"
ASSUME_YES=0
DUMP=""

usage() {
  cat >&2 <<'EOF'
用法：./restore-legacy-db.sh [--yes] <v0.0.19-backup.sql.gz>
  --yes  跳过交互确认（CI）
EOF
  exit 2
}
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1; shift ;;
    -h|--help) usage ;;
    -*) echo "未知参数：$1" >&2; exit 2 ;;
    *) [ -z "$DUMP" ] || usage; DUMP="$1"; shift ;;
  esac
done
[ -n "$DUMP" ] || usage
[ -f "$ENV_FILE" ] || { echo "[错误] 未找到 .env 配置。" >&2; exit 1; }
[ -f "$DUMP" ] || { echo "[错误] 旧版 dump 不存在：$DUMP" >&2; exit 1; }
[ ! -L "$DUMP" ] || { echo "[错误] 旧版 dump 不能是符号链接。" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "[错误] 未检测到 docker。" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "[错误] 未检测到 Docker Compose v2。" >&2; exit 1; }

info() { printf '[信息] %s\n' "$*"; }
ok()   { printf '[成功] %s\n' "$*"; }
warn() { printf '[警告] %s\n' "$*" >&2; }
die()  { printf '[错误] %s\n' "$*" >&2; exit 1; }

read_env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r' | sed 's/^["'"'"']//; s/["'"'"']$//'
}
POSTGRES_USER="$(read_env_value POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-v2ex}"
POSTGRES_DB="$(read_env_value POSTGRES_DB)"; POSTGRES_DB="${POSTGRES_DB:-v2ex}"
APP_URL_VALUE="$(read_env_value APP_URL)"; APP_URL_VALUE="${APP_URL_VALUE:-http://localhost:$(read_env_value APP_PORT)}"
APP_URL_VALUE="${APP_URL_VALUE:-http://localhost:3000}"
COMPOSE=(docker compose --env-file "$ENV_FILE")

mkdir -p "$BACKUP_DIR"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$BACKUP_DIR/.restore.lock"
  flock -n 9 || die "已有另一个恢复进程正在运行。"
fi

gzip -t "$DUMP" 2>/dev/null || die "旧版 dump gzip 结构损坏。"
DUMP_BYTES="$(gzip -cd "$DUMP" | wc -c | tr -d ' ')"
[ "$DUMP_BYTES" -gt 0 ] || die "旧版 dump 内容为空。"
SHA_FILE="${DUMP}.sha256"
if [ -f "$SHA_FILE" ] && command -v sha256sum >/dev/null 2>&1; then
  EXPECTED="$(awk 'NR==1 {print $1}' "$SHA_FILE")"
  ACTUAL="$(sha256sum "$DUMP" | awk '{print $1}')"
  [ "$EXPECTED" = "$ACTUAL" ] || die "旧版 dump SHA256 不匹配。"
  ok "旧版 dump SHA256 校验通过。"
else
  warn "旧版 dump 缺少 .sha256 sidecar；完整性保护降级。"
fi

printf '即将把旧版数据库 dump %s 恢复到 %s。uploads 卷不会修改。[y/N] ' "$DUMP" "$POSTGRES_DB"
if [ "$ASSUME_YES" -eq 0 ]; then
  read -r reply || die "已取消。"
  case "$reply" in y|Y|yes|YES) ;; *) die "已取消。" ;; esac
fi

if ! CURRENT_USERS="$("${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -t -A -c 'SELECT count(*) FROM users;' 2>/dev/null | tr -d ' \r\n')"; then
  die "无法读取目标数据库 users 计数；拒绝在目标状态未知时继续。"
fi
case "$CURRENT_USERS" in ''|*[!0-9]*) die "目标数据库 users 计数非法：${CURRENT_USERS:-empty}" ;; esac
if [ "$CURRENT_USERS" -gt 0 ]; then
  SAFETY="$BACKUP_DIR/pre-legacy-restore-$(date -u +%Y%m%d-%H%M%S).tar.gz"
  info "目标已有数据，先生成当前完整安全 bundle..."
  bash "$SCRIPT_DIR/backup.sh" --output "$SAFETY" >/dev/null
  [ -s "$SAFETY" ] || die "恢复前安全 bundle 未生成。"
  ok "安全 bundle：$SAFETY"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/v2ex-legacy-restore.XXXXXX")"
chmod 700 "$TMP_DIR"
ROLE="v2ex_legacy_restore"
SCRATCH_DB="v2ex_legacy_verify_$(date +%s)"
APP_REMOVED=0
DB_COMMITTED=0
ROLE_CREATED=0
LEGACY_APP_CID="$("${COMPOSE[@]}" ps -q app 2>/dev/null | head -1 || true)"
[ -n "$LEGACY_APP_CID" ] || die "找不到 app 容器，无法定位 uploads 卷。"
UPLOADS_VOLUME="$(docker inspect "$LEGACY_APP_CID" --format '{{range .Mounts}}{{if eq .Destination "/app/data/uploads"}}{{.Name}}{{end}}{{end}}')"
[ -n "$UPLOADS_VOLUME" ] || die "找不到 /app/data/uploads 的 named volume。"
cleanup() {
  local rc=$?
  if [ -n "$SCRATCH_DB" ]; then
    "${COMPOSE[@]}" exec -T postgres dropdb --if-exists --username="$POSTGRES_USER" "$SCRATCH_DB" >/dev/null 2>&1 || true
  fi
  if [ "$ROLE_CREATED" -eq 1 ]; then
    "${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d postgres -X -q -v ON_ERROR_STOP=1 -c \
      "DROP ROLE IF EXISTS ${ROLE}" >/dev/null 2>&1 || true
  fi
  if [ "$APP_REMOVED" -eq 1 ] && [ "$DB_COMMITTED" -eq 0 ]; then
    "${COMPOSE[@]}" up -d app >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR" 2>/dev/null || true
  return "$rc"
}
on_exit() {
  local rc=$?
  cleanup
  exit "$rc"
}
on_signal() {
  local sig="$1"
  trap - EXIT INT TERM
  cleanup || true
  if [ "$sig" = "INT" ]; then exit 130; fi
  exit 143
}
trap on_exit EXIT
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

# 明文 SQL 不能直接喂 psql：\!、\connect、显式 COMMIT 会绕过单事务保护。
# 先剥离/拒绝 psql 元命令与危险服务端函数，再以非超级用户角色重放进 scratch DB，
# 最后从 scratch 导出 custom dump，用 pg_restore --single-transaction 写目标库。
gzip -dc "$DUMP" > "$TMP_DIR/legacy.sql"
if ! awk '
  BEGIN { bad=0 }
  /^[[:space:]]*\\connect([[:space:]]|$)/ { next }
  /^[[:space:]]*\\\.[[:space:]]*$/ { next }
  /^[[:space:]]*\\/ { print "[错误] 旧版 dump 包含禁止的 psql 元命令：" $0 > "/dev/stderr"; bad=1; next }
  tolower($0) ~ /^[[:space:]]*(begin|commit|rollback);[[:space:]]*$/ { next }
  tolower($0) ~ /^[[:space:]]*create[[:space:]]+extension([[:space:]]|$)/ { next }
  tolower($0) ~ /(copy[[:space:]].*from[[:space:]]+program|pg_read_file|pg_write_file|pg_execute_server_program|lo_import|dblink|alter[[:space:]]+system|set[[:space:]]+(role|session[[:space:]]+authorization))/ {
    print "[错误] 旧版 dump 包含禁止的高风险 SQL：" $0 > "/dev/stderr"; bad=1; next
  }
  { print }
  END { exit bad ? 1 : 0 }
' "$TMP_DIR/legacy.sql" > "$TMP_DIR/legacy.safe.sql"; then
  die "旧版 dump 安全扫描失败；目标数据库尚未修改。"
fi

ROLE_EXISTS="$("${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d postgres -X -q -t -A -c \
  "SELECT 1 FROM pg_roles WHERE rolname='${ROLE}'" | tr -d ' \r\n')"
if [ "$ROLE_EXISTS" != "1" ]; then
  "${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d postgres -X -q -v ON_ERROR_STOP=1 -c \
    "CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS" >/dev/null
  ROLE_CREATED=1
fi

info "在隔离 scratch DB 以非超级用户重放旧版 dump..."
"${COMPOSE[@]}" exec -T postgres dropdb --if-exists --username="$POSTGRES_USER" "$SCRATCH_DB" >/dev/null 2>&1 || true
"${COMPOSE[@]}" exec -T postgres createdb --username="$POSTGRES_USER" --owner="$ROLE" "$SCRATCH_DB" >/dev/null
"${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$SCRATCH_DB" -X -q -v ON_ERROR_STOP=1 -c \
  'CREATE EXTENSION IF NOT EXISTS pg_trgm' >/dev/null
if ! "${COMPOSE[@]}" exec -T postgres psql \
    --username="$ROLE" --dbname="$SCRATCH_DB" --single-transaction --quiet -v ON_ERROR_STOP=1 \
    < "$TMP_DIR/legacy.safe.sql" >/dev/null; then
  die "scratch DB 重放失败；目标数据库尚未修改。"
fi
if ! "${COMPOSE[@]}" exec -T postgres pg_dump \
    --username="$POSTGRES_USER" --dbname="$SCRATCH_DB" --format=custom --no-owner --no-acl --clean --if-exists \
    > "$TMP_DIR/legacy.dump"; then
  die "scratch DB 导出 custom dump 失败；目标数据库尚未修改。"
fi
"${COMPOSE[@]}" exec -T postgres dropdb --if-exists --username="$POSTGRES_USER" "$SCRATCH_DB" >/dev/null
SCRATCH_DB=""
if [ "$ROLE_CREATED" -eq 1 ]; then
  "${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d postgres -X -q -v ON_ERROR_STOP=1 -c \
    "DROP ROLE IF EXISTS ${ROLE}" >/dev/null
  ROLE_CREATED=0
fi
ok "scratch DB 重放与 custom dump 转换通过。"

info "停止 app 并单事务恢复目标数据库..."
"${COMPOSE[@]}" stop app >/dev/null
"${COMPOSE[@]}" rm -f app >/dev/null
APP_REMOVED=1
if ! "${COMPOSE[@]}" exec -T postgres pg_restore \
    --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
    --single-transaction --clean --if-exists --no-owner --no-acl --exit-on-error \
    < "$TMP_DIR/legacy.dump"; then
  die "目标数据库恢复失败；uploads 未修改。请使用恢复前安全 bundle 人工处置。"
fi
DB_COMMITTED=1
ok "旧版数据库恢复完成（uploads 未修改）。"

info "放流量前执行附件双向对账..."
if [ -f "$SCRIPT_DIR/reconcile-attachments.sh" ]; then
  if ! bash "$SCRIPT_DIR/reconcile-attachments.sh" --volume "$UPLOADS_VOLUME"; then
    warn "数据库已恢复且 uploads 未修改；附件对账发现严重不一致。"
    die "旧版恢复后的附件对账失败；app 保持停止，请人工处置。"
  fi
fi

info "启动 app；entrypoint 将执行 v0.0.20 迁移..."
"${COMPOSE[@]}" up -d app >/dev/null
APP_REMOVED=0
READY=0
for _ in $(seq 1 100); do
  if curl -fsS -o /dev/null --max-time 5 "$APP_URL_VALUE" 2>/dev/null; then READY=1; break; fi
  sleep 3
done
[ "$READY" -eq 1 ] || die "app 未就绪；数据库已恢复，uploads 未修改，请检查日志与迁移状态。"

ok "旧版数据库兼容恢复完成。"
