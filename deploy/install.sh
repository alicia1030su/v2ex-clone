#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.1 — 一键安装脚本（Linux / macOS）
#
# 用法：
#   chmod +x install.sh && ./install.sh
#   bash install.sh
#
# 本脚本做四件事：
#   1. 校验前置条件（Docker / Compose v2 / 磁盘 / 端口）
#   2. 生成 .env（含随机口令，**已存在则不覆盖**，保证幂等）
#   3. 拉取镜像并启动容器
#   4. 等待健康检查通过，输出访问地址与管理员凭据
#
# 安全约定：
#   - 随机口令**只写入 .env**（权限 600），不写入镜像、不写入 CI 日志。
#   - 管理员口令在最后一次性提示，并同时写入 INSTALL_CREDENTIALS.txt（权限 600）。
#   - 不执行 `docker compose down -v`（那会删数据卷）。
# ---------------------------------------------------------------------------
set -euo pipefail

# --- 常量 ------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_VERSION="0.0.1"
DEFAULT_IMAGE="ghcr.io/alicia1030su/v2ex-clone:v0.0.1"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_TEMPLATE="$SCRIPT_DIR/.env.example"
CRED_FILE="$SCRIPT_DIR/INSTALL_CREDENTIALS.txt"
MIN_DISK_MB=2048
HEALTH_TIMEOUT=120

# --- 输出helpers -----------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'
  C_BLU=$'\033[34m'; C_BLD=$'\033[1m';  C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YLW=''; C_BLU=''; C_BLD=''; C_RST=''
fi

info() { printf '%s[信息]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()   { printf '%s[成功]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { printf '%s[警告]%s %s\n' "$C_YLW" "$C_RST" "$*" >&2; }
die()  { printf '%s[错误]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 步骤 0：前置条件检查
# ---------------------------------------------------------------------------

# 0.1 Docker 是否存在
if ! command -v docker >/dev/null 2>&1; then
  die "未检测到 docker 命令。
请先安装 Docker Engine 20.10+：
  - Debian / Ubuntu : https://docs.docker.com/engine/install/debian/
  - CentOS / RHEL   : https://docs.docker.com/engine/install/centos/
  - macOS (桌面版)  : https://docs.docker.com/desktop/install/mac-install/
  - Windows (桌面版): https://docs.docker.com/desktop/install/windows-install/
安装完成后重新运行本脚本。"
fi

# 0.2 Docker 守护进程是否在运行
if ! docker info >/dev/null 2>&1; then
  die "Docker 守护进程未运行或当前用户无权访问 Docker。
请先启动 Docker Desktop / dockerd，并确认当前用户已加入 docker 组（Linux）。"
fi

# 0.3 Docker Compose v2（插件形式 `docker compose`，不是旧的 `docker-compose`）
if ! docker compose version >/dev/null 2>&1; then
  die "未检测到 Docker Compose v2（docker compose version 失败）。
请安装 Compose v2：
  - Linux  : sudo apt-get install docker-compose-plugin
           或从 https://github.com/docker/compose/releases 下载
  - macOS/Windows : 随 Docker Desktop 一并安装
本脚本依赖 Compose v2 的 spec 语法与 'docker compose' 子命令，不支持旧的 docker-compose v1。"
fi
COMPOSE_VERSION="$(docker compose version --short 2>/dev/null || echo 'unknown')"
info "Docker Compose 版本：${COMPOSE_VERSION}"

# 0.4 磁盘可用空间 ≥ 2GB
check_disk_space() {
  local avail_mb=0
  if command -v df >/dev/null 2>&1; then
    # df -Pk 输出 POSIX 1KB 块，取当前目录所在分区的可用量
    avail_mb="$(df -Pk "$SCRIPT_DIR" 2>/dev/null | awk 'NR==2 {gsub(/[^0-9]/,"",$4); print int($4/1024)}' || echo 0)"
  fi
  if [ "$avail_mb" -gt 0 ] && [ "$avail_mb" -lt "$MIN_DISK_MB" ]; then
    die "磁盘可用空间不足：需要 ≥ ${MIN_DISK_MB}MB，当前约 ${avail_mb}MB。
请清理磁盘空间后重试（镜像 + 数据库大约需要 1.5GB）。"
  fi
  if [ "$avail_mb" -gt 0 ]; then
    ok "磁盘可用空间：${avail_mb}MB"
  fi
}
check_disk_space

# 0.5 端口占用检查（APP_PORT，默认 3000）
read_env_value() {
  # 从已有 .env 里读取某个键的值（仅用于探测端口，绝不打印口令）
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}
APP_PORT="$(read_env_value APP_PORT)"
APP_PORT="${APP_PORT:-3000}"
case "$APP_PORT" in
  ''|*[!0-9]*) die "APP_PORT 非法：'${APP_PORT}'（必须是 1-65535 的整数）。" ;;
esac
if [ "$APP_PORT" -lt 1 ] || [ "$APP_PORT" -gt 65535 ]; then
  die "APP_PORT 越界：${APP_PORT}（必须是 1-65535 的整数）。"
fi

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
    return 1
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}\$" && return 0
    return 1
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -E "LISTEN" | grep -Eq "[:.]${port}\$" && return 0
    return 1
  fi
  # 没有探测工具时不阻塞安装（compose up 时会给出更准确的报错）
  return 1
}

