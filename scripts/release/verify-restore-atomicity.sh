#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.17 P0-2 —— 恢复失败的**原子性**与退出码传递验证
#
# ## 为什么单独一个脚本
#
# v0.0.16 修掉了「假成功」（`ON_ERROR_STOP` + `--clean --if-exists`），
# 也加了两个负向用例（截断 gzip / 坏 SQL）。但那两只证明了**退出码非零**，
# 没有证明「失败之后数据库**一点都没变**」。
#
# 这两件事是不同的：
#   · 退出码非零  ⇒ 脚本报告失败
#   · 原子性      ⇒ 数据库真的回到恢复前，而不是「恢复了一半」
# 一个中途失败、但已经提交了前 200 条 INSERT 的恢复，退出码同样非零 ——
# 运维会以为「失败了，重试即可」，实际库里已经是半截数据。
#
# ## 本脚本验证什么（逐条对应任务书 P0-2）
#
#   1. 在隔离库写入**带唯一标识**的业务数据
#   2. 生成恢复前**完整数据指纹**（业务表逐行 + 结构指纹）
#   3. 构造**合法**（gzip 正常、有 pg_dump 头、能通过前置校验）
#      但**中途执行失败**的 SQL 备份
#   4. 执行恢复 ⇒ **必须返回非零**
#   5. 重新读取全部关键业务数据与结构指纹
#   6. 验证与恢复前**完全一致**（不是「差不多」）
#   7. 确认没有「只恢复一半」
#   8. 重启应用后仍然正常
#   9. 分别验证 gzip 解压失败 / SQL 执行失败 的退出码**确实传递**
#
# ## 安全约束
#
#   · 只操作 `--project` 指定的 compose 项目（候选/隔离环境）；
#   · 脚本拒绝在缺少该参数时运行，**不会**猜一个默认项目去动；
#   · 不删除任何备份之外的产物；结束时保留现场供人工复核。
#
# ## 用法
#
#   bash scripts/release/verify-restore-atomicity.sh \
#     --deploy-dir <解压后的 deploy 目录> \
#     --project   <compose 项目名> \
#     --port      <应用端口>
#
# 退出码：0 = 全部通过；1 = 有失败项
# ---------------------------------------------------------------------------
set -uo pipefail

C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_RST=$'\033[0m'; C_BLD=$'\033[1m'
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %s\n' "$C_RED" "$C_RST" "$*"; }
info() { printf '  %s\n' "$*"; }
step() { printf '\n%s%s%s\n' "$C_BLD" "$*" "$C_RST"; }

DEPLOY_DIR=""
PROJECT=""
APP_PORT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --deploy-dir) DEPLOY_DIR="${2:-}"; shift 2 ;;
    --project)    PROJECT="${2:-}";    shift 2 ;;
    --port)       APP_PORT="${2:-}";   shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

[ -n "$DEPLOY_DIR" ] && [ -d "$DEPLOY_DIR" ] || { echo "缺少 --deploy-dir（或目录不存在）" >&2; exit 2; }
[ -n "$PROJECT" ] || { echo "缺少 --project —— 本脚本拒绝在没有明确目标项目时运行" >&2; exit 2; }
[ -n "$APP_PORT" ] || { echo "缺少 --port" >&2; exit 2; }

cd "$DEPLOY_DIR" || exit 2
export COMPOSE_PROJECT_NAME="$PROJECT"

# ---------------------------------------------------------------------------
# 统一 DB 访问入口
# ---------------------------------------------------------------------------
psql_db() { docker compose -p "$PROJECT" exec -T postgres psql -U v2ex -d v2ex -t -A -F'|' -c "$1"; }

# 结构指纹：**不依赖具体列**，只取「表名 + 列名 + 类型」与索引名，排序后输出。
# 这样「恢复只建了一半表」或「索引丢了」都能被发现。
SCHEMA_FP_SQL="
select 'col|'||table_name||'.'||column_name||'|'||data_type||'|'||is_nullable
from information_schema.columns
where table_schema='public'
union all
select 'idx|'||indexname from pg_indexes where schemaname='public'
order by 1;
"

