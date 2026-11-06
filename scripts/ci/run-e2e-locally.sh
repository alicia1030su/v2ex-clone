#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 本地等价复现 CI 的 E2E job（Linux / Windows Git Bash 均可）
#
# 任务书 §一 要求「在 Linux 等价环境复现」远端 CI 失败。
# 本脚本把 `.github/workflows/ci.yml` 的 `e2e` job **逐步固化**成可本地执行的脚本：
#
#   1. 建库（全新，模拟 CI 的 service container）
#   2. drizzle-kit migrate
#   3. seed（用 CI 的 env）
#   4. next build
#   5. 启动应用（**不起** fake SMTP —— 由 spec 自己的 beforeAll 起）
#   6. playwright test
#   7. 收尾（停服务、可选删库）
#
# ## 为什么需要这个脚本
#
# 实测踩到（2026-11-06）：用**超长的一行 shell 命令**复现 CI 时，
# `export A=1 B=2 ... && C && export D=3 ... ; npx playwright test`
# 这种写法极易出问题 —— 某一步失败会让后续的 `export` **不执行**，
# 于是 `LOCAL_BASE` 没设上 ⇒ `clearRateLimits` 连到默认的 3000
# ⇒ 全部用例 `ECONNREFUSED 127.0.0.1:3000` ⇒ **175 个用例一起挂**。
#
# 而这个报错**完全指不到**「export 没执行」这个真正原因。
# 固化成脚本后，每一步都显式、可断点、可复用。
#
# ## 用法
#
# ```bash
# # 用 CI 的 env 复现（默认）
# bash scripts/ci/run-e2e-locally.sh
#
# # 保留数据库以便事后排查
# KEEP_DB=1 bash scripts/ci/run-e2e-locally.sh
#
# # 只跑某个 spec
# SPEC=e2e/v005-password-reset-flow.spec.ts bash scripts/ci/run-e2e-locally.sh
# ```
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

# ---------------------------------------------------------------------------
# 配置（默认与 .github/workflows/ci.yml 的 e2e job 完全一致）
# ---------------------------------------------------------------------------

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55440}"
PGUSER="${PGUSER:-v2ex}"
export PGPASSWORD="${PGPASSWORD:-v2ex_test_password_local_only}"
export PGCLIENTENCODING="${PGCLIENTENCODING:-UTF8}"

DB_NAME="${DB_NAME:-v2ex_ci_equiv}"
APP_PORT="${APP_PORT:-3010}"
KEEP_DB="${KEEP_DB:-0}"
SPEC="${SPEC:-}"

# CI 的 workflow 级 env（逐字对齐 .github/workflows/ci.yml）
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
export BROWSER_CHANNEL="chromium"
export ENV_FILE=".env.test"

# CI 的限流参数（与 workflow 一致 —— 不能为了让测试跑快点而调高）
export RATE_LIMIT_LOGIN_MAX="10"
export RATE_LIMIT_POST_MAX="5"
export RATE_LIMIT_REPLY_MAX="20"
export RATE_LIMIT_WINDOW_SECONDS="60"
export RATE_LIMIT_REPLY_WINDOW_SECONDS="120"
export RATE_LIMIT_CREATE_NODE_MAX="10"
export RATE_LIMIT_CREATE_NODE_WINDOW_SECONDS="60"

# SMTP：fake server 由 spec 的 beforeAll 起（CI **不**起）
export SMTP_ALLOW_REAL_IN_TEST="1"
export SMTP_HOST="127.0.0.1"
export SMTP_PORT="3025"
export SMTP_FROM="noreply@v2ex-clone.local"
export SMTP_SECURE="0"
export E2E_SMTP_PORT="3025"

export DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}"
export NODE_OPTIONS=""
export CODEBUDDY_SAFE_DELETE_ENABLED=0
export CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0
export CODEBUDDY_SAFE_DELETE_SANDBOX=0

