# 压测数据生成器

为 V2EX Clone 生成**大规模、可重复**的论坛数据集，供 k6 / 直连压测使用。

脚本：`scripts/loadtest/seed-large.ts`

---

## ⚠️ 安全警告

**这些数据绝对不能写入开发库或生产库。**

脚本内置安全闸门：

- 目标库名必须包含 `loadtest` / `perf` / `stress` / `bench` 之一，否则**直接退出**（退出码 3）。
- 确实需要写入其他名字的隔离临时库时，必须显式加 `--allow-any-db`。
- `--truncate` 会**清空目标库的全部 26 张业务表**。不指定 `--truncate` 时，脚本要求主表
  （users / categories / nodes / topics / replies）为空，否则报错退出 —— 避免在已有数据上叠加，
  导致行数与目标值对不上。

```console
$ npx tsx scripts/loadtest/seed-large.ts --db=postgres://v2ex:***@127.0.0.1:55433/v2ex_e2e ...
✗ 拒绝执行：目标库 "v2ex_e2e"（127.0.0.1:55433）的库名不含 "loadtest" / "perf" / "stress" / "bench"。
  本脚本只允许写入隔离的压测库。
  如果你确认这是一个隔离的临时库，可以加 --allow-any-db 强制执行。
```

---

## 快速开始

### 1. 创建压测库并迁移表结构

```bash
PSQL="C:/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/psql.exe"

"$PSQL" -h 127.0.0.1 -p 55433 -U v2ex -d postgres -c "CREATE DATABASE v2ex_loadtest;"
DATABASE_URL="postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_loadtest" npx drizzle-kit migrate
```

### 2. 冒烟模式（几秒跑完，先验证脚本本身没问题）

```bash
npx tsx scripts/loadtest/seed-large.ts \
  --users=100 --nodes=10 --topics=1000 --replies=5000 \
  --db=postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_loadtest \
  --truncate
```

### 3. 完整规模

```bash
npx tsx scripts/loadtest/seed-large.ts \
  --users=10000 --nodes=1000 --topics=100000 --replies=1000000 \
  --seed=20261104 \
  --db=postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_loadtest \
  --batch=5000 --truncate
```

---

## 命令行参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--users=N` | 10000 | 用户数量 |
| `--nodes=N` | 1000 | 节点数量 |
| `--topics=N` | 100000 | 主题数量 |
| `--replies=N` | 1000000 | 回复数量 |
| `--seed=N` | 20261104 | 随机种子，决定整个数据集 |
| `--db=URL` | 读环境变量 `DATABASE_URL` | PostgreSQL 连接串 |
| `--batch=N` | 5000 | 每批插入的回复条数 |
| `--truncate` | 关闭 | 生成前清空目标库（会打印警告） |
| `--allow-any-db` | 关闭 | 放宽安全闸门，允许写入库名不含关键字的库 |
| `--help` | — | 显示用法 |

所有参数都做严格校验，非法值直接退出（退出码 2）并打印用法：

- 整数参数拒绝 `"12abc"` / `"1.5"` / `""` / `"0x10"`；
- `--users` / `--nodes` / `--topics` 必须 ≥1，`--replies` ≥0；
- `--replies` 不能小于 `--topics`（每个主题至少 1 条回复，否则楼层号无从分配）；
- `--batch` 上限 200000。

---

## 数据规模与实测性能

### 完整规模实跑输出（真实记录）

环境：Windows 11 · PostgreSQL 17.5（127.0.0.1:55433）· 单事务写入

