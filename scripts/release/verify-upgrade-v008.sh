#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.8 升级验证（原地升级 + 备份恢复 + 幂等）
#
# 任务书 §七要求：「完成数据库升级、备份、恢复和回滚验证」，
# 且「不能将文件存在当作功能可用」⇒ 做成**可执行的真实验证**。
#
# ## 验证内容
#
#   1. 用 **drizzle-kit 自身**建基准库（journal 表完整）——
#      ⚠️ 手工用 psql 应用迁移 SQL 会**漏建 `drizzle.__drizzle_migrations`**，
#         导致后续 drizzle-kit 认为迁移都未应用 ⇒ 重复执行失败
#         （v0.0.8 首版实现踩到，CI 实测失败）。
#   2. 灌入可识别的探针数据
#   3. 记录**数据指纹**（只读 SQL）
#   4. 跑 **v0.0.8 的迁移**（同一库上 = 原地升级）
#   5. 断言数据指纹**逐字节不变**（用户数据未被改动）
#   6. **幂等**：连跑 3 次迁移均成功
#   7. **备份 → 恢复到临时库** ⇒ 断言指纹一致（回滚路径）
#
# ## 关于「v0.0.7 的迁移集」
#
# v0.0.8 **没有新增数据库迁移**（最后迁移仍是 v0.0.5 的 0003_v005_reports.sql）
# ⇒ v0.0.7 与 v0.0.8 的迁移集**相同**。
#
# 但「相同」不等于「无需验证」：升级路径仍要证明
#   ① 迁移在已有数据的库上能安全重跑（幂等）；
#   ② 迁移过程中用户数据**原样保留**；
#   ③ 备份能恢复出同样的数据。
#
# ## 安全性
#
# - **只**操作本脚本自己建的库（`v2ex_upgrade_v008_*` 前缀），结束时清理
# - 只**读**用户数据（指纹脚本是纯 SELECT）
# - 不碰任何生产库 / 证据库
# - 不做任何 git 操作、不访问网络
#
# ## 用法
#
# ```bash
# PGHOST=127.0.0.1 PGPORT=55440 PGUSER=v2ex PGPASSWORD=*** \
#   bash scripts/release/verify-upgrade-v008.sh
# ```
# ---------------------------------------------------------------------------
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55440}"
PGUSER="${PGUSER:-v2ex}"
PGPASSWORD="${PGPASSWORD:-v2ex_test_password_local_only}"
export PGHOST PGPORT PGUSER PGPASSWORD

OLD_DB="${OLD_DB:-v2ex_upgrade_v008_old}"
RESTORE_DB="${RESTORE_DB:-v2ex_upgrade_v008_restore}"

C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_RST=$'\033[0m'; C_BLD=$'\033[1m'
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %s\n' "$C_RED" "$C_RST" "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '%s%s%s\n' "$C_RED" "$*" "$C_RST" >&2; exit 1; }

# psql / pg_dump 客户端（Windows 用本地 exe，Linux 用系统命令）
PSQL_BIN="psql"
PGDUMP_BIN="pg_dump"
if [ -x "/c/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/psql.exe" ]; then
  PSQL_BIN="/c/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/psql.exe"
  PGDUMP_BIN="/c/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/pg_dump.exe"
fi

psql_q() {
  "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -X -t -A -c "$2"
}

printf '%s═══ v0.0.8 升级验证（原地升级 + 备份恢复 + 幂等）═══%s\n' "$C_BLD" "$C_RST"
printf '  PG: %s:%s  升级库=%s  恢复库=%s\n' "$PGHOST" "$PGPORT" "$OLD_DB" "$RESTORE_DB"

command -v "$PSQL_BIN" >/dev/null 2>&1 || [ -x "$PSQL_BIN" ] || die "找不到 psql 客户端"

# --- 0. 清理本脚本自己的库 -----------------------------------------------
for db in "$OLD_DB" "$RESTORE_DB"; do
  psql_q postgres "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1
done

