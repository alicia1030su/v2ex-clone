#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 官方公开资产升级验收（默认 v0.0.17 → v0.0.18）
#
# 这个脚本回答的问题与候选 CI 的 verify-upgrade-v0018.sh 不同：
#   · 候选 CI：用 git tag 的历史迁移集建库，验证迁移与业务指纹；
#   · 本脚本：从 GitHub Release **匿名下载两个版本的正式部署包**，
#     用旧版官方 install.sh 真装，再用旧版包内 update.sh 升到新版官方镜像。
#
# 全程不使用 GitHub / GHCR 凭据；docker pull 能成功本身就是“公开可拉”的证据。
# 只操作脚本自己创建的实例，清理由调用方在 always 步骤执行。
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="${REPO:-alicia1030su/v2ex-clone}"
WORK="${WORK:-/tmp/official-upgrade-v0018}"
FROM_VERSION=""
TO_VERSION=""
RESULTS=""

usage() {
  cat >&2 <<'EOF'
用法：
  REPO=owner/repo WORK=/tmp/official-upgrade \
    bash scripts/release/verify-official-upgrade.sh \
      --from v0.0.17 --to v0.0.18
EOF
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM_VERSION="${2:-}"; shift 2 ;;
    --to) TO_VERSION="${2:-}"; shift 2 ;;
    --results) RESULTS="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "未知参数：$1" >&2; usage ;;
  esac
done

[ -n "$FROM_VERSION" ] && [ -n "$TO_VERSION" ] || usage
printf '%s' "$FROM_VERSION" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
  echo "非法 --from：$FROM_VERSION" >&2; exit 2;
}
printf '%s' "$TO_VERSION" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
  echo "非法 --to：$TO_VERSION" >&2; exit 2;
}
[ "$FROM_VERSION" != "$TO_VERSION" ] || { echo "升级前后版本不能相同" >&2; exit 2; }

command -v curl >/dev/null || { echo "缺少 curl" >&2; exit 2; }
command -v unzip >/dev/null || { echo "缺少 unzip" >&2; exit 2; }
command -v sha256sum >/dev/null || { echo "缺少 sha256sum" >&2; exit 2; }
command -v docker >/dev/null || { echo "缺少 docker" >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "Docker 守护进程不可用；拒绝静态核验冒充真实升级" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "缺少 Docker Compose v2" >&2; exit 2; }

mkdir -p "$WORK"
[ -n "$RESULTS" ] || RESULTS="$WORK/upgrade-results.tsv"
: > "$RESULTS"
PASS=0
FAIL=0

pass() {
  PASS=$((PASS + 1))
  printf '%s\tPASS\t%s\n' "$1" "$2" | tee -a "$RESULTS"
}
fail() {
  FAIL=$((FAIL + 1))
  printf '%s\tFAIL\t%s\n' "$1" "$2" | tee -a "$RESULTS" >&2
  exit 1
}

download_release() {
  local version="$1" dir="$2" zip base
  zip="v2ex-clone-${version}-deploy.zip"
  base="https://github.com/${REPO}/releases/download/${version}"
  mkdir -p "$dir"
  curl -fsSL --retry 3 --max-time 300 -o "$dir/$zip" "$base/$zip" \
    || fail "匿名下载 $version 安装包" "curl 失败：$base/$zip"
  curl -fsSL --retry 3 --max-time 60 -o "$dir/SHA256SUMS" "$base/SHA256SUMS" \
    || fail "匿名下载 $version SHA256SUMS" "curl 失败：$base/SHA256SUMS"
  ( cd "$dir" && sha256sum -c SHA256SUMS ) \
    || fail "$version SHA256 校验" "sha256sum -c 失败"
  unzip -q "$dir/$zip" -d "$dir/pkg" || fail "$version 解压" "unzip 失败"
  [ -f "$dir/pkg/deploy/install.sh" ] || fail "$version 包结构" "缺少 deploy/install.sh"
  chmod +x "$dir/pkg/deploy/"*.sh
  pass "匿名下载与校验 $version" "$zip / $(stat -c%s "$dir/$zip") 字节 / SHA256 匹配"
}

wait_ready() {
  local dir="$1" url i
  url="$(sed -n 's/^APP_URL=//p' "$dir/.env" | tail -1)"
  [ -n "$url" ] || url="http://localhost:3000"
  for i in $(seq 1 80); do
    if curl -fsS -o /dev/null --max-time 5 "$url/"; then
      printf '%s' "$url"
      return 0
    fi
    sleep 3
  done
  return 1
}

printf '═══ 官方公开资产升级验收 %s → %s ═══\n' "$FROM_VERSION" "$TO_VERSION"
printf '仓库：%s\n工作目录：%s\n' "$REPO" "$WORK"

