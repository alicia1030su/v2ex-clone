#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.9 —— 候选版本隔离安装验证（任务书 §二「模式 B」后半段）
#
# ## 与 build-candidate.sh 的分工
#
#   build-candidate.sh          → 产出候选 ZIP + 镜像 tar + SHA256SUMS
#   verify-candidate-install.sh → **在独立测试环境**真正装一遍
#
# ## 验证内容（任务书 §二 模式 B 逐条对应）
#
#   1. 从候选产物目录取镜像 tar 与 ZIP
#   2. SHA256SUMS 校验（产物完整性）
#   3. 独立环境解压 ZIP
#   4. docker load 载入候选镜像
#   5. 用**候选镜像标签**运行 Compose
#   6. 验证数据库初始化（迁移成功 + 管理员已创建）
#   7. 验证 Redis 正常运行
#   8. 验证健康检查
#   9. 验证登录
#   10. 验证发帖
#   11. 验证回复
#   12. 验证重启后数据不丢失
#
# ## 状态区分（任务书 §二：三者不得混为一谈）
#
#   本脚本通过 ⇒「**候选环境安装成功**」
#   本脚本通过 **不代表**「正式公开发布成功」（那需要 GHCR 推送 + digest +
#   匿名 pull + 正式 Release + tag，且需要单独授权）。
#
# ## 用法
#
#   bash scripts/release/verify-candidate-install.sh --out <候选产物目录> \
#        [--project-name <compose 项目名>] [--keep]
#
# ## 退出码
#
#   0 = 候选环境安装验证全部通过
#   1 = 任一验证项失败
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

OUT_DIR=""
PROJECT_NAME="v2ex-cand-$$"
KEEP=0
APP_PORT="${APP_PORT:-3409}"

C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_BLU=$'\033[34m'
C_BLD=$'\033[1m'; C_RST=$'\033[0m'
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %s\n' "$C_RED" "$C_RST" "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  %s[警告]%s %s\n' "$C_YEL" "$C_RST" "$*" >&2; }
die()  { printf '%s%s%s\n' "$C_RED" "$*" "$C_RST" >&2; exit 1; }
step() { printf '\n%s━━ %s ━━%s\n' "$C_BLD" "$*" "$C_RST"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out)          OUT_DIR="${2:-}"; shift 2 ;;
    --project-name) PROJECT_NAME="${2:-}"; shift 2 ;;
    --port)         APP_PORT="${2:-}"; shift 2 ;;
    --keep)         KEEP=1; shift ;;
    -h|--help)      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -30; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[ -n "$OUT_DIR" ] || die "缺少 --out（候选产物目录）"
[ -d "$OUT_DIR" ] || die "候选产物目录不存在：${OUT_DIR}"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

command -v docker >/dev/null 2>&1 || die "未检测到 docker 命令。"
docker info >/dev/null 2>&1 || die "Docker 守护进程未运行。"
docker compose version >/dev/null 2>&1 || die "未检测到 Docker Compose v2。"

WORK="${OUT_DIR}/.verify-${PROJECT_NAME}"
rm -rf "$WORK"; mkdir -p "$WORK"

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    warn "--keep：保留测试环境 ${WORK}"
    return 0
  fi
  if [ -f "${WORK}/deploy/docker-compose.yml" ]; then
    ( cd "${WORK}/deploy" && docker compose -p "$PROJECT_NAME" down -v >/dev/null 2>&1 || true )
  fi
}
trap cleanup EXIT

printf '%s═══ 候选版本隔离安装验证（模式 B）═══%s\n' "$C_BLD" "$C_RST"
info "候选产物目录：${OUT_DIR}"
info "Compose 项目名：${PROJECT_NAME}"
info "应用端口：${APP_PORT}"

# ---------------------------------------------------------------------------
step "1. 校验候选产物完整性（SHA256SUMS）"
# ---------------------------------------------------------------------------
cd "$OUT_DIR"
if [ ! -f SHA256SUMS ]; then
  die "缺少 SHA256SUMS —— 候选产物不完整。"
