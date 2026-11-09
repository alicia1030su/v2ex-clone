#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.13 — 备份脚本
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

# --- 1b. 完整性校验（v0.0.8，任务书 §六「数据库备份完整性校验」）-----------
#
# 一个**能解压但内容被截断**的 .gz 是最危险的备份故障形态：
# 平时看不出来，等到需要恢复时才发现 —— 那正是最不能出故障的时刻。
#
# 这里做两层校验：
#   1. gzip 完整性（gunzip -t）：能检测 CRC 错误 / 截断；
#   2. 内容非空且含 PostgreSQL 头（-- 至少要有 CREATE TABLE / COPY 之类）。
#
# 同时生成 SHA256 校验文件 ⇒ 恢复前可离线核对是否被篡改/损坏。
SHA_FILE="${DB_FILE}.sha256"
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$BACKUP_DIR" && sha256sum "$(basename "$DB_FILE")" > "$(basename "$SHA_FILE")" )
elif command -v shasum >/dev/null 2>&1; then
  ( cd "$BACKUP_DIR" && shasum -a 256 "$(basename "$DB_FILE")" > "$(basename "$SHA_FILE")" )
else
  : > "$SHA_FILE"
fi
if [ -s "$SHA_FILE" ]; then
  ok "校验文件已生成：${SHA_FILE}"
fi

if ! gzip -t "$DB_FILE" 2>/dev/null; then
  rm -f "$DB_FILE" "$SHA_FILE"
  die "备份完整性校验失败（gzip 结构损坏）—— 已删除该备份文件，请重试"
fi

# 内容非空校验：解压后必须有 SQL 内容（表定义或数据）。
#
# ⚠️ 禁止写成 `gzip -cd "$f" | head -c 4096 | grep -q .`（v0.0.9 及更早的写法）。
#
#    在 `set -o pipefail` 下这是一条**假失败**流水线：head / grep 读到足够内容
#    就**提前关闭管道**，还在写数据的 gzip 随即收到 SIGPIPE（退出码 141），
#    pipefail 于是把「整条流水线」判为失败 ⇒ 一个**完全正常**的备份被误判
#    「内容为空」并被删除。
#
#    实测：`PIPESTATUS = "141 0 0"` —— head 与 grep 都成功，只有 gzip 被信号杀死。
#    而 pg_dump 输出一旦超过管道缓冲（Linux 默认 64 KiB）就必然命中，
#    即「数据越多越备份不了」—— 故障方向与用户预期完全相反。
#
# 正确做法：用**读到 EOF** 的命令统计解压后字节数（不提前关管道），
# 顺带用同一次遍历确认 pg_dump 头（awk 默认读到 EOF，同样不会触发 SIGPIPE）。
DUMP_STATS="$(gzip -cd "$DB_FILE" 2>/dev/null | awk '
  NR <= 5 && /PostgreSQL database dump/ { hdr = 1 }
  { bytes += length($0) + 1 }
  END { printf "%d %d", bytes, hdr + 0 }')"
DECOMPRESSED_BYTES="${DUMP_STATS%% *}"
DUMP_HAS_HEADER="${DUMP_STATS##* }"
DECOMPRESSED_BYTES="${DECOMPRESSED_BYTES:-0}"
DUMP_HAS_HEADER="${DUMP_HAS_HEADER:-0}"

if [ "$DECOMPRESSED_BYTES" -lt 1 ]; then
  rm -f "$DB_FILE" "$SHA_FILE"
  die "备份内容为空（解压后 0 字节）—— 已删除该备份文件，请重试"
fi
# pg_dump 一定会写 `-- PostgreSQL database dump` 头；缺失只提示不阻断
# （不同的 pg_dump 版本 / 自定义格式可能存在差异，不因此删掉用户的备份）。
if [ "$DUMP_HAS_HEADER" != "1" ]; then
  warn "备份内容非空（解压后 ${DECOMPRESSED_BYTES} 字节），但未检出 pg_dump 头，请人工确认该文件"
fi
ok "备份完整性校验通过（gzip 结构 + 内容非空：解压后 ${DECOMPRESSED_BYTES} 字节）"

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
