#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.4 隔离单元测试实例 —— 初始化 / 启动 / 停止 / 状态（**幂等**）
# ---------------------------------------------------------------------------
#
# ## 定位（重要 —— 不要被历史结论误导）
#
# 这个独立实例的价值是**隔离性**与**可复现性**，**不是**性能修复：
#
#   - **隔离性**：不与 `data-v003` 实例（24 个库，含 890MB 压测库 `v2ex_loadtest`、
#     E2E 库、升级基线库）争抢连接数与 I/O；`DROP DATABASE` 不在那个实例上做。
#   - **可复现性**：数据目录 < 200MB、库集合固定、永远是干净的新实例。
#   - **性能**：**不解决**任何性能问题 —— 稳态下 `CREATE DATABASE` 本来就只要
#     2.0~2.3 秒（主理人实测三次：2277 / 1978 / 2243 ms）。
#     历史上有一次观测到 38.6s，那是 **PG 处于 crash recovery / I/O 积压态**
#     时的异常值，**不是**数据目录大小导致的。
#
# ## ⚠️ 绝对禁止
#
#   `_tools/pgsql/data-v003` 是**只读证据**（含 890MB `v2ex_loadtest`、
#   `v2ex_v002_baseline`、`v2ex_v004_audit` 等一手证据）。
#   本脚本用 `case` 守卫**硬拦截**任何指向它的 PGDATA —— 绝不 initdb 覆盖、
#   绝不写入、绝不删库。
#
# ## 用法
#
#   bash tests/helpers/start-test-pg.sh init     # 一次性 initdb（幂等）
#   bash tests/helpers/start-test-pg.sh start    # 启动（幂等；未初始化则先 init）
#   bash tests/helpers/start-test-pg.sh stop     # 停止
#   bash tests/helpers/start-test-pg.sh status   # 状态
#   bash tests/helpers/start-test-pg.sh ready    # 稳态判据（§4.7.1）
#
# ## ⚠️ 生命周期（问题 C）
#
# WorkBuddy 的 Bash 工具在**单次调用结束时回收该次调用派生的进程树**。
# `pg_ctl start` 拉起的 `postgres.exe` 是被调用 shell 的子进程 —— 若那个 shell
# 是本次 Bash 调用的直接子进程，postgres 会随调用结束被终止。
#
# 因此本脚本提供两种存活方式：
#   1. `start` —— 适合「同一次 Bash 调用内完成 启动 → 测试 → 清理」；
#   2. `daemon` —— 后台常驻（自带心跳重启），适合跨多次调用跑测试。
#
# ---------------------------------------------------------------------------
set -uo pipefail

# ── 配置（可用环境变量覆盖）────────────────────────────────────────────
BASE="${V2EX_PG_BASE:-C:/Users/TYMO001/WorkBuddy/ai}"
PGBIN="${V2EX_PG_BIN:-$BASE/_tools/pgsql/pgsql/bin}"
PGDATA="${V2EX_TEST_PGDATA:-$BASE/_tools/pgsql/data-test-v004}"
PORT="${TEST_DB_PORT:-55440}"
LOG="${V2EX_TEST_PG_LOG:-$BASE/_tools/pgsql/pg-test-v004.log}"
PGUSER="${TEST_DB_USER:-v2ex}"
HOST="127.0.0.1"

# 固定的本机测试口令（仅本机隔离实例使用，与任何真实凭据无交集）
PW="${TEST_DB_PASSWORD:-v2ex_test_password_local_only}"

# 证据库拒绝名单 —— 即使白名单将来被误改，这些也一律不删
PROTECTED_DBS="v2ex_loadtest v2ex_v002_baseline v2ex_release_v001 v2ex_visual \
v2ex_e2e v2ex_e2e_v004 v2ex_upg_v004_fresh v2ex_upg_v004_old v2ex_upg_v004_restore \
v2ex_upgrade_src v2ex_mig_idem v2ex_mig_v004 v2ex_v004_audit v2ex_qa_migidem_v004"

# 允许清理的测试库（精确枚举）—— 镜像 tests/helpers/test-db-guard.ts 的
# ALLOWED_DB_NAMES。**两者不一致时以 TS 实现为准。**
DELETE_ALLOWLIST="v2ex_admintest v2ex_v003_admin v2ex_v003_content v2ex_v003_credits \
v2ex_v003_feed v2ex_v003_reset v2ex_floorcont_v004 v2ex_floortest v2ex_rateclear \
v2ex_seedtest v2ex_readiness_probe"

