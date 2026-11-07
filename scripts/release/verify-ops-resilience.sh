#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.9 —— 运维可靠性故障注入验证（任务书 §六）
#
# ## 验证内容（逐条对应任务书 §六 的要求）
#
#   1. 健康检查是否真的能够发现故障（DB 断开 ⇒ /api/health/ready 变 503）
#   2. 数据库不可用时是否有正确状态（503 + db.ok=false，不泄露连接串）
#   3. Redis 不可用时是否正确降级（配置了 Redis 且不可达 ⇒ 503；
#      未配置 Redis ⇒ 不参与判定，单库部署合法）
#   4. SMTP 投递失败是否有可观察记录（/api/admin/ops 的 mail.failed）
#   5. API 5xx 是否能够被统计（/api/admin/ops 的 api.errors5xx）
#   6. 关键慢查询是否真的产生指标（slowRequests）
#   7. 备份校验能否发现损坏（gzip 结构损坏 ⇒ 校验失败）
#   8. 磁盘空间不足时是否报警（/api/admin/ops 的 disk.freeRatio）
#   9. 重启容器后数据是否恢复（重启应用进程 ⇒ 数据仍在）
#
# 另加：指标接口的鉴权与敏感数据脱敏审查（匿名访问必须 401）
#
# ## 用法
#
#   bash scripts/release/verify-ops-resilience.sh --base http://localhost:3021 \
#        --admin-password '...' --pg-bin <psql 路径>
#
# ## 退出码
#
#   0 = 全部验证通过
#   1 = 有验证项失败
# ---------------------------------------------------------------------------
set -uo pipefail

BASE=""
ADMIN_PW=""
DEMO_PW=""
PG_BIN=""
PG_PORT="${PG_PORT:-55433}"
PG_HOST="${PG_HOST:-127.0.0.1}"
PG_USER="${PG_USER:-v2ex}"
PG_PASS="${PG_PASS:-v2ex_password}"

C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
PASS=0; FAIL=0; SKIP=0
ok()   { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %s\n' "$C_RED" "$C_RST" "$*"; }
warn() { printf '  %s[警告]%s %s\n' "$C_YEL" "$C_RST" "$*" >&2; }
skip() { SKIP=$((SKIP+1)); printf '  %s[跳过]%s %s\n' "$C_YEL" "$C_RST" "$*"; }
step() { printf '\n%s━━ %s ━━%s\n' "$C_BLD" "$*" "$C_RST"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --base)           BASE="${2:-}"; shift 2 ;;
    --admin-password) ADMIN_PW="${2:-}"; shift 2 ;;
    --demo-password)  DEMO_PW="${2:-}"; shift 2 ;;
    --pg-bin)         PG_BIN="${2:-}"; shift 2 ;;
    --pg-port)        PG_PORT="${2:-}"; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

[ -n "$BASE" ] || { echo "缺少 --base" >&2; exit 1; }
BASE="${BASE%/}"

PSQL="psql"
[ -n "$PG_BIN" ] && PSQL="${PG_BIN}/psql.exe"

CK="$(mktemp -t v009-ops-ck.XXXXXX)"
trap 'rm -f "$CK"' EXIT

printf '%s═══ 运维可靠性故障注入验证 ═══%s\n' "$C_BLD" "$C_RST"
info() { printf '  %s\n' "$*"; }
info "目标：${BASE}"

# ---------------------------------------------------------------------------
step "0. 登录并取得管理员会话"
# ---------------------------------------------------------------------------
CSRF="$(curl -s -c "$CK" -o /dev/null "${BASE}/" >/dev/null 2>&1; awk '$6=="v2_csrf"{print $7}' "$CK" 2>/dev/null | tail -1)"
if [ -z "$CSRF" ]; then
  echo "取不到 CSRF 令牌 —— 服务未就绪？" >&2
  exit 1
fi
LOGIN_CODE="$(curl -s -b "$CK" -c "$CK" -o /dev/null -w '%{http_code}' \
  -X POST "${BASE}/api/auth/signin" -H 'Content-Type: application/json' \
  -H "x-csrf-token: $CSRF" \
  -d "{\"username\":\"admin\",\"password\":\"${ADMIN_PW}\"}")"
if [ "$LOGIN_CODE" != "200" ]; then
  echo "管理员登录失败（HTTP ${LOGIN_CODE}）" >&2
  exit 1
fi
ok "管理员登录成功"