```
▶ 压测数据生成器
  目标数据库 : v2ex_loadtest  (127.0.0.1:55433)
  完整连接串 : postgres://v2ex:***@127.0.0.1:55433/v2ex_loadtest
  目标规模   : users=10000  nodes=1000  topics=100000  replies=1000000
  seed       : 20261104
  时间锚点   : 2026-11-04T00:00:00.000Z（所有时间戳基于它，保证可重复）
  batch      : 5000

  ⚠⚠⚠  警告：--truncate 已指定，即将清空目标库的全部业务表  ⚠⚠⚠
     目标库：v2ex_loadtest（127.0.0.1:55433）
     清空范围：26 张表（业务数据将全部丢失）

  ✓ 已清空 26 张表
  ✓ categories: 9
  ✓ users: 10000
  ✓ nodes: 1000（顶层 400 / 二级 400 / 三级 200）
  ✓ topics: 100000（每主题 10~11 条回复）
  ✓ replies: 1000000（200 批）
  ✓ votes
  ✓ collections / follows / notifications
  ✓ credit_ledger / daily_checkins / sessions

▶ 生成完成，开始统计

═══ 生成结果 ═══
  目标库       : v2ex_loadtest (127.0.0.1:55433)
  seed         : 20261104
  总耗时       : 3m4.0s
  批次数       : 200（回复分批插入）
  事务数       : 1（单个事务，失败即全量回滚）
  总行数       : 3513106
  写入速度     : 19089 行/秒

  表名                        实际行数          目标      达成
  ──────────────────────────────────────────────────
  login_attempts            5000           —       —
  rate_limit_buckets         500           —       —
  kv_store                     1           —       —
  email_logs                 1000           —       —
  password_reset_tokens         500           —       —
  edit_history                2000           —       —
  moderation_logs             1000           —       —
  reports                      500           —       —
  node_requests                100           —       —
  avatars                     2000           —       —
  daily_checkins           49990           —       —
  credit_ledger          1159990           —       —
  sessions                    1000           —       —
  notifications               4783           —       —
  thanks                    189898           —       —
  votes                   840039           —       —
  collections                 9748           —       —
  follows                    29998           —       —
  floor_counters          100000      100000    100%
  topic_tags                  4000           —       —
  tags                          50           —       —
  replies                1000000     1000000    100%
  topics                  100000      100000    100%
  nodes                       1000         10    100%
  categories                   9           9    100%
  users                      10000       10000    100%

  确定性指纹（同 seed 应完全一致，不同 seed 应完全不同）:
    replies    -688959893895
    topics     -152838164644
    nodes      -2111021357
    users      4855192190

  分步耗时:
    truncate               863ms
    password hash          630ms
    categories             10ms
    users                 491ms
    nodes                  61ms
    topics               9.58s
    replies             36.60s
    replies_count 回填       9.02s
    votes                40.74s
    thanks               1m6.3s
    collections           650ms
    follows              1.39s
    notifications         1.97s
    sessions              2.01s
    daily_checkins         1.14s
    credit_ledger        54.78s

✓ 压测数据集生成完成
```

### 冒烟模式实跑输出（真实记录）

```
▶ 压测数据生成器
  目标数据库 : v2ex_loadtest  (127.0.0.1:55433)
  完整连接串 : postgres://v2ex:***@127.0.0.1:55433/v2ex_loadtest
  目标规模   : users=100  nodes=10  topics=1000  replies=5000
  seed       : 20261104
  时间锚点   : 2026-11-04T00:00:00.000Z（所有时间戳基于它，保证可重复）
  batch      : 5000

  ⚠⚠⚠  警告：--truncate 已指定，即将清空目标库的全部业务表  ⚠⚠⚠
     目标库：v2ex_loadtest（127.0.0.1:55433）
     清空范围：26 张表（业务数据将全部丢失）

  ✓ 已清空 26 张表
  ✓ categories: 9
  ✓ users: 100
  ✓ nodes: 10（顶层 4 / 二级 4 / 三级 2）
  ✓ topics: 1000（每主题 5~6 条回复）
  ✓ replies: 5000（1 批）
  ✓ votes
  ✓ collections / follows / notifications
  ✓ credit_ledger / daily_checkins / sessions

═══ 生成结果 ═══
  总耗时       : 4.33s
  批次数       : 1（回复分批插入）
  事务数       : 1（单个事务，失败即全量回滚）
  总行数       : 24073
  写入速度     : 5553 行/秒

  replies                   5000        5000    100%
  topics                    1000        1000    100%
  nodes                       10          10    100%
  categories                   9           9    100%
  users                      100         100    100%
```

### 性能数据与推算

| 指标 | 实测值 |
|---|---|
| 完整规模总耗时 | **3m4.0s**（约 184 秒；三次实测 2m55s ~ 3m4s） |
| 完整规模总行数 | **3,513,106** |
| 平均写入速度 | **约 19,100 ~ 20,100 行/秒** |
| 其中 100 万条回复 | **36.6 秒**（约 27,300 行/秒） |
| 其中 116 万条积分流水 | 54.8 秒 |
| 其中 84 万条投票 | 40.7 秒 |
| 冒烟模式 | 4.3 秒（24,073 行） |

