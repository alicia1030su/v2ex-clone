# v0.0.10 升级验证报告（双基线）

> 验证对象：`v0.0.4 → v0.0.10` 与 `v0.0.9 → v0.0.10`
> 验证脚本：`scripts/release/verify-upgrade-v0010.sh`
> 执行日期：2026-11-08
> 执行环境：PostgreSQL 17.5（本机隔离实例，端口 55433）；每条基线独立建库

---

## 一、为什么不能沿用 v0.0.8 的升级脚本

既有的 `scripts/release/verify-upgrade-v008.sh` 只有**一个**基线，而且那个基线是
「用**当前**迁移集建库，再跑一遍**同一套**迁移」。严格说它验证的是
「当前迁移集的幂等性」，**不是**「从一个旧版本升级上来」。

任务书要求双基线（v0.0.9 与 v0.0.4），所以本轮的脚本改成：

1. 用 `git archive <tag> drizzle` 把**历史迁移集**导出到独立目录；
2. 用那份历史迁移集建库（`drizzle-kit migrate --config <临时配置>`，`out` 指向历史目录）；
3. 断言迁移 journal 行数 = 该版本的真实迁移数（v0.0.4 = 3、v0.0.9 = 4）；
4. 灌业务数据 → 记录指纹 → 用**当前**迁移集升级 → 再记录指纹 → 比对。

这样「升级」是真的从旧结构开始。

---

## 二、结果总览

| 基线 | 起始迁移数 | 升级后 | 索引数 | 业务指纹 | 结论 |
|---|---|---|---|---|---|
| **v0.0.4** | 3 | **4** | 76 → **78** | 46 项**逐字节一致** | ✅ |
| **v0.0.9** | 4 | 4 | 78 → 78 | 46 项**逐字节一致** | ✅ |

**断言汇总：`PASS=20 FAIL=0`。**

### 为什么 v0.0.9 → v0.0.10 结构不变

v0.0.10 **没有新增数据库迁移**（`drizzle/` 仍是 4 个文件，最新是 `0003_v005_reports`）。
本轮的改动全部在应用层：

- 页脚版本号改为构建期注入（`next.config.mjs` 的 `env`）
- 在线峰值改用 KV 累计（`kv_store` 表在 v0.0.4 就存在）
- 回复编辑后刷新（纯客户端逻辑）
- 样式（`globals.css`）

因此 v0.0.9 → v0.0.10 是**纯二进制更新 + 幂等迁移重跑**，这是如实结论，不是漏测。

---

## 三、逐项验证内容

### 3.1 数据保真（业务指纹 46 项）

指纹由 `scripts/release/fingerprint.sql` 生成（**纯 SELECT**，不写任何数据）。
`data.*` 前缀的 46 项覆盖：

| 类别 | 具体项 |
|---|---|
| 账号 | 每个用户的 `username:password_hash`、`username:avatar`、`username:role`；admin 的余额与角色；全部用户余额合计 |
| 内容 | 主题 1 的标题/正文/回复数；全部主题标题；回复 1 的正文与楼层；全部回复正文 |
| 节点 | 节点名全量列表 |
| 互动 | `collections` / `thanks` / `votes` / `follows` 行数 |
| 积分 | 账本行数、金额合计、逐条明细（`user:type:amount:before->after:key`）、**余额与末笔流水一致性** |
| 通知 | 行数 |
| 上传 | `avatars.storage_path` 全量列表 |
| KV | `kv_store` 键列表 |
| 其它 | `edit_history` / `email_logs` / `floor_counters` / `login_attempts` / `moderation_logs` / `node_requests` / `password_reset_tokens` / `rate_limit_buckets` / `reports` / `sessions` / `tags` / `topic_tags` 行数 |

**升级前后 `data.*` 全量 diff 为空** —— 不是「抽样一致」，是逐字节一致。

### 3.2 结构演进（`schema.*`）

