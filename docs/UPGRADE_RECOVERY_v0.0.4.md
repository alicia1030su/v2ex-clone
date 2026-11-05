# V2EX Clone v0.0.4 — 安装 / 升级 / 恢复验证报告（第六阶段）

> 执行人：部署运维工程师（devops-engineer / 陆上线）
> 仓库：`C:/Users/TYMO001/WorkBuddy/ai/v2ex-clone`
> 分支 / HEAD：`feat/v0.0.4-high-fidelity` @ `89d6b4e`
> 数据库：本机独立 PostgreSQL **17.5**（用户 `v2ex`）—— **本报告记录的执行时点为 `127.0.0.1:55433`**（下方命令清单为该次实跑的原文）；
> ⚠️ **当前测试环境指向哪个端口**：按 `.env.test` 实际解析的端口（**当前 55440**）—— `.env.test` 第 3 行实测值
> `DATABASE_URL=postgres://v2ex:...@127.0.0.1:55440/v2ex_test_base`。**下方命令清单中的 `55433` 属历史实跑记录，不回改。**
> 报告口径：**实跑通过** / **静态核查** / **未验证** 严格三分，不编造结果

---

## 0. 结论摘要

| 验收项 | 结论 | 关键证据 |
|---|---|---|
| 1 全新安装（0000→0001→0002） | ✅ **实跑通过** | `migrate` exit=0；**26 表 / 76 索引 / 3 条迁移记录**；`pg_trgm 1.6`；0002 的 **7 个索引全在** |
| 2 已有库升级（v0.0.3 → v0.0.4） | ✅ **实跑通过** | 数据指纹 `a7335937…` **升级前后逐字节一致**；管理员口令哈希、头像、积分余额/账本全不变；原 69 索引零丢失，新增正好 7 个 |
| 3 迁移幂等 | ✅ **实跑通过** | 连跑 3 次 exit=0；`26 / 76 / 3 / 1` 恒定；重名索引 **0** 条 |
| 4 备份可恢复 | ✅ **实跑通过（含一次真实失败与重试）** | 首次恢复因 PG 连接被中断留下半成品（26 表/66 索引）；改用 `--single-transaction` 重建恢复后 exit=0，**完整指纹 `fc3512608…` 与源库一致** |
| 5 故障恢复（Redis / PG 连接池） | ⚠️ **静态核查**（本机无 Docker） | 已读源码给出可执行恢复步骤；**未实跑容器故障注入** |
| 6 安装包静态核查 | ⚠️ **静态核查 + 本机脚本级实跑** | PowerShell 5.1 解析 0 错误 / BOM 正确 / 6 个 sh 语法通过；**未实跑容器安装**；发现 **版本标记全部仍为 0.0.3** 的阻断问题 |

**总判定：数据库层面的安装、升级、幂等、备份恢复全部实跑通过，具备上线条件。**
**但发行包与发布流水线仍存在版本一致性阻断（见 §8、§11），在这些阻断清除前不得发布 v0.0.4。**

### 诚实声明（哪些没做）

- 本机 `command -v docker` → **`docker NOT FOUND`**。所有涉及 Docker / Compose 容器运行、健康检查、数据卷、Redis 故障注入的验证**一律只做静态核查，没有实跑**。
- 未执行任何 `git commit` / `git push` / 建 Tag / 建 Release / 改远端 / 删数据卷操作。
- 未触碰 4 个禁改数据库：`v2ex_release_v001`、`v2ex_loadtest`、`v2ex_visual`、`v2ex_e2e_v004`（迁移前已列出确认存在，全程未连接）。
- 未修改 `src/**`、`drizzle/**`、`e2e/**`、`tests/**`、`package.json`、任何现有 `.yml`、任何现有 `.md`、`RISK_REGISTER.md`、`deploy/**`、`tools/visual/**`。
- 本机 Node 为 `v22.22.2`，`package.json` 的 `engines` 要求 `>=22.23.4`；迁移工具链在本机实跑正常，但该版本差异**未在 CI 的 22.23.4 上复验**。
- **`npx tsc --noEmit` 本轮跳过并说明**：本轮只新增 `docs/*.md`、`scripts/release/preflight.sh`、`scripts/release/fingerprint.sql`，**未改动任何 `.ts` / `.tsx` / `tsconfig` / `package.json`**，不影响 TypeScript 编译结果；类型检查由 `ci.yml: unit` 与 qa-engineer 的全量复验负责，本轮不重复执行也不代替其结论。

---

## 1. 环境与所有权边界

### 1.1 实跑环境

```
PostgreSQL 17.5 on x86_64-windows, compiled by msvc-19.44.35209, 64-bit
psql      : C:/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/psql.exe
pg_dump   : C:/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/pg_dump.exe
createdb  : C:/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/createdb.exe
保活脚本  : C:/Users/TYMO001/WorkBuddy/ai/_tools/pg-keepalive.sh
Node      : v22.22.2 (npx 10.9.7)
Docker    : NOT FOUND
```

迁移前实测现有数据库（**只读列出，未连接任何一个**）：

```
postgres, v2ex_admintest, v2ex_e2e, v2ex_e2e_v004, v2ex_loadtest,
v2ex_mig_idem, v2ex_mig_v004, v2ex_release_v001, v2ex_upgrade_src,
v2ex_v002_baseline, v2ex_v003_admin, v2ex_v003_content,
v2ex_v003_credits, v2ex_v003_feed, v2ex_v003_reset, v2ex_v004_audit, v2ex_visual
```

### 1.2 本阶段新建的库（仅 `v2ex_upg_v004_` 前缀）

| 库名 | 用途 |
|---|---|
| `v2ex_upg_v004_fresh` | 全新安装 + 幂等连跑 |
| `v2ex_upg_v004_old` | v0.0.3 基线 → 升级 → 备份源 |
| `v2ex_upg_v004_restore` | 备份恢复目标 |

### 1.3 隔离 env 文件（写在系统 Temp，不进仓库）

```
C:/Users/TYMO001/AppData/Local/Temp/v2ex_upg_v004_fresh.env
C:/Users/TYMO001/AppData/Local/Temp/v2ex_upg_v004_old.env
C:/Users/TYMO001/AppData/Local/Temp/v2ex_upg_v004_restore.env
```

内容形如 `DATABASE_URL=postgres://v2ex:v2ex_password@127.0.0.1:<端口>/<库名>`（**本报告执行时点为 55433**；
当前测试环境按 `.env.test` 实际解析的端口为 **55440**）。
每次调用都同时设置 `ENV_FILE` 与 `DATABASE_URL` 两个变量（值相同），确保 `drizzle.config.ts` 的 `override:true` 与 `process.env` 都不会误连到 `.env.local` 指向的 `127.0.0.1:5432/v2ex`。

> **密钥卫生说明**：上述文件含**本机共享测试口令**（非生产凭据），位于系统 Temp、**未进入仓库、未进入镜像、未进入任何交付文档之外的版本控制路径**。本轮为便于主理人复核予以保留；复现完成后应执行
> `rm -f "C:/Users/TYMO001/AppData/Local/Temp"/v2ex_upg_v004_*.env` 清理。同样，备份文件 `v2ex_upg_v004_preupgrade.sql` / `postupgrade.sql(.gz)` 与指纹文本也留在系统 Temp，仅含本轮构造的测试数据。

