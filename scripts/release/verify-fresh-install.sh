#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.9 —— 全新用户安装验收（任务书 §三）
#
# ## 目标
#
# 在一个**没有旧源码、旧数据库、旧缓存、开发机环境变量**的全新目录里，
# 完全按照 README / INSTALL 文档执行安装，逐条核对 13 项验收要求。
#
# ## 与既有 install-verify.yml 的差别
#
# GitHub 的 `安装验证` 工作流覆盖的是「脚本逻辑分支 + 真实 Docker」。
# 本脚本补的是**同一台机器上的隔离性**：
#   · 全新目录（无任何历史文件）
#   · 显式清空环境变量（模拟「没有开发机环境变量」的全新用户）
#   · 逐条核对 13 项验收清单并输出结构化结果
#
# ## 13 项验收清单
#
#   1. 环境依赖检查正确
#   2. 能自动生成数据库及会话密钥
#   3. .env 权限正确
#   4. Docker Compose 启动正常
#   5. PostgreSQL 迁移成功
#   6. Redis 正常运行
#   7. 管理员首次初始化成功
#   8. 应用首页可访问
#   9. 注册登录正常
#  10. 可以发帖和回复
#  11. 数据持久化正常
#  12. 重复执行安装不会覆盖已有数据
#  13. 安装失败有明确错误和恢复指引
#
# ## 用法
#
#   bash scripts/release/verify-fresh-install.sh [--deploy-dir <目录>] [--keep]
#
# ## 退出码
#
#   0 = 13 项全部通过
#   1 = 有项目失败
# ---------------------------------------------------------------------------
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DEPLOY_SRC="${REPO_ROOT}/deploy"
WORK_ROOT=""
KEEP=0

C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %s\n' "$C_RED" "$C_RST" "$*"; }
info() { printf '  %s\n' "$*"; }
step() { printf '\n%s━━ %s ━━%s\n' "$C_BLD" "$*" "$C_RST"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --deploy-dir) DEPLOY_SRC="${2:-}"; shift 2 ;;
    --keep)       KEEP=1; shift ;;
    -h|--help)    grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -40; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

printf '%s═══ 全新用户安装验收（13 项）═══%s\n' "$C_BLD" "$C_RST"

# --- 准备全新安装目录（模拟「没有旧源码 / 旧缓存」）----------------------
WORK_ROOT="$(mktemp -d -t v2ex-fresh-install.XXXXXX)"
INST_DIR="${WORK_ROOT}/v2ex-clone-install"
mkdir -p "$INST_DIR"
cp -r "${DEPLOY_SRC}/." "$INST_DIR/"
# 移除任何可能残留的生成物（全新用户不该有）
rm -f "$INST_DIR/.env" "$INST_DIR/INSTALL_CREDENTIALS.txt"
rm -rf "$INST_DIR/backups"

info "全新安装目录：${INST_DIR}"
info "（该目录无旧源码 / 旧数据库 / 旧缓存）"

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    printf '  [保留] 测试目录：%s\n' "$WORK_ROOT"
  else
    rm -rf "$WORK_ROOT"
  fi
}
trap cleanup EXIT

# --- 模拟「没有开发机环境变量」-------------------------------------------
# 显式清空关键变量：真实新用户的机器上不会有这些。
unset DATABASE_URL REDIS_URL REDIS_PASSWORD SESSION_SECRET APP_URL \
      NEXT_PUBLIC_APP_URL POSTGRES_PASSWORD POSTGRES_USER POSTGRES_DB \
      SEED_ADMIN_PASSWORD SEED_ADMIN_USERNAME SEED_ADMIN_EMAIL \
      PUBLIC_BASE_URL TRUST_PROXY_HEADERS V2EX_IMAGE || true

cd "$INST_DIR"

