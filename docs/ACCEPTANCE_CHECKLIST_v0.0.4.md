# v0.0.4 最终验收清单与证据核查（ACCEPTANCE_CHECKLIST）

> 仓库：`C:/Users/TYMO001/WorkBuddy/ai/v2ex-clone`
> 分支：`feat/v0.0.4-high-fidelity` · HEAD：`89d6b4e`
> 核查时点：2026-11-04（与本轮各阶段证据同日）
> 核查人：测试验收工程师（qa-engineer）
> 核查方式：**只读**。逐一打开交付物、原始 JSON、E2E 源码、迁移 SQL、版本载体与风险登记；用脚本对原始证据做计数与一致性复算。
>
> **本次核查未执行任何写操作**：未修改任何现有文件、未跑 `npx vitest run` / `npx playwright test`（主理人并行复验，避免争抢数据库）、未写数据库、未执行 git commit / push / 建删 Tag / 改 Release / 改仓库可见性。
> 本清单是**唯一新增文件**。

---

## 0. 结论摘要（先给判断）

**对「v0.0.4 是否可以进入 Draft Release 阶段」的判断：有条件可以。**

- **可以进入的依据**：**194 条单元 / 16 文件**（194 passed / 0 failed / 0 skipped，连续 4 轮全绿）/ **154 条 E2E / 11 文件**（`--list` 实测 `Total: 154 tests in 11 files`；✅ **当前权威实测 = 154 passed / 0 failed / 0 skipped（11 文件，3.9m）** —— V4-20 修复后本地实跑全绿；**本地历史轮次口径**：153 passed / 0 failed / 0 skipped，连续 2 轮全绿，4.5m/轮 —— 基于 153 条口径、早于 `ed385cf`；**修复前的历史快照**：CI run `41873009808` = `153 passed | 1 failed | 154 total`）、7 个真实缺陷已修且多数有回归用例、4 视口视觉证据齐备且 28 条无对照项如实标注、真实社区规模压测数据集与结果文件齐备、幂等性能索引迁移已产出、GHCR 经完整 Bearer 协议复核为公开可拉取（E-10 已改写）、Git 历史清理完成**隔离演练**且未触碰远端。这些已满足「进入可编辑的 Draft」而非「正式发布」的功能与安全条件。
- **必须带上的条件**：版本载体与缺陷登记未同步到 v0.0.4；管理员/版主后台的**真实浏览器 UI 点击流**为零覆盖；多份文档存在互相矛盾的数字；**此外，R-27 / V4-20（节点申请 UI 提交链断裂）已由 `bddb3d0` 修复并本地实测验证（单元 194/194、E2E 154/154 全绿），本轮唯一红灯已解除 —— 但 **CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅），须在正式发布前确认 CI 侧同样全绿**。这些不是功能缺陷或安全阻断，但必须在 Draft Notes 中逐条显式披露，并在 §9.3 的前置条件里闭环。
- **已闭环项（本轮收尾）**：视觉几何核心数字**已可复核**（D-01 已闭环 —— `8f1e214` 把汇总脚本入仓并产出 `docs/evidence/visual/geometry-summary.json` 三套口径机器可读，`docs/DELIVERY_PLAN_v0.0.4.md` 已标「✅ 已闭环，可用」）。
- **为什么不是「不可以」**：所有未闭环项都不触及「禁止未经授权改写远端」的红线；R-01/E-02 按第九阶段要求维持 DEFERRED、仓库保持 Public，符合授权边界。Draft 阶段允许携带已知限制。
- **为什么不是「可以」**：若放行前不补 §9.3 的前置条件，验收将出现「版本号与交付物不符」「核心通过标准无原始证据」「UI 验收被 API 测试冒充」三类硬伤，届时无法对外解释通过依据。

> ⚠️ 本清单**不声明任何「相似率」百分比**。像素差包含内容差异（原站真实社区数据 vs 本地 seed），不构成相似度结论；几何量测只报位置/尺寸一致数。**D-01 已闭环**（`8f1e214` 脚本入仓 + `docs/evidence/visual/geometry-summary.json` 三套口径机器可读），详见 §3 / D-01。

---

## 1. 验收通过标准（Go / No-Go 门禁）

### 1.1 测试策略与分层责任

| 层级 | 范围 | 责任方 | 自动化目标 |
|------|------|--------|-----------|
| 单元 / 集成 | 权限矩阵、并发与幂等、账本自洽、Feed 结构、SQL 注入防护、楼层分配 | 主理人（现有 `tests/`） | **194 条 / 16 文件全绿**（连续 4 轮；修复前基线为 190 条 / 15 文件，V4-20 修复新增 `tests/form-name-shadowing.spec.ts` 的 4 条防回归断言）；新增缺陷 100% 有回归用例。✅ **CI 侧已转绿**（run `41860242099` / `41873009808` 单元 job ✅，`190 passed / 0 skipped`）—— **修复前的历史观测**（run `41837212170`）：`floor-continuity` 崩溃 ⇒ `e2e` job 连带跳过（**V4-17 / R-26，已由 `8ce5ce9` 修复并经 CI 复验**）；✅ **194 条口径已由 CI 复验通过**（run `41949555282`，SHA `bddb3d0`：`Test Files 16 passed (16)` / `Tests 194 passed (194)`） |
| API 契约 / 冒烟 | 全部 GET 端点不 5xx、响应 JSON 合法、分页与 limit 钳制 | 第四阶段（`e2e/v004-*.spec.ts`） | 55 个 route.ts 中 29 个 GET 端点全覆盖 |
| 真实浏览器 E2E | 四身份点击流、内容生命周期、互动、后台 | 第四阶段 + 本清单 §4 | 四身份各至少 1 正向 + 1 异常；**后台 UI 点击流需补齐** |
| 视觉回归 | 4 视口 × 17 页面布局/内容差异分离 | 第三阶段（`tools/visual/`） | 常驻 CI 回归尚未建成（FEATURE_AUDIT #53 ⚠️ PARTIAL） |
| 性能 / 负载 | 真实社区规模数据集、分位延迟、错误率 | 第五阶段（`tools/loadtest/bench.mjs`） | 结果可复现；口径需统一（§3 / D-05） |
| 升级 / 恢复 / 发布 | 迁移幂等、备份还原、故障恢复、发布门禁 | devops-engineer（任务 #2/#3） | 本轮仍 pending，见 §6.2 |
| 安全 / 合规 | 越权、注入、XSS、CSRF、凭据脱敏、例外到期 | 主理人 + devops-engineer | `SECURITY_EXCEPTIONS` / `RISK_REGISTER` 复核 |

**AI 专项测试：不适用**（本项目非 AI 应用，无智能体输出、Prompt 回归或工具调用评测）。

**回归策略与冒烟集**：以 `e2e/v004-endpoint-smoke.spec.ts`（源码自动发现全部 GET 端点）+ `e2e/v004-api-contract.spec.ts`（13 个公开端点）为常驻冒烟集；`e2e/security-regression.spec.ts`（19 条）为安全冒烟集。回归要求「连续两轮全绿」（沿用 `RELEASE_GATE.md` B5/B6 口径）。

**测试数据与环境策略**：E2E 用 `.env.test` 隔离库 + `APP_RUNTIME_ENV=test` / `TEST_ENV_ISOLATED=1` / `DISABLE_CAPTCHA=1`；压测数据只允许写入库名含 `loadtest`/`perf`/`stress`/`bench` 的隔离库（`scripts/loadtest/README.md` 安全闸门）；视觉证据中需登录的 7 个页面不拿游客态冒充原站对照（已在 `VISUAL_DIFF_SUMMARY_v0.0.4.md` §5 如实标注）。

### 1.2 分阶段可勾选验收标准

#### 功能
- [x] 53 项功能审计完成，无 BROKEN 级缺陷（`FEATURE_AUDIT_v0.0.4.md`：38 VERIFIED / 14 PARTIAL / 1 MISSING）
- [x] 7 个 v0.0.4 真实缺陷已修复（§5 逐项列出验证方式）
- [x] 写操作鉴权 / CSRF / 限流 / XSS 清洗回归通过
- [ ] **缺陷登记闭环**：7 个缺陷写入 `CHANGELOG.md` v0.0.4 段落与 `BUG_REGISTER.md`（当前未登记，见 §3 / D-10）
- [x] **楼层连续性断言**：✅ **已闭环**（v0.0.4 新增 `tests/floor-continuity.spec.ts`，5 条严格「楼层连续 1..n」断言，CI 实跑通过）

#### 视觉
- [x] 4 视口 × 17 页面 = 68 条记录，40 条完成对比、28 条如实标注跳过（`visual-diff-multi.json` 与汇总一致）
- [x] 桌面/平板判定「布局差异 0 · 数据差异 0」；375 视口标注为有意响应式重排
- [x] **几何量测数字可复核**：✅ **已闭环** —— `8f1e214` 把汇总脚本入仓（`tools/visual/summarize-visual-diff.py`）并产出 `docs/evidence/visual/geometry-summary.json`（**三套口径机器可读**：严格 52/52、历史 64/84、v0.0.3 96.9% 全部可复算）；`docs/DELIVERY_PLAN_v0.0.4.md` 已标「✅ 已闭环，可用」
- [ ] 自动化视觉回归纳入 CI（`FEATURE_AUDIT` #53 仍 ⚠️ PARTIAL）

#### E2E
- [x] 原有 6 文件 67 条 + 新增 4 文件（静态声明 36 条、运行时展开约 78 条）
- [x] 单 project（chromium 1280×900）下全绿，`retries: 0`、`fullyParallel: false`
- [x] **用例数口径固定**：已产出 `playwright test --list` 输出（`docs/evidence/e2e/test-list-v0.0.4.txt` 与 `docs/evidence/baseline/playwright-list-v0.0.4.txt`，`Total: 154 tests in 11 files`），**权威口径为 154 条 / 11 文件**；历史「144 条」「152 条」「153 条」是更早时点（§3 / D-08）
- [ ] **四身份 UI 层验收补齐**：特别是版主与管理员后台（§4）
- [ ] 多浏览器 / 多视口**交互** E2E（当前仅 1 个 project，4 视口只有截图对比）

#### 性能
- [x] 大规模数据集生成：10,000 用户 / 1,000 节点 / 100,000 主题 / 1,000,000 回复，3,513,106 行 / 3m4.0s，确定性指纹可复现
- [x] 13 场景 / 24,785 请求 / 20s / 并发 10，无 5xx；搜索 API avg 41.98ms、节点列表 API avg 67.97ms
- [x] `drizzle/0002_v004_perf_indexes.sql`：5 个 btree + 2 个条件性 pg_trgm GIN 索引，全部 `IF NOT EXISTS`
- [ ] **统一性能口径**：leaderboard 的 0.46s / 0.4s / 压测 avg 1.16s 三个数值并存，需注明测量条件（§3 / D-05）
- [ ] **错误率口径**：412 个错误全部为 404（随机 id 越界/软删除），需在通过标准中明确是否排除数据构造类 404（§3 / D-06）
- [ ] 确认压测库已应用 `0002_v004_perf_indexes.sql`（无迁移执行日志）

#### 升级
- [x] `0002_v004_perf_indexes.sql` 幂等设计已复核
- [ ] v0.0.3 → v0.0.4 原地升级实测（任务 #2 pending）
- [ ] PG / Redis 故障恢复、备份实际还原（§6.2）

#### 发布
- [ ] **版本一致性**：权威载体清单以 `scripts/release/preflight.sh` 实际校验的 **5 个载体**为准 —— `package.json` / `deploy/VERSION` / `README.md` / `RELEASE_GATE.md` / `TEST_REPORT.md`（`preflight.sh` L147–148「版本载体（5 个，主理人裁决）」）。当前全部为 `0.0.3`（开发态刻意保持，R-20 裁决），或显式记录「版本号推迟到正式发布」的决策与责任人（§3 / D-02）
- [x] `RELEASE_GATE.md` 更新：**收尾轮已在文件顶部补「§0 v0.0.4 门禁速览」**（单元 190/15 文件、E2E 154/11 文件、升级脚本自检 62 项全 PASS、视觉部分、Docker/Redis **已闭环**、四身份 UI **已修（`ed385cf`）**、Git 历史阻断、版本载体按裁决）。B3「≥103 单元」/ B4「≥67 E2E」仍保留在下方作为 **v0.0.2 历史门禁**，并已加状态覆盖声明（§3 / D-13）
- [x] GHCR 镜像经完整 Bearer 协议实测公开可拉取，E-10 旧结论已推翻
- [ ] Draft Release Notes 显式披露 §6 全部遗留项与 §7 全部缺口
- [x] `vitest.config.ts` 已由主理人提交（含 `hookTimeout: 120_000` 与 `fileParallelism: false`），以最终提交态复验 **194/194（16 文件，连续 4 轮全绿）+ E2E 154 条 / 11 文件**（✅ **当前权威实测 = 154 passed / 0 failed / 0 skipped（11 文件，3.9m）** —— V4-20 修复后本地实跑全绿；**本地历史轮次口径**：153/153 连续 2 轮全绿，基于 153 条口径、早于 `ed385cf`；**修复前的历史快照**：CI run `41873009808` = `153 passed | 1 failed | 154 total`，唯一失败为节点申请 UI 提交链断裂 V4-20 / R-27，**已由 `bddb3d0` 修复并本地实测验证**；****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）**）