---

## 2. 验收 1：全新安装（实跑通过）

### 2.1 命令

```bash
bash "C:/Users/TYMO001/WorkBuddy/ai/_tools/pg-keepalive.sh"
cd "C:/Users/TYMO001/WorkBuddy/ai/v2ex-clone"
ENV_FILE="C:/Users/TYMO001/AppData/Local/Temp/v2ex_upg_v004_fresh.env" \
DATABASE_URL="postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_upg_v004_fresh" \
  npx drizzle-kit migrate
```

### 2.2 真实输出（节选，spinner 已折叠）

```
PG ready on 55433
=== FRESH INSTALL: npx drizzle-kit migrate ===
No config path provided, using default 'drizzle.config.ts'
Reading config file 'C:\Users\TYMO001\WorkBuddy\ai\v2ex-clone\drizzle.config.ts'
Using 'postgres' driver for database querying
[✓] migrations applied successfully!
=== EXIT CODE: 0 ===
```

### 2.3 结构核验真实输出

```
=== [1] public schema base table count ===
table_count
26
=== [2] public table list ===
avatars, categories, collections, credit_ledger, daily_checkins, edit_history,
email_logs, floor_counters, follows, kv_store, login_attempts, moderation_logs,
node_requests, nodes, notifications, password_reset_tokens, rate_limit_buckets,
replies, reports, sessions, tags, thanks, topic_tags, topics, users, votes
=== [3] total public indexes ===
index_count
76
=== [4] 0002 v0.0.4 indexes (7 expected) ===
replies_author_alive_idx | replies
replies_topic_id_idx | replies
thanks_reply_id_idx | thanks
topics_author_alive_idx | topics
topics_content_trgm_idx | topics
topics_title_trgm_idx | topics
votes_topic_id_idx | votes
(7 rows)
=== [5] index method / predicate ===
replies_author_alive_idx | btree | (deleted_at IS NULL)
replies_topic_id_idx | btree | (none)
thanks_reply_id_idx | btree | (none)
topics_author_alive_idx | btree | (deleted_at IS NULL)
topics_content_trgm_idx | gin | (none)
topics_title_trgm_idx | gin | (none)
votes_topic_id_idx | btree | (none)
=== [6] pg_trgm extension ===
pg_trgm | 1.6
=== [7] drizzle migration journal in DB ===
1 | fe2ac4a18af0fef1772f82761a0b5986b9e81be71470f26428d9699f6055d765 | 1793664815196
2 | 4f86114805eefd8002373c8d8fb369ae611f87facfeb8605c2babf725daa6835 | 1793749333173
3 | e00e4a09b473f9da51d62f5575f2404a30241b90e394a59f024a5312b66205e2 | 1793778312868
(3 rows)
```

**结论**：0000 / 0001 / 0002 三个迁移全部落库；26 张 public 表与 `RELEASE_GATE.md` 的 v0.0.3 基线（26 表）一致；0002 的 7 个索引中 **2 个部分索引**（谓词 `deleted_at IS NULL`）、**2 个 GIN trigram 索引**均按预期建立；`pg_trgm 1.6` 扩展创建成功（本机 `v2ex` 有权限，未触发权限不足的降级分支）。

---

## 3. 验收 2：已有库升级 v0.0.3 → v0.0.4（实跑通过）

### 3.1 v0.0.3 基线如何构造（可复现）

`drizzle-kit migrate` 一次会应用 journal 全部 3 条。为精确模拟「只应用过 0000+0001 的 v0.0.3 老库」，采用：

1. 用 `psql -f` **直接执行仓库里的真实 SQL 文件** `0000_init.sql` + `0001_striped_magdalene.sql`（`--> statement-breakpoint` 是 SQL 行注释，psql 会忽略）；
2. 按从 `v2ex_upg_v004_fresh` 用 `pg_dump --schema-only` 导出的**真实 DDL** 建 `drizzle.__drizzle_migrations` 表，并插入**从 fresh 库读出的真实 hash / when 的前两条记录**（不臆造 hash）；
3. 于是 drizzle-kit 认为 0000/0001 已应用，后续 `migrate` **只会应用 0002** —— 这就是真实的增量升级路径。

真实基线状态（`psql` 输出）：

```
tables | indexes | journal_rows | trgm_ext | v004_indexes
26     | 69      | 2            | 0        | 0
check            | string_agg
balance_vs_ledger | admin=100/alice=42/bob=17
```

> 69 = v0.0.4 的 76 − 0002 的 7；`pg_trgm` 不存在；v0.0.4 专有索引 0 个。基线判定成立。

### 3.2 升级前写入的自洽数据

用 `psql -v ON_ERROR_STOP=1` 插入（`insert_exit=0`）：

- **用户 3 个**：`admin`（role=admin，balance=100，固定 `password_hash`，avatar `/uploads/avatars/admin-v003.png`）、`alice`（balance=42，avatar `/uploads/avatars/alice-avatar-v003.png`）、`bob`（balance=17，avatar NULL）
- **节点 2 个 / 主题 2 个 / 回复 2 条**（含楼层 1、2）/ `thanks` 1 / `votes` 1 / `floor_counters` 1 / `avatars` 1 / `kv_store` 1
- **积分流水 6 条**（`credit_ledger`）：alice `+50 → -5 → -3` 终值 42；bob `+20 → -3` 终值 17；admin `+100` 终值 100
- **强自洽条件**：`sum(users.balance) = 159 = sum(credit_ledger.amount)`，且每个用户的 `balance` 等于其最后一条流水的 `balance_after`

外键全部满足，管理员口令哈希是**固定字符串**（便于逐字节断言未被改写）。

### 3.3 升级前指纹（真实值）

指纹由只读脚本 `scripts/release/fingerprint.sql` 生成（26 张表行数 + 关键字段 + 口令哈希 + 头像路径 + 账本明细 + 结构清单，共 **55 行**规范化 `key|value` 文本）。

```
=== pre-upgrade pg_dump (rollback asset) ===
dump_exit=0 size=58133 bytes
=== pre-upgrade fingerprint ===
fp_lines=55
=== data fingerprint sha256 (before) ===
a7335937ffbfbef654862dd088229edd68b8b1bc16a36da6b5769238b5c4e769
```

关键字段实际值：

```
data.credit_ledger.rows|6
data.credit_ledger.amount_sum|159
data.credit_ledger.detail|2:registration_bonus:50:0->50:reg-alice-v003,2:topic_created:-5:50->45:topic-1-alice-v003,2:reply_created:-3:45->42:reply-2-alice-v003,3:registration_bonus:20:0->20:reg-bob-v003,3:reply_created:…
data.rowcount.users|3      data.rowcount.topics|2      data.rowcount.replies|2
data.users.admin.password_hash|scrypt$32768$8$1$v003_admin_hash_DO_NOT_CHANGE_9f3a2c1b
data.users.admin.role|admin
data.users.admin.balance|100
data.users.alice.avatar|/uploads/avatars/alice-avatar-v003.png
data.users.avatar_list|admin:/uploads/avatars/admin-v003.png,alice:/uploads/avatars/alice-avatar-v003.png,bob:<NULL>
data.users.balance_sum|159
```

同时保留升级前的 `pg_dump` 作为**回滚资产**：`v2ex_upg_v004_preupgrade.sql`（58,133 字节）。