fi
if sha256sum -c SHA256SUMS >/dev/null 2>&1; then
  ok "SHA256SUMS 校验通过"
  sha256sum -c SHA256SUMS | sed 's/^/    /'
else
  bad "SHA256SUMS 校验失败 —— 产物已损坏或被篡改"
  sha256sum -c SHA256SUMS 2>&1 | sed 's/^/    /'
  exit 1
fi

ZIP_FILE="$(ls v2ex-clone-*-candidate.zip 2>/dev/null | head -1 || true)"
TAR_FILE="$(ls v2ex-clone-*-candidate-image.tar 2>/dev/null | head -1 || true)"
[ -n "$ZIP_FILE" ] || die "未找到候选 ZIP。"
[ -n "$TAR_FILE" ] || die "未找到候选镜像 tar。"
ok "候选 ZIP：${ZIP_FILE}"
ok "候选镜像 tar：${TAR_FILE}"

# ---------------------------------------------------------------------------
step "2. 独立环境解压候选 ZIP"
# ---------------------------------------------------------------------------
mkdir -p "$WORK"
unzip -q "$OUT_DIR/$ZIP_FILE" -d "$WORK"
if [ -d "${WORK}/deploy" ]; then
  DEPLOY_DIR="${WORK}/deploy"
elif [ -f "${WORK}/docker-compose.yml" ]; then
  DEPLOY_DIR="$WORK"
else
  die "候选 ZIP 结构异常 —— 未找到 deploy/ 或 docker-compose.yml。"
fi
ok "解压完成：${DEPLOY_DIR}"

# 候选包内不得含生成的 .env / 凭据
if [ -f "${DEPLOY_DIR}/.env" ]; then
  bad "候选 ZIP 内含 .env —— 打包过滤失效"
  exit 1
fi
if [ -f "${DEPLOY_DIR}/INSTALL_CREDENTIALS.txt" ]; then
  bad "候选 ZIP 内含凭据文件 —— 打包过滤失效"
  exit 1
fi
ok "候选 ZIP 不含 .env / 凭据文件"

# 候选包引用的镜像标签（必须与镜像 tar 里的一致）
# 从 compose 的 `${V2EX_IMAGE:-<默认镜像>}` 里取默认镜像标签。
#
# ⚠️ 两个实测踩过的坑：
#
#   1. 字符类里的 `-` 必须放在**末尾**（或转义为 `\-`）——
#      `[A-Za-z0-9._\-/]` 里的 `\-/` 会被 grep 解析成「从 \ 到 / 的范围」，
#      报 `grep: Invalid range end` 并以退出码 2 中断整个脚本。
#
#   2. **不能**用宽松的 `[A-Za-z0-9._/-]+:v?...` 去全文件匹配 ——
#      compose 里写的是 `${V2EX_IMAGE:-v2ex-clone-candidate:v0.0.9}`，
#      宽松匹配会把 `:-` 里的那个 `-` 也吃进去 ⇒ 提取出
#      `-v2ex-clone-candidate:v0.0.9`（**多了前导连字符**）⇒
#      后面 `docker image inspect` 找不到该镜像。
#      ⇒ 必须**锚定** `V2EX_IMAGE:-` 这个语法，再截到 `}` 为止。
CAND_TAG="$(grep -oE 'V2EX_IMAGE:-[^}]+' "${DEPLOY_DIR}/docker-compose.yml" \
  | head -1 | sed 's/^V2EX_IMAGE:-//')"

# 兜底：若 compose 里没有该语法（不同版本的载体格式），回退到宽松匹配
# 并**去掉可能的前导连字符**。
if [ -z "$CAND_TAG" ]; then
  CAND_TAG="$(grep -oE '[A-Za-z0-9._/-]+:v?[0-9]+\.[0-9]+\.[0-9]+' "${DEPLOY_DIR}/docker-compose.yml" \
    | head -1 | sed 's/^-//')"