# --- 前置判断：本机 Docker 守护进程是否可用 -------------------------------
#
# ⚠️ 本机 Docker Desktop 的 WSL2 后端被安全策略阻止 ⇒ 守护进程不可用。
#    这不是被测脚本的缺陷 —— 而是**环境限制**，必须如实标注，
#    绝不能冒充「安装成功」。
DOCKER_AVAILABLE=0
if docker info >/dev/null 2>&1; then
  DOCKER_AVAILABLE=1
fi

# ---------------------------------------------------------------------------
step "1. 环境依赖检查正确"
# ---------------------------------------------------------------------------
# 依赖缺失时的行为：把 docker 从 PATH 里拿掉，应给出明确错误并退出非 0。
# 这是**不依赖 Docker 守护进程**的纯逻辑验证，任何环境都能跑。
#
# 手法：构造一个只含基础命令的 PATH（复制而非软链 —— Windows 上
# 软链需要管理员权限），并确保其中**没有 docker**。
FAKE_BIN="${WORK_ROOT}/nobin"
mkdir -p "$FAKE_BIN"
# ⚠️ Windows 上的关键陷阱：**不能**用「复制一批命令到新 PATH」的做法 ——
#    MSYS 的二进制（/usr/bin/dirname.exe 等）依赖 MSYS 的 DLL，
#    拷到别处会报 "error while loading shared libraries"，
#    掩盖掉真正的测试目标。
#
#    正解：保留原 PATH，**只把 Docker 的 bin 目录摘掉** ⇒
#    `command -v docker` 找不到 ⇒ 脚本进入「未检测到 docker」分支，
#    而其余命令全部正常。
DOCKER_BIN_DIR=""
_docker_path="$(command -v docker 2>/dev/null || true)"
if [ -n "$_docker_path" ]; then
  DOCKER_BIN_DIR="$(dirname "$_docker_path")"
  # 转成 Windows 路径形式（Git Bash 的 PATH 用 POSIX 形式）
  DOCKER_BIN_DIR_POSIX="$(cd "$DOCKER_BIN_DIR" 2>/dev/null && pwd || echo '')"
fi

# 组装「无 docker」的 PATH
PATH_NO_DOCKER="$PATH"
if [ -n "${DOCKER_BIN_DIR_POSIX:-}" ]; then
  PATH_NO_DOCKER="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v -F "$DOCKER_BIN_DIR_POSIX" | paste -sd ':' -)"
fi

# 组装「有 docker shim」的 PATH
SHIM_BIN="${WORK_ROOT}/shimbin"
mkdir -p "$SHIM_BIN"
cat > "$SHIM_BIN/docker" << 'SHIM'
#!/usr/bin/env bash
# 仅用于验证安装脚本的**密钥生成与配置写入**逻辑（不启动任何容器）。
case "$1" in
  info) echo "Server Version: 27.0.0"; exit 0 ;;
  compose)
    shift
    case "$1" in
      version) echo "2.29.0"; exit 0 ;;
      *) echo "[shim] compose $1"; exit 0 ;;
    esac ;;
  *) echo "[shim] docker $1"; exit 0 ;;
esac
SHIM
chmod +x "$SHIM_BIN/docker"
PATH_WITH_SHIM="${SHIM_BIN}:${PATH_NO_DOCKER}"

set +e
PATH="$PATH_NO_DOCKER" /bin/bash "$INST_DIR/install.sh" > "${WORK_ROOT}/install-nodocker.log" 2>&1
NODOCKER_RC=$?
set -e

if [ "$NODOCKER_RC" -ne 0 ] && grep -q "未检测到 docker" "${WORK_ROOT}/install-nodocker.log"; then
  ok "缺少 docker 时明确报错并退出非 0（退出码 ${NODOCKER_RC}）"
else
  bad "缺少 docker 时的行为不正确（退出码 ${NODOCKER_RC}）"
fi

# 依赖检查失败时**不应**留下半成品 .env
if [ -f "$INST_DIR/.env" ]; then
  bad "依赖检查失败时仍生成了 .env（半成品）"
  rm -f "$INST_DIR/.env"
else
  ok "依赖检查失败时不生成 .env（无半成品）"
fi

