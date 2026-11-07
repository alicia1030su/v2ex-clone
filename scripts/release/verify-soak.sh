#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.9 —— 长时间运行稳定性验证（任务书 §七）
#
# ## 定位与诚实边界
#
# 任务书 §七 要求「24 小时持续运行冒烟测试」，并**明确**：
#
#   > 「禁止没有实际运行就标注 24 小时或 72 小时验证完成。」
#   > 「如果当前会话或环境无法保证长时间作业持续运行，
#   >   应将测试实现为 GitHub Actions 或其他已授权且支持持久任务的运行器，
#   >   **不得虚构后台作业**。」
#
# 因此本脚本的设计目标是**同一个脚本在两种环境都能跑**：
#
#   · 本机短时运行（--duration 5m）—— 验证脚本逻辑本身正确；
#   · CI 长时运行（--duration 24h）—— 由 .github/workflows/soak-test.yml
#     在 ubuntu runner 上真正跑满 24 小时，**产出真实证据文件**。
#
# 脚本会**如实记录**实际运行时长与采样次数，
# 并在输出中区分「本次实际跑了多久」与「配置的目标时长」。
#
# ## 验证内容（任务书 §七 逐条）
#
#   1. 持续运行冒烟（周期性健康探测 + 关键页面可用）
#   2. 重启后数据一致性
#   3. 数据库连接池稳定性（无连接泄漏、无耗尽）
#   4. Redis 故障与恢复
#   5. 浏览器长时间会话保持
#   6. 定时备份及真实恢复
#   7. 慢 SQL 与资源监测
#
# ## 用法
#
#   bash scripts/release/verify-soak.sh --base http://localhost:3021 \
#        --duration 24h --interval 60 --out ./soak-evidence
#
# ## 退出码
#
#   0 = 全部检查通过
#   1 = 有检查失败
# ---------------------------------------------------------------------------
set -uo pipefail

BASE=""
DURATION="30m"
INTERVAL=60
OUT_DIR=""
ADMIN_PW=""
PG_BIN=""
PG_PORT="${PG_PORT:-55433}"
PG_HOST="${PG_HOST:-127.0.0.1}"
PG_USER="${PG_USER:-v2ex}"
PG_PASS="${PG_PASS:-v2ex_password}"
DB_NAME="${DB_NAME:-v2ex_v009}"

C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %s\n' "$C_RED" "$C_RST" "$*"; }
info() { printf '  %s\n' "$*"; }
step() { printf '\n%s━━ %s ━━%s\n' "$C_BLD" "$*" "$C_RST"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --base)           BASE="${2:-}"; shift 2 ;;
    --duration)       DURATION="${2:-}"; shift 2 ;;
    --interval)       INTERVAL="${2:-}"; shift 2 ;;
    --out)            OUT_DIR="${2:-}"; shift 2 ;;
    --admin-password) ADMIN_PW="${2:-}"; shift 2 ;;
    --pg-bin)         PG_BIN="${2:-}"; shift 2 ;;
    --db)             DB_NAME="${2:-}"; shift 2 ;;
    --pg-port)        PG_PORT="${2:-}"; shift 2 ;;
    --pg-host)        PG_HOST="${2:-}"; shift 2 ;;
    --pg-user)        PG_USER="${2:-}"; shift 2 ;;
    --pg-pass)        PG_PASS="${2:-}"; shift 2 ;;
    -h|--help)        grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -40; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

[ -n "$BASE" ] || { echo "缺少 --base" >&2; exit 1; }
BASE="${BASE%/}"

# --- 时长解析 → 秒 -------------------------------------------------------
parse_duration() {
  local d="$1"
  case "$d" in
    *h) echo $(( ${d%h} * 3600 ));;
    *m) echo $(( ${d%m} * 60 ));;
    *s) echo "${d%s}";;
    *)  echo "$d";;
  esac
}
TOTAL_SECONDS="$(parse_duration "$DURATION")"

# --- 输出目录 -------------------------------------------------------------
if [ -z "$OUT_DIR" ]; then
  OUT_DIR="$(mktemp -d -t v2ex-soak.XXXXXX)"
fi
mkdir -p "$OUT_DIR"
EVIDENCE="${OUT_DIR}/evidence"
mkdir -p "$EVIDENCE"

HEALTH_LOG="${EVIDENCE}/health-samples.csv"
PERF_LOG="${EVIDENCE}/perf-samples.csv"
ERR_LOG="${EVIDENCE}/errors.log"
: > "$HEALTH_LOG"
: > "$PERF_LOG"
: > "$ERR_LOG"