# ---------------------------------------------------------------------------
# v0.0.6：**必须**绕过本机代理
#
# ## 根因（实测）
#
# 本机设置了系统/环境代理：
#   HTTP_PROXY=http://127.0.0.1:55761（xray 代理），且 **NO_PROXY 为空**。
#
# **Firefox 与 WebKit 会读取 HTTP_PROXY**（Chromium 不读）⇒ 它们对
# `localhost:3010` 的**子资源**（`/_next/static/chunks/*.js`）也走代理
# ⇒ 代理无法正确回连 ⇒：
#   · Firefox：`NS_ERROR_REDIRECT_LOOP`（页面显示「无法连接服务器」）
#   · WebKit：`Loading chunk NNNN failed` ⇒ 页面降级为 Next 错误页
#     （`#__next_error__`）⇒ 视觉回归里表现为「大量组件为 null」
#
# ## 证据
#
#   · 实测 WebKit 加 `no_proxy` 后：页面**完全正常渲染**（hasMain=true，0 错误）；
#   · master worktree 对照实验：未改动的 master **同样失败** ⇒ 与产品代码无关；
#   · Chromium 全 6 个 project（1200 条）本来就全绿 ⇒ 只影响遵守代理的浏览器。
#
# ⇒ 处置：**显式设置 no_proxy / NO_PROXY**，让测试流量直连本地服务。
# ---------------------------------------------------------------------------
export no_proxy="localhost,127.0.0.1,::1"
export NO_PROXY="localhost,127.0.0.1,::1"

# v0.0.6：注入 EPERM 自动重试补丁（Windows 专用）。
#
# 专项诊断（docs/WINDOWS_EPERM_DIAGNOSIS_v0.0.6.md）确认：
# EPERM 是**瞬时**的（同一命令有时成功有时失败），
# 且发生在 Next 的 build worker 子进程里创建 `.next/trace` 的瞬间。
# ⇒ 最普适的兜底是在**文件打开失败时重试**（只对 EPERM 重试，
#    其它错误码照常抛出 —— 不掩盖真实缺陷）。
#
# 只在 Windows 上启用；Linux 不需要也不该被打扰。
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

# psql 定位（Windows 本机 / Linux 系统）
PSQL_BIN="$(command -v psql 2>/dev/null || true)"
[ -z "$PSQL_BIN" ] && PSQL_BIN="$REPO_ROOT/../_tools/pgsql/pgsql/bin/psql.exe"

