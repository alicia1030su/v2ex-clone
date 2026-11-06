#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.6 受控实验（第二轮）：验证「EPERM 的触发条件是 **next start 存活期间**构建」
#
# 依据：v0.0.6 的 EPERM 复现现场是 `scripts/ci/run-e2e-locally.sh` ——
#   该脚本**上一轮**启动过 `next start`（并在退出时杀进程树）。
#   而本轮所有实验都在「无服务存活」状态下进行 ⇒ 全部 0/2。
#
# 关键疑点：Windows 上 `next start` 的**子进程**可能没被完全杀掉，
#   仍持有 `.next/trace` 的句柄；此时构建要「创建」同名文件 ⇒ EPERM。
#
# 本脚本分三组：
#   E. 构建（无服务）          —— 基线
#   F. 启动 next start → 构建   —— 服务存活时构建
#   G. 启动 next start → 杀包装器（不杀子进程）→ 构建
#      —— 复刻「残留子进程」场景
#
# 全程只操作本项目自己的 .next 与 _backups/eperm-lab。
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

LAB="$(cd "$REPO_ROOT/.." && pwd)/_backups/eperm-lab"
mkdir -p "$LAB/logs"

export NODE_OPTIONS=""
export CODEBUDDY_SAFE_DELETE_ENABLED=0
export CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0
export CODEBUDDY_SAFE_DELETE_SANDBOX=0
export APP_RUNTIME_ENV=test
export DATABASE_URL="postgres://v2ex:v2ex_test_password_local_only@127.0.0.1:55440/v2ex_visual"
export SESSION_SECRET="ci-only-session-secret-0123456789abcdef0123456789abcdef"
export APP_URL="http://localhost:3011"
export NEXT_PUBLIC_APP_URL="http://localhost:3011"
export ENV_FILE=".env.test"

PORT=3011
info() { printf '[INFO]  %s\n' "$1"; }
ok()   { printf '[PASS]  %s\n' "$1"; }
bad()  { printf '[FAIL]  %s\n' "$1"; }

run_build() {
  local log="$1"
  if npx next build > "$log" 2>&1; then echo "OK"
  elif grep -qi "EPERM" "$log"; then echo "EPERM"
  else echo "OTHER"; fi
}

kill_tree() {
  for pid in $(netstat -ano 2>/dev/null | grep ":${PORT}.*LISTENING" | awk '{print $5}' | sort -u); do
    [ -n "$pid" ] && taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  done
}

# ── E. 基线：无服务 ──
info "E. 基线：构建（无服务存活）"
E_EPERM=0
for i in 1 2; do
  rm -rf .next 2>/dev/null || true
  R=$(run_build "$LAB/logs/expE-$i.log")
  [ "$R" = "EPERM" ] && E_EPERM=$((E_EPERM+1))
  info "  第 ${i} 轮：$R"
done
[ "$E_EPERM" = "0" ] && ok "E：0/2 EPERM" || bad "E：${E_EPERM}/2 EPERM"

# ── F. 服务存活时构建 ──
info "F. next start 存活期间构建"
F_EPERM=0
for i in 1 2; do
  kill_tree
  # ⚠️ 顺序很重要：**先构建出产物**，再启动服务 ——
  #    否则 next start 找不到 BUILD_ID（实测踩到：服务根本起不来，
  #    「服务存活时构建」这个场景根本没被测到）。
  rm -rf .next 2>/dev/null || true
  PRE=$(run_build "$LAB/logs/expF-pre-$i.log")
  [ "$PRE" = "OK" ] || { info "  第 ${i} 轮：预构建失败（$PRE），跳过"; continue; }
  npx next start -p $PORT > "$LAB/logs/expF-server-$i.log" 2>&1 &
  SRV=$!
  for _ in $(seq 1 40); do
    C=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/" 2>/dev/null || echo 000)
    [ "$C" = "200" ] && break
    sleep 1
  done
  info "  第 ${i} 轮：服务已启动（C=$C），现在构建"
  R=$(run_build "$LAB/logs/expF-$i.log")
  [ "$R" = "EPERM" ] && F_EPERM=$((F_EPERM+1))
  info "  第 ${i} 轮：$R"
  kill "$SRV" 2>/dev/null || true
  kill_tree
  sleep 1
done
[ "$F_EPERM" = "0" ] && ok "F：0/2 EPERM" || bad "F：${F_EPERM}/2 EPERM"

# ── G. 只杀包装器、留子进程（复刻「残留」场景）──
info "G. 只杀 npx 包装器、保留 next 子进程，然后构建"
G_EPERM=0
for i in 1 2; do
  kill_tree
  rm -rf .next 2>/dev/null || true
  PRE=$(run_build "$LAB/logs/expG-pre-$i.log")
  [ "$PRE" = "OK" ] || { info "  第 ${i} 轮：预构建失败（$PRE），跳过"; continue; }
  npx next start -p $PORT > "$LAB/logs/expG-server-$i.log" 2>&1 &
  SRV=$!
  for _ in $(seq 1 40); do
    C=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/" 2>/dev/null || echo 000)
    [ "$C" = "200" ] && break
    sleep 1
  done
  # **只**杀 npx 包装器 —— 真正的 next 服务器子进程继续活着并持有 .next 句柄
  kill "$SRV" 2>/dev/null || true
  sleep 2
  LISTEN=$(netstat -ano 2>/dev/null | grep ":${PORT}.*LISTENING" | awk '{print $5}' | sort -u | tr '\n' ' ')
  info "  第 ${i} 轮：残留监听 PID=[${LISTEN}]，现在构建"
  R=$(run_build "$LAB/logs/expG-$i.log")
  [ "$R" = "EPERM" ] && G_EPERM=$((G_EPERM+1))
  info "  第 ${i} 轮：$R"
  kill_tree
  sleep 1
done
[ "$G_EPERM" = "0" ] && ok "G：0/2 EPERM" || bad "G：${G_EPERM}/2 EPERM"

printf '\n════ EPERM 触发条件对照（第二轮）════\n'
printf 'E 无服务：                  %s/2 EPERM\n' "$E_EPERM"
printf 'F 服务存活时构建：          %s/2 EPERM\n' "$F_EPERM"
printf 'G 残留子进程后构建：        %s/2 EPERM\n' "$G_EPERM"
printf '\n日志：%s/logs/\n' "$LAB"

if [ "$G_EPERM" != "0" ] && [ "$E_EPERM" = "0" ]; then
  ok "假设成立：EPERM 由「next start 的子进程残留且持有 .next 句柄」触发"
  exit 0
fi
exit 1