#### 安全
- [x] `docs/SECURITY_EXCEPTIONS.md` E-10 已改写为「公开可拉取」并给出三步 Bearer 实测
- [x] 后台权限矩阵、配置脱敏、封禁/解封、禁止自我降级均有断言
- [ ] `RISK_REGISTER.md` R-09 内容错置修正、R-01/R-02/R-03/R-14 与 v0.0.4 证据对齐（§3 / D-09）
- [ ] R-01 / E-02 维持 DEFERRED 并在 Release Notes 显著披露；**不执行** force push / 删 Tag / 改 Release / 改可见性
- [ ] 例外到期日复核（E-02/E-03/E-04 到期 2026-12-04，E-05 到期 2026-11-11）

### 1.3 Go / No-Go 判定表

| 判定 | 条件 |
|------|------|
| **Go（进入 Draft Release）** | §1.2 中所有 `[x]` 项保持成立 **且** §9.3 的 8 项前置条件中 P1/P2/P3/P4/P7 完成或已在 Draft Notes 显式登记为已知限制；违禁操作零发生；R-01/E-02 维持 DEFERRED |
| **No-Go** | 出现任一：① 单元/E2E 复验非全绿；② 发现新的 5xx 级功能缺陷；③ 未经授权执行了远端历史改写 / 删 Tag / 改 Release / 改可见性；④ 把 API 层 403 断言当作「四身份 UI 验收已通过」对外宣称；⑤ 用未经复核的「Δx=0 100%」作为放行依据 |
| **正式 Release（非本阶段）** | 必须另行满足：版本载体全部同步、§6.2 无法验证项完成或经主人书面接受、§4 四身份 UI 缺口补齐、R-01 获主人裁决 |

---

## 2. 实测证据表

> 状态取值：**已验证**（文件存在、数字自洽、可复核） / **部分**（存在但口径/证据链不完整） / **未验证**（缺文件或缺原始证据）。

| # | 阶段 | 证据文件路径 | 关键数字 | 状态 |
|---|------|--------------|----------|------|
| E-01 | 一 | `FEATURE_AUDIT_v0.0.4.md` | 53 项：38 VERIFIED / 14 PARTIAL / 1 MISSING；20+36=56 项 HTTP+DB 行为验证；单测 175/14、E2E 67/6（审计时点） | 部分（§3 D-14 口径差异） |
| E-02 | 三 | `docs/VISUAL_DIFF_SUMMARY_v0.0.4.md` | 40 对比 / 28 跳过 / 4 视口 × 17 页面；52 条几何、Δx=0 100%、Δw=0 92.3% | ✅ **已闭环**（`8f1e214` 脚本入仓 + `docs/evidence/visual/geometry-summary.json` 三套口径机器可读；D-01） |
| E-03 | 三 | `docs/evidence/visual/visual-diff-multi.json` | 68 条 = 每视口 10 compared + 7 incomplete；40/28；无任何几何字段 | **已验证**（与 E-02 的 40/28 自洽） |
| E-04 | 三 | `docs/evidence/visual/layout-measurements-{desktop-1280,desktop-1920,tablet-768,mobile-375}.json` | 每视口 **6 页面 × 14 锚点 = 84 行**；桌面 Δx=0 **64**、Δw=0 **60**；移动 Δx=0 **22**、Δw=0 **38** | **已验证**（但数字与 E-02 不符） |
| E-05 | 三 | `docs/evidence/visual/layout-measurements.json`（legacy, 2026-11-02） | 84 行、Δx=0 62、Δw=0 59 | 已验证（历史基线） |
| E-06 | 三 | `docs/evidence/visual/diff-*.png`、`docs/evidence/screenshots/**` | 4 视口各 17 页本地截图 + 10 页原站对照 + 差异热力图齐备 | 已验证 |
| E-07 | 四 | `e2e/v004-account-admin.spec.ts` | 静态 20 条；`page.goto` 7 次 / `request.*` 30 次 → UI+API 混合 | 已验证 |
| E-08 | 四 | `e2e/v004-content-interaction.spec.ts` | 静态 10 条；含真实 UI 点击流（投票/感谢/编辑模态框/删除）/ 并发 | 已验证 |
| E-09 | 四 | `e2e/v004-api-contract.spec.ts` | 13 个公开端点循环 → 17 条运行时用例；`page.goto`=0，**纯 API 层** | 已验证 |
| E-10 | 四 | `e2e/v004-endpoint-smoke.spec.ts` | 源码自动发现 **29 个 GET 路由** → 31 条运行时用例；`page.goto`=0，**纯 API 层** | 已验证 |
| E-11 | 四 | `e2e/*.spec.ts` 全量 | 静态 `test(`：原有 67（6 文件）+ 新增 36（4 文件）= **103**；运行时展开约 145 | 部分（缺 `--list` 输出，§3 D-08）—— ✅ **已闭环**：`--list` 输出已入仓，权威口径 **154 条 / 11 文件** |
| E-12 | 五 | `scripts/loadtest/README.md` + `seed-large.ts` | 3,513,106 行 / 3m4.0s / 19,089 行每秒 / seed 20261104 / 确定性指纹 4 张表 | 部分（内部 4 处不一致，§3 D-07） |
| E-13 | 五 | `tools/loadtest/bench.mjs` | 自研压测器（非 k6），支持 P50/P95/P99；存在且可用 | 已验证 |
| E-14 | 五 | `docs/evidence/loadtest/bench-result.json` | 13 场景 / 24,785 请求 / 412 错误（**1.66%**，全为 404）/ 20s / 并发 10；搜索 avg 41.98ms、节点 avg 67.97ms、leaderboard avg 1164.73ms | 部分（口径与错误率待明确） |
| E-15 | 五 | `drizzle/0002_v004_perf_indexes.sql` | 5 个 btree（thanks_reply_id / replies_author_alive / topics_author_alive / votes_topic_id / replies_topic_id）+ 2 个条件性 GIN + pg_trgm 容错 DO 块 | 已验证 |
| E-16 | 七 | `docs/SECURITY_EXCEPTIONS.md` E-10 | 三步 Bearer 协议；v0.0.1/v0.0.2/v0.0.3 匿名 token 重试全部 HTTP 200；结论「公开可拉取」 | **已验证** |
| E-17 | 九 | `docs/HISTORY_CLEANUP_DRILL_v0.0.4.md` | 1118→1083 对象（-35）、48 文件、清理后 master 24 提交、3 个 Tag；未触碰远端 | 部分（产物缺失，§3 D-11） |
| E-18 | 九 | `_backups/history-drill/clean-repo/`、`_backups/history-drill/REPORT.md` | **目录 `_backups/` 不存在，文件数 0** | **未验证** |
| E-19 | — | `RISK_REGISTER.md` | R-01 DEFERRED（待主人授权）；R-02 MITIGATED；R-04/R-05/R-12/R-13 MITIGATED；R-09 内容错置 | 部分（§3 D-09） |
| E-20 | — | `TEST_REPORT.md` | 单元 185/14；E2E 67；视觉 64 项 / 96.9% / 90.6%；「负载测试未执行」 | ✅ **已闭环（收尾轮）**：文首「状态覆盖声明」已列出 v0.0.4 权威值（单元 **190/15 文件**、E2E **154/11 文件**、升级脚本自检 62 项、视觉 68 条/40 有对照/28 无对照/严格口径 52/52、负载已执行），并新增「v0.0.4 单元测试」「v0.0.4 真实浏览器 E2E」「升级脚本自检」三个权威小节；下方 v0.0.3 历史快照数字**保留不改写**但已逐处标注（§3 D-12） |
| E-21 | — | `CHANGELOG.md` / `README.md` / `FEATURE_MATRIX.md` / `deploy/VERSION` / `package.json` / `RELEASE_GATE.md` | **全部停留 0.0.3 / v0.0.2 门禁；0 处 0.0.4** | **未验证**（版本一致性） |
| E-22 | — | `BUG_REGISTER.md` | v0.0.4 七个缺陷关键词仅 1 处命中（「假按钮」），其余 0 命中 | **未验证**（缺陷登记） |
| E-23 | — | `playwright.config.ts` | 单 project chromium / 1280×900 / workers=1 / retries=0 / fullyParallel=false | 已验证 |
| E-24 | — | `src/server/floor.ts` | `allocateFloor` 第 48–55 行已改 `SET last_floor = floor_counters.last_floor + 1`，注释标注「v0.0.4 修复楼层跳号」 | **已验证**（与 README 声明相反） |

---

## 3. 证据核查发现：数字矛盾与文档不一致

> 以下是本次只读核查的**具体**发现，按严重度排序。全部可在仓库内复算。

