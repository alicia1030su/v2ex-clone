#!/usr/bin/env bash
# 快速在线检查：起 PG + 起服务（复用 .next）+ 执行检查命令 + 收尾
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

export PGHOST=127.0.0.1 PGPORT=55440 PGUSER=v2ex
export PGPASSWORD="v2ex_test_password_local_only"
export PGCLIENTENCODING=UTF8
export DATABASE_URL="postgres://v2ex:v2ex_test_password_local_only@127.0.0.1:55440/v2ex_visual"
export APP_RUNTIME_ENV=test TEST_ENV_ISOLATED=1 DISABLE_CAPTCHA=1
export ENABLE_DEBUG_ENDPOINTS=1 DEBUG_ENDPOINT_TOKEN="ci-debug-token-not-for-production"
export SESSION_SECRET="ci-only-session-secret-0123456789abcdef0123456789abcdef"
export APP_URL="http://localhost:3010" NEXT_PUBLIC_APP_URL="http://localhost:3010"
export ENV_FILE=".env.test"
export NODE_OPTIONS="" CODEBUDDY_SAFE_DELETE_ENABLED=0 CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0

port_open() {
  node -e "require('net').connect($1,'127.0.0.1').on('connect',function(){this.end();process.exit(0)}).on('error',()=>process.exit(1))" 2>/dev/null
}

if port_open 55440; then echo "[PASS] PG 在跑"; else
  bash tests/helpers/start-test-pg.sh start > /tmp/qk-pg.log 2>&1 || true
  for i in $(seq 1 20); do port_open 55440 && break; sleep 1; done
  port_open 55440 && echo "[PASS] PG 已启动" || { echo "[FAIL] PG 未就绪"; exit 1; }
fi

if [ ! -f .next/BUILD_ID ]; then echo "[FAIL] 没有 .next/BUILD_ID —— 先跑 run-visual-regression.sh"; exit 1; fi

if port_open 3010; then echo "[FAIL] 3010 已被占用"; exit 1; fi

npx next start -p 3010 > /tmp/qk-server.log 2>&1 &
SRV_PID=$!
cleanup() {
  kill "$SRV_PID" 2>/dev/null || true
  for pid in $(netstat -ano 2>/dev/null | grep ":3010.*LISTENING" | awk '{print $5}' | sort -u); do
    [ -n "$pid" ] && taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

for i in $(seq 1 60); do
  C="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3010/ 2>/dev/null || echo 000)"
  [ "$C" = "200" ] && break
  sleep 1
done
[ "$C" = "200" ] && echo "[PASS] 应用就绪" || { echo "[FAIL] 应用未就绪"; tail -20 /tmp/qk-server.log; exit 1; }

node "$1"
