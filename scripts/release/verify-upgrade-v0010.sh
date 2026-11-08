#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.10 升级验证（v0.0.4 → v0.0.10 与 v0.0.9 → v0.0.10 双基线）
#
# ## 与 v0.0.8 脚本的区别
#
# v0.0.8 的 `verify-upgrade-v008.sh` 只有**一个**基线，而且那个基线是
# 「用**当前**迁移集建库」——严格说验证的是「当前版本的迁移幂等」，
# 不是「从旧版本升级」。本轮任务书明确要求：
#
#   v0.0.9 → v0.0.10 与 v0.0.4 → v0.0.10，**双基线**
#
# 因此本脚本从 **git tag 里取出历史迁移集**建基线库：
#   · v0.0.4 基线 = `git archive v0.0.4 drizzle`（3 个迁移：0000/0001/0002）
#   · v0.0.9 基线 = `git archive v0.0.9 drizzle`（4 个迁移：+0003_v005_reports）
# 然后用**当前工作区**的迁移集跑升级。这样「升级」才是真的从旧结构开始，
# 而不是自我循环。
#
# ## 验证内容
#
#   1. 历史基线库建成，迁移 journal 行数 = 该版本真实迁移数
#   2. 灌入覆盖全部业务面的数据（用户/主题/回复/收藏/感谢/投票/积分账本/
#      通知/上传/管理员角色/节点）
#   3. 记录**只读指纹**（scripts/release/fingerprint.sql）
#   4. 原地升级（当前迁移集）
#   5. 业务指纹（data.*）**逐字节一致**；结构指纹（schema.*）按预期变化
#   6. 幂等：连跑 3 次迁移均成功
#   7. 备份 → 恢复到独立库 → 指纹一致
#
# ## 安全性
#
# - 只操作自己建的库（`v2ex_upg_v0010_*` 前缀），结束时**保留**（便于人工复核）
# - 指纹脚本是纯 SELECT；不碰任何生产库
# - 不做 git 操作（历史迁移集由调用方预先导出到 MIG_BASE_DIR）
#
# ## 用法
#
#   # 先把两个 tag 的 drizzle/ 导出到两个目录（调用方负责）
#   git archive v0.0.4 drizzle | tar -x -C /tmp/mig-v004 --strip-components=1
#   git archive v0.0.9 drizzle | tar -x -C /tmp/mig-v009 --strip-components=1
#
#   PGPASSWORD=... bash scripts/release/verify-upgrade-v0010.sh \
#     --v004-migrations /tmp/mig-v004 --v009-migrations /tmp/mig-v009
# ---------------------------------------------------------------------------
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55440}"
PGUSER="${PGUSER:-v2ex}"
PGPASSWORD="${PGPASSWORD:-v2ex_test_password_local_only}"
export PGHOST PGPORT PGUSER PGPASSWORD

V004_MIG=""
V009_MIG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --v004-migrations) V004_MIG="$2"; shift 2 ;;
    --v009-migrations) V009_MIG="$2"; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

[ -n "$V004_MIG" ] && [ -d "$V004_MIG" ] || { echo "缺少 --v004-migrations（或目录不存在）" >&2; exit 2; }
[ -n "$V009_MIG" ] && [ -d "$V009_MIG" ] || { echo "缺少 --v009-migrations（或目录不存在）" >&2; exit 2; }

C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_RST=$'\033[0m'; C_BLD=$'\033[1m'
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %s\n' "$C_RED" "$C_RST" "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '%s%s%s\n' "$C_RED" "$*" "$C_RST" >&2; exit 1; }

PSQL_BIN="psql"
PGDUMP_BIN="pg_dump"
if [ -x "/c/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/psql.exe" ]; then
  PSQL_BIN="/c/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/psql.exe"
  PGDUMP_BIN="/c/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/pg_dump.exe"
fi

