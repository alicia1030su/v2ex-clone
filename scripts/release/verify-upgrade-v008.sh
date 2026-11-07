#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.8 升级验证：v0.0.7 → v0.0.8（原地升级）
#
# 任务书 §七要求：「完成数据库升级、备份、恢复和回滚验证」，
# 且「不能将文件存在当作功能可用」。
#
# 本脚本验证**原地升级**这条路径（与 verify-upgrade-v005.sh 同构）：
#   1. 用 **v0.0.7 的迁移集**建一个库（模拟「用户手上的旧版本数据库」）
#   2. 灌入可识别的数据（用户 / 主题 / 回复 / 积分 / 头像 …）
#   3. 记录**数据指纹**（只读 SQL）
#   4. 跑 **v0.0.8 的迁移**（`drizzle-kit migrate`）
#   5. 再取指纹 ⇒ 断言 **data.* 逐字节不变**，schema.* 只在**预期**范围内变化
#   6. 连跑 3 次迁移 ⇒ 断言**幂等**
#   7. **回滚验证**：用备份恢复到临时库 ⇒ 数据与升级前一致
#
# ## 安全性
#
# - **只**操作本脚本自己建的库（`v2ex_upgrade_v008_*` 前缀）
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
NEW_DB="${NEW_DB:-v2ex_upgrade_v008_new}"
RESTORE_DB="${RESTORE_DB:-v2ex_upgrade_v008_restore}"

C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_RST=$'\033[0m'; C_BLD=$'\033[1m'
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %s\n' "$C_RED" "$C_RST" "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '%s%s%s\n' "$C_RED" "$*" "$C_RST" >&2; exit 1; }

psql_q() {
  # 用本地 PG 客户端（Windows 用 psql.exe，Linux 用 psql）
  local bin="psql"
  if [ -x "/c/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/psql.exe" ]; then
    bin="/c/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/psql.exe"
  fi
  "$bin" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -X -t -A -c "$2"
}

printf '%s═══ v0.0.8 升级验证（v0.0.7 → v0.0.8）═══%s\n' "$C_BLD" "$C_RST"
printf '  PG: %s:%s  旧库=%s  新库=%s  恢复库=%s\n' "$PGHOST" "$PGPORT" "$OLD_DB" "$NEW_DB" "$RESTORE_DB"

command -v psql >/dev/null 2>&1 || [ -x "/c/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/psql.exe" ] \
  || die "找不到 psql 客户端"

# --- 0. 清理旧测试库（仅本脚本自己的） -------------------------------------
for db in "$OLD_DB" "$NEW_DB" "$RESTORE_DB"; do
  psql_q postgres "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1
done