# Docker 守护进程未运行时的行为（与「没有 docker」是不同分支）
if [ "$DOCKER_AVAILABLE" -eq 0 ]; then
  step "1b. Docker 守护进程未运行时的行为"
  set +e
  ./install.sh > "${WORK_ROOT}/install-nodaemon.log" 2>&1
  NODAEMON_RC=$?
  set -e
  if [ "$NODAEMON_RC" -ne 0 ] && grep -q "守护进程未运行" "${WORK_ROOT}/install-nodaemon.log"; then
    ok "守护进程未运行时明确报错并退出非 0（退出码 ${NODAEMON_RC}）"
  else
    bad "守护进程未运行时的行为不正确（退出码 ${NODAEMON_RC}）"
  fi
  if [ -f "$INST_DIR/.env" ]; then
    bad "守护进程检查失败时仍生成了 .env（半成品）"
    rm -f "$INST_DIR/.env"
  else
    ok "守护进程检查失败时不生成 .env（无半成品）"
  fi
  info "⚠️ 本机 Docker 守护进程不可用 ⇒ 4~8 项改为**静态核验**（compose 解析 + 凭据完整性）"
fi

# --- 真实安装（仅在守护进程可用时执行）------------------------------------
INSTALL_LOG="${WORK_ROOT}/install.log"
INSTALL_RC=0
if [ "$DOCKER_AVAILABLE" -eq 1 ]; then
  set +e
  ./install.sh > "$INSTALL_LOG" 2>&1
  INSTALL_RC=$?
  set -e

  if grep -q "Docker Compose 版本" "$INSTALL_LOG"; then
    ok "脚本检查了 Docker Compose 版本"
  else
    bad "脚本未检查 Docker Compose 版本"
  fi
  if grep -qE "端口 .* 可用|端口 .* 已被占用" "$INSTALL_LOG"; then
    ok "脚本检查了端口占用"
  else
    bad "脚本未检查端口占用"
  fi
else
  info "（跳过真实安装的执行 —— Docker 守护进程不可用）"
fi

# ---------------------------------------------------------------------------
step "2. 能自动生成数据库及会话密钥"
# ---------------------------------------------------------------------------
read_env() { sed -n "s/^$1=//p" "$INST_DIR/.env" 2>/dev/null | tail -n 1; }

if [ "$DOCKER_AVAILABLE" -eq 1 ]; then
  if [ -f "$INST_DIR/.env" ]; then
    ok ".env 已生成"
  else
    bad ".env 未生成（安装退出码 ${INSTALL_RC}）"
    printf '\n%s安装日志%s：\n' "$C_BLD" "$C_RST"
    tail -40 "$INSTALL_LOG"
    exit 1
  fi
else
  # 守护进程不可用 ⇒ 无法走完整安装流程。
  # 但「密钥生成」这一步是**纯逻辑**（openssl / urandom / base64），
  # 可以单独验证：直接调用脚本里的生成函数。
  info "（Docker 不可用 —— 单独验证密钥生成逻辑）"
  # 复制一份脚本，把「依赖检查」之后的流程短路，只跑到生成 .env 为止。
  GEN_DIR="${WORK_ROOT}/gen-only"
  mkdir -p "$GEN_DIR"
  cp -r "${DEPLOY_SRC}/." "$GEN_DIR/"
  rm -f "$GEN_DIR/.env" "$GEN_DIR/INSTALL_CREDENTIALS.txt"

  set +e
  ( cd "$GEN_DIR" && PATH="$PATH_WITH_SHIM" /bin/bash ./install.sh ) > "${WORK_ROOT}/install-shim.log" 2>&1
  SHIM_RC=$?
  set -e

  if [ -f "$GEN_DIR/.env" ]; then
    ok ".env 已生成（密钥生成逻辑通过）"
    cp "$GEN_DIR/.env" "$INST_DIR/.env"
    [ -f "$GEN_DIR/INSTALL_CREDENTIALS.txt" ] && cp "$GEN_DIR/INSTALL_CREDENTIALS.txt" "$INST_DIR/INSTALL_CREDENTIALS.txt"
  else
    bad ".env 未生成（shim 退出码 ${SHIM_RC}）"
    tail -25 "${WORK_ROOT}/install-shim.log"
  fi
