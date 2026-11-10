#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# N2 —— 部署包**包内版本一致性**独立校验（v0.0.15）
#
# ## 为什么要抽成独立脚本
#
# N2 判据原本只存在于两处：
#   · `.github/workflows/release.yml` 的「包内版本一致性校验（N2）」step；
#   · `scripts/release/verify-release-consistency.sh` 的内嵌分支（需 --zip）。
#
# 前者只能在真实流水线里跑；后者要求同时校验源码载体，无法单独对
# 「一个刻意做坏的包」做负向测试。
#
# v0.0.15 的发布预演需要**对错误产物断言失败**（任务书 §四「对错误 Artifact
# 执行校验失败测试」），因此把判据抽成这个「只吃一个 zip」的脚本：
#
#   bash scripts/release/verify-deploy-zip-n2.sh <zip> <expect-version>
#
# 判据（与 release.yml 的 N2 逐条对齐，另加两条更强的）：
#   ① 包内 `deploy/VERSION` = 期望版本
#   ② 包内 `.env.example` 的 `V2EX_IMAGE` = `ghcr.io/...:v<期望>`
#   ③ 包内 `docker-compose.yml` 引用 `:v<期望>`
#   ④ 包内 `install.sh` 的 `APP_VERSION="<期望>"`
#   ⑤ 包内 `README.md` / `INSTALL.md` 的**首行**必须含 `v<期望>`
#      （v0.0.10 / v0.0.11 连续两轮栽在这里）
#   ⑥ 包内任何 `# V2EX Clone vX.Y.Z` 头部注释不得指向别的版本
#      （这条 N2 原本没有，但正是它让 start.sh / stop.sh 的旧版本号长期无人发现）
#   ⑦ 全部 `.sh` 在 **ZIP 中央目录**里的 Unix mode 必须是 0o100755
#      （V9-09：权限降级后 `./install.sh` Permission denied；
#        必须读中央目录，不能读解压后的磁盘位 —— Windows 上恒为真 = 假绿）
#
# 退出码：0 = 全部一致／1 = 有任何一项不一致
#
# ⚠️ 本脚本**不修改**任何东西，只读 zip。
# ---------------------------------------------------------------------------
set -uo pipefail

ZIP="${1:-}"
EXPECT="${2:-}"

if [ -z "$ZIP" ] || [ -z "$EXPECT" ]; then
  echo "用法：bash scripts/release/verify-deploy-zip-n2.sh <deploy.zip> <expect-version>" >&2
  echo "  例：bash scripts/release/verify-deploy-zip-n2.sh dist/v2ex-clone-v0.0.15-deploy.zip 0.0.15" >&2
  exit 2
fi
EXPECT="${EXPECT#v}"   # 容忍传入 vX.Y.Z

if [ ! -f "$ZIP" ]; then
  echo "✗ 部署包不存在：$ZIP" >&2
  exit 2
fi

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t n2)"
cleanup() {
  # ⚠️ 本机（Windows Git Bash）在 `CODEBUDDY_SAFE_DELETE_ENABLED=1` 下，
  #    `rm -rf` 遇到含盘符前缀的路径会被拦截（SAFE_DELETE_INVALID_PATH），
  #    于是临时目录残留 —— 但**不影响判定结果**。
  #    这里显式降级为「尽力清理」，且不把清理失败当成校验失败
  #    （校验脚本的退出码只应反映包内容，不应反映清理环境）。
  rm -rf "$TMP" 2>/dev/null || true
}
trap cleanup EXIT

if ! unzip -q "$ZIP" -d "$TMP" 2>/dev/null; then
  echo "✗ 无法解压部署包（ZIP 结构损坏？）：$ZIP" >&2
  exit 1
fi

# 兼容两种打包形状：顶层带 `deploy/` 或直接是 deploy 内容
if [ -d "$TMP/deploy" ]; then
  D="$TMP/deploy"
elif [ -f "$TMP/VERSION" ]; then
  D="$TMP"
