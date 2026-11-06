# 楼层编号规则（v0.0.5 文档化）

> 本文档把 `src/server/floor.ts` 的实现固化为**明确的产品规则**。
> 在此之前，「删除后楼层如何显示」从未有书面定义，只能靠读代码推断。

## 一、核心不变量

| # | 规则 | 实现位置 |
|---|---|---|
| 1 | **楼层号唯一** | `replies_topic_floor_uidx` 唯一索引 `(topic_id, floor)` |
| 2 | **楼层号稳定** | 一旦分配，**永不改变**（软删除不重排、恢复不改号） |
| 3 | **楼层号连续** | 同一主题内从 1 开始，每次 +1，无跳号 |
| 4 | **无重复** | 并发下由 PostgreSQL UPSERT 原子保证 |

## 二、分配算法

`floor_counters(topic_id PK, last_floor INT)` 是楼层号的**唯一权威**。

```sql
INSERT INTO floor_counters (topic_id, last_floor)
SELECT $topicId, coalesce(max(floor), 0) + 1 FROM replies WHERE topic_id = $topicId
ON CONFLICT (topic_id) DO UPDATE
  SET last_floor = floor_counters.last_floor + 1
RETURNING last_floor
```

### 两个分支的语义

| 分支 | 触发条件 | 取值 | 说明 |
|---|---|---|---|
| INSERT | 计数表无该主题 | `max(floor) + 1` | 首次回复，或历史数据导入后计数表缺失 —— **自愈** |
| DO UPDATE | 计数表已有该主题 | `last_floor + 1` | 常态路径，**只看计数表，不看 replies** |

### 为什么这样设计

v0.0.4 修复过一次**跳号**缺陷。原实现的 DO UPDATE 分支写的是
`greatest(fc.last_floor, EXCLUDED.last_floor) + 1`：

- `EXCLUDED.last_floor` 是本次 INSERT 的候选值，而它本身已经是
  **实时 `max(floor) + 1`**（含当前事务刚插入的楼层）
- 于是又 +1 ⇒ **每次分配都跳一号**
- 实测：连发 3 条回复得到楼层 16、14、12（跳过 15、13）

修复原则：**计数表是唯一权威**。DO UPDATE 分支只用 `fc.last_floor + 1`，
不再参考 `EXCLUDED`。这样：

- 计数表落后 → INSERT 分支用实时 `max(floor)` 兜底初始化，自动抬到正确水位
- 计数表正常 → DO UPDATE 分支纯 +1，无跳号

## 三、软删除与恢复的显示策略

**这是本文档要解决的主要模糊点。**

### 规则

| 操作 | 楼层号 | 列表可见性 | 详情可见性 |
|---|---|---|---|
| 正常回复 | 分配得到 | 可见 | 可见 |
| **软删除** | **保留原号，不重排** | **不可见**（`listReplies` 默认 `deleted_at IS NULL`） | 版主/管理员可见（标记「已删除」） |
| **恢复** | **仍是原号** | 重新可见 | 可见 |

### 设计理由

**楼层号是「这条回复在第几楼」的稳定标识**，被以下功能依赖：

1. **引用跳转** —— `#reply3` 锚点指向楼层 3。若重排，历史链接全部失效。
2. **站外链接** —— 用户分享的 `/t/123#reply5` 必须长期有效。
3. **对话上下文** —— 「参见 3 楼」这类表述不能因删除而漂移。

因此**软删除只改变可见性，不改变编号**。删除后在序列中留下一个「空洞」，
这是**正确且有意**的行为 —— 它如实反映了「这里曾经有一条回复」。

### 与 `replies_count` 的关系

`topics.replies_count` 统计的是**未删除**的回复数（软删除时重算），
因此「最大楼层号」可能大于 `replies_count`。这是正常的：

> 主题有 10 条回复，其中 3 条被软删除 ⇒ `replies_count = 7`，但楼层号最大为 10。

## 四、并发保证

### 单条 UPSERT 的原子性

`allocateFloor` 是**单条 SQL**，依赖 PostgreSQL 的行级锁：

- 两个并发事务对同一 `topic_id` 执行 UPSERT
- 第一个事务插入/更新该行并获得行锁
- 第二个事务阻塞，直到第一个提交
- 然后第二个事务读到**已更新**的 `last_floor`，再 +1

⇒ **不可能出现重复楼层号**。

### 与 `replies_topic_floor_uidx` 的关系

唯一索引是**最后一道防线**：

- 正常路径下 UPSERT 已保证不重复，索引不会触发
- 若因极端情况（如手动改库）出现重复，索引会让 INSERT 失败
  ⇒ 路由层的「冲突重试」兜底（最多 5 次）

## 五、锁定主题的交互

主题被锁定（`topics.locked = true`）后：

- **拒绝新增回复**（API 层校验，返回明确错误）
- **已有回复仍可阅读、感谢、举报**
- 楼层号分配器**不受影响**（锁定只阻止新分配）

## 六、测试覆盖

| 测试文件 | 覆盖内容 |
|---|---|
| `tests/floor-continuity.spec.ts` | 5 条严格「楼层连续 1..n」断言（v0.0.4 新增） |
| `tests/floor-counter.spec.ts` | 6 条计数表行为（含自愈、落后抬升） |
| `tests/content-lifecycle.spec.ts` | 并发回复不产生重复楼层号 |
| `tests/v005-floor-concurrency.spec.ts` | **100 并发回复**（v0.0.5 新增，见下） |

## 七、已知边界

| 项 | 状态 |
|---|---|
| 100 并发真实压测 | ✅ v0.0.5 已补（`tests/v005-floor-concurrency.spec.ts`） |
| 分页过程中新增回复 | 分页按 `floor` 稳定排序，新增回复出现在最后一页 |
| 数据库事务中断 | UPSERT 是单条语句，要么全成功要么全失败，无中间态 |
| 跨主题楼层号 | 各主题独立计数，从 1 开始 |
