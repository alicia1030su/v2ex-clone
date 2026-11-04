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
| 完整规模总耗时 | **3m4.0s**（约 184 秒） |
| 完整规模总行数 | **3,513,106** |
| 平均写入速度 | **约 19,100 行/秒** |
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
# 同 seed 跑两次
$ npx tsx scripts/loadtest/seed-large.ts --seed=20261104 ... | grep -A5 确定性指纹
    replies    -688959893895
    topics     -152838164644
    nodes      -2111021357
    users      4855192190
# → 两次输出完全相同（diff 无差异）

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

另外验证了所有 serial 序列都已同步到最大值（应用层后续写入不会撞主键）：

```
 users | 10000        votes       | 840039
 topics| 100000       follows     | 29998
 nodes | 1000         collections | 9748
 replies| 1000000     notifications| 4783
 credit_ledger| 1159990  thanks  | 189898
 daily_checkins| 49990
```

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
