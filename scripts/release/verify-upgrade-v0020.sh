#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.20 升级验证（v0.0.4 → v0.0.20 与 v0.0.19 → v0.0.20 双基线）
#
# ## 与 v0.0.8 脚本的区别
#
# v0.0.8 的 `verify-upgrade-v008.sh` 只有**一个**基线，而且那个基线是
# 「用**当前**迁移集建库」——严格说验证的是「当前版本的迁移幂等」，
# 不是「从旧版本升级」。本轮任务书明确要求：
#
#   v0.0.19 → v0.0.20 与 v0.0.4 → v0.0.20，**双基线**
#
# 因此本脚本从 **git tag 里取出历史迁移集**建基线库：
#   · v0.0.4 基线 = `git archive v0.0.4 drizzle`（3 个迁移：0000/0001/0002）
#   · v0.0.19 基线 = `git archive v0.0.19 drizzle`（5 个迁移）
# 然后用**当前工作区**的 6 个迁移跑升级。这样「升级」才是真的从旧结构开始，
# 而不是自我循环。
#
# ## 验证内容
#
#   1. 历史基线库建成，迁移 journal 行数 = 该版本真实迁移数
#   2. v0.0.19/v0.0.20 累计新列/新表存在，历史回复父关联与幂等键保持 NULL
#   3. 灌入覆盖全部业务面的数据（用户/主题/回复/收藏/感谢/投票/积分账本/
#      通知/上传/管理员角色/节点）
#   4. 记录**只读指纹**（scripts/release/fingerprint.sql）
#   5. 原地升级（当前迁移集）
#   6. 业务指纹（data.*）**逐字节一致**；结构指纹（schema.*）按预期变化
#   7. 幂等：连跑 3 次迁移均成功
#   8. 备份 → 恢复到独立库 → 指纹一致
#
# ## v0.0.20 的结构变化（必须真实验证）
#
# 本版新增 `0006_v020_attachment_lifecycle.sql`：附件状态机、当前引用表与
# 延迟 purge 队列。升级断言同时证明：
#   · 新结构已建；
#   · v0.0.19 历史回复图片按严格 Markdown 引用保守回填为 active；
#   · 原有业务指纹逐字节不变。
#
# ## 安全性
#
# - 只操作自己建的库（`v2ex_upg_v0020_*` 前缀），结束时**保留**（便于人工复核）
# - 指纹脚本是纯 SELECT；不碰任何生产库
# - 不做 git 操作（历史迁移集由调用方预先导出到 MIG_BASE_DIR）
#
# ## 用法
#
#   # 先把两个 tag 的 drizzle/ 导出到两个目录（调用方负责）
#   git archive v0.0.4 drizzle | tar -x -C /tmp/mig-v004 --strip-components=1
#   git archive v0.0.19 drizzle | tar -x -C /tmp/mig-v019 --strip-components=1
#
#   PGPASSWORD=... bash scripts/release/verify-upgrade-v0020.sh \
#     --v004-migrations /tmp/mig-v004 --v019-migrations /tmp/mig-v019
# ---------------------------------------------------------------------------
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55440}"
PGUSER="${PGUSER:-v2ex}"
PGPASSWORD="${PGPASSWORD:-}"
export PGHOST PGPORT PGUSER PGPASSWORD
[ -n "$PGPASSWORD" ] || { echo "必须显式提供 PGPASSWORD（升级验证不内置数据库口令）" >&2; exit 2; }

V004_MIG=""
V019_MIG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --v004-migrations) V004_MIG="$2"; shift 2 ;;
    --v019-migrations) V019_MIG="$2"; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

[ -n "$V004_MIG" ] && [ -d "$V004_MIG" ] || { echo "缺少 --v004-migrations（或目录不存在）" >&2; exit 2; }
[ -n "$V019_MIG" ] && [ -d "$V019_MIG" ] || { echo "缺少 --v019-migrations（或目录不存在）" >&2; exit 2; }

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
      npx drizzle-kit migrate --config="$cfg" >/tmp/v0020-migrate-${db}.log 2>&1 )
  local rc=$?
  rm -f "$cfg"
  return $rc
}

