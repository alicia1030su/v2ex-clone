#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.12 — 恢复脚本
#
# 用法：
#   ./restore.sh                                  # 恢复最新一次备份
#   ./restore.sh backups/v2ex-20260101-120000.sql.gz
#
# 警告：恢复会**覆盖当前数据库中的同名表**。
#       生产环境请先停服再恢复（./stop.sh）。
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
BACKUP_DIR="$SCRIPT_DIR/backups"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_BLU=$'\033[34m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_BLU=''; C_RST=''
fi
info() { printf '%s[信息]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()   { printf '%s[成功]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { printf '%s[警告]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; }
die()  { printf '%s[错误]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "未检测到 docker 命令。"
docker compose version >/dev/null 2>&1 || die "未检测到 Docker Compose v2。"
[ -f "$ENV_FILE" ] || die "未找到 .env 配置。"

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}
POSTGRES_USER="$(read_env_value POSTGRES_USER)"
POSTGRES_USER="${POSTGRES_USER:-v2ex}"
POSTGRES_DB="$(read_env_value POSTGRES_DB)"
POSTGRES_DB="${POSTGRES_DB:-v2ex}"

# --- 选择备份文件 ---------------------------------------------------------
if [ $# -ge 1 ]; then
  DUMP_FILE="$1"
else
  DUMP_FILE="$(ls -1t "$BACKUP_DIR"/v2ex-*.sql.gz 2>/dev/null | head -n 1 || true)"
  [ -n "$DUMP_FILE" ] || die "在 ${BACKUP_DIR} 下没有找到备份文件。请先运行 ./backup.sh，或显式指定：./restore.sh <文件>"
  info "未指定文件，使用最新的备份：${DUMP_FILE}"
fi
[ -f "$DUMP_FILE" ] || die "备份文件不存在：${DUMP_FILE}"

# --- 恢复前确认 ------------------------------------------------------------
printf '即将把 %s 恢复到数据库 %s（用户 %s）。\n' "$DUMP_FILE" "$POSTGRES_DB" "$POSTGRES_USER"
printf '该操作会覆盖现有数据。确认继续？[y/N] '
read -r reply
case "$reply" in
  y|Y|yes|YES) ;;
  *) die "已取消。" ;;
esac

info "恢复到数据库..."

# --- 恢复前完整性校验（v0.0.8，任务书 §六）---------------------------------
#
# 恢复是最不能失败的时刻 ⇒ **先校验再恢复**：
#   1. gzip 结构校验（gunzip -t）：识别截断/CRC 错误；
#   2. SHA256 核对（若同目录有 .sha256 文件）：识别内容被改动；
#   3. 内容非空：识别「能解压但是空的」备份。
#
# 校验不过 ⇒ **拒绝恢复**（宁可明确报错，也不要把数据库写成半截状态）。
if ! gzip -t "$DUMP_FILE" 2>/dev/null; then
  die "备份文件 gzip 结构损坏（可能被截断）—— 已拒绝恢复。请用其它备份文件。"
fi

SHA_FILE="${DUMP_FILE}.sha256"
if [ -f "$SHA_FILE" ] && command -v sha256sum >/dev/null 2>&1; then
  EXPECTED_SHA="$(awk '{print $1}' "$SHA_FILE" | head -1)"
  ACTUAL_SHA="$(sha256sum "$DUMP_FILE" | awk '{print $1}')"
  if [ -n "$EXPECTED_SHA" ] && [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
    die "备份文件 SHA256 不匹配（期望 ${EXPECTED_SHA}，实际 ${ACTUAL_SHA}）—— 已拒绝恢复。"
  fi
  ok "SHA256 校验通过"
fi

# 内容非空校验：解压后必须有 SQL 内容（表定义或数据）。
#
# ⚠️ 禁止写成 `gzip -cd "$f" | head -c 4096 | grep -q .`（v0.0.9 及更早的写法）。
#    这条流水线在 `set -o pipefail` 下会**假失败**：head / grep 读到足够内容就
#    提前关闭管道，gzip 收到 SIGPIPE（141），pipefail 把整条流水线判为失败 ⇒
#    **一个完全正常的备份被拒绝恢复**。实测 `PIPESTATUS = "141 0 0"`。
#    pg_dump 输出超过管道缓冲（Linux 默认 64 KiB）就必然命中 ——
#    这意味着「数据越多，越恢复不了」，是本脚本最不能有的故障方向。
#
# 正确做法：用**读到 EOF** 的命令统计解压后字节数（不提前关管道），
# 顺带用同一次遍历确认 pg_dump 头（awk 默认读到 EOF，不会触发 SIGPIPE）。
HERE_DUMP_STATS="$(gzip -cd "$DUMP_FILE" 2>/dev/null | awk '
  NR <= 5 && /PostgreSQL database dump/ { hdr = 1 }
  { bytes += length($0) + 1 }
  END { printf "%d %d", bytes, hdr + 0 }')"
DECOMPRESSED_BYTES="${HERE_DUMP_STATS%% *}"
DUMP_HAS_HEADER="${HERE_DUMP_STATS##* }"
DECOMPRESSED_BYTES="${DECOMPRESSED_BYTES:-0}"
DUMP_HAS_HEADER="${DUMP_HAS_HEADER:-0}"

if [ "$DECOMPRESSED_BYTES" -lt 1 ]; then
  die "备份内容为空（解压后 0 字节）—— 已拒绝恢复。"
fi
if [ "$DUMP_HAS_HEADER" != "1" ]; then
  warn "备份内容非空（解压后 ${DECOMPRESSED_BYTES} 字节），但未检出 pg_dump 头，请人工确认该文件"
fi
ok "备份完整性校验通过（解压后 ${DECOMPRESSED_BYTES} 字节）"

# psql 默认在事务中执行，单条 --single-transaction 保证要么全成功要么全回滚。
if gzip -dc "$DUMP_FILE" \
    | docker compose exec -T postgres psql \
        --username="$POSTGRES_USER" \
        --dbname="$POSTGRES_DB" \
        --single-transaction \
        --quiet; then
  ok "恢复完成"
  printf '\n'
  info "重启应用以加载恢复后的数据：./start.sh"
else
  die "恢复失败。请检查备份文件是否完整。"
fi
