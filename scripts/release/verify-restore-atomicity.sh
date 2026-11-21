#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.20 — 一致 bundle 恢复失败原子性验证
#
# 验证目标：
#   1. 真实 backup.sh 产出一致 bundle；
#   2. 解包后把 custom dump 截断到 90%，并重算全部 SHA256；
#   3. restore.sh --yes 必须返回非零，且失败发生在 scratch DB 重放阶段；
#   4. 失败后目标数据库业务/结构指纹逐字节不变；
#   5. 截断外层 bundle、损坏内层 dump gzip 都必须被前置校验拒绝；
#   6. 重启后应用与数据库仍正常。
#
# 安全约束：只操作 --project 指定的隔离 Compose 项目；拒绝猜测默认项目。
# ---------------------------------------------------------------------------
set -uo pipefail
umask 077

C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_RST=$'\033[0m'; C_BLD=$'\033[1m'
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %s\n' "$C_RED" "$C_RST" "$*"; }
info() { printf '  %s\n' "$*"; }
step() { printf '\n%s%s%s\n' "$C_BLD" "$*" "$C_RST"; }

DEPLOY_DIR=""; PROJECT=""; APP_PORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --deploy-dir) DEPLOY_DIR="${2:-}"; shift 2 ;;
    --project)    PROJECT="${2:-}";    shift 2 ;;
    --port)       APP_PORT="${2:-}";   shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done
[ -n "$DEPLOY_DIR" ] && [ -d "$DEPLOY_DIR" ] || { echo "缺少 --deploy-dir" >&2; exit 2; }
[ -n "$PROJECT" ] || { echo "缺少 --project；拒绝猜测默认项目" >&2; exit 2; }
[ -n "$APP_PORT" ] || { echo "缺少 --port" >&2; exit 2; }

cd "$DEPLOY_DIR" || exit 2
export COMPOSE_PROJECT_NAME="$PROJECT"
psql_db() { docker compose -p "$PROJECT" exec -T postgres psql -U v2ex -d v2ex -t -A -F'|' -c "$1"; }

SCHEMA_FP_SQL="
select 'col|'||table_name||'.'||column_name||'|'||data_type||'|'||is_nullable
from information_schema.columns where table_schema='public'
union all select 'idx|'||indexname from pg_indexes where schemaname='public'
order by 1;"
DATA_FP_SQL="
select 'users|'||count(*)||'|'||coalesce(md5(string_agg(id::text,',' order by id)),'') from users
union all select 'topics|'||count(*)||'|'||coalesce(md5(string_agg(id::text,',' order by id)),'') from topics
union all select 'replies|'||count(*)||'|'||coalesce(md5(string_agg(id::text,',' order by id)),'') from replies
union all select 'nodes|'||count(*)||'|'||coalesce(md5(string_agg(id::text,',' order by id)),'') from nodes
union all select 'categories|'||count(*)||'|'||coalesce(md5(string_agg(id::text,',' order by id)),'') from categories
union all select 'reply_images|'||count(*)||'|'||coalesce(md5(string_agg(id::text,',' order by id)),'') from reply_images
order by 1;"
fp_data()   { psql_db "$DATA_FP_SQL"   | tr -d '\r'; }
fp_schema() { psql_db "$SCHEMA_FP_SQL" | tr -d '\r'; }

printf '%s═══ v0.0.20 一致 bundle 恢复失败原子性验证 ═══%s\n' "$C_BLD" "$C_RST"
info "compose 项目：$PROJECT"

step "0. 前置检查"
if psql_db "select 1" >/dev/null 2>&1; then ok "数据库可访问"; else bad "数据库不可访问"; exit 1; fi
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${APP_PORT}/" || echo 000)"
[ "$CODE" = "200" ] && ok "应用 HTTP 200" || bad "应用 HTTP $CODE"

