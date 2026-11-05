# SESSION_HANDOFF · v0.0.4 跨会话交接文件

> **本文件是 v0.0.4 收尾阶段的唯一权威进度源。**
> 任何新会话都应先读本文件 + `git log` + `git status`，即可恢复完整进度，**不需要重新做一遍调查**。
> 规则：每完成一个关键阶段立即更新本文件并提交。

---

## 1. 当前任务目标

完成 v2ex-clone 的 **v0.0.4 候选版本交付**：从上一轮上下文溢出中断点继续，保留全部既有成果，解决剩余问题，完成开发、集成、测试与候选版本交付。

**当前阶段**：第 3 轮（跨会话接管）—— 已完成只读现场恢复，进入并行修复阶段。

---

## 2. 仓库与分支状态

| 项 | 值 |
|---|---|
| 仓库根 | `C:/Users/TYMO001/WorkBuddy/ai/v2ex-clone` |
| 远端 | `https://github.com/alicia1030su/v2ex-clone.git`（Public，**不得改可见性**） |
| 当前分支 | `feat/v0.0.4-high-fidelity` |
| HEAD SHA | `301a8a5fc4aabf31eea671665f862eaf9eb7be4d` |
| 相对 `origin/master` | 领先 8 个提交，落后 0 |
| **未推送提交** | **8 个（全部未推送 → CI 无法覆盖本轮改动）** |
| worktree | 仅 1 个（本目录），无其他 worktree |
| 本地分支 | `feat/v0.0.3-complete`、`feature/v0.0.2-hardening`、`fix/p0-review-hardening`、`fix/review-p0-p1-audit`、`master` |
| Tags | `v0.0.1`、`v0.0.2`、`v0.0.3`（**v0.0.4 尚未创建，符合规约**） |

### 相对 origin/master 的 8 个未推送提交

```
301a8a5 docs(v0.0.4): 最终 E2E 153/153 全绿证据 + R-23 修复后的口径同步
0824c6a fix(e2e): 修复关注用例静默跳过（R-23）+ 全量回归证据与口径闭环
1b15f79 docs(v0.0.4): 验收证据闭环、文档纠错、发布门禁双模式与最终交付方案
89d6b4e perf(fix): v0.0.4 真实压测发现并修复 3 个真实缺陷 + 3 项性能优化
f57552e feat(visual): v0.0.4 视觉对照矩阵完成（4 视口 × 17 页面）+ 差异量化报告
314aa53 feat(visual,release): v0.0.4 视觉对照矩阵扩展 + GHCR Bearer 协议实测 + 历史清理隔离演练
04b107b fix(e2e,api): v0.0.4 —— 修复 4 个真实缺陷 + 新增 77 条真实浏览器 E2E
37eba3c docs: v0.0.4 第一阶段 —— 功能真实性独立审计
```

### 未提交改动

**无。** 第 3 轮开始时 `git status` 完全干净 —— 上一轮成果已全部提交，工作区无待抢救内容。

---

## 3. 本地环境实测状态

| 项 | 状态 |
|---|---|
| Node | v22.22.2 / npm 10.9.7 |
| PostgreSQL | **17.5**，二进制 `C:/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin`，角色 `v2ex`。**端口有两个实例**：**55440** = 隔离测试实例（当前 `.env.test` 实际解析的端口，库 `v2ex_test_base`）；**55433** = v0.0.3 证据实例（含 `v2ex_e2e` 等证据库，**当前仍未恢复**） |
| PG 数据目录 | `_tools/pgsql/data-v003` —— **1.4GB / 24 个库**，其中压测库 `base/279166` = **891MB**（**是 v0.0.4 证据，绝对不可动**） |
| Redis | `_tools/redis/redis.zip`（仅压缩包，**未解压运行**） |
| Docker | **本机无**（`docker` 命令不存在）→ 风险 R-16 |
| PG 守护 | `_scratch/pg-keepalive-v004.sh`（本轮新增，后台常驻） |

### PG 生命周期坑（本轮实测确认，问题 C 根因）

WorkBuddy 的 Bash 工具在**单次调用结束时回收整棵进程树** → `pg_ctl start` 起的 `postgres.exe` 会随该次调用结束被终止。

实测证据：
- `pg-keepalive.sh` 内 `PG ready on 55433` → 下一次独立 Bash 调用立即 `Connection refused`
- 后台常驻脚本 `_scratch/pg-keepalive-v004.sh` 启动后 **PG 持续存活**，跨多次调用可连接（已验证 `select 1` 成功）

首次启动曾因上次被强杀而做 crash recovery，耗时较长（Windows fsync 逐文件，极慢）。日志：`_tools/pgsql/pg-v004.log`。

---

## 3b. 本轮 PG 中止事件（21:47:25）—— 已恢复，无数据损失

```
21:47:25.022  日志: 所有的服务器进程被中止; 重新初始化
21:47:25.198  日志: 数据库系统中断；上一次的启动时间是在 2026-11-04 21:32:50 CST
21:47:30.773  致命错误: 数据库系统在恢复模式中
21:48:29.101  日志: checkpoint complete: wrote 2131 buffers; total=4.540 s
21:48:29.217  日志: 数据库系统准备接受连接
```

**恢复耗时约 64 秒**（1.4GB 数据目录 fsync 极慢）。

✅ **数据完整性实测通过**（21:50 复核）：
| 库 | 大小 | 表数 |
|---|---|---|
| `v2ex_loadtest` | 890 MB | 26 ✅ |
| `v2ex_v002_baseline` | 9081 kB | 26 ✅ |
| `v2ex_v004_audit` | 9737 kB | 26 ✅ |
| `v2ex_e2e` | 11 MB | 26 ✅ |
| `v2ex_visual` | 9681 kB | 26 ✅ |

**结论：无任何数据损失，证据库完好。**

### 本次事故暴露的真实问题（已由 `tests/setup.ts` 的探活机制覆盖）

`scripts/seed.ts` 在 PG 恢复期间运行，报的是
`PostgresError 57P03 cannot_connect_now`（"数据库系统在恢复模式中"）——
一个**看不懂的错误**，容易被误判为产品缺陷。

而新的 `tests/setup.ts` 里的 `probeDatabase()` 会在测试开始前探活，
直接报「**PG 未就绪（环境问题）**」并附排查步骤 ——
这正是本轮 4 次 CI 失败中最需要的判据能力。

### ⚠️ 共享实例的操作纪律（血的教训）

`data-v003` 上的共享实例**会被其他操作中止**（21:47 这次是成员执行了 pg_ctl stop）。
因此：
- 单元测试应走**独立实例**（测试环境工程师正在建）
- 任何人要动共享实例，**先告知主理人**
- 任何测试跑出 `57P03` → 先查 `pg-v004.log` 是否在恢复，**不要**当作产品缺陷

---

## 3c. 「185 vs 190」之谜 —— 完整真相

**两个数字都是真实的**，且实际上存在**两个不同的 185**：

| 数字 | 来源 | 含义 |
|---|---|---|
| **185（作为通过数）** | **修复前的历史观测**：CI run `41837212170`（本轮） | `185 passed \| 5 skipped (190)` —— 分母是 190。**已由 `8ce5ce9` 修复**，run `41860242099` / `41873009808` 单元 job 已 ✅ |
| **185（作为总数）** | CI run `41760677505`（master @ `37710fb4`，14 文件） | `185 passed (185)` —— 当时总数就是 185 |

**结论：v0.0.4 的用例总数在 V4-20 修复后为 194（16 文件）；修复前是 190（15 文件）。**
185 在当前分支语境下只是 CI 上的通过数（`floor-continuity` 5 条崩溃被跳过）。

**根因链**：
`floor-continuity.spec.ts` 硬编码读被 gitignore 的 `.env.test` → CI 干净克隆 ENOENT
→ 5 条 skipped → **unit job 红** → **e2e job 被 `needs: unit` 连带跳过**
→ **当时 153 条 E2E 在 CI 上从未跑过一条**（历史所有 run 的 E2E 状态都是 `skipped`）。

> ✅ **后续已闭环**：`8ce5ce9` 修复 + run `41860242099` / `41873009808` 单元 job ✅ ⇒ **E2E job 已真实跑过**。
> **修复前的历史快照：CI：153 passed | 1 failed | 154 total**（run `41873009808`）—— 唯一失败为节点申请 UI 提交链断裂（R-27 / V4-20）—— ✅ **已由 `bddb3d0` 修复并本地实测验证**（本地 E2E 154/154 全绿；**CI 亦已复验通过**（run `41949555282`，SHA `bddb3d0`））。

### ⚠️ 本轮已实测推翻的两个推断（留痕，避免后人重犯）

1. **「CREATE DATABASE 38.6s 是数据目录 1.4GB 导致」** —— 错。稳态实测 **2.0~2.3 秒**。
   真因是 PG 处于 **crash recovery / I/O 积压态**。
2. **「`scripts/seed.ts` 的 ENV_FILE 因 ESM 导入顺序而失效」** —— 错。
   实测 ENV_FILE **是生效的**（探针库法验证）。原因是 `src/db/index.ts` 用的是
   **Proxy + 惰性创建**（v0.0.4 的 P0-4 修复引入），`createClient()` 只在
   **首次真正查库时**才读 `process.env.DATABASE_URL` —— 那时 dotenv 早已配好。
   **`override: true` 在那三处不是 bug，而是唯一能让 ENV_FILE 生效的机制。**

---

## 4. PostgreSQL 测试问题（A / B / C）根因与状态

### 问题 A：环境变量与子进程连接目标错误 —— ✅ 根因已定位，**修复中**

`tests/setup.ts` 的**注释声称**「加载 .env.test（隔离测试数据库）」，但**实际代码只加载 `.env.local` 和 `.env`**：

```ts
if (process.env.ENV_FILE) { config({ path: process.env.ENV_FILE, quiet: true, override: true }); }
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
```