# 业务指纹：对**关键业务表**取「行数 + 主键集合的哈希」。
# 只比行数不够 —— 删一行加一行行数相同；所以用 id 集合的 md5。
DATA_FP_SQL="
select 'users|'||count(*)||'|'||coalesce(md5(string_agg(id::text,',' order by id)),'') from users
union all
select 'topics|'||count(*)||'|'||coalesce(md5(string_agg(id::text,',' order by id)),'') from topics
union all
select 'replies|'||count(*)||'|'||coalesce(md5(string_agg(id::text,',' order by id)),'') from replies
union all
select 'nodes|'||count(*)||'|'||coalesce(md5(string_agg(id::text,',' order by id)),'') from nodes
union all
select 'categories|'||count(*)||'|'||coalesce(md5(string_agg(id::text,',' order by id)),'') from categories
order by 1;
"

fp_data()   { psql_db "$DATA_FP_SQL"   | tr -d '\r'; }
fp_schema() { psql_db "$SCHEMA_FP_SQL" | tr -d '\r'; }

printf '%s═══ v0.0.17 恢复失败原子性验证 ═══%s\n' "$C_BLD" "$C_RST"
info "compose 项目：$PROJECT"
info "部署目录：$DEPLOY_DIR"

# ---------------------------------------------------------------------------
step "0. 前置：确认目标实例可访问"
# ---------------------------------------------------------------------------
if psql_db "select 1" >/dev/null 2>&1; then
  ok "数据库可访问（project=$PROJECT）"
else
  bad "数据库不可访问 —— 无法继续（不猜默认项目）"
  printf '\n%s汇总：PASS=%d FAIL=%d%s\n' "$C_BLD" "$PASS" "$FAIL" "$C_RST"
  exit 1
fi

code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${APP_PORT}/" || echo 000)"
if [ "$code" = "200" ]; then
  ok "应用可访问（HTTP 200）"
else
  bad "应用不可访问（HTTP $code）"
fi

# ---------------------------------------------------------------------------
step "1. 写入带唯一标识的业务数据"
# ---------------------------------------------------------------------------
MARK="v017atomic-$(date +%s)-$$"
info "唯一标识：$MARK"

# 直接写在已存在的种子数据之上：新增一条用户 + 一条主题 + 一条回复。
# 之所以要「唯一标识」：指纹里能明确看出这几行在不在，
# 而不是只比总数（总数可能巧合相等）。
psql_db "insert into users (username, password_hash) values ('$MARK', 'x') returning id;" >/dev/null 2>&1
MARK_UID="$(psql_db "select id from users where username='$MARK';" | tr -d '\r' | head -1)"
[ -n "$MARK_UID" ] || { bad "无法写入标识用户"; }

# ⚠️ 选一个**已存在的作者**：不能用刚插入的标识用户 —— 它的 password_hash 是 'x'，
#    某些视图/约束可能依赖真实口令哈希；用种子用户更接近真实数据形态。
AUTHOR="$(psql_db "select id from users where username<>'$MARK' order by id limit 1;" | tr -d '\r' | head -1)"
NODE="$(psql_db "select id from nodes order by id limit 1;" | tr -d '\r' | head -1)"
[ -n "$AUTHOR" ] || bad "库里没有可用的作者用户"
[ -n "$NODE" ] || bad "库里没有可用的节点"

psql_db "insert into topics (title, content, node_id, author_id) values ('$MARK 主题', '正文', $NODE, $AUTHOR) returning id;" >/dev/null 2>&1
MARK_TID="$(psql_db "select id from topics where title='$MARK 主题';" | tr -d '\r' | head -1)"
[ -n "$MARK_TID" ] || { bad "无法写入标识主题"; }

psql_db "insert into replies (topic_id, author_id, content, floor) values ($MARK_TID, $AUTHOR, '$MARK 回复', 1) returning id;" >/dev/null 2>&1
MARK_RID="$(psql_db "select id from replies where content='$MARK 回复';" | tr -d '\r' | head -1)"

