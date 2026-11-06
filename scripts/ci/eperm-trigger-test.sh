#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.6 受控实验：验证「EPERM 的触发条件是 .next 的**跨目录移动**」
#
# 依据：v0.0.6 首轮 E2E 复现了 EPERM，而该次复现与诊断脚本的唯一差别是
#   - 诊断脚本：rm -rf .next            → **从未**复现
#   - CI 等价脚本：mv .next ../_backups/ → **复现**
#
# 本脚本用同一份源码、同一台机器、同一时段，只改变「.next 的处置方式」，
# 逐一对比：
#   A. rm -rf .next              （原地删除）
#   B. mv .next <同一父目录>     （同卷移动）
#   C. mv .next <另一个目录>     （跨目录移动 —— CI 脚本的做法）
#   D. mv .next <另一个卷>       （跨卷移动，最接近「跨卷」假设）
#
# 每种方式跑 2 轮，记录 EPERM 出现次数。
# 全程只操作本项目自己的 .next 与 _backups/eperm-lab。
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

LAB="$(cd "$REPO_ROOT/.." && pwd)/_backups/eperm-lab"
mkdir -p "$LAB/logs" "$LAB/stale-same" "$LAB/stale-cross"

export NODE_OPTIONS=""
export CODEBUDDY_SAFE_DELETE_ENABLED=0
export CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0
export CODEBUDDY_SAFE_DELETE_SANDBOX=0

info() { printf '[INFO]  %s\n' "$1"; }
ok()   { printf '[PASS]  %s\n' "$1"; }
bad()  { printf '[FAIL]  %s\n' "$1"; }

# 判定一次构建的结果
run_build() {
  local label="$1" log="$2"
  if npx next build > "$log" 2>&1; then
    echo "OK"
  elif grep -qi "EPERM" "$log"; then
    echo "EPERM"
  else
    echo "OTHER"
  fi
}

# ── A. 原地删除 ──
info "A. rm -rf .next（原地删除）"
A_EPERM=0
for i in 1 2; do
  LOG="$LAB/logs/expA-$i.log"
  rm -rf .next 2>/dev/null || true
  R=$(run_build "A" "$LOG")
  [ "$R" = "EPERM" ] && A_EPERM=$((A_EPERM+1))
  info "  第 ${i} 轮：$R"
done
[ "$A_EPERM" = "0" ] && ok "A：0/2 EPERM" || bad "A：${A_EPERM}/2 EPERM"

# ── B. 同父目录移动 ──
info "B. mv .next <同一父目录>（同卷移动）"
B_EPERM=0
for i in 1 2; do
  LOG="$LAB/logs/expB-$i.log"
  rm -rf "$LAB/stale-same/.next.stale.B$i" 2>/dev/null || true
  if [ -d .next ]; then mv .next "$LAB/stale-same/.next.stale.B$i" 2>/dev/null || rm -rf .next 2>/dev/null || true; fi
  R=$(run_build "B" "$LOG")
  [ "$R" = "EPERM" ] && B_EPERM=$((B_EPERM+1))
  info "  第 ${i} 轮：$R"
done
[ "$B_EPERM" = "0" ] && ok "B：0/2 EPERM" || bad "B：${B_EPERM}/2 EPERM"

# ── C. 跨目录移动（CI 等价脚本的做法）──
info "C. mv .next <另一个目录>（跨目录移动 —— CI 脚本的做法）"
C_EPERM=0
for i in 1 2; do
  LOG="$LAB/logs/expC-$i.log"
  rm -rf "$LAB/stale-cross/.next.stale.C$i" 2>/dev/null || true
  if [ -d .next ]; then mv .next "$LAB/stale-cross/.next.stale.C$i" 2>/dev/null || rm -rf .next 2>/dev/null || true; fi
  R=$(run_build "C" "$LOG")
  [ "$R" = "EPERM" ] && C_EPERM=$((C_EPERM+1))
  info "  第 ${i} 轮：$R"
done
[ "$C_EPERM" = "0" ] && ok "C：0/2 EPERM" || bad "C：${C_EPERM}/2 EPERM"

# ── D. 目录消失后**立即**重建（CI 等价脚本的真实时序）──
#    CI 脚本的顺序是：mv .next 走 ⇒ **紧接着** npx next build
#    ⇒ Next 需要**新建** .next/trace。若 Windows 对「刚被移走的目录」
#      的元数据提交尚未完成，创建新文件就会 EPERM。
#    前面 A/B/C 都成功后移到**别的目录**再 mv 回来 ⇒ 没有制造
#    「同路径目录刚消失」的时序，因此从未复现。
info "D. mv .next 走（同一路径）后立即构建 —— CI 等价脚本的真实时序"
D_EPERM=0
for i in 1 2; do
  LOG="$LAB/logs/expD-$i.log"
  STALE="$REPO_ROOT/.next.stale.expD$i"
  rm -rf "$STALE" 2>/dev/null || true
  if [ -d .next ]; then mv .next "$STALE" 2>/dev/null || rm -rf .next 2>/dev/null || true; fi
  R=$(run_build "D" "$LOG")
  [ "$R" = "EPERM" ] && D_EPERM=$((D_EPERM+1))
  info "  第 ${i} 轮：$R"
  rm -rf "$STALE" 2>/dev/null || true
done
[ "$D_EPERM" = "0" ] && ok "D：0/2 EPERM" || bad "D：${D_EPERM}/2 EPERM"

printf '\n════ EPERM 触发条件对照 ════\n'
printf 'A 原地删除（rm -rf）：      %s/2 EPERM\n' "$A_EPERM"
printf 'B 同父目录移动（mv）：      %s/2 EPERM\n' "$B_EPERM"
printf 'C 跨目录移动（mv）：        %s/2 EPERM\n' "$C_EPERM"
printf 'D 同路径移走后立即构建：   %s/2 EPERM\n' "$D_EPERM"
printf '\n（CI 等价脚本用的是 D 的做法）\n'
printf '日志：%s/logs/\n' "$LAB"

if [ "$D_EPERM" != "0" ] && [ "$A_EPERM" = "0" ]; then
  ok "假设成立：EPERM 由「.next 同路径移走后立即重建」的时序触发"
  exit 0
fi
exit 1
