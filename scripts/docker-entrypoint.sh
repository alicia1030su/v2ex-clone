#!/bin/sh
# ---------------------------------------------------------------------------
# V2EX Clone — 容器入口脚本
#
# 职责分离（P0-2）：
#   阶段 1  migrate   —— 执行数据库迁移（幂等，每次启动都安全）
#   阶段 2  init      —— **首次**初始化演示数据（仅当库未初始化过）
#   阶段 3  start     —— 启动应用服务
#
# 修复前的问题：
#   Dockerfile 的 CMD 是 `migrate && seed && next start`，seed 在**每次**启动时
#   都会执行。虽然 seed 本身幂等，但：
#     - 管理员口令会被环境变量重置（凭据被静默篡改）
#     - 演示主题/回复会在每次重启时重新插入，污染用户数据
#     - 容器启动强依赖 seed 成功，seed 失败则应用起不来
#
# 本脚本的保证：
#   - 阶段 2 由 scripts/seed.ts 内部的初始化标记（kv_store.segment:initialized）
#     守卫 —— 已初始化的库，重启/重新部署不会碰任何用户数据
#   - 三个阶段互相独立，可单独执行，便于运维排障与分步部署
#
# 用法：
#   docker-entrypoint.sh              # 完整流程（迁移 → 首次初始化 → 启动）
#   docker-entrypoint.sh migrate      # 仅执行迁移
#   docker-entrypoint.sh init         # 仅执行首次初始化（幂等）
#   docker-entrypoint.sh start        # 仅启动应用
# ---------------------------------------------------------------------------
set -e

APP_DIR=/app
cd "$APP_DIR"

log() { echo "[entrypoint] $*"; }
err() { echo "[entrypoint][ERROR] $*" >&2; }

# --- 等待数据库可用 -------------------------------------------------------
wait_for_database() {
  if [ -z "$DATABASE_URL" ]; then
    err "DATABASE_URL 未设置，容器无法启动。"
    exit 1
  fi
  log "等待数据库就绪..."
  attempts=0
  max_attempts=60
  while [ "$attempts" -lt "$max_attempts" ]; do
    if node scripts/wait-for-db.mjs 2>/dev/null; then
      log "数据库就绪。"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 2
  done
  err "数据库在 $((max_attempts * 2)) 秒内未就绪。"
  return 1
}

# --- 阶段 1：数据库迁移 ---------------------------------------------------
run_migrate() {
  log "阶段 1/3：执行数据库迁移..."
  node node_modules/drizzle-kit/bin.cjs migrate
  log "迁移完成。"
}

# --- 阶段 2：首次初始化 ---------------------------------------------------
#
# 守卫逻辑在 scripts/seed.ts 内部（读取 kv_store 的初始化标记）：
#   - 未初始化 → 写入基础数据 + 打标记
#   - 已初始化 → 直接跳过，不触碰任何已有数据
run_init() {
  log "阶段 2/3：检查是否需要首次初始化..."
  if node node_modules/tsx/dist/cli.mjs scripts/seed.ts; then
    log "首次初始化阶段完成。"
  else
    err "首次初始化失败。"
    return 1
  fi
}

# --- 阶段 3：启动应用 -----------------------------------------------------
run_start() {
  log "阶段 3/3：启动应用服务..."
  exec node node_modules/next/dist/bin/next start -p "${PORT:-3000}"
}

case "${1:-all}" in
  migrate)
    wait_for_database
    run_migrate
    ;;
  init)
    wait_for_database
    run_init
    ;;
  start)
    run_start
    ;;
  all)
    wait_for_database
    run_migrate
    run_init
    run_start
    ;;
  *)
    err "未知参数 \"$1\"（可用：all / migrate / init / start）"
    exit 1
    ;;
esac