- `.env.local` → `DATABASE_URL` 指向 **5432**（用户日常开发库，**禁止修改该文件**）
- `.env.test` → 指向隔离实例（**按 `.env.test` 实际解析的端口，当前 55440 / `v2ex_test_base`**；本轮记录时点为 `127.0.0.1:55433/v2ex_e2e`），但被 `.gitignore` 忽略、未入仓
- `drizzle.config.ts` 有完全相同的加载逻辑
- 子进程（`runDrizzleKit` / `runTsx`）显式传 `ENV_FILE: ''` 与测试库 `DATABASE_URL`，父/子最终目标需验证一致
- ⚠️ 上一轮归因勘误：曾误判为「`.env.local` → 5432 污染」或「并行 PG 负载」，用 `ENV_FILE`（override:true）指向隔离实例后**仍然超时**，两假设均被实测推翻

### 问题 B：CREATE DATABASE 38.6s —— ✅ 根因已定案（第三次归因勘误）

- 上一轮观测：`DROP DATABASE` 1.2s / **`CREATE DATABASE` 38.6s** / `drizzle-kit migrate` 5.4s
- **本轮实测推翻旧假设**：在同一 1.4GB / 24 库实例上连测 3 次 `DROP+CREATE` = **2277 / 1978 / 2243 ms**，单独 `CREATE` = **2083 ms**；同期 checkpoint `total=0.053s / 0.158s`
- ✅ **正确根因**：38.6s 是 **PG 处于 crash recovery / I/O 积压态**时的观测值，**不是稳态**。本轮首次启动 PG 时它在上次被强杀后做 redo 恢复，日志显示逐目录 fsync 耗时 70 秒（`syncing data directory (fsync), elapsed time: 70.01 s`）。**数据目录大小不是瓶颈**（建库只复制 `template1`，实测 7689 kB / public schema 0 张表）
- 纠错留痕：① 第一轮误判「`.env.local` → 5432 污染」→ 用 `ENV_FILE`（override:true）指向隔离实例后仍超时，**被实测推翻**；② 第二轮误判「并行 PG 负载」→ 单独跑 seed-idempotency 同样超时，**被实测推翻**；③ 第三轮「数据目录 1.4GB 导致」→ 本轮实测 2 秒，**被实测推翻**
- 现存配置：`vitest.config.ts` `testTimeout: 30_000` / `hookTimeout: 120_000` / `fileParallelism: false`
- **方案**（架构师 `docs/TEST_ENV_ISOLATION_v0.0.4.md`）：新建**独立测试实例**（独立数据目录 + 独立端口，复用现有 PG 17.5 二进制）。定位是**隔离性与可复现性**，**不是性能修复** —— 不得包装成「解决 38.6s 超时」
- 配套：阶段耗时日志（DROP/CREATE/migrate/seed 各阶段毫秒数）+ **区分「PG 未就绪」与「真实超时」**

### 问题 C：PG 子进程生命周期 —— ✅ 已解决

后台常驻守护 `_scratch/pg-keepalive-v004.sh` 生效，PG 跨多次工具调用持续存活。

### 隔离测试库白名单（允许 DROP / CREATE / migrate / seed）

```
v2ex_admintest      v2ex_v003_admin    v2ex_v003_content  v2ex_v003_credits
v2ex_v003_feed      v2ex_floorcont_v004 v2ex_floortest     v2ex_seedtest
v2ex_rateclear
```

**绝对不可 DROP**：`v2ex_loadtest`（891MB 压测库）、`v2ex_v002_baseline`、`v2ex_e2e`、`data-v003` 整个数据目录。

⚠️ **护栏必须用「精确枚举」而非「前缀通配」** —— 证据库 `v2ex_v004_audit`、`v2ex_e2e_v004` 同样以 `v2ex_v` 开头，前缀通配会误删。`v2ex_v004_audit` 是 `docs/UPGRADE_RECOVERY_v0.0.4.md` L56 明文记载的证据库。

**扩展禁止清单（不可 DROP / 不可写）**：`v2ex_e2e_v004`、`v2ex_mig_idem`、`v2ex_mig_v004`、`v2ex_release_v001`、`v2ex_upg_v004_fresh`、`v2ex_upg_v004_old`、`v2ex_upg_v004_restore`、`v2ex_upgrade_src`、`v2ex_v004_audit`、`v2ex_visual`。

本轮已实测确认（20:47）上述库**全部存在且完好**，未发生误删。

---

## 5. 本轮新发现的真实缺陷（共 5 个，前 3 个已修复）

| # | 缺陷 | 状态 | 证据 |
|---|---|---|---|
| 1 | **运行时上传数据被误提交入仓** —— `public/uploads/` 下 18 个 684 字节 E2E 占位图被跟踪进版本库（引入提交 `04b107b`/`1b15f79`/`301a8a5`）。风险性质与 R-01 同类 | ✅ **已修**（`49d66d3`） | `.gitignore` 加 `public/uploads/` 规则 + `git rm --cached` 移出索引（**不改写历史**、不删磁盘文件） |
| 2 | **`docker-verify.yml` 定义级失败** —— 汇总步骤把三元式写进 `${{ }}`（`${{ job.status == 'success' && echo PASS \|\| echo '见日志' }}`），GitHub 表达式**不支持** `&&`/`\|\|` 三元。症状极具迷惑性：run **0 秒**结束、`total_count=0`、**无任何 job 被创建**，报错仅「This run likely failed because of a workflow file issue」，而 **YAML 本身能正常解析** | ✅ **已修**（`2532f5f`） | CI run `41836244258` |
| 3 | **`docker-verify.yml` 迁移物路径断言错误** —— drizzle 的 SQL 在 `/app/drizzle/` 根目录，而 `_journal.json` 与 snapshot 在 `/app/drizzle/meta/` 子目录；初版混用同一路径断言 → 误判「镜像内缺少」 | ✅ **已修**（`930f29e`） | CI run `41836588637` |
| 4 | **`docker-verify.yml` app 健康判定口径错误** —— 根目录 `docker-compose.yml` 的 app **无 healthcheck**（只有 `deploy/docker-compose.yml` 才有），`State.Health.Status` **永远返回 `none`**，断言「三容器全 healthy」恒假。CI 日志证明 app 实际完全健康（`✓ Ready in 414ms`） | ✅ **已修**（`300d938`） | CI run `41837202602` |
| 5 | **CI 上 `floor-continuity.spec.ts` 崩溃** —— 硬编码 `readFileSync('.env.test')`，而 `.env.test` 被 gitignore、从未入仓 → CI 干净克隆里 ENOENT → 5 条 skipped → **CI 红灯**。且它对 `process.env.DATABASE_URL` 要求匹配 `/:55433\//`，使 CI 的 5432 地址永不被采用 | ✅ **已修**（`8ce5ce9`；护栏 3 修复 `634a202`）—— CI 复验：run `41860242099` / `41873009808` 单元 job ✅（vitest 15 文件全过、0 skipped） | CI run `41837212170`（历史观测） |

### 第 5 个缺陷的连锁影响（本轮最重要的发现）

> ⚠️ **以下为「修复前的历史观测」，现已闭环**（`8ce5ce9` + run `41860242099` / `41873009808` 单元 job ✅）。

- **CI 的 E2E job 因 `needs: unit` 被连带跳过** → **当时 153 条 E2E 在 CI 上一条都没跑过**。
  历史 run 显示 `E2E 测试 | skipped` 始终如此。
- **这解释了「185 vs 190」之谜**：CI 上 = `185 passed | 5 skipped (190)`，本机 = `190 passed`。
  两个数字**都是真实观测**，差异是环境导致，**不是**「v0.0.3 vs v0.0.4」。
- **修复后 CI 与本地都应为 `190 passed / 0 skipped`** —— ✅ **已达成**。

### 4 个 CI 缺陷的共同规律（值得记住）

**症状都是「环境差异」伪装成「产品缺陷」**：
- YAML 能解析 → 但表达式求值失败
- 文件明明存在（`ls` 输出证明）→ 但断言查错了路径
- 容器明明健康（日志证明）→ 但断言读了不存在的字段

**对策**：每条断言失败时，先确认**被观测对象本身是否正常**（用同一份日志/输出交叉验证），
再判定是产品缺陷还是断言缺陷。本轮 4 次里有 3 次是断言缺陷。

---

## 5b. 功能与 UI 缺口现状（本轮已核实）

| # | 缺口 | 核实结论 | 负责成员 |
|---|---|---|---|
| 1 | 管理员无 `/admin` 入口 | `SiteNav.tsx` 对**任何角色**都不渲染 `/admin`；服务端鉴权**正确**（游客→`/signin`、非 staff→`/`）→ 可达性缺口，非权限缺陷 | UI 工程师 |
| 2 | 关注功能无 UI | 后端 API 齐全（`/api/users/follows` POST/DELETE、`/follows/topics`）；`src/**/*.tsx` 中**无任何关注按钮组件**；个人主页不渲染 | UI 工程师 |
| 3 | 节点申请无 UI | 后端齐全（`POST /api/node-requests`、`/api/admin/node-requests`、`/approve`、`/reject`，approve 真建节点并回填 `approved_node_id`）；**无任何前端页面** | UI 工程师 |
| 4 | 隐藏节点无入口 | 待核实 `GET/POST /api/admin/config` | UI 工程师 |
| 5 | 管理员操作日志 | `GET /api/admin/logs` 存在，前端可见性待核实 | UI 工程师 |
| 6 | 通知标记已读 | `POST /api/notifications/read` 存在，前端入口待核实 | UI 工程师 |
| 7 | 版主入口与操作 | `/api/topics/[id]/lock|pin|unlock|unpin` 存在，版主可用性与按钮待核实 | UI 工程师 |
| 8 | 主题管理/感谢/收藏/积分闭环 | 待核实 | UI 工程师 |

**红线**：服务端鉴权不得削弱；前端加链接 ≠ 权限放宽；每项须验证「前端入口 + API + 权限 + DB 状态 + 刷新后结果」。

---

## 6. 本轮实测基线（**已复核，以此为准**）

> ✅ **185 vs 190 争议已解决 —— 两个数字都是真实的，差异有确切根因。**
> **185 是 CI 上的数字**（`185 passed | 5 skipped (190)`，**修复前的历史观测**：run `41837212170`），**190 是本机的数字**（`190 passed`）。
> 差异来自 `tests/floor-continuity.spec.ts` 的 5 条用例在 CI 上崩溃：
> 它硬编码 `readFileSync('.env.test')`，而 `.env.test` 被 `.gitignore` 忽略、从未入仓，
> CI 干净克隆里不存在 → `ENOENT` → `beforeAll` 抛错 → 5 条 skipped。
> 且它对 `process.env.DATABASE_URL` 要求匹配 `/:55433\//`，使 CI 的 5432 地址永远不被采用。
> **修复后 CI 与本机都应是 190 passed / 0 skipped** —— ✅ **已由 `8ce5ce9` 达成**
> （run `41860242099` / `41873009808` 单元 job ✅，`Test Files 15 passed (15)` / `Tests 190 passed (190)` / 0 skipped）。

