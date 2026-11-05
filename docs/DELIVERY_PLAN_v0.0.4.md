# V2EX Clone v0.0.4 项目交付方案与验收报告

> 编制：全栈架构交付专家团（主理人汇编）
> 日期：2026-11-04
> 分支：`feat/v0.0.4-high-fidelity` · 基线提交 `89d6b4e`（本轮改动待提交）
> 性质：**开发态交付方案 + 验收报告**，不是发布公告
>
> ⚠️ **本轮未执行任何远端写操作**：未创建/删除/移动 Tag、未创建或修改 Release、
> 未 push、未 force push、未改仓库可见性。远端 Tag 仍为 `v0.0.1` / `v0.0.2` / `v0.0.3`（只读核实）。

---

## 0. 一句话项目定义与成功标准

**项目定义**：对 V2EX 做技术研究与高保真界面还原的社区 Web 应用，在保持功能真实可用的前提下，
把 v0.0.3 遗留的「假按钮 / 必然 500 / 数据不一致 / 大规模性能不可用」问题清零，
并建立可复核的验收证据链。

**成功标准**（可度量）：

| # | 标准 | 实测 | 状态 |
|---|---|---|---|
| S1 | 桌面/平板视口水平布局与原站逐像素对齐 | 严格口径 Δx=0 **52/52 (100%)**、Δw=0 48/52 (92.3%)，3 个视口 | ✅ `geometry-summary.json` |
| S2 | 全部公开 GET 端点不返回 5xx | 29 个 GET 端点自动发现冒烟；压测 24785 请求 **0 个 5xx** | ✅ |
| S3 | 真实社区规模下核心端点可用 | 10 万主题 / 100 万回复：搜索 p50 41ms、节点列表 p50 68ms、排行榜从 242s 降到 p95 1530ms | ✅ `bench-result.json` |
| S4 | 数据一致性不变式成立 | 重复楼层 0 / 孤儿 0 / 负余额 0 / 账本不自洽 0 / `replies_count` 不符 0 / `votes` 不符 0 | ✅ |
| S5 | 升级不丢数据、迁移幂等、备份可恢复 | 升级前后数据指纹逐字节一致；迁移连跑 3 次幂等；备份恢复后指纹一致 | ✅ `UPGRADE_RECOVERY_v0.0.4.md` |
| S6 | 不提前发布、不动 v0.0.3 产物 | 远端 Tag 只读核实仍为 3 个；Draft 门禁 `publish=false` | ✅ |

**验收判定**：**可以有条件进入 Draft Release 阶段；不得公开发布正式 Release**。
依据与前置条件见 §8、§9。

---

## 1. 需求范围

### 1.1 本轮已完成（v0.0.4 范围）

| 阶段 | 内容 | 证据 |
|---|---|---|
| 一 · 功能真实性审计 | 53 项独立审计，38 VERIFIED / 14 PARTIAL / 1 MISSING | `FEATURE_AUDIT_v0.0.4.md` |
| 二 · 用户验收 | 四身份真实浏览器点击流补齐（8 条），如实标注 UI 无入口的缺口 | `e2e/v004-four-roles-ui.spec.ts` |
| 三 · 视觉还原 | 4 视口 × 17 页面 = 68 条，40 条完成对比、28 条如实标注无原站对照；三套几何口径可复算 | `VISUAL_DIFF_SUMMARY_v0.0.4.md` |
| 四 · E2E | 新增 4 文件 + 四身份 UI；`playwright test --list` 实测 **154 条 / 11 文件**（`Total: 154 tests in 11 files`）；✅ **当前权威实测 = 154 passed / 0 failed / 0 skipped（11 文件，3.9m）** —— V4-20 修复后本地实跑全绿；**本地历史轮次口径**：153 passed / 0 failed / 0 skipped，连续 2 轮全绿（基于 153 条口径，早于 `ed385cf`）；**修复前的历史快照**：CI run `41873009808` = `153 passed \| 1 failed \| 154 total`（唯一失败为节点申请 UI 提交链断裂 V4-20，**已由 `bddb3d0` 修复并本地实测验证**；**CI 亦已复验通过**（run `41949555282`，SHA `bddb3d0`）） | `test-list-v0.0.4.txt`、`e2e-full-run-v0.0.4.md` |
| 五 · 负载测试 | 351 万行压测数据集、13 场景 / 24785 请求；发现并修复 3 个真实缺陷 + 3 项性能优化 | `METRICS_DEFINITION_v0.0.4.md` |
| 六 · 升级/恢复 | 全新安装、原地升级、迁移幂等、备份恢复四项**实跑通过** | `UPGRADE_RECOVERY_v0.0.4.md` |
| 七 · 发布工程 | GHCR Bearer 协议复核、Release Notes 动态化、口径纠错 | `RISK_REGISTER.md` / `release.yml` |
| 八 · 发布流程 | R1~R6 红线 + 12 步唯一合法路径 + 双模式只读门禁 | `RELEASE_PROCESS_v0.0.4.md` |
| 九 · 历史风险 | 隔离副本演练成功（2→0 提交、298 文件差异 0 行、tsc 零错误），**远端仍 DEFERRED** | `HISTORY_CLEANUP_DRILL_v0.0.4.md` |
| 十 · 协作 | 部署运维 + 测试验收两成员按阶段交付专业产出，主理人裁决冲突 | 本报告 §10 |
| 十一 · 交付 | 本报告 + 验收清单 + 版本/缺陷/风险登记 | `ACCEPTANCE_CHECKLIST_v0.0.4.md` |