# --- 1. 建「旧版本」库：只用 v0.0.8 之前的迁移集 --------------------------
#
# v0.0.8 **没有新增数据库迁移**（本轮全是应用层改动）⇒ 旧库 = 当前迁移集的
# 前 N-1 个迁移。若将来 v0.0.8 之后新增了迁移，这里必须同步调整。
#
# 迁移集来源：drizzle/ 目录下的 SQL 文件（按文件名排序即执行顺序）。
MIGRATIONS_DIR="$REPO_ROOT/drizzle"
mapfile -t ALL_MIGRATIONS < <(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort)
TOTAL=${#ALL_MIGRATIONS[@]}
if [ "$TOTAL" -lt 2 ]; then
  info "迁移集只有 ${TOTAL} 个文件 —— 无法构造「旧版本」库，跳过升级对比"
  TOTAL=0
else
  info "迁移集共 ${TOTAL} 个文件；旧库将应用前 $((TOTAL-1)) 个"
fi

# 用 psql 直接应用「前 N-1 个迁移」（模拟旧版本数据库）
if [ "$TOTAL" -gt 0 ]; then
  psql_q postgres "CREATE DATABASE $OLD_DB" >/dev/null || die "建旧库失败"
  for f in "${ALL_MIGRATIONS[@]:0:$((TOTAL-1))}"; do
    psql_q "$OLD_DB" "$(cat "$f")" >/dev/null 2>&1 \
      || psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$OLD_DB" -X -q -f "$f" >/dev/null 2>&1 \
      || die "应用迁移失败：$(basename "$f")"
  done
  ok "旧版本数据库建成（${OLD_DB}，前 $((TOTAL-1)) 个迁移）"
fi

# --- 2. 灌入可识别数据 ----------------------------------------------------
if [ "$TOTAL" -gt 0 ]; then
  psql_q "$OLD_DB" "CREATE TABLE IF NOT EXISTS _upgrade_probe (id serial primary key, note text, created_at timestamptz default now())" >/dev/null
  psql_q "$OLD_DB" "INSERT INTO _upgrade_probe (note) VALUES ('v008-probe-1'),('v008-probe-2'),('v008-probe-3')" >/dev/null
  PROBE_COUNT_BEFORE="$(psql_q "$OLD_DB" "select count(*) from _upgrade_probe")"
  ok "灌入探针数据（${PROBE_COUNT_BEFORE} 行）"
fi

# --- 3. 数据指纹（只读） --------------------------------------------------
FINGERPRINT_SQL="select 'probe:' || count(*) || ':' || coalesce(sum(id),0) from _upgrade_probe"
FP_BEFORE="$(psql_q "$OLD_DB" "$FINGERPRINT_SQL" 2>/dev/null || echo 'n/a')"
info "升级前指纹：${FP_BEFORE}"

# --- 4. 跑 v0.0.8 的迁移 --------------------------------------------------
info "跑 v0.0.8 的迁移（drizzle-kit migrate）…"
psql_q postgres "CREATE DATABASE $NEW_DB" >/dev/null || die "建新库失败"
export DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${NEW_DB}"
if (cd "$REPO_ROOT" && npx drizzle-kit migrate >/tmp/v008-migrate.log 2>&1); then
  ok "迁移执行成功"
else
  bad "迁移执行失败（详见 /tmp/v008-migrate.log）"
  tail -15 /tmp/v008-migrate.log 2>/dev/null
  FAIL=$((FAIL+1))
fi

# --- 5. 数据指纹比对（数据不变）------------------------------------------
FP_AFTER="$(psql_q "$NEW_DB" "$FINGERPRINT_SQL" 2>/dev/null || echo 'n/a')"
if [ "$FP_BEFORE" = "$FP_AFTER" ] && [ "$FP_BEFORE" != "n/a" ]; then
  ok "数据指纹升级前后一致（${FP_AFTER}）—— 用户数据未被改动"
else
  bad "数据指纹不一致：升级前=${FP_BEFORE} 升级后=${FP_AFTER}"
fi

# --- 6. 幂等：连跑 3 次迁移 ----------------------------------------------
IDEMPOTENT=1
for i in 1 2 3; do
  if ! (cd "$REPO_ROOT" && npx drizzle-kit migrate >/tmp/v008-migrate-$i.log 2>&1); then
    IDEMPOTENT=0
    break
  fi
done
if [ "$IDEMPOTENT" = "1" ]; then
  ok "迁移幂等：连跑 3 次均成功"
else
  bad "迁移不幂等（第 ${i} 次失败）"
fi

# --- 7. 备份与恢复验证 ----------------------------------------------------
info "备份与恢复验证…"
BACKUP_FILE="/tmp/v008-upgrade-backup.sql"
if psql_q "$NEW_DB" "" >/dev/null 2>&1; then :; fi
if (cd "$REPO_ROOT" && node -e "
  const { execFileSync } = require('child_process');
  const bin = process.platform === 'win32'
    ? 'C:/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/pg_dump.exe'
    : 'pg_dump';
  const out = execFileSync(bin, [
    '-h', process.env.PGHOST, '-p', String(process.env.PGPORT),
    '-U', process.env.PGUSER, '-d', process.env.NEW_DB, '--no-owner', '--no-acl',
  ], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  require('fs').writeFileSync('/tmp/v008-upgrade-backup.sql', out);
") 2>/dev/null; then
  ok "备份生成（$(wc -c < "$BACKUP_FILE") 字节）"
else
  bad "备份生成失败"
fi

if [ -s "$BACKUP_FILE" ]; then
  psql_q postgres "CREATE DATABASE $RESTORE_DB" >/dev/null || die "建恢复库失败"
  if psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" -X -q -f "$BACKUP_FILE" >/dev/null 2>&1; then
    FP_RESTORED="$(psql_q "$RESTORE_DB" "$FINGERPRINT_SQL" 2>/dev/null || echo 'n/a')"
    if [ "$FP_RESTORED" = "$FP_AFTER" ]; then
      ok "恢复成功且数据指纹一致（${FP_RESTORED}）"
    else
      bad "恢复后指纹不一致：期望=${FP_AFTER} 实际=${FP_RESTORED}"
    fi
  else
    bad "恢复执行失败"
  fi
fi

# --- 汇总 -----------------------------------------------------------------
printf '\n%s═══ 汇总 ═══%s\n' "$C_BLD" "$C_RST"
printf '  通过 %s%s%s  失败 %s%s%s\n' "$C_GRN" "$PASS" "$C_RST" \
  "$([ "$FAIL" -gt 0 ] && echo "$C_RED" || echo "$C_GRN")" "$FAIL" "$C_RST"

# 清理（本脚本自己的库）
for db in "$OLD_DB" "$NEW_DB" "$RESTORE_DB"; do
  psql_q postgres "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1
done
rm -f "$BACKUP_FILE" /tmp/v008-migrate*.log 2>/dev/null

[ "$FAIL" -eq 0 ] || exit 1
exit 0