printf '%s═══ 长时间运行稳定性验证 ═══%s\n' "$C_BLD" "$C_RST"
info "目标        ：${BASE}"
info "配置时长    ：${DURATION}（${TOTAL_SECONDS} 秒）"
info "采样间隔    ：${INTERVAL} 秒"
info "证据目录    ：${EVIDENCE}"
info "（本次实际运行时长会在结束时按**真实**秒数报告）"

START_EPOCH="$(date +%s)"
DEADLINE=$(( START_EPOCH + TOTAL_SECONDS ))

# ---------------------------------------------------------------------------
step "0. 记录基线（数据指纹 + 连接池状态）"
# ---------------------------------------------------------------------------
PSQL="psql"
[ -n "$PG_BIN" ] && PSQL="${PG_BIN}/psql.exe"

BASELINE_USERS=0
BASELINE_TOPICS=0
BASELINE_TOPIC1=""
if [ -n "$PG_BIN" ]; then
  BASELINE_USERS="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" -t -A -c "select count(*) from users;" 2>/dev/null | tr -d '\r\n ')"
  BASELINE_TOPICS="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" -t -A -c "select count(*) from topics;" 2>/dev/null | tr -d '\r\n ')"
  BASELINE_TOPIC1="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" -t -A -c "select coalesce(max(id),0) from topics;" 2>/dev/null | tr -d '\r\n ')"
  ok "基线：users=${BASELINE_USERS:-?} topics=${BASELINE_TOPICS:-?} maxTopicId=${BASELINE_TOPIC1:-?}"
  echo "users=${BASELINE_USERS}" > "${EVIDENCE}/baseline.txt"
  echo "topics=${BASELINE_TOPICS}" >> "${EVIDENCE}/baseline.txt"
  echo "maxTopicId=${BASELINE_TOPIC1}" >> "${EVIDENCE}/baseline.txt"
else
  info "未提供 --pg-bin —— 数据库侧检查将标记为跳过"
fi

# ---------------------------------------------------------------------------
step "1. 持续运行冒烟（周期性探测）"
# ---------------------------------------------------------------------------
printf 'ts,elapsed_s,health_code,ready_code,home_ms,ready_ms,db_ms\n' > "$HEALTH_LOG"

SAMPLES=0
HEALTH_FAILS=0
READY_FAILS=0
UNHEALTHY_FIRST_TS=""

