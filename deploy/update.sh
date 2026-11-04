#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone — 升级脚本（update.sh）
#
# 用法：
#   ./update.sh                                        # 沿用 .env 中的 V2EX_IMAGE（向后兼容）
#   ./update.sh --version vX.Y.Z                       # 升级到指定版本（自动改写 .env 的 V2EX_IMAGE）
#   ./update.sh --image ghcr.io/<repo>:<tag>           # 升级到指定镜像（必须带 tag）
#   ./update.sh --force                                # 目标镜像与当前镜像 digest 一致时仍继续
#   ./update.sh --help                                 # 显示本帮助
#
# 流程（严格按序）：
#   1. 解析并校验目标版本 / 镜像（拒绝空版本与非法 tag）
#   2. 记录旧镜像的 tag / digest / imageId，以及运行中容器实际使用的 imageId
#   3. 记录升级前的管理员账号状态（账号是否存在、口令哈希）
#   4. 备份：复用 ./backup.sh（数据库逻辑备份 + .env 备份），并额外留一份
#      带时间戳的「本次升级前 .env」副本；**备份失败即中止升级**
#   5. **实际改写 .env 中的 V2EX_IMAGE** 为目标镜像（这才是「真正升到新版本」的关键）
#   6. 用 `docker compose config` 校验 Compose 实际解析到的应用镜像确为目标镜像
#   7. `docker compose pull` 拉取目标镜像
#   8. 对比新旧 digest / imageId；**若目标镜像未变化则告警并给出选择**
#   9. `docker compose up -d` 重建容器（**保留数据卷**）
#  10. 等待健康检查；校验数据卷仍在、管理员账号仍在且口令哈希未被改写
#  11. 任一步失败 → 自动回滚到旧镜像 + 恢复 .env 中的旧 V2EX_IMAGE
#
# 安全约定（脚本自我承诺，评审时逐条核对）：
#   - **绝不执行 `docker compose down -v`**（会删除数据卷）。只用 `up -d`，
#     Compose 会就地重建容器并保留数据卷。升级后还会显式校验数据卷仍在。
#   - **绝不自动执行破坏性数据库回滚**：回滚只回滚**镜像与 .env 配置**，
#     不做 DROP / TRUNCATE，也不自动用 restore.sh 覆盖数据库。
#     理由：数据库可能已被新版本写入新结构，自动覆盖会**丢失新版本产生的数据**，
#     且恢复过程不可逆。数据层回退必须由人显式执行：
#       ./restore.sh <步骤 4 生成的备份文件>
#   - **绝不改写管理员口令**：本脚本不修改 .env 中的 SEED_ADMIN_PASSWORD，
#     也不重置任何账号的口令。容器入口的 seed 阶段对**已存在**的账号只读不写
#     （见 scripts/seed.ts 的「已存在未修改」分支），因此升级不会覆盖管理员口令。
#     升级后本脚本会比对管理员口令哈希是否变化，以此证明口令未被篡改。
#   - 升级前后都打印 digest / imageId 对比，便于事后审计。
#
# 退出码：
#   0 = 升级成功
#   1 = 升级失败（已自动回滚镜像与配置）
#   2 = 参数错误 / 非法版本号 / 非法镜像引用
#   3 = 目标镜像与当前运行镜像完全相同（未变化），升级已中止
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
BACKUP_DIR="$SCRIPT_DIR/backups"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
ROLLBACK_TIMEOUT="${ROLLBACK_TIMEOUT:-120}"
# 默认镜像仓库（不含 tag）。版本号由调用方给出，脚本自身不写死任何版本号。
DEFAULT_REPO="ghcr.io/alicia1030su/v2ex-clone"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

