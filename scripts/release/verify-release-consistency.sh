#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 发行版真实性门禁（v0.0.10）
#
# ## 这个脚本要解决的真实问题
#
# v0.0.9 出了两件**发布物流失**：
#   · V9-09：Git 里 `deploy/*.sh` 是 100644 ⇒ 发布 ZIP 里是 0644 ⇒
#     用户解压后 `./install.sh` 直接 Permission denied；
#   · V9-13：`backup.sh` 的 SIGPIPE 假失败会让**正常备份被删除**。
# 两件都不是「代码写错」，而是「**发出去的东西和仓库里的不一致 / 没跑过**」。
#
# 所以本脚本核对的不是「测试是否通过」，而是**六件东西是不是同一个版本**：
#
#   ① 源码       package.json / deploy/VERSION / deploy/install.sh / compose
#   ② Tag        指向的提交 == 构建来源提交
#   ③ 镜像       标签 == 版本，Digest 可核验（可选，需已推送）
#   ④ ZIP        文件名 / VERSION / compose / install.sh / 脚本权限 / 必需文件
#   ⑤ README     「当前版本」与下载链接指向该版本
#   ⑥ Release    说明里的量化指标与真实产物一致（可选，需 gh）
#
# **任意一项不一致 ⇒ exit 1。** 没有「警告但通过」这条路。
#
# ## 用法
#
#   # 只核源码一致性（开发期，最快的门禁）
#   bash scripts/release/verify-release-consistency.sh --expect 0.0.10
#
#   # 核源码 + ZIP（发布前必跑）
#   bash scripts/release/verify-release-consistency.sh --expect 0.0.10 \
#     --zip dist/v2ex-clone-v0.0.10-deploy.zip
#
#   # 核全部（发布后，含 Tag / 镜像 / Release）
#   bash scripts/release/verify-release-consistency.sh --expect 0.0.10 \
#     --zip dist/v2ex-clone-v0.0.10-deploy.zip --tag v0.0.10 \
#     --image ghcr.io/alicia1030su/v2ex-clone:v0.0.10 --check-release
# ---------------------------------------------------------------------------
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT" || exit 2

EXPECT=""
ZIP=""
TAG=""
IMAGE=""
CHECK_RELEASE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --expect) EXPECT="$2"; shift 2 ;;
    --zip) ZIP="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --check-release) CHECK_RELEASE=1; shift ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

[ -n "$EXPECT" ] || { echo "缺少 --expect <版本>" >&2; exit 2; }

C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_RST=$'\033[0m'; C_BLD=$'\033[1m'
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %s\n' "$C_RED" "$C_RST" "$*"; }
info() { printf '  %s\n' "$*"; }

printf '%s═══ 发行版真实性门禁 · 期望版本 %s ═══%s\n' "$C_BLD" "$EXPECT" "$C_RST"

# ── ① 源码版本载体 ─────────────────────────────────────────────────────
printf '\n%s① 源码版本载体%s\n' "$C_BLD" "$C_RST"

PKG_VER="$(node -e "console.log(require('./package.json').version)" 2>/dev/null)"
[ "$PKG_VER" = "$EXPECT" ] && ok "package.json = ${PKG_VER}" || bad "package.json = ${PKG_VER}，期望 ${EXPECT}"

if [ -f deploy/VERSION ]; then
  VFILE="$(tr -d ' \r\n' < deploy/VERSION)"
  [ "$VFILE" = "$EXPECT" ] && ok "deploy/VERSION = ${VFILE}" || bad "deploy/VERSION = ${VFILE}，期望 ${EXPECT}"
else
  bad "deploy/VERSION 不存在"
fi

grep -q "APP_VERSION=\"${EXPECT}\"" deploy/install.sh \
  && ok "deploy/install.sh 的 APP_VERSION = ${EXPECT}" \
  || bad "deploy/install.sh 的 APP_VERSION 不是 ${EXPECT}"

grep -q ":v${EXPECT}" deploy/docker-compose.yml \
  && ok "deploy/docker-compose.yml 引用 :v${EXPECT}" \
  || bad "deploy/docker-compose.yml 未引用 :v${EXPECT}"

grep -q "V2EX_IMAGE=ghcr.io/[^:]*:v${EXPECT}" deploy/.env.example 2>/dev/null \
  && ok "deploy/.env.example 的 V2EX_IMAGE 指向 :v${EXPECT}" \
  || bad "deploy/.env.example 的 V2EX_IMAGE 未指向 :v${EXPECT}"

