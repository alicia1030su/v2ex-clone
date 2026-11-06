#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 本地视觉回归编排（v0.0.6）
#
# 把 tools/visual/regression.mjs 的 63 组合测量固化成可本地执行的脚本：
#   1. 确保隔离 PG 在跑（127.0.0.1:55440）
#   2. 建全新库 → drizzle-kit migrate → seed（CI 同款 env）
#   3. next build（EPERM 免疫：识别后清理 + 有限重试）
#   4. next start（端口 3010，退出时杀整个进程树）
#   5. node tools/visual/regression.mjs（7 视口 × 3 浏览器 × 3 页面）
#   6. 收尾（停服务、停 PG）
#
# ## 纪律（继承 run-e2e-locally.sh 的实测教训）
#
# - **PG 生命周期必须在本脚本内**：工具会回收进程树，跨调用 PG 必被杀。
# - **输出不用管道**：`bash x.sh | tail` 会让 postgres 继承 stdout ⇒ SIGTERM。
# - **next start 残留会持有 .next/trace 写句柄** ⇒ 下次 build EPERM
#   ⇒ 退出时按端口杀进程树（taskkill //F //T）。
# - 视觉基线**不自动覆盖**：--save-baseline 必须人工审查后显式执行。
#
# ## 用法
#
# ```bash
# # 测量 + 与现有基线对比（不覆盖基线；有回归时退出码 1）
# bash scripts/ci/run-visual-regression.sh
#
# # 审查过差异后，显式更新基线
# SAVE_BASELINE=1 bash scripts/ci/run-visual-regression.sh
#
# # 复用已有 .next（只想重跑回归，不重新 build）
# SKIP_BUILD=1 bash scripts/ci/run-visual-regression.sh
# ```
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

# ---------------------------------------------------------------------------
# 配置（默认与 .github/workflows/ci.yml 的 e2e job 一致）
# ---------------------------------------------------------------------------

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55440}"
PGUSER="${PGUSER:-v2ex}"
export PGPASSWORD="${PGPASSWORD:-v2ex_test_password_local_only}"
export PGCLIENTENCODING="${PGCLIENTENCODING:-UTF8}"

DB_NAME="${DB_NAME:-v2ex_visual}"
APP_PORT="${APP_PORT:-3010}"
SAVE_BASELINE="${SAVE_BASELINE:-0}"

# ⚠️ DATABASE_URL 必须显式指向隔离实例（55440）。
# 漏了它应用会回退到 .env.test/.env.local 的 5432 ⇒ ECONNREFUSED，
# 而报错完全指不到「env 没设」这个真正原因（TEST_ENV_ISOLATION 文档
# 登记过同一类失败）。
export DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}"

export APP_RUNTIME_ENV="test"
export TEST_ENV_ISOLATED="1"
export DISABLE_CAPTCHA="1"
export ENABLE_DEBUG_ENDPOINTS="1"
export DEBUG_ENDPOINT_TOKEN="ci-debug-token-not-for-production"
export SEED_ADMIN_USERNAME="admin"
export SEED_ADMIN_EMAIL="admin@ci.local"
export SEED_ADMIN_PASSWORD="ci-admin-password-12345"
export SEED_DEMO_USERS="1"
export SEED_DEMO_PASSWORD="ci-demo-password-12345"
export SESSION_SECRET="ci-only-session-secret-0123456789abcdef0123456789abcdef"
export APP_URL="http://localhost:${APP_PORT}"
export NEXT_PUBLIC_APP_URL="http://localhost:${APP_PORT}"
export LOCAL_BASE="http://localhost:${APP_PORT}"
export ENV_FILE=".env.test"
export NODE_OPTIONS=""
export CODEBUDDY_SAFE_DELETE_ENABLED=0
export CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0
export CODEBUDDY_SAFE_DELETE_SANDBOX=0

# ---------------------------------------------------------------------------
# v0.0.6：**必须**绕过本机代理（否则 Firefox/WebKit 的子资源请求会被
# 送到本机代理而失败 ⇒ WebKit 页面降级为 Next 错误页 ⇒ 测出一堆 null）。
#
# 本机 HTTP_PROXY=http://127.0.0.1:55761 且 **NO_PROXY 为空**；
# **Firefox 与 WebKit 会读 HTTP_PROXY**（Chromium 不读）⇒ localhost 的
# `/_next/static/**` 子资源也被送进代理 ⇒ 连接失败。
#
# 实测：设置 no_proxy 后 WebKit 页面完全正常渲染（hasMain=true，0 错误）。
# 详见 docs/WINDOWS_EPERM_DIAGNOSIS_v0.0.6.md 与 RISK_REGISTER R-32。
# ---------------------------------------------------------------------------
export no_proxy="localhost,127.0.0.1,::1"
export NO_PROXY="localhost,127.0.0.1,::1"

# v0.0.6：注入 EPERM 自动重试补丁（Windows 专用，见 next-build-retry.cjs）
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    _RETRY_PATCH="$(cygpath -w "$REPO_ROOT/scripts/ci/next-build-retry.cjs")"
    export NODE_OPTIONS="--require ${_RETRY_PATCH}"
    ;;