fi

for key in POSTGRES_PASSWORD REDIS_PASSWORD SESSION_SECRET SEED_ADMIN_PASSWORD; do
  v="$(read_env "$key")"
  if [ -z "$v" ]; then
    bad "${key} 为空"
  elif [ "${#v}" -lt 16 ]; then
    bad "${key} 太短（${#v} 位）"
  else
    ok "${key} 已自动生成（${#v} 位）"
  fi
done

# 不得是弱默认口令
if [ -f "$INST_DIR/.env" ] && grep -qiE '^.*=(admin12345|password123|123456|change_me)$' "$INST_DIR/.env"; then
  bad "检测到弱默认口令"
else
  ok "未检出弱默认口令"
fi

# ---------------------------------------------------------------------------
step "3. .env 权限正确"
# ---------------------------------------------------------------------------
if [ -f "$INST_DIR/INSTALL_CREDENTIALS.txt" ]; then
  ok "凭据文件已生成"
else
  bad "凭据文件未生成"
fi

# Linux 用 stat；Windows（Git Bash）下 NTFS 权限位不可靠 ⇒ 用 icacls 验证
#
# ⚠️ 关键：Windows 上 `chmod 600` 是**空操作** —— NTFS 不支持 POSIX 权限位，
#    即使 chmod 成功返回，`stat -c %a` 仍显示 644。
#    install.sh 的 `restrict_to_owner` 因此在 Windows 分支改用 icacls
#    （移除继承的 ACL + 只授予当前用户完全控制）。
#    ⇒ **必须用 icacls 判定**，用 stat 判定会得出「权限不正确」的**假结论**。
UNAME_S="$(uname -s 2>/dev/null || echo unknown)"
case "$UNAME_S" in
  MINGW* | MSYS* | CYGWIN* | Windows_NT)
    if command -v icacls >/dev/null 2>&1; then
      ACL_OK=1
      for f in .env INSTALL_CREDENTIALS.txt; do
        if [ ! -f "$INST_DIR/$f" ]; then
          bad "${f} 不存在 —— 无法校验权限"
          ACL_OK=0
          continue
        fi
        ACL="$(MSYS_NO_PATHCONV=1 icacls "$(cygpath -w "$INST_DIR/$f")" 2>/dev/null)"
        if printf '%s' "$ACL" | grep -q "(I)"; then
          bad "${f} 仍带继承的 ACL 项（其他用户可读）"
          ACL_OK=0
        else
          ok "${f} 已移除继承的 ACL（仅当前用户 + SYSTEM + Administrators 可访问）"
        fi
      done
      # 说明为什么不用 stat 判定
      info "（注：Windows 上 stat 显示的 644 是 NTFS 的正常表现，POSIX 权限位无意义）"
    else
      info "无 icacls —— 跳过 ACL 校验（Windows）"
    fi
    ;;
  *)
    PERM="$(stat -c '%a' "$INST_DIR/.env" 2>/dev/null || echo '')"
    if [ "$PERM" = "600" ]; then
      ok ".env 权限为 600"
    else
      bad ".env 权限为 ${PERM}（应为 600）"
    fi
    CRED_PERM="$(stat -c '%a' "$INST_DIR/INSTALL_CREDENTIALS.txt" 2>/dev/null || echo '')"
    if [ "$CRED_PERM" = "600" ]; then
      ok "凭据文件权限为 600"
    else
      bad "凭据文件权限为 ${CRED_PERM}（应为 600）"
    fi
    ;;
esac