| ID | 严重度 | 位置 | 矛盾 / 缺口内容 | 对验收的影响 |
|----|--------|------|-----------------|--------------|
| **D-01** | ~~**阻断验收依据**~~ → ✅ **已闭环** | `docs/VISUAL_DIFF_SUMMARY_v0.0.4.md` §2/§3 vs `docs/evidence/visual/layout-measurements-*.json` | **已闭环**：提交 `8f1e214` 把汇总脚本入仓（`tools/visual/summarize-visual-diff.py`）并产出 `docs/evidence/visual/geometry-summary.json`（**三套口径机器可读**：严格 52/52、历史 64/84、v0.0.3 96.9% 全部可复算）；`docs/DELIVERY_PLAN_v0.0.4.md` 已标「✅ 已闭环，可用」 | ✅ **「Δx=0 100%」已可复核，可作放行依据** |
| **D-02** | **严重** | `package.json` L3、`deploy/VERSION`、`README.md` L25、`CHANGELOG.md` L11、`FEATURE_MATRIX.md` L12、`RELEASE_GATE.md` L1、`TEST_REPORT.md`、`BUG_REGISTER.md` | `version: "0.0.3"`、VERSION=`0.0.3`、README「当前版本：v0.0.3」（19 处）、CHANGELOG 最新段落 `[0.0.3]`、FEATURE_MATRIX「生成时间：v0.0.3 开发分支」；**八个载体全部 0 处 `0.0.4`**。`FEATURE_AUDIT` §5 的 P2「版本号一致性」仍标 ⬜ 待办，且只提 README/CHANGELOG/FEATURE_MATRIX，**遗漏 VERSION / package.json / RELEASE_GATE / TEST_REPORT** | ✅ **已闭环（非缺陷）** —— 权威载体清单以 `scripts/release/preflight.sh` 实际校验的 **5 个载体**为准：`package.json` / `deploy/VERSION` / `README.md` / `RELEASE_GATE.md` / `TEST_REPORT.md`（`preflight.sh` L147–148「版本载体（5 个，主理人裁决）」）。本清单**不再列举 8 个载体**，避免与 preflight 口径分叉。开发态刻意保持 `0.0.3`（R-20 裁决），`CHANGELOG.md [Unreleased]` L11–24 已明确记载裁决与理由；`preflight` 双模式 dev `FAIL=0` / release `FAIL=14`（两者 `BLOCK=1`） |
| **D-03** | **严重** | `RISK_REGISTER.md` R-09 | R-09「CSRF 首次访问的严格性」的「实测结论 / 修复提交 / 修复内容 / 关键约束 / 修复后实测 / 取舍 / 回归测试 / 状态」**整段与 R-08 逐字重复**，全是「x-forwarded-for 伪造 25 次注册 → 429、d1a9882、client-ip.ts」，与 CSRF 无关 | CSRF 首次访问风险**实际未被评估**，却标记为 MITIGATED；风险登记不可信 |
| **D-04** | **严重** | `scripts/loadtest/README.md` L544–546 vs `src/server/floor.ts` L48–55 | README 称「**截至本 README 最后更新时，这个缺陷尚未被修复**，`src/server/floor.ts` 里仍是 `greatest(...)+1`」，并建议「压测前先修掉它」；**源码已修复**：`allocateFloor` 改为计数表权威 + `last_floor + 1`，注释明确「v0.0.4 修复楼层跳号」。`ensureFloorCounter` 保留 `GREATEST(...)` 但语义是同步计数表（无 +1），不产生跳号 | 文档结论过期，会让验收误判存在未修复缺陷；README 的「压测前建议」已失效 |
| **D-05** | **一般** | `drizzle/0002_v004_perf_indexes.sql` L10–15、`scripts/loadtest/README.md` L595–600、`bench-result.json` | leaderboard 同一指标三个数值：SQL 注释/RREADME「241.98s → 0.74s → **0.46s**」、任务背景「242s → **0.4s**」、压测结果 `/api/leaderboard?limit=50` **p50 1233.75ms / p95 1530.11ms / avg 1164.73ms**（并发 10、20s）。未注明「单次查询 vs 并发压测 vs limit 差异」 | 性能达标值无法唯一确定；不能任选其一宣称达标 |
| **D-06** | **一般** | `docs/evidence/loadtest/bench-result.json` | 13 场景 24,785 请求中 **412 个错误（1.66%）**：「大型帖回复分页」104 个 404、「主题详情 API」308 个 404，errorSamples 全为 `404 /t/{id}` / `404 /api/topics/{id}`（随机 id 越界 / 软删除主题），**无 5xx**。文档未说明这属于压测数据构造而非应用缺陷 | 「错误率 0」不能据此宣称；需在通过标准明确排除口径 |
| **D-07** | **一般** | `scripts/loadtest/README.md` | ① L151「完整规模实跑输出」表 `nodes 1000 目标 **10** 100%`（完整规模目标应为 1000，误用冒烟值）；② L343–355「中断安全」文案说「生成**完整规模**数据集过程中 kill -9」，实测却是 `topics 1000 / replies 5000 / users 100`（冒烟规模）；③ L641 `k6 run scripts/loadtest/k6.js` —— **k6.js 不存在**，实际执行器是 `tools/loadtest/bench.mjs`（自研，README 自身 L3/L632 却写「供 k6」「与 k6 配合」） | 压测文档内部自相矛盾；复现指引指向不存在的脚本 |
| **D-08** | **一般** | `e2e/v004-*.spec.ts`、任务背景「144 条」 | 静态 `test(` 声明：新增 4 文件 **36 条**（20/4/10/2）；运行时展开：`v004-api-contract` 13 端点循环 → 17 条、`v004-endpoint-smoke` 自动发现 **29 个 GET 路由** → 31 条，合计约 **78 条**，全量约 **145 条**；「新增 77 / 总计 144」与静态 36 不符、与推算 78 差 1。仓库中**无 `playwright test --list` 输出**，且展开数随源码 GET 路由数浮动 | 用例数口径未定义，验收数字不可固定 |
| **D-09** | **一般** | `RISK_REGISTER.md` | ① 表头「本轮：…（**v0.0.2**）」过时；② R-01 v0.0.4 演练段「引用原站素材的提交 **2 → 0**」 vs `HISTORY_CLEANUP_DRILL_v0.0.4.md` 基线「含原站素材的提交数 **0**」（清理前）；③ 原站 HTML 文件数四个数字并存：R-01 **46**、R-03 **47**、演练报告 **48**（合计，含 2 assets）、当前工作区实测 **47 HTML + 2 assets = 49**、E-04 称「45 个受版本控制文件」；④ R-02 缓解仍写「verify-release job 内含**匿名 docker pull** 实测，失败即发布失败」，与 E-10 已明确的 v0.0.4 修正（带凭据拉取为成败判据、匿名仅提示）冲突；⑤ R-14「负载测试未执行」与第五阶段压测证据冲突；⑥ 无 v0.0.4 新增风险条目（R-16+） | ✅ **收尾轮已闭环**：① 表头已更新为 v0.0.4；② 已在 R-01 下补「收尾轮只读复核」段，写明「2 → 0」是**清理后**的提交数、清理前为 0；③ 已在 R-01 演练段标注 48 = 46 HTML + 2 assets 的口径；④ R-02 缓解已按 E-10 改写；⑤ R-14 已补 v0.0.4 压测结论；⑥ 已补 **R-16 ~ R-27** 共 12 条 v0.0.4 风险条目（收尾轮已同步状态：**R-18** 已修并验证、**R-22** 已定案、**R-16 / R-17** 已闭环（run `41871503684` 九项全绿）、**R-21 / R-24** 已修（`ed385cf`）、**R-26** 已修并经 CI 复验、新增 **R-25 / R-27**） |
| **D-10** | **一般** | `CHANGELOG.md`、`BUG_REGISTER.md` | v0.0.4 七个已修缺陷中，`api/nodes`、`topics/[id]`、跳号、绕开账本、`/hot` 在两文件里 **0 命中**，仅「假按钮」1 处；CHANGELOG 无 0.0.4 段落 | 缺陷分级与验证方式缺文档依据（本清单 §5 依据源码/E2E/阶段文档补全并标注） |
| **D-11** | **一般** | `docs/HISTORY_CLEANUP_DRILL_v0.0.4.md` §产物位置 vs 工作区 | 报告称产物在 `_backups/history-drill/clean-repo/` 与 `REPORT.md`；实测 **`_backups/` 目录不存在、文件数 0**，`.gitignore` 亦无对应规则。`RISK_REGISTER` R-01 引用的「清理后副本 298 文件差异 0 行」「`npx tsc --noEmit` 零错误」「3 个 Tag SHA 变化」在演练报告里**均未见** | 隔离演练结论目前只有文档陈述，**无可复核产物**；应说明产物已清理或移到仓库外 |
| **D-12** | **一般** | `TEST_REPORT.md` | L64「E2E **67 passed**」（v0.0.3 CI run 41754998422）、L128–132 视觉三视口 64/96.9%/90.6%、L150「基础负载测试（k6 等）**⚠️ 未执行**」—— 与 v0.0.4 的 **154 条 E2E**、4 视口汇总、压测证据直接冲突 | ✅ **收尾轮已闭环**：`TEST_REPORT.md` 文首已加「状态覆盖声明」列出 v0.0.4 权威值（单元 190/15 文件、E2E 154/11 文件、升级脚本自检 62 项、视觉 68 条/40 有对照/28 无对照、负载已执行），并新增三个 v0.0.4 权威小节；v0.0.3 历史数字保留不改写但逐处标注 |
| **D-13** | **一般** | `RELEASE_GATE.md` | 标题「**v0.0.2** 发布门槛检查单」、目标版本 v0.0.2；B3 门槛「≥103 单元」、B4「≥67 E2E」，C/D 节全是 v0.0.2 的 CI run；8 处 v0.0.3、0 处 0.0.4。任务 #3「重新设计版本发布流程」仍 pending | ✅ **收尾轮已部分闭环**：文件顶部新增「§0 v0.0.4 门禁速览」并加状态覆盖声明，v0.0.4 判据不再依赖旧阈值；历史表保留作为版本演进记录 |
| **D-14** | 轻微 | `FEATURE_AUDIT_v0.0.4.md` | §2.1 称「本轮对 **20 + 36 = 56 项**行为做了真实 HTTP + 数据库双重验证」，而逐项明细表是 **53 项**；§三 #49 标题「**22 个前端页面**」但证据写「实际路由 **21 个**」，§4.2 也写 21；`VISUAL_DIFF_SUMMARY` 用「17 页面」口径（10 对比 + 7 需登录/无对照） | 口径差异（非硬矛盾），建议注明「行为数 / 功能项数」「路由数 / 对比页面数」定义 |
| **D-15** | 轻微 | `VISUAL_DIFF_SUMMARY_v0.0.4.md` §2 表头 | 「对比数 10」与「几何 Δx=0 52/52」并列于同一行，52 是测量锚点数而非对比数，易误读为「10 个对比里有 52 个元素」 | 建议几何与像素分表呈现 |
| **D-16** | 轻微 | 工作区状态 | `git status --short` = ` M vitest.config.ts`（主理人并行复验中的未提交变更）。HEAD `89d6b4e` 与工作区不完全一致 | ✅ **收尾轮已闭环**：`vitest.config.ts` 已提交；以最终提交态复验 **194/194 + E2E 154 条 / 11 文件**（✅ 当前权威实测 154 passed / 0 failed / 0 skipped（3.9m）；本地历史轮次口径 153/153，基于 153 条口径、早于 `ed385cf`），且 `numPendingTests: 0`（无静默跳过） |

**核查通过、确认自洽的部分**（避免只报问题）：`visual-diff-multi.json` 的 68 条 = 4 × (10 compared + 7 incomplete) 与汇总完全一致；`docs/SECURITY_EXCEPTIONS.md` E-10 改写完整且给出三步 Bearer 实测；`drizzle/0002_v004_perf_indexes.sql` 索引名与 README L596–598 列项一致；`src/server/floor.ts` 修复实现正确；`playwright.config.ts` 单 project 配置清晰；`bench-result.json` 的 generatedAt `2026-11-04T08:32:29Z`（本地 16:32）**晚于** `0002_v004_perf_indexes.sql` 的本地 mtime 16:22，时序上不存在「压测早于索引迁移」的问题（此项已按时区换算复核，勿误报）。

---

## 4. 四种身份的用户验收核查（UI 层 vs API 层）

> **判定原则**：只有 `page.goto` + `locator` 点击/可见性/文本断言才算「真实浏览器 UI 层」；`page.request.*` / `apiPost()` 的 401/403 断言属于 **API 层**，不得冒充 UI 验收。
> `e2e/helpers.ts` 已定义 `ADMIN` / `USER_A` / `USER_B` / `MODERATOR` 四个账号，`login()` 走真实登录表单（UI），但后续断言大量走 API。

### 4.1 四身份覆盖矩阵

| 身份 | 覆盖用例（文件:行） | 层级 | 结论 |
|------|---------------------|------|------|
| **游客 / 未登录** | `auth.spec.ts:57`（退出后恢复游客态）、`auth.spec.ts:66`（受保护页跳转登录页）、`v004-content-interaction.spec.ts:93`（看不到投票按钮）、`feature.spec.ts:63`（收藏 401）、`security.spec.ts:114 / :132`（写操作 401/403）、`topic.spec.ts:69`（回复 401）、`v004-account-admin.spec.ts:180`（通知 401） | **UI 3 条**（退出态/跳转/按钮不可见）+ **API 6 条以上** | 「游客不可写」**主要由 API 401/403 支撑**；UI 层只验证了「按钮不渲染」与「页面跳转」 |
| **普通注册用户** | 全量大范围覆盖：注册/登录/发帖/回复/投票/感谢/编辑/软删除/签到/积分/排行榜/关注/通知/资料/头像/节点申请/Feed/搜索；含 `createTopicViaUi` / `submitReplyViaUi` / 编辑模态框 / 签到按钮等**真实点击流** | **UI 充分** + API | 四身份中覆盖最完整 |
| **版主 moderator** | `feature.spec.ts:148`（版主创建节点 → `pending`）、`feature.spec.ts:157`（非管理员不能审核节点 → 403）。**全仓库 `MODERATOR` 仅此 2 处** | **UI 登录 + API 断言，2 条** | **几乎空白**：无一条以版主身份执行节点/主题管理操作；v004 新增 4 文件完全未使用 MODERATOR |
| **管理员 admin** | `auth.spec.ts:89`（`/admin` 显示「概览」）、`feature.spec.ts:136`（创建节点后 `/go/{name}` UI 验证）、`v004-account-admin.spec.ts:338`（`/admin` 含「管理\|后台\|概览\|用户」）、`:315`（4 端点 403/200）、`:344`（封禁/解封）、`:387`（角色变更 / 禁止自我降级）、`:408`（配置脱敏）、`:432`（节点申请审批）、`:474`（普通用户不能审核）、`v004-content-interaction.spec.ts:223`（恢复主题）、`:298`（锁定/置顶） | **后台 UI 仅 2 条，且都只是文本存在性断言**；封禁/恢复/配置/角色/审批 **全部 API 层** | 功能路径覆盖广，但**后台 UI 点击流为零** |

### 4.2 逐身份缺口（任务书特别关注项）

| 关注点 | 现状 | 缺口 |
|--------|------|------|
| **游客不可写的拒绝** | API 层 401/403 覆盖充分（`security.spec.ts:114` 遍历多个写端点） | **没有任何 UI 用例验证游客在浏览器里尝试写操作的反馈**：访问 `/go/new` 是否被重定向、游客在主题页提交回复是否给出提示、收藏/投票按钮点击后的引导。目前只有「按钮不渲染」，无法证明「绕过 UI 直接访问写入口」时前端行为正确 |
| **普通用户不能访问后台** | `auth.spec.ts:89` 是**唯一 UI 层证据**（`page.goto('/admin')` → `toHaveURL('/')`）；其余 403 全为 API 层（`v004-account-admin:315/:474`、`v004-content-interaction:276`、`feature.spec.ts:130`） | 后台入口在普通用户导航栏中**是否隐藏、是否可点击、点击后提示**未验证；UI 层仅 1 条，建议至少补「导航不可见 + 直达重定向 + 无管理操作按钮」三条 |
| **版主的节点/主题管理权限** | 仅「版主创建节点需审核」「版主不能审核节点」两条 API 断言 | **锁定 / 置顶 / 恢复 / 软删除 / 编辑他人内容 / 举报处理 / 节点审批** 全部无覆盖。`CHANGELOG.md` L41 与 `FEATURE_AUDIT` #12/#13 明确这些操作是「仅 moderator/admin」，但 E2E 从未以 moderator 身份执行一次。无法确认版主权限边界与 admin 的区别 |
| **管理员的封禁/恢复/配置权限** | 封禁解封（`:344`）、角色变更（`:387`）、配置脱敏（`:408`）、恢复（`:223`）、锁定置顶（`:298`）**全部是 `page.request.*` API 断言**；`/admin` 页只有 `:338` 一条文本包含断言 | **在 `/admin` 页面真实点击「封禁」「解封」「改角色」「查看配置」的浏览器流程零覆盖**。任务书要求「真实浏览器验收」，当前这部分结论不能算 UI 验收通过 |