| 项 | 上一轮记录 | **本轮实测（2026-11-04）** |
|---|---|---|
| 单元测试 | 185（旧）/ 190（报告另处） | ✅ **194 条 / 16 文件，全部通过，0 failed / 0 skipped**（V4-20 修复前为 190 条 / 15 文件）；连续 **4 轮**全绿。**本轮隔离实例实测 81.68s**；历史轮次 170–210s/轮（共享实例 55433 口径）。证据：`docs/evidence/baseline/vitest-v0.0.4-round3.txt` |
| E2E | 153 条 / 11 文件，153 passed（10.0m） | ✅ **154 条 / 11 文件**（`--list` 实测 `Total: 154 tests in 11 files`）。✅ **当前权威实测 = 154 passed / 0 failed / 0 skipped（11 文件，3.9m）** —— V4-20 修复后本地实跑全绿。**本地历史轮次口径**：153 passed / 0 failed / 0 skipped（4.5m），连续 **2 轮**全绿（基于 153 条口径、早于 `ed385cf`）。**修复前的历史快照**：CI run `41873009808` = `153 passed \| 1 failed \| 154 total`（唯一失败为节点申请 UI 提交链断裂 V4-20 / R-27，**已由 `bddb3d0` 修复并本地实测验证**；**CI 亦已复验通过**（run `41949555282`，SHA `bddb3d0`））。`--list` 权威清单：`docs/evidence/baseline/playwright-list-v0.0.4.txt` |
| 视觉对照 | 4 视口 × 17 页面 = 68 条（40 有对照 / 28 无对照）；严格口径桌面 Δx=0 **52/52** | ⏸ 保留既有证据 |
| 负载测试 | 已执行：10000 用户 / 1000 节点 / 100000 主题 / 1000000 回复，24785 请求 / 13 场景 | ⏸ 保留既有证据 |
| 迁移幂等 + 备份恢复 | 已验证 | 🔄 QA 复核中 |
| 功能审计 | 53 项 | ⏸ 保留 |

### ⚠️ E2E 用例 149 / 153 的特殊含义

`e2e/v004-four-roles-ui.spec.ts` 有 **2 条用例把「UI 无入口」当作断言**：
- `:98` 「UI 缺口：节点申请提交在前端无入口（仅 API /api/node-requests）」
- `:292` 「UI 缺口实证：管理员在 /、/admin、/settings 的 DOM 中均无 /admin 入口」

**UI 工程师补齐入口后，这两条会失败 —— 这是预期结果，不是回归。** 届时必须改写为「**已具备入口**」的正向断言，而不是删掉或加 `skip` 掩盖。

> ✅ **已按此处置**：`ed385cf` 已把这两条改写为**正向断言**（节点申请「入口存在且可提交」/「三页都有 `/admin` 链接且可点击到达」）。
> 当前 `--list` 实测 `v004-four-roles-ui.spec.ts` = **8 条**（条数不变，断言方向已翻转）；
> 总数 153 → **154** 的增量来自 `ed385cf` 在 `e2e/v004-account-admin.spec.ts` 新增的「关注（UI）」用例（20 → 21）。

---

## 7. 团队与子智能体状态

团队：`software-v004-finalize`（主理人 = team-lead）

| 成员 | Agent ID | 任务 | 状态 |
|---|---|---|---|
| 架构师 | `software-architect` | PG 测试环境隔离方案设计 → `docs/TEST_ENV_ISOLATION_v0.0.4.md` | ✅ **已交付**（1679 行，含三次归因勘误留痕、三道护栏、独立实例命令） |
| 部署工程师 | `software-engineer-deploy` | `deploy/update.sh` + `preflight.sh` + 自检脚本 | ✅ **已交付并已提交**（`b0d68c2`；62 项自检全 PASS） |
| UI 工程师（重启） | `software-engineer-ui2` | 补齐 R-21 / R-24 等 8 项 UI 缺口 | 🟡 运行中（已产出 `src/lib/nav-links.ts`） |
| QA/CI | `software-qa-ci` | 远端状态核查 + `docker-verify.yml` + 本地基线复核 | 🟡 运行中（health 断言已改好待提交） |
| 测试环境工程师 | `software-engineer-testenv` | 按架构师设计实施 PG 测试环境修复 + 三道护栏 | 🟡 运行中（已收到 CI 崩溃实证） |
| 文档工程师 | `software-engineer-docs` | 统一 11 份交付文档口径 + 登记新缺陷 | 🟡 运行中 |

### 架构师交付要点（`docs/TEST_ENV_ISOLATION_v0.0.4.md`）

- **第三次归因勘误**：38.6s → crash recovery / I/O 积压态，**不是**数据目录大小
- **三道护栏**：① 端点白名单 ② **库名精确枚举**（跨端点生效，同时覆盖 DROP） ③ CI 实例归属校验
- **独立实例定位**：隔离性 + 可复现性，**不是性能修复**
- ⚠️ 架构师指出**主理人指令中的一处缺陷**：我给的护栏正则 `^v2ex_(test|v003|v004|...)` 会误删 `v2ex_v004_audit` 证据库 —— 架构师已改为精确枚举。**指令已勘误**

### 部署工程师交付要点

- `deploy/update.sh` 重写：`--version` / `--image` 显式指定目标版本、**实际更新 `.env` 的 `V2EX_IMAGE`**、升级前备份、digest 核对、失败**自动回滚旧镜像**、**只回滚镜像与配置不回滚数据库**、严禁 `down -v`
- `scripts/release/verify-update-script.sh`：**用 stub docker 模拟**（本机无 Docker），验证 `.env` 的 tag 真被更新、pull 目标正确、无 `down -v`、pull 失败时安全退出
- `scripts/release/preflight.sh`：release 阶段新增版本一致性 / tag 白名单人工放行提示

**文件所有权互斥约定**（防止覆盖）：

| 成员 | 独占文件 |
|---|---|
| 架构师 | 只写 `docs/TEST_ENV_ISOLATION_v0.0.4.md`（设计，不改代码） |
| 部署工程师 | `deploy/update.sh`、`deploy/.env.example`、`scripts/release/preflight.sh`、`scripts/release/verify-update-script.sh` |
| UI 工程师 | `src/**` |
| QA/CI | `.github/workflows/**`、`scripts/release/**`（除 preflight/verify）、`scripts/ci/**`、`docs/evidence/**` |
| 主理人 | `docs/*.md`（顶层）、`tests/**`、`vitest.config.ts`、`e2e/**`、Git 操作 |

---

## 8. 尚未修复的缺陷与风险

> ⚠️ **本轮（V4-20 修复轮）更新**：**V4-20 / R-27 已由 `bddb3d0` 修复并本地实测验证** —— 本轮唯一红灯已解除
> （单元 194/194、E2E 154/154 全绿，React #418 归零）。****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）**。

| ID | 状态 | 摘要 |
|---|---|---|
| R-01 | 🔴 未解决 | 原站 HTML/CSS/JS 经 Git 历史持续暴露。**仅允许只读审计 + 隔离副本演练 + 准备 Support 资料**；未经主人再次明确授权，禁止 force push / 改写远端历史 / 删 Tag / 删 Release / 删仓库 / 改可见性 |
| R-16 | 🔴 DEFERRED | Docker 容器与安装包未实跑 → `docker-verify.yml` 已落地并修复 4 个缺陷，待推送后 CI 实跑取证（首轮已通过第 9 项） |
| R-17 | 🔴 DEFERRED | Redis 故障恢复 / 缓存失效 / 内存观测未验证 → 同上 |
| R-18 | 🟢 已修复 | `deploy/update.sh` 已修复（--version/--image、digest 核对、失败自动回滚、--dry-run 19 处），87 项自检全 PASS |
| R-19 | 🟡 部分已修 | `release.yml` tag 白名单不含 v0.0.4（**刻意保留人工摩擦，勿自动改**）；Release Notes 已动态化 |
| R-20 | 🟢 已裁决 | 开发态版本载体保持 0.0.3，`[Unreleased]` 显式记录；最终 SHA 固定后一次性同步 |
| R-21 | 🟢 已修复 | 四身份 UI 缺口 8 项已补齐（管理员入口/关注/节点申请/通知已读），主理人真实浏览器独立复核 16 项断言全 PASS |
| R-22 | 🟢 已修复 | 单测环境隔离完成：独立实例 55440 + 护栏（53 项断言）+ 稳态判据；38.6s 归因已三次勘误（见 §3b） |
| R-23 | 🟢 已修复 | 关注用例静默跳过已修并实跑通过 |
| R-24 | 🟢 已修复 | 关注 UI（FollowButton / following 页）已补齐并实跑通过 |

---

## 9. GitHub PR 与 CI 状态（2026-11-04 21:20 更新）

| 项 | 状态 |
|---|---|
| 远端分支 | ✅ **`feat/v0.0.4-high-fidelity` 已推送**（HEAD `930f29e`） |
| PR | ✅ **PR #5** → master，OPEN，MERGEABLE。https://github.com/alicia1030su/v2ex-clone/pull/5 |
| 仓库可见性 | ✅ **PUBLIC**（`gh api` 实测 `visibility: public`, `archived: false`） |
| 既有 PR | 4 个，全部 MERGED（#1~#4），无 OPEN |
| Tag | `v0.0.1` / `v0.0.2` / `v0.0.3` 完好，**无 v0.0.4**（符合规约） |
| Release | `v0.0.3` **Draft 完好**（`draft=true`, `published_at=null`, 2 资产）；`v0.0.1`/`v0.0.2` 已发布未触碰 |
| master 分支保护 | **未设置**（`GET /branches/master/protection` → 404） |
| GHCR 包可见性 | 本轮无法核实（token 缺 `read:packages` scope） |

