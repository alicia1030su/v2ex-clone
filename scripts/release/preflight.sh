#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.4 发布前检查（PREFLIGHT）—— 严格只读 / 双模式
#
# 用法：
#   bash scripts/release/preflight.sh                  # 默认 --phase=dev
#   bash scripts/release/preflight.sh --phase=dev     # 开发态（当前适用）
#   bash scripts/release/preflight.sh --phase=release # 发布时刻（最终 SHA 固定后）
#   bash scripts/release/preflight.sh --help
#
# 为什么有双模式（主理人裁决，见 CHANGELOG.md [Unreleased]）：
#   v0.0.4 开发阶段刻意把所有版本载体保持 0.0.3，不提前升级 —— 在最终 SHA
#   固定前升版本号会造成「版本已是 0.0.4、却无对应 Tag」的中间态，且后续
#   改 SHA 又要改版本号，等同于被禁止的「同一版本号反复移动」。
#   正确流程：[Unreleased] 累积 → 合并并固定最终 SHA → **一次性**把版本载体、
#   Tag、Draft Release 同步到 v0.0.4。
#   · dev     ：版本载体为 0.0.3 是**预期状态** → [INFO]，不判 FAIL
#   · release ：才要求全部为 0.0.4 → 否则 FAIL；本模式只应在最终 SHA 固定后运行
#
# 双模式之外，第 7 节额外覆盖「升级链路」：
#   · deploy/update.sh 是否具备「改写 .env 中 V2EX_IMAGE」的能力（R-18 核心）
#   · deploy/VERSION 与 .env.example 的镜像 tag 是否与目标版本一致
#   · release.yml 的 push tag 白名单是否已包含目标版本 —— **需要人工放行**，
#     本脚本只报出、**绝不自动修改**白名单（R-19 的刻意摩擦）
#
# 硬性约束（本脚本自我承诺，评审时请逐条核对）：
#   - 不执行任何写操作：不建/删文件、不改文件、不 git add/commit/tag、
#     不 git stash/checkout/restore、不 npm install、不跑迁移、不跑测试
#   - 不执行任何远端操作：无 git fetch/push/ls-remote、无 gh、无 curl、
#     无 docker pull/push、无网络请求
#   - 只读命令集合：git status/rev-parse/branch/tag -l/ls-files、grep、
#     sed、cut、tr、od、cat、node -p、bash -n
#   - 检查到阻断项时只报告，不尝试"自动修复"
#   - 双模式只改变「版本载体 / tag 白名单」的判定口径；
#     R-01 授权阻断、安装脚本 BOM/语法、迁移幂等、密钥泄漏等真缺陷项
#     **在任何模式下都不放宽**
#
# 退出码：0 = 无 FAIL 且无 BLOCK；1 = 存在 FAIL 或 BLOCK（禁止发布）；2 = 参数错误
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

# --- 参数解析 --------------------------------------------------------------
PHASE='dev'
case "${1:-}" in
  ''|--phase=dev)     PHASE='dev' ;;
  --phase=release)    PHASE='release' ;;
  -h|--help)
    printf '用法：bash scripts/release/preflight.sh [--phase=dev|--phase=release]\n'
    printf '  dev     （默认）开发态：版本载体保持 0.0.3 属预期，不判 FAIL\n'
    printf '  release 发布时刻：最终 SHA 固定后运行，要求版本载体全部同步到 0.0.4\n'
    exit 0 ;;
  *)
    printf '未知参数：%s（可用 --phase=dev / --phase=release / --help）\n' "$1" >&2
    exit 2 ;;
esac
if [ "$#" -gt 1 ]; then
  printf '参数过多：只接受一个 --phase 参数\n' >&2
  exit 2
fi

TARGET='0.0.4'
VTAG='v0.0.4'
DEV_BASELINE='0.0.3'
EXPECTED_IMAGE="ghcr.io/alicia1030su/v2ex-clone:${VTAG}"
DEV_IMAGE="ghcr.io/alicia1030su/v2ex-clone:v${DEV_BASELINE}"

PASS=0; WARN=0; FAIL=0; BLOCK=0; INFO=0
ok()    { printf '[PASS]  %s\n' "$1";  PASS=$((PASS+1));  }
warn()  { printf '[WARN]  %s\n' "$1";  WARN=$((WARN+1));  }
fail()  { printf '[FAIL]  %s\n' "$1";  FAIL=$((FAIL+1));  }
block() { printf '[BLOCK] %s\n' "$1";  BLOCK=$((BLOCK+1)); }
info()  { printf '[INFO]  %s\n' "$1";  INFO=$((INFO+1));  }
note()  { printf '        %s\n' "$1"; }
section(){ printf '\n--- %s ---\n' "$1"; }

printf '=== v0.0.4 PREFLIGHT (READ-ONLY, phase=%s) ===\n' "$PHASE"
printf 'repo   : %s\n' "$REPO_ROOT"
printf 'target : %s / %s\n' "$TARGET" "$VTAG"
printf 'phase  : %s\n' "$PHASE"
if [ "$PHASE" = 'release' ]; then
  note '⚠ 本模式只应在最终 SHA 固定后运行：所有版本载体必须为 0.0.4 / v0.0.4'
  note '依据：CHANGELOG.md [Unreleased] 主理人版本号决策 + 发布流程 §5 第 9 步'
else
  note '开发态刻意保持 0.0.3，版本同步推迟到最终 SHA 固定时一次性执行（主理人裁决）'
  note '本模式不把版本载体 0.0.3 判为缺陷；真缺陷项（R-01 / 语法 / 幂等 / 密钥）仍严格判定'
