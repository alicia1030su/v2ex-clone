#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 严格验证脚本
#
# 顺序：类型检查 → 构建 → 干净数据库迁移 → seed → 单元测试 → 启动服务 → E2E
#
# 重要：构建后**必须重启** next start，否则会测到旧构建产物
#（Next.js 会缓存已渲染的 HTML 引用旧的静态资源哈希）。
#
# 用法:
#   ./scripts/verify.sh              # 完整流程（需 PostgreSQL 已运行）
#   ./scripts/verify.sh --skip-e2e   # 跳过 E2E
# ---------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

export PATH="/c/Users/TYMO001/WorkBuddy/ai/_tools/node/node-v22.23.4-win-x64:$PATH"
export ENV_FILE="${ENV_FILE:-.env.test}"
export LOCAL_BASE="${LOCAL_BASE:-http://localhost:3030}"
export PORT="${PORT:-3030}"
export DEBUG_ENDPOINT_TOKEN="${DEBUG_ENDPOINT_TOKEN:-test-debug-token-local-only}"

PGB=/c/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/psql.exe
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=v2ex
TEST_DB=v2ex_test

SKIP_E2E=0
[ "${1:-}" = "--skip-e2e" ] && SKIP_E2E=1

step() { echo ""; echo "════ $1 ════"; }
fail() { echo "✗ $1"; exit 1; }

# ---------------------------------------------------------------------------
step "1/6 TypeScript 类型检查"
npx tsc --noEmit || fail "类型检查失败"

# ---------------------------------------------------------------------------
step "2/6 生产构建"
npx next build || fail "构建失败"

# ---------------------------------------------------------------------------
step "3/6 干净数据库：重建 + 全部迁移"
"$PGB" -h $PGHOST -p $PGPORT -U postgres -d postgres \
  -c "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null 2>&1
"$PGB" -h $PGHOST -p $PGPORT -U postgres -d postgres \
  -c "CREATE DATABASE $TEST_DB OWNER v2ex;" >/dev/null 2>&1 || fail "创建测试数据库失败"
npx drizzle-kit migrate 2>&1 | tail -2

TABLE_COUNT=$("$PGB" -h $PGHOST -p $PGPORT -U $PGUSER -d $TEST_DB -t -A -c \
  "select count(*) from information_schema.tables where table_schema='public';")
echo "表数量: $TABLE_COUNT"
[ "$TABLE_COUNT" -ge 18 ] || fail "迁移不完整（期望 ≥18 张表，实际 $TABLE_COUNT）"

# ---------------------------------------------------------------------------
step "4/6 种子数据"
npx tsx scripts/seed.ts 2>&1 | tail -6

# ---------------------------------------------------------------------------
step "5/6 单元测试"
npx vitest run 2>&1 | tail -6

# ---------------------------------------------------------------------------
if [ "$SKIP_E2E" = "1" ]; then
  echo ""; echo "✓ 验证完成（跳过 E2E）"
  exit 0
fi

step "6/6 E2E 测试"
# 重启服务，确保使用刚构建的产物
powershell -NoProfile -Command "
  Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |
    Where-Object { \$_.CommandLine -like '*v2ex-clone*next*start*' } |
    ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }
" >/dev/null 2>&1
sleep 2

npx next start -p $PORT > /tmp/v2ex-verify-server.log 2>&1 &
SERVER_PID=$!

# 等待服务就绪
for i in $(seq 1 40); do
  if curl -sS -o /dev/null --max-time 5 "$LOCAL_BASE/" 2>/dev/null; then break; fi
  sleep 1
done
curl -sS -o /dev/null --max-time 20 "$LOCAL_BASE/" || fail "服务未能启动"

LOCAL_BASE=$LOCAL_BASE npx playwright test --reporter=list 2>&1 | tail -20
E2E_EXIT=${PIPESTATUS[0]}

kill $SERVER_PID 2>/dev/null

echo ""
if [ "$E2E_EXIT" = "0" ]; then
  echo "✓ 全部验证通过"
else
  echo "✗ E2E 失败（详见 test-results/）"
  exit 1
fi