### 1.2 明确不包含（本轮未做，如实标注）

- Docker 容器实跑的**完整 9 项** —— ✅ **已闭环**：run `41871503684`（SHA `2773cd1`）九项 completed/success、汇总表全 PASS（修复提交 `827eef7` + `2773cd1`）
- 真实 SMTP 邮件投递 —— 未配置
- 多浏览器交互 E2E（Firefox / Safari）—— 本机仅 Chromium
- 原站需登录的 7 个页面 × 4 视口 = 28 条视觉对照 —— 无权访问他人账号，不拿游客态冒充
- 远端 Git 历史改写 —— 需主人单独授权，状态 DEFERRED
- ✅ **节点申请 UI 提交链断裂（R-27 / V4-20）** —— **已由 `bddb3d0` 修复并本地实测验证**，本轮唯一红灯已解除（单元 194/194（16 文件）、E2E 154/154（11 文件，3.9m）全绿，React #418 归零，提交恢复 `POST /api/node-requests`；修复前的历史快照 CI run `41873009808` = `153 passed | 1 failed | 154 total`；**CI 亦已复验通过**（run `41949555282`，SHA `bddb3d0`））

### 1.3 后续迭代（正式 Release 前必须）

1. ~~带 Docker / Redis 的环境完成部署与故障恢复实跑（R-16 / R-17）~~ —— ✅ **已闭环**：
   run `41871503684`（SHA `2773cd1`）九项 completed/success、汇总表全 PASS（修复提交 `827eef7` + `2773cd1`）
2. ~~`update.sh` 自动同步镜像 tag 并实跑验证（R-18）~~ —— ✅ **收尾轮已修并验证**（`b0d68c2`；自检 87 项断言全 PASS）；
   ⚠️ 残余：**真实容器级升级**仍需带 Docker 的环境复跑
3. ~~管理员 `/admin` 入口与版主管理操作 UI 的产品决策（R-21）~~ —— ✅ **已由 `ed385cf` 修复**，待主理人终验确认
4. 自动化视觉回归纳入 CI（FEATURE_AUDIT #53 仍 PARTIAL）
5. ~~**R-24** 关注功能 UI 入口~~ —— ✅ **已由 `ed385cf` 修复**（真实可点击 + 刷新后持久化），待主理人终验确认
6. **R-25** 运行时上传数据的历史残留清理 —— 需授权改写 Git 历史
7. ✅ **R-27 / V4-20** 节点申请 UI 提交链断裂 —— **已由 `bddb3d0` 修复并本地实测验证**，本轮唯一红灯**已解除**；**阻断正式 Release 的表述同步解除**，剩余阻断项见 `RELEASE_GATE.md`（⚠️ **CI 亦已复验通过**（run `41949555282`，SHA `bddb3d0`））

---

## 2. 系统架构与技术选型

### 2.1 架构（文字版）

