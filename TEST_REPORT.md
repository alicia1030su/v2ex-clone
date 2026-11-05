# 测试报告（TEST_REPORT）

> ⚠️ **状态覆盖声明（v0.0.4 收尾轮，2026-11-04）**：本文件主体是 **v0.0.3 的历史快照**，
> 下方表格里的「E2E 67 passed」「视觉 64 项 / 96.9% / 90.6%」「负载测试未执行」
> 均为当时数字，**不得作为 v0.0.4 验收依据**。v0.0.4 的最新证据如下：
>
> | 项 | v0.0.4 实测 | 证据 |
> |---|---|---|
> | 单元测试 | **190 条 / 15 个文件**，**190 passed / 0 failed / 0 skipped**，**连续 4 轮全绿**。**本轮隔离实例实测 81.68s**；历史轮次 170~210s（共享实例 55433 口径）。实测命令：`ENV_FILE=.env.test npx vitest run` | `docs/evidence/ci/test-baseline-v0.0.4.md` |
> | 单元测试（**CI**） | ✅ **CI 已转绿** —— run `41860242099` 与 `41873009808` 的「类型检查 / 单元测试」job 均 success，vitest 15 文件全过（`Test Files 15 passed (15)` / `Tests 190 passed (190)` / 0 skipped）。**修复前的历史观测**（run `41837212170`，HEAD `930f29e`）：`Test Files 1 failed \| 14 passed (15)` / `Tests 185 passed \| 5 skipped (190)` —— **分母 190 正确**，5 条因 `floor-continuity` 在 CI 崩溃而跳过；**已由 `8ce5ce9` 修复并经 CI 复验**（护栏 3 修复提交 `634a202`）。登记 `BUG_REGISTER` V4-17（**VERIFIED**）/ `RISK_REGISTER` R-26（🟢 已修复并经 CI 复验） | `docs/evidence/ci/ci-status-v0.0.4.md` §0 |
> | 真实浏览器 E2E | **154 条 / 11 个文件**（`npx playwright test --list` 实测 `Total: 154 tests in 11 files`）。**本地历史轮次口径**：153 passed / 0 failed / 0 skipped，连续 2 轮全绿（4.5m，基于 153 条口径、早于 `ed385cf`）。**当前 CI：153 passed \| 1 failed \| 154 total**（run `41873009808`，SHA `2773cd1`），唯一失败为 `e2e/v004-four-roles-ui.spec.ts:122`「节点申请：UI 入口存在 + 真实点击提交成功 + 申请真实入库」—— **真实产品缺陷**，登记 V4-20 / R-27，修复中。实测命令：`ENV_FILE=.env.test LOCAL_BASE=http://localhost:3010 npx playwright test` | `docs/evidence/e2e/e2e-full-run-v0.0.4.md`、`test-list-v0.0.4.txt` |
> | 升级脚本自检 | **62 项断言全 PASS / 0 FAIL**（沙箱模拟，不调用真实 Docker） | `bash scripts/release/verify-update-script.sh` |
> | 视觉对照 | 4 视口 × 17 页面 = 68 条；**40 有对照 / 28 无对照**；严格口径桌面 Δx=0 **52/52** | `docs/VISUAL_DIFF_SUMMARY_v0.0.4.md`、`docs/evidence/visual/geometry-summary.json` |
> | 负载测试 | **已执行**：10000 用户 / 1000 节点 / 100000 主题 / 1000000 回复，24785 请求、13 场景 | `scripts/loadtest/README.md`、`tools/loadtest/bench.mjs`、`docs/evidence/loadtest/bench-result.json` |
> | 升级/恢复验证 | 见 `docs/UPGRADE_RECOVERY_v0.0.4.md` | 第六阶段 |
> | 验收清单 | 见 `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md`（唯一权威验收依据） | 第十一阶段 |
>
> ### 单元测试「185 vs 190」口径裁决（**权威值 = 190 条 / 15 文件 / 0 failed / 0 skipped**）
>
> ⚠️ **「185」有两个不同的来源，绝不可混用 —— 这是本轮最容易出错的地方**：
>
> | 数字 | 来源 | 含义 | 归属 |
> |---|---|---|---|
> | **190** | 本机连续 4 轮实测（`ENV_FILE=.env.test npx vitest run`） | `Test Files 15 passed (15)` / `Tests 190 passed (190)` —— **总数即 190** | ✅ **v0.0.4 权威基线** |
> | **185**<br>（作为**通过数**） | **修复前的历史观测**：CI run `41837212170`（HEAD `930f29e`） | `Tests 185 passed \| 5 skipped (190)` —— ⚠️ **分母仍是 190**，5 条因 `floor-continuity` 在 CI 崩溃而跳过 | ✅ **历史快照**（红灯已由 `8ce5ce9` 修复，run `41860242099` / `41873009808` 单元 job 已 ✅） |
> | **185**<br>（作为**总数**） | CI run `41760677505`（master @ `37710fb4`，**14 个** spec 文件） | `Tests 185 passed (185)` —— 当时总数就是 185 | ⏪ **v0.0.3 历史快照**，已过时 |
>
> **结论**：
> 1. **v0.0.4 的用例总数始终是 190**（15 个文件）—— CI 的 `185 passed | 5 skipped (190)` 的**分母就是 190**，
>    **不构成「总数有争议」**。当前分支与 v0.0.3 的**总数差异**来自 `tests/floor-continuity.spec.ts`（5 条，提交 `1b15f79` 引入）。
> 2. **185 不是「v0.0.4 的用例数」** —— 它要么是 CI 上的**通过数**（`floor-continuity` 5 条在 CI 崩溃），
>    要么是 **v0.0.3 master 的历史总数**。两者含义不同。
> 3. ✅ **CI 单元测试已转绿**（run `41860242099` / `41873009808`，SHA `2773cd1`）：
>    `Test Files 15 passed (15)` / `Tests 190 passed (190)` / **0 skipped**，`e2e` job **已真实跑过**（不再被 `needs: unit` 连带跳过）。
>    **修复前的历史观测**（run `41837212170`，HEAD `930f29e`）为 `Test Files 1 failed | 14 passed (15)` /
>    `Tests 185 passed | 5 skipped (190)`，根因是 `tests/floor-continuity.spec.ts` 硬编码
>    `readFileSync('.env.test')` + 对 `DATABASE_URL` 的 `:55433/` 端口白名单 ——
>    `.env.test` 被 gitignore ⇒ CI 检出里根本没有这个文件，而 CI 的 `DATABASE_URL` 是 5432，
>    两条路都走不通 ⇒ ENOENT 崩溃 ⇒ 5 条 skipped ⇒ `unit` job 红灯 ⇒ `e2e` job 被 `needs: unit` 连带跳过。
>    **已由 `8ce5ce9` 修复并经 CI 复验**（护栏 3 修复提交 `634a202`）——
>    登记 `BUG_REGISTER` V4-17（**VERIFIED**）/ `RISK_REGISTER` R-26（🟢 已修复并经 CI 复验）。
> 4. ⚠️ **静态 grep 不可用作口径**：`grep -cE "^\s*(it|test)\s*[(']"` 得出 **180**（少于 190），
>    因为 `tests/admin-permissions.spec.ts` 等用**嵌套 for 循环**生成用例。**口径必须取 Vitest 运行时的 `numTotalTests`**。
>    完整三方交叉校验（日志块 ↔ JSON reporter ↔ 逐文件明细求和）见 `docs/evidence/ci/test-baseline-v0.0.4.md` §0.1 / §0.2。
>
> ⚠️ **核对 CI 时必须看 `Test Files` 行，不能只看 `Tests` 行** —— `1 failed + 5 skipped`
> 与「148 条里少了几条」形态完全不同，漏看会误判为通过（这正是 R-23 那类静默跳过）。
>
> #### `.env.test` 的定位（**这是理解「185 vs 190」的关键**）
>
> | 项 | 说明 |
> |---|---|
> | **是什么** | **本地隔离测试配置** —— 指向本机 PostgreSQL 17 的**隔离实例**（与生产库、生产端口 5432 完全隔离）。**按 `.env.test` 实际解析的端口（当前 55440）** —— `.env.test` 第 3 行实测值：`DATABASE_URL=postgres://v2ex:...@127.0.0.1:55440/v2ex_test_base` |
> | **是否入仓** | ❌ **不入仓** —— 被 `.gitignore` 排除（`git ls-files` 只跟踪 `.env.example` 与 `deploy/.env.example`） |
> | **本地如何用** | `ENV_FILE=.env.test npx vitest run` —— 由 `ENV_FILE` 指向它（**override 生效**） |
> | **CI 如何用** | **环境变量注入** —— CI 的 `DATABASE_URL` 由 `ci.yml` 的 PG service 直接提供，**不读 `.env.test`** |
> | **⚠️ 由此产生的缺陷（已闭环）** | `tests/floor-continuity.spec.ts` 曾硬编码 `readFileSync('.env.test')` + `:55433/` 端口白名单 ⇒ **CI 干净克隆里两条路都走不通**（无文件 + 端口不匹配）⇒ ENOENT 崩溃 ⇒ 5 条 skipped。登记 `BUG_REGISTER` **V4-17** / `RISK_REGISTER` **R-26**，**已由 `8ce5ce9` 修复并经 CI 复验**（run `41860242099` / `41873009808` 单元 job ✅，`190 passed / 0 skipped`） |
>
> 视觉的 `96.9% / 90.6%` 是 **v0.0.3 的历史口径**（分母 84，且把「两侧都不存在」也计为一致），
> 与 v0.0.4 的严格口径（分母 52）不可直接比较 —— 三套口径的完整说明见
> `tools/visual/summarize-visual-diff.py` 的 `geometry-summary.json`。
> 本轮**不声明任何「相似率」百分比**。

