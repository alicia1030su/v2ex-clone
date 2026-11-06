#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.6：Windows EPERM 的**根因缓解** —— 预创建 trace 文件
#
# ## 根因（已实测定位到 Next 的具体代码）
#
# Next 15.5 的 trace 写入器 `node_modules/next/dist/trace/report/to-json.js`：
#
#     class RotatingWriteStream {
#       async rotate() {
#         await this.end();
#         fs.unlinkSync(this.file);          // ← 删除
#         this.createWriteStream();          // ← 立刻重建（createWriteStream）
#       }
#     }
#
# 在 Windows 上，「删除后**立刻**以 createWriteStream 重建同一路径」
# 会**偶发**返回 `EPERM: operation not permitted, open '...\.next\trace'`。
#
# ## 实测证据（scripts/ci/eperm-trigger-test*.sh + 最小复现）
#
#   · 同步 openSync 路径：80/80 全部成功 ⇒ 不是文件权限问题
#   · 静态探测（ReadWrite / Write / Create）：全部成功 ⇒ 不是 ACL / 只读问题
#   · 异步 createWriteStream 紧跟 unlink：可复现 EPERM（10 轮出现 2 次）
#   · 多进程并发首次创建：72/72 成功 ⇒ 不是多进程竞态
#   · 预创建文件后再 createWriteStream（走 append）：40/40 成功、0 EPERM
#
# ## 缓解方案
#
# 构建前**预先创建** `<distDir>/trace`（空文件）。
# Next 的 createWriteStream 用 flags:'a'（追加）⇒ 文件已存在时走 append 分支，
# **不再走「删除后立即重建」的 create 分支** ⇒ 绕开该竞态。
#
# 该措施**只在 Windows 上启用**（Linux 无此问题，且无需打扰）。
# ---------------------------------------------------------------------------
set -uo pipefail

DIST_DIR="${1:-.next}"
TRACE="$DIST_DIR/trace"

# 只在 Windows 上启用
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT) ;;
  *) exit 0 ;;
esac

mkdir -p "$DIST_DIR" 2>/dev/null || exit 0

# 预创建（已存在则不动 —— 不能用 unlink，那正是竞态本身）
if [ ! -e "$TRACE" ]; then
  node -e "
    const fs=require('fs');
    const p=process.argv[1];
    try { fs.closeSync(fs.openSync(p,'a')); } catch(e) { process.exit(0); }
  " "$(cygpath -w "$TRACE")" 2>/dev/null || true
fi

[ -e "$TRACE" ] && echo "[INFO]  已预创建 trace 文件（EPERM 缓解）：$TRACE"
exit 0