```
浏览器 (Chromium 1280×900 / 4 视口截图对照)
   │  HTTP + Cookie(SameSite=Lax) + CSRF 双提交 token
   ▼
Next.js 15 App Router
   ├── middleware.ts        客户端 IP 信任模型 / CSRF cookie 下发 / 限流前置
   ├── src/app/**          21 个页面（RSC + 少量客户端组件）
   ├── src/app/api/**      55 个 route.ts（29 个 GET + 26 个写端点）
   ├── src/lib/**          content-service / credit-service / node-service / rate-limit / csrf
   └── src/server/**       floor.ts（楼层原子分配）/ queries.ts（列表查询）
   │  drizzle-orm (postgres-js, 连接池)
   ▼
PostgreSQL 15+      26 表 / 76 索引 / 3 条迁移
   ├── 汇总字段：topics.votes / topics.replies_count / topics.last_reply_at / users.balance
   ├── 账本：credit_ledger（只 INSERT + balance_before/after 快照 + 幂等键）
   ├── 楼层：floor_counters（原子 UPSERT，唯一权威）+ 唯一索引兜底
   └── pg_trgm GIN 索引：topics.title / topics.content（ILIKE 前导通配符）
Redis（可选）          会话缓存 / 限流 / 计数；本轮未配置，降级为 DB 路径
```

### 2.2 技术选型表（含被否决方案）

| 层 | 采用 | 被否决的备选 | 否决理由 |
|---|---|---|---|
| 框架 | Next.js 15 App Router (RSC) | 纯 SPA（Vite + React） | 需要 SSR 首屏与服务端鉴权；原站是服务端渲染，SPA 会让视觉与 SEO 都不对齐 |
| ORM | drizzle-orm + 原生 SQL 片段 | Prisma | 需要精细控制 SQL（汇总字段、CTE 聚合、部分索引）；Prisma 对这些表达力不足，且迁移产物不透明 |
| 搜索 | `pg_trgm` GIN 三值索引 | ① B-tree ② 外部 ES | B-tree 无法处理 `ILIKE '%x%'` 前导通配符（实测全表扫描 803ms）；ES 引入额外组件与运维成本，对 10 万主题量级过重。**实测 trigram 后 0.064ms** |
| 排行榜统计 | 三个独立 CTE 聚合 + LEFT JOIN | 相关子查询（每作者一次） | 原实现 `EXPLAIN` 实测 241.98 秒、loops=9997，并发下完全不可用；改写后 0.74s / 加索引 0.46s |
| 楼层分配 | `floor_counters` 原子 UPSERT（唯一权威） | 每次 `max(floor)+1` | 并发下会撞唯一索引且需重试；计数表方案一次分配、天然幂等 |
| 压测器 | 自研 `bench.mjs`（P50/P95/P99） | k6 / hey / ab | 本机三者均未安装；自研能精确报告分位延迟并复用 Playwright 的 baseURL 约定 |
| 测试并行 | `fileParallelism: false` + hookTimeout 120s | 默认并行 | 15 个测试文件各自 DROP/CREATE DATABASE + migrate，并行会争抢 PG；本机 `CREATE DATABASE` 单次 38.6s |
| 视觉判定 | 几何量测（x/w）为主证据 | 像素差百分比 | 像素差天然含内容差异（原站真实数据 vs 本地 seed），会得出「相似度」这类无依据结论 |

---

## 3. 数据库设计摘要

| 项 | 值 |
|---|---|
| 表 / 索引 / 迁移 | 26 表 / 76 索引 / 3 条迁移（0000 初始 18 表 + 0001 + 0002 性能索引） |
| 核心不变式 | `users.balance == sum(credit_ledger.amount)`；`floor_counters.last_floor == max(replies.floor)`；`topics.replies_count` 只计未删除回复；账本 `balance_before + amount = balance_after` 且链式首尾相接 |
| v0.0.4 新增迁移 | `0002_v004_perf_indexes.sql`：5 个 btree（含 2 个 `WHERE deleted_at IS NULL` 部分索引）+ 2 个条件性 pg_trgm GIN；`CREATE EXTENSION` 用 DO 块捕获权限不足，**跳过索引而不让迁移失败**；全部 `IF NOT EXISTS` |
| 幂等性 | 连跑 3 次 `drizzle-kit migrate` 全部 exit=0，26/76/3 恒定、重名索引 0 |
| 升级策略 | 0002 是**纯增量索引、无破坏性 DDL/DML**，可先迁移后发布代码；升级前后数据指纹 `a7335937…` 逐字节一致 |