> 本报告的每个数字都来自**真实运行**。
> 未执行的项明确标注为「未执行」并说明原因，不做推测性声明。

## v0.0.4 单元测试（权威口径，取代下方 v0.0.3 历史快照）

| 项 | 值 |
|---|---|
| 测试文件数 | **15** |
| 用例总数 | **190** |
| 通过 | **190** |
| 失败 | **0** |
| 跳过（pending） | **0** |
| 连续全绿轮次 | **4 轮**（**本轮隔离实例实测 81.68s**；历史轮次 170~210 秒，共享实例 55433 口径） |
| v0.0.3 基线 | 185 条 / 14 文件（**全部保留，无删减**） |
| v0.0.4 新增 | 5 条（`tests/floor-continuity.spec.ts`，楼层号严格连续 `1..n`） |

> `numPendingTests: 0` —— **没有任何用例被静默跳过**。这是比「全绿」更强的结论
> （R-23 那类「1 failed + N skipped」形态正是靠这一项才能识别）。
>
> **旧表保留在下方「单元测试（v0.0.3 历史快照）」小节**，数字不改写，仅作版本演进记录。

## 单元测试（v0.0.3 历史快照）

| 项 | 值 |
|---|---|
| 套件数 | **14** |
| 用例总数 | **185** |
| 通过 | **185** |
| 失败 | **0** |
| 跳过 | **0** |
| v0.0.2 基线 | 117 条（全部保留，无删减） |
| v0.0.3 新增 | 68 条 |