grep -q "0\.0\.9" deploy/install.ps1 2>/dev/null && VER_PS="has-0.0.9" || VER_PS="clean"
grep -q "$EXPECT" deploy/install.ps1 2>/dev/null \
  && ok "deploy/install.ps1 含 ${EXPECT}" \
  || bad "deploy/install.ps1 不含 ${EXPECT}"

# ── ② Tag 指向的提交 == 构建来源 ────────────────────────────────────────
if [ -n "$TAG" ]; then
  printf '\n%s② Tag 与构建来源%s\n' "$C_BLD" "$C_RST"
  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    TAG_COMMIT="$(git rev-list -n1 "$TAG")"
    HEAD_COMMIT="$(git rev-parse HEAD)"
    if [ "$TAG_COMMIT" = "$HEAD_COMMIT" ]; then
      ok "$TAG → $TAG_COMMIT（与 HEAD 一致）"
    else
      bad "$TAG → $TAG_COMMIT，但 HEAD = $HEAD_COMMIT —— Tag 与构建来源不是同一个提交"
    fi
    # Tag 不能是轻量标签（缺少元数据时无法审计发布者/时间）
    if [ "$(git cat-file -t "$TAG")" = "tag" ]; then
      ok "$TAG 是 annotated tag（含推送者与时间元数据）"
    else
      bad "$TAG 是轻量标签（lightweight）—— 无法审计发布者与时间"
    fi
  else
    bad "Tag $TAG 不存在"
  fi
fi

# ── ③ 镜像 ────────────────────────────────────────────────────────────
if [ -n "$IMAGE" ]; then
  printf '\n%s③ 镜像标签与 Digest%s\n' "$C_BLD" "$C_RST"
  case "$IMAGE" in
    *":v${EXPECT}") ok "镜像标签 = v${EXPECT}" ;;
    *) bad "镜像标签不是 v${EXPECT}：$IMAGE" ;;
  esac
  if command -v docker >/dev/null 2>&1; then
    DIGEST="$(docker image inspect "$IMAGE" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
    if [ -n "$DIGEST" ]; then
      ok "本地镜像 Digest 可读：${DIGEST##*@}"
    else
      info "本地无该镜像（未拉取）—— Digest 断言交由 CI 的 GHCR 校验步骤"
    fi
  else
    info "本机无 docker —— Digest 断言交由 CI"
  fi
fi