---

## 4. 前后端实现要点

**前端**：21 个页面以 RSC 为主；客户端组件（表单、编辑模态框、签到）必须等 hydration 完成后才能交互 —— 本轮 E2E 多次因「SSR 无输入框即 fill」超时，已在 helpers 统一 `waitForLoadState('networkidle')`。编辑表单改用 `fixed` 模态框，避免被正文浮动元素拦截指针事件。

**后端**：写端点统一 `verifyCsrf()`（双提交 + `timingSafeEqual`）；限流按「账号维度 + IP 维度」双桶；`TRUST_PROXY_HEADERS=0` 时 IP 维度退化为全局单桶（取舍已登记 R-08）。积分变动一律走 `grantCredits()` 写账本，注册赠送不再直接写 `balance`。

**AI 专项**：**不适用**。本项目非 AI 应用，无智能体编排 / Prompt / RAG / 工具调用 / 评测需求，故本轮未调度智能体应用工程师。

---

## 5. 里程碑与排期

> **人力假设**：1 名主理人 + 2 名并行成员（部署运维、测试验收），另有 1 名数据生成成员参与第五阶段；
> 全部为 AI 智能体工时，按「实际执行轮次」计，不折算人天。下表是**已完成的事实记录**，不是未来计划。

| 里程碑 | 依赖 | 关键路径 | 状态 |
|---|---|---|---|
| M1 功能审计（53 项） | — | ✅ | 完成 |
| M2 视觉工具扩展 + 4 视口采集 | M1 | ✅ | 完成（含路径映射纠错） |
| M3 真实缺陷修复 + 77 条 E2E | M1 | ✅ **关键路径** | 完成，**154 条**（v0.0.4 权威口径，`--list` 实测；「144」「153」为更早时点，见 §7 口径说明） |
| M4 压测数据集（351 万行） | — | ✅ 并行 | 完成，3m4s |
| M5 真实压测 → 3 缺陷 + 3 优化 | M3, M4 | ✅ **关键路径** | 完成 |
| M6 升级/恢复 + 发布流程 | M5 | ✅ 并行 | 完成（数据库四项实跑，容器静态核查） |
| M7 证据核查 → D-01~D-16 纠错 | M2~M6 | ✅ | 完成 |
| M8 四身份 UI + 楼层连续回归 | M3 | ✅ 并行 | 完成（8/8 + 5/5） |
| M9 最终汇编与提交 | M7, M8 | ✅ | 完成 |
| M10 最终 SHA 固定 → Tag → Draft | M9 + 主人授权 | ⛔ | **未开始，禁止提前** |

---

## 6. 部署与上线方案

完整流程见 `docs/RELEASE_PROCESS_v0.0.4.md`。核心红线：

- **R1** v0.0.4 期间禁止提前创建最终 Tag；**R2** 同一版本号不得反复删建/移动 Tag
- **R3** 不动 v0.0.3（及更早）的 Tag / Release；**R4** 未经主人单独授权不得公开发布有阻断风险的 Release
- **R5** 发布流程缺陷先在独立测试版本与非正式流水线验证；**R6** 固定最终 SHA 后才建 Tag
- 唯一合法顺序：开发 → 审查 → 自动化测试 → 独立构建 → 部署验证 → 安全扫描 → 安装包验证 → 合并 → **版本同步提交（即最终 SHA，此后不得再改代码）** → Tag → Draft → 远端核验
- `scripts/release/preflight.sh` 双模式只读门禁：`--phase=dev`（默认，版本 0.0.3 为预期）/ `--phase=release`（发布时刻，必须 0.0.4）

**本轮 preflight 真实输出**（dev 模式）：`PASS=22 / WARN=1 / FAIL=0 / INFO=14 / BLOCK=1`；
release 模式：`PASS=22 / FAIL=14 / BLOCK=1`。**BLOCK 恒为 R-01 未授权**，两种模式 exit 均为 1 且都正确。

---

## 7. 测试与验收清单