### 新增测试文件

| 文件 | 用例 | 覆盖内容 |
|---|---|---|
| `tests/content-lifecycle.spec.ts` | 13 | 软删除不泄露、幂等（投票/感谢）、并发楼层唯一、编辑历史、权限矩阵实测 |
| `tests/password-reset.spec.ts` | 11 | 令牌哈希存储、过期/撤销/重放、并发消费、改密后会话失效、邮箱脱敏 |
| `tests/credits-concurrency.spec.ts` | 8 | 幂等键并发、30 并发扣费不产生负余额、账本自洽、签到并发 |
| `tests/admin-permissions.spec.ts` | 24 | 11 项权限 × 3 角色逐条比对、401/403 区分、危险操作不存在性扫描 |
| `tests/feed-search.spec.ts` | 12 | XML 结构有效性、特殊字符转义、RFC822/3339 格式、SQL 注入防护、分页上限 |

### 六类测试要求对照

| 要求 | 覆盖位置 |
|---|---|
| 正常流程测试 | 各测试文件的 happy path 用例 |
| 非法输入测试 | `admin-permissions`（非法角色）、`feed-search`（畸形输入）、`password-reset`（畸形令牌） |
| 越权测试 | `admin-permissions`（权限矩阵）、`content-lifecycle`（canModifyOwnContent） |
| 重复请求测试 | `content-lifecycle`（投票/感谢幂等）、`credits-concurrency`（幂等键） |
| 并发测试 | `content-lifecycle`（12 并发回复 / 8 并发感谢）、`credits-concurrency`（30 并发扣费） |
| 数据一致性测试 | `credits-concurrency`（账本自洽）、`content-lifecycle`（计数一致） |
| 页面交互测试 | E2E（见下） |