### 4.3 结构性缺口

- `playwright.config.ts` **只有 1 个 project**（`chromium`，1280×900，`devices['Desktop Chrome']`）。四视口证据来自 `tools/visual/` 的**截图对比**，不是交互 E2E → 移动端/平板下的登录、发帖、后台操作无任何浏览器验证。
- 新增 4 个 E2E 文件中，**2 个是纯 API 层**（`v004-api-contract.spec.ts`、`v004-endpoint-smoke.spec.ts` 的 `page.goto` 均为 0）。它们对「端点不 5xx」很有价值，但**不得计入真实浏览器 UI 验收的覆盖数**。
- `v004-endpoint-smoke.spec.ts` 的用例数由源码自动发现决定（当前 29 个 GET 路由），随代码变化浮动，不适合作为固定验收数字。
- 数据自给自足做得好（每个用例注册独立用户、独立 context 避免 cookie 共享），但**版主账号未纳入 v004 任何用例**，是明显的资源浪费。

---

## 5. 缺陷分级与验证方式（v0.0.4 已修复缺陷）

### 5.1 分级标准（绑定修复时限）

| 级别 | 定义 | 修复时限 | 放行影响 |
|------|------|---------|---------|
| **阻断** | 生产构建下核心端点必然 5xx / 数据损坏 / 未授权访问 | **立即**，不得进入任何发布阶段 | No-Go |
| **严重** | 核心功能不可用或行为错误，但系统可运行 | 进入 Draft 前 | No-Go（Draft 前必须闭环） |
| **一般** | 局部功能/一致性问题，有绕行或影响面有限 | 正式 Release 前 | 可随 Draft，须在 Release Notes 披露 |
| **轻微** | 文档、输出格式、体验问题 | 下个版本 | 不影响放行 |

> 注：`CHANGELOG.md` / `BUG_REGISTER.md` **未登记以下缺陷**（§3 D-10），本表依据源码、E2E 用例与阶段文档重建，并标注回归充分性。

### 5.2 v0.0.4 已修复缺陷逐项

| # | 缺陷 | 级别 | 验证方式（证据） | 回归充分性 |
|---|------|------|------------------|-----------|
| B-01 | `GET /api/nodes` 生产构建必然 500（原生 SQL 起表别名 `FROM nodes n`，WHERE 仍用 `"nodes"."status"` → PG 42P01） | **阻断** | `e2e/v004-api-contract.spec.ts` 13 个公开端点冒烟（含 4 个 nodes 变体）+ `e2e/v004-endpoint-smoke.spec.ts` 全 GET 不 5xx；`FEATURE_AUDIT` #33 | 充分 |
| B-02 | `GET /api/topics/[id]` 500（条件片段写成普通字符串被 drizzle 当参数绑定 → PG 42601） | **阻断** | `v004-api-contract.spec.ts` `/api/topics/3`；`v004-endpoint-smoke` 自动发现；`bench-result.json` 主题详情 API 4810 请求无 5xx | 充分 |
| B-03 | 分页失效（`limit`/`offset` 未从路由透传到服务层） | **严重** | `v004-api-contract.spec.ts:94`「分页参数生效」（两页无重叠 + offset 越界返回空）、`:120` limit 钳制；`e2e/pagination.spec.ts` 6 条 | 充分 |
| B-04 | 编辑按钮「假按钮」（点击无反应） | **严重** | `v004-content-interaction.spec.ts:187` 完整 UI 链路：点击「编辑主题」→ 模态框 textarea 可见 → 填值 → 保存 → 页面展示 → 刷新仍正确 | **充分（真实 UI）** |
| B-05 | 回复楼层跳号（`allocateFloor` 的 `GREATEST(..., EXCLUDED.last_floor) + 1`） | **严重** | `src/server/floor.ts:48–55` 已改为 `SET last_floor = floor_counters.last_floor + 1`，注释标注 v0.0.4 修复；`v004-content-interaction.spec.ts:339` 8 并发楼层唯一；`topic.spec.ts:108` | ⚠️ **不充分**：现有用例只断言「唯一/递增」，而 `scripts/loadtest/README.md` L522 明确指出「跳号恰好也满足递增」正是漏检根因。**必须补「连续 1..n」断言** |
| B-06 | 注册赠送积分绕开账本（`credit_ledger` 不自洽） | **一般** | `FEATURE_AUDIT` #25「余额 1002，credit_ledger 自洽」、#91 账本只 INSERT；`tests/credits-concurrency.spec.ts` | **部分**：v004 E2E 无专门的「注册余额 ↔ 账本流水」正反向断言 |
| B-07 | `/hot` 页面缺失 | **一般** | `visual-diff-multi.json` 4 视口均有 `hot` 条目（`localStatus: ok`，`referenceStatus: no-auth-reference`）；`bench-result.json`「热门排序」230 请求 0 错误；截图 `local-hot.png` 齐备 | 充分（页面存在），但无原站对照（已如实标注） |
| B-08 | 积分排行榜慢查询（`leaderboard()` 相关子查询 N+1，241.98s 不可用） | **严重** | `drizzle/0002_v004_perf_indexes.sql`（5 索引 + pg_trgm）；`src/lib/credit-service.ts` 改「三个独立聚合 + JOIN」；SQL 注释与 README 记 0.74s / 0.46s | **部分**：性能数字口径未统一（§3 D-05），压测库是否已应用迁移无日志 |

**已修复缺陷的文档登记缺口**：以上 8 项（含任务背景 7 项 + 慢查询）在 `CHANGELOG.md` 无 v0.0.4 段落、`BUG_REGISTER.md` 仅 1 处关键词命中。放行前需补齐，否则「缺陷分级」无正式依据。

---

## 6. 遗留阻断项

### 6.1 必须主人单独授权才能推进（本轮一律不执行）

| 项 | 依据 | 状态 |
|----|------|------|
| 改写全部远端 refs 历史（`git filter-branch` + `git push --force --mirror`） | `RISK_REGISTER.md` R-01；`docs/HISTORY_CLEANUP_DRILL_v0.0.4.md` §「若要真正执行」 | **DEFERRED** |
| 重建 / 移动 / 删除 `v0.0.1` `v0.0.2` `v0.0.3` Tag | R-01（v0.0.1 tag 使 A 类对象可达数 44→45）、R-11 CONFLICT | **DEFERRED** |
| 修改已发布 Release / 改仓库可见性 | 第九阶段明令；HISTORY_CLEANUP_DRILL 声明未触碰 | **禁止** |
| `gh cache delete` 清理 Actions 缓存 | R-03 / E-04（远端写操作） | **待授权** |
| 删除仓库重建（R-01 方案 C 之外的兜底） | R-01 | **待授权** |

> 第九阶段结论已明确：**仓库保持 Public，禁止未经授权的远端历史改写 / force push / 删 Tag / 改 Release**。本清单不把 R-01 的未解决作为 Draft 的 No-Go 条件 —— 它是**带授权边界的遗留项**，须在 Draft Release Notes 显著披露，E-02 到期日 2026-12-04 前由主人裁决。

### 6.2 仍无法验证（环境/证据限制，Draft 需作为已知限制披露）

| 项 | 原因 | 证据 |
|----|------|------|
| Docker 容器真实运行、最终镜像字节数、容器内 `USER nextjs` 实测 | ~~本机无 Docker~~ → ✅ **已闭环**：run `41871503684`（SHA `2773cd1`）`docker-verify` 九项 completed/success，含镜像构建、镜像内容与权限（6 个子断言）、容器资源观察 | `SECURITY_EXCEPTIONS.md` E-05；`docs/evidence/ci/docker-verify-v0.0.4.md` |
| Redis 故障恢复 / 缓存失效 / 内存观测 | ~~压测环境未配 Redis~~ → ✅ **已闭环**：同 run 九项全绿，含 `[R-17a]` Redis 中断与恢复、`[R-17b]` PG 中断与恢复、`[R-17c]` 缓存失效与内存观测 | `docs/evidence/ci/docker-verify-v0.0.4.md`；`RISK_REGISTER` R-16 / R-17 |
| PostgreSQL 故障恢复、备份实际还原、v0.0.3→v0.0.4 原地升级 | ✅ **已实跑通过（隔离库）**：§10.10.1 复核 —— PG 故障恢复/备份还原、原地升级均已实跑通过（隔离库 `v2ex_upg_v004_*`） | `docs/UPGRADE_RECOVERY_v0.0.4.md` §3 / §5 |
| 容器 CPU / 内存指标 | ~~无 Docker~~ → ✅ **已闭环**：run `41871503684` `[8/9] 容器资源观察`（三容器 CPU%/MEM/MEM% + 连续 5 次采样 + 镜像体积 + `VmRSS`/`VmHWM`） | `docs/evidence/ci/docker-verify-v0.0.4.md` |
| 真实 SMTP 邮件投递 | 未配置 SMTP | E-06；`FEATURE_AUDIT` #6 ⚠️ PARTIAL |
| 多浏览器视觉回归（Firefox / Safari） | 本机仅 Chromium / Edge | `TEST_REPORT.md` L149 |
| 压测库是否已应用 `0002_v004_perf_indexes.sql` | ~~无迁移执行日志，README 仅「建议确认」~~ → ✅ **已闭环**：只读 SELECT 取证 —— 7 个 `0002` 索引全在、`pg_trgm 1.6`、`drizzle.__drizzle_migrations` = 3 行 | `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md` §10.10.2 |
| Git 历史清理演练产物 | `_backups/` 不存在 | §3 D-11 |
| 原站需登录 7 页 × 4 视口 = 28 条对照 | 无权访问他人账号，不拿游客态冒充 | `VISUAL_DIFF_SUMMARY_v0.0.4.md` §5（`no-auth-reference` / `no-origin-equivalent`）—— **这是合规的如实标注，不计为缺陷** |
| 四身份中版主 / 管理员后台的真实浏览器点击流 | 用例缺失（非环境限制） | §4 |

---

## 7. 缺口清单

### 7.1 四身份覆盖缺口（汇总）
1. **版主 moderator**：无节点/主题管理权限（锁定/置顶/恢复/软删除/审批/举报）任何用例；`MODERATOR` 仅 2 处使用且均为 API 断言。
2. **管理员 admin**：封禁/解封/角色变更/系统配置/节点审批全部是 API 层；`/admin` 页面只有 2 条文本存在性断言，**零后台 UI 点击流**。
3. **游客**：写操作拒绝主要靠 API 401/403；UI 层缺「访问写入口 / 提交表单 / 点击后引导」的拒绝反馈验证。
4. **普通用户**：不能访问后台仅 1 条 UI 层证据（`auth.spec.ts:89`）；后台入口隐藏与操作按钮不可见未验证。
5. **视口/浏览器**：单 project 1280×900，无移动端/平板交互 E2E；4 视口仅截图对比。
6. **楼层连续性**：✅ **已闭环**（v0.0.4 新增 `tests/floor-continuity.spec.ts` 5 条严格 `1..n` 断言，CI 实跑通过）。**剩余缺口**：100 并发真实压测未做（v0.0.5 补）。

### 7.2 无法实跑的项目
见 §6.2：Docker 容器、Redis 故障恢复、PG 故障恢复与备份还原、原地升级、真实 SMTP、多浏览器、容器 CPU/内存、压测库迁移状态确认。