# --- 输出样式 --------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLU=$'\033[34m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YLW=''; C_BLU=''; C_BLD=''; C_RST=''
fi
info() { printf '%s[信息]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()   { printf '%s[成功]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { printf '%s[警告]%s %s\n' "$C_YLW" "$C_RST" "$*" >&2; }
err()  { printf '%s[错误]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  err "$*"
  cat >&2 <<'EOF'
用法：
  ./update.sh                              沿用 .env 中的 V2EX_IMAGE（向后兼容路径）
  ./update.sh --version vX.Y.Z             升级到指定版本，自动改写 .env 的 V2EX_IMAGE
  ./update.sh --image <完整镜像引用>        升级到指定镜像（必须带 tag）
  ./update.sh --force                      目标镜像 digest 与当前一致时仍继续（不推荐）
  ./update.sh --help                       显示本帮助

环境变量：
  HEALTH_TIMEOUT=180    升级后等待就绪的最长秒数
  ROLLBACK_TIMEOUT=120  回滚后等待就绪的最长秒数
  NO_COLOR=1            关闭彩色输出
EOF
  exit 2
}

usage_text() {
  cat <<'EOF'
V2EX Clone 升级脚本

用法：
  ./update.sh                              沿用 .env 中的 V2EX_IMAGE（向后兼容路径）
  ./update.sh --version vX.Y.Z             升级到指定版本，自动改写 .env 的 V2EX_IMAGE
  ./update.sh --image <完整镜像引用>        升级到指定镜像（必须带 tag）
  ./update.sh --force                      目标镜像 digest 与当前一致时仍继续（不推荐）
  ./update.sh --help                       显示本帮助

关键安全约定：
  · 绝不删除数据卷：只用 `up -d` 就地重建容器，保留全部卷
  · 绝不自动执行破坏性数据库回滚（数据层回退需人工执行 ./restore.sh）
  · 绝不覆盖管理员口令（升级后校验口令哈希未变）

退出码：0 成功 / 1 失败（已回滚）/ 2 参数或校验错误 / 3 目标镜像未变化（已中止）
EOF
}

# ===========================================================================
# 参数解析
# ===========================================================================
TARGET_VERSION=""
TARGET_IMAGE=""
VERSION_GIVEN=0
IMAGE_GIVEN=0
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ "$#" -ge 2 ] || usage "--version 需要一个版本号参数。"
      TARGET_VERSION="$2"; VERSION_GIVEN=1; shift 2 ;;
    --version=*)
      TARGET_VERSION="${1#--version=}"; VERSION_GIVEN=1; shift ;;
    --image)
      [ "$#" -ge 2 ] || usage "--image 需要一个镜像引用参数。"
      TARGET_IMAGE="$2"; IMAGE_GIVEN=1; shift 2 ;;
    --image=*)
      TARGET_IMAGE="${1#--image=}"; IMAGE_GIVEN=1; shift ;;
    --force)
      FORCE=1; shift ;;
    -h|--help)
      usage_text; exit 0 ;;
    *)
      usage "未知参数：$1" ;;
  esac
done

if [ "$VERSION_GIVEN" = "1" ] && [ "$IMAGE_GIVEN" = "1" ]; then
  usage "--version 与 --image 只能二选一（否则目标镜像存在歧义）。"
fi

# 显式给了 --version / --image 但值为空 —— 必须在任何写操作之前拒绝。
if [ "$VERSION_GIVEN" = "1" ] && [ -z "$TARGET_VERSION" ]; then
  err "版本号为空：请用 --version vX.Y.Z 指定目标版本。"
  exit 2
fi
if [ "$IMAGE_GIVEN" = "1" ] && [ -z "$TARGET_IMAGE" ]; then
  err "镜像引用为空：请用 --image ghcr.io/<repo>:<tag> 指定目标镜像。"
  exit 2
fi

# ===========================================================================
# 校验工具
# ===========================================================================
REF_NAME=""
REF_TAG=""