# 当前（v0.0.20）迁移集跑在指定库上
migrate_current() {
  ( cd "$REPO_ROOT" && DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/$1" \
      npx drizzle-kit migrate >/tmp/v0020-migrate-current-$1.log 2>&1 )
}

fingerprint() {
  "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -X -t -A -F '|' \
    -f "$REPO_ROOT/scripts/release/fingerprint.sql" 2>/dev/null
}

# 业务指纹 = 只取 data.* 行（结构指纹升级后本就应当变化）
data_only() { grep '^data\.' "$1"; }

run_baseline() {
  local label="$1" migdir="$2" expect_mig="$3"
  local db="v2ex_upg_v0020_${label}"
  local restore="v2ex_upg_v0020_${label}_restore"

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
    bad "基线迁移失败（详见 /tmp/v0020-migrate-${db}.log）"
    tail -8 "/tmp/v0020-migrate-${db}.log" 2>/dev/null
    return
  fi

  # ---- 灌业务数据 ----
  # 不能用当前版本的 seed：它引用 v0.0.20 新列，在旧基线库上必然失败。
  # 这里只用 v0.0.4 与 v0.0.19 都存在的公共列构造固定夹具，保证指纹不是空库证据。
  local base_sql
  base_sql=$(cat <<'SQL'
INSERT INTO users (id, username, password_hash, role, status, balance) VALUES
  (1, 'admin', 'x', 'admin'::user_role, 'active'::user_status, 100),
  (2, 'lisi', 'x', 'user'::user_role, 'active'::user_status, 50),
  (3, 'wangwu', 'x', 'user'::user_role, 'active'::user_status, 25)
ON CONFLICT (id) DO NOTHING;
INSERT INTO categories (id, name, title) VALUES
  (1, 'upgrade_probe', 'Upgrade Probe')
ON CONFLICT (id) DO NOTHING;
INSERT INTO nodes (id, name, title, category_id) VALUES
  (1, 'upgrade_probe', 'Upgrade Probe', 1)
ON CONFLICT (id) DO NOTHING;
INSERT INTO topics (id, title, content, node_id, author_id, replies_count) VALUES
  (1, 'upgrade topic one', 'probe body one', 1, 1, 2),
  (2, 'upgrade topic two', 'probe body two', 1, 2, 1)
ON CONFLICT (id) DO NOTHING;
INSERT INTO replies (id, topic_id, author_id, content, floor) VALUES
  (1, 1, 1, 'historical reply one', 1),
  (2, 1, 2, 'historical reply two', 2),
  (3, 2, 3, 'historical reply three', 1)
ON CONFLICT (id) DO NOTHING;
INSERT INTO floor_counters (topic_id, last_floor) VALUES
  (1, 2), (2, 1)
ON CONFLICT (topic_id) DO UPDATE SET last_floor = GREATEST(floor_counters.last_floor, EXCLUDED.last_floor);
SQL
)
  printf '%s\n' "$base_sql" > "/tmp/v0020-base-${label}.sql"
  if psql_file "$db" "/tmp/v0020-base-${label}.sql" >/tmp/v0020-base-${label}.log 2>&1; then
    ok "公共列业务夹具灌入成功（3 用户 / 2 主题 / 3 回复）"
  else
    bad "公共列业务夹具灌入失败（详见 /tmp/v0020-base-${label}.log）"
    head -8 "/tmp/v0020-base-${label}.log" 2>/dev/null
    return
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
-- v0.0.19 基线已有 reply_images；构造一条严格 Markdown 引用，验证 0006 保守回填。
update replies set content = 'historical reply one ![x](/uploads/replies/1/aaaaaaaaaaaaaaaa.png)' where id = 1;
DO $legacy_reply_image$
BEGIN
  IF to_regclass('public.reply_images') IS NOT NULL THEN
    INSERT INTO reply_images (user_id, reply_id, storage_path, mime_type, size, used_at)
    VALUES (1, 1, 'replies/1/aaaaaaaaaaaaaaaa.png', 'image/png', 10, now())
    ON CONFLICT (storage_path) DO NOTHING;
  END IF;
END
$legacy_reply_image$;
SQL
)
  printf '%s\n' "$probe_sql" > "/tmp/v0020-probe-${label}.sql"
  if psql_file "$db" "/tmp/v0020-probe-${label}.sql" >/tmp/v0020-probe-${label}.log 2>&1; then
    ok "业务探针数据灌入（收藏/感谢/投票/关注/积分账本/通知/头像）"
  else
    # ⚠️ 探针失败**必须判红**。早先这里是「如实记录并继续」，结果是
    #    探针数据一条都没进，而后面「指纹逐字节一致」照旧全绿 ——
    #    那等于用一个空库证明了升级安全。这里改为硬失败。
    bad "业务探针数据灌入失败（详见 /tmp/v0020-probe-${label}.log）"
    head -6 "/tmp/v0020-probe-${label}.log" 2>/dev/null
    return
  fi

  local fixture_counts
  fixture_counts="$(psql_q "$db" "select (select count(*) from users) || '|' || (select count(*) from topics) || '|' || (select count(*) from replies) || '|' || (select count(*) from collections) || '|' || (select count(*) from thanks) || '|' || (select count(*) from votes)" 2>/dev/null)"
  if [ "$fixture_counts" = "3|2|3|2|3|2" ]; then
    ok "夹具行数核验通过（users|topics|replies|collections|thanks|votes = ${fixture_counts}）"
  else
    bad "夹具行数不足或探针未写入：${fixture_counts:-?}（期望 3|2|3|2|3|2）"
    return
  fi

  # ---- 升级前指纹 ----
  local has_legacy_images
  has_legacy_images="$(psql_q "$db" "select case when to_regclass('public.reply_images') is null then 0 else 1 end" 2>/dev/null)"
  fingerprint "$db" > "/tmp/v0020-fp-${label}-before.txt"
  data_only "/tmp/v0020-fp-${label}-before.txt" > "/tmp/v0020-fp-${label}-before-data.txt"
  info "升级前业务指纹 $(wc -l < "/tmp/v0020-fp-${label}-before-data.txt") 项"

  # ---- 升级 ----
  if migrate_current "$db"; then
    ok "升级迁移执行成功（当前迁移集）"
  else
    bad "升级迁移失败（详见 /tmp/v0020-migrate-current-${db}.log）"
    tail -8 "/tmp/v0020-migrate-current-${db}.log" 2>/dev/null
  fi

  # ---- v0.0.20 新结构与历史数据兼容性 ----
  local parent_cols token_cols hist_parent hist_token new_tables trigger_rows
  parent_cols="$(psql_q "$db" "select count(*) from information_schema.columns where table_name='replies' and column_name='parent_reply_id'" 2>/dev/null)"
  token_cols="$(psql_q "$db" "select count(*) from information_schema.columns where table_name='replies' and column_name='client_request_id'" 2>/dev/null)"
  hist_parent="$(psql_q "$db" "select count(*) from replies where parent_reply_id is not null" 2>/dev/null)"
  hist_token="$(psql_q "$db" "select count(*) from replies where client_request_id is not null" 2>/dev/null)"
  new_tables="$(psql_q "$db" "select count(*) from (select to_regclass('public.user_preferences') union all select to_regclass('public.reply_images') union all select to_regclass('public.rate_limit_sliding_hits')) t(rel) where rel is not null" 2>/dev/null)"
  trigger_rows="$(psql_q "$db" "select count(*) from pg_trigger where tgname='replies_validate_parent_trigger' and not tgisinternal" 2>/dev/null)"
  if [ "$parent_cols" = "1" ] && [ "$token_cols" = "1" ]; then
    ok "累计新列已建立（parent_reply_id / client_request_id）"
  else
    bad "累计新列缺失（parent=${parent_cols:-?}, token=${token_cols:-?}）"
  fi
  if [ "$hist_parent" = "0" ] && [ "$hist_token" = "0" ]; then
    ok "历史回复父关联与幂等键保持 NULL（未猜测性回填）"
  else
    bad "历史回复被意外回填（parent=${hist_parent:-?}, token=${hist_token:-?}）"
  fi
  if [ "$new_tables" = "3" ]; then
    ok "累计新表已建立（偏好 / 回复图片 / 滑动窗口命中）"
  else
    bad "累计新表数量异常：${new_tables:-?}/3"
  fi
  if [ "$trigger_rows" = "1" ]; then
    ok "父回复同主题/防环数据库触发器已建立"
  else
    bad "父回复数据库触发器缺失或重复：${trigger_rows:-?}"
  fi

  # ---- v0.0.20 附件状态机与历史引用回填 ----
  local attach_cols attach_tables attach_constraint attach_indexes legacy_links legacy_state legacy_queue
  attach_cols="$(psql_q "$db" "select count(*) from information_schema.columns where table_name='reply_images' and column_name in ('state','purge_after','purged_at')" 2>/dev/null)"
  attach_tables="$(psql_q "$db" "select count(*) from (select to_regclass('public.reply_image_links') union all select to_regclass('public.attachment_purge_queue')) t(rel) where rel is not null" 2>/dev/null)"
  attach_constraint="$(psql_q "$db" "select count(*) from pg_constraint where conrelid='reply_images'::regclass and conname='reply_images_state_check'" 2>/dev/null)"
  attach_indexes="$(psql_q "$db" "select count(*) from pg_indexes where indexname in ('reply_image_links_attachment_idx','attachment_purge_queue_due_idx')" 2>/dev/null)"
  legacy_links="$(psql_q "$db" "select count(*) from reply_image_links" 2>/dev/null)"
  legacy_state="$(psql_q "$db" "select coalesce(string_agg(state, ',' order by id), '') from reply_images" 2>/dev/null)"
  legacy_queue="$(psql_q "$db" "select count(*) from attachment_purge_queue" 2>/dev/null)"
  if [ "$attach_cols" = "3" ]; then
    ok "v0.0.20 附件状态列已建立（state / purge_after / purged_at）"
  else
    bad "v0.0.20 附件状态列数量异常：${attach_cols:-?}/3"
  fi
  if [ "$attach_tables" = "2" ] && [ "$attach_constraint" = "1" ] && [ "$attach_indexes" = "2" ]; then
    ok "v0.0.20 引用表、purge 队列、状态约束与复合索引已建立"
  else
    bad "v0.0.20 附件结构不完整（tables=${attach_tables:-?}, constraint=${attach_constraint:-?}, indexes=${attach_indexes:-?}）"
  fi
  if [ "$has_legacy_images" = "1" ]; then
    if [ "$legacy_links" = "1" ] && [ "$legacy_state" = "active" ] && [ "$legacy_queue" = "0" ]; then
      ok "v0.0.19 历史回复图片按严格 Markdown 引用回填为 active 当前链接"
    else
      bad "历史回复图片回填异常（links=${legacy_links:-?}, state=${legacy_state:-?}, queue=${legacy_queue:-?}）"
    fi
  elif [ "$legacy_links" = "0" ]; then
    ok "v0.0.4 基线无历史 reply_images，未产生猜测性附件链接"
  else
    bad "无历史附件表的基线被意外写入 ${legacy_links:-?} 条链接"
  fi

  fingerprint "$db" > "/tmp/v0020-fp-${label}-after.txt"
  data_only "/tmp/v0020-fp-${label}-after.txt" > "/tmp/v0020-fp-${label}-after-data.txt"

  if diff -q "/tmp/v0020-fp-${label}-before-data.txt" "/tmp/v0020-fp-${label}-after-data.txt" >/dev/null; then
    ok "业务数据指纹升级前后**逐字节一致**（$(wc -l < "/tmp/v0020-fp-${label}-after-data.txt") 项）"
  else
    bad "业务数据指纹发生变化："
    diff "/tmp/v0020-fp-${label}-before-data.txt" "/tmp/v0020-fp-${label}-after-data.txt" | head -12
  fi

  # 结构指纹：v0.0.4 基线应新增 0003 的索引；v0.0.9 基线应无变化
  local idx_before idx_after mig_before mig_after
  idx_before="$(grep '^schema.index.count|' "/tmp/v0020-fp-${label}-before.txt" | cut -d'|' -f2)"
  idx_after="$(grep '^schema.index.count|' "/tmp/v0020-fp-${label}-after.txt" | cut -d'|' -f2)"
  mig_before="$(grep '^schema.migration.rows|' "/tmp/v0020-fp-${label}-before.txt" | cut -d'|' -f2)"
  mig_after="$(grep '^schema.migration.rows|' "/tmp/v0020-fp-${label}-after.txt" | cut -d'|' -f2)"
  info "索引数 ${idx_before} → ${idx_after}；迁移记录 ${mig_before} → ${mig_after}"
  # ⚠️ 期望值**从 journal 派生**，不要硬编码。
  #    硬编码 4 的后果：v0.0.14 新增 0004 迁移后，升级明明成功、
  #    却被判「期望 4，实际 5」—— 门禁红在「脚本没跟上版本」而不是产品问题。
  local expect_total
  expect_total="$(node -p "require('./drizzle/meta/_journal.json').entries.length" 2>/dev/null || echo '?')"
  if [ "$mig_after" = "$expect_total" ]; then
    ok "升级后迁移记录 = ${mig_after}（当前迁移集 ${expect_total} 条已全部应用）"
  else
    bad "升级后迁移记录 = ${mig_after}，期望 ${expect_total}（取自 drizzle/meta/_journal.json）"
  fi

  # ---- 幂等 ----
  local idem=1
  for i in 1 2 3; do
    if ! migrate_current "$db"; then idem=0; bad "第 ${i} 次重跑迁移失败"; break; fi
  done
  [ "$idem" = "1" ] && ok "迁移幂等：连跑 3 次均成功"

  local fp_after_idem
  data_only <(fingerprint "$db") > /tmp/v0020-fp-idem.txt
  if diff -q "/tmp/v0020-fp-${label}-after-data.txt" /tmp/v0020-fp-idem.txt >/dev/null; then
    ok "幂等重跑后业务指纹不变"
  else
    bad "幂等重跑后业务指纹发生变化"
  fi

  # ---- 备份 / 恢复 ----
  local bk="/tmp/v0020-${label}-backup.sql"
  if PGPASSWORD="$PGPASSWORD" "$PGDUMP_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$db" \
       --no-owner --no-acl > "$bk" 2>/tmp/v0020-pgdump-${label}.log; then
    ok "备份生成（$(wc -c < "$bk") 字节）"
  else
    bad "备份生成失败"; tail -4 "/tmp/v0020-pgdump-${label}.log" 2>/dev/null; return
  fi

  psql_q postgres "CREATE DATABASE $restore" >/dev/null || die "建恢复库失败"
  if "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$restore" -X -q -v ON_ERROR_STOP=1 \
       -f "$bk" >/tmp/v0020-restore-${label}.log 2>&1; then
    fingerprint "$restore" > "/tmp/v0020-fp-${label}-restored.txt"
    if diff -q "/tmp/v0020-fp-${label}-after.txt" "/tmp/v0020-fp-${label}-restored.txt" >/dev/null; then
      ok "恢复库指纹与升级后库**完全一致**（含结构指纹）"
    else
      bad "恢复库指纹与升级后库不一致"
      diff "/tmp/v0020-fp-${label}-after.txt" "/tmp/v0020-fp-${label}-restored.txt" | head -10
    fi
  else
    bad "恢复失败（详见 /tmp/v0020-restore-${label}.log）"
    tail -6 "/tmp/v0020-restore-${label}.log" 2>/dev/null
  fi
}