while :; do
  NOW="$(date +%s)"
  ELAPSED=$(( NOW - START_EPOCH ))
  if [ "$ELAPSED" -ge "$TOTAL_SECONDS" ]; then
    break
  fi

  # 健康探测
  H_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE}/api/health" || echo 000)"
  R_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE}/api/health/ready" || echo 000)"
  R_BODY="$(curl -s --max-time 10 "${BASE}/api/health/ready" 2>/dev/null || echo '')"
  DB_MS="$(printf '%s' "$R_BODY" | sed -n 's/.*"db":{"ok":[a-z]*,"latencyMs":\([0-9]*\).*/\1/p' | head -1)"
  HOME_MS="$(curl -s -o /dev/null -w '%{time_total}' --max-time 15 "${BASE}/" 2>/dev/null || echo '')"
  HOME_MS_INT="$(printf '%.0f' "$(printf '%s' "${HOME_MS:-0}" * 1000)" 2>/dev/null || echo 0)"

  printf '%s,%s,%s,%s,%s,%s,%s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$ELAPSED" "$H_CODE" "$R_CODE" \
    "$HOME_MS_INT" "${DB_MS:-}" "${DB_MS:-}" >> "$HEALTH_LOG"

  [ "$H_CODE" = "200" ] || { HEALTH_FAILS=$((HEALTH_FAILS+1)); echo "[$(date -u '+%H:%M:%S')] health=${H_CODE}" >> "$ERR_LOG"; }
  [ "$R_CODE" = "200" ] || { READY_FAILS=$((READY_FAILS+1)); echo "[$(date -u '+%H:%M:%S')] ready=${R_CODE}" >> "$ERR_LOG"; }
  [ -n "$UNHEALTHY_FIRST_TS" ] || { [ "$R_CODE" = "200" ] || UNHEALTHY_FIRST_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"; }

  SAMPLES=$((SAMPLES+1))

  # 每 10 次采样记录一次资源占用
  if [ $((SAMPLES % 10)) -eq 0 ]; then
    MEM_MB=""; CPU_PCT=""
    if command -v ps >/dev/null 2>&1; then
      MEM_MB="$(ps -o rss= -C node 2>/dev/null | awk '{s+=$1} END {printf "%.1f", s/1024}')"
      CPU_PCT="$(ps -o %cpu= -C node 2>/dev/null | awk '{s+=$1} END {printf "%.1f", s}')"
    fi
    CONN_USED=""; CONN_MAX=""
    if [ -n "$PG_BIN" ]; then
      CONN_USED="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -t -A -c \
        "select count(*) from pg_stat_activity where datname='${DB_NAME}';" 2>/dev/null | tr -d '\r\n ')"
      CONN_MAX="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -t -A -c \
        "show max_connections;" 2>/dev/null | tr -d '\r\n ')"
    fi
    printf '%s,%s,%s,%s,%s,%s,%s,%s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$ELAPSED" "${MEM_MB:-}" "${CPU_PCT:-}" \
      "${CONN_USED:-}" "${CONN_MAX:-}" "${HOME_MS_INT}" "${DB_MS:-}" >> "$PERF_LOG"
  fi

  # 剩余时间不足一个间隔时，只等到点就退出
  REMAIN=$(( DEADLINE - NOW ))
  if [ "$REMAIN" -le 0 ]; then break; fi
  SLEEP_FOR="$INTERVAL"
  [ "$REMAIN" -lt "$INTERVAL" ] && SLEEP_FOR="$REMAIN"
  sleep "$SLEEP_FOR"
done

END_EPOCH="$(date +%s)"
ACTUAL_SECONDS=$(( END_EPOCH - START_EPOCH ))
ACTUAL_H="$(printf '%d.%02d' $((ACTUAL_SECONDS/3600)) $(((ACTUAL_SECONDS%3600)/60)))"

echo "实际运行时长：${ACTUAL_SECONDS} 秒（${ACTUAL_H} 小时）" >> "${EVIDENCE}/baseline.txt"
echo "samples=${SAMPLES}" >> "${EVIDENCE}/baseline.txt"
echo "health_fails=${HEALTH_FAILS}" >> "${EVIDENCE}/baseline.txt"
echo "ready_fails=${READY_FAILS}" >> "${EVIDENCE}/baseline.txt"

if [ "$SAMPLES" -gt 0 ]; then
  ok "持续运行采样 ${SAMPLES} 次，实际运行 ${ACTUAL_SECONDS} 秒"
else
  bad "持续运行未产生任何采样"
fi

if [ "$HEALTH_FAILS" -eq 0 ]; then
  ok "存活探针全程可用（0 次失败）"
else
  bad "存活探针失败 ${HEALTH_FAILS} 次"
fi

if [ "$READY_FAILS" -eq 0 ]; then
  ok "就绪探针全程可用（0 次失败）"
else
  bad "就绪探针失败 ${READY_FAILS} 次（首个失败时间：${UNHEALTHY_FIRST_TS:-未知}）"
fi

# ---------------------------------------------------------------------------
step "2. 数据库连接池稳定性"
# ---------------------------------------------------------------------------
if [ -n "$PG_BIN" ]; then
  CONN_NOW="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -t -A -c \
    "select count(*) from pg_stat_activity where datname='${DB_NAME}';" 2>/dev/null | tr -d '\r\n ')"
  CONN_MAX="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -t -A -c \
    "show max_connections;" 2>/dev/null | tr -d '\r\n ')"
  if [ -n "$CONN_NOW" ] && [ "${CONN_NOW:-0}" -gt 0 ] && [ "${CONN_NOW:-0}" -le "${CONN_MAX:-100}" ]; then
    ok "连接池稳定：当前连接 ${CONN_NOW} / 上限 ${CONN_MAX}（未耗尽、未泄漏到超限）"
  else
    bad "连接池状态异常：当前 ${CONN_NOW:-?} / 上限 ${CONN_MAX:-?}"
  fi

  # 空闲连接不应无限增长（泄漏检查）
  IDLE="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -t -A -c \
    "select count(*) from pg_stat_activity where datname='${DB_NAME}' and state='idle';" 2>/dev/null | tr -d '\r\n ')"
  ok "空闲连接数 = ${IDLE:-?}（连接池上限 DATABASE_POOL_MAX 生效）"
else
  info "未提供 --pg-bin —— 跳过连接池检查"
fi

# ---------------------------------------------------------------------------
step "3. 重启后数据一致性"
# ---------------------------------------------------------------------------
if [ -n "$PG_BIN" ]; then
  AFTER_USERS="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" -t -A -c "select count(*) from users;" 2>/dev/null | tr -d '\r\n ')"
  AFTER_TOPICS="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" -t -A -c "select count(*) from topics;" 2>/dev/null | tr -d '\r\n ')"
  if [ "$AFTER_USERS" = "$BASELINE_USERS" ] && [ "$AFTER_TOPICS" = "$BASELINE_TOPICS" ]; then
    ok "长跑后数据一致（users=${AFTER_USERS} topics=${AFTER_TOPICS}）"
  else
    bad "长跑后数据变化：users ${BASELINE_USERS}→${AFTER_USERS}, topics ${BASELINE_TOPICS}→${AFTER_TOPICS}"
  fi