### 本轮修复的两个 CI 真实缺陷（均由主理人发现并修复）

1. **`docker-verify.yml` 定义级失败**：汇总步骤把三元式写进 `${{ }}` 上下文
   （`${{ job.status == 'success' && echo PASS || echo '见日志' }}`）——
   GitHub 表达式**不支持** `&&`/`||` 三元（`||` 取默认值是支持的）。
   症状极具迷惑性：run **0 秒结束**、`total_count=0`、**无任何 job 被创建**，
   报错仅一句「This run likely failed because of a workflow file issue」，
   而 YAML 本身**能正常解析**（python yaml 校验通过，1 job / 17 steps）。
   → 修复：三元判断下沉到 `run:` 块的 shell 层
2. **`_journal.json` 路径断言错误**：drizzle 的迁移 SQL 在 `/app/drizzle/` 根目录，
   而 `_journal.json` 与 snapshot 在 `/app/drizzle/meta/` 子目录。
   初版混在同一列表用同一路径断言 → 被误判「镜像内缺少」而红灯。
   → 修复：SQL 与 meta 元数据分成两段断言（覆盖面反而更严）

### `docker-verify.yml` 首轮 CI 实测已通过的部分（R-16 第 9 项）

- ✅ `Config.User` 非 root，容器内 `id -u` ≠ 0
- ✅ 镜像**不含** devDependencies（playwright / vitest / typescript / pixelmatch / pngjs / @types/node 等 8 项）
- ✅ 镜像**含**运行时必需文件（drizzle-kit / tsx / next）—— 生产镜像确实带它们
- ✅ 镜像**不含** `.env` / `.env.local` / `.env.test` / `.env.production` / `INSTALL_CREDENTIALS.txt`
- ✅ 无凭据文件
- ✅ 迁移 SQL `0000`/`0001`/`0002` 均在镜像内
- ✅ **其余 8 项已取证**（**修复前的历史观测**：run `41836588637` 在第 9 项红灯后中止；**最终 run `41871503684`（SHA `2773cd1`）九项全部 completed/success、汇总表全 PASS** ⇒ R-16 / R-17 已闭环）

### ⚠️ 未解阻点

- `master` **未设分支保护** —— PR 合并时无强制 CI 门禁，需人工确认 CI 绿灯后再合并
- GHCR 包可见性本轮无法核实（token 缺 `read:packages` scope）

---

## 10. 下一步具体动作

1. ✅ 全仓 dotenv 加载语义统一（产品侧单一实现 `src/lib/env-loader.mjs`，父子进程一致）
2. ✅ PG 隔离 + 护栏 + 单测基线 **190 全绿**（连续 4 轮）+ E2E **154 条**（本地历史轮次口径 153 全绿 / 连续 2 轮）
3. ✅ 185/190 之谜结题：本机 190 全绿；CI 上的 `185 passed | 5 skipped` 是 `floor-continuity` 崩溃所致（已修，769c779）
4. ✅ UI 缺口 8 项补齐并经主理人真实浏览器独立复核；R-18 升级脚本修复（87 项自检）
5. 🔄 第 4 轮：修复 CI 真实阻断（护栏 3 未落地，v2ex_ci 在 CI 必被拦死）→ 见文末《第 4 轮状态快照》
6. 🔄 第 4 轮：忠实 CI 等价全量验证后台跑测中（tsc + ui-verify + vitest CI 场景 + 护栏断言）
7. ⬜ 提交剩余工作区改动（含 `tests/env/.env.test.example` 模板必须入库）→ 推送 → 观察 CI：unit 转绿、e2e 首跑、docker-verify 全项取证
8. ⬜ E2E/单测库分离（方案 A：E2E→55433/v2ex_e2e，单测→55440/v2ex_test_base）+ `/nodes/request` hydration #418 修复（UI2 实施中，PG 恢复后才能起服务验证）
9. ⬜ 版本同步（5 载体）→ 测试该准确提交 → 定 SHA → 人工放行 tag 白名单 → 建不可变 Tag → 创建 v0.0.4 **Draft** Release

---

## 11. 🚫 禁止执行的危险操作

- ❌ `git reset --hard` / `git clean -fd` / 强制覆盖 / 重新克隆覆盖原目录
- ❌ `git push --force` / 改写远端 Git 历史
- ❌ 删除或移动既有 Tag（v0.0.1 / v0.0.2 / v0.0.3）
- ❌ 删除或替换既有 Release（v0.0.3 Draft 尤其不可动）
- ❌ 删除仓库 / 更改仓库可见性（必须保持 Public）
- ❌ 删除用户数据或原始备份
- ❌ **修改用户日常 `.env.local` 来迁就测试**
- ❌ **DROP `v2ex_loadtest` / `v2ex_v002_baseline` / `v2ex_e2e` 或任何非白名单库**
- ❌ **清空 / 重新 initdb `_tools/pgsql/data-v003`**（含 891MB 压测库，是 v0.0.4 证据）
- ❌ 提前创建 v0.0.4 Tag；反复删除/重建/移动同一 Tag
- ❌ 公开发布 Release（未获主人授权时只能停在 Draft）
- ❌ 把 API 断言当作四身份 UI 验收通过
- ❌ 因「没再次复现」就把未解决问题标 FIXED

---

## 12. 变更历史

| 时间 | 记录 |
|---|---|
| 2026-11-04 20:27 | 第 3 轮开始。只读核查完成：HEAD `301a8a5`、工作区干净、8 提交未推送、PG 需重启、问题 A 根因定位、UI 缺口核实。建团队 `software-v004-finalize`，派发 4 名成员并行。PG 守护启动并验证存活。 |
| 2026-11-04 21:20 | 第 3 轮收尾：分支推送 + PR #5；修复 CI 两个真实缺陷（`${{ }}` 三元、journal 路径）；护栏 51 项断言全通过；本机 190 全绿 / E2E 153 全绿；文档口径统一（185 vs 190 之谜结题）。 |
| 2026-11-04 23:20 | 第 4 轮（跨会话接管续）：PG 两实例下线事件处理（未重启守护，改单次调用内启停）；定位并修复**真正的 CI 阻断**（护栏 3 未落地）；忠实 CI 等价验证跑测中。详见下方快照。 |

---

# 第 4 轮状态快照（2026-11-04 23:20，主理人）—— 最新状态以此为准

## A. 环境事件：两个 PG 实例全部下线

- **实测**：隔离测试实例 `127.0.0.1:55440` 与开发/证据实例 `127.0.0.1:55433` 均无响应（`pg_isready` 逐个确认）。
- **根因**：主人取消了 PG 守护后台任务，`postgres.exe` 作为该进程树的子进程被连带回收。55440 日志最后停在 `23:07:45`、无正常关闭记录；23:07 时段有一场 race 探针（`tests/helpers/__race5.mts`）的并发 `CREATE/DROP DATABASE` 混战，连接被强行关闭。
- **处置**：**未重启守护**（遵守主人"不要重启或重试"的指示），改用仓库脚本认可的模式 1「单次调用内 启动 → 跑测 → 清理」。实测确认：**PG 不能跨 Bash 调用存活**（工具在调用结束时回收进程树）——今后任何跑测都必须把 `start-test-pg.sh start` 与测试放在**同一次调用或同一后台任务**里。
- **55440 已重启并实测稳态**：空库建删往返 **2571ms**（阈值 10000ms），与历史实测 2.0~2.3s 一致；`.env.test` 确认指向 `55440/v2ex_test_base`（符合方案 A）。
- ⚠️ 55433（含 `v2ex_e2e` 等证据库）**仍未恢复**——E2E 与起应用验证在其恢复前一律暂停。

## B. 本轮定位的真正 CI 阻断（重要，推翻上一轮的误判）

- **上一轮现象**：本地 CI 等价跑测 `13 failed | 2 passed | 101 skipped`，伴随 `ReferenceError: config is not defined`。
- **真相**：全仓静态排查（tests/、src/、scripts/、drizzle.config.ts 均无裸 `config` 标识符）+ 两个子进程实验（drizzle-kit 配置加载、tsx 探针导入 `src/db`）**全部正常**。该报错是 **PG 被杀的瞬间 vitest 错误格式化器崩溃**（已知缺陷 `code.charCodeAt is not a function`，会掩盖真实错误）产生的乱码——上一轮跑测正好横跨 PG 被杀时刻（23:07）。
- **真正的阻断**：护栏 3「CI 库名 `v2ex_ci` 不被护栏 2 误伤」只存在于导出函数 `assertCiInstanceOwnership`，而该函数**从未被调用**；globalSetup 走的是 `assertDatabaseAllowed`，它不认 CI 库名。而 CI 的 unit job 只注入 `DATABASE_URL`（→ `v2ex_ci`）、**不**注入 `TEST_DB_ALLOWED_DATABASES` → 新代码推送后 CI 会在建基础库前直接被护栏拦死。
- **修复**（工作区已改，待提交）：
  1. `tests/helpers/test-db-guard.ts` 的 `assertDatabaseAllowed` 新增 `if (process.env.CI && CI_DATABASE_NAMES.has(dbName)) return;` —— 判据是 `process.env.CI`（GitHub Actions 恒为 true），本机不放宽；
  2. `tests/helpers/verify-db-guard.mts` 断言 6 补充「真实 CI 路径」（CI=true 且无 env 注入时必须放行）+ 反向断言（非 CI 无注入时必须仍拒绝），50 → **52 项**。
- **教训（写进文档警醒后人）**：上一轮本地 CI 等价场景设了 `TEST_DB_ALLOWED_DATABASES=v2ex_ci_sim`，而真实 CI 并不设这个变量——**模拟环境比真实环境宽松，正好把阻断掩盖了**。

## C. 团队成员状态（2026-11-04 23:20）

| 成员 | 状态 | 任务 |
|---|---|---|
| software-architect | 因网关空流故障中断 → **已恢复** | v0.0.4 版本同步只读审计（5 载体修改清单 + preflight 断言一致性） |
| software-qa-e2e | 因集群负载故障中断 → **已恢复** | 方案 A：E2E（55433/v2ex_e2e）与单测（55440/v2ex_test_base）库分离；先改文件提交，全量复跑等主理人通知 |
| software-engineer-ui2 | 工作中（起服务验证已暂停） | 修 `/nodes/request` hydration #418 真实产品缺陷 |
| software-engineer-docs | 工作中 | 护栏修复文档 + `docs/evidence/ci/` 证据记录 |
| software-engineer-testenv / deploy / dotenv / qa-ci | 空闲 | 待命 |