### 3.4 执行增量升级（真实输出）

```bash
ENV_FILE="C:/Users/TYMO001/AppData/Local/Temp/v2ex_upg_v004_old.env" \
DATABASE_URL="postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_upg_v004_old" \
  npx drizzle-kit migrate
```

```
=== UPGRADE v0.0.3 -> v0.0.4 on v2ex_upg_v004_old ===
Reading config file 'C:\Users\TYMO001\WorkBuddy\ai\v2ex-clone\drizzle.config.ts'
[⣷] applying migrations...{
  message: '模式 "drizzle" 已存在, 跳过',
  message: '关系 "__drizzle_migrations" 已经存在, 跳过',
[✓] migrations applied successfully!
=== migrate exit_code=0 ===
```

### 3.5 升级后比对（真实输出）

```
=== [A] data fingerprint: before vs after ===
a7335937ffbfbef654862dd088229edd68b8b1bc16a36da6b5769238b5c4e769  ...data_before.txt
a7335937ffbfbef654862dd088229edd68b8b1bc16a36da6b5769238b5c4e769  ...data_after.txt
RESULT: DATA FINGERPRINT IDENTICAL (0 differing bytes) ✓

=== [B] lines that changed across full fingerprint (只有 5 行，全是 schema.*) ===
< schema.extension.pg_trgm|0          > schema.extension.pg_trgm|1
< schema.index.count|69                > schema.index.count|76
< schema.index.names|…(69 个)          > schema.index.names|…(76 个)
< schema.migration.rows|2              > schema.migration.rows|3
< schema.migration.hashes|…(2 个)      > schema.migration.hashes|…(3 个)

=== [C] old indexes lost (must be empty) ===
(end of lost-index list)          ← 0 条，原有 69 个索引一个没丢

=== [D] newly added indexes (expect 7) ===
replies_author_alive_idx
replies_topic_id_idx
thanks_reply_id_idx
topics_author_alive_idx
topics_content_trgm_idx
topics_title_trgm_idx
votes_topic_id_idx
count_new=7
count_before=69 count_after=76
```

### 3.6 逐项显式断言（真实输出）

```
=== [1] upgrade result counters ===
tables | indexes | journal_rows | pg_trgm
26     | 76      | 3            | 1.6

=== [2] admin credential unchanged (expect 1 / 1) ===
admin_hash_unchanged
1

=== [3] avatar field preserved ===
admin | /uploads/avatars/admin-v003.png
alice | /uploads/avatars/alice-avatar-v003.png
bob   | <NULL>

=== [4] balance vs ledger consistency ===
users_balance_sum | ledger_amount_sum | ledger_rows
159              | 159              | 6

username | current_balance | ledger_last_after | consistent
admin    | 100             | 100               | OK
alice    | 42              | 42                | OK
bob      | 17              | 17                | OK

=== [5] row counts of key tables ===
users 3 | nodes 2 | topics 2 | replies 2 | credit_ledger 6 | avatars 1
```

**验收 2 结论**：迁移成功、各表行数不变、管理员口令哈希逐字节不变、头像字段（含 NULL）保留、积分余额与账本完全一致、原有索引仍在。**v0.0.3 → v0.0.4 升级不触碰任何业务数据**。

---

## 4. 验收 3：迁移幂等（实跑通过）

在 `v2ex_upg_v004_fresh` 上再连续跑 3 次完整 `migrate`：

```
===== IDEMPOTENCY RUN 1 / 3 =====  exit_code=0  [✓] migrations applied successfully!
===== IDEMPOTENCY RUN 2 / 3 =====  exit_code=0  [✓] migrations applied successfully!
===== IDEMPOTENCY RUN 3 / 3 =====  exit_code=0  [✓] migrations applied successfully!
```

> 每次都会打印 `message: '关系 "__drizzle_migrations" 已经存在, 跳过'` —— 这是 drizzle-kit 的正常幂等提示，**不是错误**。

三次之后核验：

```
tables | indexes | migration_rows | pg_trgm_ext
26     | 76      | 3              | 1

=== duplicate index names (must be 0 rows) ===
(0 rows)

=== 0002 index occurrence counts (each must be 1) ===
replies_author_alive_idx | 1
replies_topic_id_idx | 1
thanks_reply_id_idx | 1
topics_author_alive_idx | 1
topics_content_trgm_idx | 1
topics_title_trgm_idx | 1
votes_topic_id_idx | 1
```

**结论**：无报错、索引不重复、迁移记录不增加。恢复库在 §5 中再做一次「恢复后再 migrate」的空转验证，同样 exit=0。

---

## 5. 验收 4：备份可恢复（实跑通过，含一次真实失败）

### 5.1 备份（升级后的 v0.0.4 库，含 0002 索引与扩展）

```bash
pg_dump -h 127.0.0.1 -p 55433 -U v2ex -d v2ex_upg_v004_old \
  --no-owner --no-acl -f v2ex_upg_v004_postupgrade.sql
gzip -9 -c v2ex_upg_v004_postupgrade.sql > v2ex_upg_v004_postupgrade.sql.gz
```

```
dump_exit=0 plain_size=59686 bytes
gzip_size=7316 bytes
```

### 5.2 ⚠️ 第一次恢复失败（如实记录，未隐藏）

用 `gunzip -c … | psql`（**未加** `--single-transaction`）恢复时：

```
 setval
--------
      2
…
server closed the connection unexpectedly
	This probably means the server terminated abnormally
	before or while processing the request.
connection to server was lost
```

本机共享 PG 实例在长操作中被并发任务中断（保活脚本 `_tools/pg-keepalive.sh` 的存在正是为此）。恢复库残留 **26 表 / 66 索引** 的**半成品状态**。

> 这不是发行版脚本的缺陷：`deploy/restore.sh` 第 63–69 行**已经使用** `psql --single-transaction`。失败的是我这次为模拟 gzip 管道而手写的命令。它恰恰证明了「非原子恢复会留下半成品」，因此下面改用单事务重做。

### 5.3 重建目标库并以单事务恢复（成功）

```bash
dropdb   -h 127.0.0.1 -p 55433 -U v2ex --if-exists v2ex_upg_v004_restore
createdb -h 127.0.0.1 -p 55433 -U v2ex v2ex_upg_v004_restore
psql     -h 127.0.0.1 -p 55433 -U v2ex -d v2ex_upg_v004_restore \
  -X -q -v ON_ERROR_STOP=1 --single-transaction \
  -f v2ex_upg_v004_postupgrade.sql
```

> `dropdb` 只作用于本次自建的 `v2ex_upg_v004_restore`，**未触碰任何禁改库**。

```
dropdb_exit=0
createdb_exit=0
=== restore_exit=0 ===
tables | indexes | journal_rows | trgm
26     | 76      | 3            | 1
```

### 5.4 恢复后全量指纹比对（真实输出）

```
=== full fingerprint sha256: source(old) vs restored ===
fc3512608dd79eac2d0d4704fd18133314f242064b71d668673694a92dfa0a93  ...fp_after.txt
fc3512608dd79eac2d0d4704fd18133314f242064b71d668673694a92dfa0a93  ...fp_restore.txt
RESULT: FULL FINGERPRINT IDENTICAL (data + schema + journal) ✓

=== restored key rows ===
users | topics | replies | ledger | balance_sum | ledger_sum | admin_hash_ok | alice_avatar
3     | 2      | 2      | 6      | 159         | 159        | 1             | /uploads/avatars/alice-avatar-v003.png

=== verify drizzle-kit migrate on restored DB is a no-op ===
migrate_exit=0
[✓] migrations applied successfully!
```

