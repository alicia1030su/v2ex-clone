#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.20 — v0.0.19 旧版纯数据库 dump 兼容恢复
#
# 旧备份只含 PostgreSQL dump，不含 uploads。它永远不能被当作 v0.0.20 一致
# bundle。本脚本只在用户显式选择 --legacy-db-only 时运行：
#   · 恢复前对当前实例生成完整安全 bundle；
#   · scratch DB 先完整重放；
#   · 单事务恢复目标数据库；
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

gzip -t "$DUMP" 2>/dev/null || die "旧版 dump gzip 结构损坏。"
DUMP_BYTES="$(gzip -cd "$DUMP" | awk '{ bytes += length($0) + 1 } END { print bytes + 0 }')"
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

CURRENT_USERS="$("${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -t -A -c 'SELECT count(*) FROM users;' 2>/dev/null | tr -d ' \r\n' || true)"
case "$CURRENT_USERS" in ''|*[!0-9]*) CURRENT_USERS=0 ;; esac
if [ "$CURRENT_USERS" -gt 0 ]; then
  SAFETY="$BACKUP_DIR/pre-legacy-restore-$(date -u +%Y%m%d-%H%M%S).tar.gz"
  info "目标已有数据，先生成当前完整安全 bundle..."
  bash "$SCRIPT_DIR/backup.sh" --output "$SAFETY" >/dev/null
  [ -s "$SAFETY" ] || die "恢复前安全 bundle 未生成。"
  ok "安全 bundle：$SAFETY"
fi

SCRATCH_DB="v2ex_legacy_verify_$(date -u +%s)"
cleanup() {
  local rc=$?
  "${COMPOSE[@]}" exec -T postgres dropdb --if-exists --username="$POSTGRES_USER" "$SCRATCH_DB" >/dev/null 2>&1 || true
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

info "在 scratch DB 重放旧版 dump..."
"${COMPOSE[@]}" exec -T postgres createdb --username="$POSTGRES_USER" "$SCRATCH_DB" >/dev/null
if ! gzip -dc "$DUMP" | "${COMPOSE[@]}" exec -T postgres psql \
    --username="$POSTGRES_USER" --dbname="$SCRATCH_DB" --single-transaction --quiet -v ON_ERROR_STOP=1 >/dev/null; then
  die "scratch DB 重放失败；目标数据库尚未修改。"
fi
"${COMPOSE[@]}" exec -T postgres dropdb --if-exists --username="$POSTGRES_USER" "$SCRATCH_DB" >/dev/null
SCRATCH_DB=""
ok "scratch DB 重放通过。"

info "停止 app 并单事务恢复目标数据库..."
"${COMPOSE[@]}" stop app >/dev/null
"${COMPOSE[@]}" rm -f app >/dev/null
if ! gzip -dc "$DUMP" | "${COMPOSE[@]}" exec -T postgres psql \
    --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --single-transaction --quiet -v ON_ERROR_STOP=1; then
  die "目标数据库恢复失败；uploads 未修改。请使用恢复前安全 bundle 人工处置。"
fi
ok "旧版数据库恢复完成（uploads 未修改）。"

info "启动 app；entrypoint 将执行 v0.0.20 迁移..."
"${COMPOSE[@]}" up -d app >/dev/null
READY=0
for _ in $(seq 1 100); do
  if curl -fsS -o /dev/null --max-time 5 "$APP_URL_VALUE" 2>/dev/null; then READY=1; break; fi
  sleep 3
done
[ "$READY" -eq 1 ] || die "app 未就绪；数据库已恢复，uploads 未修改，请检查日志与迁移状态。"

if [ -f "$SCRIPT_DIR/reconcile-attachments.sh" ]; then
  if ! bash "$SCRIPT_DIR/reconcile-attachments.sh"; then
    warn "数据库已恢复且 uploads 未修改；附件对账发现严重不一致。"
    die "旧版恢复后的附件对账失败，请人工比对新旧卷与安全 bundle。"
  fi
fi
ok "旧版数据库兼容恢复完成。"
