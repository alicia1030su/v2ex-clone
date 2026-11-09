#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.14 — 停止服务
#
# 用法：./stop.sh
#
# ---------------------------------------------------------------------------
# 重要说明（请勿随意改动本脚本）
#
#   本脚本使用 `docker compose stop`，**刻意不使用** `docker compose down`，
#   更不会使用 `docker compose down -v`。
#
#   原因：
#     `docker compose down -v` 会**删除数据卷**（postgres-data / redis-data），
#     用户的帖子、回复、账号、收藏将全部永久丢失，且无法通过本脚本找回。
#     `docker compose down`（不带 -v）同样会移除容器与默认网络，
#     虽然卷默认保留，但对普通用户来说仍多一层不确定性。
#
#   `docker compose stop` 只停止容器，保留容器、镜像与数据卷，
#   之后 `./start.sh` 可原地恢复，数据零损失。
#
#   如果你确实想删除全部数据，请手动执行（**该操作不可逆**）：
#     docker compose down -v
#   建议在执行前先跑 ./backup.sh 备份数据库。
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_BLU=$'\033[34m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_BLU=''; C_RST=''
fi
info() { printf '%s[信息]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()   { printf '%s[成功]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
die()  { printf '%s[错误]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "未检测到 docker 命令。"
docker compose version >/dev/null 2>&1 || die "未检测到 Docker Compose v2。"
[ -f "$SCRIPT_DIR/.env" ] || die "未找到 .env 配置。若服务未安装过，无需停止。"

info "停止容器（保留数据卷）..."
docker compose stop

ok "服务已停止。数据卷已保留，可随时用 ./start.sh 恢复。"
info "提示：如需彻底删除数据，请手动执行 'docker compose down -v'（不可逆，建议先备份）。"