**结论**：`pg_dump` + `psql` 可完整恢复 v0.0.4 库（含 7 个新索引、`pg_trgm`、3 条迁移记录），**完整指纹逐字节一致**，恢复后再跑迁移为空转。

### 5.5 可直接复制的备份/恢复命令（生产版）

```bash
# 备份（等价于 deploy/backup.sh 的核心逻辑）
docker compose exec -T postgres pg_dump \
  --username=v2ex --dbname=v2ex --no-owner --no-acl | gzip -9 > backups/v2ex-$(date +%Y%m%d-%H%M%S).sql.gz

# 恢复到**新库**（先建空库，绝不覆盖在用的库）
docker compose exec -T postgres psql -U v2ex -d postgres \
  -c "CREATE DATABASE v2ex_restore_check;"
gunzip -c backups/v2ex-XXXXXXXX-XXXXXX.sql.gz \
  | docker compose exec -T postgres psql -U v2ex -d v2ex_restore_check \
      --single-transaction --quiet -v ON_ERROR_STOP=1

# 核对后再决定是否切换；切换前先停服
./stop.sh
```

---

## 6. 验收 5：故障恢复（**静态核查**，未实跑容器）

> 本机无 Docker，本节全部结论来自**阅读源码与配置**，不含任何容器故障注入实验。凡标「推断」处均未实跑验证。

### 6.1 Redis 缓存失效：源码事实

| 事实 | 位置 |
|---|---|
| `getKV()` 把 `KV` 实例缓存在模块级 `kvInstance` / `kvInitPromise`，**进程生命周期内只选择一次后端** | `src/lib/kv.ts:152-188` |
| `buildKV()` 仅在首次调用时 `connect()` + `ping()`；成功用 `RedisKV`，失败 `client.disconnect()` 后返回 `PgKV` | `src/lib/kv.ts:155-177` |
| ioredis 配置为 `lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000, retryStrategy: () => null`（**不重连**） | `src/lib/kv.ts:160-165` |
| `RedisKV.clearAll()` 用 `FLUSHDB`；限流计数是瞬态数据，业务数据（用户/主题/回复/积分/会话）全在 PostgreSQL | `src/lib/kv.ts:54-75` |
| Redis 容器开 `appendonly yes` + `redis-data` 卷；PG 与 Redis 默认不暴露宿主机端口 | `deploy/docker-compose.yml:44-56` |

**推论（未实跑）**：Redis **启动前**不可用 → 应用自动降级 PgKV（此路径在 RELEASE_GATE B8 有历史实测）；但 Redis **运行中失效**（容器重启 / 网络闪断）→ 已缓存的 `RedisKV` 不会被重新探测，`retryStrategy: () => null` 使 ioredis 不重连，KV/限流调用可能抛错。**必须重启 app 进程/容器才能重新决策后端**。

**可执行恢复步骤（按顺序）**：

1. 判定：`docker compose ps` 看 `v2ex-redis` 状态；`docker compose logs --tail=100 redis`；在 app 容器内 `redis-cli -a "$REDIS_PASSWORD" ping`。
2. 恢复 Redis：`docker compose --env-file .env restart redis`，等 healthcheck `healthy`；确认 `redis-data` 卷仍在（**严禁 `down -v`**）。
3. **必须重启 app**：`docker compose --env-file .env restart app`，让 `getKV()` 重新 `buildKV()`。仅修 Redis 不重启 app，运行中的进程仍持有失效的 `RedisKV`（静态推断）。
4. 若 Redis 一时修不好，临时把 `.env` 的 `REDIS_URL` 置空 → 重启 app → 全量降级到 `PgKV`（`rate_limit_buckets` + `kv_store`），限流仍生效，业务数据零丢失。恢复 Redis 后再改回并重启。
5. 验证：`GET /` 200、`GET /api/nodes` 200、连续错误登录触发 429（证明限流后端可用）、`GET /api/admin/config` 显示后端状态。
6. 数据影响评估：Redis 里只有限流计数与 KV 缓存，**不涉及用户余额/主题/回复**；丢失最多造成限流窗口重置，不产生资金或内容损失。

### 6.2 PostgreSQL 连接池：源码事实

| 事实 | 位置 |
|---|---|
| 连接池 `postgres(url, { max: DATABASE_POOL_MAX ?? 10, idle_timeout: 20, connect_timeout: 10, prepare: false })` | `src/db/index.ts:33-38` |
| 客户端与 drizzle 实例**惰性创建**并缓存于 `globalThis`，避免 HMR/每次请求新建池 | `src/db/index.ts:21-24, 66-78` |
| 容器启动有 `wait-for-db.mjs` 60 次 × 2s 的等待 | `scripts/docker-entrypoint.sh:37-55` |
| compose 的 app healthcheck 探 `/`，间接验证「Next 就绪 + 数据库可查询」 | `deploy/docker-compose.yml:125-140` |

**推论（未实跑）**：PG 重启后连接池里的旧物理连接失效；`connect_timeout: 10` 限制单次重连；`globalThis` 缓存的池对象不会被重建（但 postgres.js 内部会为后续查询重新建连）。**最稳妥且可预期的恢复动作是重启 app 容器**。

**可执行恢复步骤**：

1. 判定：`docker compose ps`（postgres 是否 healthy）、`docker compose logs --tail=100 postgres`、`pg_isready -U v2ex -d v2ex`。
2. 恢复 PG：`docker compose --env-file .env restart postgres`，等 `service_healthy`；**确认 `postgres-data` 卷未丢失**。
3. `docker compose --env-file .env restart app` —— entrypoint 会重新 `wait_for_database` → `drizzle-kit migrate`（幂等，实跑已验证）→ seed 初始化标记守卫（不碰已有数据）→ `next start`。
4. 验证：healthcheck `healthy`、管理员 `password_hash` 与备份一致、`select count(*) from topics` 与升级前一致、积分 `sum(balance) = sum(credit_ledger.amount)`。
5. 若数据文件损坏：按 §5.5 从最近备份恢复到新库，**先核对指纹再切换**，切换前 `./stop.sh`。

### 6.3 数据库变更与发布顺序（重要设计结论）

`0002_v004_perf_indexes.sql` 是**纯增量 DDL**：7 个 `CREATE INDEX IF NOT EXISTS` + `CREATE EXTENSION IF NOT EXISTS`，**无 DROP / TRUNCATE / DELETE / 改列**（preflight 静态扫描 0 处破坏性语句，实跑也确认数据指纹不变）。因此：

- **可以且应该「先迁移、后发代码」**：老版本代码不依赖新索引，只是查询慢；新索引对老代码完全兼容。
- **回滚代码不需要回滚数据库**：把镜像切回旧 tag 即可，7 个索引留着无害（只是多占空间）。这满足「数据库变更与应用发布解耦、先兼容后清理」。
- 只有将来要做**破坏性**变更（删列/改类型）时，才必须走「扩展 → 兼容双写 → 切换 → 清理」四步，且清理迁移要单独一个版本发布。