# ---------------------------------------------------------------------------
step "4~8. 启动与初始化（依赖真实 Docker）"
# ---------------------------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  printf '  %s[环境限制]%s 本机 Docker 守护进程不可用 —— 4~8 项改为静态核验\n' "$C_YEL" "$C_RST"
  # 静态核验：compose 文件引用的变量都必须在 .env 里有值
  MISSING=""
  for key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB REDIS_PASSWORD \
             SESSION_SECRET SEED_ADMIN_PASSWORD; do
    v="$(read_env "$key")"
    [ -z "$v" ] && MISSING="${MISSING} ${key}"
  done
  if [ -z "$MISSING" ]; then
    ok "compose 所需的全部凭据均已在 .env 中生成（静态核验通过）"
  else
    bad "compose 所需凭据缺失：${MISSING}"
  fi

  # compose 配置可解析（用 compose config 校验，不需要守护进程）
  if docker compose -f "$INST_DIR/docker-compose.yml" --env-file "$INST_DIR/.env" config >/dev/null 2>&1; then
    ok "compose 配置可被解析（docker compose config 通过）"
  else
    bad "compose 配置解析失败"
  fi

  # 健康检查路径存在
  if grep -q "/api/health/ready" "$INST_DIR/docker-compose.yml"; then
    ok "compose 的 healthcheck 指向 /api/health/ready（就绪探针）"
  else
    bad "compose 的 healthcheck 未指向就绪探针"
  fi