step "1. 写入唯一标识并采集恢复前指纹"
MARK="v020atomic-$(date +%s)-$$"
psql_db "insert into users (username, password_hash) values ('$MARK', 'x') returning id;" >/dev/null 2>&1
AUTHOR="$(psql_db "select id from users where username<>'$MARK' order by id limit 1;" | tr -d '\r' | head -1)"
NODE="$(psql_db "select id from nodes order by id limit 1;" | tr -d '\r' | head -1)"
[ -n "$AUTHOR" ] && [ -n "$NODE" ] || { bad "缺少作者或节点"; exit 1; }
psql_db "insert into topics (title, content, node_id, author_id) values ('$MARK 主题', '正文', $NODE, $AUTHOR) returning id;" >/dev/null 2>&1
TID="$(psql_db "select id from topics where title='$MARK 主题';" | tr -d '\r' | head -1)"
psql_db "insert into replies (topic_id, author_id, content, floor) values ($TID, $AUTHOR, '$MARK 回复', 1) returning id;" >/dev/null 2>&1
fp_data > /tmp/v020-fp-data-before.txt
fp_schema > /tmp/v020-fp-schema-before.txt
[ "$(wc -l < /tmp/v020-fp-data-before.txt)" -ge 6 ] && ok "业务指纹已采集" || bad "业务指纹异常"
[ "$(wc -l < /tmp/v020-fp-schema-before.txt)" -ge 20 ] && ok "结构指纹已采集" || bad "结构指纹异常"

step "2. 生成真实一致 bundle"
BASE_BUNDLE="/tmp/v020-atomic-base.tar.gz"
rm -f "$BASE_BUNDLE" "$BASE_BUNDLE.sha256"
if bash backup.sh --output "$BASE_BUNDLE" >/tmp/v020-atomic-backup.log 2>&1; then
  ok "backup.sh 产出一致 bundle（$(stat -c%s "$BASE_BUNDLE") 字节）"
else
  bad "backup.sh 失败"; tail -20 /tmp/v020-atomic-backup.log; exit 1
fi
[ -s "$BASE_BUNDLE.sha256" ] && ok "外部 SHA256 sidecar 存在" || bad "缺少外部 SHA256 sidecar"

step "3. 构造合法 bundle，但 custom dump 在中途截断"
STAGE="$(mktemp -d /tmp/v020-atomic-stage.XXXXXX)"
FAIL_BUNDLE="/tmp/v020-atomic-fail.tar.gz"
rm -f "$FAIL_BUNDLE" "$FAIL_BUNDLE.sha256"
tar --no-same-owner -xzf "$BASE_BUNDLE" -C "$STAGE" || { bad "解包基础 bundle 失败"; exit 1; }
gzip -dc "$STAGE/database.dump.gz" > "$STAGE/database.dump" || { bad "解压 dump 失败"; exit 1; }
DUMP_SIZE="$(stat -c%s "$STAGE/database.dump")"
[ "$DUMP_SIZE" -gt 1024 ] || { bad "custom dump 过小，无法构造中途截断"; exit 1; }
head -c "$((DUMP_SIZE * 90 / 100))" "$STAGE/database.dump" | gzip -9 > "$STAGE/database.fail.dump.gz"
mv "$STAGE/database.fail.dump.gz" "$STAGE/database.dump.gz"
rm -f "$STAGE/database.dump"
(
  cd "$STAGE"
  sha256sum database.dump.gz uploads.tar.gz uploads-files.tsv env VERSION docker-compose.yml migration-journal.json manifest.env manifest.json > SHA256SUMS
)
tar -C "$STAGE" -czf "$FAIL_BUNDLE" .
sha256sum "$FAIL_BUNDLE" > "$FAIL_BUNDLE.sha256"
gzip -t "$FAIL_BUNDLE" || { bad "失败 bundle 外层 gzip 损坏"; exit 1; }
[ "$(gzip -cd "$FAIL_BUNDLE" | wc -c)" -gt 0 ] && ok "失败 bundle 结构完整（custom dump 截断至 90%）" || bad "失败 bundle 为空"

step "4. 执行恢复：必须非零且目标指纹不变"
set +e
bash restore.sh --yes "$FAIL_BUNDLE" >/tmp/v020-restore-fail.log 2>&1
RC_FAIL=$?
set -e
[ "$RC_FAIL" -ne 0 ] && ok "恢复返回非零（${RC_FAIL}）" || bad "失败 bundle 被当成成功"
if grep -qiE "unexpected end|pg_restore|临时数据库重放失败|恢复失败" /tmp/v020-restore-fail.log; then
  ok "失败发生在 scratch DB / pg_restore 阶段"