log() { echo "[test-pg] $*"; }
err() { echo "[test-pg] ERROR: $*" >&2; }

# ── 安全守卫：绝不允许指向受保护的数据目录 ───────────────────────────
assert_safe_pgdata() {
  case "$PGDATA" in
    *data-v003*|*"/data"|*"/data/"*|*/data$)
      err "拒绝：PGDATA 指向受保护目录：$PGDATA"
      err "  data-v003 是 v0.0.4 的一手证据（890MB 压测库 + 升级基线 + 审计库），只读保留。"
      exit 1
      ;;
  esac
}

# ── 端口占用检查：只处理「自己的残留」，陌生进程绝不 kill ────────────
check_port_free() {
  local pids
  pids="$(netstat -ano 2>/dev/null | grep "LISTENING" | grep -E ":${PORT} " | awk '{print $NF}' | sort -u)"
  [ -z "$pids" ] && return 0

  for pid in $pids; do
    local cmdline
    cmdline="$(wmic process where "ProcessId=$pid" get CommandLine 2>/dev/null | tr -d '\r')"
    case "$cmdline" in
      *"$PGDATA"*)
        log "清理本方案的残留实例 (PID=$pid)"
        "$PGBIN/pg_ctl.exe" -D "$PGDATA" -m fast stop >/dev/null 2>&1
        ;;
      *)
        err "端口 $PORT 被**非测试进程**占用 (PID=$pid)"
        err "  命令行：$cmdline"
        err "  宁可失败也不误杀陌生进程。请换一个端口：TEST_DB_PORT=55444 bash $0 $1"
        exit 1
        ;;
    esac
  done
}

do_init() {
  assert_safe_pgdata

  if [ -f "$PGDATA/PG_VERSION" ]; then
    log "已存在实例 $PGDATA（PG_VERSION=$(cat "$PGDATA/PG_VERSION")），跳过 initdb"
    return 0
  fi

  [ -x "$PGBIN/initdb.exe" ] || { err "找不到 initdb.exe：$PGBIN/initdb.exe"; exit 1; }

  # 口令只经临时文件传入，绝不落在命令行（会进进程列表）
  local PWF
  PWF="$(mktemp -t pgpw.XXXXXX)"
  printf '%s' "$PW" > "$PWF"
  chmod 600 "$PWF"

  log "initdb：$PGDATA（PG 17.5，独立数据目录）"
  "$PGBIN/initdb.exe" \
    -D "$PGDATA" \
    -U "$PGUSER" \
    --pwfile="$PWF" \
    -E UTF8 \
    --locale="Chinese (Simplified)_China.936" \
    --data-checksums \
    -c "listen_addresses=127.0.0.1" \
    -c "port=$PORT" \
    -c "unix_socket_directories=" \
    -c "fsync=on" \
    -c "shared_buffers=32MB" \
    -c "max_wal_size=256MB" \
    -c "checkpoint_timeout=5min" \
    -c "log_checkpoints=on" \
    -c "log_min_duration_statement=2000"
  local rc=$?

  rm -f "$PWF"
  [ $rc -eq 0 ] || { err "initdb 失败（exit=$rc）"; exit $rc; }
  log "initdb 完成：$PGDATA"
}

do_start() {
  assert_safe_pgdata

  if "$PGBIN/pg_isready.exe" -h "$HOST" -p "$PORT" -q 2>/dev/null; then
    log "实例已在运行：$HOST:$PORT"
    return 0
  fi

  [ -f "$PGDATA/PG_VERSION" ] || { log "实例未初始化，先执行 initdb"; do_init; }

  check_port_free

  log "启动实例：$HOST:$PORT（数据目录 $PGDATA）"
  "$PGBIN/pg_ctl.exe" -D "$PGDATA" -l "$LOG" -o "-p $PORT" -w start || exit 1
  "$PGBIN/pg_isready.exe" -h "$HOST" -p "$PORT" -U "$PGUSER" || exit 1

  # 判据 A：日志静态检查（recovery / fsync 积压痕迹）
  if grep -aq "正在自动恢复状态\|syncing data directory" "$LOG" 2>/dev/null; then
    log "⚠️ 检测到 recovery / fsync 积压痕迹，等待稳态…"
    for _ in $(seq 1 60); do
      grep -aq "数据库系统已就绪" "$LOG" 2>/dev/null && break
      sleep 5
    done
  fi

  log "隔离测试实例就绪：$HOST:$PORT"
}