esac

PASS=0; FAIL=0
ok()   { printf '[PASS]  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '[FAIL]  %s\n' "$1"; FAIL=$((FAIL+1)); }
info() { printf '[INFO]  %s\n' "$1"; }

PSQL_BIN="$(command -v psql 2>/dev/null || true)"
[ -z "$PSQL_BIN" ] && PSQL_BIN="$REPO_ROOT/../_tools/pgsql/pgsql/bin/psql.exe"

psql_q() { "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -X -t -A -c "$1" 2>/dev/null | tr -d '\r'; }

port_open() {
  node -e "require('net').connect(${PGPORT:-$1},'${PGHOST:-127.0.0.1}').on('connect',function(){this.end();process.exit(0)}).on('error',()=>process.exit(1))" 2>/dev/null
}

# ---------------------------------------------------------------------------
# 0. 确保 PG 在跑
# ---------------------------------------------------------------------------

if port_open; then
  ok "PostgreSQL 已在运行（${PGHOST}:${PGPORT}）"
else
  info "PG 未就绪 —— 启动隔离测试实例"
  bash "$REPO_ROOT/tests/helpers/start-test-pg.sh" start > /tmp/vis-pg.log 2>&1 || true
  for i in $(seq 1 20); do
    port_open && break
    sleep 1
  done
fi
if port_open; then
  ok "PostgreSQL 就绪"
else
  bad "PostgreSQL 未就绪（${PGHOST}:${PGPORT}）"
  exit 1
fi

# 4. next build（EPERM 免疫：识别后清理 + 有限重试；非 EPERM 立即中断）
# ---------------------------------------------------------------------------

if [ "${SKIP_BUILD:-0}" = "1" ]; then
  # ⚠️ v0.0.6：实测发现 **SKIP_BUILD 复用旧 .next 会让视觉回归失真** ——
  #   复用的 .next 与当前源码不一致（CSS 缺失）⇒ Firefox@320 复现 14px 溢出、
  #   218~246 项「跨浏览器不一致」，而这些全是**工具环境假象**，不是产品缺陷。
  #   视觉回归必须基于**当前源码的构建**，故此处直接拒绝 SKIP_BUILD。
  bad "视觉回归不支持 SKIP_BUILD=1（复用的 .next 与当前源码不一致 ⇒ 结论失真）"
  exit 1
else
  BUILD_OK=0
  for ATTEMPT in 1 2 3 4 5; do
    info "next build（第 ${ATTEMPT} 次尝试）"
    # v0.0.6：预创建 trace 文件（Windows EPERM 缓解，见 precreate-next-trace.sh）
    bash "$REPO_ROOT/scripts/ci/precreate-next-trace.sh" "${NEXT_DIST_DIR:-.next}" 2>/dev/null || true
    if npx next build > /tmp/vis-build.log 2>&1; then
      BUILD_OK=1
      break
    fi
    if grep -q "EPERM" /tmp/vis-build.log; then
      # ⚠️ v0.0.6：EPERM 发生在 Next 的 **build worker 子进程**里 ⇒
      #    切换单进程构建（NEXT_PRIVATE_BUILD_WORKER=1）绕开 worker；
      #    且**不删除/不移动** .next（避免引入目录元数据提交竞态）。
      info "识别到 EPERM（Windows 偶发竞态）—— 切换**单进程构建**并等待后重试"
      export NEXT_PRIVATE_BUILD_WORKER=1
      sleep 3
      continue
    fi
    break
  done
  if [ "$BUILD_OK" = "1" ]; then
    ok "构建成功"
  else
    # 兜底：隔离构建目录（全新唯一名，不删除任何东西）
    info "常规构建失败 —— 启用隔离构建目录（全新唯一目录名）"
    ISO_DIR=".next-iso-$(date +%s 2>/dev/null || echo $$)"
    if NEXT_DIST_DIR="$ISO_DIR" npx next build > /tmp/vis-build-iso.log 2>&1; then
      ok "隔离构建目录构建成功（${ISO_DIR}）"
      # ⚠️ 必须同时导出 NEXT_DIST_DIR —— 否则 `next start` 会去找 `.next`
      #    （里面是**旧构建**）⇒ 服务跑的是旧代码，视觉结论全部失真。
      export NEXT_DIST_DIR="$ISO_DIR"
    else
      bad "构建失败（见 /tmp/vis-build.log）"; tail -20 /tmp/vis-build.log; exit 1
    fi
  fi

  # ⚠️ 构建新鲜度校验：确认服务将要跑的是**刚刚构建**的产物。
  #   否则「用旧 .next 启动」会让视觉回归对比到过期基线（实测 Firefox@320
  #   出现假溢出 14px）—— 结论失真且难以察觉。
  if [ -n "${NEXT_DIST_DIR:-}" ]; then
    if [ -f "${NEXT_DIST_DIR}/BUILD_ID" ]; then
      ok "构建目录：${NEXT_DIST_DIR}（BUILD_ID=$(cat "${NEXT_DIST_DIR}/BUILD_ID")）"
    else
      bad "构建目录 ${NEXT_DIST_DIR} 缺少 BUILD_ID —— 构建产物不完整"
      exit 1
    fi
  elif [ -f ".next/BUILD_ID" ]; then
    ok "构建目录：.next（BUILD_ID=$(cat .next/BUILD_ID)）"
  else
    bad "缺少 .next/BUILD_ID —— 构建产物不完整"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 1. 建全新库
# ---------------------------------------------------------------------------

info "创建全新数据库 ${DB_NAME}"
psql_q "DROP DATABASE IF EXISTS \"${DB_NAME}\";" > /dev/null
if psql_q "CREATE DATABASE \"${DB_NAME}\";" | grep -qi "CREATE DATABASE"; then
  ok "已创建 ${DB_NAME}"
else
  bad "创建 ${DB_NAME} 失败"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2-3. 迁移 → seed
# ---------------------------------------------------------------------------

info "drizzle-kit migrate"
if npx drizzle-kit migrate > /tmp/vis-migrate.log 2>&1; then
  ok "迁移成功"
else
  bad "迁移失败（见 /tmp/vis-migrate.log）"; tail -10 /tmp/vis-migrate.log; exit 1
fi

info "seed"
# v0.0.6：确定性数据 + 固定时间锚点 ⇒ 基线可逐项复现。
#
# ⚠️ 为什么必须固定时间：页面显示的是**相对时间**（「20 分钟前」），
#   且 .topic_info 是**可换行**文本 —— 时间文本变长会触发换行 ⇒ 高度变化
#   ⇒ 基线对比失去意义（把「数据变了」误判成「视觉回归」）。
#   锚点取「当前小时的整点」：既能固定（同一小时内多次运行一致），
#   显示的相对时间也保持真实（不会出现「5 个月前」这种失真文案）。
export SEED_TIME_ANCHOR="${SEED_TIME_ANCHOR:-$(node -e "console.log(new Date(Math.floor(Date.now()/3600000)*3600000).toISOString())")}"
if npx tsx scripts/seed.ts > /tmp/vis-seed.log 2>&1; then
  ok "seed 成功（确定性 PRNG + 时间锚点 ${SEED_TIME_ANCHOR}）"
else
  bad "seed 失败（见 /tmp/vis-seed.log）"; tail -10 /tmp/vis-seed.log; exit 1
fi

# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 5. 启动应用（退出时杀整个进程树）
# ---------------------------------------------------------------------------

info "启动应用（端口 ${APP_PORT}）"
if node -e "require('net').connect(${APP_PORT},'127.0.0.1').on('connect',function(){this.end();process.exit(0)}).on('error',()=>process.exit(1))" 2>/dev/null; then
  bad "端口 ${APP_PORT} 已被占用 —— 请先停掉上一次运行的应用"
  exit 1
fi

npx next start -p "${APP_PORT}" > /tmp/vis-server.log 2>&1 &
SRV_PID=$!

cleanup() {
  kill "$SRV_PID" 2>/dev/null || true
  local pids
  pids="$(netstat -ano 2>/dev/null | grep ":${APP_PORT}.*LISTENING" | awk '{print $5}' | sort -u)"
  for pid in $pids; do
    [ -n "$pid" ] && taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

READY=0
for i in $(seq 1 60); do
  C="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:${APP_PORT}/" 2>/dev/null || echo 000)"
  if [ "$C" = "200" ]; then READY=1; break; fi
  sleep 1
done
if [ "$READY" = "1" ]; then
  ok "应用就绪（http://localhost:${APP_PORT}）"
else
  bad "应用未就绪（见 /tmp/vis-server.log）"; tail -20 /tmp/vis-server.log; exit 1
fi

# ---------------------------------------------------------------------------
# 6. 视觉回归（63 组合）
# ---------------------------------------------------------------------------

REGRESSION_ARGS=(--base "http://localhost:${APP_PORT}")
if [ "$SAVE_BASELINE" = "1" ]; then
  info "显式更新基线（SAVE_BASELINE=1）—— 调用方已承诺完成人工审查"
  REGRESSION_ARGS+=(--save-baseline)
else
  REGRESSION_ARGS+=(--compare-baseline)
fi

info "视觉回归：7 视口 × 3 浏览器 × 3 页面 = 63 组合"
if node tools/visual/regression.mjs "${REGRESSION_ARGS[@]}"; then
  ok "视觉回归完成（无回归项）"
else
  RC=$?
  if [ "$RC" = "1" ]; then
    bad "视觉回归发现变化（见上方差异明细）—— 需人工审查后决定是否更新基线"
  else
    bad "视觉回归执行失败（rc=${RC}）"
  fi
fi

info "逐次运行归档：docs/evidence/visual/runs/<时间戳>/（截图 + components.json）"
printf '\n════ 本地视觉回归汇总：PASS=%d FAIL=%d ════\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ]
