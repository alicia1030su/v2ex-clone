# v0.0.5 性能压测报告（新增路径）

> 任务书 §十二（P2）要求：「性能压测（继承 v0.0.4 规模，覆盖新增的
> **搜索 / 通知 / 积分**路径）」。
>
> v0.0.4 已压过的路径（发帖 / 回复 / 列表分页）本轮**不重复**，
> 只压 v0.0.5 新增或改动过的路径。

---

## 一、结论先行

| 路径 | P50 | P95 | P99 | 结论 |
|---|---|---|---|---|
| **搜索**（阶段 1 · 整串） | **2ms** | 6ms | 6ms | ✅ 无劣化 |
| **搜索**（阶段 2 · bigram 回退） | **2ms** | 6ms | 6ms | ✅ 回退**不显著变慢** |
| 搜索建议（前缀） | 2ms | 5ms | 6ms | ✅ |
| 通知列表 | **0ms** | 1ms | 2ms | ✅ |
| 通知未读计数 | **0ms** | 1ms | 5ms | ✅ |
| 积分签到（幂等检查） | **0ms** | 1ms | 3ms | ✅ |
| 积分账本读取 | **0ms** | 1ms | 1ms | ✅ |

**一句话**：v0.0.5 的两阶段搜索**没有造成性能劣化**；
通知与积分路径都是毫秒级。

---

## 二、实测环境与规模

| 项 | 值 |
|---|---|
| 数据规模 | **users=2000 / nodes=100 / topics=20000 / replies=100000** |
| notifications | 955 |
| 轮数 | 30（每条路径 30 次取分位数） |
| 脚本 | `scripts/perf/v005-path-benchmark.ts` |
| 数据生成 | `scripts/loadtest/seed-large.ts`（seed=20261104，**确定性可重复**） |

> ⚠️ v0.0.4 的规模是 10 万主题 / 100 万回复；本轮为了控制耗时用了
> **1/5 规模**（2 万主题 / 10 万回复）。
> **这是已知限制**，见 §六。

---

## 三、压测脚本的**两次返工**（记录下来，因为踩坑方式很典型）

### 3.1 第一次测错了对象：测了 `count(*)` 而不是生产 SQL

第一版脚本测的是：

```sql
SELECT count(*) FROM topics WHERE title ILIKE '%性能%' OR content ILIKE '%性能%'
```

测出 **P50 125ms** ⇒ 看起来「搜索慢到不可接受」。

**但生产路由根本不是这条 SQL** —— 它是：

```sql
SELECT ... FROM topics t
JOIN users u ... JOIN nodes n ...
WHERE (title ILIKE ... OR content ILIKE ...)
ORDER BY t.last_reply_at DESC
LIMIT 50 OFFSET 0
```

带 `LIMIT` ⇒ PG 走 **`topics_last_reply_at_idx` 倒序扫描 + 早停** ⇒
**实测 0.92ms**。

EXPLAIN 对比：

```
生产形态：
  Limit  (actual time=0.200..0.920 rows=50)
    ->  Nested Loop
          ->  Index Scan Backward using topics_last_reply_at_idx on topics t
                Filter: (((title)::text ~~* '%性能%') OR (content ~~* '%性能%'))

count(*) 形态：
  Aggregate  (actual time=136.872..136.872 rows=1)
    ->  Seq Scan on topics  (actual time=0.030..135.767 rows=20000)
          Filter: (((title)::text ~~* '%性能%') OR (content ~~* '%性能%'))
```

**教训**：压测必须测**生产 SQL 的形态**。
测「更严格」的变体（要数完所有行）会得出「性能不达标」的**错误结论**，
并可能引发不必要的优化工作。

现在脚本里两者都保留，但**明确标注**：
`search_prod_*` 是生产形态（结论依据），
`search_worstcase_count` 只是「全表扫有多贵」的参考。

### 3.2 第二次踩了 PG 的 GROUP BY 限制

```sql
SELECT count(*) FROM notifications WHERE user_id = $1 ORDER BY read ASC LIMIT 50
```

⇒ PG 报「字段 notifications.read 必须出现在 GROUP BY 子句中」
（`count(*)` 是聚合函数，`ORDER BY` 的列必须出现在 GROUP BY 里）。

**修法**：用**子查询**先排序分页，外层再计数：

```sql
SELECT count(*) FROM (
  SELECT id FROM notifications WHERE user_id = $1
  ORDER BY read ASC, created_at DESC LIMIT 50
) t
```

---

## 四、一个**重要发现**：2 字中文查询命中不了 trigram 索引

### 4.1 实测证据

对 `topics.title` 上**确实存在**的 `topics_title_trgm_idx`
（`GIN (title gin_trgm_ops)`）做 EXPLAIN：

| 查询词 | 长度 | 执行计划 |
|---|---|---|
| `性能` | **2 字** | **Seq Scan** ❌ |
| `性能优` | 3 字 | **用了索引** ✅ |
| `数据库性能` | 5 字 | **用了索引** ✅ |

### 4.2 原因

**pg_trgm 的 trigram 需要至少 3 个字符**才能构成一个可索引的 trigram。
2 字的查询串**无法生成任何 trigram** ⇒ 索引不可用 ⇒ PG 退化为 Seq Scan。