## D. 后台任务与待提交物

- 后台任务 `HpLUcU`：忠实 CI 等价全量验证（PG start → `tsc --noEmit` → `ui-verify.cjs` → vitest CI 场景（CI=true + 55440/v2ex_ci，**不设** TEST_DB_ALLOWED_DATABASES）→ 护栏断言复跑）。
- **待提交**：`.gitignore`、14 份文档、`tests/**`（含新 helpers 与上述 2 处护栏修复）、`vitest.config.ts`、`scripts/verify.sh`、`scripts/release/preflight.sh`、**`tests/env/.env.test.example`（模板，必须入库）**。
- **待清理**：`_probe-gs.mts`、`tests/helpers/__race5.mts`（一次性调试探针）。

---

# 第 5 轮状态快照（2026-11-05，主理人）—— 最新状态以此为准

## A. 本轮已推送提交（分支 feat/v0.0.4-high-fidelity，PR #5）

| Commit | 内容 |
|---|---|
| `0511471` | docs: 根目录交付文档口径统一（BUG_REGISTER/CHANGELOG/README/RELEASE_GATE） |
| `6289ea3` | chore(release): preflight 环境加载语义断言（第 8 节 16 项）+ verify.sh 注释勘误 |
| `dda4f70` | fix(docker): runner 镜像补拷 `src/lib/env-loader.mjs`（容器迁移模块缺失回归） |

## B. v0.0.4 首次真实 CI 全量结果（run 41860242099，SHA 6289ea3）—— 三job两败一胜

| Job | 结果 | 说明 |
|---|---|---|
| 类型检查 / 单元测试 | ✅ **success** | **v0.0.4 在真实 CI 上首次转绿**：vitest 15 文件全过、globalSetup 正常建迁 `v2ex_ci`。护栏 3 修复（634a202）被实证有效。 |
| E2E 测试 | ❌ failure | **史上首次真实运行**：153 条中 **152 通过、1 失败**（`v004-four-roles-ui` 节点申请用例）。⚠️ 该 run 的分母仍是 153 条（`ed385cf` 之前）；**最新 CI run `41873009808` 的分母已是 154 条** |
| Docker 构建与启动验证 | ❌ failure | 第 2 项断言「Compose 启动」红灯：app 容器 `restarting` 无限重启。 |

### B1. Docker 失败根因（已修，`dda4f70`）

镜像内 entrypoint 阶段 1「迁移」→ drizzle-kit 读 `/app/drizzle.config.ts` → `import './src/lib/env-loader.mjs'` → **Cannot find module** → 迁移失败 → 容器退出 → compose 无限重启。
dotenv 统一加载器重构给 `drizzle.config.ts` 引入了该依赖，但 Dockerfile runner 层拷贝清单（只拷 `src/db` + `src/lib/password.ts`）未同步——**回归漏网原因：重构后没人重跑过 docker-verify**。依赖追踪确认镜像内唯一漏拷文件（5 个 import 方：drizzle.config.ts / src/db/index.ts / seed.ts / admin-cli.ts / db-admin.mjs；env-loader 自身只依赖 node:fs / node:module / node:path / dotenv，无递归风险）。本地无 Docker，验证只能靠 CI（R-16/R-17 的唯一取证通道，设计如此）。

### B2. E2E 失败根因证据链（trace 级实锤，已移交 ui2 修复）

失败用例 `e2e/v004-four-roles-ui.spec.ts:122`「节点申请」：
1. 点「提交申请」触发**浏览器原生表单 GET 提交**（trace 实证 URL：`/nodes/request?nodeName=...&nodeTitle=...&description=...`），整个 trace **无任何** `POST /api/node-requests`——React `onSubmit` 从未执行；
2. 点击过程中抛出未捕获 `TypeError: nodeName.toLowerCase is not a function`——该无保护调用存在于 **react-dom 自己的 hydration 遍历函数 `canHydrateInstance`**（react-dom-client.production.js:16660）；
3. 页面 reload 后再次抛出同类错误（栈经 RSC payload 消息处理器）；失败瞬间截图：表单空、按钮回 disabled、无 toast；
4. 另一实例：`Minified React error #418`（hydration 不匹配）在**首页 `/`** 触发（SignUpForm 用 `window.location.href` 整页加载 `/`）；
5. 反证：`waitForHydration` 通过、fill 后按钮解禁——React 接管了表单，但**提交路径的事件分发崩了**；
6. 页面到达路径为客户端导航（/nodes 点 Link）；/nodes hydration 正常，/nodes/request 与 `/` 失败。

**这是 v0.0.4 的真实产品缺陷**（生产构建下节点申请 UI 提交链断裂），不是测试误报。修复与验证全部走 CI E2E job。

## C. 团队成员状态（2026-11-05）

| 成员 | 状态 | 任务 |
|---|---|---|
| software-engineer-ui2 | **已派发证据包，修复中** | #418 hydration 根因（B2 证据链）；禁自行起库起服务，验证走 CI |
| software-architect | 在途 | v0.0.4 版本同步只读审计（5 载体） |
| software-qa-e2e | 在途 | 方案 A 库分离（阶段 1 改文件提交；阶段 2 全量复跑等通知） |
| software-engineer-docs | 在途 | 护栏修复文档 + `docs/evidence/ci/` 证据记录（按 52 项口径） |
| software-engineer-deploy / testenv / dotenv / qa-ci | 空闲/待命 | — |

## D. 待观察 / 待办

- **观察 `dda4f70` 的 CI 三件套**：Docker job 与 docker-verify 工作流应转绿（env-loader 已补拷）；E2E 预计仍红 1 条（ui2 修复中）——这是预期内的红，修复后复跑。
- 55433（v003 证据库）仍未恢复 → 本地 E2E/起应用验证继续暂停。
- 版本同步（5 载体）→ 测该提交 → 定 SHA → 人工放行 tag → 建不可变 Tag → Draft Release：等 ui2 修复 + CI 全绿后执行。
- R-01 仍 DEFERRED，等待主人单独授权。

---

# 第 6 轮状态快照（2026-11-05，主理人）—— 最新状态以此为准

## A. 本轮已推送提交（分支 feat/v0.0.4-high-fidelity，PR #5）

| Commit | 内容 |
|---|---|
| `827eef7` | fix(ci): docker-verify 安装模拟改走首次安装路径（删不完整的 .env 预置块） |
| `2773cd1` | fix(ci): 安装模拟前 unset job 级 env —— 修复 compose 插值被 shell 环境变量覆盖（见 B2） |

## B. docker-verify 工作流**首次全绿**（run 41871503684，SHA 2773cd1）

R-16/R-17 九项验证 **completed / success**，九项汇总表全 PASS。安装模拟段实证输出：

```
app health = healthy
安装产物口径：POSTGRES_USER=v2ex POSTGRES_DB=v2ex SEED_ADMIN_USERNAME=admin
管理员账号数 = 1
```

同 SHA 的「安装验证」工作流亦 completed/success（deploy/ 未变动仍触发，无害）；CI 的 unit 与 Docker job ✅，E2E 在跑（预计仍红 1 条，等 ui2）。另：本次推送 GitHub 事件重复投递，每个工作流出现两个同 SHA run（concurrency 未抵消早跑的那个），两个 docker-verify run 均独立跑绿，无影响。

### B1. `827eef7` 的效果（安装模拟全程跑通）

install.sh 完成、`.env` 600、INSTALL_CREDENTIALS.txt 600、口令 32/32/48/16 位、`V2EX_IMAGE = v2ex-clone:dv`（纯本地镜像）、app healthy——首次安装路径全部真实通过。

### B2. `2773cd1` 修复的根因（真实 CI 抓到的第二类问题：**假绿**）

事故现场（run 41868374546，SHA 827eef7）：安装模拟全程「成功」，但最后 psql 报 `FATAL: database "v2ex" does not exist`。

根因链：
1. Docker Compose 变量插值优先级为 **shell 环境变量 > .env 文件**；
2. docker-verify.yml job 级 env（为根 compose 栈准备）含 `POSTGRES_DB=v2ex_dv` 等一整套变量；
3. install.sh 执行裸 `docker compose up -d`（无 `--env-file`，靠当前目录 .env 插值）→ 安装栈实际使用工作流占位凭据：postgres 初始化出 `v2ex_dv`（`pg_isready` 不校验库是否存在，healthcheck 照样 Healthy）、app 的 `DATABASE_URL` 也插值成 `.../v2ex_dv`（同一来源，内部自洽 → healthy）；
4. 硬编码的 `psql -d v2ex` 必然 FATAL。

比红灯更危险的是：整个安装模拟被悄悄降级——验的不再是 install.sh 生成的随机口令，凭据文件与库内 seed 实际口令不一致。install-verify.yml 无此组 job 级 env，此前一直真绿，可作对照。ci.yml 的 docker job 为根栈专用（v2ex_ci 全链一致、无 install.sh 模拟），不存在该模式。

修复：跑 install.sh 前 unset 全部会泄漏进 compose 插值的 job 级变量（仅作用于本 step 的 shell；末尾恢复根 compose 用 `--env-file .env.dv`，11 键齐全）；安装后管理员检查改为从 .env 派生 POSTGRES_USER/POSTGRES_DB/SEED_ADMIN_USERNAME，不再硬编码。

## C. 团队成员状态（2026-11-05，压缩恢复后已发状态跟进）

| 成员 | 状态 | 任务 |
|---|---|---|
| software-engineer-ui2 | 已催促，等回复 | #418 hydration 根因修复（证据包见第 5 轮 B2）；禁自行起库起服务，验证走 CI |
| software-architect | 已催促，等回复 | v0.0.4 版本同步只读审计（5 载体清单表） |
| software-qa-e2e | 已催促，等回复 | 方案 A 库分离（阶段 1 提交情况 + 阶段 2 阻塞点；PG 不重启） |
| software-engineer-docs | 已催促，等回复 | 证据记录；口径：已修不显 OPEN、未复现不标 FIXED、2773cd1 待 CI 实证后再落文档 |
| software-engineer-deploy / testenv / dotenv / qa-ci | 空闲/待命 | — |