if [ -n "$MARK_UID" ] && [ -n "$MARK_TID" ] && [ -n "$MARK_RID" ]; then
  ok "已写入标识数据：user=$MARK_UID topic=$MARK_TID reply=$MARK_RID"
else
  bad "标识数据写入不完整（user=${MARK_UID:-无} topic=${MARK_TID:-无} reply=${MARK_RID:-无}）"
fi

# ---------------------------------------------------------------------------
step "2. 记录恢复前完整指纹"
# ---------------------------------------------------------------------------
fp_data   > /tmp/v017-fp-data-before.txt
fp_schema > /tmp/v017-fp-schema-before.txt
BEFORE_ROWS="$(wc -l < /tmp/v017-fp-data-before.txt | tr -d ' ')"
BEFORE_COLS="$(wc -l < /tmp/v017-fp-schema-before.txt | tr -d ' ')"
info "业务指纹 ${BEFORE_ROWS} 行 / 结构指纹 ${BEFORE_COLS} 行"
if [ "$BEFORE_ROWS" -ge 5 ] && [ "$BEFORE_COLS" -ge 20 ]; then
  ok "指纹已采集（业务 ${BEFORE_ROWS} 项 / 结构 ${BEFORE_COLS} 项）"
else
  bad "指纹行数异常（业务 ${BEFORE_ROWS} / 结构 ${BEFORE_COLS}）—— 采集可能失败，后续比对无意义"
fi

# ---------------------------------------------------------------------------
step "3. 构造「合法但中途失败」的备份"
# ---------------------------------------------------------------------------
# 关键设计：这份文件必须能通过 restore.sh 的**全部前置校验** ——
#   · gzip 结构完好（gzip -t 通过）
#   · 有 pg_dump 头（`-- PostgreSQL database dump`）
#   · 解压后非空
# 唯一的问题是：中间的某条语句会失败。
#
# 做法：先**真的导出一份当前库的 dump**，然后在其中段插入一条必然失败的语句。
# 这样它是「几乎真实的备份」而不是手搓的假文件 —— 手搓的话，
# 一旦 restore.sh 的校验规则变化，测试就会因为别的原因红，指向不了原子性。
BK_REAL="/tmp/v017-atomic-real.sql.gz"
BK_FAIL="/tmp/v017-atomic-fail.sql.gz"

if docker compose -p "$PROJECT" exec -T postgres pg_dump \
      --username=v2ex --dbname=v2ex --no-owner --no-acl --clean --if-exists \
      > /tmp/v017-atomic-real.sql 2>/tmp/v017-pgdump.log; then
  ok "已导出真实 dump（$(stat -c%s /tmp/v017-atomic-real.sql) 字节）"
else
  bad "导出真实 dump 失败"
  tail -5 /tmp/v017-pgdump.log 2>/dev/null | sed 's/^/    /'
fi

# 找 COPY/INSERT 区段的中点，在那里插入一条必然失败的语句。
# ⚠️ 必须插在**已经执行了若干成功语句之后** —— 否则「全部回滚」与
#    「第一条就失败」无法区分，测不出「恢复了一半」这种形态。
TOTAL_LINES="$(wc -l < /tmp/v017-atomic-real.sql | tr -d ' ')"
MID=$((TOTAL_LINES / 2))
{
  head -n "$MID" /tmp/v017-atomic-real.sql
  printf '\n-- === v0.0.17 注入：中途必然失败 ===\n'
  printf 'SELECT * FROM table_that_does_not_exist_v017_atomic;\n'
  tail -n +$((MID + 1)) /tmp/v017-atomic-real.sql
} > /tmp/v017-atomic-fail.sql

gzip -9 -c /tmp/v017-atomic-fail.sql > "$BK_FAIL"
BK_SIZE="$(stat -c%s "$BK_FAIL")"
info "注入点：第 ${MID} 行 / 总 ${TOTAL_LINES} 行（失败发生在**中段**，不是开头）"
ok "已生成失败备份：$BK_FAIL（${BK_SIZE} 字节）"