# 把完整镜像引用拆成「名称 + tag」。没有 tag 时 REF_TAG 为空。
split_image_ref() {
  local ref="$1"
  REF_NAME="${ref%:*}"
  REF_TAG="${ref##*:}"
  if [ "$REF_TAG" = "$ref" ]; then
    REF_TAG=""
  else
    case "$REF_TAG" in
      */*) REF_TAG="" ;;   # 形如 registry:5000/repo —— 冒号是端口而非 tag
    esac
  fi
}

# 校验版本号：允许 v0.0.4 / 0.0.4 / v0.0.4-rc.1
validate_version() {
  local v="$1"
  if [ -z "$v" ]; then
    err "版本号为空：请用 --version vX.Y.Z 指定目标版本。"
    return 1
  fi
  if printf '%s' "$v" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'; then
    return 0
  fi
  err "非法版本号格式：'${v}'（期望形如 v0.0.4 或 v0.0.4-rc.1；仅允许数字、点、短横线与预发布后缀）。"
  return 1
}

# 规范化版本号：统一加 v 前缀（与本项目既有 tag 命名一致）。
normalize_version() {
  local v="$1"
  case "$v" in
    v*) printf '%s' "$v" ;;
    *)  printf 'v%s' "$v" ;;
  esac
}

# 校验完整镜像引用。
validate_image_ref() {
  local ref="$1"
  if [ -z "$ref" ]; then
    err "镜像引用为空：请用 --image ghcr.io/<repo>:<tag> 指定目标镜像。"
    return 1
  fi
  case "$ref" in
    *[[:space:]]*)
      err "镜像引用含空白字符：'${ref}'"
      return 1 ;;
  esac
  split_image_ref "$ref"
  if [ -z "$REF_TAG" ]; then
    err "镜像引用必须带 tag（形如 repo:tag）：'${ref}'"
    return 1
  fi
  if ! printf '%s' "$REF_TAG" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$'; then
    err "非法 tag：'${REF_TAG}'（只允许字母、数字、下划线、点、短横线，长度 ≤ 128）。"
    return 1
  fi
  if ! printf '%s' "$REF_NAME" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._/:@-]*$'; then
    err "非法镜像名：'${REF_NAME}'"
    return 1
  fi
  return 0
}

# ===========================================================================
# .env 读写（原子替换，保留注释与其它条目）
# ===========================================================================
read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" 2>/dev/null | tail -n 1
}

# 写入 .env 的某个键；若该键不存在则追加到文件末尾。
update_env_value() {
  local key="$1" value="$2" tmp
  [ -f "$ENV_FILE" ] || return 1
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  if ! awk -v key="$key" -v val="$value" '
        index($0, key "=") == 1 { print key "=" val; seen = 1; next }
        { print }
        END { if (!seen) print key "=" val }
      ' "$ENV_FILE" > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  chmod 600 "$tmp" 2>/dev/null || true
  mv "$tmp" "$ENV_FILE"
}

# 从 .env 中移除某个键（回滚到「原本就没有这一行」的状态）。
remove_env_value() {
  local key="$1" tmp
  [ -f "$ENV_FILE" ] || return 1
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  if ! awk -v key="$key" '
        index($0, key "=") == 1 { next }
        { print }
      ' "$ENV_FILE" > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  chmod 600 "$tmp" 2>/dev/null || true
  mv "$tmp" "$ENV_FILE"
}

# ===========================================================================
# 镜像状态查询
# ===========================================================================
get_image_id() {
  docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || echo '<未知>'
}

get_image_digest() {
  docker image inspect \
    --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}<本地无该镜像>{{end}}' \
    "$1" 2>/dev/null || echo '<未知>'
}

# 运行中的 app 容器实际使用的 imageId —— 这才是「当前真正在跑的版本」。
get_running_image_id() {
  local cid
  cid="$(docker compose ps -q app 2>/dev/null || true)"
  if [ -z "$cid" ]; then
    echo '<无运行容器>'
    return 0
  fi
  docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || echo '<未知>'
}

# ===========================================================================
# 数据库只读查询（用于校验管理员账号）
# ===========================================================================
psql_query() {
  docker compose exec -T postgres psql \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --no-headers --tuples-only --command "$1" 2>/dev/null || true
}

# ===========================================================================
# 前置检查
# ===========================================================================
command -v docker >/dev/null 2>&1 || die "未检测到 docker 命令。请先安装 Docker Engine 20.10+。"
docker compose version >/dev/null 2>&1 || die "未检测到 Docker Compose v2（docker compose version 失败）。"
[ -f "$ENV_FILE" ] || die "未找到 .env 配置。请先运行 ./install.sh 完成安装。"

OLD_IMAGE="$(read_env_value V2EX_IMAGE)"
if [ -n "$OLD_IMAGE" ]; then
  OLD_IMAGE_PRESENT=1
else
  OLD_IMAGE_PRESENT=0
fi

APP_PORT="$(read_env_value APP_PORT)"
APP_PORT="${APP_PORT:-3000}"
APP_URL="$(read_env_value APP_URL)"
APP_URL="${APP_URL:-http://localhost:${APP_PORT}}"
POSTGRES_USER="$(read_env_value POSTGRES_USER)"
POSTGRES_USER="${POSTGRES_USER:-v2ex}"
POSTGRES_DB="$(read_env_value POSTGRES_DB)"
POSTGRES_DB="${POSTGRES_DB:-v2ex}"
ADMIN_USERNAME="$(read_env_value SEED_ADMIN_USERNAME)"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
# SEED_ADMIN_PASSWORD 的取值只用于「升级前后是否被改动」的比对，绝不打印。
ADMIN_PASSWORD_BEFORE="$(read_env_value SEED_ADMIN_PASSWORD)"

# ===========================================================================
# 解析目标镜像
# ===========================================================================
if [ "$IMAGE_GIVEN" = "1" ]; then
  validate_image_ref "$TARGET_IMAGE" || exit 2
  split_image_ref "$TARGET_IMAGE"
  TARGET_REPO="$REF_NAME"
  TARGET_TAG="$REF_TAG"
  info "目标镜像：${TARGET_IMAGE}（来自 --image 参数）"
else
  if [ "$VERSION_GIVEN" = "1" ]; then
    validate_version "$TARGET_VERSION" || exit 2
    NORMALIZED_VERSION="$(normalize_version "$TARGET_VERSION")"
    if [ "$NORMALIZED_VERSION" != "$TARGET_VERSION" ]; then
      info "版本号已规范化：${TARGET_VERSION} → ${NORMALIZED_VERSION}"
    fi
    TARGET_TAG="$NORMALIZED_VERSION"
    if [ "$OLD_IMAGE_PRESENT" = "1" ]; then
      split_image_ref "$OLD_IMAGE"
      if [ -n "$REF_NAME" ]; then
        TARGET_REPO="$REF_NAME"
      else
        TARGET_REPO="$DEFAULT_REPO"
      fi
    else
      TARGET_REPO="$DEFAULT_REPO"
    fi
    TARGET_IMAGE="${TARGET_REPO}:${TARGET_TAG}"
    info "目标镜像：${TARGET_IMAGE}（由 --version ${TARGET_VERSION} 推导，仓库沿用当前配置）"
  else
    # 向后兼容路径：不指定任何参数时，沿用 .env 中的 V2EX_IMAGE。
    [ "$OLD_IMAGE_PRESENT" = "1" ] \
      || die ".env 中没有 V2EX_IMAGE，且未指定 --version / --image。请显式指定目标版本：./update.sh --version vX.Y.Z"
    validate_image_ref "$OLD_IMAGE" || exit 2
    TARGET_IMAGE="$OLD_IMAGE"
    split_image_ref "$TARGET_IMAGE"
    TARGET_REPO="$REF_NAME"
    TARGET_TAG="$REF_TAG"
    info "目标镜像：${TARGET_IMAGE}（沿用 .env 中的 V2EX_IMAGE）"
  fi
fi

printf '\n%s升级 V2EX Clone%s\n' "$C_BLD" "$C_BLU" "$C_RST"
if [ "$OLD_IMAGE_PRESENT" = "1" ]; then
  info "当前镜像（旧）：${OLD_IMAGE}"
else
  info "当前镜像（旧）：（.env 中原本没有 V2EX_IMAGE）"
fi
info "目标镜像（新）：${TARGET_IMAGE}"

# ===========================================================================
# 记录旧状态
# ===========================================================================
OLD_IMAGE_ID='<未知>'
OLD_DIGEST='<未知>'
if [ "$OLD_IMAGE_PRESENT" = "1" ]; then
  OLD_IMAGE_ID="$(get_image_id "$OLD_IMAGE")"
  OLD_DIGEST="$(get_image_digest "$OLD_IMAGE")"
fi
RUNNING_IMAGE_ID="$(get_running_image_id)"
PRE_TARGET_ID="$(get_image_id "$TARGET_IMAGE")"
PRE_TARGET_DIGEST="$(get_image_digest "$TARGET_IMAGE")"
info "旧镜像 imageId：${OLD_IMAGE_ID}"
info "旧镜像 digest ：${OLD_DIGEST}"
info "运行中容器 imageId：${RUNNING_IMAGE_ID}"
info "目标镜像本地已存在时的 imageId：${PRE_TARGET_ID}"

# ===========================================================================
# 记录升级前的管理员账号状态
# ===========================================================================
# 目的：升级后证明「管理员账号没被删」且「口令哈希没被改写」。
# 为什么不用真实登录来验证：本项目对登录有速率限制（见 .env 的 RATE_LIMIT_LOGIN_MAX），
# 探活式登录会污染 login_attempts 并可能锁住正常用户。
# 口令哈希未变 + 账号仍在 ⇒ 旧口令仍然可用，等价于「可登录」的可靠证明。
ADMIN_SQL_NAME_SAFE=0
if printf '%s' "$ADMIN_USERNAME" | grep -Eq '^[A-Za-z0-9_.-]{1,32}$'; then
  ADMIN_SQL_NAME_SAFE=1
else
  warn "管理员用户名含非常规字符（${ADMIN_USERNAME}），跳过 SQL 层的账号校验。"
fi

ADMIN_COUNT_BEFORE=''
ADMIN_HASH_BEFORE=''
if [ "$ADMIN_SQL_NAME_SAFE" = "1" ]; then
  ADMIN_COUNT_BEFORE="$(psql_query "SELECT count(*) FROM users WHERE username = '${ADMIN_USERNAME}' AND role = 'admin';" | tr -d '[:space:]' | head -n 1)"
  ADMIN_HASH_BEFORE="$(psql_query "SELECT password_hash FROM users WHERE username = '${ADMIN_USERNAME}';" | tr -d '[:space:]' | head -n 1)"
fi
if [ "$ADMIN_SQL_NAME_SAFE" = "1" ] && [ -n "$ADMIN_COUNT_BEFORE" ]; then
  info "升级前管理员账号 '${ADMIN_USERNAME}' 存在数：${ADMIN_COUNT_BEFORE}"
else
  info "升级前无法读取管理员账号状态（数据库未就绪或账号不存在）—— 升级后该项校验会降级为告警。"
fi

# ===========================================================================
# 备份（失败即中止升级）
# ===========================================================================
info "步骤 1/6：升级前备份..."
mkdir -p "$BACKUP_DIR" 2>/dev/null || true
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

[ -f "$SCRIPT_DIR/backup.sh" ] \
  || die "缺少 backup.sh —— 升级中止（升级前必须有可用的备份手段）。"
# 复用既有 backup.sh：它负责 pg_dump 逻辑备份 + .env 备份。
if bash "$SCRIPT_DIR/backup.sh"; then
  ok "backup.sh 执行成功。"
else
  die "backup.sh 执行失败 —— 升级中止（不会在没有备份的情况下继续升级）。"
fi

# update.sh 额外留一份「本次升级前」的 .env 副本（回滚时以此为准）。
ENV_BACKUP="$BACKUP_DIR/.env.pre-update-${TIMESTAMP}"
if cp "$ENV_FILE" "$ENV_BACKUP"; then
  chmod 600 "$ENV_BACKUP" 2>/dev/null || true
  ok "已保存本次升级前的 .env 副本：${ENV_BACKUP}"
else
  die "保存 .env 副本失败 —— 升级中止。"
fi

# ===========================================================================
# 回滚
# ===========================================================================
# 用法：rollback <原因> <scope>
#   scope=config —— 只恢复 .env（此时容器尚未被重建，无需重启服务）
#   scope=image  —— 恢复 .env 并用旧镜像重建容器
rollback() {
  local reason="$1" scope="$2"
  warn "开始回滚（原因：${reason}）..."
  if [ "$OLD_IMAGE_PRESENT" = "1" ]; then
    if update_env_value V2EX_IMAGE "$OLD_IMAGE"; then
      ok ".env 的 V2EX_IMAGE 已恢复为：${OLD_IMAGE}"
    else
      err "恢复 .env 失败！请手动检查 ${ENV_FILE}"
    fi
  else
    if remove_env_value V2EX_IMAGE; then
      ok ".env 已恢复到「原本没有 V2EX_IMAGE」的状态。"
    else
      err "恢复 .env 失败！请手动检查 ${ENV_FILE}"
    fi
  fi

  if [ "$scope" = "image" ] && [ -n "$OLD_IMAGE" ]; then
    if docker compose up -d; then
      ok "容器已使用旧镜像重建：${OLD_IMAGE}"
    else
      err "使用旧镜像重建容器失败。请手动执行：docker compose up -d"
    fi
    local deadline=$(( $(date +%s) + ROLLBACK_TIMEOUT ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
      local cid status
      cid="$(docker compose ps -q app 2>/dev/null || true)"
      if [ -n "$cid" ]; then
        status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
        if [ "$status" = "healthy" ]; then
          ok "旧版本服务已恢复就绪。"
          break
        fi
      fi
      sleep 3
    done
  fi

  warn "回滚范围：只回滚**镜像与 .env 配置**。"
  warn "**不会**自动执行任何破坏性数据库回滚（不删表、不清空表、不自动用 restore 覆盖数据库）。"
  warn "如需回退数据，请人工显式执行：./restore.sh <备份文件>"
}

# ===========================================================================
# 改写 .env 中的 V2EX_IMAGE —— 这是「真正升到新版本」的关键
# ===========================================================================
info "步骤 2/6：更新 .env 中的 V2EX_IMAGE..."
if [ "$OLD_IMAGE_PRESENT" = "1" ]; then
  info "镜像切换：${OLD_IMAGE} → ${TARGET_IMAGE}"
else
  info "镜像切换：（无）→ ${TARGET_IMAGE}"
fi
if ! update_env_value V2EX_IMAGE "$TARGET_IMAGE"; then
  die "写入 .env 的 V2EX_IMAGE 失败 —— 升级中止（.env 未被修改）。"
fi
CURRENT_IMAGE="$(read_env_value V2EX_IMAGE)"
if [ "$CURRENT_IMAGE" != "$TARGET_IMAGE" ]; then
  rollback "写入 .env 后校验不一致" "config"
  die "写入 .env 的 V2EX_IMAGE 后校验不一致（期望 ${TARGET_IMAGE}，实际 ${CURRENT_IMAGE:-（空）}）。"
fi
ok ".env 的 V2EX_IMAGE 已更新为：${TARGET_IMAGE}"

# ===========================================================================
# 校验 Compose 实际解析到的镜像
# ===========================================================================
info "步骤 3/6：校验 Compose 实际解析到的应用镜像..."
COMPOSE_CONFIG_OUT="$(docker compose config 2>/dev/null || true)"
if [ -z "$COMPOSE_CONFIG_OUT" ]; then
  warn "docker compose config 无输出（可能缺少必填环境变量），跳过镜像解析校验。"
elif printf '%s\n' "$COMPOSE_CONFIG_OUT" | grep -qF -- "$TARGET_IMAGE"; then
  ok "Compose 解析到的应用镜像确为目标镜像：${TARGET_IMAGE}"
else
  err "Compose 解析到的镜像与目标不一致！期望包含：${TARGET_IMAGE}"
  printf '%s\n' "$COMPOSE_CONFIG_OUT" | grep -i 'image:' >&2 || true
  rollback "Compose 镜像解析校验失败" "config"
  die "Compose 解析校验失败，升级中止。"
fi

# ===========================================================================
# 拉取目标镜像
# ===========================================================================
info "步骤 4/6：拉取目标镜像 ${TARGET_IMAGE}..."
if ! docker compose pull; then
  warn "docker compose pull 失败。"
  rollback "docker compose pull 失败" "config"
  die "拉取镜像失败。请检查网络（能否访问镜像仓库）后重试。已恢复 .env 中的旧 V2EX_IMAGE。"
fi
ok "镜像拉取完成。"

NEW_IMAGE_ID="$(get_image_id "$TARGET_IMAGE")"
NEW_DIGEST="$(get_image_digest "$TARGET_IMAGE")"
info "新镜像 imageId：${NEW_IMAGE_ID}"
info "新镜像 digest ：${NEW_DIGEST}"

# ===========================================================================
# digest 对比 —— 若目标镜像未变化则告警并给出选择
# ===========================================================================
SAME_IMAGE=0
if [ "$NEW_IMAGE_ID" != '<未知>' ] && [ "$RUNNING_IMAGE_ID" != '<无运行容器>' ] \
   && [ "$RUNNING_IMAGE_ID" != '<未知>' ] && [ "$NEW_IMAGE_ID" = "$RUNNING_IMAGE_ID" ]; then
  SAME_IMAGE=1
fi

if [ "$SAME_IMAGE" = "1" ]; then
  warn "═══════════════════════════════════════════════════════════"
  warn "⚠ 目标版本镜像与当前运行的镜像**完全相同**（imageId 一致）"
  warn "    当前运行 : ${OLD_IMAGE:-（无）}  ${RUNNING_IMAGE_ID}"
  warn "    目标镜像 : ${TARGET_IMAGE}  ${NEW_IMAGE_ID}"
  warn "    结论     : 升级**不会带来任何内容变化**（tag 变了，镜像内容没变）"
  warn "可选处置："
  warn "    [1] 继续 —— 强制把容器重建到目标 tag（内容仍与旧版一致）"
  warn "    [2] 中止 —— 保持当前运行版本不变（默认）"
  warn "═══════════════════════════════════════════════════════════"
  CONTINUE_SAME=0
  if [ "$FORCE" = "1" ]; then
    CONTINUE_SAME=1
    warn "已指定 --force —— 选择 [1] 继续。"
  elif [ -t 0 ] && [ -z "${V2EX_UPDATE_NONINTERACTIVE:-}" ]; then
    printf '请选择 [1/2]（默认 2）：'
    REPLY=""
    read -r REPLY || true
    case "$REPLY" in
      1) CONTINUE_SAME=1 ;;
      *) CONTINUE_SAME=0 ;;
    esac
  fi
  if [ "$CONTINUE_SAME" != "1" ]; then
    rollback "目标镜像未变化，已按用户选择中止" "config"
    err "目标版本镜像未变化，升级已中止（如确认要强制切换 tag，请加 --force）。"
    exit 3
  fi
elif [ "$PRE_TARGET_ID" != '<未知>' ] && [ "$PRE_TARGET_ID" = "$NEW_IMAGE_ID" ]; then
  warn "提示：目标 tag 的镜像内容与上次拉取时相同（本机已缓存），但与当前运行的版本不同 —— 容器仍会被重建。"
fi

# ===========================================================================
# 重建容器（保留数据卷）
# ===========================================================================
info "步骤 5/6：重建容器（**不删除数据卷**，只用 up -d）..."
if ! docker compose up -d; then
  warn "docker compose up -d 失败。最近的日志："
  docker compose logs --tail=100 >&2 || true
  rollback "docker compose up -d 失败" "image"
  die "升级失败，已回滚到旧镜像。"
fi

info "等待服务就绪（最长 ${HEALTH_TIMEOUT} 秒）..."
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
ready=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  cid="$(docker compose ps -q app 2>/dev/null || true)"
  if [ -n "$cid" ]; then
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
    if [ "$status" = "healthy" ]; then ready=1; break; fi
    case "$status" in
      exited|dead)
        warn "app 容器已退出。最近的日志："
        docker compose logs --tail=100 app >&2 || true
        rollback "升级后 app 容器退出" "image"
        die "升级后服务启动失败，已回滚到旧镜像。"
        ;;
    esac
  fi
  if command -v curl >/dev/null 2>&1 && curl -sf -o /dev/null --max-time 5 "$APP_URL"; then ready=1; break; fi
  sleep 3
done
if [ "$ready" -ne 1 ]; then
  warn "等待就绪超时。最近的日志："
  docker compose logs --tail=100 >&2 || true
  rollback "升级后健康检查超时" "image"
  die "升级后服务未在预期时间内就绪，已回滚到旧镜像。"
fi
ok "服务已就绪。"

# ===========================================================================
# 步骤 6/6：升级后校验
# ===========================================================================
info "步骤 6/6：升级后校验..."

# --- 6.1 数据卷仍在 -------------------------------------------------------
VOLUME_LIST="$(docker volume ls --format '{{.Name}}' 2>/dev/null || true)"
if [ -z "$VOLUME_LIST" ]; then
  warn "无法列出数据卷（docker volume ls 无输出），跳过数据卷校验。"
else
  VOLUME_MISSING=0
  for v in postgres-data redis-data; do
    if printf '%s\n' "$VOLUME_LIST" | grep -q -- "$v"; then
      ok "数据卷仍在：$(printf '%s\n' "$VOLUME_LIST" | grep -- "$v" | tr '\n' ' ')"
    else
      err "数据卷 ${v} 不见了！"
      VOLUME_MISSING=1
    fi
  done
  if [ "$VOLUME_MISSING" = "1" ]; then
    rollback "升级后数据卷缺失" "image"
    die "升级后数据卷缺失，已回滚。请立即检查数据卷与备份。"
  fi
fi

# --- 6.2 管理员账号仍在、口令未被覆盖 -------------------------------------
ADMIN_COUNT_AFTER=''
ADMIN_HASH_AFTER=''
if [ "$ADMIN_SQL_NAME_SAFE" = "1" ]; then
  ADMIN_COUNT_AFTER="$(psql_query "SELECT count(*) FROM users WHERE username = '${ADMIN_USERNAME}' AND role = 'admin';" | tr -d '[:space:]' | head -n 1)"
  ADMIN_HASH_AFTER="$(psql_query "SELECT password_hash FROM users WHERE username = '${ADMIN_USERNAME}';" | tr -d '[:space:]' | head -n 1)"
fi

if [ "$ADMIN_SQL_NAME_SAFE" != "1" ] || [ -z "$ADMIN_COUNT_BEFORE" ]; then
  warn "无法在升级前读取管理员账号状态 —— 跳过该项校验。"
  warn "请人工确认管理员账号仍可登录。"
elif [ -z "$ADMIN_COUNT_AFTER" ]; then
  warn "升级后无法查询管理员账号 —— 跳过该项校验（可能是数据库正在迁移）。"
  warn "请人工确认管理员账号仍可登录。"
elif [ "$ADMIN_COUNT_AFTER" = "0" ]; then
  err "管理员账号 '${ADMIN_USERNAME}' 在升级后**不存在**了！"
  rollback "升级后管理员账号缺失" "image"
  die "管理员账号缺失，已回滚镜像。若账号确实丢失，可用备份恢复：./restore.sh <备份文件>"
elif [ -n "$ADMIN_HASH_BEFORE" ] && [ -n "$ADMIN_HASH_AFTER" ] && [ "$ADMIN_HASH_BEFORE" != "$ADMIN_HASH_AFTER" ]; then
  err "管理员账号 '${ADMIN_USERNAME}' 的口令哈希在升级后**发生了变化**（口令可能被改写）！"
  rollback "升级后管理员口令哈希变化" "image"
  die "管理员口令疑似被改写，已回滚镜像。口令无法通过镜像回滚恢复，请用升级前的数据库备份人工恢复：./restore.sh <备份文件>"
else
  ok "管理员账号 '${ADMIN_USERNAME}' 仍存在，且口令哈希未变（原口令仍可登录）。"
fi

# --- 6.3 .env 中的管理员口令未被本脚本改动 --------------------------------
ADMIN_PASSWORD_AFTER="$(read_env_value SEED_ADMIN_PASSWORD)"
if [ "$ADMIN_PASSWORD_BEFORE" != "$ADMIN_PASSWORD_AFTER" ]; then
  err ".env 中的 SEED_ADMIN_PASSWORD 被改动了 —— 升级中止。"
  rollback "SEED_ADMIN_PASSWORD 被改动" "image"
  die "管理员口令配置被改动，已回滚。"
else
  ok ".env 中的 SEED_ADMIN_PASSWORD 未被改动。"
fi

# ===========================================================================
# 汇总
# ===========================================================================
printf '\n%s镜像对比%s\n' "$C_BLD" "$C_RST"
printf '  升级前镜像      : %s\n' "${OLD_IMAGE:-（.env 中原本没有 V2EX_IMAGE）}"
printf '  升级前 imageId  : %s\n' "$OLD_IMAGE_ID"
printf '  升级前 digest   : %s\n' "$OLD_DIGEST"
printf '  运行中 imageId  : %s\n' "$RUNNING_IMAGE_ID"
printf '  目标镜像        : %s\n' "$TARGET_IMAGE"
printf '  升级后 imageId  : %s\n' "$NEW_IMAGE_ID"
printf '  升级后 digest   : %s\n' "$NEW_DIGEST"
if [ "$SAME_IMAGE" = "1" ]; then
  printf '  结果            : 镜像内容未变化（tag 已切换）\n'
else
  printf '  结果            : 镜像已更新\n'
fi
printf '  .env 备份       : %s\n' "$ENV_BACKUP"
printf '\n'

if [ "$ready" -eq 1 ]; then
  ok "升级完成，服务已就绪"
  printf '  访问地址: %s\n' "$APP_URL"
  printf '  备份目录: %s\n\n' "$BACKUP_DIR"
  info "如需回退数据（破坏性操作，需人工确认）：./restore.sh <备份文件>"
else
  die "升级后服务未在预期时间内就绪。"
fi