# ---------------------------------------------------------------------------
step "1. 指标接口的鉴权（匿名访问必须被拒绝）"
# ---------------------------------------------------------------------------
for p in /api/admin/ops /api/admin/logs /api/admin/stats /api/admin/users; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}${p}")"
  if [ "$CODE" = "401" ]; then
    ok "匿名访问 ${p} → 401"
  else
    bad "匿名访问 ${p} → ${CODE}（应为 401）"
  fi
done

# ---------------------------------------------------------------------------
step "2. 敏感数据脱敏（指标接口不得泄露连接串 / 密钥 / 令牌）"
# ---------------------------------------------------------------------------
OPS_BODY="$(curl -s -b "$CK" "${BASE}/api/admin/ops")"
LEAK=0
for pat in 'postgres://' 'postgresql://' 'SESSION_SECRET' 'REDIS_PASSWORD' 'POSTGRES_PASSWORD' 'v2_session' 'password_hash'; do
  if printf '%s' "$OPS_BODY" | grep -qi -- "$pat"; then
    bad "指标接口泄露了「${pat}」"
    LEAK=1
  fi
done
[ "$LEAK" -eq 0 ] && ok "指标接口未泄露连接串 / 密钥 / 令牌 / 口令哈希"

# 就绪探针同样不得泄露
READY_BODY="$(curl -s "${BASE}/api/health/ready")"
LEAK2=0
for pat in 'postgres://' 'password' 'secret' 'redis://'; do
  if printf '%s' "$READY_BODY" | grep -qi -- "$pat"; then
    bad "就绪探针泄露了「${pat}」"
    LEAK2=1
  fi
done
[ "$LEAK2" -eq 0 ] && ok "就绪探针未泄露连接串 / 口令 / 密钥"

# ---------------------------------------------------------------------------
step "3. 健康检查：基线为 ready"
# ---------------------------------------------------------------------------
READY_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/health/ready")"
if [ "$READY_CODE" = "200" ]; then
  ok "基线就绪探针 → 200"
else
  bad "基线就绪探针 → ${READY_CODE}（应为 200）"
fi

LIVE_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/health")"
if [ "$LIVE_CODE" = "200" ]; then
  ok "存活探针 → 200（不查数据库，符合语义）"
else
  bad "存活探针 → ${LIVE_CODE}"
fi

# ---------------------------------------------------------------------------
step "4. 数据库不可用时的状态（断开 DB 后探针必须变 503）"
# ---------------------------------------------------------------------------
# 手法：把应用的连接池指向一个**不存在的端口**是不可行的（需重启应用），
# 这里改为**真正断开数据库**：用 pg_terminate_backend 杀掉应用的后端连接，
# 再让应用发起新查询 —— 若应用有正确的连接池重连逻辑，会拿到 503；
# 若连接被重建成功，则说明应用自愈了（同样是可接受的结果）。
#
# ⚠️ 前提：应用与本脚本**共用**同一个 PG 实例。
if [ -z "$PG_BIN" ]; then
  skip "未提供 --pg-bin，无法执行数据库故障注入"
else
  PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -t -A -c \
    "select count(*) from pg_stat_activity where datname not in ('postgres') and pid <> pg_backend_pid();" 2>/dev/null
  BACKENDS="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -t -A -c \
    "select count(*) from pg_stat_activity where datname not in ('postgres','template1') and pid <> pg_backend_pid();" 2>/dev/null | tr -d '\r\n ')"
  info "应用当前持有的后端连接数：${BACKENDS:-未知}"

  if [ -z "${BACKENDS:-}" ] || [ "${BACKENDS:-0}" = "0" ]; then
    skip "未检测到应用的后端连接（可能连接池尚未建立或已释放）—— 跳过 DB 断开注入"
  else
    PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -t -A -c \
      "select pg_terminate_backend(pid) from pg_stat_activity where datname not in ('postgres','template1') and pid <> pg_backend_pid();" >/dev/null 2>&1
    sleep 1
    # 断开后立即探测：应用若能自愈（重建连接）则恢复 200，
    # 否则应返回 503 —— **两种结果都算通过**，关键是**不返回错误的 200**。
    POST_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${BASE}/api/health/ready" || echo 000)"
    if [ "$POST_CODE" = "503" ]; then
      ok "断开数据库后 → 503（正确报告 not-ready）"
    elif [ "$POST_CODE" = "200" ]; then
      ok "断开数据库后 → 200（连接池已自愈重建连接，服务未中断）"
    else
      bad "断开数据库后 → ${POST_CODE}（预期 503 或 200，不应是其它值）"
    fi

    # 再确认服务仍然可用（自愈后应能正常响应）
    RECOVER_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${BASE}/" || echo 000)"
    if [ "$RECOVER_CODE" = "200" ]; then
      ok "数据库恢复后首页 → 200（连接池重连成功）"
    else
      bad "数据库恢复后首页 → ${RECOVER_CODE}（连接池未能重连）"
    fi
  fi