| 层级 | 口径 | 证据 |
|---|---|---|
| 单元 / 集成 | **194 条 / 16 个文件**（194 passed / 0 failed / 0 skipped，**连续 4 轮全绿**）。**本轮隔离实例实测 81.68s**；历史轮次 170~210 秒（共享实例 55433 口径）。⚠️ 静态 grep 得出 180（嵌套 for 循环生成用例），**口径必须取运行时 `numTotalTests**`。⚠️ **修复前基线为 190 条 / 15 文件**（V4-20 修复新增 `tests/form-name-shadowing.spec.ts` 的 4 条防回归断言 ⇒ 190 → 194） | `docs/evidence/ci/test-baseline-v0.0.4.md` |
| 单元 / 集成（**CI**） | ✅ **CI 已转绿** —— run `41860242099` 与 `41873009808` 的「类型检查 / 单元测试」job 均 success，vitest 15 文件全过（`190 passed / 0 skipped`）。**修复前的历史观测**（run `41837212170`，HEAD `930f29e`）：`Test Files 1 failed \| 14 passed (15)` / `Tests 185 passed \| 5 skipped (190)` —— **分母 190 正确**；**已由 `8ce5ce9` 修复并经 CI 复验**，`e2e` job **已真实跑过** | `docs/evidence/ci/ci-status-v0.0.4.md` §0 |
| 真实浏览器 E2E | **154 条 / 11 个文件**（`--list` 实测 `Total: 154 tests in 11 files`）。✅ **当前权威实测 = 154 passed / 0 failed / 0 skipped（11 文件，3.9m）** —— V4-20 修复后本地实跑全绿；**本地历史轮次口径**：153 passed / 0 failed / 0 skipped，连续 2 轮全绿（4.5m/轮，基于 153 条口径、早于 `ed385cf`）；`--list` 分解 = 原有 67 + v004 四文件 79 + 四身份 UI 8。**修复前的历史快照**：CI run `41873009808` = `153 passed \| 1 failed \| 154 total`（唯一失败为 `e2e/v004-four-roles-ui.spec.ts:122` 节点申请 UI 提交链断裂，V4-20 / R-27，**已由 `bddb3d0` 修复并本地实测验证**；**CI 亦已复验通过**（run `41949555282`，SHA `bddb3d0`）） | `e2e-full-run-v0.0.4.md` + `test-list-v0.0.4.txt` + `TEST_COUNT_DEFINITION_v0.0.4.md` |
| 升级脚本自检 | **87 项断言全 PASS / 0 FAIL**（沙箱模拟，不调用真实 Docker；本轮实测，历史为 62 项） | `bash scripts/release/verify-update-script.sh` |
| 视觉 | 4 视口 × 17 页面 = 68 条；**40 对比 / 28 无对照**；严格口径 Δx=0 52/52（⚠️ 只覆盖几何位置，六类区分未全部闭环） | `geometry-summary.json` |
| 性能 | 13 场景 / 24785 请求 / 并发 10 / **0 个 5xx** | `bench-result.json` + `METRICS_DEFINITION_v0.0.4.md` |
| 升级/恢复 | 4 项实跑通过 + 容器项静态核查 | `UPGRADE_RECOVERY_v0.0.4.md` |
| Go / No-Go | 完整判定表、缺陷分级、遗留阻断项 | `ACCEPTANCE_CHECKLIST_v0.0.4.md` |

**本轮全量实跑结果（收尾轮定案）**：
- E2E（最终权威分母）：**154 条 / 11 文件**（`npx playwright test --list` 实测 `Total: 154 tests in 11 files`）。
  **本地历史轮次口径**：153 passed / 0 failed / 0 skipped（4.5m/轮，exit=0），**连续 2 轮全绿** ——
  证据 `docs/evidence/e2e/e2e-full-run-v0.0.4.md`。该口径基于 153 条、早于 `ed385cf`（+1 关注 UI 用例）。
  修复前一轮为 152 passed / 1 skipped（关注用例静默跳过 = R-23，已修并补齐三条断言）；
  两轮结果均如实保留，不回写历史。
  ✅ **当前权威实测 = 154 passed / 0 failed / 0 skipped（11 文件，3.9m）**（V4-20 修复后本地实跑）；⚠️ **修复前的历史快照**：CI run `41873009808`（SHA `2773cd1`）= `153 passed | 1 failed | 154 total` ——
  唯一失败用例 `e2e/v004-four-roles-ui.spec.ts:122`「节点申请：UI 入口存在 + 真实点击提交成功 + 申请真实入库」，
  **真实产品缺陷**（生产构建下节点申请 UI 提交链断裂），登记 V4-20 / R-27 —— **✅ 已由 `bddb3d0` 修复并本地实测验证**（React #418 归零、提交恢复 `POST /api/node-requests`、URL 停在 `/nodes/request`、成功 toast 出现）；****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）**。
  ⚠️ `v004-endpoint-smoke.spec.ts` 条数随 GET 路由数浮动 ⇒ **正式发布前须重新 `--list` 固定口径**。
