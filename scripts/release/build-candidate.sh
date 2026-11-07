#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.9 —— 候选版本离线安装包构建（任务书 §二「模式 B」）
#
# ## 定位
#
# 任务书 §二 要求区分**两种发行模式**：
#
#   模式 A（正式在线安装）：已有 GHCR 镜像 + 正式发布授权 ⇒ 从固定 SHA 构建、
#     推送 GHCR、验证 digest、验证匿名 pull、发布部署 ZIP。
#
#   模式 B（本脚本）：**尚未取得正式发布授权**时，仍必须具备完整的安装验证能力。
#     从固定源码 SHA 构建候选镜像 → 导出 docker image tar → 生成候选 ZIP +
#     镜像 tar + SHA256 校验文件 → 在独立测试环境 docker load → 用候选标签
#     运行 Compose → 验证数据库初始化 / Redis / 健康检查 / 登录 / 发帖 / 回复 /
#     重启后数据不丢失。
#
# ## 关键纪律
#
#   1. **候选镜像绝不推送到公开仓库**。本脚本只在本机产出 tar。
#   2. **候选 ≠ 发布**。脚本输出会明确区分「候选构建成功」「候选环境安装成功」
#      「正式公开发布成功」三件事，后两者本脚本**不涉及**。
#   3. 产物必须可追溯到**一个确定的源码 SHA**（SOURCE_SHA）。
#   4. SHA256SUMS 覆盖**所有**产物（ZIP + 镜像 tar），缺失即失败。
#
# ## 用法
#
#   bash scripts/release/build-candidate.sh \
#     --version v0.0.9 \
#     --sha <40位源码SHA> \
#     --out <输出目录> \
#     [--image-tag v2ex-clone-candidate:v0.0.9]
#
# ## 退出码
#
#   0 = 候选构建成功（产物齐备且校验通过）
#   1 = 失败（任一步骤失败即中止，不产出半成品）
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# --- 默认值 ---------------------------------------------------------------
VERSION=""
SOURCE_SHA=""
OUT_DIR=""
IMAGE_TAG=""
SKIP_BUILD=0

C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_BLU=$'\033[34m'
C_BLD=$'\033[1m'; C_RST=$'\033[0m'
info() { printf '%s[信息]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()   { printf '%s[成功]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { printf '%s[警告]%s %s\n' "$C_YEL" "$C_RST" "$*" >&2; }
die()  { printf '%s[错误]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }
step() { printf '\n%s━━ %s ━━%s\n' "$C_BLD" "$*" "$C_RST"; }

# --- 参数解析 -------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --version)     VERSION="${2:-}"; shift 2 ;;
    --sha)         SOURCE_SHA="${2:-}"; shift 2 ;;
    --out)         OUT_DIR="${2:-}"; shift 2 ;;
    --image-tag)   IMAGE_TAG="${2:-}"; shift 2 ;;
    --skip-build)  SKIP_BUILD=1; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -40
      exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[ -n "$VERSION" ]   || die "缺少 --version"
[ -n "$SOURCE_SHA" ] || die "缺少 --sha"
[ -n "$OUT_DIR" ]   || die "缺少 --out"

# SHA 必须是 40 位十六进制 —— 杜绝「随便传个分支名当版本锚点」
case "$SOURCE_SHA" in
  [0-9a-fA-F]*) ;;
  *) die "--sha 必须是十六进制提交 SHA（收到：${SOURCE_SHA}）" ;;
esac
if [ "${#SOURCE_SHA}" -ne 40 ]; then
  die "--sha 长度必须为 40（收到 ${#SOURCE_SHA} 位：${SOURCE_SHA}）"
fi

[ -n "$IMAGE_TAG" ] || IMAGE_TAG="v2ex-clone-candidate:${VERSION}"

# --- 环境前置 -------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "未检测到 docker 命令。"
docker info >/dev/null 2>&1 || die "Docker 守护进程未运行 —— 无法构建候选镜像。"
docker compose version >/dev/null 2>&1 || die "未检测到 Docker Compose v2。"

cd "$REPO_ROOT"

# --- 源码锚点校验 ---------------------------------------------------------
step "校验源码锚点"