**推算**：100 万条回复的插入本身约需 **37 秒**；整个 10000 用户 / 1000 节点 / 10 万主题 /
100 万回复的数据集端到端约需 **3 分钟**。若把回复数提到 500 万，按线性外推约需
**8~10 分钟**（内存与 WAL 压力会上升，实际可能更久）。

瓶颈在**关系表**（votes / thanks / credit_ledger）而非回复本身 —— 它们各有几十万到上百万行，
且涉及自连接与窗口函数。压测若只关心内容读取路径，可以考虑后续给这几张表加单列索引
（`votes.topic_id`、`thanks.reply_id`），当前 schema 只有 `(user_id, topic_id)` 复合索引。

---

## 可重复性（deterministic）

**同一个 seed 一定产出完全相同的数据集。**

实现方式：**不使用** `random()` / `setseed()`（后者的行为随 PostgreSQL 版本漂移），
而是用 seed 派生的**确定性哈希**：

```sql
-- R(seed, key) = 把 md5(seed || ':' || key) 的前 8 位十六进制当作有符号 32 位整数，映射到 [0,1)
(('x' || substr(md5(20261104::text || ':' || 'user:' || g), 1, 8))::bit(32)::int + 2147483648.0) / 4294967296.0
```

- **时间锚点**：seed 被当作 `YYYYMMDD` 解析成一个日期（默认 seed 20261104 → 2026-11-04），
  所有时间戳都落在 `[锚点 - 2 年, 锚点]` 区间内。用固定锚点而不是 `now()` ——
  否则同一 seed 两次运行会差几毫秒，数据集就不可重复了。
  想让「过去 2 年」对齐真实时间，把 seed 设成今天的日期即可。
- **幂律分布**：作者/投票人按 Zipf 近似分布（`u^alpha`），模拟真实的「少数水军账号贡献大部分内容」，
  这样才能压出真实的索引热点行竞争。
- **确定性指纹**：脚本结束时会打印 4 张主表的校验和。**同 seed 两次运行必须完全一致**，
  不同 seed 必须完全不同。

已验证：

```console
# 同 seed 跑两次（冒烟规模与完整规模各验证一次）
$ npx tsx scripts/loadtest/seed-large.ts --seed=20261104 ... | grep -A5 确定性指纹
    replies    -688959893895
    topics     -152838164644
    nodes      -2111021357
    users      4855192190
# → 两次输出完全相同（diff 无差异）；完整规模重跑一次，指纹仍是上面这组

# 换 seed
$ npx tsx scripts/loadtest/seed-large.ts --seed=777 ... | grep -A5 确定性指纹
    replies    -13648787560
    topics     -22970221941
    nodes      -4257907482
    users      15262719535
# → 指纹完全不同
```

**唯一的例外是 `users.password_hash`** —— 它含随机盐（scrypt 的设计），因此每个用户的哈希串
互不相同。哈希**格式**与**语义**仍然完全确定（见下）。

---

## 遵守的业务约束

### 密码哈希复用（重要）

`users.password_hash` 使用 `src/lib/password.ts` 的 `hashPassword()` 生成 —— 是**合法哈希**，
`verifyPassword()` 能通过（脚本每次运行都会自检）。

但 scrypt 很贵（每次约 100ms），10000 个用户各生成一次要 15 分钟。因此：

- 脚本只生成 **5 个哈希值**，10000 个用户按 `(id - 1) % 5` 循环复用。
- 这 5 个哈希对应的明文口令是 `loadtest-password-<seed>-0` … `loadtest-password-<seed>-4`，
  压测时可用它们登录任意用户（用户名为 `lt_000001` 起）。
- 复用只影响「不同用户的哈希串相同」这一点，不影响登录功能。
- **只适用于压测库** —— 绝不要在真实用户库复用哈希（彩虹表风险）。

实跑验证：

```console
SELECT count(*) FILTER (WHERE password_hash LIKE 'scrypt$%') AS fmt_ok,
       count(*) AS total, count(DISTINCT password_hash) AS distinct_hashes FROM users;
--  fmt_ok | total | distinct_hashes
--    10000 |  10000 |               5
```

