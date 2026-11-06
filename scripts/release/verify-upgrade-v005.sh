#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.5 升级验证：v0.0.4 → v0.0.5
#
# 任务书 §十三（P3）要求：「部署与升级验证（Linux/Windows 全新装、
# **v0.0.4→v0.0.5 原地升级**、备份恢复、镜像拉取）」。
#
# 本脚本验证**原地升级**这条路径：
#   1. 用 **v0.0.4 的迁移集**建一个库（模拟「用户手上的旧版本数据库」）
#   2. 灌入可识别的数据（用户 / 主题 / 回复 / 积分 / 头像 …）
#   3. 记录**数据指纹**（只读 SQL）
#   4. 跑 **v0.0.5 的迁移**（`drizzle-kit migrate`）
#   5. 再取指纹 ⇒ 断言 **data.* 逐字节不变**，schema.* 只在**预期**范围内变化
#   6. 连跑 3 次迁移 ⇒ 断言**幂等**
#
# ## 安全性
#
# - **只**操作本脚本自己建的库（`v2ex_upgrade_v005_*` 前缀）
# - 只**读**用户数据（指纹脚本是纯 SELECT）
# - 不碰任何生产库 / 证据库
# - 不做任何 git 操作、不访问网络
#
# ## 用法
#
# ```bash
# PGHOST=127.0.0.1 PGPORT=55440 PGUSER=v2ex PGPASSWORD=*** \
#   bash scripts/release/verify-upgrade-v005.sh
# ```
# ---------------------------------------------------------------------------
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ---------------------------------------------------------------------------
# 环境
# ---------------------------------------------------------------------------

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55440}"
PGUSER="${PGUSER:-v2ex}"
export PGPASSWORD="${PGPASSWORD:-v2ex_test_password_local_only}"

# ⚠️ Windows 版 psql 的客户端编码默认跟随系统（GBK）——
#    读 UTF-8 的中文 SQL 会报
#    「无效的 "UTF8" 编码字节顺序: 0xbc」（实测踩到）。
#    显式指定 UTF8 即可。
export PGCLIENTENCODING=UTF8