## 真实 HTTP 端到端验证

> 真实 `next start` + 真实 PostgreSQL + curl 发起真实请求（非 mock）。

| 验证项 | 结果 |
|---|---|
| 投票连发 3 次（幂等） | topics.votes=1、votes 表 1 行 ✅ |
| 感谢自己的回复 | HTTP 400「不能感谢自己的回复」✅ |
| 签到连发 3 次（幂等） | daily_checkins 1 行、余额只加一次（1000→1002）✅ |
| 未登录访问管理 API | HTTP 401 ✅ |
| 普通用户 POST /api/topics/1/lock | HTTP 403 权限不足 ✅ |
| 普通用户 POST /api/topics/1/pin | HTTP 403 权限不足 ✅ |
| 普通用户访问 5 个管理 API | 全部 HTTP 403 ✅ |
| 软删除主题 —— 未登录访问 | HTTP 404（不泄露）✅ |
| 软删除主题 —— 普通用户访问 | HTTP 404（不泄露）✅ |
| 登录后主题页渲染 | 操作栏/赞/锁定/置顶/删除 全部可见 ✅ |

## v0.0.4 真实浏览器 E2E（权威口径）

> 实测命令：`ENV_FILE=.env.test LOCAL_BASE=http://localhost:3010 npx playwright test`
> 环境：本机隔离实例（**按 `.env.test` 实际解析的端口，当前 55440**；PostgreSQL 17）+ `next start`（端口 3010）

| 项 | 值 |
|---|---|
| 测试文件数 | **11** |
| 用例总数 | **154**（`npx playwright test --list` 实测 `Total: 154 tests in 11 files`） |
| 通过 | **153** |
| 失败 | **1**（`e2e/v004-four-roles-ui.spec.ts:122` 节点申请 UI 提交链断裂 —— 真实产品缺陷，V4-20 / R-27，修复中） |
| 跳过 | **0** |
| 连续全绿轮次 | **2 轮**（每轮约 4.5 分钟）—— **本地历史轮次口径，基于 153 条口径、早于 `ed385cf`** |
| 单轮耗时 | **4.5m** |
| **当前 CI 结果** | **153 passed \| 1 failed \| 154 total**（run `41873009808`，SHA `2773cd1`） |

**口径分解**（与 `docs/evidence/e2e/test-list-v0.0.4.txt` 完全自洽；`--list` 实测）：

| 来源 | 文件数 | 用例数 |
|---|---|---|
| v0.0.3 原有 E2E | 6 | 67 |
| v0.0.4 新增四文件（`v004-api-contract` / `v004-content-interaction` / `v004-endpoint-smoke` / `v004-account-admin`） | 4 | 79 |
| 四身份 UI（`v004-four-roles-ui.spec.ts`） | 1 | 8 |
| **合计** | **11** | **154** |

> ⚠️ `v004-endpoint-smoke.spec.ts` 的条数随 GET 路由数浮动 ⇒ **正式发布前须重新 `--list` 固定口径**。
> 历史数字说明：**144** = `67 + 77`（更早时点）、**152** = 新增 DOM 实证用例之前的时点、
> **153** = `ed385cf` 之前的时点（其中 `v004-account-admin` 为 20 条）——
> 四个数字各有其时点，均非错误，**当前权威值为 154**（`ed385cf` 新增关注 UI 用例 +1）。

### 修复前的历史失败轮（如实保留，不回写历史）

修复前一轮为 **152 passed / 1 skipped** —— `v004-account-admin.spec.ts:191`「关注链路」因从 `/settings` 页
body 文本正则提取用户名失败而 `test.skip` 静默跳过（**R-23**）。已修复并实跑通过
（改为从 `/api/users/me` 取确定性目标 id，删除 `test.skip`，补齐三条原本宣称却从未执行的断言）。
证据：`docs/evidence/e2e/e2e-full-run-v0.0.4.md`。

## 升级脚本自检（v0.0.4 收尾轮新增）

> 实测命令：`bash scripts/release/verify-update-script.sh`
> 性质：**沙箱模拟** —— 不调用真实 Docker，不触碰仓库真实文件（自检末尾有「仓库真实文件未被改动」的校验和断言）。