- 单元（最终权威）：**194 passed / 0 failed / 0 skipped（16 个文件）**，**连续 4 轮全绿**（修复前基线 190 条 / 15 文件）——
  **本轮隔离实例实测 81.68s**；历史轮次 170~210 秒（共享实例 55433 口径）。
  证据 `docs/evidence/ci/test-baseline-v0.0.4.md`。
  ⚠️ **「185」有两个不同来源**：**v0.0.3 历史总数**（master @ `37710fb4`，14 文件）与
  **修复前的历史观测**（run `41837212170`，HEAD `930f29e`，`185 passed | 5 skipped (190)`，⚠️ **分母仍是 190**）。
  **该红灯已由 `8ce5ce9` 修复并经 CI 复验**（run `41860242099` / `41873009808` 单元 job ✅）。
  **无论哪种，v0.0.4 的用例总数在 V4-20 修复后为 194（修复前是 190），权威值为 194。**
  `numPendingTests: 0` 证明**没有任何用例被静默跳过**（比「全绿」更强的结论）。
- 升级脚本自检：**87 项断言全 PASS / 0 FAIL**（本轮实测；历史为 62 项）。
- R-21（管理员无 `/admin` 入口）与 R-24（关注无 UI 入口）**已由 `ed385cf` 修复**（管理员入口 / 关注 /
  节点申请审批 / 通知已读全部补齐），**待主理人终验确认**。
- ✅ **本轮唯一红灯 = R-27 / V4-20**（节点申请 UI 提交链断裂）**已由 `bddb3d0` 修复并本地实测验证**，**阻断正式 Release 的表述同步解除**；⚠️ **CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅），剩余阻断项见 `RELEASE_GATE.md`。

---

## 8. 风险清单与应对