printf '%s═══ v0.0.20 升级验证（双基线）═══%s\n' "$C_BLD" "$C_RST"
printf '  PG: %s:%s\n' "$PGHOST" "$PGPORT"
printf '  v0.0.4 迁移集: %s\n' "$V004_MIG"
printf '  v0.0.19 迁移集: %s\n' "$V019_MIG"

# ── 基线迁移数**从各自的 journal 派生**，不硬编码 ─────────────────────
#
# ⚠️ v0.0.15：这里原本写死 `3` 与 `4`。v0.0.14 新增了 `0004_v014_categories`，
#    于是用 `git archive v0.0.14 drizzle` 当基线时真实迁移数是 **5**，
#    脚本却仍期待 4 ⇒ **升级成功却判红**。
#    这不是产品问题，是「脚本没跟上版本」——v0.0.14 曾修过一次同类问题
#    （当时也是硬编码），本轮又因为换了基线 tag 复发。
#
#    正确做法：每个基线目录自己的 `meta/_journal.json` 才是它的真实迁移数。
#    这样换任何基线 tag 都不需要改脚本。
journal_count() {
  local dir="$1"
  local j="$dir/meta/_journal.json"
  [ -f "$j" ] || return 1
  # ⚠️ 不能用 `node -e ... "$j"`：本机 Git Bash 的 `/tmp` 是 MSYS 虚拟路径，
  #    而 node 会把它当成 `C://tmp//...` ⇒ MODULE_NOT_FOUND。
  #    改用 grep 数 `"tag":` 行 —— 每个 journal entry 恰好一行 tag，
  #    纯 shell 工具，不跨路径语义，也不依赖 node 版本。
  grep -c '"tag":' "$j" 2>/dev/null | tr -d '\r'
}

V004_EXPECT="$(journal_count "$V004_MIG")"
V019_EXPECT="$(journal_count "$V019_MIG")"

if [ -z "$V004_EXPECT" ] || [ -z "$V019_EXPECT" ]; then
  die "无法从基线迁移目录的 _journal.json 派生迁移数（检查 --v004-migrations / --v019-migrations）"
fi

info "派生迁移数：v004 基线 = ${V004_EXPECT}，v019 基线 = ${V019_EXPECT}"

run_baseline "v004" "$V004_MIG" "$V004_EXPECT"
run_baseline "v019" "$V019_MIG" "$V019_EXPECT"

printf '\n%s═══ 汇总：PASS=%d FAIL=%d ═══%s\n' "$C_BLD" "$PASS" "$FAIL" "$C_RST"
[ "$FAIL" -eq 0 ] || exit 1