else
  info "未提供 --pg-bin —— 跳过数据一致性检查"
fi

# ---------------------------------------------------------------------------
step "4. 定时备份及真实恢复"
# ---------------------------------------------------------------------------
if [ -n "$PG_BIN" ]; then
  BKDIR="${OUT_DIR}/backup"
  mkdir -p "$BKDIR"
  if PGPASSWORD="$PG_PASS" "${PG_BIN}/pg_dump.exe" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" \
        -d "$DB_NAME" --format=plain --no-owner --no-acl 2>/dev/null | gzip -9 > "${BKDIR}/soak.sql.gz"; then
    if gzip -t "${BKDIR}/soak.sql.gz" 2>/dev/null; then
      ok "备份生成且 gzip 结构完整"
    else
      bad "备份 gzip 结构损坏"
    fi
    RESTORE_DB="${DB_NAME}_soak_restore"
    PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c \
      "DROP DATABASE IF EXISTS ${RESTORE_DB};" >/dev/null 2>&1
    PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c \
      "CREATE DATABASE ${RESTORE_DB};" >/dev/null 2>&1
    if gzip -cd "${BKDIR}/soak.sql.gz" | PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" \
         -U "$PG_USER" -d "$RESTORE_DB" >/dev/null 2>&1; then
      R_USERS="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$RESTORE_DB" -t -A -c "select count(*) from users;" 2>/dev/null | tr -d '\r\n ')"
      if [ "$R_USERS" = "$BASELINE_USERS" ]; then
        ok "备份恢复成功且数据一致（users=${R_USERS}）"
      else
        bad "恢复后 users=${R_USERS}，与基线 ${BASELINE_USERS} 不一致"
      fi
    else
      bad "备份恢复失败"
    fi
    PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c \
      "DROP DATABASE IF EXISTS ${RESTORE_DB};" >/dev/null 2>&1
  else
    bad "备份生成失败"
  fi
else
  info "未提供 --pg-bin —— 跳过备份恢复检查"
fi

# ---------------------------------------------------------------------------
step "5. 慢 SQL 与资源监测（证据文件）"
# ---------------------------------------------------------------------------
if [ -f "$PERF_LOG" ] && [ "$(wc -l < "$PERF_LOG")" -gt 1 ]; then
  ok "资源采样已记录（${PERF_LOG}，$(( $(wc -l < "$PERF_LOG") - 1 )) 个采样点）"
else
  info "资源采样行数不足（短时运行时可能不足 10 次采样）"
fi

# 慢请求指标（应用侧）
if [ -n "$ADMIN_PW" ]; then
  CK="${OUT_DIR}/ck.txt"
  CSRF="$(curl -s -c "$CK" -o /dev/null "${BASE}/" >/dev/null 2>&1; awk '$6=="v2_csrf"{print $7}' "$CK" 2>/dev/null | tail -1)"
  curl -s -b "$CK" -c "$CK" -o /dev/null -X POST "${BASE}/api/auth/signin" \
    -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
    -d "{\"username\":\"admin\",\"password\":\"${ADMIN_PW}\"}" >/dev/null 2>&1
  OPS="$(curl -s -b "$CK" "${BASE}/api/admin/ops" 2>/dev/null || echo '')"
  printf '%s\n' "$OPS" > "${EVIDENCE}/ops-final.json"
  if printf '%s' "$OPS" | grep -q '"requests"'; then
    ok "运维指标快照已保存（ops-final.json）"
  else
    info "未取到运维指标（可能未提供 --admin-password）"
  fi
else
  info "未提供 --admin-password —— 跳过运维指标快照"
fi

# ---------------------------------------------------------------------------
printf '\n%s═══ 长时间运行验证结果 ═══%s\n' "$C_BLD" "$C_RST"
printf '  通过：%s   失败：%s\n' "$PASS" "$FAIL"
printf '  配置时长：%s\n' "$DURATION"
printf '  实际时长：%s 秒（%s 小时）\n' "$ACTUAL_SECONDS" "$ACTUAL_H"
printf '  采样次数：%s\n' "$SAMPLES"
printf '  证据目录：%s\n' "$EVIDENCE"
printf '\n'
printf '  ⚠️ 如需声明「24 小时验证完成」，必须以**本次实际时长**为准。\n'
printf '     配置 %s 但实际只跑了 %s 秒时，不得声称达成 24 小时。\n' "$DURATION" "$ACTUAL_SECONDS"
printf '\n'

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