# 工作区的 HEAD 必须与 SOURCE_SHA 一致 ——
# 否则「产物来自哪个源码」这个问题就没有确定答案。
HEAD_SHA="$(git rev-parse HEAD)"
if [ "$HEAD_SHA" != "$SOURCE_SHA" ]; then
  die "工作区 HEAD（${HEAD_SHA}）与 --sha（${SOURCE_SHA}）不一致。
候选产物必须来自确定的源码树。请先 checkout 到目标提交。"
fi

# 源码树必须干净 —— 构建产物要能对应到确切的代码状态
if [ -n "$(git status --porcelain)" ]; then
  warn "工作区有未提交改动（这会让候选产物无法复现）："
  git status --porcelain | head -10 >&2
  die "请先提交或 stash 后再构建候选产物。"
fi

# 版本载体必须已同步到目标版本（避免「包名是 0.0.9、里面写着 0.0.8」）
if [ -f deploy/VERSION ]; then
  CUR_VER="$(tr -d '[:space:]' < deploy/VERSION)"
  if [ "$CUR_VER" != "${VERSION#v}" ]; then
    die "deploy/VERSION 为 ${CUR_VER}，与目标版本 ${VERSION#v} 不一致。
请先运行：node scripts/release/sync-version.mjs ${VERSION#v}"
  fi
fi

ok "源码锚点校验通过：${SOURCE_SHA}"
info "候选镜像标签：${IMAGE_TAG}"

# --- 输出目录 -------------------------------------------------------------
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
ZIP_NAME="v2ex-clone-${VERSION}-candidate.zip"
IMAGE_TAR="v2ex-clone-${VERSION}-candidate-image.tar"
ZIP_PATH="${OUT_DIR}/${ZIP_NAME}"
TAR_PATH="${OUT_DIR}/${IMAGE_TAR}"

# --- 步骤 1：构建候选镜像 ------------------------------------------------
step "构建候选镜像（不推送任何远端仓库）"

if [ "$SKIP_BUILD" -eq 1 ]; then
  warn "--skip-build：跳过构建，复用本机已有镜像 ${IMAGE_TAG}"
  docker image inspect "$IMAGE_TAG" >/dev/null 2>&1 \
    || die "本机不存在镜像 ${IMAGE_TAG}"
else
  # 从**确定的源码树**构建。构建上下文就是当前工作区（已校验 HEAD == SOURCE_SHA）。
  docker build \
    --label "org.opencontainers.image.version=${VERSION}" \
    --label "org.opencontainers.image.revision=${SOURCE_SHA}" \
    --label "org.opencontainers.image.source=https://github.com/alicia1030su/v2ex-clone" \
    -t "$IMAGE_TAG" \
    "$REPO_ROOT"
fi

docker image inspect "$IMAGE_TAG" >/dev/null 2>&1 || die "镜像构建后仍不可用：${IMAGE_TAG}"

IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE_TAG")"
IMAGE_SIZE="$(docker image inspect --format '{{.Size}}' "$IMAGE_TAG")"
ok "候选镜像构建成功"
info "  镜像标签：${IMAGE_TAG}"
info "  镜像 ID  ：${IMAGE_ID}"
info "  镜像大小：${IMAGE_SIZE} 字节"

# 镜像内的版本载体必须与目标版本一致 —— 防止「标签是 0.0.9、内容是 0.0.8」
IMG_VER="$(docker run --rm --entrypoint node "$IMAGE_TAG" -e \
  "console.log(require('/app/package.json').version)" 2>/dev/null | tr -d '\r\n' || echo '')"
if [ -n "$IMG_VER" ] && [ "$IMG_VER" != "${VERSION#v}" ]; then
  die "镜像内 package.json 版本为 ${IMG_VER}，与目标 ${VERSION#v} 不一致 —— 候选产物不可信。"
fi
[ -n "$IMG_VER" ] && ok "镜像内版本与目标一致：${IMG_VER}"

# --- 步骤 2：导出镜像 tar（离线安装介质） --------------------------------
step "导出镜像 tar（docker save）"

docker save -o "$TAR_PATH" "$IMAGE_TAG"
[ -s "$TAR_PATH" ] || die "镜像 tar 导出失败或为空：${TAR_PATH}"
TAR_SIZE="$(wc -c < "$TAR_PATH" | tr -d ' ')"
ok "镜像 tar 已导出：${IMAGE_TAR}（${TAR_SIZE} 字节）"

# --- 步骤 3：生成候选部署 ZIP --------------------------------------------
step "生成候选部署 ZIP"

# 用**候选镜像标签**替换默认 GHCR 镜像 ——
# 候选包引用的必须是一个**真实存在**的镜像（本地已 build + load）。
DEPLOY_STAGE="${OUT_DIR}/.stage"
rm -rf "$DEPLOY_STAGE"
mkdir -p "$DEPLOY_STAGE"
cp -r "${REPO_ROOT}/deploy/." "$DEPLOY_STAGE/"

# 移除生成物与备份（绝不能进包）
rm -f "$DEPLOY_STAGE/.env" "$DEPLOY_STAGE/INSTALL_CREDENTIALS.txt"
rm -rf "${DEPLOY_STAGE}/backups"
find "$DEPLOY_STAGE" -name '*.log' -delete

# 改写候选包内的镜像引用：
#   · deploy/.env.example  —— 首次生成的默认值
#   · deploy/docker-compose.yml —— compose 的 fallback 默认值
#   · deploy/install.sh / install.ps1 —— DEFAULT_IMAGE
# 目标：候选包里的镜像引用 == 本地候选标签。
node "${REPO_ROOT}/scripts/release/rewrite-candidate-image.mjs" "$DEPLOY_STAGE" "$IMAGE_TAG" \
  || die "候选包镜像引用改写失败 —— 候选包会指向不存在的镜像。"

# 归一化 shell 脚本的换行符为 LF —— **候选包的硬性要求**。
#
# 背景：Windows 上 core.autocrlf=true ⇒ 工作区里的 *.sh 是 CRLF。
# 若直接打包，Linux 用户执行 install.sh 会遇到
# `install.sh: line 3: $'\r': command not found` —— 安装直接失败。
# 官方发行流水线在 Linux 上跑（天然 LF），但**候选包可能在本机构建**，
# 所以这里必须显式归一化，不能依赖构建机。
if command -v sed >/dev/null 2>&1; then
  NORMALIZED=0
  while IFS= read -r sh_file; do
    if od -c "$sh_file" 2>/dev/null | grep -q '\\r'; then
      # 用 tr 删除 CR（不用 sed -i，BSD/GNU 的 -i 行为不同）
      tr -d '\r' < "$sh_file" > "$sh_file.lf" && mv "$sh_file.lf" "$sh_file"
      NORMALIZED=$((NORMALIZED+1))
    fi
  done < <(find "$DEPLOY_STAGE" -name '*.sh' -type f)
  if [ "$NORMALIZED" -gt 0 ]; then
    ok "已把 ${NORMALIZED} 个 shell 脚本的换行符归一化为 LF"
  fi
fi

# 校验候选包内的镜像引用确实被改成了候选标签
if ! grep -q "$IMAGE_TAG" "$DEPLOY_STAGE/docker-compose.yml" 2>/dev/null; then
  die "候选包 docker-compose.yml 的镜像引用改写失败 —— 候选包会指向不存在的镜像。"
fi
ok "候选包镜像引用已指向：${IMAGE_TAG}"

# 打包
( cd "$DEPLOY_STAGE" && zip -qr "$ZIP_PATH" . )
[ -s "$ZIP_PATH" ] || die "候选 ZIP 生成失败：${ZIP_PATH}"
ZIP_SIZE="$(wc -c < "$ZIP_PATH" | tr -d ' ')"
ok "候选 ZIP 已生成：${ZIP_NAME}（${ZIP_SIZE} 字节）"

# --- 步骤 4：SHA256SUMS ---------------------------------------------------
step "生成 SHA256SUMS"

cd "$OUT_DIR"
rm -f SHA256SUMS
sha256sum "$ZIP_NAME" "$IMAGE_TAR" > SHA256SUMS
cat SHA256SUMS

# 校验和必须可复算（防止写错）
sha256sum -c SHA256SUMS >/dev/null 2>&1 || die "SHA256SUMS 自校验失败。"
ok "SHA256SUMS 已生成并通过自校验"

# --- 步骤 5：候选包内容完整性 --------------------------------------------
step "校验候选包内容完整性"

REQUIRED="docker-compose.yml .env.example install.sh install.ps1 start.sh stop.sh update.sh backup.sh restore.sh health-check.sh README.md INSTALL.md VERSION LICENSE"
missing=0
for f in $REQUIRED; do
  if [ ! -f "$DEPLOY_STAGE/$f" ]; then
    warn "候选包缺少必需文件：${f}"
    missing=1
  fi
done
# 不得包含生成的 .env / 凭据
[ -f "$DEPLOY_STAGE/.env" ] && { warn "候选包内含 .env"; missing=1; }
[ -f "$DEPLOY_STAGE/INSTALL_CREDENTIALS.txt" ] && { warn "候选包内含凭据文件"; missing=1; }
# 不得含原站素材
if find "$DEPLOY_STAGE" \( -name 'ref-*.png' -o -name 'diff-*.png' \) 2>/dev/null | grep -q .; then
  warn "候选包内含原站素材"
  missing=1
fi
[ "$missing" -ne 0 ] && die "候选包内容校验失败（详见上方告警）。"
ok "候选包内容完整"

rm -rf "$DEPLOY_STAGE"

# --- 步骤 6：产出清单 -----------------------------------------------------
step "候选产物清单"

cat > "${OUT_DIR}/CANDIDATE-MANIFEST.txt" << EOF
V2EX Clone 候选安装包清单（模式 B —— 未公开发布）
================================================

构建时间     : $(date '+%Y-%m-%d %H:%M:%S %Z')
源码 SHA     : ${SOURCE_SHA}
版本         : ${VERSION}
候选镜像标签 : ${IMAGE_TAG}
候选镜像 ID  : ${IMAGE_ID}
候选镜像大小 : ${IMAGE_SIZE} 字节

产物
----
  ${ZIP_NAME}      —— 部署 ZIP（镜像引用指向候选标签）
  ${IMAGE_TAR}     —— 离线镜像 tar（docker load 用）
  SHA256SUMS       —— 全部产物的 SHA256 校验
  CANDIDATE-MANIFEST.txt —— 本清单

三种状态的区分（重要）
--------------------
  ✅ 候选构建成功   ：本脚本产出上述全部产物且校验通过。
  ⬜ 候选环境安装成功：需**另行**执行 scripts/release/verify-candidate-install.sh
                      （docker load → compose up → 迁移 / Redis / 健康检查 /
                        登录 / 发帖 / 回复 / 重启后数据不丢失）。
  ⬜ 正式公开发布成功：需 GHCR 镜像推送 + digest 核验 + 匿名 pull 验证 +
                      正式 Release 发布 + tag 创建 —— **本轮未授权，不涉及**。

本轮授权边界
------------
  · 候选镜像**未**推送到任何远端镜像仓库（仅本机 tar）。
  · 未创建正式 Tag、未创建/修改任何 Release、未改写远端历史。

安装方式（离线）
----------------
  1) docker load -i ${IMAGE_TAR}
  2) 解压 ${ZIP_NAME}
  3) cd deploy && ./install.sh
     （install.sh 会把 .env 的 V2EX_IMAGE 设为候选标签，本机已有镜像 ⇒ 免拉取）
EOF

ok "候选产物清单已写入 CANDIDATE-MANIFEST.txt"

printf '\n%s%s候选构建完成%s\n' "$C_BLD" "$C_GRN" "$C_RST"
printf '  输出目录：%s\n' "$OUT_DIR"
printf '  源码 SHA：%s\n' "$SOURCE_SHA"
printf '  镜像标签：%s\n' "$IMAGE_TAG"
printf '\n%s下一步%s：运行 scripts/release/verify-candidate-install.sh 验证候选环境安装。\n' "$C_BLD" "$C_RST"
printf '%s注意%s：本脚本**未**推送任何远端镜像，也**未**产生任何公开发布物。\n\n' "$C_YEL" "$C_RST"