| 风险 | 概率 | 影响 | 应对 | 状态 |
|---|---|---|---|---|
| R-01 原站版权素材经 Git 历史持续暴露 | 高 | 高 | 隔离演练已验证清理可行且不损坏项目；远端改写需主人单独授权 | **DEFERRED（维持）** —— 收尾轮只读复核：风险未消除；演练改动了 3 个已发布 Tag 的 SHA，与「不得移动已发布 Tag」冲突，**待主人裁决** |
| R-16 Docker 容器与安装包未实跑 | 高 | 大 | `docker-verify` **九项全部 completed/success**（run `41871503684`，SHA `2773cd1`），汇总表全 PASS；修复提交 `827eef7` + `2773cd1` | 🟢 **已闭环** |
| R-17 Redis 故障恢复未验证 | 中 | 中 | 同 run 九项全绿，含 `[R-17a/b/c]` 三个专项（Redis / PG 中断恢复、缓存失效与内存观测） | 🟢 **已闭环** |
| R-18 升级路径断点（`update.sh` 不更新镜像 tag） | 高 | 大 | `b0d68c2` 重写 `update.sh`（自动同步 tag + 失败回滚）；`verify-update-script.sh` **87 项断言全 PASS**（本轮实测） | 🟢 **已修并验证** —— 真实容器级升级待复跑 |
| R-21 管理员 `/admin` 无导航入口、版主管理 UI 缺失 | 高 | 中 | `ed385cf` 补齐管理员入口 / 关注 / 节点申请审批 / 通知已读；导航收敛到 `src/lib/nav-links.ts`；服务端鉴权仍是唯一权威 | 🟢 **已修复（`ed385cf`）** —— 待主理人终验确认 |
| R-22 单测 `beforeAll` 建库超时 | 高 | 中 | 三次归因勘误后定案（crash recovery / I/O 积压态）；稳态 `CREATE DATABASE` **2.0~2.3s**；`hookTimeout` 提到 120s | 🟢 **已定案并复验** —— 连续 4 轮全绿 |
| 以不可复核的几何数字作放行依据 | — | — | D-01 已闭环：脚本入仓 + 机器证据 + 三套口径 | 已闭环 |
| 版本载体与交付物不符 | — | — | 显式裁决 + `[Unreleased]` 段落 + 双模式门禁 | 已闭环 |
| R-23 关注链路 E2E 被条件跳过 | 高 | 中 | **已修复**：确定性目标 id + 三条断言补齐，单条实跑 1 passed | 已闭环 |
| R-24 关注功能无 UI 入口（全仓无关注按钮组件） | 高 | 中 | `ed385cf` 补齐真实可点击的关注按钮；刷新后状态持久化（主理人真实浏览器复核 16 项断言全 PASS） | 🟢 **已修复（`ed385cf`）** —— 待主理人终验确认 |
| R-25 运行时上传数据被误提交入仓（18 个占位 PNG） | 中 | 小～中 | `49d66d3`：`.gitignore` 加 `public/uploads/` + `git rm --cached`（**不改写历史、不删磁盘文件**）；`git ls-files` → 0 条 | 🟡 **已缓解 —— 历史仍可达，与 R-01 同源** —— 18 个占位 PNG 仍在 Git 历史；内容无害（无用户数据、无凭据） |
| R-26 CI 上单元测试红灯（`floor-continuity` 崩溃 ⇒ `e2e` job 连带跳过） | 高 | 大 | `8ce5ce9`（护栏 3 修复 `634a202`）；run `41860242099` / `41873009808` 单元 job ✅（190 passed / 0 skipped），`e2e` job 已真实跑过 | 🟢 **已修复并经 CI 复验** |
| R-27 节点申请 UI 提交链断裂 | 高 | 严重（**曾阻断正式 Release —— ✅ 该阻断已解除**） | HTML 规范 `[OverrideBuiltins]` 使表单内**命名控件遮蔽 `form.nodeName`** → react-dom 水合代码 `canHydrateInstance` 中 `instance.nodeName.toLowerCase()` 抛 `TypeError` → React #418 水合失败 → 表单 `onSubmit` 从未执行 → 原生 GET 提交；**API 路径通过、纯 UI 路径失败** | 🟢 **已修复并本地实测验证（`bddb3d0`）** —— 表单命名属性改名 + 新增 `tests/form-name-shadowing.spec.ts`（4 条防回归断言）。实测：单元 **194/194（16 文件）**、E2E **154/154（11 文件，3.9m）** 全绿，React #418 归零，`POST /api/node-requests` 正常。修复前的历史快照：CI run `41873009808` = `153 passed \| 1 failed \| 154 total`。****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）** |

完整 25 条风险见 `RISK_REGISTER.md`。

---

## 9. 决策与权衡（明确写出被否决方案）