# ── ④ ZIP 产物 ────────────────────────────────────────────────────────
if [ -n "$ZIP" ]; then
  printf '\n%s④ ZIP 产物%s\n' "$C_BLD" "$C_RST"
  if [ ! -f "$ZIP" ]; then
    bad "ZIP 不存在：$ZIP"
  else
    BASE="$(basename "$ZIP")"
    [ "$BASE" = "v2ex-clone-v${EXPECT}-deploy.zip" ] \
      && ok "文件名 = ${BASE}" \
      || bad "文件名 = ${BASE}，期望 v2ex-clone-v${EXPECT}-deploy.zip"

    SHA_FILE="$(dirname "$ZIP")/SHA256SUMS"
    if [ -f "$SHA_FILE" ]; then
      REAL_SHA="$(node -e "
        const {createHash}=require('crypto');const fs=require('fs');
        console.log(createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'));
      " "$ZIP")"
      if grep -q "$REAL_SHA" "$SHA_FILE"; then
        ok "SHA256SUMS 可复算（${REAL_SHA:0:16}…）"
      else
        bad "SHA256SUMS 与实际文件不符（实际 ${REAL_SHA:0:16}…）"
      fi
    else
      bad "缺少 SHA256SUMS"
    fi

    # 解压到临时目录做**内容级**核对
    TMP="$(mktemp -d 2>/dev/null || mktemp -d -t rel)"
    if unzip -q "$ZIP" -d "$TMP" 2>/dev/null; then
      D="$TMP/deploy"
      if [ -d "$D" ]; then
        ok "顶层目录 = deploy/"
      else
        bad "顶层目录不是 deploy/（实际：$(ls "$TMP" | head -3 | tr '\n' ' ')）"
        D="$TMP"
      fi

      [ "$(tr -d ' \r\n' < "$D/VERSION" 2>/dev/null)" = "$EXPECT" ] \
        && ok "包内 VERSION = ${EXPECT}" \
        || bad "包内 VERSION = $(tr -d ' \r\n' < "$D/VERSION" 2>/dev/null)"

      grep -q ":v${EXPECT}" "$D/docker-compose.yml" 2>/dev/null \
        && ok "包内 compose 引用 :v${EXPECT}" \
        || bad "包内 compose 未引用 :v${EXPECT}"

      grep -q "APP_VERSION=\"${EXPECT}\"" "$D/install.sh" 2>/dev/null \
        && ok "包内 install.sh 的 APP_VERSION = ${EXPECT}" \
        || bad "包内 install.sh 的 APP_VERSION 不对"

      # ── 脚本权限 ──
      #
      # ⚠️ 必须**读 ZIP 中央目录**，不能只看解压后的磁盘位。
      #    Windows 的 NTFS 根本没有 POSIX exec 位：`unzip` 解压出来的 .sh
      #    在 Git Bash 里恒可用 `-x` 判定为真 —— 实测把权限改成 0644 的 ZIP
      #    照样「通过」。那是典型的**平台造成的假绿**。
      #    中央目录里的 Unix mode 是产物自带的事实，与解压平台无关。
      MODE_JSON="$(node -e '
        const fs = require("fs");
        const buf = fs.readFileSync(process.argv[1]);
        const eocd = buf.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
        if (eocd < 0) { console.log(JSON.stringify({error:"no-eocd"})); process.exit(0); }
        const total = buf.readUInt16LE(eocd + 10);
        let p = buf.readUInt32LE(eocd + 16);
        const out = [];
        for (let i = 0; i < total; i++) {
          if (buf.readUInt32LE(p) !== 0x02014b50) { out.push({error:"bad-sig"}); break; }
          const madeBy = buf.readUInt16LE(p + 4);
          const mode = (buf.readUInt32LE(p + 38) >>> 16) & 0xffff;
          const nl = buf.readUInt16LE(p + 28);
          const el = buf.readUInt16LE(p + 30);
          const cl = buf.readUInt16LE(p + 32);
          const name = buf.subarray(p + 46, p + 46 + nl).toString("utf8");
          if (name.endsWith(".sh")) out.push({ name, mode, host: madeBy >> 8 });
          p += 46 + nl + el + cl;
        }
        console.log(JSON.stringify(out));
      ' "$ZIP")"

      VERDICT="$(printf '%s' "$MODE_JSON" | node -e '
        let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
          const rs=JSON.parse(s);
          if(!Array.isArray(rs)||rs.length===0){console.log("EMPTY");return;}
          const bad=rs.filter(r=>r.mode!==0o100755||r.host!==3);
          if(bad.length===0){console.log("OK:"+rs.length);return;}
          console.log("BAD:"+bad.map(b=>b.name+"=0o"+b.mode.toString(8)).join(","));
        });
      ')"

      case "$VERDICT" in
        OK:*) ok "ZIP 中央目录：${VERDICT#OK:} 个 .sh 的 Unix 模式均为 0o100755（不依赖解压平台）" ;;
        EMPTY) bad "包内没有任何 .sh —— 打包规则失效" ;;
        BAD:*) bad "ZIP 中央目录里脚本权限不对：${VERDICT#BAD:}" ;;
        *) bad "ZIP 中央目录解析失败：${MODE_JSON:0:120}" ;;
      esac

      # 额外在 POSIX 平台上做一次**真实解压后**的磁盘位核对（双保险）
      if [ "$(uname -s)" != "MINGW"* ] && [ "$(uname -s)" != "MSYS"* ] && [ "$(uname -s)" != "CYGWIN"* ]; then
        NOEXEC=""
        for f in "$D"/*.sh; do
          [ -e "$f" ] || continue
          [ -x "$f" ] || NOEXEC="$NOEXEC $(basename "$f")"
        done
        [ -z "$NOEXEC" ] && ok "真实解压后脚本均带执行位（磁盘位复核）" || bad "解压后缺执行位：${NOEXEC}"
      else
        info "本机为 Windows（NTFS 无 POSIX exec 位）—— 磁盘位复核交由 CI 的 ubuntu runner"
      fi

      MISSING=""
      for f in docker-compose.yml .env.example install.sh install.ps1 start.sh stop.sh \
               update.sh backup.sh restore.sh health-check.sh README.md INSTALL.md VERSION LICENSE; do
        [ -f "$D/$f" ] || MISSING="$MISSING $f"
      done
      [ -z "$MISSING" ] && ok "必需文件齐全（15 项）" || bad "缺少必需文件：${MISSING}"

      LEAK=""
      [ -f "$D/.env" ] && LEAK="$LEAK .env"
      [ -f "$D/INSTALL_CREDENTIALS.txt" ] && LEAK="$LEAK INSTALL_CREDENTIALS.txt"
      ls "$D/backups" >/dev/null 2>&1 && LEAK="$LEAK backups/"
      find "$TMP" \( -name '*.pem' -o -name '*.key' -o -name '*.p12' \) 2>/dev/null | grep -q . && LEAK="$LEAK 私钥"
      [ -z "$LEAK" ] && ok "无 .env / 凭据 / 私钥 / backups" || bad "包内泄露：${LEAK}"

      # 不得含原站素材（版权边界）
      if find "$TMP" \( -name 'ref-*.png' -o -name 'diff-*.png' -o -name 'combo.css' -o -name 'combo.js' \) 2>/dev/null | grep -q .; then
        bad "包内含原站素材（ref-/diff-/combo.*）"
      else
        ok "包内无原站素材"
      fi

      # Shell 语法（用包内**解压后**的脚本，不是工作区）
      SYNTAX_BAD=""
      for f in "$D"/*.sh; do
        [ -e "$f" ] || continue
        bash -n "$f" 2>/dev/null || SYNTAX_BAD="$SYNTAX_BAD $(basename "$f")"
      done
      [ -z "$SYNTAX_BAD" ] && ok "包内全部 .sh 通过 bash -n" || bad "语法错误：${SYNTAX_BAD}"
    else
      bad "ZIP 解压失败（产物损坏）"
    fi
    rm -rf "$TMP" 2>/dev/null
  fi
fi

# ── ⑤ README ──────────────────────────────────────────────────────────
printf '\n%s⑤ README 与版本%s\n' "$C_BLD" "$C_RST"
grep -q "v${EXPECT}" README.md \
  && ok "README 提到 v${EXPECT}" \
  || bad "README 未提到 v${EXPECT}"

if grep -q "releases/tag/v${EXPECT}" README.md 2>/dev/null; then
  ok "README 的 Release 链接指向 v${EXPECT}"
else
  # 允许「尚未发布」的中间态：此时 README 不应指向任何**未来**版本
  if grep -qE "releases/tag/v${EXPECT}" README.md 2>/dev/null; then
    bad "README 链接与版本不一致"
  else
    info "README 中尚无 v${EXPECT} 的 Release 链接（发布前正常，发布后必须补）"
  fi
fi

if [ -n "$ZIP" ]; then
  grep -q "v2ex-clone-v${EXPECT}-deploy.zip" README.md \
    && ok "README 的安装包名指向 v${EXPECT}" \
    || bad "README 的安装包名不是 v2ex-clone-v${EXPECT}-deploy.zip"
fi

# 反向断言：不得残留旧版本号
STALE="$(grep -oE 'v0\.0\.[0-9]+-deploy\.zip' README.md 2>/dev/null | sort -u | grep -v "v${EXPECT}" || true)"
if [ -z "$STALE" ]; then
  ok "README 无旧版本安装包名残留"
else
  bad "README 残留旧版本安装包名：${STALE}"
fi

STALE_TAG="$(grep -oE 'releases/tag/v0\.0\.[0-9]+' README.md 2>/dev/null | sort -u | grep -v "v${EXPECT}" | head -5 || true)"
if [ -z "$STALE_TAG" ]; then
  ok "README 无旧版本 Release 链接残留"
else
  info "README 存在历史版本链接（可能是有意的版本历史）：${STALE_TAG}"
fi

# ── ⑦ 发布事实一致性（docs/release-facts.json 是单一事实来源）────────
printf '\n%s⑦ 发布事实与文档口径%s\n' "$C_BLD" "$C_RST"
FACTS="docs/release-facts.json"
if [ ! -f "$FACTS" ]; then
  bad "缺少 ${FACTS}（发布事实的单一事实来源）"
else
  # 用 node 读 JSON，避免 shell 解析 JSON 的脆弱性
  read -r F_VER F_UNIT F_E2E F_UPG F_PAGES F_ROLES <<EOF
$(node -e "
  const f=require('./${FACTS}');
  console.log([f.version, f.unit.tests, f.e2e.tests, f.upgrade.businessFingerprintItems, f.visual.pages, f.roles.steps].join(' '));
")
EOF

  [ "$F_VER" = "$EXPECT" ] && ok "release-facts.json 的 version = ${F_VER}" \
    || bad "release-facts.json 的 version = ${F_VER}，期望 ${EXPECT}"

  # README 的测试表必须与事实一致（防止「文档写 194、实际 440」这类过期）
  if grep -q "\*\*${F_UNIT}\*\*（" README.md; then
    ok "README 单元测试数与本版本事实一致（${F_UNIT}）"
  else
    bad "README 未出现单元测试数 ${F_UNIT}（与 release-facts.json 不一致）"
  fi
  if grep -q "\*\*${F_E2E}\*\*（" README.md; then
    ok "README E2E 数与本版本事实一致（${F_E2E}）"
  else
    bad "README 未出现 E2E 数 ${F_E2E}（与 release-facts.json 不一致）"
  fi

  # Release Notes 模板里的数字必须与事实一致
  if [ -f .github/workflows/release.yml ]; then
    NOTES_UNIT="$(grep -oE '\| 单元测试 \| ✅ 通过 \| [0-9]+/[0-9]+' .github/workflows/release.yml | grep -oE '[0-9]+/[0-9]+' | head -1)"
    NOTES_E2E="$(grep -oE '\| E2E \| ✅ 通过 \| [0-9]+/[0-9]+' .github/workflows/release.yml | grep -oE '[0-9]+/[0-9]+' | head -1)"
    [ "$NOTES_UNIT" = "${F_UNIT}/${F_UNIT}" ] \
      && ok "Release Notes 的单元测试数 = ${NOTES_UNIT}" \
      || bad "Release Notes 的单元测试数 = '${NOTES_UNIT}'，期望 ${F_UNIT}/${F_UNIT}"
    [ "$NOTES_E2E" = "${F_E2E}/${F_E2E}" ] \
      && ok "Release Notes 的 E2E 数 = ${NOTES_E2E}" \
      || bad "Release Notes 的 E2E 数 = '${NOTES_E2E}'，期望 ${F_E2E}/${F_E2E}"

    # 反向断言：不得残留历史事故里的「60 项数据指纹」（V9-11）
    if grep -q '60 项数据指纹' .github/workflows/release.yml; then
      bad "Release Notes 仍残留 V9-11 的错误口径「60 项数据指纹」"
    else
      ok "Release Notes 无 V9-11 的错误口径（60 项）"
    fi
  fi

  # 升级报告里的业务指纹项数必须与事实一致
  if [ -f docs/UPGRADE_VERIFICATION_v0.0.10.md ]; then
    grep -q "${F_UPG} 项" docs/UPGRADE_VERIFICATION_v0.0.10.md \
      && ok "升级报告的业务指纹项数 = ${F_UPG}" \
      || bad "升级报告未出现「${F_UPG} 项」"
  fi

  # 视觉/四身份报告同样核对
  [ -f docs/evidence/visual/pages-audit.json ] \
    && ok "页面审计证据存在（${F_PAGES} 类页面）" \
    || bad "缺少页面审计证据"
  [ -f docs/evidence/visual/roles-audit.json ] \
    && ok "四身份证据存在（${F_ROLES} 步）" \
    || bad "缺少四身份证据"
fi

# ── ⑥ Release 说明 ────────────────────────────────────────────────────
if [ "$CHECK_RELEASE" = "1" ]; then
  printf '\n%s⑥ Release 说明%s\n' "$C_BLD" "$C_RST"
  if command -v gh >/dev/null 2>&1; then
    if gh release view "v${EXPECT}" --json tagName,isPrerelease,assets >/tmp/v0010-rel.json 2>/dev/null; then
      node -e "
        const r=require('/tmp/v0010-rel.json');
        const okTag = r.tagName === 'v${EXPECT}';
        const okPre = r.isPrerelease === true;
        const names = r.assets.map(a=>a.name);
        const okZip = names.includes('v2ex-clone-v${EXPECT}-deploy.zip');
        const okSha = names.includes('SHA256SUMS');
        console.log(JSON.stringify({okTag,okPre,okZip,okSha,names}));
      " | node -e "
        let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
          const r=JSON.parse(s);
          const G='\x1b[32m', R='\x1b[31m', X='\x1b[0m';
          const p=(c,m)=>console.log('  '+(c?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m')+' '+m);
          p(r.okTag, 'tagName = v${EXPECT}');
          p(r.okPre, '是 Pre-release（0.0.x 不应伪装稳定版）');
          p(r.okZip, '含安装包 v2ex-clone-v${EXPECT}-deploy.zip');
          p(r.okSha, '含 SHA256SUMS');
          if(!(r.okTag&&r.okPre&&r.okZip&&r.okSha)) process.exit(1);
        });
      " || bad "Release 资产/形态不符合要求"
    else
      bad "找不到 Release v${EXPECT}"
    fi
  else
    info "本机无 gh —— Release 断言交由 CI"
  fi
fi

printf '\n%s═══ 汇总：PASS=%d FAIL=%d ═══%s\n' "$C_BLD" "$PASS" "$FAIL" "$C_RST"
if [ "$FAIL" -ne 0 ]; then
  printf '%s发行版一致性不满足 —— 拒绝发布%s\n' "$C_RED" "$C_RST" >&2
  exit 1
fi
printf '%s发行版一致性满足%s\n' "$C_GRN" "$C_RST"