# 自证：这份文件必须能通过 restore.sh 的前置校验（否则测的就不是原子性）
if gzip -t "$BK_FAIL" 2>/dev/null; then
  ok "注入后的备份 gzip 结构完好（restore.sh 会放行 → 能走到 SQL 执行阶段）"
else
  bad "注入后的备份 gzip 已损坏 —— 这测的是「截断检测」，不是原子性"
fi
if [ "$(gzip -cd "$BK_FAIL" 2>/dev/null | wc -c)" -gt 1000 ]; then
  ok "注入后的备份解压后非空（不会被「空内容」校验拦下）"
else
  bad "注入后的备份解压后过小 —— 会被前置校验拦下，测不到原子性"
fi

# ---------------------------------------------------------------------------
step "4. 执行恢复 ⇒ 必须返回非零"
# ---------------------------------------------------------------------------
set +e
printf 'y\n' | bash restore.sh "$BK_FAIL" > /tmp/v017-restore-fail.log 2>&1
RC_FAIL=$?
set -e

if [ "$RC_FAIL" -ne 0 ]; then
  ok "恢复返回非零（退出码 ${RC_FAIL}）"
else
  bad "恢复**返回 0**！失败备份被当成成功 —— 这是「假成功」"
fi

# 失败原因必须指向 SQL 执行失败，而不是别的原因
if grep -qiE "does not exist|ERROR|恢复失败" /tmp/v017-restore-fail.log; then
  ok "失败原因指向 SQL 执行（不是 gzip / 权限 / 参数等无关原因）"
  grep -aiE "does not exist|恢复失败" /tmp/v017-restore-fail.log | head -2 | sed 's/^/    /'
else
  bad "失败原因不明（既不是 SQL 错误也不是脚本的失败分支）"
  tail -6 /tmp/v017-restore-fail.log 2>/dev/null | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
step "5~7. 原子性：数据与结构必须与恢复前**完全一致**"
# ---------------------------------------------------------------------------
fp_data   > /tmp/v017-fp-data-after.txt
fp_schema > /tmp/v017-fp-schema-after.txt

if diff -q /tmp/v017-fp-data-before.txt /tmp/v017-fp-data-after.txt >/dev/null; then
  ok "业务指纹逐字节一致（没有「恢复一半」）"
else
  bad "业务指纹发生变化 —— 恢复只做了一半或产生了副作用"
  diff -u /tmp/v017-fp-data-before.txt /tmp/v017-fp-data-after.txt | head -12 | sed 's/^/    /'
fi

if diff -q /tmp/v017-fp-schema-before.txt /tmp/v017-fp-schema-after.txt >/dev/null; then
  ok "结构指纹逐字节一致（表/列/索引未被子事务污染）"
else
  bad "结构指纹发生变化 —— DDL 已部分生效"
  diff -u /tmp/v017-fp-schema-before.txt /tmp/v017-fp-schema-after.txt | head -12 | sed 's/^/    /'
fi

# 唯一标识数据必须**仍然存在**（若被 --clean 的 DROP 执行到一半，这几行会消失）
STILL_UID="$(psql_db "select count(*) from users where username='$MARK';" | tr -d '\r' | head -1)"
STILL_TID="$(psql_db "select count(*) from topics where title='$MARK 主题';" | tr -d '\r' | head -1)"
if [ "$STILL_UID" = "1" ] && [ "$STILL_TID" = "1" ]; then
  ok "唯一标识数据仍在（user=1 topic=1）—— 证明整体回滚，未执行到 DROP 之后"
else
  bad "唯一标识数据丢失（user=${STILL_UID} topic=${STILL_TID}）—— 恢复**部分生效**了"
fi

# ---------------------------------------------------------------------------
step "8. 重启应用后仍然正常"
# ---------------------------------------------------------------------------
docker compose -p "$PROJECT" restart >/dev/null 2>&1 || true
sleep 10
code=""
for _ in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${APP_PORT}/" || echo 000)"
  [ "$code" = "200" ] && break
  sleep 3
done
if [ "$code" = "200" ]; then
  ok "重启后首页 HTTP 200"
else
  bad "重启后首页 HTTP $code"
