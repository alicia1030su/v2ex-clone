#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 严格验证脚本（跨平台）
#
# 顺序：类型检查 → 构建 → 干净数据库迁移 → seed → 单元测试 → 启动服务 → E2E
#
# 跨平台要点（P0-5）：
#  - **不写死任何本机路径**。Node 与 PostgreSQL 客户端一律从环境变量或
#    PATH 解析；旧版本硬编码了 /c/Users/TYMO001/... 的 Windows 路径，
#    在 Linux CI 与其他开发者机器上必然失败。
#  - **数据库操作全部走 Node 脚本**（scripts/db-admin.mjs），
#    不依赖 psql/pg_dump 命令行工具 —— 后者在 Windows 上是 psql.exe，
#    在 CI 容器里又可能不存在。
#  - **进程管理区分平台**：Windows 用 taskkill，POSIX 用 kill。
#
# 重要：构建后**必须重启** next start，否则会测到旧构建产物
#（Next.js 会缓存已渲染的 HTML 引用旧的静态资源哈希）。
#
# 用法:
#   ./scripts/verify.sh              # 完整流程（需 PostgreSQL 已运行）
#   ./scripts/verify.sh --skip-e2e   # 跳过 E2E
#
# 环境变量（均可选，有合理默认值）:
#   DATABASE_URL     测试数据库连接串（默认取 .env.test）
#   TEST_DB_NAME    验证用的数据库名（默认 v2ex_verify）
#   PG_ADMIN_URL    管理员连接串（默认由 DATABASE_URL 推导，库名换 postgres）
#   LOCAL_BASE      被测服务地址（默认 http://localhost:3030）
#   PORT            被测服务端口（默认 3030）
#   DEBUG_ENDPOINT_TOKEN  调试端点令牌（用于重置限流配额）
# ---------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# ---------------------------------------------------------------------------
# 平台检测
# ---------------------------------------------------------------------------
IS_WINDOWS=0
case "${OS:-}" in
  Windows_NT) IS_WINDOWS=1 ;;
esac
if [ "$IS_WINDOWS" -eq 0 ] && command -v uname >/dev/null 2>&1; then
  if [ "$(uname -s)" = "MINGW"* ] || [ "$(uname -s)" = "MSYS"* ] || [ "$(uname -s)" = "CYGWIN"* ]; then
    IS_WINDOWS=1
  fi
fi

# ---------------------------------------------------------------------------
# Node 解析：优先用 PATH 中的 node，其次用 node_modules/.bin 里的本地包装器
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
elif [ -n "${NODE_BIN_OVERRIDE:-}" ]; then
  NODE_BIN="$NODE_BIN_OVERRIDE"
else
  echo "✗ 找不到 node。请安装 Node.js >= 22.23.4 或设置 NODE_BIN_OVERRIDE。" >&2
  exit 1
fi

echo "平台: $([ "$IS_WINDOWS" -eq 1 ] && echo Windows || echo POSIX)"
echo "Node: $("$NODE_BIN" --version)"

# ---------------------------------------------------------------------------
# 加载环境文件
# ---------------------------------------------------------------------------
# ENV_FILE 优先；默认 .env.test（隔离测试环境）。
# 注意不能写死路径 —— 相对仓库根目录解析即可。
ENV_FILE="${ENV_FILE:-.env.test}"