---

## 7. 回滚预案

| 触发条件 | 判定方式 | 执行步骤 | 预计耗时 | 验证方式 |
|---|---|---|---|---|
| 0002 迁移执行报错 / 应用启动后接口 5xx | `migrate` 非 0；`GET /api/nodes`、`GET /api/topics/[id]` 非 200；healthcheck `unhealthy` | ① 停新版本流量；② 把 `.env` 的 `V2EX_IMAGE` 改回 `v0.0.3`（或上一个已验证 digest）；③ `docker compose up -d` 就地重建容器（**保留数据卷**）；④ 如已执行 0002，保留 7 个索引即可，无需 DROP | 3–5 min | `GET /` 200、`/api/nodes` 200、管理员可登录、`select count(*) from users` 与升级前一致 |
| 0002 索引必须彻底撤销（仅在确认索引导致回归时） | 明确归因到某个索引（EXPLAIN 对比） | ① `./stop.sh`；② `./backup.sh`；③ `DROP INDEX IF EXISTS` 逐个删 7 个；④ **不要贸然** `DROP EXTENSION pg_trgm`（先查 `pg_depend` 有无其他依赖）；⑤ 从 `drizzle.__drizzle_migrations` 删除第 3 条记录（否则 journal 认为已应用）；⑥ `./start.sh` | 10–15 min | 索引数回到 69；`pg_indexes` 无 0002 索引；数据指纹 `a7335937…` 不变 |
| 数据被误改 / 迁移后数据不一致 | 指纹比对不一致、账本与余额不等 | ① `./stop.sh`；② **恢复到新库**而非覆盖在用库；③ 用 `--single-transaction` 恢复；④ 核对完整指纹；⑤ 确认后再切换连接串；⑥ `./start.sh` | 15–30 min | 完整指纹 `fc3512608…` 一致；`sum(users.balance)=sum(credit_ledger.amount)`；逐用户 `balance = 最后一条 balance_after` |
| Redis 中途失效导致 KV/限流报错 | 应用日志 ioredis 错误；限流接口 5xx | 见 §6.1：恢复 Redis → **重启 app** → 必要时临时清空 `REDIS_URL` 降级 PgKV | 2–5 min | `redis-cli ping` = PONG；错误登录触发 429；业务数据零变化 |
| PG 连接池耗尽 / PG 重启 | `connect_timeout` 报错、响应变慢 | 见 §6.2：恢复 PG → 重启 app → 必要时调 `DATABASE_POOL_MAX`（默认 10） | 3–8 min | healthcheck healthy；指纹一致 |
| 发布后发现安装包拉错镜像（N-01） | 用户报告仍是 v0.0.3 功能；`docker inspect` 镜像 tag | 停止分发该安装包；**不删 Tag、不覆盖 Release 资产**；发布修正版 `v0.0.4` 的新安装包需走完整重新发布流程（同一版本号不得反复删建 Tag，只能由主人裁决是否启用 `v0.0.4.1`） | 需主人裁决 | 见 `docs/RELEASE_PROCESS_v0.0.4.md` §阻断项清单 |

**回滚演练安排**：本轮已在 `v2ex_upg_v004_fresh` / `old` / `restore` 三个隔离库完成「迁移 → 升级 → 备份 → 恢复 → 再迁移」闭环演练（真实数据见 §2–§5）。**容器级回滚（改镜像 tag、重启、健康检查）因本机无 Docker 未演练**，需在 CI `install-verify.yml` 的 Linux 真实 Docker job 中补做：升级到候选镜像 → 回滚到基线镜像 → 校验 `password_hash` 与主题数不变。

---

## 8. 验收 6：安装包静态核查（**未实跑容器**）

### 8.1 文件存在性

`deploy/` 下 14 个文件齐全：`docker-compose.yml`、`.env.example`、`install.sh`、`install.ps1`、`start.sh`、`stop.sh`、`update.sh`、`backup.sh`、`restore.sh`、`README.md`、`INSTALL.md`、`VERSION`、`LICENSE`、`.dockerignore`。

> **如实说明**：团队任务描述里提到「Windows 安装脚本（`.ps1`/`.bat`）」，但**全仓库 `Glob **/*.{bat,cmd}` 返回 `No files found`** —— 只有 `install.ps1`，**不存在任何 .bat/.cmd 脚本**，因此没有 .bat 可核查。

### 8.2 本机可做的脚本级实跑（不等于容器安装）

| 检查 | 真实结果 |
|---|---|
| `od -An -tx1 -N3 deploy/install.ps1` | `ef bb bf` —— UTF-8 BOM 存在（PowerShell 5.1 解析必需） |
| PowerShell 5.1 `Parser::ParseFile` | `PARSE_ERRORS=0 (syntax OK)`，`PS_VERSION=5.1.26100.9168` |
| `bash -n deploy/*.sh`（6 个） | 全部 `syntax OK`：`backup.sh / install.sh / restore.sh / start.sh / stop.sh / update.sh` |
| `git ls-files \| grep .env` | 无被跟踪的 `.env` 系列（仅 `.env.example`） |
| `command -v docker` | `docker NOT FOUND` |

### 8.3 0002 迁移是否被安装流程覆盖（静态链路核查）

链路结论：**代码链路已覆盖，但当前版本号不覆盖**。

```
.dockerignore:57-58   *.sql 排除，但 !drizzle/*.sql 白名单 → 0002 SQL 进构建上下文
Dockerfile:39         COPY --from=builder /app/drizzle ./drizzle
Dockerfile:41         COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
drizzle/meta/_journal.json  含 0002_v004_perf_indexes（idx=2）
scripts/docker-entrypoint.sh:58-62  阶段 1：node node_modules/drizzle-kit/bin.cjs migrate
deploy/docker-compose.yml:125-140   app healthcheck 探 /（迁移未完成则不会 healthy）
deploy/update.sh:57-72  docker compose pull → up -d → 容器重启自动重跑 migrate
```

即：**只要镜像是 v0.0.4，全新安装与升级都会自动应用 0002**（与 §2/§3 实跑一致）。

**⛔ 但当前所有发行版版本标记仍是 `0.0.3`**：

| 文件 | 当前值 | 应为 |
|---|---|---|
| `deploy/install.sh:26-27` | `APP_VERSION="0.0.3"` / `DEFAULT_IMAGE=…:v0.0.3` | `0.0.4` / `v0.0.4` |
| `deploy/install.ps1:24-25` | `$AppVersion='0.0.3'` / `$DefaultImage=…:v0.0.3` | 同上 |
| `deploy/.env.example:15` | `V2EX_IMAGE=…:v0.0.3` | `v0.0.4` |
| `deploy/docker-compose.yml:76` | 默认镜像 `…:v0.0.3` | `v0.0.4` |
| `deploy/update.sh:38` | 默认镜像 `…:v0.0.3` | `v0.0.4` |
| `deploy/VERSION` | `0.0.3` | `0.0.4` |
| `package.json:3` | `"version": "0.0.3"` | `0.0.4` |
| `deploy/README.md` / `INSTALL.md` / 其余 .sh 注释 | `v0.0.3` | `v0.0.4` |
| `.github/workflows/release.yml:55-56` | tag 白名单仅 `v0.0.2` / `v0.0.3` | **必须加入 `v0.0.4`** |
| `.github/workflows/release.yml:1175` | Release Notes 硬编码 `## v0.0.1 — 开发预览版` | 改为 v0.0.4 |