do_stop() {
  assert_safe_pgdata
  if "$PGBIN/pg_ctl.exe" -D "$PGDATA" status >/dev/null 2>&1; then
    log "停止实例：$PGDATA"
    "$PGBIN/pg_ctl.exe" -D "$PGDATA" -m fast stop >/dev/null 2>&1
  else
    log "实例未在运行"
  fi
}

do_status() {
  echo "PGDATA : $PGDATA"
  echo "PORT   : $PORT"
  echo "BIN    : $PGBIN"
  if "$PGBIN/pg_ctl.exe" -D "$PGDATA" status 2>&1 | head -3; then :; fi
  "$PGBIN/pg_isready.exe" -h "$HOST" -p "$PORT" -U "$PGUSER" 2>&1 || true
}

# ── 判据 B：空库建删往返（最有价值的稳态探针）──────────────────────
do_ready() {
  assert_safe_pgdata
  "$PGBIN/pg_isready.exe" -h "$HOST" -p "$PORT" -U "$PGUSER" >/dev/null || {
    err "PG 未就绪（$HOST:$PORT）—— 这是**环境问题**，不是产品缺陷。"; exit 1;
  }

  local start end probe_ms
  start=$(date +%s%3N)
  "$PGBIN/psql.exe" -h "$HOST" -p "$PORT" -U "$PGUSER" -d postgres -q \
    -c 'DROP DATABASE IF EXISTS "v2ex_readiness_probe" WITH (FORCE)' >/dev/null 2>&1
  "$PGBIN/psql.exe" -h "$HOST" -p "$PORT" -U "$PGUSER" -d postgres -q \
    -c 'CREATE DATABASE "v2ex_readiness_probe"' >/dev/null 2>&1 || {
      err "探针库创建失败"; exit 1; }
  "$PGBIN/psql.exe" -h "$HOST" -p "$PORT" -U "$PGUSER" -d postgres -q \
    -c 'DROP DATABASE IF EXISTS "v2ex_readiness_probe" WITH (FORCE)' >/dev/null 2>&1
  end=$(date +%s%3N)
  probe_ms=$((end - start))

  log "空库建删往返 = ${probe_ms} ms（阈值 10000 ms）"
  if [ "$probe_ms" -ge 10000 ]; then
    err "PG **未进入稳态**（探针 ${probe_ms} ms ≥ 10000 ms）"
    err "  这是**环境问题**（PG 处于 crash recovery / I/O 积压态），**不记为测试失败**。"
    err "  处置：等待稳态后重测；查日志里的 \"syncing data directory\" / \"redo\" 段。"
    exit 1
  fi
  log "✅ PG 已进入稳态"
}

# ── 幂等清理：只删命中精确白名单的库（证据库一律跳过）──────────────
do_cleanup() {
  assert_safe_pgdata
  "$PGBIN/pg_isready.exe" -h "$HOST" -p "$PORT" -q 2>/dev/null || {
    log "实例未运行，跳过清理"; return 0; }

  "$PGBIN/psql.exe" -h "$HOST" -p "$PORT" -U "$PGUSER" -d postgres -t -A \
    -c "select datname from pg_database" 2>/dev/null \
  | while read -r db; do
    [ -z "$db" ] && continue
    case " $PROTECTED_DBS " in *" $db "*) log "跳过证据库 $db"; continue ;; esac
    case " $DELETE_ALLOWLIST " in
      *" $db "*) ;;
      *) case "$db" in v2ex_test_*) ;; *) continue ;; esac ;;
    esac
    log "清理测试库 $db"
    "$PGBIN/psql.exe" -h "$HOST" -p "$PORT" -U "$PGUSER" -d postgres -q \
      -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>&1
  done
}

# ── 后台常驻守护（跨 Bash 调用存活）─────────────────────────────────
do_daemon() {
  assert_safe_pgdata
  do_start
  log "进入守护循环（检测到实例停止则自动拉起）"
  while true; do
    if ! "$PGBIN/pg_ctl.exe" -D "$PGDATA" status >/dev/null 2>&1; then
      log "PG 已停止，重新拉起"
      "$PGBIN/pg_ctl.exe" -D "$PGDATA" -l "$LOG" -o "-p $PORT" -w start >/dev/null 2>&1
    fi
    sleep 10
  done
}

case "${1:-start}" in
  init)    do_init ;;
  start)   do_start ;;
  stop)    do_stop ;;
  status)  do_status ;;
  ready)   do_ready ;;
  cleanup) do_cleanup ;;
  daemon)  do_daemon ;;
  *)
    err "用法：bash $0 {init|start|stop|status|ready|cleanup|daemon}"
    exit 2
    ;;
esac