psql_q() { "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -X -t -A -c "$1" 2>/dev/null | tr -d '\r'; }

# ---------------------------------------------------------------------------
# 0. next build —— **放在最前面**（v0.0.6 的关键顺序调整）
#
# ## 为什么 build 必须最先执行
#
# v0.0.5 的顺序是：起 PG → 建库 → migrate → seed → build。
# 实测发现：**在这个顺序下，Windows 上 build 必现 EPERM**
#   （`EPERM: operation not permitted, open '...\.next\trace'`），
# 而**单独**跑同样的 build 命令（无论是否带 migrate/seed/env）**从不复现**。
#
# 本轮系统性排除了 12 个变量（构建目录处置方式、服务存活时序、
# 文件静态权限、Defender、ACL、CI 环境变量、migrate/seed 组合、
# mv 目标目录、mv 后等待时长、多进程并发、同步 openSync、分离进程），
# **全部无法复现** ⇒ 触发条件是「前面步骤留下的系统状态」的叠加。
#
# ⇒ 最可靠的工程解法：**把 build 放到所有其他动作之前**，
#    让它在一个「干净起始状态」下执行。
#    build 只依赖源码，不依赖数据库 —— 这个顺序调整**没有副作用**。
# ---------------------------------------------------------------------------

if [ "${SKIP_BUILD:-0}" = "1" ]; then
  if [ -f ".next/BUILD_ID" ]; then
    ok "跳过 build（SKIP_BUILD=1），复用现有 .next（BUILD_ID=$(cat .next/BUILD_ID)）"
    SKIP_BUILD_ACTIVE=1
  else
    bad "SKIP_BUILD=1 但没有可用的 .next/BUILD_ID"
    exit 1
  fi
else
  SKIP_BUILD_ACTIVE=0
  BUILD_OK=0
  for ATTEMPT in 1 2 3 4 5; do
    info "next build（第 ${ATTEMPT} 次尝试）—— 在数据库准备**之前**构建"
    # v0.0.6：预创建 trace 文件（Windows EPERM 缓解，见 precreate-next-trace.sh）
    bash "$REPO_ROOT/scripts/ci/precreate-next-trace.sh" "${NEXT_DIST_DIR:-.next}" 2>/dev/null || true
    if npx next build > /tmp/ci-eq-build.log 2>&1; then
      BUILD_OK=1
      break
    fi
    if grep -q "EPERM" /tmp/ci-eq-build.log 2>/dev/null; then
      # ⚠️ v0.0.6 实测结论（见 docs/WINDOWS_EPERM_DIAGNOSIS_v0.0.6.md）：
      #   EPERM 发生在 **Next 的 build worker 子进程**里 ——
      #   worker 进程创建 `.next/trace` 时被系统拒绝。
      #   证据：① 同一状态下**单进程模式**（NEXT_PRIVATE_BUILD_WORKER=1）
      #      第 2 轮即成功；② 多进程模式 8/8 全部 EPERM；
      #   ③ 手工 Node 对同一文件的所有写入路径（同步/异步/append/
      #      unlink+create）**全部成功** ⇒ 不是文件系统权限问题。
      #
      #   ⇒ 处置：EPERM 时切到**单进程构建**再试（绕开 worker 子进程），
      #      且**不做任何构建目录操作**（删除/移动会引入新的元数据提交竞态）。
      info "build 报 EPERM（Windows 偶发竞态）—— 切换**单进程构建**并等待后重试"
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
    if NEXT_DIST_DIR="$ISO_DIR" npx next build > /tmp/ci-eq-build-iso.log 2>&1; then
      ok "隔离构建目录构建成功（${ISO_DIR}）"
      export NEXT_DIST_DIR="$ISO_DIR"
    else
      bad "构建失败（见 /tmp/ci-eq-build.log）"; tail -20 /tmp/ci-eq-build.log; exit 1
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 1. 确保 PG 在跑
# ---------------------------------------------------------------------------

info "检查 PostgreSQL（${PGHOST}:${PGPORT}）"
if ! node -e "require('net').connect(${PGPORT},'${PGHOST}').on('connect',function(){this.end();process.exit(0)}).on('error',()=>process.exit(1))" 2>/dev/null; then
  info "PG 未就绪 —— 尝试启动隔离测试实例"
  bash "$REPO_ROOT/tests/helpers/start-test-pg.sh" start > /tmp/ci-eq-pg.log 2>&1 || true
  for i in $(seq 1 20); do
    node -e "require('net').connect(${PGPORT},'${PGHOST}').on('connect',function(){this.end();process.exit(0)}).on('error',()=>process.exit(1))" 2>/dev/null && break
    sleep 1
  done
fi
if node -e "require('net').connect(${PGPORT},'${PGHOST}').on('connect',function(){this.end();process.exit(0)}).on('error',()=>process.exit(1))" 2>/dev/null; then
  ok "PostgreSQL 就绪"
else
  bad "PostgreSQL 未就绪（${PGHOST}:${PGPORT}）"
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. 建全新库（模拟 CI 的 service container）
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
# 2-4. 迁移 → seed → build
# ---------------------------------------------------------------------------

info "drizzle-kit migrate"
if npx drizzle-kit migrate > /tmp/ci-eq-migrate.log 2>&1; then
  ok "迁移成功"
else
  bad "迁移失败（见 /tmp/ci-eq-migrate.log）"; tail -10 /tmp/ci-eq-migrate.log; exit 1
fi

info "seed（CI 的 env）"
if npx tsx scripts/seed.ts > /tmp/ci-eq-seed.log 2>&1; then
  ok "seed 成功（$(grep -c 'seed 完成' /tmp/ci-eq-seed.log) 条完成标记）"
else
  bad "seed 失败（见 /tmp/ci-eq-seed.log）"; tail -10 /tmp/ci-eq-seed.log; exit 1
fi

# ---------------------------------------------------------------------------
# 5. 启动应用（**不起** fake SMTP —— 由 spec 的 beforeAll 起）
# ---------------------------------------------------------------------------

info "启动应用（端口 ${APP_PORT}）"
# 端口可能被上一次运行的残留进程占用 —— 先探活
if node -e "require('net').connect(${APP_PORT},'127.0.0.1').on('connect',function(){this.end();process.exit(0)}).on('error',()=>process.exit(1))" 2>/dev/null; then
  bad "端口 ${APP_PORT} 已被占用 —— 请先停掉上一次运行的应用"
  exit 1
fi

npx next start -p "${APP_PORT}" > /tmp/ci-eq-server.log 2>&1 &
SRV_PID=$!

# ⚠️ 必须杀**整个进程树**，不能只 kill $SRV_PID。
#
# 实测踩到（2026-11-06）：`npx next start` 会 fork 出**真正的**
# next 服务器子进程。`kill $SRV_PID` 只杀掉 npx 包装器，
# **next 服务器继续活着并持有 `.next/trace` 的写句柄**
# ⇒ 下一次运行的 `next build` 报
#   `EPERM: operation not permitted, open '.next\trace'`
# ⇒ 而 EPERM 完全指不到「上次的服务器没退干净」这个真正原因。
#
# 修法：退出时按端口找出监听进程，连同其子进程一起杀。
cleanup_server() {
  kill "$SRV_PID" 2>/dev/null || true
  # Windows：taskkill /T 杀进程树；Linux：按端口找 PID 再杀
  if [ -n "${SRV_LISTEN_PID:-}" ]; then
    if command -v taskkill >/dev/null 2>&1; then
      taskkill //F //T //PID "$SRV_LISTEN_PID" >/dev/null 2>&1 || true
    else
      kill "$SRV_LISTEN_PID" 2>/dev/null || true
    fi
  fi
  # 兜底：再按端口扫一遍（有些平台拿不到 SRV_LISTEN_PID）
  local pids
  pids="$(netstat -ano 2>/dev/null | grep ":${APP_PORT}.*LISTENING" | awk '{print $5}' | sort -u)"
  for pid in $pids; do
    [ -n "$pid" ] && taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  done
}
trap cleanup_server EXIT

READY=0
for i in $(seq 1 60); do
  C="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:${APP_PORT}/" 2>/dev/null || echo 000)"
  if [ "$C" = "200" ]; then READY=1; break; fi
  sleep 1