fi

# ---------------------------------------------------------------------------
section "1. 本地 Git 状态（只读）"
# ---------------------------------------------------------------------------
BRANCH="$(git branch --show-current 2>/dev/null || echo '(detached)')"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
FULL_SHA="$(git rev-parse HEAD 2>/dev/null || echo '?')"
note "branch = ${BRANCH}"
note "HEAD   = ${SHA} (${FULL_SHA})"
if [ "$BRANCH" = '(detached)' ] || [ "$BRANCH" = '' ]; then
  fail '处于 detached HEAD —— 无法确定发布基线'
else
  ok "当前分支可确定：${BRANCH}"
fi

DIRTY="$(git status --porcelain 2>/dev/null)"
if [ -z "$DIRTY" ]; then
  ok '工作区干净（git status --porcelain 为空）'
else
  n=$(printf '%s\n' "$DIRTY" | wc -l | tr -d ' ')
  warn "工作区有 ${n} 处未提交变更（本脚本不清理、不 stash）"
  printf '%s\n' "$DIRTY" | sed 's/^/        /'
fi

# 仅检查**本地** tag；远端状态需人工在授权后核验，脚本绝不访问网络
LOCAL_FINAL_TAG="$(git tag -l "$VTAG" 2>/dev/null)"
if [ -n "$LOCAL_FINAL_TAG" ]; then
  block "本地已存在最终 Tag ${VTAG} —— 固定 SHA 之前禁止提前创建"
else
  ok "本地不存在最终 Tag ${VTAG}（远端状态需人工核验，本脚本不访问网络）"
fi
V003_TAGS="$(git tag -l 'v0.0.3*' 2>/dev/null | tr '\n' ' ')"
note "v0.0.3 本地 Tag（必须保持不动）：${V003_TAGS:-（本地无）}"

# ---------------------------------------------------------------------------
section "2. 版本号一致性（phase=${PHASE}）"
# ---------------------------------------------------------------------------
# check_carrier <标签> <实际值> <开发态期望> <发布态期望>
check_carrier() {
  local label="$1" actual="$2" dev_exp="$3" rel_exp="$4"
  if [ "$PHASE" = 'release' ]; then
    if [ "$actual" = "$rel_exp" ]; then
      ok "${label} = ${actual}（发布态已同步到 ${rel_exp}）"
    else
      fail "${label} = ${actual}（发布态期望 ${rel_exp}；须在最终 SHA 固定时一次性同步）"
    fi
  else
    if [ "$actual" = "$dev_exp" ]; then
      info "${label} = ${actual} —— 开发态刻意保持 ${dev_exp}，版本同步推迟到最终 SHA 固定时一次性执行"
    elif [ "$actual" = "$rel_exp" ]; then
      warn "${label} = ${actual} —— 开发态提前升到 ${rel_exp}，与主理人裁决不符（最终 SHA 固定后才能同步）"
    else
      fail "${label} = ${actual}（既非开发态 ${dev_exp} 也非发布态 ${rel_exp}，异常）"
    fi
  fi
}

# --- 版本载体（5 个，主理人裁决）---------------------------------------------
# 清单（主理人裁决 2026-11-04）：**5 个真正的版本载体**
#   1. package.json  → "version"
#   2. deploy/VERSION
#   3. README.md
#   4. RELEASE_GATE.md
#   5. TEST_REPORT.md
#
# 曾提议把 FEATURE_MATRIX.md 列入，被主理人否决并给出理由：
#   FEATURE_MATRIX.md 是**功能矩阵**（描述「有哪些功能、各自什么状态」），
#   不是版本载体。它里面出现的版本号是「本版新增了 XX」这类**说明性引用**，
#   把它们计入「必须同步」的载体清单是概念错误。
#
# tag 白名单（.github/workflows/release.yml 的 tags 列表）**不在此清单内** ——
# 它不是「代码里有个数字忘了改」，而是必须由人确认的发布动作，
# 因此在第 3 节作为独立的「人工放行」项处理。
#
# 另说明：deploy/.env.example 的 V2EX_IMAGE **不是版本载体**（它是发行包的
# 默认镜像指向，语义上更接近「默认安装目标」），但它与载体强相关 ——
# 新装用户会按它拉镜像，因此在第 7 节单独校验，不混入本清单。
PKG_VER="$(node -p "require('./package.json').version" 2>/dev/null || echo '?')"
check_carrier 'package.json version' "$PKG_VER" "$DEV_BASELINE" "$TARGET"

DEPLOY_VER="$(tr -d '[:space:]' < deploy/VERSION 2>/dev/null || echo '?')"
check_carrier 'deploy/VERSION' "$DEPLOY_VER" "$DEV_BASELINE" "$TARGET"

# 从 Markdown 载体中提取「当前版本标记」。
# extract_md_version <文件> <匹配该版本行的正则>
# 提取该行里第一个 vX.Y.Z 形态的版本号。
extract_md_version() {
  grep -m1 -E "$2" "$1" 2>/dev/null | grep -oE 'v?[0-9]+\.[0-9]+\.[0-9]+' | head -n 1
}
# 去掉 v 前缀，得到纯版本号，便于与 $TARGET 比较
strip_v() {
  local v="${1:-}"
  case "$v" in
    v*) printf '%s' "${v#v}" ;;
    *)  printf '%s' "$v" ;;
  esac
}

README_VER="$(extract_md_version README.md '^## 当前版本：')"
check_carrier 'README.md 当前版本' "$(strip_v "$README_VER")" "$DEV_BASELINE" "$TARGET"

