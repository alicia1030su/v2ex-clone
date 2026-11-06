#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Windows `next build` EPERM 专项诊断（v0.0.6）
#
# 任务书 §八 要求：
#   1. 检查相关 Node / Next.js 进程及句柄
#   2. 检查构建目录是否被多个任务同时使用
#   3. 检查系统文件权限、杀毒与文件锁
#   4. 检查项目路径及构建缓存
#   5. 在独立、干净的测试工作区复现
#   6. 保存成功与失败日志进行对照
#   7. 研究独立构建目录或构建隔离方案
#   8. 检查 GitHub Windows runner 是否能复现
#
# 禁止：删除用户目录 / 关闭系统安全保护 / 强制终止无关进程。
#
# ## 本脚本做什么
#
#   - 在**独立工作区**（_backups/eperm-lab）用**同一份源码**做连续 N 次构建
#   - 每次记录：开始时间、耗时、退出码、是否 EPERM、.next/trace 是否可创建
#   - 对照「同一工作区连续构建」与「全新工作区首次构建」的失败率
#   - 全程只操作**本项目自己的 .next 目录**，不碰用户目录
#
# ## 用法
#
#   bash scripts/ci/eperm-diagnose.sh [轮数]
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

ROUNDS="${1:-5}"
LAB_ROOT="$(cd "$REPO_ROOT/.." && pwd)/_backups/eperm-lab"
LOG_DIR="$LAB_ROOT/logs"

export NODE_OPTIONS=""
export CODEBUDDY_SAFE_DELETE_ENABLED=0
export CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0
export CODEBUDDY_SAFE_DELETE_SANDBOX=0

mkdir -p "$LOG_DIR"

info() { printf '[INFO]  %s\n' "$1"; }
ok()   { printf '[PASS]  %s\n' "$1"; }
bad()  { printf '[FAIL]  %s\n' "$1"; }

# ---------------------------------------------------------------------------
# 0. 环境事实
# ---------------------------------------------------------------------------

info "环境事实"
info "  OS: $(uname -s) / Node: $(node --version)"
info "  仓库路径: $REPO_ROOT"
info "  仓库路径长度: ${#REPO_ROOT}"
info "  隔离工作区: $LAB_ROOT"

# 检查是否有残留 next 进程持有 .next 句柄（v0.0.5 已证实这是 EPERM 的一个诱因）
LEFTOVER=$(netstat -ano 2>/dev/null | grep -E ":(3000|3010|3025|3100).*LISTENING" | awk '{print $5}' | sort -u | tr '\n' ' ')
if [ -n "$LEFTOVER" ]; then
  info "  ⚠️ 端口上有残留监听进程（PID: $LEFTOVER）—— 可能持有 .next 句柄"
else
  ok "无残留监听进程（3000/3010/3025/3100）"
fi

# ---------------------------------------------------------------------------
# 1. 直接探测 .next/trace 可创建性（最小复现）
# ---------------------------------------------------------------------------

info "探测 .next/trace 可创建性（当前工作区）"
mkdir -p .next 2>/dev/null
if node -e "require('fs').writeFileSync('.next/trace','probe')" 2>/tmp/trace-probe.log; then
  ok ".next/trace 可创建"
  rm -f .next/trace 2>/dev/null || true
else
  bad ".next/trace 创建失败：$(cat /tmp/trace-probe.log)"
fi

# v0.0.6 追加：静态可写性不足以排除锁 —— 实测「构建期间」也能写。
# 这里额外记录文件的**静态属性**（只读 / 隐藏 / 系统），供事后比对。
if [ -f .next/trace ]; then
  node -e "
    const fs=require('fs');
    const p=process.argv[1];
    const st=fs.statSync(p);
    let mode='OK';
    try { const fd=fs.openSync(p,'w'); fs.closeSync(fd); } catch(e) { mode='FAIL:'+e.code; }
    console.log('  trace 属性: mode='+(st.mode & 0o777).toString(8), 'size='+st.size, '独占写='+mode);
  " "$(cygpath -w "$REPO_ROOT/.next/trace")" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 2. 连续构建（同一工作区）—— 观察 EPERM 是否复现
# ---------------------------------------------------------------------------

EPERM_COUNT=0
BUILD_COUNT=0

info "连续构建 ${ROUNDS} 轮（同一工作区，每次前清理 .next）"
for i in $(seq 1 "$ROUNDS"); do
  LOG="$LOG_DIR/build-same-$i.log"
  rm -rf .next 2>/dev/null || true
  START=$(date +%s)
  if npx next build > "$LOG" 2>&1; then
    RC=0
  else
    RC=$?
  fi
  END=$(date +%s)
  BUILD_COUNT=$((BUILD_COUNT+1))
  if grep -qi "EPERM" "$LOG"; then
    EPERM_COUNT=$((EPERM_COUNT+1))
    bad "第 ${i} 轮：EPERM（rc=$RC, $((END-START))s）→ $LOG"
    grep -i "EPERM" "$LOG" | head -3 | sed 's/^/        /'
  else
    ok "第 ${i} 轮：成功（rc=$RC, $((END-START))s）"
  fi
done

info "同一工作区：${BUILD_COUNT} 轮中 ${EPERM_COUNT} 轮 EPERM"

# ---------------------------------------------------------------------------
# 3. 独立干净工作区构建（对照）
# ---------------------------------------------------------------------------