## D. 待观察 / 待办

- **E2E 仍是唯一红灯**：等 ui2 的 hydration 修复提交推送 → CI e2e job 验收 **154/154 全绿**（最新 run `41873009808` 为 `153 passed | 1 failed | 154 total`）。
- 版本同步（5 载体，architect 审计表）→ 测该提交 → 定 SHA → 人工放行 tag 白名单 → 建不可变 Tag → v0.0.4 Draft Release：等 CI 全绿后执行。
- 55433（v003 证据库）仍未恢复 → 本地 E2E/起应用验证继续暂停（主人已取消 PG 恢复，**不要重启或重试**）。
- R-01 仍 DEFERRED，等待主人单独授权。

---

# 第 7 轮状态快照（2026-11-05，主理人）—— 最新状态以此为准

> **本轮主题**：v0.0.4 收尾轮 —— 修复上一轮遗留的**唯一红灯**（V4-20 / R-27：节点申请 UI 提交链断裂），
> 并把全部交付文档的状态与数字同步到「已修复并实测验证」口径。

## A. 本轮起点（只读核查结果）

| 项 | 值 |
|---|---|
| HEAD | `5ce8b3f`（`docs: 交接文档追加第 6 轮快照 —— docker-verify 九项首次全绿 + compose 插值 env 泄漏根因（假绿）与修复实证`） |
| 分支 | `feat/v0.0.4-high-fidelity`（PR #5） |
| 工作区状态 | **干净** —— `git status --short` 仅有未跟踪的 `_scratch/`（临时目录，非成果物） |
| 未提交成果需抢救 | **无** —— 本轮起点不存在未提交的可交付成果，无需抢救 |

> ⚠️ 结论：**上一轮不存在「工作区已修、提交历史未修」的遗留**（那正是第 5 轮踩过的坑，见 B2）。
> 本轮从干净工作区起步，改动全部经由提交 `bddb3d0` 落地。

## B. 单元测试基线实测：190/190 → 194/194

| 项 | 修复前 | 修复后 |
|---|---|---|
| 单元测试 | **190 passed / 0 failed / 0 skipped（15 文件）** | ✅ **194 passed / 0 failed / 0 skipped（16 文件）** |
| 增量来源 | — | **新增 `tests/form-name-shadowing.spec.ts`，4 条防回归断言** |
| 耗时 | 81.68s | 81.68s |

> ⚠️ **耗时口径必须区分**：**81.68s 是「隔离实例」口径**（本轮 `127.0.0.1:55440`）；
> **历史轮次的 170~210s 是「共享实例 55433」口径**。两者不可直接比较 —— 换算口径不同，不是性能退化。
> `numPendingTests: 0` 仍成立 —— **没有任何用例被静默跳过**（比「全绿」更强的结论）。

## C. 文档口径审计结果

### C1. 上一轮文档全面校正（提交 `ee6ce76`）

| 项 | 值 |
|---|---|
| 审计范围 | **21 个文件** |
| 改动规模 | **+620 / -323** |
| E2E 分母校正 | **153 → 154**（`--list` 权威 `Total: 154 tests in 11 files`） |

### C2. 本轮（V4-20 修复轮）文档状态同步

| 项 | 值 |
|---|---|
| 审计范围 | **15 个交付文档**（`BUG_REGISTER` / `RISK_REGISTER` / `CHANGELOG` / `RELEASE_GATE` / `TEST_REPORT` / `README` / `FEATURE_MATRIX` + `docs/` 下 5 份 + `docs/evidence/` 下 2 份） |
| 单元分母校正 | **190 → 194**（V4-20 修复新增 `tests/form-name-shadowing.spec.ts` 的 4 条防回归断言） |
| E2E 结果校正 | **153 passed \| 1 failed → 154 passed / 0 failed / 0 skipped**（153\|1 failed 保留为**修复前的历史快照**） |
| 状态位同步 | V4-20 / R-27 由「🔴 未修复（修复中）」改为「🟢 已修复并本地实测验证（`bddb3d0`）」 |

> 本轮**只改数字与状态**，不重写技术描述、不删章节；历史数字一律**保留为历史快照**并逐处标注来源。
> ⚠️ **未改** `src/` / `tests/` / `e2e/` 下任何文件（修复代码属提交 `bddb3d0`，本轮只动文档）。

## D. V4-20 完整根因链（本轮最有价值的产出）

> **本地实测 + trace 级证据，非推测。**

### D1. 根因链（逐环节）

1. **HTML 规范层**：规范给 `HTMLFormElement` 加了 **`[OverrideBuiltins]`** —— 表单内的**命名控件**
   会**遮蔽原型上的同名属性**。
2. **DOM 行为层**：`<form><input name="nodeName"></form>` ⇒ `form.nodeName` 返回 **HTMLInputElement**
   （**不是**字符串 `"FORM"`）。
3. **框架层**：Next.js 15.5 内置的 React 19 水合代码（`react-dom-client.production.js` 的
   **`canHydrateInstance`**）有一行 `instance.nodeName.toLowerCase() !== type.toLowerCase()`
   —— 此时 `nodeName` 是 Element ⇒ `.toLowerCase()` **不存在**
   ⇒ `TypeError: nodeName.toLowerCase is not a function`。
4. **框架后果**：水合失败（**React #418**）⇒ **事件处理器不绑定**。
5. **浏览器后果**：表单走**浏览器原生 GET 提交** ⇒ **写操作彻底失效**。

### D2. 实测矩阵（修复前 → 修复后）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 单元测试 | 190 passed / 190（15 文件） | ✅ **194 passed / 194（16 文件）** |
| E2E | 153 passed / 1 failed / 154 total | ✅ **154 passed / 0 failed / 0 skipped（11 文件，3.9m）** |
| `/nodes/request` 的 React #418 | **2 次** | ✅ **0 次** |
| 提交请求 | **无（原生 GET）** | ✅ **`POST /api/node-requests`** |
| 提交后 URL | **`?nodeName=...`** | ✅ **停在 `/nodes/request`** |
| 成功 toast | **不出现** | ✅ **出现** |

### D3. 关键实测结论（命名属性遮蔽的边界）

| 属性写法 | 是否致命 | 说明 |
|---|---|---|
| `name="nodeName"` | ☠️ **致命** | 遮蔽 `form.nodeName` ⇒ react-dom 抛 `TypeError` |
| `id="nodeName"` | ☠️ **致命** | **同样致命** —— `id` 与 `name` 都会成为命名控件 |
| `name="title"` / `id="title"` | ⚠️ **隐患项** | 有遮蔽语义，但 **react-dom 不崩** —— react-dom 只读 `instance.nodeName` |
| `name="action"` / `name="id"` | ⚠️ **隐患项** | 同上 |

### D4. 本地执行环境

| 项 | 值 |
|---|---|
| PG | **隔离实例 `127.0.0.1:55440`** |
| 应用构建 | **生产构建** `next build` + `next start -p 3010` |
| 浏览器 | **Chromium** |

## E. 修复清单与提交号

**提交：`bddb3d0`** —— `fix(ui): 修复节点申请 UI 提交链断裂（V4-20 / R-27）—— 表单命名属性遮蔽 form.nodeName`

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/components/NodeRequestForm.tsx` | `name="nodeName"` → `name="node_slug"`；`id="nodeName"` → `id="node_slug"`；`name="nodeTitle"` → `name="node_title"`；`id="nodeTitle"` → `id="node_title"` |
| 2 | `src/components/NewTopicForm.tsx` | `name="title"` → `name="topic_title"`（**`id="title"` 有意保留** —— E2E 用 `#title` 定位） |
| 3 | `src/components/TopicEditForm.tsx` | `name="title"` → `name="topic_title"` |
| 4 | `e2e/v004-four-roles-ui.spec.ts` | 选择器 `input[name="nodeName"]` → `input#node_slug`；`input[name="nodeTitle"]` → `input#node_title` |
| 5 | `e2e/helpers.ts` | 标题框选择器改用 `input#title` |
| 6 | `tests/form-name-shadowing.spec.ts`（**新增**） | **4 项防回归断言**，扫全仓 `src/`，禁止任何表单控件的 `name`/`id` 遮蔽 `form.nodeName` |

> ✅ 修复已推送；**CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ `Test Files 16 passed (16)` / `Tests 194 passed (194)`、e2e ✅ `154 passed (2.5m)` / 0 failed、docker ✅）。
> 上一轮 CI run `41873009808` 的 `153 passed | 1 failed` 是**修复前**的历史快照。

## F. E2E 154/154 全绿实测

```
154 passed / 0 failed / 0 skipped（11 文件，3.9m）
```

- 单元：**194 passed / 0 failed / 0 skipped（16 文件）**，耗时 81.68s（隔离实例口径）。
- E2E：**154 passed / 0 failed / 0 skipped（11 文件，3.9m）**。
- `/nodes/request` 的 React #418 **由 2 次归零**；提交请求恢复 `POST /api/node-requests`；URL 停在 `/nodes/request`；成功 toast 出现。
- ✅ **CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅） —— 本地全绿 ≠ CI 已通过。

## G. 本地执行环境的三条纪律（务必遵守）

| # | 纪律 | 原因 |
|---|---|---|
| 1 | **PG 的生命周期必须在同一次调用内启动与测试** | PG 实例不跨调用存活 —— 起了不测，测了不关，都会造成后续轮次「连不上」的假失败 |
| 2 | **`next build` 会被 WorkBuddy 的 fs shim 拦截** ⇒ 须先清 `NODE_OPTIONS` | 拦截后构建静默失败或产物不完整，表现为「代码没错但跑不起来」的假象 |
| 3 | **管道会导致 postgres 不退出 ⇒ 被 SIGTERM** | 用管道（如 `| tail`）承接输出会让 PG 的标准输出/错误仍被占用，进程无法正常退出并被 SIGTERM 杀掉 |

## H. 下一步动作