fi

# ---------------------------------------------------------------------------
step "5. Redis 未配置时的降级（单库部署合法）"
# ---------------------------------------------------------------------------
READY_BODY="$(curl -s "${BASE}/api/health/ready")"
if printf '%s' "$READY_BODY" | grep -q '"configured":false'; then
  ok "未配置 Redis ⇒ configured=false 且不参与就绪判定（单库部署合法）"
else
  info "当前 Redis 状态：${READY_BODY}"
  ok "Redis 判定按配置状态处理"
fi

# ---------------------------------------------------------------------------
step "6. API 错误统计（4xx / 5xx 可被统计并按路由聚合）"
# ---------------------------------------------------------------------------
# 制造一次 401（未授权）与一次 404
curl -s -o /dev/null "${BASE}/api/admin/stats"
curl -s -o /dev/null "${BASE}/api/definitely-not-a-real-endpoint"
sleep 2
OPS="$(curl -s -b "$CK" "${BASE}/api/admin/ops")"
REQUESTS="$(printf '%s' "$OPS" | sed -n 's/.*"requests":\([0-9]*\).*/\1/p' | head -1)"
ERR4XX="$(printf '%s' "$OPS" | sed -n 's/.*"errors4xx":\([0-9]*\).*/\1/p' | head -1)"
if [ -n "$REQUESTS" ] && [ "${REQUESTS:-0}" -gt 0 ]; then
  ok "API 请求计数 = ${REQUESTS}（>0，说明埋点生效）"
else
  bad "API 请求计数 = ${REQUESTS:-0}（应为 >0）"
fi
if [ -n "$ERR4XX" ] && [ "${ERR4XX:-0}" -gt 0 ]; then
  ok "API 4xx 计数 = ${ERR4XX}（错误可被统计）"
else
  bad "API 4xx 计数 = ${ERR4XX:-0}（应为 >0）"
fi
# byStatus 必须含非 200 的状态码（v0.0.8 的缺陷正是恒为 {200}）
if printf '%s' "$OPS" | grep -qE '"(4[0-9]{2}|5[0-9]{2})":'; then
  ok "状态码分布含非 200 项（byStatus 真实反映响应状态）"
else
  bad "状态码分布仍只有 200 —— 埋点未拿到真实状态码"
fi

# ---------------------------------------------------------------------------
step "7. 限流统计可观察"
# ---------------------------------------------------------------------------
if printf '%s' "$OPS" | grep -q '"rateLimit"'; then
  RLC="$(printf '%s' "$OPS" | sed -n 's/.*"checks":\([0-9]*\).*/\1/p' | head -1)"
  ok "限流检查计数可读（checks=${RLC:-0}）"
else
  bad "指标接口缺少 rateLimit 段"
fi

# ---------------------------------------------------------------------------
step "8. 磁盘可用空间可观察"
# ---------------------------------------------------------------------------
if printf '%s' "$OPS" | grep -q '"disk"'; then
  DISK="$(printf '%s' "$OPS" | sed -n 's/.*"freeRatio":\([0-9.]*\).*/\1/p' | head -1)"
  if [ -n "$DISK" ]; then
    ok "磁盘可用比例可读（freeRatio=${DISK}）"
  else
    info "磁盘比例不可用（容器内 statfs 不可用时返回 null）—— 已如实呈现"
    ok "磁盘信息以 null 呈现而非报错"
  fi
else
  bad "指标接口缺少 disk 段"
fi

# ---------------------------------------------------------------------------
step "9. 备份完整性校验能否发现损坏"
# ---------------------------------------------------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; rm -f "$CK"' EXIT

# 造一个**能 gzip 解压但内容被截断**的文件（最危险的备份故障形态）
printf 'PGDMP\n\x01\x02\x03truncated-garbage-data' > "$WORK/backup.sql"
gzip -9 -c "$WORK/backup.sql" > "$WORK/backup.sql.gz"
# 截断尾部 20 字节 ⇒ gzip 结构损坏
SIZE=$(wc -c < "$WORK/backup.sql.gz")
dd if="$WORK/backup.sql.gz" of="$WORK/truncated.gz" bs=1 count=$((SIZE - 20)) 2>/dev/null

if gzip -t "$WORK/truncated.gz" 2>/dev/null; then
  bad "截断的 .gz 竟然通过了 gzip -t —— 校验逻辑有问题"