if port_in_use "$APP_PORT"; then
  die "端口 ${APP_PORT} 已被占用。
请先停止占用该端口的程序，或修改 .env 中的 APP_PORT（同时同步修改
APP_URL 与 NEXT_PUBLIC_APP_URL），然后重新运行本脚本。"
fi
ok "端口 ${APP_PORT} 可用"

# ---------------------------------------------------------------------------
# 步骤 1：准备 .env（幂等：已存在则不覆盖）
# ---------------------------------------------------------------------------

# 随机串生成：优先 openssl，其次 /dev/urandom + tr，最后才用 base64。
# 三种来源都保证是高熵随机，不含可预测成分。
gen_random_hex() {
  # $1 = 字节数（十六进制串长度为 2*$1）
  local bytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
    return 0
  fi
  if [ -r /dev/urandom ]; then
    od -An -tx1 -N "$bytes" /dev/urandom 2>/dev/null | tr -d ' \n'
    return 0
  fi
  if command -v base64 >/dev/null 2>&1; then
    head -c "$bytes" /dev/urandom 2>/dev/null | base64 | tr -dc 'A-Za-z0-9' | head -c "$((bytes * 2))"
    return 0
  fi
  die "找不到可用的随机数生成器（需要 openssl、/dev/urandom 或 base64 之一）。"
}