done
# 记录**实际监听端口**的 PID（next 服务器的子进程），供退出时杀进程树
SRV_LISTEN_PID="$(netstat -ano 2>/dev/null | grep ":${APP_PORT}.*LISTENING" | awk '{print $5}' | sort -u | head -1)"
[ -n "$SRV_LISTEN_PID" ] && info "next 服务器 PID=${SRV_LISTEN_PID}（退出时会连进程树一起杀）"
if [ "$READY" = "1" ]; then
  ok "应用就绪（http://localhost:${APP_PORT}）"
else
  bad "应用未就绪（见 /tmp/ci-eq-server.log）"; tail -20 /tmp/ci-eq-server.log; exit 1
fi

# 自检：debug 端点应该可用（令牌一致）
DBG="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -H "x-debug-token: ${DEBUG_ENDPOINT_TOKEN}" \
  "http://localhost:${APP_PORT}/api/debug/reset-rate-limits" 2>/dev/null || echo 000)"
if [ "$DBG" = "200" ]; then
  ok "debug 端点可用（clearRateLimits 能生效）"
else
  bad "debug 端点返回 ${DBG} —— clearRateLimits 会失败，限流将无法清理"
fi

# ---------------------------------------------------------------------------
# 6. Playwright
# ---------------------------------------------------------------------------

info "运行 Playwright${SPEC:+（${SPEC}）}"
if [ -n "$SPEC" ]; then
  npx playwright test "$SPEC" --reporter=list > /tmp/ci-eq-e2e.log 2>&1
else
  npx playwright test --reporter=list > /tmp/ci-eq-e2e.log 2>&1
fi
E2E_RC=$?

if [ "$E2E_RC" -eq 0 ]; then
  ok "E2E 全部通过"
else
  bad "E2E 有失败（见 /tmp/ci-eq-e2e.log）"
  echo "──────────────── 失败摘要 ────────────────"
  grep -a -E "^  [0-9]+\) \[" /tmp/ci-eq-e2e.log | head -20
  echo "──────────────── 汇总 ────────────────"
  grep -aE "passed|failed|flaky" /tmp/ci-eq-e2e.log | tail -3
fi

# ---------------------------------------------------------------------------
# 7. 收尾
# ---------------------------------------------------------------------------

kill $SRV_PID 2>/dev/null || true
sleep 2

if [ "$KEEP_DB" != "1" ]; then
  psql_q "DROP DATABASE IF EXISTS \"${DB_NAME}\";" > /dev/null
  info "已删除 ${DB_NAME}（设 KEEP_DB=1 可保留）"
else
  info "保留 ${DB_NAME}（KEEP_DB=1）"
fi

echo ""
echo "════════════════════════════════════════════"
printf "  本地 CI 等价复现：PASS=%s  FAIL=%s\n" "$PASS" "$FAIL"
echo "════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
