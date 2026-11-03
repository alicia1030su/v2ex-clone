#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.1 — 备份脚本
#
# 用法：./backup.sh
#
# 备份内容：
#   1. PostgreSQL 逻辑备份（pg_dump → gzip）
#   2. .env 配置备份（含凭据，权限 600）
#
# 输出目录：./backups/
#
# 恢复方法见同目录下的 restore.sh。
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
BACKUP_DIR="$SCRIPT_DIR/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_BLU=$'\033[34m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_BLU=''; C_BLD=''; C_RST=''
fi
info() { printf '%s[信息]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()   { printf '%s[成功]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { printf '%s[警告]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; }
die()  { printf '%s[错误]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "未检测到 docker 命令。"
docker compose version >/dev/null 2>&1 || die "未检测到 Docker Compose v2。"
[ -f "$ENV_FILE" ] || die "未找到 .env 配置。请先运行 ./install.sh。"

# 从 .env 读取非敏感参数（口令只在传给容器进程时使用，不打印）
read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}
POSTGRES_USER="$(read_env_value POSTGRES_USER)"
POSTGRES_USER="${POSTGRES_USER:-v2ex}"
POSTGRES_DB="$(read_env_value POSTGRES_DB)"
POSTGRES_DB="${POSTGRES_DB:-v2ex}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

# --- 1. 数据库逻辑备份 -----------------------------------------------------
DB_FILE="$BACKUP_DIR/v2ex-${TIMESTAMP}.sql.gz"
info "备份 PostgreSQL 数据库（${POSTGRES_USER}@${POSTGRES_DB}）..."

# set -o pipefail 保证 pg_dump 失败时脚本立即失败，而不是留下一个截断的空文件。
if docker compose exec -T postgres pg_dump \
      --username="$POSTGRES_USER" \
      --dbname="$POSTGRES_DB" \
      --no-owner --no-acl \
    | gzip -9 > "$DB_FILE"; then
  ok "数据库备份完成：${DB_FILE}"
else
  rm -f "$DB_FILE"
  die "数据库备份失败。请确认 postgres 容器正在运行：docker compose ps"
fi

# --- 2. .env 备份 ----------------------------------------------------------
ENV_BACKUP="$BACKUP_DIR/.env-${TIMESTAMP}"
info "备份 .env 配置..."
cp "$ENV_FILE" "$ENV_BACKUP"
chmod 600 "$ENV_BACKUP" 2>/dev/null || true
ok "配置备份完成：${ENV_BACKUP}（权限 600）"

# --- 3. 输出结果 -----------------------------------------------------------
human_size() {
  local bytes="$1"
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --to=iec --suffix=B "$bytes" 2>/dev/null || echo "${bytes}B"
  else
    echo "${bytes}B"
  fi
}
DB_SIZE="$(wc -c < "$DB_FILE" | tr -d ' ')"
ENV_SIZE="$(wc -c < "$ENV_BACKUP" | tr -d ' ')"

printf '\n%s备份完成%s\n' "$C_BLD" "$C_RST"
printf '  数据库备份 : %s (%s)\n' "$DB_FILE" "$(human_size "$DB_SIZE")"
printf '  配置备份   : %s (%s)\n' "$ENV_BACKUP" "$(human_size "$ENV_SIZE")"
printf '\n'
info "恢复方法：./restore.sh ${DB_FILE}"
info "提醒：备份目录含明文凭据，请勿提交到版本库或上传到公开位置。"