**后果（关键新风险）**：

1. 现在打出的 v0.0.4 安装包，`install.sh` / `install.ps1` 会去拉 **v0.0.3 镜像** —— 镜像内没有 0002，用户拿到的其实是旧版，0002 索引与性能优化全部缺失。
2. 已安装 v0.0.3 的用户执行 `./update.sh`（**不带 `--version`**）**不会升级到 v0.0.4**：`update.sh` 从 `.env` 读 `V2EX_IMAGE`，而 `.env` 是首次安装时写入的 `v0.0.3` 且脚本幂等不覆盖。`docker compose pull` 只会重拉 v0.0.3。
   ⚠️ **收尾轮已修（R-18）**：新写法 `./update.sh --version v0.0.4` 会**自动改写 `.env` 的 `V2EX_IMAGE`** 并在失败时**自动回滚**（镜像与 `.env` 双恢复）。自检 `bash scripts/release/verify-update-script.sh` → **62 项断言全 PASS / 0 FAIL**。⚠️ **真实容器级升级仍需带 Docker 的环境复跑**（并入 R-16 重跑批次）。
3. `deploy/VERSION` 无任何脚本读取（grep 零命中），是纯元数据，但仍必须同步以免文档/审计不一致。

> 修复动作属于 `deploy/**`、`package.json`、`.github/workflows/**`，**均在我的所有权边界之外**，本轮只报告不修改，已列入 `docs/RELEASE_PROCESS_v0.0.4.md` 的阻断项清单。

### 8.4 参数一致性（静态比对）

`install.sh` / `install.ps1` 都会替换 5 个键：`POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`SESSION_SECRET`、`SEED_ADMIN_PASSWORD`、`V2EX_IMAGE`；`deploy/.env.example` 中 5 个键均存在且留空/占位；`docker-compose.yml` 用 `:?` 强制校验 `POSTGRES_USER/PASSWORD/DB`、`REDIS_PASSWORD`、`SESSION_SECRET`、`SEED_ADMIN_PASSWORD`，无弱默认值；`TRUST_PROXY_HEADERS` 默认 0。**参数一致，无明文口令**。

### 8.5 明确「只做了静态核查、没有实跑」的部分

- ❌ 未运行 `install.sh` / `install.ps1` 端到端安装（无 Docker daemon）
- ❌ 未运行 `docker compose config` / `up -d` / healthcheck / 重启持久化 / 端口不暴露验证
- ❌ 未验证 `update.sh` 的真实升级、`backup.sh`/`restore.sh` 在容器内的行为（只在本机 PG 上用等价 `pg_dump`/`psql` 命令实跑）
- ❌ 未验证 Windows NTFS ACL（`icacls`）与 Git Bash `chmod` 分支
- ❌ 未验证 GHCR 镜像可拉取性（本轮不访问网络；主理人已实测 v0.0.3 镜像公开可拉取）
- ✅ 上述容器级验证由 CI `install-verify.yml`（Linux 真实 Docker + Windows PS 5.1/Git Bash 逻辑分支）覆盖，**但需在 v0.0.4 发布前重新跑一次并记录 run id**

---

## 9. 环境 / 编排 / 流水线 / 观测 补充（部署运维视角）

### 9.1 环境规划

| 环境 | 用途 | 数据来源 | 配置来源 | 访问权限 |
|---|---|---|---|---|
| 本地开发 | 功能开发 | 本地 `v2ex`（5432）或容器卷 | `.env.local`（不入库） | 开发者本人 |
| 本轮隔离验证 | 安装/升级/恢复实跑 | 自建 `v2ex_upg_v004_*` | 系统 Temp 的 `.env`（含本机测试口令） | 仅本任务 |
| CI 单元/E2E | 干净克隆回归 | 每次 run 新建 `v2ex_ci` / `v2ex_release_unit` / `v2ex_release_e2e` | workflow 内随机口令（`github.run_id`） | 仅 runner |
| 预发 / RC | 发布流程演练（`v0.0.4-rc.1`） | 独立库、独立镜像 tag、Draft Release | `workflow_dispatch` 输入 + 非正式流水线 | 团队内部 |
| 生产（发行包） | 用户自助安装 | `postgres-data` / `redis-data` 卷，**升级不删卷** | `install.sh`/`install.ps1` 生成的 `.env`（权限 600 / NTFS ACL） | 用户本机 |

四层环境与流量/数据隔离由 `COMPOSE_PROJECT_NAME=v2ex` + 独立卷 + 随机口令保证；生产不暴露 5432/6379 到宿主机。

### 9.2 容器化与编排要点（静态核查）

- 镜像：`Dockerfile` 多阶段 `deps → builder → runner`，runner 用 `npm ci --omit=dev`、`USER nextjs`(uid 1001)，并把 `drizzle-kit` / `tsx` 上移到 `dependencies` 以保证 entrypoint 迁移可用。
- 编排：`deploy/docker-compose.yml` 三服务（postgres / redis / app），`depends_on: service_healthy`，app healthcheck 用镜像内 `node` 探 `/`，`start_period: 90s` 覆盖冷启动迁移。
- 资源/伸缩：当前为单机 Compose，**未设置 CPU/内存 limits 与 replicas**（静态事实）。单机部署建议至少 2 GB 磁盘；生产若需水平扩展，须先把会话/KV/限流全部外置（目前 Redis 已外置，PG 单点是扩展瓶颈）。
- 优雅停机：`stop.sh` 用 `docker compose stop`（保留卷），**任何脚本都不执行 `down -v`**（`install-verify.yml` 有专门断言）；`restore.sh` 要求先停服。

### 9.3 CI/CD 阶段与质量门禁（结合仓库实际）

| 阶段 | 步骤 | 质量门禁 | 失败处理 |
|---|---|---|---|
| 校验 | `ci.yml: unit` → `npx tsc --noEmit`、`node scripts/ui-verify.cjs` | 0 类型错误；API 契约 72 路由/30 调用全匹配 | 红灯，后续 job 不跑 |
| 构建 | `npm run build`；`Dockerfile` 真实 `docker build` | 构建成功；镜像含 `public/`；builder 阶段无 DB 可构建 | 红灯 |
| 测试 | 单元 `vitest run`、E2E `playwright test` | **190 单元 / 15 文件**（190 passed / 0 failed / 0 skipped，连续 4 轮全绿）/ **E2E 154 条 / 11 文件**（`--list` 实测 `Total: 154 tests in 11 files`）—— v0.0.4 实测权威值。**本地历史轮次口径**：153 passed / 0 failed / 0 skipped，连续 2 轮全绿（基于 153 条口径、早于 `ed385cf`）；**当前 CI：153 passed \| 1 failed \| 154 total**（run `41873009808`） | 红灯，`needs` 依赖阻断 |
| 镜像 | `release.yml: build-image` | `provenance`/`sbom`，校验镜像内无 `.env` 与 `docs/evidence` | 红灯；`dry_run=true` 时只 `load` 不 `push` |
| 部署验证 | `release.yml: deploy-verify` | compose 真实启动 → healthy → 管理员创建 → 注册探针用户 → 重启持久化 → 5432/6379 未暴露 | 红灯并上传日志 |
| 安全 | `security-scan` | `npm audit` critical/high = 0；gitleaks 只扫 Git 跟踪文件；发布包内容检查 | 红灯 |
| 安装包 | `package` | 14 文件齐全 + SHA256SUMS + 无 `.env`/凭据/原站素材 | 红灯 |
| 发布 | `publish-release` | `dry_run != true` 才调度；**默认保持 Draft**（`publish` 默认 false） | 竞态二次检查后中止 |
| 核验 | `verify-release` | 远端只读核验 Release 资产、GHCR 带凭据拉取 + 匿名 Bearer 探测 | 红灯 |

制品追溯：镜像同时打 `v0.0.4` 与 `sha-<SHA>` 两个 tag（**刻意不生成 latest**），Release 资产带 `SHA256SUMS`，`org.opencontainers.image.revision` 记录 SHA。人工审批卡点：`publish` 输入（`boolean`, default `false`）与「主人对 R-01 历史清理的单独授权」。

### 9.4 发布策略与放量

发行包是**用户自助单机安装**，没有中心化流量，无法做按用户/租户灰度。因此采用「**预发布版本 + 全量替换**」：

- 先用 `v0.0.4-rc.1` 在独立测试版本与非正式流水线跑通全流程（详见发布流程文档），产物停在 Draft / 不对外分发；
- 正式版只发一个不可变 tag `v0.0.4` + 不可变资产；
- 用户侧升级由 `update.sh` 完成（**前提是先修 N-01 的镜像 tag 固定问题**），回滚由改回镜像 tag 完成（见 §7）。

### 9.5 可观测性与应急（现状为静态事实）

- 日志：当前只有 `docker compose logs` / `deploy-logs.txt` artifact（retention 7 天），**无集中日志采集与留存策略** —— 列为改进项，不阻断本轮。
- 指标/告警：**未接入** Prometheus/AlertManager；`GET /api/admin/config` 可看 Redis 配置状态，`healthcheck` 只探 `/`。告警分级与值班响应流程尚未建立 —— 列为改进项。
- 链路追踪：未接入。
- 应急最小闭环（本轮可落地）：`docker compose ps` → `logs --tail=200` → `restart app` → 指纹比对 → 必要时从备份恢复到新库。故障复盘要求保留 migrate 输出、指纹文件与容器日志三者。

### 9.6 安全与成本

- 密钥：`.env` 由安装脚本用 `openssl rand -hex` 生成（Linux chmod 600 / Windows `icacls /inheritance:r`），`::add-mask::` 屏蔽 CI 日志；`deploy/.env` 与 `INSTALL_CREDENTIALS.txt` 被 `.gitignore` 与发布包检查双重排除。**密钥绝不进代码库**。
- 证书：发行包默认 `http://localhost:3000`，文档已提示需反向代理 + HTTPS；证书由用户自备，不在本仓库托管。
- 漏洞扫描：`npm audit`（critical/high 阻断）、gitleaks（只扫 Git 跟踪文件）；**容器镜像 Trivy/Grype 扫描仍未接入**（RELEASE_GATE E9 已标「部分未做」）。
- 大模型 API Key：本项目**不涉及**任何大模型 API，故无 Key 轮换与配额告警需求；若将来引入，必须走环境变量 + 独立轮换周期 + 用量预算告警，不得写入 `.env.example` 的示例值。
- 成本：单机 Compose 无固定成本，主要是 GHCR 存储与 Actions 分钟数；`build-image` 用 `cache-from/to: type=gha`，`dry_run` 镜像归档 retention 1 天、安装包 30 天。**建议**对 GHCR 存储与 Actions 用量设置预算告警（当前未设置，属改进项）。

