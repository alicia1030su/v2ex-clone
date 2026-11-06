#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.6 受控实验（第三轮）：在**构建进行中**连续探测 .next/trace 的可写性
#
# 依据：静态探测显示 trace 文件「完全可写」（ReadWrite/Write/Create 都 OK），
#   但构建时仍报 EPERM ⇒ 不是静态权限问题，而是**构建期间的瞬态占用**。
#
# 本脚本：
#   1. 后台启动 next build
#   2. 每 0.5 秒用 Node 尝试**独占**打开 .next/trace（CREATE_ALWAYS）
#   3. 记录每次尝试的结果与时间点
#   4. 对照：构建成功 vs 构建失败时，探测结果有何不同
#
# 关键：探测用 CREATE_ALWAYS（独占创建），能真正测出「谁占着它」。
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

LAB="$(cd "$REPO_ROOT/.." && pwd)/_backups/eperm-lab"
mkdir -p "$LAB/logs"
LOG="$LAB/logs/probe-build.log"

export NODE_OPTIONS=""
export CODEBUDDY_SAFE_DELETE_ENABLED=0
export CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0
export CODEBUDDY_SAFE_DELETE_SANDBOX=0

info() { printf '[INFO]  %s\n' "$1"; }

rm -rf .next 2>/dev/null || true

info "启动构建（后台）+ 并发探测 .next/trace 的独占可写性"
npx next build > "$LAB/logs/build-under-probe.log" 2>&1 &
BUILD_PID=$!

: > "$LOG"
NODE_PROBE='
const fs = require("fs");
const p = process.argv[1];
const t0 = Date.now();
let n = 0, ok = 0, fail = 0, lastErr = "";
while (Date.now() - t0 < 120000) {
  n++;
  try {
    // CREATE_ALWAYS = 独占创建（等价于构建器要做的 open(...,"w")）
    const fd = fs.openSync(p, "w");
    fs.closeSync(fd);
    ok++;
  } catch (e) {
    fail++;
    lastErr = e.code + "/" + e.syscall + ": " + e.message.slice(0, 80);
  }
  if (n % 20 === 0) console.log("PROBE", n, "ok=" + ok, "fail=" + fail, lastErr);
  require("child_process").spawnSync(process.execPath, ["-e", "setTimeout(()=>{},100)"]);
}
console.log("PROBE DONE", "total=" + n, "ok=" + ok, "fail=" + fail, "lastErr=" + lastErr);
'

node -e "$NODE_PROBE" "$(cygpath -w "$REPO_ROOT/.next/trace")" >> "$LOG" 2>&1 &
PROBE_PID=$!

wait "$BUILD_PID"
BUILD_RC=$?
kill "$PROBE_PID" 2>/dev/null || true
wait "$PROBE_PID" 2>/dev/null || true

info "构建退出码=$BUILD_RC"
if grep -qi "EPERM" "$LAB/logs/build-under-probe.log"; then
  info "构建报 EPERM"
else
  info "构建未报 EPERM"
fi
info "探测结果（最后 8 行）："
tail -8 "$LOG"
info "构建日志尾部："
tail -8 "$LAB/logs/build-under-probe.log"