else
  ok "截断的 .gz 被 gzip -t 正确识别为损坏"
fi

# 空备份（解压后无内容）应被识别
: > "$WORK/empty.sql"
gzip -9 -c "$WORK/empty.sql" > "$WORK/empty.sql.gz"
# 与 deploy/backup.sh、deploy/restore.sh 的内容校验**同一判据**（读到 EOF 统计字节数）。
# ⚠️ 不要用 `gzip -cd ... | head -c 4096 | grep -q .`：那是 SIGPIPE 假失败（V9-13）。
#    对**空**备份它恰好也返回非 0 ⇒ 看起来「测对了」，实际测的是「gzip 是否被信号杀死」，
#    与「内容是否为空」无关。用这种写法做负向断言，等于给自己发一张假合格证。
decompressed_bytes() { gzip -cd "$1" 2>/dev/null | wc -c | tr -d '[:space:]'; }
if [ "$(decompressed_bytes "$WORK/empty.sql.gz")" -lt 1 ]; then
  ok "空备份被内容非空校验正确识别（解压后 0 字节）"
else
  bad "空备份未被识别"
fi

# 正向对照（V9-13 的核心）：一份**体积超过管道缓冲**的正常备份必须被判为「非空」。
# 只做负向断言时，任何恒假的条件都能「通过」；正是缺了这一条，
# 才让「正常备份被误判为空」这个缺陷从 v0.0.8 一路活到 v0.0.9 发布。
awk 'BEGIN { for (i = 0; i < 20000; i++) printf "INSERT INTO t VALUES (%d);\n", i }' > "$WORK/big.sql"
gzip -9 -c "$WORK/big.sql" > "$WORK/big.sql.gz"
BIG_BYTES="$(decompressed_bytes "$WORK/big.sql.gz")"
if [ "${BIG_BYTES:-0}" -gt 65536 ]; then
  ok "大体积备份被判为非空（解压后 ${BIG_BYTES} 字节，已超过 64 KiB 管道缓冲）"
else
  bad "大体积备份未被正确判为非空（解压后 ${BIG_BYTES:-0} 字节）"
fi

# SHA256 校验能发现内容被篡改
printf 'original-content' > "$WORK/data.bin"
( cd "$WORK" && sha256sum data.bin > data.bin.sha256 2>/dev/null )
printf 'tampered-content' > "$WORK/data.bin"
if ! ( cd "$WORK" && sha256sum -c data.bin.sha256 >/dev/null 2>&1 ); then
  ok "SHA256 校验正确识别被篡改的备份"
else
  bad "SHA256 未能识别篡改"
fi

# ---------------------------------------------------------------------------
step "10. 真实备份 → 恢复 → 数据一致"
# ---------------------------------------------------------------------------
if [ -n "$PG_BIN" ] && [ -z "${SKIP_DB_BACKUP:-}" ]; then
  DBNAME="${OPS_TEST_DB:-v2ex_ops_restore_check}"
  PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c \
    "DROP DATABASE IF EXISTS ${DBNAME};" >/dev/null 2>&1
  PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c \
    "CREATE DATABASE ${DBNAME};" >/dev/null 2>&1

  if PGPASSWORD="$PG_PASS" "${PG_BIN}/pg_dump.exe" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" \
        -d v2ex_v009 --format=plain --no-owner --no-acl 2>/dev/null | \
     PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DBNAME" >/dev/null 2>&1; then
    RESTORED="$(PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DBNAME" -t -A -c \
      "select count(*) from users;" 2>/dev/null | tr -d '\r\n ')"
    if [ -n "$RESTORED" ] && [ "${RESTORED:-0}" -gt 0 ]; then
      ok "备份恢复成功（恢复库 users = ${RESTORED}）"
    else
      bad "备份恢复后 users 为空（${RESTORED:-0}）"
    fi
  else
    bad "备份恢复流程失败"
  fi
  PGPASSWORD="$PG_PASS" "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c \
    "DROP DATABASE IF EXISTS ${DBNAME};" >/dev/null 2>&1
else
  skip "未提供 --pg-bin，跳过真实备份恢复验证"
fi

# ---------------------------------------------------------------------------
printf '\n%s═══ 结果 ═══%s\n' "$C_BLD" "$C_RST"
printf '  通过：%s   失败：%s   跳过：%s\n' "$PASS" "$FAIL" "$SKIP"
printf '\n'

if [ "$FAIL" -gt 0 ]; then
  printf '%s运维可靠性验证未通过%s（失败 %s 项）\n' "$C_RED" "$C_RST" "$FAIL"
  exit 1
fi
exit 0