### 其它约束

| 约束 | 实现方式 | 实跑验证 |
|---|---|---|
| `replies` 的 `(topic_id, floor)` 唯一 | floor = 1..n（主题内连续） | 重复组 = 0 |
| `topics.replies_count` 只计未删除回复 | 回填时 `WHERE deleted_at IS NULL` | 不符 = 0 |
| `floor_counters` 与实际 max(floor) 一致 | 写入后按 `max(floor)` 回填 | 不符 = 0 |
| `nodes.topics_count` 只计未删除主题 | 回填时 `WHERE deleted_at IS NULL` | 不符 = 0 |
| `topics.votes` = up 数 − down 数 | 与 `voteTopic` 的语义一致 | 不符 = 0 |
| `replies.thanks` = thanks 表行数 | 回填时按 `thanks` 分组计数 | 不符 = 0 |
| `credit_ledger` 流水自洽 | `balance_before + amount = balance_after`，相邻首尾相接，首条 before=0，末条 after=`users.balance` | 4 项全为 0 |
| `credit_ledger.idempotency_key` 唯一 | 按业务语义生成（`reg:<uid>` / `daily_checkin:<uid>:<date>` / `topic_created:<tid>` / `reply_created:<rid>`） | 重复 = 0 |
| `daily_checkins` 的 `(user_id, checkin_date)` 唯一 | 每用户最近 1~14 天连续签到 | 重复 = 0 |
| `nodes.parent_id` 不成环 | **父 id 恒小于子 id**，从结构上排除环 | 前向引用 = 0，递归检测 = 0 |
| `votes` / `collections` 唯一索引 | `DISTINCT ON` 去重 | 重复 = 0 |
| `follows` 不自环 | 显式过滤 `following_id <> follower_id` | 自环 = 0 |
| 软删除比例 ≈ 5% | `R(seed, key) < 0.05` | topics 5.01%、replies 5.05% |
| 软删除主题 `status = 'deleted'` | 与 `deleted_at` 同源判定 | 不符 = 0 |
| 时间戳分散在过去 2 年 | 基于 seed 派生的锚点，`[锚点-2年, 锚点]` | 见下 |
| 至少有 admin / moderator | id=1 是 admin，id=2..6 是 moderator | admin 1 / moderator 5 |
| 关注 / 收藏 / 投票 / 通知 | 分别 29998 / 9748 / 840039 / 4783 行 | — |
| `users.status` 有非活跃用户 | 每 200 个 suspended、每 500 个 banned | active 9940 / suspended 50 / banned 10 |

---

## 中断安全

**整个生成过程在单个事务内完成。** 中断（Ctrl+C、进程被 kill、机器断电）会导致事务回滚，
**不会留下半截数据**。

已实测：生成完整规模数据集的过程中 `kill -9` 掉进程，随后检查：

```console
# 强杀进程后
SELECT 'topics', count(*) FROM topics
UNION ALL SELECT 'replies', count(*) FROM replies
UNION ALL SELECT 'users', count(*) FROM users;
--  topics|1000
--  replies|5000
--  users|100
```

数据与被杀之前完全一致（事务已回滚），没有半截数据。

重跑策略：

- 带 `--truncate` → 先清空再重建，幂等，结果与首次运行完全相同。
- 不带 `--truncate` → 要求主表为空，否则报错退出（不会在已有数据上叠加）。

**注意**：单事务意味着 100 万条回复的生成期间，数据库无法被其他事务看到中间状态 ——
这是刻意的取舍，换来「要么全有要么全无」的保证。

---

## 数据集内容说明

### 用户

- 用户名 `lt_000001` … `lt_010000`，邮箱 `lt_XXXXXX@loadtest.invalid`。
- id=1 是 `admin`，id=2..6 是 `moderator`，其余是 `user`。
- 每 200 个有 1 个 `suspended`，每 500 个有 1 个 `banned`。
- 头像路径 `/uploads/avatars/seed/N.png`（占位路径，不对应真实文件 ——
  应用的 `avatarUrl()` 在文件缺失时会回退到用户名生成的 data URI）。

### 节点

