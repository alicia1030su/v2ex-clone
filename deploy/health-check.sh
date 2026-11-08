#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.12 — 运维体检脚本
#
# 用途：**不依赖应用进程**的独立健康巡检（任务书 §六）。
# 可以放进 cron / systemd timer / 监控探针里。
#
# 检查项：
#   1. 容器状态与健康（app / postgres / redis）
#   2. 应用就绪探针（/api/health/ready）
#   3. 数据库与 Redis 可用性
#   4. 磁盘空间（低于阈值告警）
#   5. 备份存在性与完整性（gzip 结构 + SHA256）
#   6. 最近一次备份的时间（超过 N 天告警）
#
# 用法：
#   ./health-check.sh            # 检查并输出报告
#   ./health-check.sh --quiet    # 只输出问题（供 cron / 监控用）
#
# 退出码：
#   0 = 全部正常
#   1 = 存在告警或错误
#
# 安全：不打印任何口令/令牌/Cookie；DB 口令只用于本地 exec，不回显。
# ---------------------------------------------------------------------------

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
BACKUP_DIR="$SCRIPT_DIR/backups"

# 阈值
DISK_WARN_PERCENT="${DISK_WARN_PERCENT:-85}"   # 磁盘使用率超过 85% 告警
BACKUP_STALE_DAYS="${BACKUP_STALE_DAYS:-7}"    # 备份超过 7 天未更新告警
APP_PORT="${APP_PORT:-3000}"

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

PROBLEMS=0
WARNINGS=0

if [ -t 1 ] && [ "$QUIET" -eq 0 ]; then
  C_RED=$'\033[31m'; C_YEL=$'\033[33m'; C_GRN=$'\033[32m'
  C_RST=$'\033[0m'; C_BLD=$'\033[1m'
else
  C_RED=''; C_YEL=''; C_GRN=''; C_RST=''; C_BLD=''
fi

info() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }
ok()   { [ "$QUIET" -eq 1 ] || printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { WARNINGS=$((WARNINGS+1)); printf '  %s!%s %s\n' "$C_YEL" "$C_RST" "$*" >&2; }
err()  { PROBLEMS=$((PROBLEMS+1));  printf '  %s✗%s %s\n' "$C_RED" "$C_RST" "$*" >&2; }

# 从 .env 读值（不 source，避免执行任意内容）
read_env_value() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'"'"']//; s/["'"'"']$//'
}

cd "$SCRIPT_DIR" || exit 1

printf '%s运维体检%s  %s\n' "$C_BLD" "$C_RST" "$(date '+%Y-%m-%d %H:%M:%S')"

# --- 1. Docker 与容器状态 ---------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  err "未检测到 docker 命令 —— 无法巡检"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  err "未检测到 Docker Compose v2"
  exit 1
fi

info ""
info "${C_BLD}容器状态${C_RST}"
for svc in app postgres redis; do
  cid="$(docker compose --env-file "$ENV_FILE" ps -q "$svc" 2>/dev/null | head -1)"
  if [ -z "$cid" ]; then
    err "$svc 容器不存在（未启动？）"
    continue
  fi
  state="$(docker inspect --format '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)"
  if [ "$state" != "running" ]; then
    err "$svc 状态=$state"
  elif [ "$health" = "unhealthy" ]; then
    err "$svc 状态=running 但健康检查失败（unhealthy）"
  elif [ "$health" = "none" ]; then
    ok "$svc 状态=running（无健康检查）"
  else
    ok "$svc 状态=running 健康=$health"
  fi
done

# --- 2. 应用就绪探针 --------------------------------------------------------
info ""
info "${C_BLD}应用就绪${C_RST}"
READY_CODE="$(curl -s -o /tmp/v2ex-health.json -w '%{http_code}' --max-time 8 "http://127.0.0.1:${APP_PORT}/api/health/ready" 2>/dev/null || echo 000)"
if [ "$READY_CODE" = "200" ]; then
  ok "就绪探针 HTTP 200"
elif [ "$READY_CODE" = "503" ]; then
  err "就绪探针 HTTP 503（数据库或 Redis 不可达）"
else
  err "就绪探针不可达（HTTP ${READY_CODE}）"
