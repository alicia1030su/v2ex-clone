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
| PostgreSQL | **17.5**，二进制 `C:/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin`，端口 **55433**，角色 `v2ex` |
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

## 4. PostgreSQL 测试问题（A / B / C）根因与状态

### 问题 A：环境变量与子进程连接目标错误 —— ✅ 根因已定位

`tests/setup.ts` 的**注释声称**「加载 .env.test（隔离测试数据库）」，但**实际代码只加载 `.env.local` 和 `.env`**：

```ts
if (process.env.ENV_FILE) { config({ path: process.env.ENV_FILE, quiet: true, override: true }); }
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
```

- `.env.local` → `DATABASE_URL` 指向 **5432**（用户日常开发库，**禁止修改该文件**）
- `.env.test` → 指向 **127.0.0.1:55433/v2ex_e2e**（正确目标），但被 `.gitignore` 忽略、未入仓
- `drizzle.config.ts` 有完全相同的加载逻辑
- 子进程（`runDrizzleKit` / `runTsx`）显式传 `ENV_FILE: ''` 与测试库 `DATABASE_URL`，父/子最终目标需验证一致
- ⚠️ 上一轮归因勘误：曾误判为「`.env.local` → 5432 污染」或「并行 PG 负载」，用 `ENV_FILE`（override:true）指向 55433 后**仍然超时**，两假设均被实测推翻

### 问题 B：CREATE DATABASE 38.6s —— ✅ 根因已定案（第三次归因勘误）

- 上一轮观测：`DROP DATABASE` 1.2s / **`CREATE DATABASE` 38.6s** / `drizzle-kit migrate` 5.4s
- **本轮实测推翻旧假设**：在同一 1.4GB / 24 库实例上连测 3 次 `DROP+CREATE` = **2277 / 1978 / 2243 ms**，单独 `CREATE` = **2083 ms**；同期 checkpoint `total=0.053s / 0.158s`
- ✅ **正确根因**：38.6s 是 **PG 处于 crash recovery / I/O 积压态**时的观测值，**不是稳态**。本轮首次启动 PG 时它在上次被强杀后做 redo 恢复，日志显示逐目录 fsync 耗时 70 秒（`syncing data directory (fsync), elapsed time: 70.01 s`）。**数据目录大小不是瓶颈**（建库只复制 `template1`，实测 7689 kB / public schema 0 张表）
- 纠错留痕：① 第一轮误判「`.env.local` → 5432 污染」→ 用 `ENV_FILE`（override:true）指向 55433 后仍超时，**被实测推翻**；② 第二轮误判「并行 PG 负载」→ 单独跑 seed-idempotency 同样超时，**被实测推翻**；③ 第三轮「数据目录 1.4GB 导致」→ 本轮实测 2 秒，**被实测推翻**
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

## 5. 功能与 UI 缺口现状（本轮已核实）

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

> ✅ **185 vs 190 争议已解决：权威基线是 190 条。** 185 是 v0.0.3 的历史数字，v0.0.4 新增了 `tests/floor-continuity.spec.ts`（5 条）后为 190。

| 项 | 上一轮记录 | **本轮实测（2026-11-04）** |
|---|---|---|
| 单元测试 | 185（旧）/ 190（报告另处） | ✅ **190 条 / 15 文件，全部通过，0 failed / 0 skipped**；连续 **4 轮**全绿（~170–210s/轮）。证据：`docs/evidence/baseline/vitest-v0.0.4-round3.txt` |
| E2E | 153 条 / 11 文件，153 passed（10.0m） | ✅ **153 条 / 11 文件，153 passed / 0 failed / 0 skipped（4.5m）**，连续 **2 轮**全绿。`--list` 权威清单：`docs/evidence/baseline/playwright-list-v0.0.4.txt` |
| 视觉对照 | 4 视口 × 17 页面 = 68 条（40 有对照 / 28 无对照）；严格口径桌面 Δx=0 **52/52** | ⏸ 保留既有证据 |
| 负载测试 | 已执行：10000 用户 / 1000 节点 / 100000 主题 / 1000000 回复，24785 请求 / 13 场景 | ⏸ 保留既有证据 |
| 迁移幂等 + 备份恢复 | 已验证 | 🔄 QA 复核中 |
| 功能审计 | 53 项 | ⏸ 保留 |

### ⚠️ E2E 用例 149 / 153 的特殊含义

`e2e/v004-four-roles-ui.spec.ts` 有 **2 条用例把「UI 无入口」当作断言**：
- `:98` 「UI 缺口：节点申请提交在前端无入口（仅 API /api/node-requests）」
- `:292` 「UI 缺口实证：管理员在 /、/admin、/settings 的 DOM 中均无 /admin 入口」