# ⚠️ 在 Windows 上把多行中文 SQL 作为 `-c` 参数传给 psql 会被控制台代码页
#    转码成 GBK，服务端按 UTF8 解析直接报
#      ERROR: invalid byte sequence for encoding "UTF8": 0xc1 0xd0
#    ⇒ 凡是含中文/大量语句的 SQL，一律**写 UTF-8 文件再用 -f 执行**。
psql_q() { "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -X -t -A -c "$2"; }

psql_file() {
  local db="$1" file="$2"
  PGCLIENTENCODING=UTF8 "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$db" \
    -X -q -v ON_ERROR_STOP=1 -f "$file"
}

# 用**历史迁移集**建基线库：把 out 指向历史目录即可
migrate_with() {
  local db="$1" migdir="$2"
  local cfg
  cfg="$(mktemp --suffix=.config.ts 2>/dev/null || mktemp)"
  cat > "$cfg" <<'CFG'
import type { Config } from 'drizzle-kit';
export default {
  schema: './src/db/schema.ts',
  out: process.env.MIG_OUT!,
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  verbose: false,
  strict: false,
} satisfies Config;
CFG
  ( cd "$REPO_ROOT" && MIG_OUT="$migdir" DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${db}" \
      npx drizzle-kit migrate --config="$cfg" >/tmp/v0010-migrate-${db}.log 2>&1 )
  local rc=$?
  rm -f "$cfg"
  return $rc
}

# 当前（v0.0.10）迁移集跑在指定库上
migrate_current() {
  ( cd "$REPO_ROOT" && DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/$1" \
      npx drizzle-kit migrate >/tmp/v0010-migrate-current-$1.log 2>&1 )
}

fingerprint() {
  "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -X -t -A -F '|' \
    -f "$REPO_ROOT/scripts/release/fingerprint.sql" 2>/dev/null
}

# 业务指纹 = 只取 data.* 行（结构指纹升级后本就应当变化）
data_only() { grep '^data\.' "$1"; }

run_baseline() {
  local label="$1" migdir="$2" expect_mig="$3"
  local db="v2ex_upg_v0010_${label}"
  local restore="v2ex_upg_v0010_${label}_restore"

  printf '\n%s══ 基线 %s ══%s\n' "$C_BLD" "$label" "$C_RST"

  for d in "$db" "$restore"; do
    psql_q postgres "DROP DATABASE IF EXISTS $d" >/dev/null 2>&1
  done
  psql_q postgres "CREATE DATABASE $db" >/dev/null || die "建库失败：$db"

  if migrate_with "$db" "$migdir"; then
    local rows
    rows="$(psql_q "$db" 'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null)"
    if [ "$rows" = "$expect_mig" ]; then
      ok "基线库建成：迁移 journal = ${rows} 行（${label} 的真实迁移数）"
    else
      bad "基线库迁移 journal = ${rows}，期望 ${expect_mig}"
      return
    fi
  else
    bad "基线迁移失败（详见 /tmp/v0010-migrate-${db}.log）"
    tail -8 "/tmp/v0010-migrate-${db}.log" 2>/dev/null
    return
  fi

  # ---- 灌业务数据 ----
  if ( cd "$REPO_ROOT" && DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${db}" \
        SEED_DEMO_USERS=1 SEED_ADMIN_PASSWORD='upg-admin-123456' SEED_DEMO_PASSWORD='upg-demo-123456' \
        APP_URL='http://127.0.0.1:3210' npx tsx scripts/seed.ts >/tmp/v0010-seed-${label}.log 2>&1 ); then
    ok "种子数据灌入成功"
  else
    bad "种子数据灌入失败（详见 /tmp/v0010-seed-${label}.log）"
    tail -8 "/tmp/v0010-seed-${label}.log" 2>/dev/null
  fi

  # 覆盖「界面很难自动化、但升级必须保真」的几类业务数据
  local probe_sql
  probe_sql=$(cat <<'SQL'
-- ⚠️ 列名以**当前 schema** 为准：collections 需要 target 判别列，
--    votes 的方向列是 direction（不是 value）。早先按猜的列名写，
--    psql 报 not-null violation 后被「部分失败」分支吞掉 —— 于是探针数据
--    其实一条都没进，指纹只有 45 项。这正是「不静默当作成功」要拦住的东西。
insert into collections (user_id, target, topic_id) select 2, 'topic'::collection_target, id from topics order by id limit 2 on conflict do nothing;
insert into thanks (user_id, reply_id) select 2, id from replies order by id limit 3 on conflict do nothing;
insert into votes (user_id, topic_id, direction) select 3, id, 'up'::vote_direction from topics order by id limit 2 on conflict do nothing;
insert into follows (follower_id, following_id) values (2,3) on conflict do nothing;
-- credit_ledger 的列是 balance_before / balance_after（不是 balance）；
-- notifications 的正文列是 message，没有 payload。早先按猜的列名写会报
-- 「column "balance" does not exist」，现在已按 schema.ts 逐列核对。
-- balance 在 users 表，不在 credit_ledger；用子查询取当前余额
insert into credit_ledger (user_id, type, amount, balance_before, balance_after, idempotency_key)
  select u.id, 'daily_checkin'::ledger_entry_type, 10, u.balance, u.balance + 10, 'probe-1'
  from users u where u.username = 'admin'
  and not exists (select 1 from credit_ledger where idempotency_key='probe-1');
insert into notifications (user_id, type, message)
  select 2, 'reply'::notification_type, '升级验证探针通知'
  where not exists (select 1 from notifications where user_id=2 and type='reply');
update users set avatar = '/uploads/avatars/probe.png' where username = 'lisi';
SQL
)
  printf '%s\n' "$probe_sql" > "/tmp/v0010-probe-${label}.sql"
  if psql_file "$db" "/tmp/v0010-probe-${label}.sql" >/tmp/v0010-probe-${label}.log 2>&1; then
    ok "业务探针数据灌入（收藏/感谢/投票/关注/积分账本/通知/头像）"
  else
    # ⚠️ 探针失败**必须判红**。早先这里是「如实记录并继续」，结果是
    #    探针数据一条都没进，而后面「指纹逐字节一致」照旧全绿 ——
    #    那等于用一个空库证明了升级安全。这里改为硬失败。
    bad "业务探针数据灌入失败（详见 /tmp/v0010-probe-${label}.log）"
    head -6 "/tmp/v0010-probe-${label}.log" 2>/dev/null
  fi

  # ---- 升级前指纹 ----
  fingerprint "$db" > "/tmp/v0010-fp-${label}-before.txt"
  data_only "/tmp/v0010-fp-${label}-before.txt" > "/tmp/v0010-fp-${label}-before-data.txt"
  info "升级前业务指纹 $(wc -l < "/tmp/v0010-fp-${label}-before-data.txt") 项"

  # ---- 升级 ----
  if migrate_current "$db"; then
    ok "升级迁移执行成功（当前迁移集）"
  else
    bad "升级迁移失败（详见 /tmp/v0010-migrate-current-${db}.log）"
    tail -8 "/tmp/v0010-migrate-current-${db}.log" 2>/dev/null
  fi

  fingerprint "$db" > "/tmp/v0010-fp-${label}-after.txt"
  data_only "/tmp/v0010-fp-${label}-after.txt" > "/tmp/v0010-fp-${label}-after-data.txt"

  if diff -q "/tmp/v0010-fp-${label}-before-data.txt" "/tmp/v0010-fp-${label}-after-data.txt" >/dev/null; then
    ok "业务数据指纹升级前后**逐字节一致**（$(wc -l < "/tmp/v0010-fp-${label}-after-data.txt") 项）"
  else
    bad "业务数据指纹发生变化："
    diff "/tmp/v0010-fp-${label}-before-data.txt" "/tmp/v0010-fp-${label}-after-data.txt" | head -12
  fi

  # 结构指纹：v0.0.4 基线应新增 0003 的索引；v0.0.9 基线应无变化
  local idx_before idx_after mig_before mig_after
  idx_before="$(grep '^schema.index.count|' "/tmp/v0010-fp-${label}-before.txt" | cut -d'|' -f2)"
  idx_after="$(grep '^schema.index.count|' "/tmp/v0010-fp-${label}-after.txt" | cut -d'|' -f2)"
  mig_before="$(grep '^schema.migration.rows|' "/tmp/v0010-fp-${label}-before.txt" | cut -d'|' -f2)"
  mig_after="$(grep '^schema.migration.rows|' "/tmp/v0010-fp-${label}-after.txt" | cut -d'|' -f2)"
  info "索引数 ${idx_before} → ${idx_after}；迁移记录 ${mig_before} → ${mig_after}"
  if [ "$mig_after" = "4" ]; then
    ok "升级后迁移记录 = 4（当前迁移集已全部应用）"
  else
    bad "升级后迁移记录 = ${mig_after}，期望 4"
  fi

  # ---- 幂等 ----
  local idem=1
  for i in 1 2 3; do
    if ! migrate_current "$db"; then idem=0; bad "第 ${i} 次重跑迁移失败"; break; fi
  done
  [ "$idem" = "1" ] && ok "迁移幂等：连跑 3 次均成功"

  local fp_after_idem
  data_only <(fingerprint "$db") > /tmp/v0010-fp-idem.txt
  if diff -q "/tmp/v0010-fp-${label}-after-data.txt" /tmp/v0010-fp-idem.txt >/dev/null; then
    ok "幂等重跑后业务指纹不变"
  else
    bad "幂等重跑后业务指纹发生变化"
  fi

  # ---- 备份 / 恢复 ----
  local bk="/tmp/v0010-${label}-backup.sql"
  if PGPASSWORD="$PGPASSWORD" "$PGDUMP_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$db" \
       --no-owner --no-acl > "$bk" 2>/tmp/v0010-pgdump-${label}.log; then
    ok "备份生成（$(wc -c < "$bk") 字节）"
  else
    bad "备份生成失败"; tail -4 "/tmp/v0010-pgdump-${label}.log" 2>/dev/null; return
  fi

  psql_q postgres "CREATE DATABASE $restore" >/dev/null || die "建恢复库失败"
  if "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$restore" -X -q -v ON_ERROR_STOP=1 \
       -f "$bk" >/tmp/v0010-restore-${label}.log 2>&1; then
    fingerprint "$restore" > "/tmp/v0010-fp-${label}-restored.txt"
    if diff -q "/tmp/v0010-fp-${label}-after.txt" "/tmp/v0010-fp-${label}-restored.txt" >/dev/null; then
      ok "恢复库指纹与升级后库**完全一致**（含结构指纹）"
    else
      bad "恢复库指纹与升级后库不一致"
      diff "/tmp/v0010-fp-${label}-after.txt" "/tmp/v0010-fp-${label}-restored.txt" | head -10
    fi
  else
    bad "恢复失败（详见 /tmp/v0010-restore-${label}.log）"
    tail -6 "/tmp/v0010-restore-${label}.log" 2>/dev/null
  fi
}

printf '%s═══ v0.0.10 升级验证（双基线）═══%s\n' "$C_BLD" "$C_RST"
printf '  PG: %s:%s\n' "$PGHOST" "$PGPORT"
printf '  v0.0.4 迁移集: %s\n' "$V004_MIG"
printf '  v0.0.9 迁移集: %s\n' "$V009_MIG"

run_baseline "v004" "$V004_MIG" 3
run_baseline "v009" "$V009_MIG" 4

printf '\n%s═══ 汇总：PASS=%d FAIL=%d ═══%s\n' "$C_BLD" "$PASS" "$FAIL" "$C_RST"
[ "$FAIL" -eq 0 ] || exit 1