fi

# --- 3. 数据库与 Redis ------------------------------------------------------
info ""
info "${C_BLD}依赖可用性${C_RST}"
DB_USER="$(read_env_value POSTGRES_USER)"; DB_USER="${DB_USER:-v2ex}"
DB_NAME="$(read_env_value POSTGRES_DB)"; DB_NAME="${DB_NAME:-v2ex}"
if docker compose --env-file "$ENV_FILE" exec -T postgres \
     pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
  ok "PostgreSQL 可用"
else
  err "PostgreSQL 不可用"
fi
REDIS_PASSWORD="$(read_env_value REDIS_PASSWORD)"
if [ -n "$REDIS_PASSWORD" ]; then
  if docker compose --env-file "$ENV_FILE" exec -T redis \
       redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q PONG; then
    ok "Redis 可用"
  else
    err "Redis 不可用"
  fi
else
  info "  （未配置 REDIS_PASSWORD，跳过 Redis 检查）"
fi

# --- 4. 磁盘空间 ------------------------------------------------------------
info ""
info "${C_BLD}磁盘空间${C_RST}"
check_disk() {
  local path="$1" label="$2"
  local usage
  usage="$(df -P "$path" 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
  if [ -z "$usage" ]; then
    warn "$label 磁盘信息不可用"
    return
  fi
  if [ "$usage" -ge "$DISK_WARN_PERCENT" ]; then
    err "$label 磁盘使用率 ${usage}% ≥ ${DISK_WARN_PERCENT}%（空间不足风险）"
  else
    ok "$label 磁盘使用率 ${usage}%"
  fi
}
check_disk "$SCRIPT_DIR" "安装目录"
check_disk "/var/lib/docker" "Docker 数据目录" 2>/dev/null || true

# --- 5 & 6. 备份存在性与完整性 ---------------------------------------------
info ""
info "${C_BLD}备份${C_RST}"
LATEST="$(ls -t "$BACKUP_DIR"/v2ex-*.sql.gz 2>/dev/null | head -1)"
if [ -z "$LATEST" ]; then
  err "没有任何备份文件（$BACKUP_DIR）—— 建议立即执行 ./backup.sh"
else
  ok "最新备份：$(basename "$LATEST")（$(date -r "$LATEST" '+%Y-%m-%d %H:%M')）"

  if gzip -t "$LATEST" 2>/dev/null; then
    ok "gzip 结构完整"
  else
    err "备份文件 gzip 结构损坏（可能被截断）"
  fi

  SHA_FILE="${LATEST}.sha256"
  if [ -f "$SHA_FILE" ] && command -v sha256sum >/dev/null 2>&1; then
    EXPECTED="$(awk '{print $1}' "$SHA_FILE" | head -1)"
    ACTUAL="$(sha256sum "$LATEST" | awk '{print $1}')"
    if [ "$EXPECTED" = "$ACTUAL" ]; then
      ok "SHA256 校验通过"
    else
      err "SHA256 不匹配（备份可能被改动）"
    fi
  else
    warn "没有 .sha256 校验文件（本次备份之前生成，或工具不可用）"
  fi

  AGE_DAYS=$(( ( $(date +%s) - $(date -r "$LATEST" +%s) ) / 86400 ))
  if [ "$AGE_DAYS" -ge "$BACKUP_STALE_DAYS" ]; then
    err "最新备份已 ${AGE_DAYS} 天未更新（阈值 ${BACKUP_STALE_DAYS} 天）"
  else
    ok "备份新鲜度 ${AGE_DAYS} 天"
  fi
fi

# --- 汇总 -------------------------------------------------------------------
printf '\n'
if [ "$PROBLEMS" -gt 0 ]; then
  printf '%s体检结果：%s 个错误、%s 个告警%s\n' "$C_RED" "$PROBLEMS" "$WARNINGS" "$C_RST"
  exit 1
elif [ "$WARNINGS" -gt 0 ]; then
  printf '%s体检结果：全部关键项正常，%s 个告警%s\n' "$C_YEL" "$WARNINGS" "$C_RST"
  exit 0
else
  printf '%s体检结果：全部正常%s\n' "$C_GRN" "$C_RST"
  exit 0
fi