**UI 工程师补齐入口后，这两条会失败 —— 这是预期结果，不是回归。** 届时必须改写为「**已具备入口**」的正向断言，而不是删掉或加 `skip` 掩盖。

---

## 7. 团队与子智能体状态

团队：`software-v004-finalize`（主理人 = team-lead）

| 成员 | Agent ID | 任务 | 状态 |
|---|---|---|---|
| 架构师 | `software-architect` | PG 测试环境隔离方案设计 → `docs/TEST_ENV_ISOLATION_v0.0.4.md` | ✅ **已交付**（1679 行，含三次归因勘误留痕、三道护栏、独立实例命令） |
| 部署工程师 | `software-engineer-deploy` | `deploy/update.sh` + `preflight.sh` + 自检脚本 | ✅ **已交付**（含 stub-docker 自检真实输出） |
| UI 工程师 | `software-engineer-ui` | 补齐 R-21 / R-24 等 8 项 UI 缺口 | ⚠️ **网络 502 中断，零产出**，已重启为 `software-engineer-ui2` |
| UI 工程师（重启） | `software-engineer-ui2` | 同上 | 🟡 运行中 |
| QA/CI | `software-qa-ci` | 远端状态核查 + `docker-verify.yml` + 本地基线复核 | 🟡 运行中 |
| 测试环境工程师 | `software-engineer-testenv` | 按架构师设计实施 PG 测试环境修复 + 三道护栏 | 🟡 运行中 |

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

| ID | 状态 | 摘要 |
|---|---|---|
| R-01 | 🔴 未解决 | 原站 HTML/CSS/JS 经 Git 历史持续暴露。**仅允许只读审计 + 隔离副本演练 + 准备 Support 资料**；未经主人再次明确授权，禁止 force push / 改写远端历史 / 删 Tag / 删 Release / 删仓库 / 改可见性 |
| R-16 | 🔴 DEFERRED | Docker 容器与安装包未实跑 → 本轮交 QA/CI 落地 `docker-verify.yml`，待推送后 CI 实跑取证 |
| R-17 | 🔴 DEFERRED | Redis 故障恢复 / 缓存失效 / 内存观测未验证 → 同上 |
| R-18 | 🟡 处理中 | `deploy/update.sh` 不更新 `.env` 的 `V2EX_IMAGE` → 部署工程师修复中 |
| R-19 | 🟡 部分已修 | `release.yml` tag 白名单不含 v0.0.4（**刻意保留人工摩擦，勿自动改**）；Release Notes 已动态化 |
| R-20 | 🟢 已裁决 | 开发态版本载体保持 0.0.3，`[Unreleased]` 显式记录；最终 SHA 固定后一次性同步 |
| R-21 | 🔴 OPEN | 四身份 UI 缺口 → UI 工程师处理中 |
| R-22 | 🟡 已定位 | 单测建库超时 → 架构师出隔离方案 |
| R-23 | 🟢 已修复 | 关注用例静默跳过已修并实跑通过 |
| R-24 | 🔴 OPEN | 关注无 UI 入口 → UI 工程师处理中 |

---

## 9. GitHub PR 与 CI 状态

- 远端**没有** `feat/v0.0.4-high-fidelity` 分支 —— 8 个提交**全部只在本地**
- 现有 PR：待 QA/CI 核查后确认
- CI：`ci.yml` 触发条件为 push 到 `master` / `fix/**` / `feat/**` 与 PR 到 `master`，另有 `workflow_dispatch`
- ⚠️ **CI 无法覆盖本轮改动，直到主理人推送分支**
- Release：`v0.0.3` Draft 存在（**不得破坏**）；`v0.0.1` / `v0.0.2` 已发布（**不得破坏**）

---

## 10. 下一步具体动作

1. ⏳ 等待架构师产出 `docs/TEST_ENV_ISOLATION_v0.0.4.md` → 主理人按其方案实施 PG 隔离
2. ⏳ 等待部署工程师产出 `deploy/update.sh` 修复 + 自检脚本真实输出
3. ⏳ 等待 UI 工程师补齐 8 项 UI 缺口 + 真实证据
4. ⏳ 等待 QA/CI 产出远端核查 + `docker-verify.yml` + 本地基线
5. ⬜ 实施 PG 隔离方案 → 复跑受阻单测 → 全量 Vitest
6. ⬜ 全量 Playwright E2E + 四身份 UI 验收
7. ⬜ 统一所有交付文档口径（185/190、153、视觉分母、迁移结果）
8. ⬜ 同步版本号 → 最终提交 → 测试该提交 → 定 SHA → 建 Tag
9. ⬜ 创建 v0.0.4 **Draft** Release（有阻断风险且未授权则只停 Draft）

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