- 1000 个节点，分布在 9 个分类下（与 `scripts/seed.ts` 的分类一致）。
- **三层树**：40% 顶层（`parent_id` 为 NULL）、40% 二级、20% 三级。
- 父 id 恒小于子 id —— 结构上不可能成环。
- 节点状态：每 50 个有 1 个 `pending`，每 97 个有 1 个 `hidden`，其余 `active`。

实跑验证的层级分布：

```
 depth | count
-------+-------
     1 |   400
     2 |   400
     3 |   200
```

### 主题与回复

- 每个主题 10~11 条回复（`replies` 总额按比例分配到各主题）。
- 主题标题由「前缀 + 主语 + 后缀」组合而成（`分享 这个方案到底值不值 （经验帖）`）。
- 回复内容从 10 条中文片段里取。
- 时间戳分散在过去 2 年内，不是全部 `now()`。

### 长尾分布

作者与投票人按幂律分布，模拟真实论坛：

```
 votes_min_per_user     | 36
 votes_max_per_user     | 1743
 replies_min_per_author | 32
 replies_max_per_author | 10063
```

最活跃的 1 个用户贡献了 10063 条回复（占全部回复的 1%），最活跃的投票用户投了 1743 票。
均匀分布会让所有查询计划看起来都很好，掩盖真实的热点竞争。

---

## 应用侧验证

### 1. 查询层（复刻应用真实 SQL）

生成的数据已用**应用真实的 SQL 形态**验证过（复刻 `src/server/queries.ts`、
`src/lib/node-service.ts`、`src/lib/credit-service.ts`、`src/server/floor.ts` 的查询）：

```
首页列表: 20 条, 136ms
  首条: {"id":75829,"title":"学习 如何把响应时间压到 100ms （经验帖）","votes":1,"replies_count":10,...}
published 主题数: 94800
主题 #1 回复: 9 条, 11ms
节点列表: 20 条, 62ms
  首条: {"id":1,"name":"n_000001","title":"创意节点 #1","parent_id":null,"category_id":2,"topics_count":92,...}
面包屑(节点#900): 3 层, 2ms
   [{"id":100,...,"lvl":3},{"id":500,...,"lvl":2},{"id":900,...,"lvl":1}]
积分排行榜: 20 条, 613ms
搜索: 20 条, 9ms
账本校验(用户 1): 10295 条流水, 0 个问题, 33ms
分配楼层(主题1): floor=12, 18ms

✓ 应用查询层探针全部通过
```

### 2. HTTP 层（`next start` 指向压测库，实测）

用生产构建（`.next/BUILD_ID=5YlcRnLCBWkl52XvOTFRx`）起服务，
`DATABASE_URL` 指向 `v2ex_loadtest`：

```
/                                          HTTP 200  0.225s   95679 bytes
/nodes                                     HTTP 200  0.062s  221017 bytes
/t/1                                       HTTP 200  0.047s   45069 bytes
/go/n_000001                               HTTP 200  0.041s   20508 bytes
/go/search?q=替代品                         HTTP 200  0.427s   72411 bytes
/member/lt_000001                          HTTP 200  0.180s   81561 bytes
/tag/tag_0001                              HTTP 200  0.089s   72079 bytes
/signin                                    HTTP 200  0.019s   14064 bytes
/about                                     HTTP 200  0.018s   15155 bytes
/settings   （登录态）                      HTTP 200  0.031s   15392 bytes
/bookmarks  （登录态）                      HTTP 200  0.033s   34325 bytes
/notifications（登录态）                    HTTP 200  0.019s   14147 bytes
/api/nodes?limit=20                        HTTP 200  0.029s    5758 bytes
/api/feed/atom                             HTTP 200  0.023s   20178 bytes
/api/search?q=替代品                        HTTP 200  1.107s   11271 bytes
```

**登录验证**（用本脚本生成的密码哈希）：

```console
# 正确密码
POST /api/auth/signin  {"username":"lt_000001","password":"loadtest-password-20261104-0"}
→ {"ok":true,"redirect":"/"}

# 错误密码
POST /api/auth/signin  {"username":"lt_000001","password":"wrong-password"}
→ {"ok":false,"error":"用户名或密码不正确"}
```

登录后 `/bookmarks` 能渲染出收藏的主题与节点、`/notifications` 能渲染出
「回复了你的主题」通知 —— 说明 `collections` / `notifications` / `follows` 这些关系表
与用户数据是自洽可用的。

### 3. 写路径验证（发回复）