FROM_DIR="$WORK/from"
TO_DIR="$WORK/to"
rm -rf "$FROM_DIR" "$TO_DIR"
download_release "$FROM_VERSION" "$FROM_DIR"
download_release "$TO_VERSION" "$TO_DIR"

TO_PKG_VERSION="$(tr -d ' \r\n' < "$TO_DIR/pkg/deploy/VERSION")"
[ "$TO_PKG_VERSION" = "${TO_VERSION#v}" ] || fail "目标包版本" "$TO_PKG_VERSION != ${TO_VERSION#v}"
TO_COMPOSE_IMAGE="$(sed -n 's/.*image: ${V2EX_IMAGE:-\([^}]*\)}.*/\1/p' "$TO_DIR/pkg/deploy/docker-compose.yml" | head -1)"
[ "$TO_COMPOSE_IMAGE" = "ghcr.io/${REPO}:${TO_VERSION}" ] \
  || fail "目标包镜像引用" "$TO_COMPOSE_IMAGE != ghcr.io/${REPO}:${TO_VERSION}"
pass "目标包元数据" "VERSION=$TO_PKG_VERSION / IMAGE=$TO_COMPOSE_IMAGE"

INSTALL_DIR="$FROM_DIR/pkg/deploy"
printf '\n--- 用 %s 官方 install.sh 安装 ---\n' "$FROM_VERSION"
set +e
( cd "$INSTALL_DIR" && ./install.sh ) >"$WORK/install.log" 2>&1
INSTALL_RC=$?
set -e
if [ "$INSTALL_RC" -ne 0 ]; then
  tail -100 "$WORK/install.log"
  docker ps -a || true
  docker logs v2ex-app --tail 80 2>&1 || true
  fail "旧版官方安装" "install.sh 退出码 $INSTALL_RC"
fi
APP_URL="$(wait_ready "$INSTALL_DIR")" || fail "旧版应用就绪" "80 次轮询内未返回 200"
pass "旧版官方安装" "$FROM_VERSION install.sh 原样执行 / $APP_URL 就绪"