# --- 随机池 ---------------------------------------------------------------
# 一次生成一大块随机十六进制串，之后从中按块取下标。
# 避免每个字符都 fork 一次 openssl（20 次进程创建在慢机器上明显卡顿）。
RAND_POOL=""
rand_pool_reset() {
  RAND_POOL="$(gen_random_hex 256)"   # 512 个十六进制字符 = 64 个 8 位块
}
# rand_index <上界>：返回 [0, 上界) 内的随机整数
rand_index() {
  local bound="$1"
  local chunk
  while [ ${#RAND_POOL} -lt 8 ]; do
    RAND_POOL="${RAND_POOL}$(gen_random_hex 64)"
  done
  chunk="${RAND_POOL:0:8}"
  RAND_POOL="${RAND_POOL:8}"
  local v=$(( 16#$chunk ))
  printf '%s' $(( v % bound ))
}

# 管理员口令：≥12 位，且强制包含大写、小写、数字。
# 生成策略：先从字符集随机取位，再补上强制字符集（各一位），
# 最后 Fisher-Yates 洗牌，避免出现"固定前缀 = 大写小写数字"的弱模式。
gen_admin_password() {
  local upper='ABCDEFGHJKLMNPQRSTUVWXYZ'   # 去掉易混淆的 I O
  local lower='abcdefghijkmnopqrstuvwxyz'   # 去掉易混淆的 l
  local digits='23456789'                 # 去掉易混淆的 0 1
  local all="${upper}${lower}${digits}"
  local length=16
  local -a chars=()
  local i idx tmp

  rand_pool_reset

  # 随机位
  for (( i = 0; i < length - 3; i++ )); do
    idx="$(rand_index ${#all})"
    chars+=("${all:$idx:1}")
  done
  # 强制包含大写 / 小写 / 数字各一位
  idx="$(rand_index ${#upper})"; chars+=("${upper:$idx:1}")
  idx="$(rand_index ${#lower})"; chars+=("${lower:$idx:1}")
  idx="$(rand_index ${#digits})"; chars+=("${digits:$idx:1}")

  # Fisher-Yates 洗牌
  local n=${#chars[@]}
  for (( i = n - 1; i > 0; i-- )); do
    local j
    j="$(rand_index $(( i + 1 )))"
    tmp="${chars[i]}"
    chars[i]="${chars[j]}"
    chars[j]="$tmp"
  done

  local pw='' char
  for char in "${chars[@]}"; do
    pw="${pw}${char}"
  done
  printf '%s' "$pw"
}

# 从 .env.example 复制模板（保留注释，替换已知的占位值）
if [ ! -f "$ENV_FILE" ]; then
  [ -f "$ENV_TEMPLATE" ] || die "缺少模板文件 ${ENV_TEMPLATE}，无法生成 .env。"
  cp "$ENV_TEMPLATE" "$ENV_FILE"

  POSTGRES_PASSWORD_NEW="$(gen_random_hex 16)"   # 32 位十六进制
  REDIS_PASSWORD_NEW="$(gen_random_hex 16)"      # 32 位十六进制
  SESSION_SECRET_NEW="$(gen_random_hex 24)"      # 48 位十六进制
  ADMIN_PASSWORD_NEW="$(gen_admin_password)"     # 16 位混合

  # 用 | 做分隔符，避免密码里的 / & \ 等字符破坏 sed 替换
  set_env_value() {
    local key="$1" value="$2"
    # BSD sed 与 GNU sed 的 -i 行为不同，用临时文件做原子替换
    local tmp
    tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
    sed "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  }
  set_env_value POSTGRES_PASSWORD "$POSTGRES_PASSWORD_NEW"
  set_env_value REDIS_PASSWORD "$REDIS_PASSWORD_NEW"
  set_env_value SESSION_SECRET "$SESSION_SECRET_NEW"
  set_env_value SEED_ADMIN_PASSWORD "$ADMIN_PASSWORD_NEW"
  set_env_value V2EX_IMAGE "$DEFAULT_IMAGE"
  unset POSTGRES_PASSWORD_NEW REDIS_PASSWORD_NEW SESSION_SECRET_NEW

  chmod 600 "$ENV_FILE" 2>/dev/null || warn "无法把 .env 权限设为 600，请手动执行：chmod 600 .env"

  # 管理员凭据单独落盘（600），便于用户后续查看；明确告知路径。
  umask 077
  {
    printf '# V2EX Clone v%s 安装凭据\n' "$APP_VERSION"
    printf '# 生成时间：%s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
    printf '# 本文件含明文口令，**请妥善保管**，登录后立即在后台修改管理员密码。\n'
    printf '\n'
    printf '访问地址: %s\n' "$(read_env_value APP_URL)"
    printf '管理员用户名: %s\n' "$(read_env_value SEED_ADMIN_USERNAME)"
    printf '管理员邮箱: %s\n' "$(read_env_value SEED_ADMIN_EMAIL)"
    printf '管理员初始密码: %s\n' "$ADMIN_PASSWORD_NEW"
  } > "$CRED_FILE"
  chmod 600 "$CRED_FILE" 2>/dev/null || true
  umask 022

  ok "已生成 .env（权限 600）与随机口令"
  info "管理员凭据已写入：${CRED_FILE}（权限 600）"
else
  ok ".env 已存在，**未覆盖**（幂等）"
  ADMIN_PASSWORD_NEW=""
  info "沿用 .env 中的现有配置与口令"
fi

# 校验必需变量均已填充
require_env_value() {
  local key="$1" val
  val="$(read_env_value "$key")"
  if [ -z "$val" ]; then
    die ".env 中的 ${key} 为空。请手动填写该值（口令需满足长度要求）后重新运行本脚本。"
  fi
}
for key in POSTGRES_PASSWORD REDIS_PASSWORD SESSION_SECRET SEED_ADMIN_PASSWORD; do
  require_env_value "$key"
done

# ---------------------------------------------------------------------------
# 步骤 2：拉取镜像并启动
# ---------------------------------------------------------------------------
info "拉取镜像（首次需要下载，请耐心等待）..."
if ! docker compose pull; then
  warn "docker compose pull 失败。"
  warn "常见原因：网络无法访问 ghcr.io。可改用国内镜像源，或先手动执行："
  warn "  docker pull ${DEFAULT_IMAGE}"
  warn "拉取成功后重新运行本脚本即可。"
  die "镜像拉取失败，安装中止。"
fi
ok "镜像拉取完成"

info "启动容器..."
if ! docker compose up -d; then
  warn "docker compose up -d 失败。最近的日志："
  docker compose logs --tail=100 >&2 || true
  die "容器启动失败，安装中止。"
fi
ok "容器已启动"

# ---------------------------------------------------------------------------
# 步骤 3：等待健康检查
# ---------------------------------------------------------------------------
wait_for_health() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  local url
  url="$(read_env_value APP_URL)"
  url="${url:-http://localhost:${APP_PORT}}"

  info "等待服务就绪（最长 ${HEALTH_TIMEOUT} 秒）..."
  info "健康检查地址：${url}"
  while [ "$(date +%s)" -lt "$deadline" ]; do
    # 优先看 compose 的 health 状态；没有 health 字段时回退到 HTTP 探测
    local cid status
    cid="$(docker compose ps -q app 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
      if [ "$status" = "healthy" ]; then
        ok "容器健康检查通过"
        return 0
      fi
      case "$status" in
        exited|dead)
          warn "app 容器已退出（状态：${status}）。最近的日志："
          docker compose logs --tail=100 app >&2 || true
          return 1
          ;;
      esac
    fi

    # HTTP 兜底探测
    if command -v curl >/dev/null 2>&1; then
      if curl -sf -o /dev/null --max-time 5 "$url"; then
        ok "HTTP 探测通过：${url}"
        return 0
      fi
    elif command -v wget >/dev/null 2>&1; then
      if wget -q -T 5 -O /dev/null "$url"; then
        ok "HTTP 探测通过：${url}"
        return 0
      fi
    fi

    sleep 3
  done
  return 1
}

if ! wait_for_health; then
  warn "等待健康检查超时（${HEALTH_TIMEOUT} 秒）。最近的日志："
  docker compose logs --tail=100 >&2 || true
  die "服务未在预期时间内就绪。日志已输出在上方，可用 'docker compose logs -f app' 持续查看。"
fi

# ---------------------------------------------------------------------------
# 步骤 4：输出结果
# ---------------------------------------------------------------------------
APP_URL_FINAL="$(read_env_value APP_URL)"
APP_URL_FINAL="${APP_URL_FINAL:-http://localhost:${APP_PORT}}"

printf '\n%s%s安装完成%s\n' "$C_BLD" "$C_GRN" "$C_RST"
printf '  访问地址   : %s\n' "$APP_URL_FINAL"
printf '  管理员账号 : %s\n' "$(read_env_value SEED_ADMIN_USERNAME)"
printf '  管理员邮箱 : %s\n' "$(read_env_value SEED_ADMIN_EMAIL)"
if [ -n "$ADMIN_PASSWORD_NEW" ]; then
  printf '  管理员密码 : %s\n' "$ADMIN_PASSWORD_NEW"
fi
printf '\n'
if [ -n "$ADMIN_PASSWORD_NEW" ]; then
  printf '%s请立即登录并修改管理员密码。%s\n' "$C_YLW" "$C_RST"
  printf '凭据也已保存到：%s（权限 600，妥善保管）\n' "$CRED_FILE"
else
  printf '%s沿用已有 .env 中的管理员密码（存于 %s）。%s\n' "$C_YLW" "$CRED_FILE" "$C_RST"
fi
printf '\n常用命令（在本目录执行）：\n'
printf '  ./start.sh          启动服务\n'
printf '  ./stop.sh           停止服务（保留数据卷）\n'
printf '  ./update.sh         升级到新版本\n'
printf '  ./backup.sh         备份数据库与配置\n'
printf '  docker compose logs -f app   查看应用日志\n'
printf '\n'