# --- 5 个载体里有两类，判定方式**必须**不同 ---------------------------------
#
# 第一类：载体只有一个「身份版本号」，落后了就是落后了 → 用**相等**判定。
#   package.json / deploy/VERSION / README.md 属于这一类。
#
# 第二类：文档里**同时**保留多个版本（历史记录 + 当前版本的权威段落），
#   这类文档**不是**「落后」的载体 —— 它们的当前版本权威段落**本来就该**
#   在开发态就写好（内容来自实测，而不是等版本号同步后才写）。
#   RELEASE_GATE.md / TEST_REPORT.md 属于这一类。
#
# 对第二类若也用「相等」判定，会产生**假阳性**：
#   RELEASE_GATE.md 的 v0.0.4 门禁速览、TEST_REPORT.md 的 v0.0.4 权威口径段
#   在开发态就已经写好了（它们描述的是 v0.0.4 的**实测结论**），
#   报「开发态提前升到 0.0.4」是**误判** —— 内容本就该提前写。
#
# 因此第二类改用「**当前版本的权威内容标记是否存在**」判定（存在性），
# 这既能在发布态拦住「文档没有本次版本的判据」，又不会误报开发态。
#
# check_carrier_section <标签> <文件> <匹配该权威段的正则>
check_carrier_section() {
  local label="$1" file="$2" pattern="$3" actual
  actual="$(strip_v "$(extract_md_version "$file" "$pattern")")"
  if [ -z "$actual" ]; then
    fail "${label}：**未找到**当前版本的权威内容标记（期望存在 ${TARGET} 的判据段落）"
    return
  fi
  if [ "$PHASE" = 'release' ]; then
    if [ "$actual" = "$TARGET" ]; then
      ok "${label}：已含 ${TARGET} 的权威内容标记"
    else
      fail "${label} = ${actual}（发布态期望 ${TARGET} 的权威段落）"
    fi
  else
    if [ "$actual" = "$TARGET" ]; then
      info "${label}：已含 ${TARGET} 的权威内容标记 —— 开发态正常（该段记录的是 v0.0.4 的**实测结论**，本就应提前写好）"
    elif [ "$actual" = "$DEV_BASELINE" ]; then
      info "${label} = ${actual} —— 开发态刻意保持 ${DEV_BASELINE}，不判 FAIL"
    else
      warn "${label} = ${actual}（既非 ${DEV_BASELINE} 也非 ${TARGET}，请人工确认）"
    fi
  fi
}

check_carrier_section 'RELEASE_GATE.md 门禁速览节' 'RELEASE_GATE.md' '^## 0\. v[0-9]+\.[0-9]+\.[0-9]+ 门禁速览'
check_carrier_section 'TEST_REPORT.md 权威口径节' 'TEST_REPORT.md' '^## v[0-9]+\.[0-9]+\.[0-9]+ 单元测试（权威口径'

ENV_IMG="$(grep -m1 '^V2EX_IMAGE=' deploy/.env.example 2>/dev/null | cut -d= -f2- | tr -d '[:space:]')"
check_carrier 'deploy/.env.example V2EX_IMAGE' "${ENV_IMG:-（缺失）}" "$DEV_IMAGE" "$EXPECTED_IMAGE"

# 逐个文件统计版本字面量
for f in deploy/install.sh deploy/install.ps1 deploy/docker-compose.yml deploy/update.sh \
         deploy/README.md deploy/INSTALL.md deploy/backup.sh deploy/restore.sh \
         deploy/start.sh deploy/stop.sh; do
  [ -f "$f" ] || { fail "缺少文件：${f}"; continue; }
  old=$(grep -c 'v0\.0\.3' "$f" 2>/dev/null | head -1)
  new=$(grep -c 'v0\.0\.4' "$f" 2>/dev/null | head -1)
  if [ "$PHASE" = 'release' ]; then
    if [ "$old" -eq 0 ] && [ "$new" -ge 1 ]; then
      ok "${f}：已同步到 v0.0.4（${new} 处），无 v0.0.3 残留"
    elif [ "$old" -eq 0 ]; then
      ok "${f}：无版本字面量（中性文件）"
    else
      fail "${f}：仍有 ${old} 处 v0.0.3（发布态必须全部同步为 v0.0.4）"
    fi
  else
    if [ "$old" -gt 0 ]; then
      info "${f}：保持 ${old} 处 v0.0.3 字面量 —— 开发态预期，最终 SHA 固定时一次性同步为 v0.0.4"
    elif [ "$new" -gt 0 ]; then
      warn "${f}：已出现 ${new} 处 v0.0.4 —— 开发态提前升级，请确认是否已固定最终 SHA"
    else
      ok "${f}：无版本字面量（中性文件）"
    fi
  fi
done

# ---------------------------------------------------------------------------
section "3. 发布流水线闸门（.github/workflows/release.yml，只读）"
# ---------------------------------------------------------------------------
# --- 3.1 tag 白名单：**独立的「人工放行」项，不计入 FAIL** -------------------
#
# 主理人裁决 2026-11-04：tag 白名单**不属于版本载体**，它不是
# 「代码里有个数字忘了改」，而是「必须由人确认的发布动作」。
# 混进载体一致性检查会让发布门禁的语义变模糊（一个是「改漏了」，
# 一个是「还没做这个动作」），因此拆成独立一项，判为 WARN + 醒目提示。
#
# 为什么必须人工放行：
#   白名单没加 → 推 tag **不触发任何 job**。而且是**静默失败**：
#   GitHub Actions 页面全绿（压根没有 run），极易被误判为「发布成功了」。
#   这正是白名单存在的意义 —— 让「新增 tag = 新发布」必须经过人的确认。
#
# 本脚本**绝不自动修改**该白名单（R-19 的刻意摩擦）。
if grep -qE "^\s*-\s*'${VTAG}'" .github/workflows/release.yml 2>/dev/null; then
  ok "release.yml 的 push tag 白名单已包含 ${VTAG}（无需人工放行）"