| # | 动作 | 说明 |
|---|---|---|
| 1 | **CI 复验** | `bddb3d0` 已推送，等待 CI run 完成；验收口径：unit `194 passed / 16 文件`、e2e `154 passed / 0 failed / 0 skipped`。**补上 run id** 后回填全部交付文档 |
| 2 | **版本同步** | 5 载体（`package.json` / `deploy/VERSION` / `README.md` / `FEATURE_MATRIX.md` / `RELEASE_GATE.md` / `TEST_REPORT.md`）在**最终 SHA 固定后一次性**从 `0.0.3` 同步到 `0.0.4`（R-20 裁决；**本轮刻意保持 0.0.3**） |
| 3 | **Tag** | 人工放行 `release.yml` tag 白名单 → 建**不可变** Tag `v0.0.4`（G-VER-01；**本轮未创建**） |
| 4 | **Draft Release** | CI 全绿后创建 **Draft** Release（`publish=false`）；**不得公开发布** |

> ⚠️ **R-01 仍为 DEFERRED** —— 禁止改写远端历史 / 删 Tag / 改 Release / 改仓库可见性。
> 本轮改动**未触碰**任何 R-01 相关表述。

---

# 第 9 轮状态快照（2026-11-05，主理人）—— 发布阶段的三轮修复链

> 本轮 = **发布流水线的实战修复**。v0.0.4 的 Tag 已建，但发布流水线**自身**
> 暴露出一连串缺陷 —— 这是「从未真正跑过的流水线」在第一次实战时的必然结果。
> 本轮把它们全部定位、修复并验证。

## A. 起点：v0.0.4 Tag 已创建，流水线首次实战即红灯

| # | 动作 | 结果 |
|---|---|---|
| 1 | 版本载体同步（5 载体 + deploy/ 侧 10 文件） | `54c3d02` |
| 2 | preflight 豁免规则修正（`\.example($|\.)`） | `54c3d02` |
| 3 | release tag 白名单人工放行（加 `v0.0.4`） | `3c2acd6` |
| 4 | CI 复验（最终 SHA 全 workflow 绿） | ✅ |
| 5 | **合并 PR #5**（squash） | master → `c0e7396` |
| 6 | **创建不可变 Tag `v0.0.4`** | 指向 `c0e7396`（annotated tag） |
| 7 | 推送 Tag → 触发 Release 流水线 | run `41954236858` 🔴 |

**第一次实战（run `41954236858`）**：2 个 job 红灯
（安全扫描、单元测试）—— 详见 §B。

## B. 第一轮：流水线自身的两个真实缺陷（`64a2f09`）

| # | 缺陷 | 根因 | 修法 |
|---|---|---|---|
| 1 | **单元测试 job 红灯** | `tests/helpers/test-db-guard.ts` 的 `CI_DATABASE_NAMES` 只列 `v2ex_ci`（ci.yml 用），而 release.yml 用 `v2ex_release_unit` / `v2ex_release_e2e` ⇒ 护栏 2 不认 ⇒ 启动即拦死 | 加入两个 release 库名（判据仍是 `CI` 为真才生效，本机约束不放宽） |
| 2a | **安全扫描：`.env` 误判** | 豁免规则只写 `\.env\.example$`，把**恰恰应该入库**的 `tests/env/.env.test.example` 判成「被跟踪的环境文件」 | 扩展为 `\.example($|\.)` |
| 2b | **安全扫描：明文口令检查静默失效** | 排除「空值」的 grep **引号未闭合** ⇒ bash 抛 `syntax error near unexpected token ')'` ⇒ 整个 `hits="$(…)"` 赋值失败 ⇒ **这道检查等于没有生效** | 正则放进双引号，单引号成对写 `''`（已双向验证） |

> ⚠️ 缺陷 1 的真实报错是 `TypeError: code.charCodeAt is not a function` ——
> 来自 **vitest 自己的错误格式化器崩溃**（`vite/dist/node/module-runner.js`
> 的 `extractInlineSourceMap`），把真实原因吃掉了。
> 这是第 4 轮就记录过的**已知缺陷**，本轮再次咬人。

## C. 第二轮：「Tag 不可移动」与「流水线需修复」的死锁（`29689fd` / `e921751`）

修好缺陷后陷入死锁：

- Tag `v0.0.4` 已存在且指向 `c0e7396`（不含修复）⇒ 流水线默认检出 tag 指向的
  commit ⇒ 拿不到修复 ⇒ 继续红；
- 移动 Tag ⇒ **违反「同一版本号不得反复删除、重建或移动 Tag」的规约**，
  且属需主人**单独授权**的高风险操作；
- `gh run rerun` **无效** —— GitHub 的 rerun 复用**触发时**的 workflow 定义快照，
  实测日志显示 `HEAD is now at c0e7396`（旧代码），新增的 `ref: master` 未生效；
- `workflow_dispatch` 也被 tag 存在性检查拦住。

### 解决：把「构建用的代码」与「版本锚点」解耦

1. **全部 8 个 job 的 checkout 加 `ref: master`** ——
   Tag 保持不动（不需额外授权），构建用 master（含修复）。
   **安全性论证**（已写入代码注释）：
   - 发布包内容不受影响：`git diff v0.0.4 origin/master -- deploy/ src/ package.json drizzle/`
     **输出为空** ⇒ 发布包逐字节一致；
   - Tag 指向校验仍有效（`github.sha` 与 checkout 的 `ref` 无关）；
   - Release 的 target 用「版本锚点指向的 commit」。
2. **tag 存在性检查改为三态**：Tag 不存在 → 正常发版；Tag 存在 + **Release 已存在**
   → **拒绝**（资产不可覆盖）；Tag 存在 + Release 未创建 + **发布内容零差异**
   → **允许补救路径**。
3. **新增 `resolve-tag` job** 用 `gh api` 解析版本锚点（不依赖任何 job 的 checkout）。

## D. 第三轮：静态审查一次抓出 6 个缺陷（`6c0a1d8` / 权限修复 PR #13）

`resolve-tag` 是新引入、**从未真实跑过**的 job ⇒ 对整条流水线做了一次完整静态
审查（Actions 表达式语义 / bash 正确性 / 数据流 / 竞态 / 幂等）。

| # | 缺陷 | 置信度 | 修法 |
|---|---|---|---|
| F1 | `resolve-tag` 在 tag 存在时**从不写 `sha` output**（下游全拿到空值 → preflight exit 1、docker 标签非法） | **确定** | 两条分支都写 `sha` |
| F2 | `preflight` 的 `gh release view` **缺 `env: GH_TOKEN`** ⇒「Release 已存在」闸门**静默失效** | **确定** | 补 `env:` |
| F3 | 竞态检查比较**同一个 output 的两份拷贝** ⇒ 恒为相等 ⇒ 检不出 tag 被移动 | **确定** | 当场重新解析远端 tag |
| F4 | 零差异校验 **fail-open**（`--depth=1` + `|| true` 吞掉 `git diff` 失败） | 可能 | 去掉两者，**比较失败即中止** |
| F5 | `verify-release` 的 `docker pull` 无 registry 登录（注释说「带凭据」但实际匿名） | 可能 | 补 `docker/login-action` |
| F6 | manifest 探测 Accept 缺 v2 单 manifest 类型 | 可能 | 补全四种类型 |

**F1 已本地用真实 GitHub API 完整复刻验证**（tag 存在 / 不存在两条路径均正确）。

### 第四轮：`gh release create` 403