else
  bad "失败原因不符合预期"; tail -20 /tmp/v020-restore-fail.log
fi
fp_data > /tmp/v020-fp-data-after.txt
fp_schema > /tmp/v020-fp-schema-after.txt
diff -q /tmp/v020-fp-data-before.txt /tmp/v020-fp-data-after.txt >/dev/null && ok "业务指纹逐字节不变" || { bad "业务指纹变化"; diff -u /tmp/v020-fp-data-before.txt /tmp/v020-fp-data-after.txt | head -20; }
diff -q /tmp/v020-fp-schema-before.txt /tmp/v020-fp-schema-after.txt >/dev/null && ok "结构指纹逐字节不变" || { bad "结构指纹变化"; diff -u /tmp/v020-fp-schema-before.txt /tmp/v020-fp-schema-after.txt | head -20; }
STILL="$(psql_db "select count(*) from users where username='$MARK';" | tr -d '\r' | head -1)"
[ "$STILL" = "1" ] && ok "唯一标识数据仍在" || bad "唯一标识数据丢失"

step "5. 外层截断与内层 gzip 损坏都必须被拒绝"
TRUNC="/tmp/v020-atomic-truncated.tar.gz"
SIZE="$(stat -c%s "$FAIL_BUNDLE")"
head -c "$((SIZE / 2))" "$FAIL_BUNDLE" > "$TRUNC"
set +e
bash restore.sh --yes "$TRUNC" >/tmp/v020-r-trunc.log 2>&1
RC_TRUNC=$?
set -e
[ "$RC_TRUNC" -ne 0 ] && ok "截断外层 bundle ⇒ 非零（${RC_TRUNC}）" || bad "截断外层 bundle 被接受"

BAD_INNER_STAGE="$(mktemp -d /tmp/v020-bad-inner.XXXXXX)"
BAD_INNER="/tmp/v020-atomic-bad-inner.tar.gz"
rm -f "$BAD_INNER" "$BAD_INNER.sha256"
tar --no-same-owner -xzf "$BASE_BUNDLE" -C "$BAD_INNER_STAGE"
head -c 128 /dev/urandom > "$BAD_INNER_STAGE/database.dump.gz"
(
  cd "$BAD_INNER_STAGE"
  sha256sum database.dump.gz uploads.tar.gz uploads-files.tsv env VERSION docker-compose.yml migration-journal.json manifest.env manifest.json > SHA256SUMS
)
tar -C "$BAD_INNER_STAGE" -czf "$BAD_INNER" .
sha256sum "$BAD_INNER" > "$BAD_INNER.sha256"
set +e
bash restore.sh --yes "$BAD_INNER" >/tmp/v020-r-inner.log 2>&1
RC_INNER=$?
set -e
[ "$RC_INNER" -ne 0 ] && ok "损坏内层 dump gzip ⇒ 非零（${RC_INNER}）" || bad "损坏内层 dump 被接受"
grep -qi "gzip 结构损坏" /tmp/v020-r-inner.log && ok "内层损坏被 gzip 前置校验拦截" || bad "内层损坏未被预期校验拦截"

step "6. 重启后应用与指纹仍正常"
docker compose -p "$PROJECT" restart >/dev/null 2>&1 || true
sleep 8
CODE=""
for _ in $(seq 1 20); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${APP_PORT}/" || echo 000)"
  [ "$CODE" = "200" ] && break
  sleep 3
done
[ "$CODE" = "200" ] && ok "重启后 HTTP 200" || bad "重启后 HTTP $CODE"
fp_data > /tmp/v020-fp-data-restart.txt
diff -q /tmp/v020-fp-data-after.txt /tmp/v020-fp-data-restart.txt >/dev/null && ok "重启后业务指纹不变" || bad "重启后业务指纹变化"

printf '\n%s═══ 汇总：PASS=%d FAIL=%d ═══%s\n' "$C_BLD" "$PASS" "$FAIL" "$C_RST"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