fi
if [ -z "$CAND_TAG" ]; then
  die "无法从候选 compose 中解析出镜像标签。"
fi
ok "候选包镜像标签：${CAND_TAG}"

# ---------------------------------------------------------------------------
step "3. docker load 载入候选镜像"
# ---------------------------------------------------------------------------
if docker image inspect "$CAND_TAG" >/dev/null 2>&1; then
  warn "本机已存在镜像 ${CAND_TAG} —— 为保证验证真实，先移除"
  docker image rm -f "$CAND_TAG" >/dev/null 2>&1 || true
fi
if docker load -i "$OUT_DIR/$TAR_FILE" >/dev/null 2>&1; then
  ok "候选镜像载入成功"
else
  bad "docker load 失败"
  exit 1
fi
if docker image inspect "$CAND_TAG" >/dev/null 2>&1; then
  ok "镜像 ${CAND_TAG} 可用"
else
  bad "载入后仍找不到镜像 ${CAND_TAG}"
  docker images | head -10
  exit 1
fi

# 镜像 digest / ID 记录（供审计追溯）
LOADED_ID="$(docker image inspect --format '{{.Id}}' "$CAND_TAG")"
info "  载入后镜像 ID：${LOADED_ID}"

# ---------------------------------------------------------------------------
step "4. 生成候选环境配置并启动 Compose"
# ---------------------------------------------------------------------------
cd "$DEPLOY_DIR"
chmod +x ./*.sh 2>/dev/null || true

# 用候选镜像标签 + 独立端口启动；口令随机生成且不打印明文。
# 注意：**不**使用 install.sh 的默认值覆盖逻辑 —— 这里显式写死候选标签，
# 保证「跑的就是候选包里的那个镜像」。
PG_PW="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
RD_PW="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
SES="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
ADM_PW="Cand-Admin-${PG_PW:0:8}"

export POSTGRES_USER=v2ex
export POSTGRES_PASSWORD="$PG_PW"
export POSTGRES_DB=v2ex
export REDIS_PASSWORD="$RD_PW"
export SESSION_SECRET="$SES"
export SEED_ADMIN_USERNAME=admin
export SEED_ADMIN_EMAIL=admin@candidate.local
export SEED_ADMIN_PASSWORD="$ADM_PW"
export APP_URL="http://localhost:${APP_PORT}"
export NEXT_PUBLIC_APP_URL="http://localhost:${APP_PORT}"
export APP_PORT
export V2EX_IMAGE="$CAND_TAG"
export SEED_DEMO_USERS=0
export TRUST_PROXY_HEADERS=0

if ! docker compose -p "$PROJECT_NAME" up -d >/dev/null 2>&1; then
  bad "docker compose up 失败"
  docker compose -p "$PROJECT_NAME" logs --tail=80 2>&1 | sed 's/^/    /'
  exit 1
fi
ok "Compose 已启动（候选镜像 ${CAND_TAG}）"

# ---------------------------------------------------------------------------
step "5. 等待健康检查通过"
# ---------------------------------------------------------------------------
HEALTHY=0
for i in $(seq 1 60); do
  H="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "${PROJECT_NAME}-app-1" 2>/dev/null || echo none)"
  if [ "$H" = "healthy" ]; then HEALTHY=1; break; fi
  if [ "$H" = "exited" ] || [ "$H" = "dead" ]; then
    bad "app 容器退出（${H}）"
    docker compose -p "$PROJECT_NAME" logs --tail=80 app 2>&1 | sed 's/^/    /'
    exit 1
  fi
  sleep 3
done
[ "$HEALTHY" -eq 1 ] && ok "容器健康检查通过（healthy）" || { bad "健康检查未通过"; docker compose -p "$PROJECT_NAME" logs --tail=80 2>&1 | sed 's/^/    /'; exit 1; }

# 就绪探针
READY_CODE="$(curl -s -o /tmp/v009-ready.json -w '%{http_code}' "http://localhost:${APP_PORT}/api/health/ready" || echo 000)"
if [ "$READY_CODE" = "200" ]; then
  ok "就绪探针 200：$(cat /tmp/v009-ready.json)"
else
  bad "就绪探针返回 ${READY_CODE}"
  exit 1
fi

# ---------------------------------------------------------------------------
step "6. 验证数据库初始化（迁移 + 管理员）"
# ---------------------------------------------------------------------------
MIG_COUNT="$(docker compose -p "$PROJECT_NAME" exec -T postgres \
  psql -U v2ex -d v2ex -t -A -c "select count(*) from drizzle.__drizzle_migrations;" 2>/dev/null | tr -d '\r\n ')"
if [ -n "$MIG_COUNT" ] && [ "$MIG_COUNT" -ge 1 ]; then
  ok "迁移记录数 = ${MIG_COUNT}"
else
  bad "迁移记录缺失或异常（${MIG_COUNT}）"
  exit 1
fi

ADM_COUNT="$(docker compose -p "$PROJECT_NAME" exec -T postgres \
  psql -U v2ex -d v2ex -t -A -c "select count(*) from users where username='admin' and role='admin';" 2>/dev/null | tr -d '\r\n ')"
if [ "$ADM_COUNT" = "1" ]; then
  ok "管理员首次初始化成功"
else
  bad "管理员账号数 = ${ADM_COUNT}（应为 1）"
  exit 1
fi

# 管理员口令哈希不得为空
HASH_LEN="$(docker compose -p "$PROJECT_NAME" exec -T postgres \
  psql -U v2ex -d v2ex -t -A -c "select length(password_hash) from users where username='admin';" 2>/dev/null | tr -d '\r\n ')"
if [ -n "$HASH_LEN" ] && [ "$HASH_LEN" -ge 20 ]; then
  ok "管理员口令已哈希（长度 ${HASH_LEN}）"
else
  bad "管理员口令哈希异常（长度 ${HASH_LEN}）"
  exit 1
fi

# ---------------------------------------------------------------------------
step "7. 验证 Redis 正常运行"
# ---------------------------------------------------------------------------
REDIS_PONG="$(docker compose -p "$PROJECT_NAME" exec -T redis \
  redis-cli -a "$RD_PW" ping 2>/dev/null | tr -d '\r\n ' || echo '')"
if [ "$REDIS_PONG" = "PONG" ]; then
  ok "Redis PING = PONG"
else
  bad "Redis 未正常响应（${REDIS_PONG}）"
  exit 1
fi
REDIS_INFO="$(docker compose -p "$PROJECT_NAME" exec -T redis \
  redis-cli -a "$RD_PW" dbsize 2>/dev/null | tr -d '\r\n ' || echo '')"
ok "Redis dbsize = ${REDIS_INFO}"

# ---------------------------------------------------------------------------
step "8. 验证登录（管理员真实登录）"
# ---------------------------------------------------------------------------
CK="/tmp/v009-ck-$$.txt"
rm -f "$CK"
CSRF="$(curl -s -c "$CK" -o /dev/null "http://localhost:${APP_PORT}/" >/dev/null 2>&1; \
        awk '$6=="v2_csrf"{print $7}' "$CK" 2>/dev/null | tail -1)"
if [ -z "$CSRF" ]; then
  bad "未取得 CSRF 令牌"
  exit 1
fi
LOGIN_CODE="$(curl -s -b "$CK" -c "$CK" -o /tmp/v009-login.json -w '%{http_code}' \
  -X POST "http://localhost:${APP_PORT}/api/auth/signin" \
  -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
  -d "{\"username\":\"admin\",\"password\":\"${ADM_PW}\"}")"
if [ "$LOGIN_CODE" = "200" ]; then
  ok "管理员登录成功（HTTP 200）"
else
  bad "管理员登录失败（HTTP ${LOGIN_CODE}）：$(head -c 300 /tmp/v009-login.json)"
  exit 1
fi

# ---------------------------------------------------------------------------
step "9. 验证发帖"
# ---------------------------------------------------------------------------
NODE_ID="$(docker compose -p "$PROJECT_NAME" exec -T postgres \
  psql -U v2ex -d v2ex -t -A -c "select id from nodes order by id limit 1;" 2>/dev/null | tr -d '\r\n ')"
if [ -z "$NODE_ID" ]; then
  bad "无可用节点 —— 发帖无法验证"
  exit 1
fi
CSRF="$(awk '$6=="v2_csrf"{print $7}' "$CK" 2>/dev/null | tail -1)"
TOPIC_TITLE="候选安装验证主题 $$"
TOPIC_CODE="$(curl -s -b "$CK" -c "$CK" -o /tmp/v009-topic.json -w '%{http_code}' \
  -X POST "http://localhost:${APP_PORT}/api/topics" \
  -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
  -d "{\"nodeId\":${NODE_ID},\"title\":\"${TOPIC_TITLE}\",\"content\":\"候选安装验证内容\"}")"
if [ "$TOPIC_CODE" = "201" ] || [ "$TOPIC_CODE" = "200" ]; then
  ok "发帖成功（HTTP ${TOPIC_CODE}）"
else
  bad "发帖失败（HTTP ${TOPIC_CODE}）：$(head -c 300 /tmp/v009-topic.json)"
  exit 1
fi
TOPIC_ID="$(head -c 500 /tmp/v009-topic.json | grep -oE '"id"[[:space:]]*:[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+' || true)"
if [ -z "$TOPIC_ID" ]; then
  TOPIC_ID="$(docker compose -p "$PROJECT_NAME" exec -T postgres \
    psql -U v2ex -d v2ex -t -A -c "select id from topics where title='${TOPIC_TITLE}';" 2>/dev/null | tr -d '\r\n ')"
fi
DB_TOPIC="$(docker compose -p "$PROJECT_NAME" exec -T postgres \
  psql -U v2ex -d v2ex -t -A -c "select count(*) from topics where title='${TOPIC_TITLE}';" 2>/dev/null | tr -d '\r\n ')"
if [ "$DB_TOPIC" = "1" ]; then
  ok "主题已真实落库（topics 表命中 1 条，id=${TOPIC_ID}）"
else
  bad "主题未落库（命中 ${DB_TOPIC} 条）"
  exit 1
fi

# ---------------------------------------------------------------------------
step "10. 验证回复"
# ---------------------------------------------------------------------------
CSRF="$(awk '$6=="v2_csrf"{print $7}' "$CK" 2>/dev/null | tail -1)"
REPLY_CODE="$(curl -s -b "$CK" -c "$CK" -o /tmp/v009-reply.json -w '%{http_code}' \
  -X POST "http://localhost:${APP_PORT}/api/replies" \
  -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
  -d "{\"topicId\":${TOPIC_ID},\"content\":\"候选安装验证回复\"}")"
if [ "$REPLY_CODE" = "201" ] || [ "$REPLY_CODE" = "200" ]; then
  ok "回复成功（HTTP ${REPLY_CODE}）"
else
  bad "回复失败（HTTP ${REPLY_CODE}）：$(head -c 300 /tmp/v009-reply.json)"
  exit 1
fi
DB_REPLY="$(docker compose -p "$PROJECT_NAME" exec -T postgres \
  psql -U v2ex -d v2ex -t -A -c "select count(*) from replies where topic_id=${TOPIC_ID};" 2>/dev/null | tr -d '\r\n ')"
if [ "$DB_REPLY" -ge 1 ] 2>/dev/null; then
  ok "回复已真实落库（${DB_REPLY} 条）"
else
  bad "回复未落库（${DB_REPLY} 条）"
  exit 1
fi

# ---------------------------------------------------------------------------
step "11. 验证重启后数据不丢失"
# ---------------------------------------------------------------------------
HASH_BEFORE="$(docker compose -p "$PROJECT_NAME" exec -T postgres \
  psql -U v2ex -d v2ex -t -A -c "select password_hash from users where username='admin';" 2>/dev/null | tr -d '\r\n ')"
docker compose -p "$PROJECT_NAME" restart >/dev/null 2>&1
READY_CODE="000"
for i in $(seq 1 40); do
  sleep 3
  READY_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${APP_PORT}/api/health/ready" || echo 000)"
  [ "$READY_CODE" = "200" ] && break
done
if [ "$READY_CODE" = "200" ]; then
  ok "重启后服务恢复就绪"
else
  bad "重启后未就绪（${READY_CODE}）"
  docker compose -p "$PROJECT_NAME" logs --tail=60 2>&1 | sed 's/^/    /'
  exit 1
fi
DB_TOPIC2="$(docker compose -p "$PROJECT_NAME" exec -T postgres \
  psql -U v2ex -d v2ex -t -A -c "select count(*) from topics where title='${TOPIC_TITLE}';" 2>/dev/null | tr -d '\r\n ')"
DB_REPLY2="$(docker compose -p "$PROJECT_NAME" exec -T postgres \
  psql -U v2ex -d v2ex -t -A -c "select count(*) from replies where topic_id=${TOPIC_ID};" 2>/dev/null | tr -d '\r\n ')"
HASH_AFTER="$(docker compose -p "$PROJECT_NAME" exec -T postgres \
  psql -U v2ex -d v2ex -t -A -c "select password_hash from users where username='admin';" 2>/dev/null | tr -d '\r\n ')"
if [ "$DB_TOPIC2" = "1" ] && [ "$DB_REPLY2" -ge 1 ] 2>/dev/null; then
  ok "重启后主题与回复均保留（主题 ${DB_TOPIC2} / 回复 ${DB_REPLY2}）"
else
  bad "重启后数据丢失（主题 ${DB_TOPIC2} / 回复 ${DB_REPLY2}）"
  exit 1
fi
if [ -n "$HASH_BEFORE" ] && [ "$HASH_BEFORE" = "$HASH_AFTER" ]; then
  ok "重启后管理员口令哈希未变"
else
  bad "重启后管理员口令哈希被改动"
  exit 1
fi

# ---------------------------------------------------------------------------
step "12. 验证数据库与 Redis 端口未暴露到宿主机"
# ---------------------------------------------------------------------------
for target in "5432 PostgreSQL" "6379 Redis"; do
  PORT_N="${target%% *}"; NAME="${target##* }"
  if timeout 5 bash -c "cat < /dev/null > /dev/tcp/127.0.0.1/$PORT_N" 2>/dev/null; then
    bad "${NAME} 端口 ${PORT_N} 可从宿主机直连"
    exit 1
  else
    ok "${NAME} 端口 ${PORT_N} 未暴露"
  fi
done

# ---------------------------------------------------------------------------
printf '\n%s═══ 候选环境安装验证结果 ═══%s\n' "$C_BLD" "$C_RST"
printf '  通过：%s   失败：%s\n' "$PASS" "$FAIL"
printf '\n%s状态说明%s：\n' "$C_BLD" "$C_RST"
printf '  ✅ **候选构建成功**     —— 候选 ZIP / 镜像 tar / SHA256SUMS 已产出且校验通过\n'
printf '  ✅ **候选环境安装成功** —— 本次验证通过（docker load → compose → 全流程 → 重启不丢数据）\n'
printf '  ⬜ **正式公开发布成功** —— **本轮未执行**（需 GHCR 推送 + digest 核验 +\n'
printf '                          匿名 pull 验证 + 正式 Release + Tag，且需单独授权）\n'
printf '\n'

if [ "$FAIL" -gt 0 ]; then
  printf '%s候选环境安装验证未通过%s（失败 %s 项）\n' "$C_RED" "$C_RST" "$FAIL"
  exit 1
fi
exit 0