run `41978482846` 已 ✅ 通过 9/11 个 job（含首次真实运行的 `resolve-tag`），
「创建并发布 Release」红灯：

    HTTP 403: Resource not accessible by integration
    (https://api.github.com/repos/alicia1030su/v2ex-clone/releases)

**逐一排除**（实测）：参数错误（用个人 token 传两种 target 都成功）、
Release 已占用、job 级 permissions 整体失效（`build-image` 的 `packages: write` 生效）、
token 无效（`preflight` 的 `gh release view` 成功）、仓库/分支策略限制（无）。

⇒ 唯一解释：**`contents: write` 不足以创建 Draft Release** ——
Draft 在 GitHub 权限模型里属 **PR-like 资源**，需 `pull-requests: write`。
→ 修法：仅给 `publish-release` 加这一项（最小增量，其他 job 未放宽）。

## E. 本轮沉淀的方法论

1. **「从未跑过的流水线」要静态审查**：新引入的 job 路径没有任何历史绿灯可参照，
   静态审查（Actions 表达式语义 + bash 语义 + 依赖图 + 竞态）能在跑之前抓出
   确定性缺陷。本轮 F1 就是「只写了一条分支的 output」这种低级错误 ——
   **静态审查一次抓 6 个，比逐轮试错快得多**。
2. **GitHub Actions 的 output 语义**：未通过 `$GITHUB_OUTPUT` 声明的 output
   求值为**空字符串**，且**不会**让 step 失败 ⇒ 错误会**静默传播**到下游。
3. **GH CLI 需要显式 `GH_TOKEN`**：runner 只预装二进制，不做 `gh auth login`。
4. **Draft Release 属 PR-like 资源**：`contents: write` 不够，要 `pull-requests: write`。
5. **`gh run rerun` 不能用于「修复流水线自身」** —— 它复用触发时的定义快照。

## F. 当前状态

| 项 | 状态 |
|---|---|
| Tag `v0.0.4` | ✅ 已创建，指向 `c0e7396`（**未移动**，符合「同一版本号不得反复删建或移动」的规约） |
| Release `v0.0.4` | ⬜ **未创建**（流水线在创建前失败） |
| master | 含全部发布修复 |
| 发布内容与 Tag 零差异 | ✅ `deploy/` `src/` `package.json` `drizzle/` 全部无差异 |
| 现有 Release | `v0.0.1` / `v0.0.2` / `v0.0.3`（Draft）**完好未动** |

## G. 下一步动作

| # | 动作 | 说明 |
|---|---|---|
| 1 | 合并权限修复 PR #13 | `publish-release` 加 `pull-requests: write` |
| 2 | 重新触发发布流水线（dispatch + `publish=false`） | 走补救路径 ⇒ 创建 **Draft** Release |
| 3 | 核验 Draft Release 资产 | `v2ex-clone-v0.0.4-deploy.zip` + `SHA256SUMS` 齐全，`draft=true` |
| 4 | 回填 run id 与资产清单到交付文档 | — |
| 5 | ⬜ **正式发布需主人单独授权** | R-01 未裁决 ⇒ 只能停在 Draft |

> ⚠️ **R-01 仍为 DEFERRED** —— 禁止改写远端历史 / 删 Tag / 改 Release / 改仓库可见性。
> 本轮**未移动、未删除**任何 Tag 或 Release；测试期间用个人 token 临时创建的两个
> 探针 Draft 已**立即删除**（Release 列表已复原）。

---

# 第 10 轮状态快照（2026-11-05，主理人）—— v0.0.4 Draft Release 已交付

> 本轮 = **发布阶段收官**。v0.0.4 的 Draft Release 已由流水线创建并通过远端核验。
> 第 9 轮快照 §G「下一步动作」表**已全部完成**。

## A. 本轮解决的最后一个问题：`gh release create` 连续 403

第 9 轮留下一个未决问题：发布流水线跑到「创建并发布 Release」就红灯
（`HTTP 403: Resource not accessible by integration`），Release 建不出来。

### 定位过程（**五轮 run**，逐个排除假设）

| # | 假设 | 验证方式 | 结论 |
|---|---|---|---|
| 1 | 权限项不够（需 `pull-requests: write`） | PR #13 加上后重跑（run `41983127742`） | ❌ **仍 403** |
| 2 | 参数错误（`--target` 不是 tag 目标） | 个人 token 分别传「tag 目标」与「master HEAD」建 Draft | ❌ 都成功 ⇒ 参数没错 |
| 3 | Release 已被占用 | `gh release list` | ❌ v0.0.4 不存在 |
| 4 | job 级 `permissions` 整体失效 | `build-image` 的 `packages: write` 生效（镜像推送成功）；`verify-release` 日志显示 `Contents: write` | ❌ **生效** |
| 5 | token 无效 | `preflight` 的 `gh release view`（同 token）成功 | ❌ 有效 |
| 6 | 仓库/分支策略限制 | 无分支保护；`actions/permissions/workflow` = read（job 级可覆盖） | ❌ 无限制 |
| 7 | `.permissions` 全 false ⇒ token 无权限 | **假象** —— 该字段反映 GitHub App installation 权限，与 GITHUB_TOKEN 在当前 job 的可用权限不是同一回事 | ❌ 误导 |

期间还**误判过一次**：run `41985412431` 的诊断步骤里 `gh api POST /releases`
成功（id `434887371`），于是判定「403 是 `gh release create` CLI 封装自身的行为」。
**run `41988622554` 证伪了它** —— 那次改用 `gh api` 但显式传了
`-f target_commitish=<sha>`，**同样 403**。

### 真正的根因：`target_commitish` 参数

五轮 run 的变量对比，终于收敛：

| run | 调用方式 | `target_commitish` | 结果 |
|---|---|---|---|
| `41978482846` | `gh release create --target <sha>` | 有 | ❌ 403 |
| `41983127742` | `gh release create --target <sha>` | 有 | ❌ 403 |
| `41985412431` | `gh api POST`（诊断步骤） | **无** | ✅ **成功**（id `434887371`） |
| `41985412431` | `gh release create --target <sha>` | 有 | ❌ 403 |
| `41988622554` | `gh api POST -f target_commitish=<sha>` | 有 | ❌ 403 |

**同一个 token、同一个 job、同一个 tag —— 传它就 403，不传就成功。**

而不传它是**安全的**：GitHub REST API 文档明确
「target_commitish … **Unused if the Git tag already exists.**」
⇒ tag `v0.0.4` 已存在，该参数本来就不会被使用；不传它，Release 的
target 自动关联现有 tag（`c0e7396`），语义完全正确。

（403 的确切内部原因只有 GitHub 知道 —— 推断是它会对该参数指向的
commit 做一次可见性校验，而 GITHUB_TOKEN 的仓库级读取受限
——`.permissions` 全 false 是旁证。**「传/不传」的因果关系已由五轮 run 实测确认。**）

### 修复（PR #16 / #18）

- 「创建 Release」步骤改为 `gh api` 实现：`gh api --method POST repos/{}/releases`
  + 从 `upload_url` 拼 `?name=` + `--input` 上传资产
- **去掉 `target_commitish`**（PR #18，真正的根因）
- 上传失败即**回滚**（删除刚建的 Draft）⇒ 不会留下「无资产 Draft」阻塞重跑
- 诊断步骤降级为只读 ⇒ 不再每次产生垃圾 Release/tag

## B. 本轮实测：发布流水线 11/11 job 全绿

**run `41991745413`**（SHA `f5e1dd4`，`workflow_dispatch`，`publish=false`）：

| job | 结果 |
|---|---|
| 解析版本锚点（tag → commit） | ✅ |
| 前置检查（版本冲突检测，**补救路径判定生效**） | ✅ |
| 代码检查（类型 + 构建） | ✅ |
| 安全扫描（依赖 + 秘密） | ✅ |
| 单元测试 | ✅ |
| E2E 测试 | ✅ |
| 构建并推送镜像 | ✅ |
| 部署验证（启动 + 重启持久化） | ✅ |
| 生成安装包 | ✅ |
| **创建并发布 Release** | ✅ |
| **远端核验（Release 与资产）** | ✅ |

**这是 v0.0.4 发布流水线首次完整跑通。**

## C. v0.0.4 Draft Release 交付核验（全部通过）

| 核验项 | 结果 |
|---|---|
| Release 存在 | ✅ id `434929894`，tag `v0.0.4` |
| **draft 状态** | ✅ `draft: true`（符合「未获单独授权只能停 Draft」） |
| prerelease | ✅ `true` |
| author | ✅ `github-actions[bot]`（与 v0.0.3 一致） |
| 资产 1 | ✅ `v2ex-clone-v0.0.4-deploy.zip`（52,049 bytes，state=uploaded） |
| 资产 2 | ✅ `SHA256SUMS`（95 bytes，state=uploaded） |
| **SHA256 校验** | ✅ 下载后实算 `a08a1a0a…7607`，与 `SHA256SUMS` **逐字匹配** |
| 安装包内容 | ✅ 15 个文件，全在 `deploy/` 下（脚本/compose/env 模板/文档） |
| 版本载体（包内） | ✅ `deploy/VERSION` = `0.0.4`；`V2EX_IMAGE=…:v0.0.4`；`APP_VERSION="0.0.4"` |
| 无真实 `.env` | ✅ 包内只有 `.env.example` 模板 |
| GHCR 镜像 | ✅ `ghcr.io/alicia1030su/v2ex-clone:v0.0.4` 拉取成功（多层 fs layer） |
| Tag 未移动 | ✅ annotated tag `aed641d` → commit `c0e7396`（与创建时一致） |
| 其他 Release 完好 | ✅ `v0.0.1` / `v0.0.2` / `v0.0.3` 未动 |

### 顺手清理的残留

诊断步骤（run `41985412431`）曾成功创建一个诊断 Draft（id `434887371`，
tag `v0.0.4-diag-41985412431`），其自清理因同样的 403 而失败。
本轮**手工清理**：
- Release `434887371` → 已删除
- 诊断 tag → **从未被创建**（GitHub 对 draft 允许 untagged，
  `DELETE git/refs/tags/…` 返回 422 `Reference does not exist`）

⇒ 最终 Release 列表恢复干净，只剩 `v0.0.1` / `v0.0.2` / `v0.0.3` / `v0.0.4`。

## D. 本轮沉淀的方法论

1. **「连续同样错误」要换思路，不要换假设的强度**：五轮 403 里我换了四个假设
   （权限项 / 参数 / 封装 / installation 权限），全部靠**实测**排除。
   真正的转折点是**加一个诊断步骤把证据打出来**，而不是继续猜。
2. **GitHub Actions 的 `.permissions` 字段会骗人**：`GET /repos/{}/{}` 返回的
   `permissions` 反映 **GitHub App installation** 的权限，**不是** GITHUB_TOKEN
   在当前 job 的可用权限。同一个 token 下它可以全 false，却仍能创建 Release。
3. **`target_commitish` 在 tag 已存在时不要传**：文档说它会被忽略，但实测
   传了会触发一次 commit 可见性校验并 403。
4. **`gh run rerun` 修不了流水线自身的缺陷**：它复用触发时的 workflow 定义快照。
5. **squash 合并会让「同一内容、不同 commit」的分支产生 add/add 冲突**：
   解法是从最新 `origin/master` 拉新分支再 cherry-pick，并先验证
   `git diff <旧分支> HEAD -- <file>` 为空。

## E. 当前状态

| 项 | 状态 |
|---|---|
| **Tag `v0.0.4`** | ✅ 已创建并推送，annotated tag `aed641d` → `c0e7396`（**未移动**） |
| **Release `v0.0.4`** | ✅ **Draft 已创建**（id `434929894`），两个资产齐全，SHA256 校验通过 |
| GHCR 镜像 | ✅ `ghcr.io/alicia1030su/v2ex-clone:v0.0.4` 已推送并可拉取 |
| master | `f5e1dd4`（含全部发布修复） |
| 发布内容与 Tag 零差异 | ✅ `deploy/` `src/` `package.json` `drizzle/` 全部无差异 |
| 发布流水线 | ✅ **11/11 job 全绿**（run `41991745413`） |
| 单元测试 / E2E | 194/194（16 文件）/ 154 passed / 0 failed |
| R-01 | ⬜ 仍为 DEFERRED |

## F. 下一步动作

| # | 动作 | 说明 |
|---|---|---|
| 1 | ✅ 核验 Draft Release 资产 | 已完成（见 §C） |
| 2 | ✅ 回填 run id 与资产清单到交付文档 | 本轮提交 |
| 3 | ⬜ **正式发布需主人单独授权** | R-01 未裁决 ⇒ 只能停在 Draft。授权后以 `workflow_dispatch` 传 `publish=true` 触发，或手动在 GitHub 上发布 |
| 4 | ⬜ 转正式发布后的补验 | 流水线的 `verify-release` 会**自动补做**匿名下载校验（draft 状态下资产匿名不可下载，已按 GitHub 正常行为跳过） |

> ⚠️ **R-01 仍为 DEFERRED** —— 禁止改写远端历史 / 删 Tag / 改 Release / 改仓库可见性。
> 本轮**未移动、未删除**任何版本 Tag 或既有 Release；诊断残留已手工清理干净。