### 7.3 文档 / 证据缺口
- 版本载体未同步（D-02，已闭环：权威清单以 `preflight.sh` 的 5 载体为准）；`CHANGELOG`/`BUG_REGISTER` 未登记 8 个已修缺陷（D-10）
- ~~几何量测「52 条」无原始证据文件（D-01）~~ → ✅ **已闭环**（`8f1e214` 脚本入仓 + `geometry-summary.json` 三套口径机器可读）；`TEST_REPORT` / `FEATURE_AUDIT` 各用一套数字（D-14）
- ~~`playwright test --list` 输出缺失，144 条口径未固定（D-08）~~ → ✅ **已闭环**：清单已入仓，权威口径 **154 条 / 11 文件**
- `_backups/history-drill/` 演练产物缺失（D-11）
- `RISK_REGISTER` R-09 错置、R-02 与 E-10 冲突、R-14 过时（D-09）
- `RELEASE_GATE.md` 仍是 v0.0.2 门禁（D-13）；`TEST_REPORT.md` 未更新（D-12）
- `scripts/loadtest/README.md` 4 处内部矛盾 + k6.js 路径不存在（D-07）
- 自动化视觉回归未纳入 CI（`FEATURE_AUDIT` #53 ⚠️ PARTIAL）

---

## 8. 灰度期观测与回滚判定

> 适用条件：仅在 v0.0.4 由 Draft 转为公开分发 / 部署后启用。Draft 本身不对外分发，以下为放行后的观测基线。

| 观测项 | 正常范围（依据现有证据） | 回滚触发条件 |
|--------|-------------------------|-------------|
| 端点 5xx 率 | 0（压测 24,785 请求无 5xx；404 属数据构造） | 任一核心端点出现 5xx，或 `/api/nodes` `/api/topics/[id]` 复现 500 |
| 搜索 API 延迟 | avg ≈ 42ms / p95 ≈ 50ms（压测） | p95 持续 > 500ms 且排除索引未应用 |
| 节点列表 API 延迟 | avg ≈ 68ms / p95 ≈ 82ms | p95 持续 > 500ms |
| 排行榜 API 延迟 | 需先统一口径（0.46s / 0.4s / 压测 1.16s） | p95 > 3s 或退回 241.98s 量级 → 立即回滚并核查 `0002` 迁移 |
| 写路径错误率 | 0（排除 4xx 业务拒绝与压测随机 404） | 并发发帖/回复出现 500 或重复楼层号 |
| 楼层号连续性 | 严格 1..n（B-05 回归用例补齐后） | 出现跳号或重复 → 回滚 `floor.ts` 相关变更 |
| 积分账本自洽 | `balance_before + amount = balance_after` 违例 0、孤儿流水 0 | 出现任一违例 |
| 鉴权边界 | 游客写 401、普通用户后台 403/重定向、配置凭据脱敏 | 出现游客可写、普通用户可读后台、或配置返回明文口令 |
| 会话与封禁 | 封禁后会话失效、解封后恢复 | 封禁用户仍可发帖 |
| 镜像可拉取性 | 完整 Bearer 流程匿名 HTTP 200（E-10） | 带凭据拉取失败即判定镜像未推送 |
| 远端状态 | 仓库 Public、Tag/Release/Draft 未变动 | 出现任何未经授权的历史改写 / Tag 删除 / Release 变更 → 立即停止并上报主人 |

---

## 9. 风险与结论

### 9.1 风险登记（本次核查新增视角）

| 风险 | 等级 | 说明 |
|------|------|------|
| ~~以不可复核的几何数字（52/100%/92.3%）作为放行依据~~ | — | ✅ **已闭环**（D-01）：`8f1e214` 脚本入仓 + `geometry-summary.json` 三套口径机器可读，「不得作为放行依据」的限制解除 |
| API 层断言被当作四身份 UI 验收通过 | 高 | §4；任务书明确禁止冒充。⚠️ **R-21 / R-24 已由 `ed385cf` 修复**（真实 UI 点击流已补齐），但**待主理人终验确认** |
| 版本载体与交付物不符 | 高 | D-02；✅ **已闭环**（权威清单以 `preflight.sh` 的 5 载体为准；开发态保持 0.0.3 系 R-20 裁决，非缺陷） |
| 楼层跳号回归用例仍不覆盖根因 | 中 | B-05；同类缺陷可再次逃逸 |
| 压测性能/错误率口径未定义 | 中 | D-05 / D-06；达标值可任意选取 |
| R-09 内容错置导致 CSRF 风险未被评估 | 中 | D-03 |
| 演练产物缺失使「清理不损坏项目」结论不可复核 | 中 | D-11；但该操作本身已被禁止执行，风险可控 |
| R-01 原站版权素材经历史持续暴露 | 高（已知） | R-01 DEFERRED，需主人授权；E-02 到期 2026-12-04 |

### 9.2 对 Draft Release 的明确判断

> **判断：有条件可以进入 Draft Release 阶段。**
>
> ✅ **已进入并交付（2026-11-05，第 10 轮）**：发布流水线 run `41991745413`
> （SHA `f5e1dd4`）**11/11 job 全绿**，Draft Release **id `434929894`** 已创建
> （`draft=true` / `prerelease=true` / author `github-actions[bot]`），
> 资产 `v2ex-clone-v0.0.4-deploy.zip`（52,049 bytes）+ `SHA256SUMS`（95 bytes）
> 齐全，下载实算 SHA256 **与 `SHA256SUMS` 逐字匹配**；
> GHCR 镜像 `ghcr.io/alicia1030su/v2ex-clone:v0.0.4` 已推送并拉取成功。
> Tag `v0.0.4` 为 annotated tag（`aed641d` → `c0e7396`），**未移动**。
>
> ✅ **已正式发布（Pre-release）**（2026-11-05，主人授权）—— R-01 已在 Release Notes 显著披露，E-02 到期日 2026-12-04 前由主人裁决。

> 依据：功能与安全性条件已满足（**190 单元 / 154 E2E**（分母口径）、7 个真实缺陷已修、四视口视觉证据齐备且跳过项如实标注、大规模压测与幂等索引齐备、E-10 已复核、Git 历史仅做隔离演练未触碰远端），且所有未闭环项均**不触及禁止操作红线**。Draft 是可编辑、不对外宣称完成的状态，允许携带 §6 的授权遗留项与 §7 的已知限制。
>
> 明确的边界：**本判断不等于「可以正式发布」**。正式 Release 需另行满足版本载体同步、§6.2 无法验证项完成或经主人书面接受、§4 四身份 UI 缺口补齐、**R-27 / V4-20（节点申请 UI 提交链断裂，CI 唯一红灯）已闭环并经 CI 复验确认**（本地已实测全绿，**CI 亦已复验通过** —— run `41949555282`，SHA `bddb3d0`）、R-01 获主人裁决。

### 9.3 进入 Draft 的前置条件（按优先级）

| # | 前置条件 | 责任方 | 截止 |
|---|----------|--------|------|
| **P1** | ✅ **已完成**：主理人完成 **190 / 154** 复验并提交 `vitest.config.ts`；以最终提交态固定全绿结论 | team-lead | Draft 前 |
| **P2** | 版本载体同步：CHANGELOG 增补 v0.0.4 段落并登记 8 个已修缺陷；README / FEATURE_MATRIX / RELEASE_GATE / TEST_REPORT 更新当前版本；`deploy/VERSION` + `package.json` 升到 `0.0.4`。**若有意在 Draft 阶段保留 0.0.3，则必须在 Draft Notes 显式记录该决策与责任人**（不能默默带过） | team-lead / devops-engineer | Draft 前 |
| **P3** | ✅ **已完成**：几何量测闭环 —— `8f1e214` 把汇总脚本入仓（`tools/visual/summarize-visual-diff.py`）+ 机器证据 `docs/evidence/visual/geometry-summary.json`（三套口径全部可复算）；`docs/DELIVERY_PLAN_v0.0.4.md` 已标「✅ 已闭环，可用」 | 第三阶段负责人 / team-lead | 已闭环 |
| **P4** | ✅ **已完成**：产出 `playwright test --list` 输出（权威口径 **154 条 / 11 文件**，`Total: 154 tests in 11 files`）；补一条「楼层连续 1..n」断言（`tests/floor-continuity.spec.ts` 5 条） | team-lead | 已闭环 |
| **P5** | 文档纠错：`scripts/loadtest/README.md`（楼层已修 / nodes 目标 1000 / 中断安全规模 / k6→bench.mjs）、`RISK_REGISTER.md`（R-09 错置 / R-01 与 R-03 文件数 / R-02 与 E-10 / R-14 过时）、`TEST_REPORT.md`、`BUG_REGISTER.md` | 各阶段负责人 | Draft Notes 前或显式登记 |
| **P6** | 压测口径说明：leaderboard 三个数值的测量条件、412 个 404 的排除口径、压测库是否已应用 `0002` 迁移 | 第五阶段负责人 | Draft Notes 前 |
| **P7** | Draft Release Notes 逐条披露 §6（授权遗留项 + 无法验证项）与 §7（四身份缺口 / 无法实跑项 / 文档证据缺口），并写明「仓库保持 Public、未执行任何远端历史改写」 | team-lead | Draft 创建时 |
| **P8** | 说明 `_backups/history-drill/` 产物去向；补齐 R-01 引用的 `tsc --noEmit` / 298 文件比对证据，或删除该引用 | 第九阶段负责人 | 可随 Draft，须登记 |

### 9.4 待确认事项（需主人 / 主理人答复）

1. 版本号是在进入 Draft 时升到 `0.0.4`，还是有意推迟到正式发布？（决定 P2 的执行方式）
2. ~~「52 条几何测量」的原始证据是否存在于仓库外？若不存在，以 84 行口径修订汇总是否可接受？~~ → ✅ **已闭环**：`8f1e214` 把汇总脚本入仓（`tools/visual/summarize-visual-diff.py`）并产出 `docs/evidence/visual/geometry-summary.json`（三套口径全部可复算）；`docs/DELIVERY_PLAN_v0.0.4.md` 已标「✅ 已闭环，可用」
3. ~~144 条 E2E 是否以某次 `playwright test --list` 输出为准？~~ → ✅ **已定案**：以 `--list` 运行时展开为权威口径，当前为 **154 条 / 11 文件**（`Total: 154 tests in 11 files`）；⚠️ **允许用例数随源码自动发现浮动**（`v004-endpoint-smoke.spec.ts` 随 GET 路由数变动）⇒ **正式发布前须重新 `--list` 固定一次**
4. 四身份 UI 缺口（尤其版主与后台点击流）是补测后再发 Draft，还是作为 Draft 已知限制披露、正式发布前补齐？
5. 压测性能达标值采用哪一口径（单次查询 0.46s / 并发压测 p95 1.53s）？错误率是否排除数据构造类 404？
6. R-01 / E-02 的授权裁决时间表（E-02 到期日 2026-12-04）。

---

## 附：本次核查的边界声明

- 只新增本文件；未修改 `src/**`、`tests/**`、`e2e/**`、任何现有 `.md` / `.yml` / `.json`、`package.json`、`vitest.config.ts`。
- 未执行 git commit / push / 建删 Tag / 改 Release / 写数据库 / 删除文件。
- 未运行 `npx vitest run` 或 `npx playwright test`；**190 / 154** 全绿结论来自主理人复验与本清单引用的既有证据（收尾轮已在 `TEST_REPORT.md` 落为权威口径），最终以主理人提交态为准。
- 所有数字均由只读打开原始文件复算得出；几何测量与压测聚合通过一次性 `node -e` 只读脚本统计，未产生任何文件写入。

> **注**：以上「附」的四条边界声明仅适用于**第一轮只读核查**。第二轮按要求实跑了
> `npx tsc --noEmit` / `npx vitest run tests/floor-continuity.spec.ts` / `npx playwright test e2e/v004-four-roles-ui.spec.ts`，
> 其命令、真实输出与边界见 §10.3 与 §10.8。

---

## 10. 第二轮闭环（四身份 UI 验收 + 楼层连续性，2026-11-04）

> 本章节在 team-lead 裁决后追加。**D-01 / D-11 的状态以本章节 §10.1 为准**，
> 前文 §0、§2（E-02 / E-17）、§3（D-01 / D-11 两行）、§7.3、§9.1 中的旧表述视为已修订；
> 原始核查记录保留不改，以保持可追溯性。

### 10.1 主理人裁决与状态修订