# psql / pg_dump 的位置（Windows 本机 / Linux 系统）
find_psql() {
  if command -v psql >/dev/null 2>&1; then command -v psql; return; fi
  local c
  for c in "$REPO_ROOT"/../_tools/pgsql/pgsql/bin/psql.exe \
           /usr/lib/postgresql/*/bin/psql \
           /usr/local/pgsql/bin/psql; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
  echo ""
}

PSQL_BIN="$(find_psql)"
if [ -z "$PSQL_BIN" ]; then
  echo "[FAIL] 找不到 psql —— 无法执行升级验证" >&2
  exit 2
fi

# pg_dump 与 psql 在同一目录
PG_DUMP_BIN="$(dirname "$PSQL_BIN")/pg_dump"
[ -x "$PG_DUMP_BIN" ] || PG_DUMP_BIN="$(command -v pg_dump 2>/dev/null || true)"
if [ -z "$PG_DUMP_BIN" ]; then
  echo "[FAIL] 找不到 pg_dump —— 无法执行备份恢复验证" >&2
  exit 2
fi

# 压测/升级用的库名（带专属前缀 ⇒ 不会被误伤）
UPGRADE_DB="${UPGRADE_DB:-v2ex_upgrade_v005_src}"
MIGRATION_DB="${MIGRATION_DB:-v2ex_upgrade_v005_dst}"

PASS=0
FAIL=0
ok()  { printf '[PASS]  %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '[FAIL]  %s\n' "$1"; FAIL=$((FAIL+1)); }
info(){ printf '[INFO]  %s\n' "$1"; }

psql_q() { "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -X -t -A -c "$1" 2>/dev/null | tr -d '\r'; }

# ---------------------------------------------------------------------------
# ① 准备：建「v0.0.4 状态的库」
#
# ⚠️ 关键：v0.0.4 的迁移集 = 0000 + 0001 + 0002（**不含** 0003_v005_reports）。
#    我们用**临时目录**装一个「只有 0000/0001/0002」的 drizzle 迁移集，
#    让 drizzle-kit 只跑那三条 ⇒ 得到真正的「v0.0.4 数据库」。
# ---------------------------------------------------------------------------

info "准备 v0.0.4 状态的迁移集（0000 + 0001 + 0002）"

# ⚠️ 临时迁移集放在**仓库内**（而不是 `mktemp -d`）。
#
#    实测踩到（Windows Git Bash）：
#      1. `mktemp -d` 返回 `C://Users//...//Temp//tmp.XXXX`
#         —— 反斜杠拼进 TS 字符串会被当转义序列
#         （`unicode error: truncated \\UXXXXXXXX escape`）；
#      2. 转成 `/C:/Users/...` 又会被 `mkdir` 拒绝
#         （`mkdir: cannot create directory '/C:': Permission denied`）——
#         Git Bash 的 POSIX 路径映射**不认** `/C:/`；
#      3. 即便改成 `C:/Users/...`，drizzle-kit 也读不了系统 Temp 下的目录
#         （实测迁移静默失败，日志只有 spinner 没有错误）。
#
#    修法：**统一用仓库内的相对路径**（如 `./.tmp-upgrade-migrations`）——
#    相对路径在 Windows 与 Linux 上行为一致，且必然在仓库内可写。
TMP_MIGRATIONS="./.tmp-upgrade-migrations"
rm -rf "$TMP_MIGRATIONS" 2>/dev/null || true
mkdir -p "$TMP_MIGRATIONS"

cleanup() {
  rm -rf "$TMP_MIGRATIONS" 2>/dev/null || true
  # 只删本脚本自己建的库
  psql_q "DROP DATABASE IF EXISTS \"$UPGRADE_DB\";" >/dev/null
  psql_q "DROP DATABASE IF EXISTS \"$MIGRATION_DB\";" >/dev/null
  psql_q "DROP DATABASE IF EXISTS \"${RESTORE_DB:-v2ex_upgrade_v005_restore}\";" >/dev/null
  rm -f "$REPO_ROOT/drizzle.config.v005tmp.ts" 2>/dev/null || true
}
trap cleanup EXIT

cp "$REPO_ROOT"/drizzle/0000_init.sql \
   "$REPO_ROOT"/drizzle/0001_striped_magdalene.sql \
   "$REPO_ROOT"/drizzle/0002_v004_perf_indexes.sql \
   "$TMP_MIGRATIONS"/ 2>/dev/null

# drizzle 的迁移账本（记录已执行的迁移）
mkdir -p "$TMP_MIGRATIONS/meta"
if [ -d "$REPO_ROOT/drizzle/meta" ]; then
  cp -r "$REPO_ROOT/drizzle/meta/." "$TMP_MIGRATIONS/meta/" 2>/dev/null || true
fi

# 让 drizzle-kit 只看这个临时迁移集
#
# ⚠️ 必须**复用项目自己的** `loadProductEnv`（src/lib/env-loader.mjs）——
#    否则 drizzle-kit 会去读 `.env.local`（指向 5432 的开发库），
#    把 `DATABASE_URL` 覆盖掉 ⇒ 迁移跑到**别的库**去
#    （这正是 drizzle.config.ts 顶部那段长注释在防的坑）。
cat > "$REPO_ROOT/drizzle.config.v005tmp.ts" <<EOF
import type { Config } from 'drizzle-kit';
import { loadProductEnv } from './src/lib/env-loader.mjs';

const report = loadProductEnv({ cwd: process.cwd() });

export default {
  schema: './src/db/schema.ts',
  out: '${TMP_MIGRATIONS}',
  dialect: 'postgresql',
  dbCredentials: {
    url: report.databaseUrl ?? 'postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$UPGRADE_DB',
  },
  verbose: true,
  strict: true,
} satisfies Config;
EOF

# 删掉 0003 及其账本条目，让它看起来「只跑过 v0.0.4」
rm -f "$TMP_MIGRATIONS/0003_v005_reports.sql" 2>/dev/null || true
if [ -f "$TMP_MIGRATIONS/meta/_journal.json" ]; then
  # ⚠️ 用**命令行参数**传路径（而不是 heredoc 里内插）——
  #    Windows 路径里的 `\` 在 heredoc 里会被 Python 当转义序列
  #    （实测报 `unicode error: truncated \\UXXXXXXXX escape`）。
  python3 -c '
import json, sys
p = sys.argv[1]
with open(p, encoding="utf-8") as f:
    j = json.load(f)
j["entries"] = [e for e in j.get("entries", []) if "0003" not in e.get("tag", "")]
with open(p, "w", encoding="utf-8") as f:
    json.dump(j, f, ensure_ascii=False, indent=2)
print("journal entries:", len(j["entries"]))
' "$TMP_MIGRATIONS/meta/_journal.json"
fi

# 建库
psql_q "DROP DATABASE IF EXISTS \"$UPGRADE_DB\";" >/dev/null
if psql_q "CREATE DATABASE \"$UPGRADE_DB\";" | grep -qi "CREATE DATABASE"; then
  ok "已创建升级源库 $UPGRADE_DB"
else
  bad "创建升级源库失败"
  exit 1
fi

info "跑 v0.0.4 迁移集（0000 + 0001 + 0002）"
if (cd "$REPO_ROOT" && DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$UPGRADE_DB" \
      npx drizzle-kit migrate --config=drizzle.config.v005tmp.ts) > /tmp/v005-migrate-v004.log 2>&1; then
  ok "v0.0.4 迁移集执行成功"
else
  bad "v0.0.4 迁移集执行失败（见 /tmp/v005-migrate-v004.log）"
  tail -20 /tmp/v005-migrate-v004.log
  exit 1
fi

# ---------------------------------------------------------------------------
# ② 灌入可识别数据
# ---------------------------------------------------------------------------

info "灌入可识别数据"
# ⚠️ 先在 $MIGRATION_DB 上跑**同一套** v0.0.4 迁移，
#    否则它是个**空库**（没有表）⇒ INSERT 直接报「关系 categories 不存在」。
#
#    流程：$MIGRATION_DB（v0.0.4 结构 + 数据）⇒ 复制成 $UPGRADE_DB
#         ⇒ 在 $UPGRADE_DB 上跑 v0.0.5 迁移 ⇒ 对比指纹。
psql_q "DROP DATABASE IF EXISTS \"$MIGRATION_DB\";" >/dev/null
psql_q "CREATE DATABASE \"$MIGRATION_DB\";" >/dev/null

if (cd "$REPO_ROOT" && DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$MIGRATION_DB" \
      npx drizzle-kit migrate --config=drizzle.config.v005tmp.ts) > /tmp/v005-migrate-seed.log 2>&1; then
  ok "升级源数据所在库的 v0.0.4 迁移执行成功"
else
  bad "升级源数据所在库的 v0.0.4 迁移执行失败（见 /tmp/v005-migrate-seed.log）"
  tail -20 /tmp/v005-migrate-seed.log
  exit 1
fi

# ⚠️ 灌数据的 SQL **刻意全用 ASCII**。
#
#    实测踩到：中文 SQL 经 `psql -c "..."` 传入时，
#    Windows 版 psql 按**系统 ANSI 编码（GBK）**解析命令行参数
#    ⇒ 报「无效的 "UTF8" 编码字节顺序: 0xbc」，
#    而且 **PGCLIENTENCODING=UTF8 也救不了**（那是给服务端会话用的，
#    不影响命令行的字节解析）。
#
#    验证的目的只是「升级前后数据一致」，**内容是什么无关紧要**
#    ⇒ 用 ASCII 是最稳的选择（Windows / Linux 行为一致）。
SEED_SQL="
INSERT INTO categories (name, title, sort) VALUES ('tech','Tech',1);
INSERT INTO nodes (name, title, category_id, status, topics_count)
  SELECT 'programmer','Programmer',c.id,'active',0 FROM categories c WHERE c.name='tech';
INSERT INTO users (username, email, password_hash, role, status, balance)
  SELECT 'upgrade_user','upgrade@example.local','scrypt\$deadbeef\$deadbeef','user','active',100;
INSERT INTO topics (node_id, author_id, title, content, votes, replies_count, status, created_at, last_reply_at)
  SELECT n.id, u.id, 'upgrade-topic','content for upgrade verification, long enough',0,0,'published',now(),now()
  FROM nodes n, users u WHERE n.name='programmer' AND u.username='upgrade_user';
INSERT INTO replies (topic_id, author_id, content, floor, thanks, created_at)
  SELECT t.id, u.id, 'reply content for upgrade verification',1,0,now()
  FROM topics t, users u WHERE t.title='upgrade-topic' AND u.username='upgrade_user';
INSERT INTO credit_ledger (user_id, type, amount, balance_before, balance_after, created_at)
  SELECT u.id,'registration_bonus',100,0,100,now() FROM users u WHERE u.username='upgrade_user';
"

if "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$MIGRATION_DB" -X -v ON_ERROR_STOP=1 \
      -c "$SEED_SQL" > /tmp/v005-seed.log 2>&1; then
  ok "可识别数据灌入成功"
else
  bad "灌入数据失败（见 /tmp/v005-seed.log）"
  tail -10 /tmp/v005-seed.log
  exit 1
fi

# 把「已灌好数据」的库复制成升级目标库（模拟「用户手上的旧库」）
#
# ⚠️ `CREATE DATABASE ... TEMPLATE ...` 要求**源库没有活跃连接** ——
#    前面 drizzle-kit 的连接可能还挂着 ⇒ 先确保断开。
psql_q "DROP DATABASE IF EXISTS \"$UPGRADE_DB\";" >/dev/null
TPL_OK=0
for attempt in 1 2 3; do
  if psql_q "CREATE DATABASE \"$UPGRADE_DB\" TEMPLATE \"$MIGRATION_DB\";" | grep -qi "CREATE DATABASE"; then
    TPL_OK=1
    break
  fi
  sleep 2
done
if [ "$TPL_OK" = "1" ]; then
  ok "已复制出「升级前」数据库 $UPGRADE_DB"
else
  bad "复制数据库失败（源库可能有活跃连接）"
  exit 1
fi

# ---------------------------------------------------------------------------
# ③ 取升级前指纹
# ---------------------------------------------------------------------------

info "取升级前指纹"
BEFORE_FP="$(mktemp)"
AFTER_FP="$(mktemp)"
"$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$UPGRADE_DB" -X -t -A -F '|' \
  -f "$SCRIPT_DIR/fingerprint.sql" > "$BEFORE_FP" 2>/dev/null

if [ ! -s "$BEFORE_FP" ]; then
  bad "升级前指纹为空（指纹脚本可能与当前 schema 不匹配）"
  exit 1
fi
ok "升级前指纹已生成（$(wc -l < "$BEFORE_FP") 行）"

# ---------------------------------------------------------------------------
# ④ 跑 v0.0.5 迁移
# ---------------------------------------------------------------------------

info "跑 v0.0.5 完整迁移集（0000 + 0001 + 0002 + **0003_v005_reports**）"
if (cd "$REPO_ROOT" && DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$UPGRADE_DB" \
      npx drizzle-kit migrate) > /tmp/v005-migrate-v005.log 2>&1; then
  ok "v0.0.5 迁移执行成功"
else
  bad "v0.0.5 迁移执行失败（见 /tmp/v005-migrate-v005.log）"
  tail -20 /tmp/v005-migrate-v005.log
  exit 1
fi

# ---------------------------------------------------------------------------
# ⑤ 断言
# ---------------------------------------------------------------------------

info "取升级后指纹"
"$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$UPGRADE_DB" -X -t -A -F '|' \
  -f "$SCRIPT_DIR/fingerprint.sql" > "$AFTER_FP" 2>/dev/null

# ⑤-A **业务数据必须逐字节不变**
DATA_BEFORE="$(grep '^data\.' "$BEFORE_FP" | sort)"
DATA_AFTER="$(grep '^data\.' "$AFTER_FP" | sort)"
if [ "$DATA_BEFORE" = "$DATA_AFTER" ]; then
  ok "业务数据指纹升级前后**逐字节一致**（$(echo "$DATA_BEFORE" | wc -l) 项）"
else
  bad "业务数据指纹发生变化："
  diff <(echo "$DATA_BEFORE") <(echo "$DATA_AFTER") | head -20
fi

# ⑤-B 结构变化必须在**预期范围**内
get_fp() { grep "^$1|" "$2" | head -1 | cut -d'|' -f2-; }

IDX_BEFORE="$(get_fp 'schema.index.count' "$BEFORE_FP")"
IDX_AFTER="$(get_fp 'schema.index.count' "$AFTER_FP")"
MIG_BEFORE="$(get_fp 'schema.migration.rows' "$BEFORE_FP")"
MIG_AFTER="$(get_fp 'schema.migration.rows' "$AFTER_FP")"
TRGM_BEFORE="$(get_fp 'schema.extension.pg_trgm' "$BEFORE_FP")"
TRGM_AFTER="$(get_fp 'schema.extension.pg_trgm' "$AFTER_FP")"

info "索引数：$IDX_BEFORE → $IDX_AFTER；迁移记录：$MIG_BEFORE → $MIG_AFTER"

# 迁移记录数必须 +1（0003_v005_reports）
if [ "$MIG_AFTER" -eq $((MIG_BEFORE + 1)) ] 2>/dev/null; then
  ok "迁移记录数 $MIG_BEFORE → $MIG_AFTER（+1，符合预期）"
else
  bad "迁移记录数 $MIG_BEFORE → $MIG_AFTER（期望 +1）"
fi

# 索引数不能减少
if [ "$IDX_AFTER" -ge "$IDX_BEFORE" ] 2>/dev/null; then
  ok "索引数 $IDX_BEFORE → $IDX_AFTER（无丢失，新增 $((IDX_AFTER - IDX_BEFORE)) 个）"
else
  bad "索引数**减少**：$IDX_BEFORE → $IDX_AFTER"
fi

# pg_trgm 扩展必须仍在
if [ "$TRGM_BEFORE" = "$TRGM_AFTER" ]; then
  ok "pg_trgm 扩展保持（$TRGM_AFTER）"
else
  bad "pg_trgm 扩展状态变化：$TRGM_BEFORE → $TRGM_AFTER"
fi

# ⑤-C v0.0.5 的新表 reports 必须存在
REPORTS_CNT="$("$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$UPGRADE_DB" -X -t -A \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='reports'" 2>/dev/null | tr -d '\r')"
if [ "$REPORTS_CNT" = "1" ]; then
  ok "v0.0.5 新表 reports 已创建"
else
  bad "v0.0.5 新表 reports **缺失**"
fi

# ⑤-D **升级前的数据仍在**（具体点名，不只看指纹）
USER_CNT="$("$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$UPGRADE_DB" -X -t -A \
  -c "SELECT count(*) FROM users WHERE username='upgrade_user'" 2>/dev/null | tr -d '\r')"
if [ "$USER_CNT" = "1" ]; then
  ok "升级前的用户数据仍在"
else
  bad "升级前的用户数据丢失"
fi

# ---------------------------------------------------------------------------
# ⑥ 幂等：连跑 3 次
# ---------------------------------------------------------------------------

info "幂等验证：连跑 3 次迁移"
IDEM_OK=1
for i in 1 2 3; do
  if ! (cd "$REPO_ROOT" && DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$UPGRADE_DB" \
        npx drizzle-kit migrate) > "/tmp/v005-idem-$i.log" 2>&1; then
    bad "第 $i 次幂等重跑失败"
    tail -10 "/tmp/v005-idem-$i.log"
    IDEM_OK=0
    break
  fi
done

if [ "$IDEM_OK" = "1" ]; then
  IDX_IDEM="$(get_fp 'schema.index.count' "$AFTER_FP")"
  MIG_IDEM="$("$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$UPGRADE_DB" -X -t -A \
    -c "SELECT count(*) FROM drizzle.__drizzle_migrations" 2>/dev/null | tr -d '\r')"
  IDX_NOW="$("$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$UPGRADE_DB" -X -t -A \
    -c "SELECT count(*) FROM pg_indexes WHERE schemaname='public'" 2>/dev/null | tr -d '\r')"

  if [ "$MIG_IDEM" = "$MIG_AFTER" ] && [ "$IDX_NOW" = "$IDX_AFTER" ]; then
    ok "幂等：连跑 3 次后迁移记录仍 $MIG_IDEM、索引仍 $IDX_NOW（无重复无丢失）"
  else
    bad "幂等异常：迁移记录 $MIG_AFTER → $MIG_IDEM；索引 $IDX_AFTER → $IDX_NOW"
  fi
fi

# ---------------------------------------------------------------------------
# ⑦ 备份 → 恢复 → 指纹比对
#
# 验证「升级后的库可以完整备份并恢复回来」——
# 这是任务书 P3「备份恢复」的要求。
#
# ⚠️ 用 `psql --single-transaction` 恢复：
#    v0.0.4 的实跑记录显示，**不带**这个参数时，
#    PG 连接中断会留下「半成品」（26 表 / 66 索引 —— 缺 10 个索引）。
#    `--single-transaction` 保证「要么全成功，要么全回滚」。
# ---------------------------------------------------------------------------

info "备份 → 恢复验证"
RESTORE_DB="${RESTORE_DB:-v2ex_upgrade_v005_restore}"
DUMP_FILE="$TMP_MIGRATIONS/backup.sql"

psql_q "DROP DATABASE IF EXISTS \"$RESTORE_DB\";" >/dev/null
psql_q "CREATE DATABASE \"$RESTORE_DB\";" >/dev/null

if "$PG_DUMP_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$UPGRADE_DB" \
      --no-owner --no-privileges > "$DUMP_FILE" 2>/tmp/v005-dump.log; then
  DUMP_SIZE="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
  ok "备份成功（$DUMP_SIZE 字节）"
else
  bad "pg_dump 失败（见 /tmp/v005-dump.log）"
  tail -5 /tmp/v005-dump.log
fi

if "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" \
      -X -v ON_ERROR_STOP=1 --single-transaction -f "$DUMP_FILE" > /tmp/v005-restore.log 2>&1; then
  ok "恢复成功（--single-transaction）"
else
  bad "恢复失败（见 /tmp/v005-restore.log）"
  tail -10 /tmp/v005-restore.log
fi

# 恢复库的指纹必须与升级后库**完全一致**
RESTORE_FP="$(mktemp)"
"$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" -X -t -A -F '|' \
  -f "$SCRIPT_DIR/fingerprint.sql" > "$RESTORE_FP" 2>/dev/null

if [ -s "$RESTORE_FP" ] && diff -q "$AFTER_FP" "$RESTORE_FP" > /dev/null 2>&1; then
  ok "恢复库指纹与升级后库**完全一致**（$(wc -l < "$RESTORE_FP") 项）"
else
  bad "恢复库指纹与源库不一致："
  diff "$AFTER_FP" "$RESTORE_FP" | head -20
fi

psql_q "DROP DATABASE IF EXISTS \"$RESTORE_DB\";" >/dev/null

# ---------------------------------------------------------------------------
# ⑧ 清理临时配置
# ---------------------------------------------------------------------------

rm -f "$REPO_ROOT/drizzle.config.v005tmp.ts" 2>/dev/null || true

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------

echo ""
echo "════════════════════════════════════════════"
printf "  v0.0.5 升级验证：PASS=%s  FAIL=%s\n" "$PASS" "$FAIL"
echo "════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