| # | 冲突点 | 成员结论 | **主理人裁决** | 理由 |
|---|---|---|---|---|
| 1 | 版本载体保持 `0.0.3` 是否为阻断 | devops：🔴 阻断 N-01；QA：可升或显式记录 | **开发态刻意保持 0.0.3，显式记录决策** | 任务书禁止提前创建最终 Tag、禁止同一版本号反复移动；最终 SHA 固定前升版本会造成「版本 0.0.4 但无 Tag」的中间态。**否决「现在全量升到 0.0.4」** |
| 2 | 「固定 SHA”与「改版本必然改 SHA」矛盾 | devops §5.3 提出执行矛盾 | **采纳其澄清**：代码内版本载体并入形成最终 SHA 的版本同步提交；发布产物标识（Tag / Draft / 镜像 tag / 包名）在 SHA 固定后同步 | 原裁决措辞不可执行；拆分后既不违背意图又真正可落地 |
| 3 | 几何「52 条」能否作放行依据 | QA D-01：不可复核，不得作为依据 | **已闭环，可用** | 脚本入仓 + 机器证据；三套口径（严格 52/52、历史 64/84、v0.0.3 96.9%）全部可复算。**否决「直接沿用 52/100% 而不给脚本」** |
| 4 | 144 / 152 / 153 / 154 哪个是 E2E 用例数 | QA：153（含新增 DOM 实证） | **以 `--list` 实测 154 条为准**（`Total: 154 tests in 11 files`） | `--list` 是运行时展开的权威口径；静态 `test(` 声明与历史描述均不作验收数字。**153 是 `ed385cf` 之前的时点，`ed385cf` 新增关注 UI 用例 +1** |
| 5 | 是否可以进入 Draft | devops：建议停在 Draft；QA：有条件可以 | **可以有条件进入 Draft，但不得公开发布** | 功能与安全条件已满足；R-01 维持 DEFERRED、R-16/17/21/24 作为 Draft Notes 已知限制披露（R-18 已修并验证） |
| 6 | 单测 4 文件失败的根因 | 我：并行 PG 负载；QA：`.env.local → 5432` | **两者均错，实测推翻**（经**三次归因勘误**）：本机建库慢且处于 crash recovery / I/O 积压态；稳态实测 `CREATE DATABASE` **2.0~2.3s**（2277/1978/2243 ms） | `ENV_FILE` override 后仍超时、单独跑同样超时、无锁等待。**否决两个错误归因**，改为提高 hookTimeout 并复验（连续 4 轮全绿） |
| 7 | GHCR 镜像是否 private | v0.0.3 E-10：private | **公开可拉取（完整 Bearer 协议实测 HTTP 200）** | 首次 401 只表示需要认证，公开包同样返回；三步协议后 v0.0.1/2/3 全部 200。**否决「首次 401 即判 private」** |
| 8 | 搜索用 B-tree 还是 trigram | 原实现 B-tree 无效 | **pg_trgm GIN** | `ILIKE '%x%'` 前导通配符 B-tree 无法定位（803ms 全表扫描）；trigram 后 0.064ms。否决外部 ES（对 10 万主题过重） |
| 9 | 排行榜是否用相关子查询 | 原实现 | **三个独立 CTE 聚合 + JOIN** | EXPLAIN 241.98s / loops=9997；改写后 0.74s。否决「加索引但保留相关子查询」 |
| 10 | `votes.topic_id` 单列索引 | loadgen 建议添加 | **添加为防御性索引，但如实标注当前代码路径不需要** | 代码用 `topics.votes` 汇总字段，所有 votes 查询都命中 `(user_id, topic_id)` 复合索引；单列索引是为未来「投票明细」预留。**否决「宣称它修复了现有慢查询」** |

---

## 10. 协作与产出归属

按专家团 Workflow C（上线与验收冲刺）编排：Phase 0 需求沿用任务书 → 并行调度部署运维与测试验收 → 主理人汇编与裁决。

| 成员 | 产出 | 本轮关键贡献 |
|---|---|---|
| devops-engineer | `UPGRADE_RECOVERY_v0.0.4.md`、`RELEASE_PROCESS_v0.0.4.md`、`scripts/release/preflight.sh` | 升级指纹逐字节一致、备份恢复连首次真实失败都如实记录；发现「改版本必然改 SHA」执行矛盾 |
| qa-engineer | `ACCEPTANCE_CHECKLIST_v0.0.4.md`、`e2e/v004-four-roles-ui.spec.ts`、`tests/floor-continuity.spec.ts` | D-01~D-16 证据核查；坚持「不把 API 断言伪装成 UI 验收」；补楼层连续 1..n 断言 |
| loadgen（第五阶段） | `scripts/loadtest/seed-large.ts`、`README.md` | 351 万行确定性数据集 + 安全闸门；发现楼层跳号与排行榜慢查询 |
| 主理人 | 缺陷修复、性能优化、视觉工具、文档纠错、裁决与本报告 | 对成员结论冲突显式裁决并记录（§9） |

---

## 11. 剩余待授权项（本轮一律不执行）

1. **R-01 远端 Git 历史改写**（force push / 删 Tag / 改 Release）—— 需主人单独书面授权
2. **创建 `v0.0.4` Tag 与 Draft Release** —— 需 M9 完成 + 最终 SHA 固定 + 主人授权
3. **公开发布正式 Release** —— R-01 未裁决前 `publish` 输入永远保持 `false`
4. **把版本载体升到 `0.0.4`** —— 推迟到版本同步提交（即最终 SHA）时一次性执行
5. **把 `v0.0.4` 加入 `release.yml` tag 白名单** —— 刻意的摩擦，发布时人工加入

> 未经上述授权，本轮交付停在**开发分支 + 可编辑 Draft 准备态**，仓库保持 Public。
