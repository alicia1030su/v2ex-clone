#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.1 — 升级脚本
#
# 用法：./update.sh
#
# 流程：记录旧镜像 digest → pull 新镜像 → up -d 重建容器 → 对比 digest
#
# 安全约定：
#   - **绝不执行 `docker compose down -v`**（会删数据卷）。
#     只用 `up -d`，Compose 会就地重建容器并保留数据卷。
#   - 升级前建议先跑 ./backup.sh。
#   - 升级过程中若有新旧版本迁移脚本，容器启动时会自动执行（幂等）。
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
HEALTH_TIMEOUT=180

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLU=$'\033[34m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YLW=''; C_BLU=''; C_BLD=''; C_RST=''
fi
info() { printf '%s[信息]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()   { printf '%s[成功]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { printf '%s[警告]%s %s\n' "$C_YLW" "$C_RST" "$*" >&2; }
die()  { printf '%s[错误]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "未检测到 docker 命令。"
docker compose version >/dev/null 2>&1 || die "未检测到 Docker Compose v2。"
[ -f "$ENV_FILE" ] || die "未找到 .env 配置。请先运行 ./install.sh。"

IMAGE_NAME="$(sed -n 's/^V2EX_IMAGE=//p' "$ENV_FILE" | tail -n 1)"
IMAGE_NAME="${IMAGE_NAME:-ghcr.io/alicia1030su/v2ex-clone:v0.0.1}"
APP_PORT="$(sed -n 's/^APP_PORT=//p' "$ENV_FILE" | tail -n 1)"
APP_PORT="${APP_PORT:-3000}"
APP_URL="$(sed -n 's/^APP_URL=//p' "$ENV_FILE" | tail -n 1)"
APP_URL="${APP_URL:-http://localhost:${APP_PORT}}"

# 取本地已缓存镜像的 digest（RepoDigest）。未拉取过时为空。
get_digest() {
  local image="$1"
  docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}<本地无该镜像>{{end}}' "$image" 2>/dev/null || echo '<未知>'
}

OLD_DIGEST="$(get_digest "$IMAGE_NAME")"
OLD_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE_NAME" 2>/dev/null || echo '<未知>')"

printf '%s%s升级 V2EX Clone%s\n' "$C_BLD" "$C_BLU" "$C_RST"
info "目标镜像：${IMAGE_NAME}"
info "升级前 digest：${OLD_DIGEST}"

info "拉取新镜像..."
if ! docker compose pull; then
  warn "docker compose pull 失败，升级中止（现有容器未受影响）。"
  die "拉取镜像失败。请检查网络后重试。"
fi

NEW_DIGEST="$(get_digest "$IMAGE_NAME")"
NEW_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE_NAME" 2>/dev/null || echo '<未知>')"
info "升级后 digest：${NEW_DIGEST}"

info "重建容器（**不删除数据卷**）..."
if ! docker compose up -d; then
  warn "docker compose up -d 失败。最近的日志："
  docker compose logs --tail=100 >&2 || true
  die "升级失败。"
fi

info "等待服务就绪（最长 ${HEALTH_TIMEOUT} 秒）..."
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
ready=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  cid="$(docker compose ps -q app 2>/dev/null || true)"
  if [ -n "$cid" ]; then
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
    if [ "$status" = "healthy" ]; then ready=1; break; fi
    case "$status" in
      exited|dead)
        warn "app 容器已退出。最近的日志："
        docker compose logs --tail=100 app >&2 || true
        die "升级后服务启动失败。"
        ;;
    esac
  fi
  if command -v curl >/dev/null 2>&1 && curl -sf -o /dev/null --max-time 5 "$APP_URL"; then ready=1; break; fi
  sleep 3
done

printf '\n%s镜像对比%s\n' "$C_BLD" "$C_RST"
printf '  升级前 digest : %s\n' "$OLD_DIGEST"
printf '  升级前 imageId: %s\n' "$OLD_ID"
printf '  升级后 digest : %s\n' "$NEW_DIGEST"
printf '  升级后 imageId: %s\n' "$NEW_ID"
if [ "$OLD_ID" = "$NEW_ID" ] && [ "$OLD_ID" != '<未知>' ]; then
  printf '  结果          : 镜像未变化（已是最新）\n'
else
  printf '  结果          : 镜像已更新\n'
fi
printf '\n'

if [ "$ready" -eq 1 ]; then
  ok "升级完成，服务已就绪"
  printf '  访问地址: %s\n\n' "$APP_URL"
else
  warn "等待就绪超时。最近的日志："
  docker compose logs --tail=100 >&2 || true
  die "升级后服务未在预期时间内就绪。"
fi