| ID | 第一轮结论 | 裁决 / 本轮只读复核 | **修订后状态** |
|----|-----------|---------------------|---------------|
| **D-01** | 「52 分母在 `docs/evidence/visual/` 下找不到原始证据，不得作为放行依据」 | 主理人已把汇总脚本 `tools/visual/summarize-visual-diff.py` 与产物 `docs/evidence/visual/geometry-summary.json` 入仓。实测该文件明确写出：每视口 **84 行 = 52 可比 + 18 两侧都无元素 + 12 只有滚动尺寸 + 2 单侧缺失**；`strict` 口径计入 52、跳过 32，Δx=0 **52/52 (100%)**、Δw=0 **48/52 (92.31%)**；`loose` 口径 84 行、Δx=0 **64/84 (76.19%)** —— **正是第一轮复算得到的 64**，两套口径完全自洽；`legacy` 的 96.9% / 90.6% 来自 2026-11-02 的 `layout-measurements.json`，仅作历史基线 | ✅ **已闭环**：52 是有效锚点数（非页面数），证据链已入仓；「不得作为放行依据」的限制解除。第一轮报警的价值在于促成了口径文档化 |
| **D-11** | 「`_backups/` 不存在，演练产物不可复核」 | 产物在**仓库外** `C:/Users/TYMO001/WorkBuddy/ai/_backups/history-drill/`，本轮只读核实：`REPORT.md`(2710 B) + `clean-repo/` + `build-test/` + `work/` 全部存在；仓库内 `_backups/` 确实不存在（第一轮只查了仓库内路径） | ✅ **误报已澄清 · 已验证**。报告中的产物路径由 team-lead 补注 |
| **D-02** | 版本载体停留 0.0.3，要求同步 | 裁决：**保持 0.0.3 不提前升级**。理由：最终 SHA 固定前升版本号会造成「版本 0.0.4 但无对应 Tag」的中间态，且任务书禁止提前创建最终 Tag。改由 `CHANGELOG.md` `[Unreleased]` 段落登记全部 v0.0.4 变更，并在发布流程文档显式记录该决策 | ✅ **决策已记录**，§9.3 的 P2 执行方式相应改为「显式记录决策 + Unreleased 段落」，由 team-lead 落实 |

D-04 / D-07 / D-09 / D-10 / D-12 / D-13 / D-14 / D-15 的文档纠错由 team-lead 统一落实，本轮不重复改动。

### 10.2 第二轮新增交付物

| 文件 | 用途 | 规模 |
|------|------|------|
| `e2e/v004-four-roles-ui.spec.ts` | 四身份**真实浏览器 UI** 验收 | 7 条用例 / 16 个 `test.step` |
| `tests/floor-continuity.spec.ts` | 楼层严格 `1..N` 回归（B-05 漏检根因） | 5 条用例 / 独立库 `v2ex_floorcont_v004` |

E2E 文件全程 `page.goto` + locator 点击 / 可见性 / 文本断言，**未使用任何** `page.request.*`、`apiPost()`、`getCsrfToken()`、`clearRateLimits()`、`pickNodeId()`；节点 id 与主题链接均从真实 DOM 读取（`select[name=nodeId] option` / `a[href^="/t/"]`）。

### 10.3 实跑真实输出（不编造）

| # | 命令 | 结果 | 关键输出 |
|---|------|------|----------|
| 1 | `npx tsc --noEmit` | ✅ **零错误** | `=== TSC_EXIT=0 ===`，输出文件 0 行 |
| 2 | `npx vitest run tests/floor-continuity.spec.ts` | ✅ **5 passed / 5** | `✓ tests/floor-continuity.spec.ts (5 tests) 42421ms`；`Test Files 1 passed (1)`；`Tests 5 passed (5)`；`Duration 43.21s`；`=== EXIT=0 ===` |
| 3 | `ENV_FILE=…/Temp/v004e2e.env LOCAL_BASE=http://localhost:3021 BROWSER_CHANNEL=chromium npx playwright test e2e/v004-four-roles-ui.spec.ts --reporter=list` | ✅ **7 passed** | `7 passed (18.2s)`；`=== E2E_EXIT=0 ===`；7 条逐条 `ok` |
| 4 | 同上，`--reporter=json`（取 annotations 并验证可重复性） | ✅ **连续第二轮 7 passed** | `STATS {"startTime":"2026-11-04T10:22:01.967Z","duration":17756.652,"expected":7,"skipped":0,"unexpected":0,"flaky":0}`；`=== R2_PLAYWRIGHT_EXIT=0 ===` |

**诚实记录：单测前两次失败，均为环境/超时问题，非断言失败，已修复后才通过**

- 第 1 次：`Error: connect ECONNREFUSED 127.0.0.1:5432` / `Tests 5 skipped (5)` / `Duration 1.46s`。根因：`tests/setup.ts` 加载的 `.env.local` 把 `DATABASE_URL` 指向 **5432**（本机无实例），隔离实例实际在 `.env.test` 指向的端口（**本报告执行时点为 55433**；**当前按 `.env.test` 实际解析的端口为 55440**，实测 PostgreSQL 17.5 可达）。修复：从 `.env.test` 解析基础连接串（只读文件、不改全局 env），并在 `beforeAll` 临时把 `DATABASE_URL` 指向独立库。
- 第 2 次：`Error: Hook timed out in 30000ms` / `Duration 38.98s`。根因：建库 + `drizzle-kit migrate`（0000/0001/0002）超过 vitest 默认 `hookTimeout=30s`。修复：`beforeAll` / `afterAll` 显式放宽到 `120_000`。
- 第 3 次即上表第 2 行，**5/5 通过**。独立库 `v2ex_floorcont_v004` 建库前无残留，`afterAll` 已 DROP，未污染任何现有库。
- 3021 服务：首次 `curl localhost:3021` 得到 502，用 `--noproxy '*' http://127.0.0.1:3021/` 复测 **HTTP 200**（代理解析问题，非服务故障）；两轮 E2E 均连通。

### 10.4 四身份 UI 验收：实跑通过的断言

| 身份 | 真实浏览器 UI 断言（全部实跑通过） |
|------|------------------------------------|
| **游客** | `/go/new` → 重定向 `/signin` 且 `#username` 可见；`/admin` → 重定向 `/signin` 且页面不含「管理后台」；主题页无 `textarea[name=content]`、无「提交回复」按钮、有「后回复」引导；导航栏 `a[href="/admin"]` 计数 0、`#Top` 不含「管理后台」 |
| **普通注册用户** | 真实表单登录 `USER_A` 后 `#Top` 显示用户名；直达 `/admin` → 重定向回首页；导航栏无后台入口；主题页「锁定主题 / 置顶主题 / 恢复主题」按钮计数均为 0 |
| **版主 moderator** | 真实表单登录 `MODERATOR`；用 UI 创建主题后，主题页「锁定主题 / 置顶主题」按钮可见；**真实点击**「锁定主题」→「解锁主题」出现 → 再点击还原为「锁定主题」；`/admin` 可见且 `#Rightbar` 显示「版主」；用户 tab 中 `select[aria-label^="变更"]` 计数 0（**admin 独有**）；「节点申请」tab 与「待审批」筛选可见 |
| **管理员 admin** | 真实表单登录；`/admin` 概览可见、`#Rightbar` 显示「管理员」；用户 tab 搜索到目标用户后 `select[aria-label="变更 <name> 的角色"]` 可见；**真实点击**「封禁 <name>」（含 `window.prompt` 对话框）→「解封 <name>」出现 → 真实点击「解封」还原为「封禁」；「系统配置」tab 的「数据库口令」行不含明文 `v2ex_password` 且含 `****`/`—`，「账号 / 口令」行同样无明文 |

封禁目标用户由真实注册表单在独立 context 创建（不封禁 seed 演示账号），封禁后已解封；版主创建的新主题在锁定后已解锁还原。

### 10.5 实跑发现的新 UI 缺口与观测（诚实标注）

| # | 结论 | 性质 |
|---|------|------|
| 1 | `SiteNav.tsx` 对**任何角色**（含 admin / moderator）都不渲染 `/admin` 链接 —— 「导航栏无后台入口」**不能作为权限正确性的证据**，后台只能靠直达 URL，属产品可用性缺口 | **UI 缺口** |
| 2 | 节点申请**提交**在前端无表单/按钮（`/nodes` 页实测 `form[action*="node-requests"]` = 0），只有 `/api/node-requests`；后台「节点申请」tab 只有审批按钮 | **UI 无入口，功能仅 API 层** |
| 3 | 「隐藏既有节点」`PATCH /api/nodes { action:'hide' }` 在 UI 无任何入口（`button[aria-label*="隐藏节点"]` = 0）。`feature.spec.ts:157` 的「非管理员不能审核节点」实为**该 API 的 403**，与「审批节点申请」是两个不同操作，**不能冒充 UI 验收** | **UI 无入口，API 层结论** |
| 4 | 版主「节点申请」tab 的批准按钮**实测数量 = 0**（当前测试库无 pending 申请）→ 「版主可审批节点申请」**未验证**（缺数据），本轮只验证了 tab 与筛选可见 | **未验证** |
| 5 | annotations 真实观测：封禁后目标用户访问 `/settings` → `http://localhost:3021/signin?next=%2Fsettings`，即**会话在浏览器里失效**；与 `src/lib/auth.ts` L84 `if (row.status !== 'active') return null` 一致 | ✅ 观测结论（非硬断言） |
| 6 | `playwright.config.ts` 仍是单 project（chromium 1280×900）；移动端 / 平板 / 多浏览器**交互** E2E 仍为零，四视口只有截图对比 | **未验证** |

**仍不能算「真实浏览器 UI 验收通过」的项目**：版主审批节点申请的点击流（缺 pending 数据）、隐藏既有节点的权限拒绝（UI 无入口）、节点申请提交（UI 无入口）、多视口/多浏览器交互、以及 §6.2 的 Docker / Redis / PG 恢复 / SMTP / 备份还原等环境限制项。

> ✅ **本轮收尾状态更新**：上表是**该轮只读核查时点的快照**（UI 工程师补齐前）。
> **R-21 / R-24 已由 `ed385cf` 修复**（管理员 `/admin` 入口、关注按钮、节点申请提交界面、后台审批入口、
> 隐藏节点入口、操作日志、通知标记已读全部补齐）；**R-16 / R-17 已闭环**（run `41871503684` 九项全绿）；
> **§6.2 的 Docker / Redis / PG 恢复 / 备份还原项亦已闭环**（见 §6.2 与 §10.10.1）。
> ⚠️ **但节点申请 UI 提交链本身在生产构建下断裂** —— 这是 `ed385cf` 补齐入口后暴露出的**新缺陷**，
> 登记 `BUG_REGISTER` **V4-20** / `RISK_REGISTER` **R-27**（CI run `41873009808`：`153 passed | 1 failed | 154 total`）—— **✅ 已由 `bddb3d0` 修复并本地实测验证**：单元 194/194（16 文件）、E2E 154/154（11 文件，3.9m）全绿，React #418 归零，提交恢复 `POST /api/node-requests`；****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）**，
> **修复中** ⇒ 该项**不能算「真实浏览器 UI 验收通过」**。

### 10.6 楼层连续性（B-05）闭环

- 调用**真实实现** `import { allocateFloor, ensureFloorCounter } from '@/server/floor'`（`vitest.config.ts` 已把 `server-only` 映射为空模块），**不是** `tests/floor-counter.spec.ts` 里复刻的旧实现。
- 独立库 `v2ex_floorcont_v004` → 真实迁移 → 真实造 user/category/node/topic → 每次分配后**真实 INSERT** 一条 reply → 从数据库读回 `floor` 列校验。
- 5 条用例：① 漂移已建立（计数表为空）；② 连续 12 条**严格 `[1..12]`**（返回值 + 库读回双断言，跳号会在此失败）；③ `floor_counters.last_floor = 12` 与实际 max 一致且无重复；④ 计数表落后时先 `ensureFloorCounter` 自愈，再发 5 条仍严格 `[1..10]`（新分配 `[6,7,8,9,10]`）；⑤ 源码回归护栏（`SET last_floor = floor_counters.last_floor + 1` 存在、非注释代码中无 `greatest(…EXCLUDED.last_floor)+1`）。
- **B-05 的「回归不充分」升级为「已闭环」**。遗留建议（不属本轮改动范围）：`tests/floor-counter.spec.ts` L52–63 仍复刻旧实现用于自愈测试，建议后续统一到真实实现，避免读者误以为那是产品代码。

### 10.7 对 Draft Release 判断的影响

**判断维持「有条件可以」进入 Draft Release（不等于可正式发布）**，依据未变且证据增强：`tsc` 零错误、单测 5/5、E2E 连续两轮 7/7、`D-01`/`D-11` 闭环、`D-02` 决策已记录。

前置条件与缺口清单的状态更新：