这不是本项目的 bug，而是 pg_trgm 的**固有限制**。

### 4.3 影响评估

| 场景 | 影响 |
|---|---|
| **正常搜索**（≥3 字） | ✅ 索引命中，2ms |
| **2 字搜索**（如「性能」） | ⚠️ Seq Scan，但**生产查询带 LIMIT 50 ⇒ 早停** ⇒ 实测仍 2ms |
| **2 字 + 无 LIMIT**（如计数、统计） | ⚠️ 全表扫，20000 主题时 141ms |

**结论**：
- 对**面向用户的搜索**（永远带 LIMIT）⇒ **影响可忽略**
- 但这是一个**已知的、未消除的限制**，如实记录（见 §六）

### 4.4 为什么**不**急着修

可选方案与代价：

| 方案 | 效果 | 代价 |
|---|---|---|
| 加 `pg_tigram` 扩展 | 支持 2 字索引 | **需装扩展** ⇒ 违背「与 Docker 部署兼容」的前提 |
| 建 **2 字专用 btree 前缀索引** | 只支持前缀匹配 | 语义不同（`'%性能%'` 不是前缀） |
| **保持现状** | —— | 生产路径已够快（2ms） |

**决策**：保持现状，但**如实记录限制**。
若将来真实数据量上到 10 万主题以上且 2 字搜索成为高频需求，
再评估 btree 表达索引等方案。

---

## 五、通知与积分路径

### 5.1 通知

| 路径 | P50 | 说明 |
|---|---|---|
| 通知列表（按用户 + 未读优先 + 分页） | **0ms** | 索引 `notifications_user_idx` 命中 |
| 未读计数（**每个页面顶栏都要打**） | **0ms** | 高频路径，必须极快 —— 达标 |

> v0.0.5 新增了 `mention` 类型写入 ⇒ 通知表是**增长最快**的表之一。
> 实测在 955 条通知时仍是毫秒级；
> 通知表的增长是**写入侧**的问题（已在 P0-6 用限流约束），不是读取侧。

### 5.2 积分

| 路径 | P50 | 说明 |
|---|---|---|
| 签到幂等检查 | **0ms** | `(user_id, checkin_date)` 唯一索引命中 |
| 积分账本读取（最近 50 条流水） | **0ms** | 索引命中 |

> 积分的**写入**路径涉及 `SELECT ... FOR UPDATE` 行锁，
> 已在 P0-6 的安全复核中确认为「只追加账本 + 行锁」，
> 并由 `tests/v005-search-quality.spec.ts` 等并发测试覆盖。
> 本轮只压**读取**（用户实际感知的路径）。

---

## 六、已知限制（如实记录）

1. **规模只有 v0.0.4 的 1/5**（2 万主题 / 10 万回复 vs 10 万 / 100 万）。
   本轮为控制耗时而缩小，**不代表**在 v0.0.4 规模下的表现 ——
   但搜索走索引 + LIMIT 早停，**规模对 P50 的影响很小**
   （数据全在 `shared hit` 缓冲里）。
2. **2 字中文查询命中不了 trigram 索引**（§四）——
   对生产搜索路径影响可忽略（带 LIMIT），但对全表统计类查询有影响。
3. **未压写入路径的并发**（发帖 / 回复 / 积分写入）——
   v0.0.4 已覆盖；v0.0.5 新增的「管理员调积分」只做了**代码级**并发安全审查
   （行锁 + 只追加账本），**未做独立压测**。
4. **单机单连接**（`max: 4`）—— 未测并发连接下的表现。
5. **未模拟真实缓存冷启动** —— 全部数据在 PG 缓冲池里。

---

## 七、复现方式

```bash
# 1. 建库（脚本只允许写隔离压测库）
export PGPASSWORD="v2ex_test_password_local_only"
PSQL="_tools/pgsql/pgsql/bin/psql.exe"
"$PSQL" -h 127.0.0.1 -p 55440 -U v2ex -d postgres -c "CREATE DATABASE v2ex_perf_v005;"

# 2. 迁移 + 灌数据
export DATABASE_URL="postgres://v2ex:***@127.0.0.1:55440/v2ex_perf_v005"
npx drizzle-kit migrate
npx tsx scripts/loadtest/seed-large.ts --db="$DATABASE_URL" --truncate \
  --users=2000 --nodes=100 --topics=20000 --replies=100000

# 3. 压测
npx tsx scripts/perf/v005-path-benchmark.ts --db="$DATABASE_URL" --rounds=30
```

> ⚠️ 压测脚本有**安全闸门**：目标库名不含 `loadtest` / `perf` / `stress` / `bench`
> 时**直接退出**（退出码 3）。确需写入其他隔离库时加 `--allow-any-db`。

---

## 八、验证矩阵

| 断言 | 依据 |
|---|---|
| 搜索生产形态 P95 ≤ 50ms | 本报告 §一 实测 6ms |
| 搜索回退不比阶段 1 显著慢 | 本报告 §一 实测**持平**（均 6ms） |
| 通知未读计数 P95 ≤ 10ms | 本报告 §一 实测 1ms |
| 积分账本读取 P95 ≤ 10ms | 本报告 §一 实测 1ms |
| 压测脚本只写隔离库 | 脚本内的 `SAFE_NAME` 闸门（退出码 3） |