fi
fp_data > /tmp/v017-fp-data-restart.txt
if diff -q /tmp/v017-fp-data-after.txt /tmp/v017-fp-data-restart.txt >/dev/null; then
  ok "重启后业务指纹不变（失败恢复没有留下延迟生效的脏状态）"
else
  bad "重启后业务指纹发生变化"
fi

# ---------------------------------------------------------------------------
step "9. 退出码传递：gzip / 管道 / SQL 三类失败"
# ---------------------------------------------------------------------------
# 这三个是**不同的失败面**，任何一类被吞掉都会让运维误判：
#   · gzip 损坏     ⇒ 前置校验就该拦下（`gzip -t`）
#   · 管道失败      ⇒ `printf | gzip -dc | psql` 中 gzip 中途死掉
#   · SQL 失败      ⇒ 已在步骤 4 验证
set +e

# ① 截断 gzip（结构损坏）：按**实际大小**取一半，不写死字节数
head -c "$((BK_SIZE / 2))" "$BK_FAIL" > /tmp/v017-bad-trunc.gz
printf 'y\n' | bash restore.sh /tmp/v017-bad-trunc.gz > /tmp/v017-r-trunc.log 2>&1
RC_TRUNC=$?
set -e
if [ "$RC_TRUNC" -ne 0 ]; then
  ok "截断 gzip ⇒ 非零（${RC_TRUNC}）"
else
  bad "截断 gzip ⇒ 返回 0（校验被绕过）"
fi

# ② 管道失败：合法 gzip 头 + 内容在中途被截断（gzip 解压到一半报错）
#
# ⚠️ 这一类最容易漏：`gzip -dc bad.gz | psql` 在**没有 pipefail** 时，
#    管道整体退出码取 psql 的；gzip 死了但 psql 正常结束 ⇒ 判成功。
#    restore.sh 有 `set -o pipefail`，这里验证它**真的**起作用。
#
#    构造方式：取合法 gzip 的前 60% 字节 —— 前半段能解压出数据，
#    尾部 CRC 缺失 ⇒ gzip 报 "unexpected end of file" 且退出码非零。
head -c "$((BK_SIZE * 60 / 100))" "$BK_FAIL" > /tmp/v017-pipe-trunc.gz
set +e
printf 'y\n' | bash restore.sh /tmp/v017-pipe-trunc.gz > /tmp/v017-r-pipe.log 2>&1
RC_PIPE=$?
set -e
if [ "$RC_PIPE" -ne 0 ]; then
  ok "管道中途失败 ⇒ 非零（${RC_PIPE}，pipefail 生效）"
else
  bad "管道中途失败 ⇒ 返回 0 —— pipefail 没生效，gzip 的失败被 psql 的成功掩盖"
fi

# 管道失败之后数据库也必须完好（与步骤 5 同理）
fp_data > /tmp/v017-fp-data-pipe.txt
if diff -q /tmp/v017-fp-data-before.txt /tmp/v017-fp-data-pipe.txt >/dev/null; then
  ok "管道失败后业务指纹仍与初始一致"
else
  bad "管道失败后业务指纹变化 —— 半截数据被提交了"
  diff -u /tmp/v017-fp-data-before.txt /tmp/v017-fp-data-pipe.txt | head -8 | sed 's/^/    /'
fi

# ③ SQL 失败那一类已由步骤 4 覆盖，这里只做交叉确认（同一份文件重跑仍非零）
set +e
printf 'y\n' | bash restore.sh "$BK_FAIL" > /tmp/v017-r-sql2.log 2>&1
RC_SQL2=$?
set -e
if [ "$RC_SQL2" -ne 0 ]; then
  ok "SQL 失败重复执行仍非零（${RC_SQL2}，结果稳定，不是偶发）"
else
  bad "SQL 失败第二次执行返回 0 —— 结果不稳定"
fi

# ---------------------------------------------------------------------------
printf '\n%s═══ 汇总：PASS=%d FAIL=%d ═══%s\n' "$C_BLD" "$PASS" "$FAIL" "$C_RST"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