| 项 | 第一轮 | 本轮状态 |
|----|--------|----------|
| §9.3 P3 几何量测闭环 | 待提供 52 原始证据 | ✅ **已闭环**（`geometry-summary.json` + `summarize-visual-diff.py` 已入仓） |
| §9.3 P4 「产出 `--list` 输出 + 补楼层连续 1..n 断言」 | 待补 | ✅ **已完成（P4 整体闭环）**：① 楼层连续 `1..N` 断言由 `tests/floor-continuity.spec.ts` 5 条实跑全绿守住；② `--list` 权威清单已入仓 `docs/evidence/e2e/test-list-v0.0.4.txt` 与 `docs/evidence/baseline/playwright-list-v0.0.4.txt`（`Total: 154 tests in 11 files`），三种口径定义见 `docs/evidence/e2e/TEST_COUNT_DEFINITION_v0.0.4.md`（静态声明 / 运行时展开 `--list` 权威 / 历史描述 144）；③ 按文件分解 = 原有 6 文件 67 + v004 四文件 **79** + 四身份 UI **8** = **154**（`ed385cf` 新增关注 UI 用例 +1，落在 `v004-account-admin.spec.ts` 20 → 21）。§9.3 前置条件表中的 P4 行以本行为准 |
| §9.3 P2 版本同步 | 待升级 0.0.4 | ✅ **改为显式决策**（保持 0.0.3 + `[Unreleased]`），由 team-lead 落实 |
| §4 / §7.1 版主管理权限用例 | 几乎空白 | ✅ 主题页锁定→解锁真实点击流已覆盖；但「审批节点申请」仍未验证（§10.5 #4） |
| §4 / §7.1 管理员后台 UI 点击流 | 零覆盖 | ✅ 封禁→解封 + 配置页脱敏已真实点击覆盖 |
| §4 / §7.1 游客写拒绝 UI 反馈 | 零覆盖 | ✅ 已覆盖（`/go/new`、`/admin` 重定向、主题页无回复表单） |
| §7.1 单 project / 多视口交互 | 缺口 | ⬜ **仍开放** |
| §7.1 节点申请提交 / 隐藏节点 UI 入口 | 缺口 | ✅ **节点申请提交入口已闭环** —— `ed385cf` 补齐提交界面，**V4-20 / R-27（提交链断裂）已由 `bddb3d0` 修复并本地实测验证**（单元 194/194、E2E 154/154（3.9m）全绿，React #418 归零，提交恢复 `POST /api/node-requests`；**CI 亦已复验通过**（run `41949555282`，SHA `bddb3d0`））。⬜ **仍开放**：「隐藏既有节点」的 UI 入口与版主「审批节点申请」点击流（缺 pending 数据） |
| §6.2 Docker / Redis / PG 恢复 / SMTP | 无法验证 | ⬜ **仍开放**，须在 Draft Notes 披露 |

Go / No-Go 判定不变：**§9.2 的 No-Go 触发条件 ④（把 API 403 断言当作四身份 UI 验收通过对外宣称）现已解除**，但对外表述必须同时带上 §10.5 的 6 项缺口，不得宣称「四身份 UI 验收已全部完成」。

### 10.8 第二轮边界声明

- 仅新建 `e2e/v004-four-roles-ui.spec.ts`、`tests/floor-continuity.spec.ts`，并仅在 `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md` 追加本章节；**未修改** `src/**`、其它 `e2e/**` / `tests/**`、任何其它 `.md` / `.yml` / `.json`、`package.json`、`vitest.config.ts`、`playwright.config.ts`。
- 未执行 git commit / push / 建删 Tag / 改 Release / 改仓库可见性 / 删除文件；未写远端。
- 数据库操作仅限**独立测试库** `v2ex_floorcont_v004` 的 CREATE / 迁移 / 测试数据 INSERT / DROP（由测试自身 `beforeAll`/`afterAll` 完成），以及通过 UI 在共享 E2E 库里注册 1 个目标用户、创建 1 个主题（均已还原封禁与锁定状态）。未手工改写任何业务数据。
- 实跑全部为真实执行：`tsc` 3 次（均零错误）、`vitest` 3 次（前 2 次环境/超时失败、第 3 次 5/5 通过）、E2E 3 轮（7/7、7/7、8/8），输出见 §10.3 与 §10.9；失败如实记录，未以「应该会通过」代替实跑。

### 10.9 补充核查：team-lead 两问的明确结论（2026-11-04）

#### 10.9.1 `.env.local → 5432` 污染：**需要在 `tests/setup.ts` 层面统一修**，影响 11/15 个单测文件

| 证据 | 实测结果 |
|------|----------|
| `tests/setup.ts` 加载顺序 | `ENV_FILE`（`override:true`）→ `.env.local`（默认不覆盖）→ `.env`（默认不覆盖） |
| dotenv 模拟：**裸跑**（无 `ENV_FILE`、无注入 `DATABASE_URL`） | `DATABASE_URL = postgres://v2ex:v2ex_password@127.0.0.1:5432/v2ex`（坏值，本机无 5432 实例） |
| dotenv 模拟：`ENV_FILE=.env.test` | `DATABASE_URL = postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_e2e`（正确，PG 17.5 实测可达）—— **该值为本表记录时的实测原文**；**当前 `.env.test` 实际解析的端口为 55440** |
| 依赖范围 | `tests/*.spec.ts` 共 15 个，**11 个**依赖 `DATABASE_URL` / 自建库：`admin-cli`、`admin-permissions`、`content-lifecycle`、`credits-concurrency`、`db-lazy-init`、`feed-search`、`floor-continuity`（本轮新增，已在文件内自解析绕开）、`floor-counter`、`password-reset`、`rate-limit-clear`、`seed-idempotency` |
| **实证**（裸跑现有文件） | `npx vitest run tests/floor-counter.spec.ts` → `Error: connect ECONNREFUSED 127.0.0.1:5432`；`Tests 6 skipped (6)`；`Test Files 1 failed (1)`；`Duration 1.01s`；`BARE_EXIT=1` —— 与本轮新测试第 1 次失败完全一致 |

**结论**：是的，需要在 `tests/setup.ts` 层面统一修，不能只在新测试里逐个绕过。建议把 `.env.local` 从默认加载链移除（或改为默认加载 `.env.test`、或对 5432 端口显式报错提示），并保留 `ENV_FILE` 注入作为 CI 契约。我的 `tests/floor-continuity.spec.ts` 已在文件内自解析 `.env.test` 因而裸跑 5/5 通过，**其余 10 个现有文件裸跑预期全部失败**。**我未修改 `tests/setup.ts`（所有权边界外），交 team-lead 处理。**

> ⚠️ **收尾轮口径更正（主理人，2026-11-04）**：「185 vs 190」**不是「v0.0.3 vs v0.0.4」的历史数字之争** ——
> **185 与 190 都是真实观测，只是环境不同**：
> - **CI 上 = `185 passed | 5 skipped (190)`**（**修复前的历史观测**：run `41837212170`）—— `tests/floor-continuity.spec.ts` 的 5 条因读不到未入仓的 `.env.test` 而崩溃
> - **本机上 = `190 passed`**（连续 4 轮）—— 本机有 `.env.test`（被 gitignore，故本地有、CI 没有）　（⚠️ **V4-20 修复后本机为 `194 passed`（16 文件）**）
>
> ⚠️ **CI 的分母仍是 190** ⇒ **v0.0.4 的用例总数在 V4-20 修复后为 194（修复前为 190），不存在「总数争议」**。
> CI 的这个差异曾是一个**真实缺陷**（CI 红灯），登记 `BUG_REGISTER` **V4-17** / `RISK_REGISTER` **R-26**，
> **状态：✅ 已由 `8ce5ce9` 修复并经 CI 复验**（run `41860242099` 与 `41873009808` 单元 job 均 ✅，`190 passed / 0 skipped`，`e2e` job 已真实跑过）。
> 详见本清单 §5 后的新增条目与 `TEST_REPORT.md` 文首「185 vs 190 裁决」小节。
>
> **对「全量单测 4 文件失败」归因的终局更正（2026-11-04，以 team-lead 实测为准）**：两个早期假设均被实测推翻 —— ① **不是** `.env.local → 5432` 污染（注入 `ENV_FILE` 以 `override:true` 指向 `.env.test` 实际解析的隔离实例端口后仍超时；该端口在本记录时点为 55433，**当前为 55440**）；② **不是**并行竞争。真实根因是**本机建库慢**：实测 `DROP DATABASE` 1.2s / **`CREATE DATABASE` 38.6s** / `drizzle-kit migrate` 5.4s，超过 vitest `hookTimeout: 30_000`；单独跑 `seed-idempotency.spec.ts` 也 32.5s 超时。team-lead 已写入 `RISK_REGISTER.md` R-22 勘误，并把 `vitest.config.ts` 的 `hookTimeout` 提到 `120_000`（附完整实测注释）。本轮我第 2 次单测失败 `Hook timed out in 30000ms`（38.98s）与此同源。
>
> **收尾轮第三次勘误（R-22 定案）**：本机 38.6s 属**异常态**（crash recovery / I/O 积压），
> **稳态实测 `CREATE DATABASE` 仅 2.0~2.3 秒**（同一 1.4GB 实例连测 3 次：2277 / 1978 / 2243 ms）。
> `hookTimeout` 提到 120s 后，**单元测试已连续 4 轮全绿（190 passed / 0 failed / 0 skipped）**（⚠️ **V4-20 修复后为 194 passed / 0 failed / 0 skipped（16 文件）**）——
> **本轮隔离实例实测 81.68s**；历史轮次 170~210 秒（共享实例 55433 口径），
> 且 `numPendingTests: 0` —— **没有任何用例被静默跳过**。R-22 状态由「已定位，未修复」更新为
> 🟢 **「已定案并复验」**。详见 `RISK_REGISTER.md` R-22 与 `docs/evidence/ci/test-baseline-v0.0.4.md`。
>
> 因此：§10.9.1 的 5432 污染结论**仍成立，但只适用于「完全裸跑、未注入 `ENV_FILE`」的独立场景**（实证 `tests/floor-counter.spec.ts` 裸跑 `ECONNREFUSED 127.0.0.1:5432`），与全量复验的 4 文件失败**无因果关系**；两条结论各自有效，不得互相套用。`tests/setup.ts` 的修正建议保留为独立改进项，交 team-lead 处置。

#### 10.9.2 `/admin` 入口：**完全无入口**（不是「入口在别处」）

**静态核查**（只读）：
- 全仓 `src/**`（排除 `src/app/api`）grep `href="...admin"` / `router.push('/admin')` → **0 命中**。
- `SiteNav.tsx`：登录态链接仅 `/`、`/notifications`、`/bookmarks`、`/leaderboard`、`/member/{username}`、`/settings`；游客态 `/`、`/signup`、`/signin` → 无 `/admin`。
- `Footer.tsx`：`/about`、`/faq`、`/privacy`、`/worldclock#...` → 无 `/admin`。
- 首页 `src/app/page.tsx`：无 `admin` / `后台` / `管理` 字样。
- `AdminConsole.tsx`：只有 `/api/admin/*` 的 `fetch` 调用（API），**无任何站内链接**。

**真实浏览器 DOM 实证**（第三轮 E2E，8/8 通过：`expected=8, skipped=0, unexpected=0, flaky=0`，19.34s）：以 admin 真实登录后逐个访问 `/`、`/admin`、`/settings`，记录 `#Top .tools` 的 HTML 与全页 `a[href*="admin"]`：

| 页面 | `a[href*="admin"]` | `#Top .tools` 实际 DOM |
|------|--------------------|------------------------|
| `/` | 4 个，**全部** `/member/admin` | 首页 / 通知 / 收藏 / 积分 / **admin→`/member/admin`** / 设置 |
| `/admin` | 1 个 = `/member/admin` | 同上（后台页面自身的顶部导航也没有后台链接） |
| `/settings` | 1 个 = `/member/admin` | 同上 |
| 三个页面 | `a[href="/admin"]` 硬断言均为 **0** | — |

唯一含 `admin` 字符串的链接是**管理员用户名指向个人主页 `/member/admin`**，与后台无关。staff 进入后台只有两条路径：① 地址栏直接输入 `/admin`；② 游客访问受保护页后的 `/signin?next=%2Fadmin` 重定向（本轮游客用例已实测）。

**性质判定（进风险清单用）**：**不是权限/安全缺陷** —— `src/app/admin/page.tsx` L42–43 服务端鉴权正确（游客→`/signin`、非 staff→`/`，本轮四身份用例已实跑验证），且 `AdminConsole` 的 `canChangeRole` 也由服务端 `isAdmin()` 下发；前端是否放链接不影响安全。这是**可用性 / 可达性缺口**：staff 用户无法从任何 UI 发现后台入口，必须预先知道 URL。建议级别「一般（可用性）」，修法为在 `SiteNav` 对 staff 渲染「管理后台」链接（改动在 `src/**`，不在本轮所有权边界内，未执行）。

#### 10.9.3 与 devops-engineer 发布门禁的接口澄清

- **`TEST_REPORT.md` 不在我的所有权边界内**（严禁修改任何其它 `.md`），我不能把测试结论写入该文件。`docs/RELEASE_PROCESS_v0.0.4.md` A 组「由 qa-engineer 复验、结论写入 `TEST_REPORT.md`」的表述需改为「由 team-lead 全量复验（任务 #1）后写入 `TEST_REPORT.md`」，或由 team-lead 单独授权我改该文件。
- 本轮是**专项实跑**（5 条楼层连续单测 + 8 条四身份 UI E2E），**不是 190 / 154 全量复验**；全量复验是 team-lead 的任务 #1，我没有 CI run id，不能提供「最终用例数 / 通过数 / 连续两轮结果 / CI run id」这组全量证据。
- 本轮专项实跑**未发现回归**：单测 5/5；E2E 三轮 7/7、7/7、8/8；`tsc --noEmit` 三次均零错误。
- `scripts/release/preflight.sh` 只读检查 `TEST_REPORT.md` 存在、不解析通过数、不代替判定，做法正确，无需改动；devops 的隔离库（fresh/old/restore）与我的 `v2ex_floorcont_v004` 互不干扰。