if [ -f "$ENV_FILE" ]; then
  echo "环境文件: $ENV_FILE"
  # 把 .env 内容导入当前 shell，然后**清空 ENV_FILE**。
  #
  # 为什么清空 ENV_FILE：
  # 清空 ENV_FILE 是为了**确定性地指向验证库**，与 dotenv 的 override 语义
  # **无关**（更安全，不依赖 dotenv 的优先级）。
  #
  # 具体机制：把 .env 内容导入到当前 shell 后清空 ENV_FILE，所有后续工具
  # （迁移 / seed / E2E）都只从 shell 读变量，指向的都是验证库 ——
  # 既隔离，也不会误伤开发数据。
  #
  # ⚠️ 这条做法**不依赖**任何「override 有/无」的实现细节：
  # v0.0.4 之前这里写的是「必须清空 ENV_FILE，否则 .env.test 的 DATABASE_URL
  # 会覆盖 shell 里的验证库连接串」（那时 db/index.ts、drizzle.config.ts、
  # seed.ts 都用 dotenv 的 `override: true`）。该描述在
  # `src/lib/env-loader.mjs`（全仓统一加载器）落地后已**过时** ——
  # 现在的优先级是「shell / CI 注入 > ENV_FILE 文件 > .env.local > .env」，
  # 文件**只填充未设置的变量**，shell 注入的值永远赢。
  # 但「清空 ENV_FILE」这个动作**本身依然正确且必要**：
  # 它让「父进程规范化 → 子进程只继承」成为唯一事实，
  # 子进程不会再去解析任何 env 文件，从而杜绝「父子走散」。
  #
  # 详见 `docs/TEST_ENV_ISOLATION_v0.0.4.md` §3.1~§3.4。
  eval "$("$NODE_BIN" scripts/env-dump.mjs "$ENV_FILE")"
  unset ENV_FILE
else
  echo "⚠ 未找到 $ENV_FILE，将依赖当前 shell 的环境变量"
fi

LOCAL_BASE="${LOCAL_BASE:-http://localhost:3030}"
PORT="${PORT:-3030}"
export LOCAL_BASE
export DEBUG_ENDPOINT_TOKEN="${DEBUG_ENDPOINT_TOKEN:-test-debug-token-local-only}"

SKIP_E2E=0
[ "${1:-}" = "--skip-e2e" ] && SKIP_E2E=1

step() { echo ""; echo "════ $1 ════"; }
fail() { echo "✗ $1"; exit 1; }

# ---------------------------------------------------------------------------
# 数据库辅助：统一走 Node 脚本，避免依赖 psql 命令行工具
# ---------------------------------------------------------------------------
TEST_DB_NAME="${TEST_DB_NAME:-v2ex_verify}"

db_admin() {
  # 用法: db_admin <create|drop|table-count|db-url> [库名]
  "$NODE_BIN" scripts/db-admin.mjs "$@"
}

# 指向验证专用库的连接串 —— migrate / seed 必须用它，
# 否则会在 DATABASE_URL 原本指向的库上操作（可能是开发库！）。
VERIFY_DB_URL="$(db_admin db-url "$TEST_DB_NAME")"
export DATABASE_URL="$VERIFY_DB_URL"
echo "验证数据库: $TEST_DB_NAME"

# 安全闸门：确认目标库确实是「验证专用库」，
# 绝不允许在开发库 / 生产库上执行 drop / migrate。
case "$TEST_DB_NAME" in
  v2ex_verify*|*_verify*|*_test*|*_ci*|v2ex_seedtest)
    echo "✓ 目标库校验通过: $TEST_DB_NAME"
    ;;
  *)
    fail "拒绝在非验证库上执行破坏性操作: $TEST_DB_NAME"
    ;;
esac

# ---------------------------------------------------------------------------
step "1/6 TypeScript 类型检查"
npx tsc --noEmit || fail "类型检查失败"

# ---------------------------------------------------------------------------
step "2/6 生产构建"
npx next build || fail "构建失败"

# ---------------------------------------------------------------------------
step "3/6 干净数据库：重建 + 全部迁移"
db_admin drop "$TEST_DB_NAME" || fail "删除旧测试数据库失败"
db_admin create "$TEST_DB_NAME" || fail "创建测试数据库失败"

npx drizzle-kit migrate 2>&1 | tail -2 || fail "迁移失败"

TABLE_COUNT=$(db_admin table-count "$TEST_DB_NAME")
echo "表数量: $TABLE_COUNT"
[ "$TABLE_COUNT" -ge 18 ] || fail "迁移不完整（期望 ≥18 张表，实际 $TABLE_COUNT）"

# ---------------------------------------------------------------------------
step "4/6 种子数据"
npx tsx scripts/seed.ts 2>&1 | tail -8 || fail "seed 失败"