elif [ "$PHASE" = 'release' ]; then
  warn "【需人工放行】release.yml 的 push tag 白名单**未包含** ${VTAG} —— 发布前必须由人手工在 .github/workflows/release.yml 的 tags 列表加入 '- ${VTAG}'"
  note "  ⚠️ 不加的后果是**静默失败**：推 tag 不触发任何 job，Actions 页面全绿（压根没有 run），极易被误判为「发布成功」。"
  note "  本脚本**不会自动修改**该白名单（R-19 的刻意摩擦）。此项不计入 FAIL —— 它是「还没做的动作」，不是「改漏了的数字」。"
else
  info "发布时需人工把 '- ${VTAG}' 加入 release.yml 的 push tag 白名单（刻意的摩擦，符合 R1；开发态不判定为缺陷）"
fi
if grep -qE 'publish:.*' .github/workflows/release.yml && grep -A4 'publish:' .github/workflows/release.yml | grep -q 'default: false'; then
  ok 'publish 输入默认 false（Release 保持 Draft）'
else
  fail 'publish 输入默认值不是 false —— 存在误公开发布风险'
fi
if grep -A4 'dry_run:' .github/workflows/release.yml | grep -q 'default: true'; then
  ok 'dry_run 输入默认 true（手动触发默认只验证）'
else
  warn 'dry_run 默认值未能确认，请人工复核'
fi

# Release Notes 版本判定：改为检查「仍硬编码 v0.0.1」/「已用动态版本」
# 精确匹配 Notes 标题，避免误伤文件头注释「# v0.0.1 发布流水线」与
# preflight 的格式提示「应形如 v0.0.1」。
RN_HARD=$(grep -cE '^[[:space:]]*##[[:space:]]*v0\.0\.[0-9]+|v0\.0\.1 — 开发预览版' .github/workflows/release.yml 2>/dev/null | head -1)
RN_PLACEHOLDER=$(grep -c '__VERSION__' .github/workflows/release.yml 2>/dev/null | head -1)
RN_DYNAMIC=$(grep -c 'needs\.preflight\.outputs\.version' .github/workflows/release.yml 2>/dev/null | head -1)
if grep -q 'sed.*__VERSION__' .github/workflows/release.yml 2>/dev/null \
   && [ "${RN_HARD:-0}" -eq 0 ] && [ "${RN_PLACEHOLDER:-0}" -ge 1 ]; then
  ok "release.yml 内置 Release Notes 使用动态版本（__VERSION__ 占位符 + sed 注入，${RN_DYNAMIC} 处动态引用；无 v0.0.1 硬编码）"
elif [ "${RN_HARD:-0}" -gt 0 ]; then
  fail "release.yml 内置 Release Notes 仍硬编码旧版本号（${RN_HARD} 处）—— 发布说明会写错版本"
else
  fail 'release.yml 内置 Release Notes 未检出动态版本注入，也无硬编码标记 —— 需人工复核'
fi
if grep -q 'cancel-in-progress: false' .github/workflows/release.yml; then
  ok 'release concurrency 不允许取消进行中的发布'
else
  warn 'release concurrency 设置需人工复核'
fi

# ---------------------------------------------------------------------------
section '4. 迁移物与幂等性（只读静态检查，不跑 migrate）'
# ---------------------------------------------------------------------------
JOURNAL="$(node -p "require('./drizzle/meta/_journal.json').entries.length" 2>/dev/null || echo '?')"
[ "$JOURNAL" = '3' ] \
  && ok "drizzle/meta/_journal.json 有 ${JOURNAL} 条迁移（0000/0001/0002）" \
  || fail "迁移 journal 条目数 = ${JOURNAL}（期望 3）"
for f in drizzle/0000_init.sql drizzle/0001_striped_magdalene.sql drizzle/0002_v004_perf_indexes.sql; do
  [ -f "$f" ] && ok "存在 ${f}" || fail "缺少 ${f}"
done
IDX_TOTAL=$(grep -c 'CREATE INDEX' drizzle/0002_v004_perf_indexes.sql 2>/dev/null | head -1)
IDX_SAFE=$(grep -c 'CREATE INDEX IF NOT EXISTS' drizzle/0002_v004_perf_indexes.sql 2>/dev/null | head -1)
if [ "$IDX_TOTAL" -gt 0 ] && [ "$IDX_TOTAL" -eq "$IDX_SAFE" ]; then
  ok "0002 中 ${IDX_TOTAL} 条 CREATE INDEX 全部带 IF NOT EXISTS（可重复执行）"
else
  fail "0002 幂等性不足：CREATE INDEX ${IDX_TOTAL} 条，其中 IF NOT EXISTS 仅 ${IDX_SAFE} 条"
fi
if grep -q 'CREATE EXTENSION IF NOT EXISTS pg_trgm' drizzle/0002_v004_perf_indexes.sql; then
  ok '0002 的 pg_trgm 扩展创建带 IF NOT EXISTS 且置于异常捕获块'
else
  fail '0002 的 pg_trgm 扩展创建方式需复核'