通过应用自己的 `POST /api/replies` 给主题 #1 连发两条回复，均返回 `{"ok":true}`，
**没有触发 `replies_topic_floor_uidx` 唯一索引冲突** —— 说明 `floor_counters`
与实际楼层水位对齐正确，压测时发帖不会因为种子数据而 500。

> ⚠️ 但这次验证**暴露了一个应用侧缺陷**（不是本脚本的问题），见下一节。

### 4. 序列同步

所有 serial 序列都已同步到最大值（应用层后续写入不会撞主键）：

```
 users | 10000        votes       | 840039
 topics| 100000       follows     | 29998
 nodes | 1000         collections | 9748
 replies| 1000000     notifications| 4783
 credit_ledger| 1159990  thanks  | 189898
 daily_checkins| 49990
```

---

## ⚠️ 压测时需要注意的应用侧缺陷（与本脚本无关）

HTTP 层验证时发现：**`src/server/floor.ts` 的 `allocateFloor` 在 UPDATE 分支会跳号**，
导致回复的楼层号不连续（1, 3, 5, ... 而不是 1, 2, 3, ...）。

**这不是压测数据造成的** —— 用一个**完全由应用自己新建**的主题（无任何种子数据）
也能复现：

```
新主题 #100001：
  第 1 条回复 → floor = 1   ✓
  第 2 条回复 → floor = 3   ✗ 应该是 2
```

**根因**：`allocateFloor` 的 SQL 在 `ON CONFLICT DO UPDATE` 分支里，
`greatest(floor_counters.last_floor, EXCLUDED.last_floor) + 1` 把 `EXCLUDED` 也加了 1。
而 `EXCLUDED.last_floor` 本身已经是 `max(floor) + 1`，于是当 `counter == max(floor)` 时
结果是 `max(floor) + 2` —— **每次分配都跳一个号**。

`tests/floor-counter.spec.ts` 没抓到它，因为该测试只断言「楼层号**递增且不重复**」，
而**跳号恰好也满足递增**。

**候选修复**（已在本机用 SQL 实测三种场景全部正确）：

```diff
 ON CONFLICT (topic_id) DO UPDATE
-  SET last_floor = greatest(floor_counters.last_floor, EXCLUDED.last_floor) + 1
+  SET last_floor = greatest(floor_counters.last_floor + 1, EXCLUDED.last_floor)
```

实测结果：

| 场景 | counter | max(floor) | 修复后返回值 | 说明 |
|---|---|---|---|---|
| A 正常路径 | 10 | 10 | **11** | 连续 ✓ |
| B 自愈（计数表落后） | 0 | 10 | **11** | 不撞号 ✓ |
| C 计数表领先 | 20 | 10 | **21** | 不复用 ✓ |

**我没有修改 `src/server/floor.ts`** —— 它在禁改清单里，且这是应用逻辑缺陷，
应由负责应用代码的队友决定是否修、怎么修。

> 📌 **截至本 README 最后更新时，这个缺陷尚未被修复** ——
> `src/server/floor.ts` 里仍是 `greatest(floor_counters.last_floor, EXCLUDED.last_floor) + 1`。
> 压测前请确认是否已修复。

**对压测的影响**：楼层号跳号不影响压测脚本生成的数据（脚本自己写的楼层是连续的
1..n，且 `floor_counters` 与实际 `max(floor)` 一致），但会让 k6 阶段测到的
「回复楼层连续性」断言失败。**压测前建议先修掉它**，否则压测报告里会出现
一个与压测数据无关的假阳性。

---

## 性能注意事项：慢查询

`/leaderboard` 与 `/api/leaderboard` 在完整规模数据下**很慢**：
冷缓存 **162 秒**，热缓存 **6.2 秒**。

根因是 `src/lib/credit-service.ts` 的 `leaderboard()` 里那个统计子查询：

```sql
(SELECT count(*)::int FROM thanks th JOIN replies r2 ON r2.id = th.reply_id
  WHERE r2.author_id = t.author_id) AS thanks_received
```

`EXPLAIN ANALYZE` 显示它是 **N+1 全表扫描**：

```
SubPlan 2
  ->  Aggregate (actual rows=1 loops=9997)          ← 9997 个作者，每个都跑一遍
        ->  Hash Join (actual rows=19 loops=9997)
              ->  Seq Scan on thanks th (actual rows=189898 loops=9997)   ← 全表扫描 × 9997
```