### 10.10 按 devops-engineer 回执的状态复核（2026-11-04）

> 本轮为**只读取证**（`playwright test --list`、只读 SELECT、文件核查），仅追加本章节；
> 未修改 `docs/evidence/e2e/test-list-v0.0.4.txt`、`docs/RELEASE_PROCESS_v0.0.4.md`、
> `TEST_REPORT.md`、`RISK_REGISTER.md`、`docs/UPGRADE_RECOVERY_v0.0.4.md`（均在所有权边界外）。

#### 10.10.1 两项「无法验证」应改判为「已实跑通过（隔离库）」

| §6.2 原条目 | 复核证据（`docs/UPGRADE_RECOVERY_v0.0.4.md`） | **修订状态** |
|-------------|-----------------------------------------------|-------------|
| PG 故障恢复与备份实际还原 | §5：`pg_dump` → gzip → 重建目标库 → `psql --single-transaction` 恢复 → 完整指纹 `fc3512608…` 与源库**逐字节一致**；§5.2 如实记录一次真实断连失败与重试（非原子恢复留下 26 表/66 索引半成品）；§2 全新安装（26 表 / 76 索引 / 3 条迁移记录 / `pg_trgm 1.6`）、§4 迁移幂等均实跑通过 | ✅ **已实跑通过（隔离库 `v2ex_upg_v004_*`）**。但**容器内 PG 故障注入仍未实跑**（§6 为静态核查），两者不可混同 |
| v0.0.3 → v0.0.4 原地升级 | §3：在 `v2ex_upg_v004_old` 构造 v0.0.3 基线（26 表 / 69 索引 / 2 journal / 0 trgm）→ 只应用 `0002` → 数据指纹 `a7335937…` 升级前后逐字节一致、管理员口令哈希/头像/积分账本不变、原 69 索引零丢失且新增正好 7 个 | ✅ **已实跑通过（隔离库）** |
| **仍无法验证** | Docker 容器真实运行 / 最终镜像字节数 / 容器内 `USER nextjs`（本机无 Docker）；Redis 容器故障注入（仅静态读码 `src/lib/kv.ts:152-188`，B8 是 v0.0.2 CI 证据）；容器内 PG 故障注入；真实 SMTP 投递；多浏览器视觉回归 | ⬜ **保持**，须在 Draft Notes 披露 |

#### 10.10.2 压测库 `0002` 索引证据缺口**已闭环**（只读 SELECT 取证）

按 devops 提供的 SQL 对 `v2ex_loadtest` 做**严格只读**取证（仅 `SELECT`，未执行任何 DDL / DML / 迁移，未修改禁改库）：

| 查询 | 实测结果 | 预期 | 判定 |
|------|----------|------|------|
| `select indexname from pg_indexes … in (7 个 0002 索引)` | **7 行**：`replies_author_alive_idx`、`replies_topic_id_idx`、`thanks_reply_id_idx`、`topics_author_alive_idx`、`topics_content_trgm_idx`、`topics_title_trgm_idx`、`votes_topic_id_idx` | 7 | ✅ |
| `select extversion from pg_extension where extname='pg_trgm'` | `1.6` | 1 行 | ✅ |
| `select count(*) from drizzle.__drizzle_migrations` | **3** | 3（0000/0001/0002） | ✅ |

**结论**：§6.2「压测库是否已应用 `0002` 无执行日志」→ ✅ **已闭环**。`0002` 确已应用于压测库，因此 D-05 的 `0.46s`（单次 `EXPLAIN ANALYZE`）与 `bench-result.json` 的 `p95 1530ms`（并发 10 端到端）差异确认为**测量口径差异**，不是迁移缺失导致的退化；保留「三个数值（0.46s / 0.4s / 1.16s avg）须在同一口径下表述」的意见。

#### 10.10.3 E2E 用例数口径：`--list` 实测 **154 条 / 11 文件**（不是 144 / 152 / 153）

**本轮重新取证**（在仓库根执行 `npx playwright test --list`）：

```
Listing tests:
  [chromium] › auth.spec.ts:9:3 › 账号体系 › 注册后自动登录并可访问设置页
  ...
  [chromium] › v004-four-roles-ui.spec.ts:412:3 › 四身份 UI 验收 · 管理员 admin › 管理员：/、/admin、/settings 三页 DOM 中都有 /admin 入口且可点击到达
Total: 154 tests in 11 files
```

`LIST_EXIT=0`。精确分解（按 `--list` 输出逐文件计数，与第一轮静态 `test()` 计数完全自洽）：

| 文件 | 条数 | 性质 |
|------|------|------|
| `e2e/auth.spec.ts` | 8 | 静态 |
| `e2e/feature.spec.ts` | 16 | 静态 |
| `e2e/pagination.spec.ts` | 6 | 静态 |
| `e2e/security-regression.spec.ts` | 19 | 静态（含 `data:image/svg+xml` / `javascript:` 两条，按标题解析时易被误归类） |
| `e2e/security.spec.ts` | 10 | 静态 |
| `e2e/topic.spec.ts` | 8 | 静态 |
| **原有小计** | **67** | — |
| `e2e/v004-account-admin.spec.ts` | **21** | 静态（`ed385cf` 新增「关注（UI）：真实点击关注/取消，刷新后状态持久化」1 条，由 20 增至 21） |
| `e2e/v004-api-contract.spec.ts` | 17 | 13 端点循环 + 4 固定 |
| `e2e/v004-content-interaction.spec.ts` | 10 | 静态 |
| `e2e/v004-endpoint-smoke.spec.ts` | 31 | 源码自动发现 29 个 GET 路由 + 2 固定 |
| **v004 四文件小计** | **79** | — |
| `e2e/v004-four-roles-ui.spec.ts` | 8 | `ed385cf` 改写为正向断言（入口存在且可提交 / 三页都有 `/admin` 链接且可点击到达），条数不变 |
| **合计** | **154** | 67 + 79 + 8 |

  - `docs/evidence/e2e/test-list-v0.0.4.txt` 与 `docs/evidence/baseline/playwright-list-v0.0.4.txt`
    已由主理人**重新 `--list` 生成并更新为 154**（`Total: 154 tests in 11 files`）。
    旧值 153 是 `ed385cf` 之前的时点；旧 152 是第三轮新增 DOM 实证用例之前的时点；旧 144 = `67 + 77` 属更早时点。
    四个数字各有其时点，均非错误，**当前权威值为 154**。
- **D-08「144 口径未定义」→ ✅ 已闭环，以 `--list` 实测 154 为准**；§9.3 P4 的「`--list` 输出固定口径」亦闭环。
  - ✅ **主理人已同步完成**：`RELEASE_PROCESS` / `UPGRADE_RECOVERY` / `CHANGELOG` / `TEST_REPORT` / 本清单里的 E2E 分母
    以及 `test-list-v0.0.4.txt` / `playwright-list-v0.0.4.txt` 全部更新为 **154**。仍需注意：
    `v004-endpoint-smoke.spec.ts` 条数随 GET 路由数浮动，正式发布前须重新 `--list` 固定。
  - ⚠️ **口径待复核（主理人）**：任务书给出的分组写法是「**67 + 78 + 9 = 154**」（把 +1 记在「四身份 UI」组）；
    但**按 `ed385cf` 的实际 diff 与 `--list` 实测逐文件计数**，+1 落在 `v004-account-admin.spec.ts`（20 → 21），
    `v004-four-roles-ui.spec.ts` 仍为 8 条 ⇒ 本节采用实测分组「**67 + 79 + 8 = 154**」。**总数 154 与任务书一致**，
    仅「哪一组 +1」的归属不同，请主理人确认是否按此统一。

#### 10.10.4 风险登记与文档纠错的状态复核（主理人/devops 已落实）

| 项 | 第一轮 | 本轮只读复核 |
|----|--------|-------------|
| D-02 版本载体 0.0.3 | 要求同步 | ✅ **非缺陷**：权威载体清单以 `scripts/release/preflight.sh` L147–148 实际校验的 **5 个载体**为准（`package.json` / `deploy/VERSION` / `README.md` / `RELEASE_GATE.md` / `TEST_REPORT.md`）—— **本清单不再列举 8 个载体，避免两处口径分叉**。`CHANGELOG.md [Unreleased]` L11–24 明确记载主理人裁决与理由（最终 SHA 固定前不升版本）；preflight 双模式 dev `FAIL=0` / release `FAIL=14`（两者 `BLOCK=1`）；devops 已把遗漏的 VERSION / package.json / RELEASE_GATE / TEST_REPORT 补进 C 组与门禁 **G-VER-01** |
| D-03 R-09 内容错置 | CSRF 风险未评估 | ✅ **已修**：`RISK_REGISTER.md` L144 标题改「已复核（设计从严，不影响正常流程）」，L158 有「登记勘误」按 D-03 实测重写 |
| D-09 R-02 与 E-10 冲突 | 冲突 | ✅ **已修**：L46 改为「带凭据 `docker pull` 为发布成败判据；匿名 Bearer 三步仅 `::notice::` 提示；不再只看首次 401」 |
| D-09 表头 v0.0.2 | 过时 | ✅ L4 已改为 v0.0.4 |
| D-09 R-14「负载测试未执行」 | 与压测冲突 | 🟡 **部分**：L221 已改为「负载测试已执行（v0.0.4，100 万回复规模）」，但备注仍写「未做吞吐量压测」，与 `bench-result.json` 13 场景吞吐数据轻微冲突，建议改为「已做吞吐压测，未做长时间稳定性测试」 |
| D-09 R-01「2 → 0」 vs DRILL 基线「0」 | 矛盾 | ✅ **已闭环** —— 两个数字各有其时点，**不矛盾**：`RISK_REGISTER` R-01 的「2 → 0」指清理**前**有 **2 个提交**引入/修改了原站素材文件、清理**后**为 0；`docs/HISTORY_CLEANUP_DRILL_v0.0.4.md` 基线表的 `0` 指「清理**后**」。依据：`RISK_REGISTER.md` L44–45 + `docs/HISTORY_CLEANUP_DRILL_v0.0.4.md` §「关于「含原站素材的提交数」」（该节已明写「两者不矛盾」） |
| D-10 缺陷未登记 | 未验证 | ✅ **已闭环**：`CHANGELOG.md [Unreleased]` L28 起列「修复的真实缺陷（8 项，均由真实浏览器 E2E / 真实压测发现）」 |
| D-13 RELEASE_GATE 旧阈值 | 不匹配 | ✅ **口径已明确**：`docs/RELEASE_PROCESS_v0.0.4.md` §15 第 8 项写明 v0.0.4 门禁以 `TEST_REPORT.md` 实测与 preflight 双模式为准，`RELEASE_GATE` 旧阈值「仅作历史基线，不得作为 v0.0.4 判据」。**本清单采用同一口径** |

#### 10.10.5 对 Draft Release 判断的影响

**维持「有条件可以」进入 Draft Release（不等于正式发布）**，证据进一步增强：§6.2 两项由「无法验证」升级为「已实跑通过（隔离库）」、压测库 `0002` 缺口闭环、E2E 口径固定为 154、D-01 几何量测已闭环、D-02/D-03/D-09/D-10/D-13 大部分纠错已落实、**R-16 / R-17 已闭环**（run `41871503684` 九项全绿）、**R-21 / R-24 已修**（`ed385cf`）。

仍开放：**R-27 / V4-20 的 CI 复验确认**（本地已实测全绿 —— 单元 194/194、E2E 154/154（3.9m）；修复前 CI run `41873009808` 为 `153 passed | 1 failed | 154 total`，**CI 亦已复验通过**（run `41949555282`，SHA `bddb3d0`））、真实 SMTP、多浏览器回归、R-01 授权遗留。devops 的 `[BLOCK] R-01 DEFERRED`（Release 只能停 Draft、`publish=false`）与本判断不冲突，只是把同一结论写成自动化阻断项而非「条件」。

  **主理人裁决（两处均已落实）**：① 全部 `152` → `153` → **`154`**（`ed385cf` 新增关注 UI 用例 +1），证据文件已重新生成；② 采纳建议，`RELEASE_PROCESS` A 组已改为「由 team-lead 任务 #1 全量复验后写入 `TEST_REPORT.md`」，QA 的专项实跑与全量判定明确区分。