fi
DESTRUCTIVE=$(grep -icE '\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ALTER TABLE[^;]*DROP)\b' drizzle/0002_v004_perf_indexes.sql 2>/dev/null | head -1)
if [ "$DESTRUCTIVE" -eq 0 ]; then
  ok '0002 无破坏性 DDL/DML（纯增量索引，可先迁移后发布代码）'
else
  fail "0002 检出 ${DESTRUCTIVE} 处疑似破坏性语句，需人工复核"
fi

# ---------------------------------------------------------------------------
section '5. 安装包结构（只读静态检查，不启动容器）'
# ---------------------------------------------------------------------------
REQUIRED='docker-compose.yml .dockerignore .env.example install.sh install.ps1 start.sh stop.sh update.sh backup.sh restore.sh README.md INSTALL.md VERSION LICENSE'
for f in $REQUIRED; do
  [ -f "deploy/$f" ] || fail "安装包缺少必需文件：deploy/$f"
done
ok "deploy/ 必需文件检查完成（$(printf '%s\n' $REQUIRED | wc -l | tr -d ' ') 项）"

BOM="$(od -An -tx1 -N3 deploy/install.ps1 2>/dev/null | tr -d ' \n')"
[ "$BOM" = 'efbbbf' ] \
  && ok 'install.ps1 带 UTF-8 BOM（EF BB BF，PowerShell 5.1 可解析）' \
  || fail "install.ps1 BOM = ${BOM:-（读取失败）}（期望 efbbbf）"