else
  echo "✗ 包内找不到 deploy/ 目录，也没有 VERSION 文件 —— 打包形状不对" >&2
  exit 1
fi

FAIL=0
fail() { echo "  ✗ $*"; FAIL=1; }
pass() { echo "  ✓ $*"; }

# ① 包内 VERSION
if [ -f "$D/VERSION" ]; then
  GOT="$(tr -d ' \r\n' < "$D/VERSION")"
  if [ "$GOT" = "$EXPECT" ]; then
    pass "包内 VERSION = $EXPECT"
  else
    fail "包内 VERSION = '$GOT'，应为 '$EXPECT'"
  fi
else
  fail "包内缺少 VERSION 文件"
fi

# ② .env.example 的 V2EX_IMAGE
ENV_IMG="$(sed -n 's/^V2EX_IMAGE=//p' "$D/.env.example" 2>/dev/null | tail -1 | tr -d '\r\n ')"
if [ "$ENV_IMG" = "ghcr.io/alicia1030su/v2ex-clone:v${EXPECT}" ]; then
  pass "包内 .env.example 的 V2EX_IMAGE = :v${EXPECT}"
else
  fail "包内 .env.example 的 V2EX_IMAGE = '${ENV_IMG}'，应为 ':v${EXPECT}'"
fi

# ③ docker-compose.yml 引用
if grep -q ":v${EXPECT}" "$D/docker-compose.yml" 2>/dev/null; then
  pass "包内 compose 引用 :v${EXPECT}"
else
  fail "包内 compose 未引用 :v${EXPECT}"
fi

# ④ install.sh 的 APP_VERSION
if grep -q "APP_VERSION=\"${EXPECT}\"" "$D/install.sh" 2>/dev/null; then
  pass "包内 install.sh 的 APP_VERSION = $EXPECT"
else
  fail "包内 install.sh 的 APP_VERSION 不是 $EXPECT"
fi

# ⑤ README / INSTALL 首行版本
for doc in README.md INSTALL.md; do
  FIRST="$(head -1 "$D/$doc" 2>/dev/null || true)"
  case "$FIRST" in
    *"v${EXPECT}"*) pass "包内 $doc 首行含 v${EXPECT}" ;;
    *) fail "包内 $doc 首行版本不是 v${EXPECT}：'${FIRST}'" ;;
  esac
done

# ⑥ 头部注释不得指向别的版本
STALE_HDR="$(grep -rhoE '^# V2EX Clone v[0-9]+\.[0-9]+\.[0-9]+' "$D" 2>/dev/null | grep -v "v${EXPECT}$" | sort -u | tr '\n' ' ')"
if [ -z "$STALE_HDR" ]; then
  pass "包内无头部注释指向其它版本"
else
  fail "包内有头部注释指向其它版本：${STALE_HDR}"
fi

# ⑦ ZIP 中央目录里的 .sh 权限
MODE_VERDICT="$(python3 - "$ZIP" <<'PY'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
sh = [(i.filename, (i.external_attr >> 16) & 0xFFFF) for i in z.infolist() if i.filename.endswith('.sh')]
if not sh:
    print('EMPTY')
    sys.exit(0)
bad = [(n, m) for n, m in sh if m != 0o100755]
if bad:
    print('BAD:' + ','.join('%s=0o%o' % (n, m) for n, m in bad))
else:
    print('OK:%d' % len(sh))
PY
)"
case "$MODE_VERDICT" in
  OK:*) pass "ZIP 中央目录：${MODE_VERDICT#OK:} 个 .sh 均为 0o100755" ;;
  EMPTY) fail "包内没有任何 .sh —— 打包规则失效" ;;
  BAD:*) fail "脚本权限不对（V9-09 会复发）：${MODE_VERDICT#BAD:}" ;;
  *) fail "ZIP 中央目录解析失败：${MODE_VERDICT:0:120}" ;;
esac

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✓ N2 通过：包内版本一致性满足（期望 $EXPECT）"
  exit 0
fi
echo "✗ N2 未通过 —— 该包**不得**发布"
exit 1