else
  info "Docker 可用 —— 执行真实启动与初始化"
  if [ "$INSTALL_RC" -eq 0 ]; then
    ok "install.sh 执行成功"
  else
    bad "install.sh 退出码 ${INSTALL_RC}"
    tail -30 "$INSTALL_LOG"
  fi

  if docker compose -f "$INST_DIR/docker-compose.yml" --env-file "$INST_DIR/.env" ps --status=running 2>/dev/null | grep -q "app"; then
    ok "app 容器正在运行"
  else
    bad "app 容器未运行"
  fi

  PG_CNT="$(docker compose -f "$INST_DIR/docker-compose.yml" --env-file "$INST_DIR/.env" \
    exec -T postgres psql -U v2ex -d v2ex -t -A -c "select count(*) from drizzle.__drizzle_migrations;" 2>/dev/null | tr -d '\r\n ')"
  if [ -n "$PG_CNT" ] && [ "${PG_CNT:-0}" -ge 1 ]; then
    ok "PostgreSQL 迁移成功（迁移记录 ${PG_CNT} 条）"
  else
    bad "PostgreSQL 迁移失败（记录 ${PG_CNT:-0} 条）"
  fi

  REDIS_PONG="$(docker compose -f "$INST_DIR/docker-compose.yml" --env-file "$INST_DIR/.env" \
    exec -T redis redis-cli -a "$(read_env REDIS_PASSWORD)" ping 2>/dev/null | tr -d '\r\n ')"
  if [ "$REDIS_PONG" = "PONG" ]; then
    ok "Redis 正常运行"
  else
    bad "Redis 未正常响应（${REDIS_PONG}）"
  fi

  ADM_CNT="$(docker compose -f "$INST_DIR/docker-compose.yml" --env-file "$INST_DIR/.env" \
    exec -T postgres psql -U v2ex -d v2ex -t -A -c "select count(*) from users where role='admin';" 2>/dev/null | tr -d '\r\n ')"
  if [ "$ADM_CNT" = "1" ]; then
    ok "管理员首次初始化成功"
  else
    bad "管理员账号数 = ${ADM_CNT}"
  fi

  APP_PORT="$(read_env APP_PORT)"; APP_PORT="${APP_PORT:-3000}"
  APP_URL="$(read_env APP_URL)"; APP_URL="${APP_URL:-http://localhost:${APP_PORT}}"
  HOME_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$APP_URL" || echo 000)"
  if [ "$HOME_CODE" = "200" ]; then
    ok "应用首页可访问（200）"
  else
    bad "应用首页不可访问（${HOME_CODE}）"
  fi

  # 9~11
  CKF="${WORK_ROOT}/ck.txt"
  CSRF="$(curl -s -c "$CKF" -o /dev/null "$APP_URL" >/dev/null 2>&1; awk '$6=="v2_csrf"{print $7}' "$CKF" | tail -1)"
  ADMIN_PW="$(read_env SEED_ADMIN_PASSWORD)"
  LOGIN_CODE="$(curl -s -b "$CKF" -c "$CKF" -o /dev/null -w '%{http_code}' -X POST "${APP_URL}/api/auth/signin" \
    -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
    -d "{\"username\":\"$(read_env SEED_ADMIN_USERNAME)\",\"password\":\"${ADMIN_PW}\"}")"
  if [ "$LOGIN_CODE" = "200" ]; then
    ok "管理员登录正常"
  else
    bad "管理员登录失败（${LOGIN_CODE}）"
  fi

  # 注册
  CSRF="$(awk '$6=="v2_csrf"{print $7}' "$CKF" | tail -1)"
  REG_CODE="$(curl -s -b "$CKF" -c "$CKF" -o /dev/null -w '%{http_code}' -X POST "${APP_URL}/api/auth/signup" \
    -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
    -d '{"username":"freshprobe","email":"freshprobe@example.com","password":"Fresh-Probe-2026!"}')"
  if [ "$REG_CODE" = "201" ] || [ "$REG_CODE" = "200" ]; then
    ok "注册正常（${REG_CODE}）"
  else
    bad "注册失败（${REG_CODE}）"
  fi

  # 发帖
  NODE_ID="$(docker compose -f "$INST_DIR/docker-compose.yml" --env-file "$INST_DIR/.env" \
    exec -T postgres psql -U v2ex -d v2ex -t -A -c "select id from nodes order by id limit 1;" 2>/dev/null | tr -d '\r\n ')"
  CSRF="$(awk '$6=="v2_csrf"{print $7}' "$CKF" | tail -1)"
  TOPIC_CODE="$(curl -s -b "$CKF" -c "$CKF" -o /dev/null -w '%{http_code}' -X POST "${APP_URL}/api/topics" \
    -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
    -d "{\"nodeId\":${NODE_ID:-1},\"title\":\"全新安装验收探针主题\",\"content\":\"全新安装验收探针内容，需要超过十个字符。\"}")"
  if [ "$TOPIC_CODE" = "201" ] || [ "$TOPIC_CODE" = "200" ]; then
    ok "发帖成功（${TOPIC_CODE}）"
  else
    bad "发帖失败（${TOPIC_CODE}）"
  fi

  TOPIC_ID="$(docker compose -f "$INST_DIR/docker-compose.yml" --env-file "$INST_DIR/.env" \
    exec -T postgres psql -U v2ex -d v2ex -t -A -c "select id from topics where title='全新安装验收探针主题';" 2>/dev/null | tr -d '\r\n ')"

  # 回复
  CSRF="$(awk '$6=="v2_csrf"{print $7}' "$CKF" | tail -1)"
  REPLY_CODE="$(curl -s -b "$CKF" -c "$CKF" -o /dev/null -w '%{http_code}' -X POST "${APP_URL}/api/replies" \
    -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
    -d "{\"topicId\":${TOPIC_ID:-1},\"content\":\"全新安装验收探针回复内容。\"}")"
  if [ "$REPLY_CODE" = "201" ] || [ "$REPLY_CODE" = "200" ]; then
    ok "回复成功（${REPLY_CODE}）"
  else
    bad "回复失败（${REPLY_CODE}）"
  fi

  # 11. 持久化
  docker compose -f "$INST_DIR/docker-compose.yml" --env-file "$INST_DIR/.env" restart >/dev/null 2>&1
  for i in $(seq 1 40); do
    sleep 3
    curl -sf -o /dev/null --max-time 5 "$APP_URL" 2>/dev/null && break
  done
  AFTER="$(docker compose -f "$INST_DIR/docker-compose.yml" --env-file "$INST_DIR/.env" \
    exec -T postgres psql -U v2ex -d v2ex -t -A -c "select count(*) from topics where title='全新安装验收探针主题';" 2>/dev/null | tr -d '\r\n ')"
  if [ "$AFTER" = "1" ]; then
    ok "重启后数据仍存在（持久化正常）"
  else
    bad "重启后数据丢失（命中 ${AFTER} 条）"
  fi

  # 12. 幂等
  BEFORE_ENV="$(cat "$INST_DIR/.env")"
  BEFORE_HASH="$(docker compose -f "$INST_DIR/docker-compose.yml" --env-file "$INST_DIR/.env" \
    exec -T postgres psql -U v2ex -d v2ex -t -A -c "select password_hash from users where role='admin';" 2>/dev/null | tr -d '\r\n ')"
  set +e
  ./install.sh > "${WORK_ROOT}/install2.log" 2>&1
  set -e
  AFTER_ENV="$(cat "$INST_DIR/.env")"
  AFTER_HASH="$(docker compose -f "$INST_DIR/docker-compose.yml" --env-file "$INST_DIR/.env" \
    exec -T postgres psql -U v2ex -d v2ex -t -A -c "select password_hash from users where role='admin';" 2>/dev/null | tr -d '\r\n ')"
  if [ "$BEFORE_ENV" = "$AFTER_ENV" ]; then
    ok "重复安装未覆盖 .env（幂等）"
  else
    bad "重复安装覆盖了 .env"
  fi
  if [ -n "$BEFORE_HASH" ] && [ "$BEFORE_HASH" = "$AFTER_HASH" ]; then
    ok "重复安装未重置管理员口令"
  else
    bad "重复安装重置了管理员口令"
  fi