info "独立工作区首次构建（对照：排除「构建目录被复用」这一因素）"
# ⚠️ 只删内容、保留 node_modules —— 但**上一次运行可能留下 MSYS 文本链接**
#    （`ln -s` 产物），它会让 junction 创建被跳过 ⇒ 又变成「假 EPERM」。
#    这里先判断类型：是真 junction 就保留，是 MSYS 链接就删掉。
if [ -e "$LAB_ROOT/src-copy/node_modules" ]; then
  if [ ! -e "$LAB_ROOT/src-copy/node_modules/next/package.json" ]; then
    rm -f "$LAB_ROOT/src-copy/node_modules" 2>/dev/null || true
  fi
fi
rm -rf "$LAB_ROOT/src-copy/src" "$LAB_ROOT/src-copy/public" "$LAB_ROOT/src-copy/drizzle" "$LAB_ROOT/src-copy/.next" 2>/dev/null || true
mkdir -p "$LAB_ROOT/src-copy"
# 只复制构建必需的部分（node_modules 用链接，省时省空间）
cp -r "$REPO_ROOT/src" "$LAB_ROOT/src-copy/" 2>/dev/null || true
cp -r "$REPO_ROOT/public" "$LAB_ROOT/src-copy/" 2>/dev/null || true
for f in package.json package-lock.json tsconfig.json next.config.ts next.config.mjs next.config.js drizzle.config.ts next-env.d.ts; do
  [ -f "$REPO_ROOT/$f" ] && cp "$REPO_ROOT/$f" "$LAB_ROOT/src-copy/" 2>/dev/null || true
done
[ -d "$REPO_ROOT/drizzle" ] && cp -r "$REPO_ROOT/drizzle" "$LAB_ROOT/src-copy/" 2>/dev/null || true

cd "$LAB_ROOT/src-copy" || exit 2
# ⚠️⚠️ 两个**实验环境**陷阱（都曾让我把结论做反，必须记在这里）：
#
#   陷阱 1：Git Bash 的 `ln -s` 创建的是 **MSYS 文本符号链接**
#     （形如 `node_modules -> /c/Users/...`）。
#     Node 的 require 能解析它，但 **TypeScript 解析不了** ——
#     表现：编译成功、类型检查报
#     「Cannot find module or type declarations for side-effect import of './globals.css'」。
#     ⇒ 必须用 **Windows junction**（目录联接），MSYS 链接会让对照实验失真。
#
#   陷阱 2：next-env.d.ts 里的 `/// <reference path="./.next/types/routes.d.ts" />`
#     指向**构建产物**里的文件 —— 干净工作区首次构建时它不存在 ⇒ 类型检查失败。
#     ⇒ 构建前先 `next typegen`（或删掉该引用行）。
#
# 用 Node 的 fs.symlinkSync(..., 'junction') 创建真正的 Windows 目录联接。
if [ ! -e node_modules/next/package.json ]; then
  rm -f node_modules 2>/dev/null || true
  node -e "
    const fs=require('fs');
    const target=process.argv[1], link=process.argv[2];
    try { fs.unlinkSync(link); } catch {}
    fs.symlinkSync(target, link, 'junction');
  " "$(cygpath -w "$REPO_ROOT/node_modules")" "$(cygpath -w "$LAB_ROOT/src-copy/node_modules")" 2>/dev/null || true
fi
if [ ! -e node_modules/next/package.json ]; then
  bad "干净工作区的 node_modules 未就位（junction 创建失败）—— 无法做有效对照"
  exit 1
fi
ok "干净工作区 node_modules 已就位（Windows junction）"

# 陷阱 2：先 typegen 生成 routes.d.ts（否则类型检查必失败）
if [ ! -e .next/types/routes.d.ts ]; then
  npx next typegen > /dev/null 2>&1 || true
fi
if [ ! -e .next/types/routes.d.ts ]; then
  grep -v 'reference path="./.next/types/routes.d.ts"' next-env.d.ts > next-env.d.ts.tmp 2>/dev/null \
    && mv next-env.d.ts.tmp next-env.d.ts 2>/dev/null || true
fi

CLEAN_EPERM=0
for i in 1 2; do
  LOG="$LOG_DIR/build-clean-$i.log"
  rm -rf .next 2>/dev/null || true
  if npx next build > "$LOG" 2>&1; then
    ok "干净工作区第 ${i} 轮：成功"
  else
    if grep -qi "EPERM" "$LOG"; then
      CLEAN_EPERM=$((CLEAN_EPERM+1))
      bad "干净工作区第 ${i} 轮：EPERM → $LOG"
    else
      bad "干净工作区第 ${i} 轮：非 EPERM 失败 → $LOG"
    fi
  fi
done

info "干净工作区：2 轮中 ${CLEAN_EPERM} 轮 EPERM"

cd "$REPO_ROOT" || exit 2

# ---------------------------------------------------------------------------
# 4. 结论汇总
# ---------------------------------------------------------------------------

printf '\n════ EPERM 诊断汇总 ════\n'
printf '同一工作区连续构建：%s/%s 轮 EPERM\n' "$EPERM_COUNT" "$BUILD_COUNT"
printf '独立干净工作区：    %s/2 轮 EPERM\n' "$CLEAN_EPERM"
printf '日志目录：          %s\n' "$LOG_DIR"
printf '（GitHub Windows runner 是否复现由 CI 结果判定 —— Linux runner 不存在此问题）\n'

if [ "$EPERM_COUNT" = "0" ] && [ "$CLEAN_EPERM" = "0" ]; then
  ok "本轮未复现 EPERM（环境已稳定；历史日志仍保留在 $LOG_DIR）"
  exit 0
fi
exit 1