---

## 10. 可复现命令清单（从零到尾）

> ⚠️ **端口口径**：下方命令清单是**本报告执行时点（55433）的原文**，**保留不改**。
> **当前测试环境指向哪个端口**：按 `.env.test` 实际解析的端口（**当前 55440**）——
> 复跑时请把命令中的 `55433` 替换为 `.env.test` 里实际解析出的端口。

```bash
# 0) 工具与保活（PG 会空闲断连，每个长操作前跑一次）
PGBIN="C:/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin"
export PGPASSWORD=v2ex_password PGCLIENTENCODING=UTF8
bash "C:/Users/TYMO001/WorkBuddy/ai/_tools/pg-keepalive.sh"

# 1) 只创建自己的库（前缀 v2ex_upg_v004_）
for db in v2ex_upg_v004_fresh v2ex_upg_v004_old v2ex_upg_v004_restore; do
  "$PGBIN/createdb.exe" -h 127.0.0.1 -p 55433 -U v2ex "$db"
done

# 2) env 文件（系统 Temp，不进仓库）
printf 'DATABASE_URL=postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_upg_v004_fresh\n' \
  > "C:/Users/TYMO001/AppData/Local/Temp/v2ex_upg_v004_fresh.env"
#    old.env / restore.env 同理

cd "C:/Users/TYMO001/WorkBuddy/ai/v2ex-clone"

# 3) 全新安装
ENV_FILE="C:/Users/TYMO001/AppData/Local/Temp/v2ex_upg_v004_fresh.env" \
DATABASE_URL="postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_upg_v004_fresh" \
  npx drizzle-kit migrate

# 4) 结构核验
"$PGBIN/psql.exe" -h 127.0.0.1 -p 55433 -U v2ex -d v2ex_upg_v004_fresh -X -A -F ' | ' -c \
"select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';"
"$PGBIN/psql.exe" -h 127.0.0.1 -p 55433 -U v2ex -d v2ex_upg_v004_fresh -X -A -F ' | ' -c \
"select indexname,tablename from pg_indexes where schemaname='public' and indexname in
 ('thanks_reply_id_idx','replies_author_alive_idx','topics_author_alive_idx',
  'votes_topic_id_idx','replies_topic_id_idx','topics_title_trgm_idx','topics_content_trgm_idx')
 order by indexname;"

# 5) 幂等：连跑 3 次（同一条命令重复 3 遍），再用上面的计数确认 26/76/3 不变
for i in 1 2 3; do
  ENV_FILE="C:/Users/TYMO001/AppData/Local/Temp/v2ex_upg_v004_fresh.env" \
  DATABASE_URL="postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_upg_v004_fresh" \
    npx drizzle-kit migrate; echo "run$i exit=$?"
done

# 6) v0.0.3 基线（只应用 0000+0001 + 真实 journal 前两条）
"$PGBIN/psql.exe" -h 127.0.0.1 -p 55433 -U v2ex -d v2ex_upg_v004_old \
  -X -v ON_ERROR_STOP=1 -q -f drizzle/0000_init.sql -f drizzle/0001_striped_magdalene.sql
#  再按 §3.1 建 drizzle.__drizzle_migrations 并插入 fresh 库读出的前两条 hash/when
#  再按 §3.2 插入自洽数据集

# 7) 指纹 + 升级前备份
"$PGBIN/psql.exe" -h 127.0.0.1 -p 55433 -U v2ex -d v2ex_upg_v004_old \
  -X -t -A -F '|' -f scripts/release/fingerprint.sql > fp_before.txt
grep -v '^schema\.' fp_before.txt > data_before.txt && sha256sum data_before.txt
"$PGBIN/pg_dump.exe" -h 127.0.0.1 -p 55433 -U v2ex -d v2ex_upg_v004_old \
  --no-owner --no-acl -f preupgrade.sql

# 8) 增量升级（只应用 0002）
ENV_FILE="C:/Users/TYMO001/AppData/Local/Temp/v2ex_upg_v004_old.env" \
DATABASE_URL="postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_upg_v004_old" \
  npx drizzle-kit migrate

# 9) 升级后比对
"$PGBIN/psql.exe" -h 127.0.0.1 -p 55433 -U v2ex -d v2ex_upg_v004_old \
  -X -t -A -F '|' -f scripts/release/fingerprint.sql > fp_after.txt
grep -v '^schema\.' fp_after.txt > data_after.txt
cmp -s data_before.txt data_after.txt && echo "DATA FINGERPRINT IDENTICAL"
diff fp_before.txt fp_after.txt   # 只应出现 5 行 schema.* 变化

# 10) 备份 + 单事务恢复
"$PGBIN/pg_dump.exe" -h 127.0.0.1 -p 55433 -U v2ex -d v2ex_upg_v004_old \
  --no-owner --no-acl -f postupgrade.sql
gzip -9 -c postupgrade.sql > postupgrade.sql.gz
"$PGBIN/dropdb.exe" -h 127.0.0.1 -p 55433 -U v2ex --if-exists v2ex_upg_v004_restore
"$PGBIN/createdb.exe" -h 127.0.0.1 -p 55433 -U v2ex v2ex_upg_v004_restore
gunzip -c postupgrade.sql.gz | "$PGBIN/psql.exe" -h 127.0.0.1 -p 55433 -U v2ex \
  -d v2ex_upg_v004_restore -X -q -v ON_ERROR_STOP=1 --single-transaction
"$PGBIN/psql.exe" -h 127.0.0.1 -p 55433 -U v2ex -d v2ex_upg_v004_restore \
  -X -t -A -F '|' -f scripts/release/fingerprint.sql > fp_restore.txt
cmp -s fp_after.txt fp_restore.txt && echo "FULL FINGERPRINT IDENTICAL"

# 11) 只读发布前检查（不写、不联网）
bash scripts/release/preflight.sh
```