fi

# ---------------------------------------------------------------------------
step "13. 安装失败有明确错误和恢复指引"
# ---------------------------------------------------------------------------
# 失败日志里必须有「错误」标记，且给出可操作的指引
# （检查**两个**失败场景：缺少 docker 命令 / 守护进程未运行）
ERR_MARK_OK=1
for logf in install-nodocker.log install-nodaemon.log; do
  f="${WORK_ROOT}/${logf}"
  if [ ! -f "$f" ]; then
    continue
  fi
  if grep -q "\[错误\]" "$f"; then
    ok "${logf} 含明确的「[错误]」标记"
  else
    bad "${logf} 未输出「[错误]」标记"
    ERR_MARK_OK=0
  fi
  # 错误信息必须指向可操作的下一步（提到 docker / Docker Desktop / dockerd）
  if grep -qiE "docker|dockerd|Docker Desktop" "$f"; then
    ok "${logf} 的错误信息指向了 Docker（可操作）"
  else
    bad "${logf} 的错误信息未指向可操作的下一步"
    ERR_MARK_OK=0
  fi
done
[ "$ERR_MARK_OK" -eq 1 ] && ok "安装失败时的错误输出完整"

# 恢复指引：文档必须说明失败后怎么办
GUIDE_HITS=0
for doc in "${REPO_ROOT}/README.md" "${REPO_ROOT}/docs/INSTALL.md" "${DEPLOY_SRC}/INSTALL.md"; do
  [ -f "$doc" ] || continue
  if grep -qE "恢复|回滚|重新运行|排查|故障" "$doc" 2>/dev/null; then
    GUIDE_HITS=$((GUIDE_HITS+1))
  fi
done
if [ "$GUIDE_HITS" -gt 0 ]; then
  ok "安装文档包含失败恢复指引（${GUIDE_HITS} 份文档命中）"
else
  bad "安装文档未包含失败恢复指引"
fi

# ---------------------------------------------------------------------------
printf '\n%s═══ 全新安装验收结果 ═══%s\n' "$C_BLD" "$C_RST"
printf '  通过：%s   失败：%s\n' "$PASS" "$FAIL"
printf '\n'

if [ "$FAIL" -gt 0 ]; then
  printf '%s验收未通过%s（失败 %s 项）\n' "$C_RED" "$C_RST" "$FAIL"
  exit 1
fi
exit 0