| 项 | 值 |
|---|---|
| 断言总数 | **62** |
| PASS | **62** |
| FAIL | **0** |
| 覆盖用例 | 版本参数生效 / pull 目标为新 tag / 全程无 `down -v` / pull 失败时非零退出且 `.env` 恢复旧值 / 备份失败中止升级 / 非法版本号被拒 / 镜像未变化时告警中止（退出码 3）/ 仓库真实文件未被改动 |

---

## E2E 测试（GitHub Actions 真实环境）

> run `41754998422` —— ubuntu-latest + PostgreSQL 17 + Redis 7 服务容器。
> ⚠️ **本小节是 v0.0.3 历史快照**（HEAD `89d6b4e` 之前的 CI run）。
> v0.0.4 的权威 E2E 数字见文首「状态覆盖声明」：**154 条 / 11 文件**；
> **本地历史轮次口径**：153 passed / 0 failed / 0 skipped、连续 2 轮全绿（4.5m，基于 153 条口径、早于 `ed385cf`）；
> **当前 CI：153 passed | 1 failed | 154 total**（run `41873009808`）。

| 项 | 结果 |
|---|---|
| 前后端 API 契约校验 | ✅ success（后端 72 路由 / 前端 30 处调用 → 全部匹配） |
| E2E 用例 | **67 passed**（0 failed / 0 skipped）—— v0.0.3 历史快照 |
| 单元测试 | **185 passed**（14 套件）—— v0.0.3 历史快照 |
| Docker 构建与启动验证 | ✅ success |
| 整个 workflow | ✅ **success** |

## 发布流水线验证（GitHub Actions 真实环境）

> run `41759712235` —— 由 `v0.0.3` tag 推送触发。

| job | 结果 |
|---|---|
| 前置检查（版本冲突检测） | ✅ success |
| 代码检查（类型 + 构建） | ✅ success |
| 安全扫描（依赖 + 秘密） | ✅ success |
| 单元测试 | ✅ success |
| E2E 测试 | ✅ success |
| 构建并推送镜像 | ✅ success（`ghcr.io/alicia1030su/v2ex-clone:v0.0.3`） |
| 部署验证（启动 + 重启持久化） | ✅ success |
| 生成安装包 | ✅ success |
| 创建并发布 Release | ✅ success |
| 远端核验（Release 与资产） | ✅ success |
| **整个 workflow** | ✅ **success（10/10）** |

**Release 最终状态实测**：

| 项 | 实测值 |
|---|---|
| `isDraft` | **true**（按约定停在 Draft，未公开发布） |
| `isPrerelease` | true |
| `publishedAt` | `null` |
| 资产 | `SHA256SUMS`（95 B）+ `v2ex-clone-v0.0.3-deploy.zip`（41,867 B） |
| 远端核验输出 | 「Release 状态：draft / 资产清单: ['SHA256SUMS', 'v2ex-clone-v0.0.3-deploy.zip'] / Release 状态核验通过 ✓」 |
| 镜像匿名可见性 | ✅ **公开可拉取** —— 按 Registry V2 Bearer Token 协议实测：匿名换 token → 带 token 请求 manifest → **HTTP 200**（v0.0.1/v0.0.2/v0.0.3 全部 200）。v0.0.3 的「包为 private」判定基于不完整的 401 测试，**结论有误**，已在 E-10 修正 |

## 并发压力验证

> 真实 `next start` + 真实 PostgreSQL，多个并发 curl 请求打同一端点，
> 结束后用 SQL 校验不变量。

| 场景 | 并发数 | 结果 |
|---|---|---|
| 并发回复（楼层号唯一性） | 30 | ✅ 25 条入库（5 条被限流拦），**重复楼层 0 组**，`topics.replies_count` 与实际一致 |
| 并发感谢同一回复 | 20 | ✅ `thanks` 表与 `replies.thanks` 字段一致 |
| 并发投票同一主题 | 20 | ✅ `votes` 表 1 行，`topics.votes` 汇总一致 |
| 并发签到 | 10 | ✅ 今日签到记录 **只 1 条**，余额不重复增加 |
| 负余额检查 | 全库 | ✅ 负余额用户数 **0** |
| 账本自洽检查 | 全库 | ✅ `balance_before + amount <> balance_after` 的行数 **0** |
| 孤儿流水检查 | 全库 | ✅ **0** |