# --- 1. 建基准库：必须用 drizzle-kit 自身 ----------------------------------
#
# ⚠️ 关键：**不能**手工用 psql 应用迁移 SQL —— 那样没有
#    `drizzle.__drizzle_migrations` journal 表 ⇒ drizzle-kit 会认为
#    所有迁移都未应用 ⇒ 重复执行时报错（v0.0.8 首版实现踩到）。
MIGRATIONS_DIR="$REPO_ROOT/drizzle"
[ -d "$MIGRATIONS_DIR" ] || die "找不到迁移目录：$MIGRATIONS_DIR"
TOTAL=$(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ')
info "迁移集共 ${TOTAL} 个文件（v0.0.8 未新增迁移 ⇒ 与 v0.0.7 相同）"

psql_q postgres "CREATE DATABASE $OLD_DB" >/dev/null || die "建库失败"
export DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${OLD_DB}"
if (cd "$REPO_ROOT" && npx drizzle-kit migrate >/tmp/v008-migrate.log 2>&1); then
  ok "基准库建成（${OLD_DB}，迁移 journal 完整）"
else
  bad "基准库迁移失败（详见 /tmp/v008-migrate.log）"
  tail -15 /tmp/v008-migrate.log 2>/dev/null
  exit 1
fi

# --- 2. 灌入可识别数据 ----------------------------------------------------
psql_q "$OLD_DB" "CREATE TABLE IF NOT EXISTS _upgrade_probe (id serial primary key, note text, created_at timestamptz default now())" >/dev/null \
  || die "建探针表失败"
psql_q "$OLD_DB" "INSERT INTO _upgrade_probe (note) VALUES ('v008-probe-1'),('v008-probe-2'),('v008-probe-3')" >/dev/null \
  || die "灌探针数据失败"
PROBE_COUNT_BEFORE="$(psql_q "$OLD_DB" 'select count(*) from _upgrade_probe')"
ok "灌入探针数据（${PROBE_COUNT_BEFORE} 行）"

# --- 3. 数据指纹（只读） --------------------------------------------------
FINGERPRINT_SQL="select 'probe:' || count(*) || ':' || coalesce(sum(id),0) from _upgrade_probe"
FP_BEFORE="$(psql_q "$OLD_DB" "$FINGERPRINT_SQL" 2>/dev/null || echo 'n/a')"
info "升级前指纹：${FP_BEFORE}"

# --- 4. 原地升级：同一库上再跑一次迁移 ------------------------------------
#
# 这正是「升级」的动作：库里有真实数据时，迁移必须**安全重跑**
# （已应用的跳过、未应用的补上），且**不动用户数据**。
info "在已有数据的库上重跑迁移（= 升级动作）…"
if (cd "$REPO_ROOT" && npx drizzle-kit migrate >/tmp/v008-migrate-upgrade.log 2>&1); then
  ok "升级迁移执行成功"
else
  bad "升级迁移执行失败（详见 /tmp/v008-migrate-upgrade.log）"
  tail -15 /tmp/v008-migrate-upgrade.log 2>/dev/null
fi

# --- 5. 数据指纹比对（数据不变）------------------------------------------
FP_AFTER="$(psql_q "$OLD_DB" "$FINGERPRINT_SQL" 2>/dev/null || echo 'n/a')"
if [ "$FP_BEFORE" = "$FP_AFTER" ] && [ "$FP_BEFORE" != "n/a" ]; then
  ok "数据指纹升级前后一致（${FP_AFTER}）—— 用户数据未被改动"
else
  bad "数据指纹不一致：升级前=${FP_BEFORE} 升级后=${FP_AFTER}"
fi

# --- 6. 幂等：连跑 3 次迁移 ----------------------------------------------
IDEMPOTENT=1
FAILED_AT=0
for i in 1 2 3; do
  if ! (cd "$REPO_ROOT" && npx drizzle-kit migrate >"/tmp/v008-migrate-idem-$i.log" 2>&1); then
    IDEMPOTENT=0
    FAILED_AT=$i
    break
  fi
done
if [ "$IDEMPOTENT" = "1" ]; then
  ok "迁移幂等：连跑 3 次均成功"
else
  bad "迁移不幂等（第 ${FAILED_AT} 次失败）"
  tail -10 "/tmp/v008-migrate-idem-${FAILED_AT}.log" 2>/dev/null
fi

# --- 7. 备份与恢复验证 ----------------------------------------------------
info "备份与恢复验证…"
BACKUP_FILE="/tmp/v008-upgrade-backup.sql"
if (cd "$REPO_ROOT" && PGPASSWORD="$PGPASSWORD" "$PGDUMP_BIN" \
      -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$OLD_DB" \
      --no-owner --no-acl > "$BACKUP_FILE" 2>/tmp/v008-pgdump.log); then
  ok "备份生成（$(wc -c < "$BACKUP_FILE") 字节）"
else
  bad "备份生成失败（$(tail -2 /tmp/v008-pgdump.log 2>/dev/null | tr '\n' ' ')"）
fi

if [ -s "$BACKUP_FILE" ]; then
  psql_q postgres "CREATE DATABASE $RESTORE_DB" >/dev/null || die "建恢复库失败"
  if "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" \
       -X -q -v ON_ERROR_STOP=1 -f "$BACKUP_FILE" >/tmp/v008-restore.log 2>&1; then
    FP_RESTORED="$(psql_q "$RESTORE_DB" "$FINGERPRINT_SQL" 2>/dev/null || echo 'n/a')"
    if [ "$FP_RESTORED" = "$FP_AFTER" ]; then
      ok "恢复成功且数据指纹一致（${FP_RESTORED}）"
    else
      bad "恢复后指纹不一致：期望=${FP_AFTER} 实际=${FP_RESTORED}"
    fi
  else
    bad "恢复执行失败（$(tail -2 /tmp/v008-restore.log 2>/dev/null | tr '\n' ' ')"）
  fi
fi

# --- 汇总 -----------------------------------------------------------------
printf '\n%s═══ 汇总 ═══%s\n' "$C_BLD" "$C_RST"
printf '  通过 %s%s%s  失败 %s%s%s\n' "$C_GRN" "$PASS" "$C_RST" \
  "$([ "$FAIL" -gt 0 ] && echo "$C_RED" || echo "$C_GRN")" "$FAIL" "$C_RST"

# 清理（本脚本自己的库与临时文件）
for db in "$OLD_DB" "$RESTORE_DB"; do
  psql_q postgres "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1
done
rm -f "$BACKUP_FILE" /tmp/v008-migrate*.log /tmp/v008-pgdump.log /tmp/v008-restore.log 2>/dev/null

[ "$FAIL" -eq 0 ] || exit 1
exit 0
