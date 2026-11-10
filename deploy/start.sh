#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.15 — 启动服务
#
# 用法：./start.sh
#
# 与 install.sh 的区别：本脚本**不做首次安装配置**，
# 只负责把已配置好的容器拉起来并等待就绪。
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
HEALTH_TIMEOUT=120

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_BLU=$'\033[34m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_BLU=''; C_RST=''
fi
info() { printf '%s[信息]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()   { printf '%s[成功]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { printf '%s[警告]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; }
die()  { printf '%s[错误]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "未检测到 docker 命令，请先安装 Docker Engine 20.10+。"
docker compose version >/dev/null 2>&1 || die "未检测到 Docker Compose v2（docker compose version 失败）。"
[ -f "$ENV_FILE" ] || die "未找到 .env 配置。请先运行 ./install.sh 完成安装。"

APP_PORT="$(sed -n 's/^APP_PORT=//p' "$ENV_FILE" | tail -n 1)"
APP_PORT="${APP_PORT:-3000}"
APP_URL="$(sed -n 's/^APP_URL=//p' "$ENV_FILE" | tail -n 1)"
APP_URL="${APP_URL:-http://localhost:${APP_PORT}}"

info "启动容器..."
docker compose up -d

info "等待服务就绪（最长 ${HEALTH_TIMEOUT} 秒）..."
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  cid="$(docker compose ps -q app 2>/dev/null || true)"
  if [ -n "$cid" ]; then
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
    if [ "$status" = "healthy" ]; then
      ok "服务已就绪"
      printf '  访问地址: %s\n\n' "$APP_URL"
      exit 0
    fi
    case "$status" in
      exited|dead)
        warn "app 容器已退出。最近的日志："
        docker compose logs --tail=100 app >&2 || true
        die "启动失败。"
        ;;
    esac
  fi
  if command -v curl >/dev/null 2>&1 && curl -sf -o /dev/null --max-time 5 "$APP_URL"; then
    ok "服务已就绪"
    printf '  访问地址: %s\n\n' "$APP_URL"
    exit 0
  fi
  sleep 3
done

warn "等待超时。最近的日志："
docker compose logs --tail=100 >&2 || true
die "服务未在 ${HEALTH_TIMEOUT} 秒内就绪。"