---

## 11. 限制、失败与新发现风险

### 11.1 本轮真实失败

1. **首次恢复中断**（§5.2）：`server closed the connection unexpectedly`，恢复库残留 26 表/66 索引。原因：本机共享 PG 实例被并发任务中断 + 我的临时命令未加 `--single-transaction`。已通过重建目标库 + 单事务恢复解决；发行版 `deploy/restore.sh` 本身已具备该保护。
2. **`preflight.sh` 首版 bug**：`grep -c ... || echo 0` 在无匹配时输出两行 `0`，导致 `[: 0\n0: integer expected` 与一条误报 FAIL。已修正为 `grep -c ... | head -1` 并重跑（真实输出见发布流程文档）。

### 11.2 未验证 / 限制

- 无 Docker：容器安装、升级、健康检查、重启持久化、端口不暴露、Redis/PG 故障注入**全部未实跑**。
- 未验证真实 GHCR 镜像内容与 digest（本轮不访问网络）。
- 未验证 CI `install-verify.yml` 在 v0.0.4 上的 run（需在发布前重新跑并记录 run id）。
- 未验证 `pg_trgm` **权限不足**降级分支（本机有权限，走的是成功路径）；该分支只做了静态阅读。
- Node `v22.22.2` < `engines >=22.23.4`，迁移工具链实跑正常但版本差异未在 CI 版本上复验。

### 11.3 新发现风险（已同步 team-lead）

| 编号 | 风险 | 等级 | 建议动作 |
|---|---|---|---|
| **N-01** | 发行版所有版本标记仍为 `0.0.3`：安装包会拉 v0.0.3 镜像（无 0002），且已装用户 `update.sh` 因 `.env` 中 `V2EX_IMAGE` 固定而无法升级 | 🔴 **阻断发布** | 发布前统一改 10+ 处版本字面量；升级文档明确「先改 `.env` 的 `V2EX_IMAGE` 再 `./update.sh`」。⚠️ **收尾轮进展（R-18 已修）**：`deploy/update.sh` 已重写（`b0d68c2`），新增 `--version vX.Y.Z` **自动改写 `V2EX_IMAGE`** + 失败自动回滚；`verify-update-script.sh` **62 项断言全 PASS**。**版本字面量的统一同步仍待第 9 步「固定最终 SHA」时一次性执行（R-20 裁决）** |
| **N-02** | `getKV()` 一次性选择后端并缓存 + `retryStrategy: () => null` → Redis 运行中失效不会自动降级 | 🟠 高 | 恢复步骤强制「重启 app」；长期建议加健康探测与自动重选后端 |
| **N-03** | `release.yml` tag 白名单无 `v0.0.4`（流水线不触发）；内置 Release Notes 硬编码 `v0.0.1`（说明会写错版本） | 🔴 **阻断发布** | 发布前加白名单条目 + 改 Release Notes 模板 |
| **N-04** | `deploy/update.sh` 没有引导用户改镜像 tag，升级路径存在断点 | 🟠 高 | ✅ **收尾轮已修（R-18）**：`deploy/update.sh` 已重写并实现 `--version` 自动 tag 同步 + 失败自动回滚；`INSTALL.md` §8 的手工步骤**仍保留**（不带 `--version` 时是向后兼容路径）；自检 62 项断言全 PASS |
| **N-05** | 0002 的 `pg_trgm` 权限不足时**静默跳过** trigram 索引（设计如此），但无告警/监控，生产可能「迁移成功但索引没建」 | 🟡 中 | 发布后核验 `pg_extension` 与 7 个索引（本报告 §2.3 的查询可直接复用），并接入告警 |
| **N-06** | 本机共享 PG 空闲断连导致非原子恢复留下半成品 | 🟡 中（本机环境） | 生产一律 `--single-transaction`；`deploy/restore.sh` 已具备 |
| **N-07** | `deploy/VERSION` 无任何脚本读取（grep 零命中），纯元数据易漏改 | 🟢 低 | 纳入 `preflight.sh` 版本一致性检查（已实现） |

### 11.4 仍待主人裁决（不在本轮授权范围）

- `RISK_REGISTER.md` **R-01**（Git 历史原站素材经远端 refs 匿名可达）状态 **DEFERRED**。隔离副本演练已成功，但**远端历史改写 / force push / 移动 v0.0.1 Tag / 改仓库可见性均需主人单独授权**，本轮未执行。
- 因此即使代码与数据库全部通过，v0.0.4 的 Release 也**只能停在 Draft**，未经单独授权不得公开发布。

---

## 12. 交付物

| 文件 | 说明 |
|---|---|
| `docs/UPGRADE_RECOVERY_v0.0.4.md` | 本报告（新建） |
| `docs/RELEASE_PROCESS_v0.0.4.md` | 第八阶段发布流程（新建） |
| `scripts/release/fingerprint.sql` | **只读**数据/结构指纹脚本（新建） |
| `scripts/release/preflight.sh` | **只读**发布前检查脚本（新建，无写操作/无远端操作） |

> 本轮未执行 `git commit`（由主理人统一提交）；未创建/删除任何 Tag 或 Release；未修改任何现有受保护文件。