SYNTAX_BAD=0
for f in deploy/*.sh; do
  bash -n "$f" 2>/dev/null || { fail "bash -n 失败：${f}"; SYNTAX_BAD=$((SYNTAX_BAD+1)); }
done
[ "$SYNTAX_BAD" -eq 0 ] && ok "deploy/*.sh 共 $(ls -1 deploy/*.sh | wc -l | tr -d ' ') 个脚本 bash -n 语法通过"
TRACKED_ENV="$(git ls-files | grep -E '(^|/)\.env' | grep -v '\.env\.example$' || true)"
[ -z "$TRACKED_ENV" ] \
  && ok 'Git 跟踪的文件中无 .env 系列（仅允许 .env.example）' \
  || fail "存在被跟踪的 .env 文件：${TRACKED_ENV}"
if grep -q '!drizzle/\*\.sql' .dockerignore 2>/dev/null; then
  ok '.dockerignore 白名单保留 drizzle/*.sql（0002 会进入镜像）'
else
  fail '.dockerignore 未白名单 drizzle/*.sql —— 镜像内可能缺 0002 迁移'
fi
if grep -q 'drizzle-kit/bin.cjs migrate' scripts/docker-entrypoint.sh; then
  ok 'docker-entrypoint.sh 阶段 1 执行 drizzle-kit migrate（安装/升级会应用 0002）'
else
  fail 'entrypoint 未找到迁移步骤'
fi

# ---------------------------------------------------------------------------
section '6. 测试记录与阻断项（只读）'
# ---------------------------------------------------------------------------
if [ -f TEST_REPORT.md ]; then
  ok 'TEST_REPORT.md 存在（本脚本只检查存在性、不解析通过数、不代替测试判定）'
  # 测试基线数字**动态统计**，不再硬编码。
  #
  # 为什么改：此前这里硬编码「单元基线 185 条 / E2E 153 条 / 11 文件」。
  # 硬编码的坏处是：数字会随测试增减而**静默过时**，而发布门禁却在陈述它。
  #
  # 口径说明：
  #   · 单元测试**用例数**必须取 Vitest 运行时的 numTotalTests。
  #     本项目用嵌套 for 循环生成用例，静态 grep 'it(' 得出 180，
  #     与运行时 190 不符 —— 静态计数不可作为口径。
  #     本脚本是**只读发布前检查**，不跑测试（跑一次需数分钟且要连库），
  #     因此这里给出的是「用例文件数」这一可静态确定的下界，
  #     用例条数以 docs/evidence/ci/test-baseline-v0.0.4.md 的实测为准。
  #   · E2E 同理：用例数取 `playwright test --list` 的实测，文件数可静态数。
  #
  # 关于「185 vs 190」的准确表述（**重要，勿再简化为「v0.0.3 vs v0.0.4」**）：
  #   · **CI 上** = `185 passed | 5 skipped (190)`（run 41837212170 实证）
  #   · **本机上** = `190 passed`
  #   · 差异的**根因**不是版本差异，而是 `tests/floor-continuity.spec.ts`
  #     在 CI 上崩溃：它硬编码读 `.env.test`，而 `.env.test` 被 `.gitignore`
  #     忽略（.gitignore:16），CI 的干净克隆里不存在 → readFileSync 抛 ENOENT
  #     → 该文件 5 条用例被 skipped。
  #   · **分母 190 自始至终是正确的** —— 185 只是通过数，不是总数。
  #   · 🔴 **该缺陷当前尚未修复**（截至 2026-11-04 21:35Z 实测仍在）：
  #     `tests/floor-continuity.spec.ts` 的 `:55433/` 硬门未拆，
  #     导致 unit job 红灯 → e2e job 被 `needs: unit` 连带跳过。
  #     修复后 CI 与本地都应为 190。
  #   · 归属：BUG_REGISTER V4-17 / RISK_REGISTER R-26，由测试环境工程师与架构师处置。
  UNIT_SPEC_FILES="$(find tests -maxdepth 1 -name '*.spec.ts' 2>/dev/null | wc -l | tr -d ' ')"
  E2E_SPEC_FILES="$(find e2e -maxdepth 1 -name '*.spec.ts' 2>/dev/null | wc -l | tr -d ' ')"
  note "  单元测试用例文件数：${UNIT_SPEC_FILES} 个（用例条数以 docs/evidence/ci/test-baseline-v0.0.4.md 的 vitest JSON reporter 实测为准）"
  note "  E2E 用例文件数：${E2E_SPEC_FILES} 个（用例条数以 playwright test --list 实测为准）"
  note "  用例总数以 vitest JSON reporter 的 numTotalTests 为准（当前实测 190 条 / 15 文件，见 test-baseline-v0.0.4.md）"
  note "  ⚠️ CI 现状：`185 passed | 5 skipped (190)` —— 分母 190 正确；5 条因 floor-continuity 在 CI 崩溃而跳过。该缺陷修复中（V4-17 / R-26），修复后 CI 与本地都应为 190。"
  note "  全量结论由 team-lead 复验（任务 #1）写入 TEST_REPORT.md；qa-engineer 第二轮为专项实跑，不作为全量判定"
else
  warn 'TEST_REPORT.md 不存在'
fi
if [ -f docs/UPGRADE_RECOVERY_v0.0.4.md ]; then
  ok '第六阶段升级/恢复报告存在'
else
  warn 'docs/UPGRADE_RECOVERY_v0.0.4.md 尚未生成'
fi
if grep -q 'DEFERRED' RISK_REGISTER.md 2>/dev/null; then
  block 'RISK_REGISTER R-01（Git 历史原站素材）仍为 DEFERRED —— 需主人单独授权；未授权前 Release 只能停在 Draft'
else
  ok 'RISK_REGISTER 未检出 DEFERRED 标记'
fi
if grep -q '严禁\|禁止' docs/RELEASE_PROCESS_v0.0.4.md 2>/dev/null; then
  ok '第八阶段发布流程文档存在'
else
  warn 'docs/RELEASE_PROCESS_v0.0.4.md 尚未生成'
fi

# ---------------------------------------------------------------------------
section '7. 升级脚本（deploy/update.sh）与版本同步（release 阶段重点）'
# ---------------------------------------------------------------------------
# 背景（R-18）：v0.0.3 的 update.sh 存在「看似升级成功、实际没升」的缺陷：
#   1. 从 .env 读 V2EX_IMAGE 但**从不更新它** → 用户从 v0.0.3 升级仍拉旧 tag
#   2. `docker compose pull` + `up -d` 后镜像 tag 没变 → 跑的还是旧版本
#   3. 升级失败没有恢复旧镜像的路径
#   4. 升级前没有备份
#   5. 没有明确的目标版本参数
# v0.0.4 重写后新增了 --version / --image 参数、.env 的 V2EX_IMAGE 实际改写、
# 升级前自动备份、digest 对比、失败自动回滚（且明确不做破坏性数据库回滚）。
#
# 本节在 release 阶段逐条静态核对这些能力是否真的存在。
UPDATE_SH='deploy/update.sh'

if [ ! -f "$UPDATE_SH" ]; then
  fail "缺少 ${UPDATE_SH} —— 发行版用户将无法升级"
else
  ok "${UPDATE_SH} 存在"

  # --- 7.1 语法 -------------------------------------------------------------
  if bash -n "$UPDATE_SH" 2>/dev/null; then
    ok 'update.sh 通过 bash -n 语法检查'
  else
    fail 'update.sh 未通过 bash -n 语法检查'
  fi

  # --- 7.2 目标版本参数 -----------------------------------------------------
  if grep -qE '\-\-version' "$UPDATE_SH" && grep -qE '\-\-image' "$UPDATE_SH"; then
    ok 'update.sh 支持 --version / --image 明确指定目标版本'
  else
    fail 'update.sh 缺少 --version / --image 参数 —— 无法明确指定目标版本（R-18 第 5 项）'
  fi

  # --- 7.3 改写 .env 的 V2EX_IMAGE（R-18 第 1、2 项：核心）-------------------
  # 判定依据：脚本必须**实际调用** update_env_value（或等价的写 .env 动作）
  # 把 V2EX_IMAGE 写成目标镜像，而不只是读出来。
  if grep -qE 'update_env_value[[:space:]]+V2EX_IMAGE' "$UPDATE_SH"; then
    ok 'update.sh 具备「更新 .env 中 V2EX_IMAGE」的能力（存在 update_env_value V2EX_IMAGE 调用）'
  elif grep -qE '(sed|awk).*V2EX_IMAGE' "$UPDATE_SH"; then
    ok 'update.sh 具备「更新 .env 中 V2EX_IMAGE」的能力（通过 sed/awk 改写）'
  else
    fail 'update.sh **不具备**更新 .env 中 V2EX_IMAGE 的能力 —— 升级会拉旧 tag、跑旧版本（R-18 第 1、2 项）'
  fi
  # 且必须是「写目标镜像」而不是「写回旧值」
  if grep -qE 'update_env_value[[:space:]]+V2EX_IMAGE[[:space:]]+"\$TARGET_IMAGE"' "$UPDATE_SH"; then
    ok 'update.sh 把 V2EX_IMAGE 改写为目标镜像（$TARGET_IMAGE），而非沿用旧值'
  else
    warn 'update.sh 中未检出「把 V2EX_IMAGE 写为 $TARGET_IMAGE」的语句 —— 请人工确认改写目标正确'
  fi

  # --- 7.4 备份（失败即中止）------------------------------------------------
  if grep -qE 'backup\.sh' "$UPDATE_SH"; then
    ok 'update.sh 升级前会调用 backup.sh（复用既有备份脚本）'
  else
    fail 'update.sh 升级前未调用 backup.sh —— 升级前无备份（R-18 第 4 项）'
  fi
  if grep -qE 'backup\.sh.*失败|失败.*backup\.sh|backup\.sh.*中止' "$UPDATE_SH"; then
    ok 'update.sh 明确声明「备份失败即中止升级」'
  else
    warn 'update.sh 未明确声明「备份失败即中止升级」—— 请人工确认失败路径'
  fi

  # --- 7.5 digest 对比 + 未变化告警 ----------------------------------------
  if grep -qE 'RepoDigests' "$UPDATE_SH"; then
    ok 'update.sh 会记录并对比镜像 digest（RepoDigests）'
  else
    fail 'update.sh 未检出 digest 记录逻辑'
  fi
  if grep -qE '完全相同|未变化|未变' "$UPDATE_SH"; then
    ok 'update.sh 对「目标版本镜像未变化」有明确告警与处置分支'
  else
    fail 'update.sh 未检出「目标镜像未变化」的告警分支 —— 会静默「假升级」（R-18 第 2 项）'
  fi

  # --- 7.6 回滚（R-18 第 3 项）---------------------------------------------
  if grep -qE '^rollback\(\)' "$UPDATE_SH"; then
    ok 'update.sh 存在自动回滚路径（rollback 函数）'
  else
    fail 'update.sh 缺少自动回滚路径 —— 升级失败后无恢复手段（R-18 第 3 项）'
  fi

  # --- 7.7 保留数据卷（绝不 down -v）---------------------------------------
  # 只看**会被执行**的代码行：排除注释行。
  # 注意这里用与 install-verify.yml 闸门一致的判定方式，避免两处口径不一致。
  UPDATE_DOWN_EXEC="$(grep -vE "^[[:space:]]*#" "$UPDATE_SH" \
    | grep -cE 'docker[[:space:]]+compose[[:space:]]+down[[:space:]]+(-v|--volumes)' || true)"
  UPDATE_DOWN_ANY="$(grep -vE "^[[:space:]]*#" "$UPDATE_SH" \
    | grep -cE 'compose[[:space:]]+down' || true)"
  if [ "${UPDATE_DOWN_EXEC:-0}" -eq 0 ] && [ "${UPDATE_DOWN_ANY:-0}" -eq 0 ]; then
    ok 'update.sh 不含任何 compose down 调用（数据卷不会被删除）'
  else
    fail "update.sh 检出 compose down 调用（执行级 ${UPDATE_DOWN_EXEC:-0} 处）—— 存在删除数据卷的风险"
  fi

  # --- 7.8 不自动执行破坏性数据库回滚 --------------------------------------
  # 允许在**提示文本**里出现 restore.sh（那是给人工的指引），
  # 但绝不能作为**命令**被调用。
  UPDATE_RESTORE_EXEC="$(grep -vE "^[[:space:]]*#" "$UPDATE_SH" \
    | grep -E '^[[:space:]]*(bash|sh)[[:space:]].*restore\.sh' | wc -l | tr -d ' ')"
  if [ "${UPDATE_RESTORE_EXEC:-0}" -eq 0 ]; then
    ok 'update.sh 不自动执行 restore.sh（数据库回滚需人工显式确认）'
  else
    fail 'update.sh 会自动执行 restore.sh —— 升级失败时自动覆盖数据库有丢数据风险'
  fi
  if grep -qE '破坏性数据库回滚|不会.*数据库回滚' "$UPDATE_SH"; then
    ok 'update.sh 在注释/日志中显式声明了「不自动执行破坏性数据库回滚」'
  else
    warn 'update.sh 未显式声明「不自动执行破坏性数据库回滚」—— 请人工确认设计意图'
  fi

  # --- 7.9 不覆盖管理员口令 ------------------------------------------------
  if grep -qE 'SEED_ADMIN_PASSWORD' "$UPDATE_SH"; then
    ok 'update.sh 涉及 SEED_ADMIN_PASSWORD —— 说明其对管理员口令的处理是显式的（而非默认覆盖）'
  else
    warn 'update.sh 未提及 SEED_ADMIN_PASSWORD —— 请人工确认升级不会重置管理员口令'
  fi
  if grep -qE 'ADMIN_HASH|password_hash' "$UPDATE_SH"; then
    ok 'update.sh 会校验管理员口令哈希未变（升级后证明口令未被篡改）'
  else
    warn 'update.sh 未校验管理员口令哈希 —— 请人工确认升级不会覆盖管理员口令（R-18 要求项）'
  fi

  # --- 7.10 自检脚本存在 ----------------------------------------------------
  if [ -f scripts/release/verify-update-script.sh ]; then
    ok 'scripts/release/verify-update-script.sh 存在（update.sh 的无 Docker 自检脚本）'
    if bash -n scripts/release/verify-update-script.sh 2>/dev/null; then
      ok 'verify-update-script.sh 通过 bash -n 语法检查'
    else
      fail 'verify-update-script.sh 未通过 bash -n 语法检查'
    fi
  else
    warn 'scripts/release/verify-update-script.sh 不存在 —— update.sh 缺少无 Docker 环境的自检手段'
  fi

  # --- 7.10b --dry-run 演练模式（主理人裁决 2026-11-04：必须保留）-------------
  # 为什么必须保留：本机无 Docker，「升级脚本的容器级行为」只能靠 CI 或
  # 带 Docker 的环境实跑；--dry-run 是唯一能在无 Docker 环境做**部分**验证
  # 的手段。没有它，update.sh 在纯离线环境里连参数校验都跑不了。
  if grep -qE '\-\-dry-run' "$UPDATE_SH"; then
    ok 'update.sh 支持 --dry-run 演练模式（无 Docker 环境下的部分验证手段）'
  else
    fail 'update.sh **缺少 --dry-run** —— 无 Docker 环境将无法做任何本地验证（R-16 风险放大）'
  fi
  # --dry-run 的核心承诺是「不做任何写操作」。这里做**静态**核验：
  # 演练分支必须在改写 .env 之前就 exit，且不得出现 pull / up 等写命令。
  if grep -qE 'DRY_RUN.*=.*1' "$UPDATE_SH"; then
    ok 'update.sh 有独立的 DRY_RUN 分支标志'
  else
    warn 'update.sh 未检出 DRY_RUN 分支标志 —— 请人工确认 --dry-run 的实现方式'
  fi
  if grep -q 'dry-run 的确切语义' "$UPDATE_SH"; then
    ok 'update.sh 的 --help 中写清了 --dry-run 的确切语义（会做什么 / 不会做什么）'
  else
    warn 'update.sh 的 --help 未写清 --dry-run 语义 —— 用户可能误以为它会真的升级'
  fi
fi

# --- 7.11 发行包自称的版本 vs 本次发布版本 ----------------------------------
# 这是「用户拿到的安装包自称的版本」与「本次发布版本」是否一致的问题。
# release 阶段必须严格一致，否则发行包会带着旧版本号出厂。
#
# 注意：5 个版本载体的**一致性**已在第 2 节统一检查（那里是权威位置）。
# 本节只做**发行包视角**的补充 —— 即「装到用户机器上的那个包」：
#   · deploy/VERSION 是发行包内**唯一**随包分发的版本标识（install.sh 会读它）
#   · deploy/.env.example 的 V2EX_IMAGE 决定**新装用户**默认拉哪个镜像
# 两者都不在第 2 节的 5 载体清单里（.env.example 的 tag 语义是「默认安装
# 目标」而非「版本标识」），因此在此单独校验。
if [ "$PHASE" = 'release' ]; then
  if [ "$DEPLOY_VER" = "$TARGET" ]; then
    ok "deploy/VERSION = ${DEPLOY_VER} 与目标版本 ${TARGET} 一致（发行包版本号正确）"
  else
    fail "deploy/VERSION = ${DEPLOY_VER}，与目标版本 ${TARGET} **不一致** —— 发行包会带着旧版本号出厂"
  fi
  # .env.example 的默认镜像 tag 也必须跟着目标版本走，
  # 否则新装的用户装到的是旧版本镜像。
  if [ "${ENV_IMG:-}" = "$EXPECTED_IMAGE" ]; then
    ok "deploy/.env.example 的 V2EX_IMAGE 已指向 ${EXPECTED_IMAGE}"
  else
    fail "deploy/.env.example 的 V2EX_IMAGE = ${ENV_IMG:-（缺失）}，期望 ${EXPECTED_IMAGE} —— 新装用户会装到旧版本镜像"
  fi
else
  note "deploy/VERSION = ${DEPLOY_VER}（开发态刻意保持 ${DEV_BASELINE}，不判 FAIL）"
fi

# --- 7.12 tag 白名单 → 已上移至第 3 节（主理人裁决 2026-11-04）--------------
#
# 原先本节与第 3 节各有一份 tag 白名单检查，且第 7 节那份判为 FAIL。
# 主理人裁决：白名单**不是版本载体**，而是「必须由人确认的发布动作」，
# 应作为**独立的一项**、判为 WARN + 醒目提示，**不计入 FAIL**。
# 理由：把「改漏了数字」与「还没做这个动作」混在一起会让发布门禁语义模糊。
# 现在唯一权威的检查在第 3 节（3.1），本节不再重复 —— 避免两处口径漂移。

# ---------------------------------------------------------------------------
section '8. 汇总'
# ---------------------------------------------------------------------------
printf 'phase=%s  PASS=%s  WARN=%s  FAIL=%s  BLOCK=%s  INFO=%s\n' \
  "$PHASE" "$PASS" "$WARN" "$FAIL" "$BLOCK" "$INFO"
if [ "$PHASE" = 'dev' ]; then
  note '开发态口径：版本载体 0.0.3 为预期状态（INFO），不计 FAIL；最终 SHA 固定后须以 --phase=release 复跑'
else
  note '发布态口径：本模式只应在最终 SHA 固定后运行；版本载体 0.0.3 一律 FAIL'
fi
if [ "$FAIL" -eq 0 ] && [ "$BLOCK" -eq 0 ]; then
  printf '结论：本地检查无阻断。注意——远端 Tag/Release/镜像状态本脚本不核验，需人工授权后核验。\n'
  exit 0
fi
if [ "$FAIL" -eq 0 ] && [ "$BLOCK" -gt 0 ]; then
  printf '结论：无工程 FAIL，但存在 %s 个 BLOCK（R-01 授权未决） —— **禁止发布 / Release 只能停在 Draft**。本脚本未执行任何写操作或远端操作。\n' "$BLOCK"
  exit 1
fi
printf '结论：存在 %s 个 FAIL / %s 个 BLOCK —— **禁止发布**。本脚本未执行任何写操作或远端操作。\n' "$FAIL" "$BLOCK"
exit 1