> 说明：并发感谢场景因目标回复的作者就是操作者本人（不能感谢自己的回复），
> 故计数保持 0 —— 这本身是防滥用规则生效的表现。

## 数据库迁移与升级测试

| 项 | 结果 |
|---|---|
| v0.0.2 结构库（18 表）→ 应用 0001 | ✅ 升级后 26 表、8 个新表全部创建、枚举全部正确 |
| 升级前后数据指纹比对 | ✅ 完全一致（users/topics/replies/nodes/balance/管理员口令哈希均未变） |
| 迁移幂等性 | ✅ 连续应用 3 次全部 exit=0，最终 26 表 / 38 约束 |
| 全新库安装迁移 | ✅ `migrations applied successfully!` |
| 迁移脚本幂等保护 | ✅ `CREATE TABLE/INDEX/ADD COLUMN` 加 `IF NOT EXISTS`；`CREATE TYPE/ADD CONSTRAINT` 包入 `DO $$ ... EXCEPTION WHEN duplicate_object` |

## 视觉测试

> ⚠️ **本小节是 v0.0.3 历史快照**（分母 64 / 84，2026-11-02 的 `layout-measurements.json`）。
> **v0.0.4 的权威视觉口径**是 4 视口 × 17 页面 = 68 条、**40 有对照 / 28 无对照**、
> 严格口径（分母 52）桌面 Δx=0 **52/52** —— 见 `docs/VISUAL_DIFF_SUMMARY_v0.0.4.md`。
> ⚠️ **不得**据「52 个可比锚点 Δx 全为零」宣称「像素级复刻完成」：
> 该结论只覆盖**几何位置**一个维度，六类区分（几何位置 / 组件宽高 / 视觉样式 /
> 动态内容 / 缺失组件 / 实际交互）必须分别判定，且 **68 条中有 28 条无原站对照**。

| 视口 | 测量项 | Δx 一致率 | Δw 一致率 |
|---|---|---|---|
| 1280 × 900 | 64 | 96.9% | 90.6% |
| 1920 × 1080 | 64 | 96.9% | 90.6% |
| 375 × 812 | 64 | 34.4% | 56.2%（响应式重排，见 VISUAL_DIFF_REPORT） |

原始数据：`docs/evidence/visual/layout-measurements-*.json`

## 静态检查与构建

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npx next build` | ✅ Compiled successfully |
| `npm audit` | ✅ 0 漏洞（v0.0.2 修复后保持） |

## 未执行 / 如实标注

| 项 | 状态 | 原因 |
|---|---|---|
| 镜像漏洞扫描（Trivy/Grype） | ⚠️ 本机无 Docker | 需在 CI 的 Docker job 执行；`docker-verify.yml` 已就绪（**R-16 取证通道**），九项已实跑通过（run `41871503684`），但**镜像漏洞扫描本身不在九项内** |
| 多浏览器视觉回归（Firefox/Safari） | ⚠️ 未执行 | 本机只装了 Chromium 与 Edge；CI 可扩展 |
| 基础负载测试（k6 等） | ⚠️ 未执行 | 本轮用并发单元测试与并发 HTTP 验证覆盖了正确性，但未做吞吐量压测（**v0.0.4 已用 `tools/loadtest/bench.mjs` 做真实吞吐量压测替代，见文首状态覆盖声明**） |
| 原站移动版比对 | ❌ 未做 | 无原站移动版证据；本项目为独立替代实现 |
| **容器级升级实跑** | ⚠️ **待实测** | 升级脚本自检（62 项断言）已在沙箱通过，但**真实容器级升级仍需带 Docker 的环境复跑**（R-18 的残余边界） |
| **Redis 故障注入实跑** | ✅ **已实跑通过** | `[R-17a]` Redis 中断与恢复 / `[R-17b]` PG 中断与恢复 / `[R-17c]` 缓存失效与 Redis 内存观测 —— run `41871503684`（SHA `2773cd1`）九项全 PASS（R-17 已闭环） |
| **Docker 验证 1~9 项** | ✅ **已实跑通过** | run `41871503684`（SHA `2773cd1`）**九项全部 completed / success，九项汇总表全 PASS**（R-16 已闭环；修复提交 `827eef7` + `2773cd1`） |