`thanks` 表只有 `(user_id, reply_id)` 复合索引，**没有 `reply_id` 单列索引**，
所以 `JOIN replies r2 ON r2.id = th.reply_id` 走不了索引。

**修法建议**（我没有动 schema —— 在禁改清单里）：给 `thanks` 加 `reply_id` 单列索引，
或把该统计改成一次性聚合子查询：

```sql
-- 替代方案：先聚合再 join，避免 N+1
(SELECT count(*)::int FROM (
   SELECT th.reply_id FROM thanks th
   JOIN replies r2 ON r2.id = th.reply_id
   WHERE r2.author_id = t.author_id
   GROUP BY th.reply_id
 ) z) AS thanks_received
```

同理，`votes` 表也缺 `topic_id` 单列索引（只有 `(user_id, topic_id)` 复合索引），
`credits` 页面按 topic 统计票数时也会走全表扫描。

> ✅ **这两项已被队友处理**（截至本 README 最后更新）：
> - `drizzle/0002_v004_perf_indexes.sql` 已新增 `thanks_reply_id_idx`、
>   `replies_author_alive_idx`、`topics_author_alive_idx`、`votes_topic_id_idx`、
>   `replies_topic_id_idx`。
> - `src/lib/credit-service.ts` 的 `leaderboard()` 已改写为「三个独立聚合 + JOIN」，
>   端点耗时从 241.98 秒降到 0.74 秒（加索引后 0.46 秒）。
>
> **压测建议**：k6 阶段如果打 `/leaderboard`，请确认压测库已应用
> `0002_v004_perf_indexes.sql` 迁移 —— 否则测出来的仍是旧路径的慢，
> 会得出「应用很慢」的错误结论。

---

## 已知限制

1. **`password_hash` 含随机盐** —— 每次运行这 5 个哈希的字符串都不同（scrypt 的设计）。
   指纹不覆盖该字段。
2. **头像是占位路径** —— `/uploads/avatars/seed/N.png` 不对应真实文件。
3. **`credit_ledger` 的积分额度**用的是 `src/lib/credit-service.ts` 的**默认配置**
   （注册 100 / 发主题 5 / 发回复 2 / 签到 2+1）。若部署时通过环境变量改了
   `TOPIC_CREDITS` 等，账本数值与实际配置会不一致 —— 需要同步调整脚本里的 `CREDIT` 常量。
4. **节点名是 `n_000001` 形式** —— 不是原站那种有意义的短名。
   原站节点名（如 `programmer`）在 `src/lib/nav.ts` 的 `HOME_TABS` / `SECONDARY_TABS` 里是硬编码的，
   本脚本不覆盖它们 —— 首页 tab 仍走硬编码逻辑，与生成的数据无关。
5. **未覆盖 `kv_store` 的 `seed:initialized` 标记** —— 脚本只写 `loadtest:seed`。
   因此在压测库上跑 `npm run db:seed` 仍会正常执行。
6. **`reports` / `node_requests` 等辅助表只做了引用自洽**，语义是随机填充，不是业务真实场景。
7. **发现了两个应用侧缺陷**（`allocateFloor` 楼层跳号、`leaderboard` 慢查询），
   均已定位根因并给出修复方案，但**没有改应用代码**（在禁改清单内）—— 详见上面两节。
   压测前建议先处理，否则 k6 阶段的结论会被这两条路径污染。
8. **HTTP 层验证用的是 `next start`（生产构建）**，不是 `next dev` ——
   `next dev` 启动时清理 `.next` chunk 触发了沙箱的 safe-delete 守卫（非本脚本问题）。
   另外本次 HTTP 验证向库里写了 1 个主题 + 4 条回复 + 1 个会话，
   验证后已用 `--truncate` 重新生成，交付状态下库是干净的（指纹与首次生成一致）。

---

## 与 k6 配合

生成完数据后，把压测目标指向压测库：

```bash
# 应用指向压测库
DATABASE_URL="postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_loadtest" npm run dev

# k6 打流量
k6 run scripts/loadtest/k6.js
```

登录压测可用任一压测用户（口令 `loadtest-password-<seed>-<0..4>`）。