| 项 | v0.0.4 基线 | 升级后 | 说明 |
|---|---|---|---|
| 索引数 | 76 | **78** | 新增 `reports_reporter_target_uidx`（部分唯一索引）与 `reports_created_at_idx` |
| 迁移记录 | 3 | **4** | 补上 `0003_v005_reports` |
| `pg_trgm` 扩展 | 有 | 有 | v0.0.4 已装，迁移幂等不重复创建 |

### 3.3 迁移幂等

升级后**连跑 3 次** `drizzle-kit migrate`：全部成功，且第 3 次之后业务指纹
与第 1 次之后**完全一致** ⇒ 迁移可以安全重跑（这是升级与重启的基础）。

### 3.4 备份 / 恢复

| 步骤 | 结果 |
|---|---|
| `pg_dump` 生成备份 | v0.0.4 基线 72766 B；v0.0.9 基线 72762 B |
| 恢复到独立库 | 成功 |
| 恢复库指纹 vs 升级后库指纹 | **完全一致（含结构指纹）** |

注意这里比对的是**全量指纹**（`data.*` + `schema.*`），比只比业务数据更严格 ——
恢复出来的库连索引与迁移记录都必须一模一样。

---

## 四、过程中修掉的三个「静默无效」

第一版探针 SQL 里，有三处列名是**猜的**，psql 明确报错后又被
「部分失败」分支记录成「继续」：

| 表 | 猜的列 | 实际列 |
|---|---|---|
| `collections` | `(user_id, topic_id)` | 还需要 `target`（`collection_target` 枚举，NOT NULL） |
| `votes` | `value` | `direction`（`vote_direction` 枚举：`up`/`down`） |
| `credit_ledger` | `balance` | `balance_before` / `balance_after`（`balance` 在 `users` 表） |

后果很严重：探针一条都没进库，而后续「指纹逐字节一致」照旧全绿 ——
**等于用一个空库证明了升级安全**。

已改为：
- 列名逐列对照 `src/db/schema.ts` 核对后重写；
- 探针失败从「记录后继续」改为**硬失败**（`bad` + 计数）。

另修一个环境坑：Windows 下把多行中文 SQL 通过 `-c` 传给 psql 会被控制台代码页
转成 GBK，UTF8 服务端直接报 `invalid byte sequence for encoding "UTF8": 0xc1 0xd0`。
改为写 UTF-8 文件用 `-f` 执行。

---

## 五、未验证的部分（如实披露）

| 项 | 状态 | 原因 |
|---|---|---|
| 真实 Docker 环境下的 `update.sh` 原地升级 | **未在本机验证** | 本机 Docker 守护进程不可用（WSL2 后端被安全策略阻止）；由 CI 的 ubuntu runner 覆盖 |
| v0.0.9 官方安装包 → v0.0.10 的**容器级**升级 | **未在本机验证** | 同上；本报告验证的是**数据库层**升级（迁移 + 数据保真 + 备份恢复），容器编排层的升级由 `update.sh` 的 CI 用例覆盖 |
| 长时间运行下的升级回滚 | **UNVERIFIED** | soak 未完成 |

**本节不写成「全部通过」**。数据库层的 20 项断言是真实实测；
容器层的验证依赖 CI，若 CI 未跑通，v0.0.10 不得标记为可发布。

---

## 六、复现方式

```bash
# 1. 导出两个历史迁移集
mkdir -p /tmp/mig-v004 /tmp/mig-v009
git archive v0.0.4 drizzle | tar -x -C /tmp/mig-v004 --strip-components=1
git archive v0.0.9 drizzle | tar -x -C /tmp/mig-v009 --strip-components=1

# 2. 跑双基线验证（只操作自建库 v2ex_upg_v0010_*）
PGHOST=127.0.0.1 PGPORT=55440 PGUSER=v2ex PGPASSWORD=*** \
  bash scripts/release/verify-upgrade-v0010.sh \
    --v004-migrations /tmp/mig-v004 \
    --v009-migrations /tmp/mig-v009

# 期望：PASS=20 FAIL=0
```