# ---------------------------------------------------------------------------
step "5/6 单元测试"
npx vitest run 2>&1 | tail -8 || fail "单元测试失败"

# ---------------------------------------------------------------------------
if [ "$SKIP_E2E" = "1" ]; then
  echo ""; echo "✓ 验证完成（跳过 E2E）"
  exit 0
fi

# ---------------------------------------------------------------------------
step "6/6 E2E 测试"

# 停止可能残留的旧服务（跨平台）
stop_stale_servers() {
  if [ "$IS_WINDOWS" -eq 1 ]; then
    # Windows：按端口找 PID。
    # 注意 netstat 的输出格式是 "TCP  0.0.0.0:3030  0.0.0.0:0  LISTENING  32640"，
    # 端口后面是空格再接状态列，因此匹配 ":$PORT" + 空白 才是端口边界，
    # 否则 ":3030" 会误匹配 ":30301" 之类的端口。
    PID=$(netstat -ano 2>/dev/null \
      | grep -E "LISTENING" \
      | grep -E ":${PORT}[[:space:]]" \
      | awk '{print $NF}' \
      | head -1)
    if [ -n "$PID" ]; then
      echo "停止占用端口 $PORT 的旧进程 (PID=$PID)"
      taskkill //F //PID "$PID" >/dev/null 2>&1
      sleep 2
    fi
  else
    # POSIX：按端口找 PID
    if command -v lsof >/dev/null 2>&1; then
      PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null)
      [ -n "$PIDS" ] && kill $PIDS 2>/dev/null && sleep 2
    elif command -v fuser >/dev/null 2>&1; then
      fuser -k "$PORT"/tcp 2>/dev/null && sleep 2
    fi
  fi
}

stop_stale_servers

# 端口必须真的空出来，否则新起的服务会绑不上，
# E2E 打到旧服务上（连着不同的数据库），结果不可信。
for i in $(seq 1 15); do
  if ! curl -sS -o /dev/null --max-time 2 "$LOCAL_BASE/" 2>/dev/null; then
    break
  fi
  sleep 1
done
if curl -sS -o /dev/null --max-time 2 "$LOCAL_BASE/" 2>/dev/null; then
  fail "端口 $PORT 上仍有服务在运行，无法安全启动新的验证实例。请手动停止后重试。"
fi
sleep 2

# 启动服务（后台）
npx next start -p "$PORT" > /tmp/v2ex-verify-server.log 2>&1 &
SERVER_PID=$!

# 等待服务就绪
READY=0
for i in $(seq 1 60); do
  if curl -sS -o /dev/null --max-time 5 "$LOCAL_BASE/" 2>/dev/null; then
    READY=1
    break
  fi
  # 若服务进程已退出，直接失败
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "--- 服务日志 ---"
  tail -30 /tmp/v2ex-verify-server.log 2>/dev/null
  kill "$SERVER_PID" 2>/dev/null
  fail "服务未能启动（详见 /tmp/v2ex-verify-server.log）"
fi

# E2E 输出完整保存到日志文件 —— 失败时只截取尾部会丢掉真正的错误信息。
E2E_LOG="${E2E_LOG:-/tmp/v2ex-verify-e2e.log}"
npx playwright test --reporter=list > "$E2E_LOG" 2>&1
E2E_EXIT=$?

if [ "$E2E_EXIT" != "0" ]; then
  echo "--- E2E 失败详情（完整日志：$E2E_LOG）---"
  # 打印失败用例的断言上下文，而不是只看最后 20 行
  grep -E "✘|×|Error|Expected|Received|Timeout|at .*spec\.ts" "$E2E_LOG" | head -40
  echo "..."
  tail -20 "$E2E_LOG"
fi

kill "$SERVER_PID" 2>/dev/null

echo ""
if [ "$E2E_EXIT" = "0" ]; then
  echo "✓ 全部验证通过"
else
  echo "✗ E2E 失败（详见 $E2E_LOG 与 test-results/）"
  exit 1
fi