POSTGRES_USER_VALUE="$(sed -n 's/^POSTGRES_USER=//p' "$INSTALL_DIR/.env" | tail -1)"
POSTGRES_DB_VALUE="$(sed -n 's/^POSTGRES_DB=//p' "$INSTALL_DIR/.env" | tail -1)"
POSTGRES_USER_VALUE="${POSTGRES_USER_VALUE:-v2ex}"
POSTGRES_DB_VALUE="${POSTGRES_DB_VALUE:-v2ex}"
PSQL() {
  ( cd "$INSTALL_DIR" && docker compose --env-file .env exec -T postgres \
      psql -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" -X -t -A -c "$1" )
}

PROBE_SQL="$WORK/probe.sql"
cat > "$PROBE_SQL" <<'SQL'
WITH candidate AS (
  SELECT n.id AS node_id, u.id AS author_id
  FROM nodes n
  CROSS JOIN users u
  WHERE n.status = 'active' AND u.username = 'admin'
  ORDER BY n.id
  LIMIT 1
), inserted AS (
  INSERT INTO topics (title, content, node_id, author_id)
  SELECT '官方公开资产升级探针主题', '升级前创建，升级后必须逐字节保留', node_id, author_id
  FROM candidate
  WHERE NOT EXISTS (
    SELECT 1 FROM topics WHERE title = '官方公开资产升级探针主题'
  )
  RETURNING id, author_id
)
INSERT INTO replies (topic_id, author_id, content, floor)
SELECT id, author_id, '官方公开资产升级探针回复', 1
FROM inserted
ON CONFLICT (topic_id, floor) DO NOTHING;

UPDATE topics
SET replies_count = 1, last_reply_at = now()
WHERE title = '官方公开资产升级探针主题';
SQL
( cd "$INSTALL_DIR" && docker compose --env-file .env exec -T postgres \
    psql -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" -X -q -v ON_ERROR_STOP=1 -f - ) \
    < "$PROBE_SQL" >"$WORK/probe.log" 2>&1 \
  || { tail -40 "$WORK/probe.log"; fail "升级前业务探针" "SQL 执行失败"; }

FINGERPRINT_SQL="$WORK/fingerprint.sql"
cat > "$FINGERPRINT_SQL" <<'SQL'
SELECT 'users|' || count(*) FROM users;
SELECT 'topics|' || count(*) FROM topics;
SELECT 'replies|' || count(*) FROM replies;
SELECT 'collections|' || count(*) FROM collections;
SELECT 'thanks|' || count(*) FROM thanks;
SELECT 'votes|' || count(*) FROM votes;
SELECT 'follows|' || count(*) FROM follows;
SELECT 'credit_ledger|' || count(*) FROM credit_ledger;
SELECT 'notifications|' || count(*) FROM notifications;
SELECT 'admin_hash|' || password_hash FROM users WHERE username = 'admin';
SELECT 'marker_topic|' || id || '|' || title || '|' || content
FROM topics WHERE title = '官方公开资产升级探针主题';
SELECT 'marker_reply|' || id || '|' || content
FROM replies WHERE content = '官方公开资产升级探针回复';
SELECT 'migrations|' || count(*) FROM drizzle.__drizzle_migrations;
SQL
fingerprint() {
  ( cd "$INSTALL_DIR" && docker compose --env-file .env exec -T postgres \
      psql -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" -X -t -A -f - ) \
      < "$FINGERPRINT_SQL" 2>/dev/null | sed '/^$/d'
}

fingerprint > "$WORK/fingerprint-before.txt"
grep -q '^marker_topic|' "$WORK/fingerprint-before.txt" || fail "升级前探针主题" "指纹中不存在"
grep -q '^marker_reply|' "$WORK/fingerprint-before.txt" || fail "升级前探针回复" "指纹中不存在"
MIGRATIONS_BEFORE="$(grep '^migrations|' "$WORK/fingerprint-before.txt" | cut -d'|' -f2)"
[ -n "$MIGRATIONS_BEFORE" ] || fail "升级前迁移记录" "读取失败"
pass "升级前业务指纹" "$(wc -l < "$WORK/fingerprint-before.txt") 行 / 迁移 $MIGRATIONS_BEFORE 条 / 探针数据已写入"

printf '\n--- 用 %s 包内 update.sh 升级到 %s ---\n' "$FROM_VERSION" "$TO_VERSION"
set +e
( cd "$INSTALL_DIR" && ./update.sh --version "$TO_VERSION" ) >"$WORK/update.log" 2>&1
UPDATE_RC=$?
set -e
if [ "$UPDATE_RC" -ne 0 ]; then
  tail -140 "$WORK/update.log"
  docker ps -a || true
  docker logs v2ex-app --tail 100 2>&1 || true
  fail "官方 update.sh 升级" "退出码 $UPDATE_RC"
fi
APP_URL_AFTER="$(wait_ready "$INSTALL_DIR")" || fail "新版应用就绪" "升级后 80 次轮询内未返回 200"
pass "官方 update.sh 升级" "退出码 0 / $APP_URL_AFTER 就绪 / 数据卷保留"

ENV_IMAGE="$(sed -n 's/^V2EX_IMAGE=//p' "$INSTALL_DIR/.env" | tail -1)"
[ "$ENV_IMAGE" = "ghcr.io/${REPO}:${TO_VERSION}" ] \
  || fail "升级后镜像引用" ".env=$ENV_IMAGE"
TARGET_IMAGE_ID="$(docker image inspect "ghcr.io/${REPO}:${TO_VERSION}" --format '{{.Id}}')"
RUNNING_IMAGE_ID="$(docker inspect --format '{{.Image}}' v2ex-app)"
[ "$RUNNING_IMAGE_ID" = "$TARGET_IMAGE_ID" ] \
  || fail "运行镜像一致性" "running=$RUNNING_IMAGE_ID target=$TARGET_IMAGE_ID"
TARGET_REPO_DIGEST="$(docker image inspect "ghcr.io/${REPO}:${TO_VERSION}" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
[ -n "$TARGET_REPO_DIGEST" ] || fail "匿名镜像 Digest" "读不到 RepoDigests"
pass "匿名目标镜像" "$ENV_IMAGE / imageId=$TARGET_IMAGE_ID / ${TARGET_REPO_DIGEST#*@}"

fingerprint > "$WORK/fingerprint-after.txt"
if diff -u "$WORK/fingerprint-before.txt" "$WORK/fingerprint-after.txt" >"$WORK/fingerprint.diff"; then
  pass "升级前后业务指纹" "$(wc -l < "$WORK/fingerprint-after.txt") 行逐字节一致"
else
  cat "$WORK/fingerprint.diff"
  fail "升级前后业务指纹" "发生变化"
fi
MIGRATIONS_AFTER="$(grep '^migrations|' "$WORK/fingerprint-after.txt" | cut -d'|' -f2)"
[ "$MIGRATIONS_AFTER" = "$MIGRATIONS_BEFORE" ] \
  || fail "迁移记录数" "升级前 $MIGRATIONS_BEFORE / 升级后 $MIGRATIONS_AFTER（本版无新增迁移，必须一致）"

BACKUP_FILE="$(find "$INSTALL_DIR/backups" -maxdepth 1 -type f -name 'v2ex-*.sql.gz' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)"
[ -n "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ] || fail "升级前备份" "未找到非空 v2ex-*.sql.gz"
gzip -t "$BACKUP_FILE" || fail "升级前备份完整性" "gzip -t 失败"
pass "升级前备份" "$(basename "$BACKUP_FILE") / $(stat -c%s "$BACKUP_FILE") 字节 / gzip 结构有效"

printf '\n═══ 汇总：PASS=%d FAIL=%d ═══\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
