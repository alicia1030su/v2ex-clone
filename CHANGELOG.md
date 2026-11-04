# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 版本号从 `0.0.1` 起，采用 `0.MINOR.PATCH` 形式：
> `0.0.x` 全部为**早期开发预览版**，不承诺 API 稳定性，不建议用于生产环境。

本文件只记录**本项目实际做过的事**。凡是未实现的功能，一律列在「不包含」小节，
不以任何形式（包括占位按钮、静态演示数据）冒充已实现。

## [Unreleased] — v0.0.4 开发分支（尚未发布）

> ⚠️ **版本号尚未同步（主理人裁决，2026-11-04）**：`package.json`、`deploy/VERSION`、
> `README.md`、`FEATURE_MATRIX.md`、`RELEASE_GATE.md`、`TEST_REPORT.md` **仍统一为
> `0.0.3`，本轮刻意不提前升级**。**本文件出现「v0.0.4」只代表开发分支，不代表已发布的版本号。**
>
> 理由：任务书明令「v0.0.4 期间禁止提前创建最终 Tag，同一版本号不得反复删建或移动 Tag」。
> 在**最终 SHA 固定之前**把版本载体升到 `0.0.4`，会造成「版本号已是 0.0.4、却没有
> 对应 Tag 与 Release」的中间态，且一旦后续改动 SHA 又要改版本号 —— 这正是被禁止的
> 「同一版本号反复移动」。
>
> 因此采用：`[Unreleased]` 段落累积变更 → 合并并固定最终 SHA → **一次性**把版本载体、
> Tag、Draft Release 同步到 v0.0.4。此决策由主理人负责，在
> `docs/RELEASE_PROCESS_v0.0.4.md` 中固化为发布门禁（门禁 G-VER-01，第 9 步）。
> 登记见 `RISK_REGISTER.md` **R-20**（已裁决：开发态保持 0.0.3）。
>
> 本小节只记录**本轮实际做过并验证过的事**。

### 一、修复的真实缺陷（**14 项**，均由真实浏览器 E2E / 真实压测 / 版本库核查 / CI 实跑发现）

| ID | 级别 | 缺陷 | 验证方式 |
|---|---|---|---|
| B-01 | 阻断 | `GET /api/nodes` 生产构建必然 500（原生 SQL 用 `FROM nodes n` 起别名，WHERE 仍由 drizzle 生成 `"nodes"."status"` → PG 42P01） | `e2e/v004-api-contract.spec.ts` 端点冒烟 + `e2e/v004-endpoint-smoke.spec.ts` 全 GET 不 5xx |
| B-02 | 阻断 | `GET /api/topics/[id]` 500（条件片段写成普通字符串被 drizzle 绑定成 `$2` 占位符 → PG 42601） | 同上 + `bench-result.json` 主题详情 API 4810 请求无 5xx |
| B-03 | 严重 | 分页参数 `limit`/`offset` 从未从路由透传到服务层 | `v004-api-contract.spec.ts`「分页参数生效」+ `e2e/pagination.spec.ts` |
| B-04 | 严重 | 「编辑主题」是假按钮（服务端组件无法向客户端组件传函数，`onEdit` 永远 undefined） | `v004-content-interaction.spec.ts` 完整 UI 链路：点击→模态框→填值→保存→展示→刷新 |
| B-05 | 严重 | 回复楼层跳号（`allocateFloor` 双重 `+1`；路由 `floor + attempt` 偏移使实际楼层与计数表脱节） | 修复后连发 6 条得 `41..46` 严格连续；`tests/floor-continuity.spec.ts` 断言严格 `1..n` |
| B-06 | 一般 | 注册赠送积分绕开账本（直接写 `balance: 1000`，破坏「余额 == 账本累计」不变式） | 新注册用户 `balance=1000 / ledger_sum=1000 / rows=1`，账本链 `before=0→after=1000→before=1000→after=1002` 首尾相接 |
| B-07 | 一般 | `/hot` 独立页面缺失（v0.0.3 只有首页侧栏） | 新增 `src/app/hot/page.tsx` 与 `src/app/recent/page.tsx`；压测「热门排序」230 请求 0 错误 |
| B-08 | 严重 | 积分排行榜相关子查询 N+1（每作者执行一次，EXPLAIN 实测 **241.98 秒**） | 改「三个独立聚合 + JOIN」→ 0.74 秒；`0002` 索引后 0.46 秒；压测 p50 1.23 秒（并发 10） |
| **B-09** | 严重 | **运行时上传数据被误提交入仓** —— E2E 跑出的 **18 个头像占位 PNG**（每个 684 字节）被 Git 跟踪，进入公开发布物。**风险性质与 R-01 同类**（运行时数据进入公开发布物） | 提交 `49d66d3`：`.gitignore` 加 `public/uploads/` 规则 + `git rm --cached` 移出索引（**不改写历史、不删磁盘文件**）；验证 `git ls-files "public/uploads/*"` → **0 条**。引入提交逐一定位：`04b107b`（16 个）/ `1b15f79`（1 个）/ `301a8a5`（1 个）。登记 `BUG_REGISTER` V4-14 / `RISK_REGISTER` R-25 |
| **B-10** | 严重 | **`docker-verify.yml` 定义级失败** —— 工作流在定义阶段就失败，**一个 job 都没被创建**（run 0 秒结束、`total_count=0`、报错仅「This run likely failed because of a workflow file issue」）。根因：GitHub 表达式上下文**不支持 `&&`/`\|\|` 三元**（`\|\|` 取默认值支持） | 提交 `2532f5f`：三元判断下沉到 shell 层，`${{ }}` 只用于传值。**陷阱**：YAML 本身能正常解析（1 job / 17 steps），问题只在表达式求值阶段 ⇒ 排查耗时。登记 `BUG_REGISTER` V4-15 |
| **B-13** | 严重 | **`docker-verify.yml` 的 app 健康判定口径不可能成立** —— 第 2 项红灯 `✗ app 未达 healthy（none）`。根因：根目录 `docker-compose.yml` 的 **app 服务没有 healthcheck**（只有 `deploy/docker-compose.yml` 才有）⇒ `State.Health.Status` **永远返回 `none`**。⚠️ **CI 日志证明 app 其实完全健康**（`✓ Ready in 414ms`）—— 是断言读错了 | ✅ **已修** —— 改为「**容器状态 + HTTP 探活**」（`State.Status == running` 且 `curl /` 返回 200）；PG/Redis 仍用 health 状态。**HTTP 探活是更强的证据**（证明 Next.js 真在服务请求，而非只是容器活着）。桩程序对照验证通过 |
| **B-14** | 严重 | **`docker-verify.yml` 的 `[7/9]` 安装包实际部署必然失败** —— ① **端口占用**：`install.sh` L163 的硬性端口检查会因根 compose 的 app 容器仍占 3000 而直接 `die`；② **容器名冲突**：新实例与运行中的实例同名 | ✅ **已修** —— 断言与执行上下文分离，并新增断言保证它不会变成外部镜像 |
| **B-12** | 阻断 | **`tests/floor-continuity.spec.ts` 在 CI 上必然崩溃** —— 单元 `unit` job 红灯 ⇒ `e2e` job 被 `needs: unit` 连带跳过 ⇒ 整个 CI 红灯，**v0.0.4 的 153 条 E2E 在 CI 上从未跑过一条**。根因：硬编码 `readFileSync('.env.test')`（该文件被 gitignore，CI 检出里不存在）+ `:55433/` 端口白名单（CI 的 `DATABASE_URL` 是 5432） | 🔴 **本轮修复中，待 CI 复验** —— 实测 run `41837212170`：`Test Files 1 failed \| 14 passed (15)` / `Tests 185 passed \| 5 skipped (190)`（**分母 190 正确**）。登记 `BUG_REGISTER` V4-17 / `RISK_REGISTER` R-26 |
| **B-11** | 一般 | **`docker-verify.yml` 迁移物路径断言错误** —— 第 9 项误报「✗ 镜像内缺少迁移文件: `_journal.json`」，而同一步骤前面的 `ls` 已证明它存在。根因：drizzle 的 SQL 在 `/app/drizzle/` 根目录，而 `_journal.json` 与 snapshot 在 `/app/drizzle/meta/` 子目录，初版混用同一路径断言。**性质：验证脚本自身的错误，不是产品缺陷** | 提交 `930f29e`：SQL 与 meta 分成两段断言，meta 段同时断言 3 个 snapshot + `_journal.json`（覆盖面更严）。登记 `BUG_REGISTER` V4-16 |

### 二、性能优化（EXPLAIN ANALYZE + 真实压测实测，10 万主题 / 100 万回复）

| 端点 | 优化前 | 优化后 | 手段 |
|---|---|---|---|
| 搜索 API | 3207ms | **41ms** | `pg_trgm` GIN 三值索引（ILIKE 前导通配符无法用 B-tree） |
| 节点列表 API | 1543ms | **67ms** | 相关子查询 → 聚合 JOIN；`topics.last_reply_at` 已是汇总字段，无需 join 100 万 replies |
| 排行榜 API | 超时（>30s） | **~1.2s**（并发 10） | 见 B-08 |

### 三、新增迁移

- `drizzle/0002_v004_perf_indexes.sql`：5 个 btree + 2 个条件性 pg_trgm GIN 索引；
  `CREATE EXTENSION` 用 DO 块捕获权限不足（跳过索引而不让迁移失败）；
  全部 `IF NOT EXISTS`，连跑 3 次幂等，全新库迁移实测通过。

### 四、新增能力与工程化

| 项 | 内容 | 证据 |
|---|---|---|
| 升级脚本自动同步镜像 tag | 重写 `deploy/update.sh`（+688 行）：自动改写 `.env` 的 `V2EX_IMAGE`、失败回滚、备份失败中止、非法版本号拒绝、镜像未变化时告警中止（退出码 3） | `b0d68c2`；`scripts/release/verify-update-script.sh` **62 项断言全 PASS / 0 FAIL** |
| 升级脚本沙箱自检 | **不依赖 Docker** 的自检脚本：`mktemp -d` 沙箱 + 假 `deploy/.env` + 真实 `backup.sh` 副本 + 记录调用参数的 docker stub，跑**真实的** `update.sh` 并断言 8 类行为 + 「仓库真实文件未被改动」校验和 | `scripts/release/verify-update-script.sh`（749 行），实测 `PASS=62 FAIL=0` |
| Docker / Redis 取证通道 | 新建 `.github/workflows/docker-verify.yml`（9 项验证），含 `[R-17a]` Redis 中断恢复、`[R-17b]` PG 中断恢复、`[R-17c]` 缓存失效与内存观测 | `b0d68c2` + `2532f5f` + `930f29e`；**首轮实跑已通过第 9 项的 6 个子断言**（非 root、8 项 devDependency 未检出、3 个运行时文件已检出、5 个 env/凭据文件未检出、迁移 SQL 完整、体积打印） |
| 发布前只读门禁 | `scripts/release/preflight.sh` 双模式（`--phase=dev` / `--phase=release`）：版本一致性 / 流水线闸门 / 迁移幂等 / 安装包结构四类，**只读、不写、不联网** | `docs/RELEASE_PROCESS_v0.0.4.md` §14 |
| 视觉汇总脚本入仓 | `tools/visual/summarize-visual-diff.py` + `docs/evidence/visual/geometry-summary.json`（三套口径机器可读，**52/52 可复算**） | `1b15f79` |

### 五、测试与证据（**权威口径**）

| 项 | 权威值 | 实测命令 / 证据 |
|---|---|---|
| **单元测试** | **190 条 / 15 个文件**，**190 passed / 0 failed / 0 skipped**，**连续 4 轮全绿**（每轮约 170~210 秒） | `ENV_FILE=.env.test npx vitest run`；`docs/evidence/ci/test-baseline-v0.0.4.md` |
| **单元测试（CI 现状）** | 🔴 **CI 红灯** —— run `41837212170`：`185 passed \| 5 skipped (190)`。**分母 190 正确**，5 条因 `floor-continuity` 崩溃而跳过。**修复中，待 CI 复验** | `docs/evidence/ci/ci-status-v0.0.4.md` §0 |
| **真实浏览器 E2E** | **153 条 / 11 个文件**，**153 passed / 0 failed / 0 skipped**，**连续 2 轮全绿**（4.5m/轮） | `ENV_FILE=.env.test LOCAL_BASE=http://localhost:3010 npx playwright test`；`docs/evidence/e2e/e2e-full-run-v0.0.4.md` |
| **升级脚本自检** | **62 项断言全 PASS / 0 FAIL** | `bash scripts/release/verify-update-script.sh` |
| **视觉对照** | 4 视口 × 17 页面 = **68 条**；**40 有对照 / 28 无对照**；严格口径桌面 Δx=0 **52/52**、Δw=0 48/52 | `tools/visual/summarize-visual-diff.py` + `docs/evidence/visual/geometry-summary.json` |
| **负载压测** | 13 场景 / 24785 请求，**0 个 5xx**；数据集 351 万行（10000 用户 / 1000 节点 / 100000 主题 / 1000000 回复） | `scripts/loadtest/seed-large.ts` + `tools/loadtest/bench.mjs` + `bench-result.json` |

#### 5.1 「185 vs 190」口径裁决（**权威值 = 190 条 / 15 文件 / 0 failed / 0 skipped**）

⚠️ **「185」有两个不同来源，绝不可混用**：

| 数字 | 来源 | 含义 | 归属 |
|---|---|---|---|
| **190** | 本机连续 4 轮实测（`ENV_FILE=.env.test npx vitest run`） | `Test Files 15 passed (15)` / `Tests 190 passed (190)` —— **总数即 190** | ✅ **v0.0.4 权威基线** |
| **185**（作为**通过数**） | CI run `41837212170`（HEAD `930f29e`） | `Tests 185 passed \| 5 skipped (190)` —— ⚠️ **分母仍是 190**；5 条因 `floor-continuity` 在 CI 崩溃而跳过 | 🔴 **CI 环境观测值，CI 红灯中**（**B-12 / V4-17 / R-26**） |
| **185**（作为**总数**） | CI run `41760677505`（master @ `37710fb4`，**14 个** spec 文件） | `Tests 185 passed (185)` —— 当时总数就是 185 | ⏪ **v0.0.3 历史快照**，已过时 |

**结论**：
1. **v0.0.4 的用例总数始终是 190**（15 个文件）—— CI 的 `185 passed | 5 skipped (190)` **分母就是 190**，
   **不构成「总数有争议」**。与 v0.0.3 的**总数差异**来自 `tests/floor-continuity.spec.ts`（5 条，提交 `1b15f79` 引入）：
   `185 (master, 14 文件) + 5 = 190 (当前, 15 文件)`。
2. **185 不是「v0.0.4 的用例数」** —— 它要么是 CI 上的**通过数**，要么是 **v0.0.3 master 的历史总数**。
3. 🔴 **当前 CI 是红灯的**（run `41837212170`）：`Test Files 1 failed | 14 passed (15)` /
   `Tests 185 passed | 5 skipped (190)`。根因是 `tests/floor-continuity.spec.ts` 硬编码
   `readFileSync('.env.test')` + `:55433/` 端口白名单 —— `.env.test` 被 gitignore ⇒ CI 检出里没有该文件，
   而 CI 的 `DATABASE_URL` 是 5432 ⇒ 两条路都走不通 ⇒ ENOENT 崩溃 ⇒ 5 条 skipped ⇒
   `unit` job 红灯 ⇒ **`e2e` job 被 `needs: unit` 连带跳过** ⇒ **v0.0.4 的 153 条 E2E 在 CI 上从未跑过一条**。
   **登记 `BUG_REGISTER` V4-17 / `RISK_REGISTER` R-26，状态：本轮修复中，待 CI 复验。**
4. ⚠️ 静态 grep 得出 **180**（少于 190），因 `admin-permissions.spec.ts` 用嵌套 for 循环生成用例 ——
   **口径必须取 Vitest 运行时的 `numTotalTests`**。三方交叉校验见 `docs/evidence/ci/test-baseline-v0.0.4.md` §0.1 / §0.2。
5. ⚠️ **核对 CI 必须看 `Test Files` 行，不能只看 `Tests` 行**（`1 failed + 5 skipped` ≠ 「少了几条」）。

#### 5.2 E2E 用例数口径（**153**）

分解：原有 6 文件 67 条 + v004 四文件 78 条 + 四身份 UI 8 条 = **153 条 / 11 文件**。
历史数字 **144**（`67 + 77`，更早时点）与 **152**（新增 DOM 实证用例之前的时点）各有其时点，均非错误，**当前权威值为 153**。
⚠️ `v004-endpoint-smoke.spec.ts` 条数随 GET 路由数浮动 ⇒ **正式发布前须重新 `--list` 固定口径**。

#### 5.3 视觉结论的边界（**不得宣称「像素级复刻完成」**）

- 严格口径 Δx=0 **52/52** 只覆盖**几何位置**一个维度。
- **六类区分必须分别判定**：几何位置 / 组件宽高 / 视觉样式 / 动态内容 / 缺失组件 / 实际交互。
  其中组件宽高 Δw=0 仅 **48/52**，动态内容因原站是真实社区数据而本地是 seed 数据**必然不同**，
  缺失组件与实际交互**未覆盖**（28 条无原站对照）。
- **分母说明**：68 条中 **40 条有对照、28 条无对照**（`no-auth-reference` 6 个页面 × 4 视口 = 24 条
  + `no-origin-equivalent` 1 个页面 × 4 视口 = 4 条）。无对照项**不拿游客态冒充**。
- 移动 375 视口的 Δx=0 仅 10/52，是**有意的响应式重排**（原站桌面版 `min-width:600px` 横向滚动），
  **不是复刻失败**。

### 六、风险状态（收尾轮实测同步；详见 `RISK_REGISTER.md`）

| ID | 风险 | 收尾轮新状态 |
|---|---|---|
| **R-01** | 原站版权素材经 Git 历史持续暴露 | 🔴 **DEFERRED（维持）** —— 只读复核：风险未消除；隔离演练证明方案技术可行且不损坏项目，但与「不得移动已发布 Tag」的约束存在**待主人裁决**的冲突 |
| **R-16** | Docker 容器与安装包未实跑 | 🟡 **部分项已实证通过，其余待重跑** —— 已通过：`ci.yml` Docker 构建与启动 ✅、`install-verify.yml` Linux 真实 Docker 安装（真跑 `install.sh`、权限 600、容器 healthy、管理员创建、数据持久化、重启后口令不变）✅、Windows 脚本校验 ✅、`docker-verify` [1/9] ✅ 与 [9/9] ✅（6 子断言全过）；**待重跑**：[2/9]~[8/9] |
| **R-17** | Redis 故障恢复 / 缓存失效 / 内存观测未验证 | 🟡 **部分项已实证通过，其余待重跑** —— 已通过：`install-verify.yml` Linux 真实 Docker 安装（真实 compose 起 PG+Redis、容器 healthy、持久化与重启口令不变）✅；**待重跑**：`[R-17a/b/c]` 三项专项 |
| **R-18** | 升级路径断点（`update.sh` 不更新镜像 tag） | 🟢 **已修并验证** —— `b0d68c2`；62 项自检断言全 PASS |
| **R-19** | `release.yml` tag 白名单不含 `v0.0.4` | 🟡 **部分已修（维持）** —— 白名单**发布时人工加入**，不会自动加 |
| **R-20** | 版本载体全部为 `0.0.3` | 🟢 **已裁决（维持）** —— 开发态保持 0.0.3，最终 SHA 固定后一次性同步 |
| **R-21** | 四身份 UI 验收缺口（管理员无 `/admin` 入口等） | 🟠 **本轮处理中** —— UI 工程师补齐中，**待主理人确认后才可标 FIXED** |
| **R-22** | 单测建库超时 | 🟢 **已定案并复验** —— 三次归因勘误后定案（crash recovery / I/O 积压态），稳态 `CREATE DATABASE` **2.0~2.3s**；`hookTimeout` 提到 120s；连续 4 轮全绿 |
| **R-23** | 关注链路断言被静默跳过 | 🟢 **已修复并实跑通过** —— 修复前的 152 passed / 1 skipped 如实保留在证据文件，不回写历史 |
| **R-24** | 关注功能无 UI 入口 | 🟠 **本轮处理中** —— UI 工程师补齐中，**待主理人确认后才可标 FIXED** |
| **R-26** | CI 上单元测试红灯（`floor-continuity` 崩溃 ⇒ `e2e` job 连带跳过） | 🟠 **本轮修复中，待 CI 复验** —— 根因已定位并给出已实跑验证的修复方案；**未经 CI 复验不标 FIXED** |
| **R-25** | 运行时上传数据被误提交入仓 | 🟡 **已缓解 —— 历史仍可达，与 R-01 同源** —— `.gitignore` + `git rm --cached` 已执行；18 个占位 PNG **仍在 Git 历史**，彻底消除需授权改写历史 |

### 七、不包含（未实现，如实标注）

- **容器级升级实跑** —— 升级脚本自检（62 项断言）已在沙箱通过，但**真实容器级升级仍需带 Docker 的环境复跑**。
- **Docker 验证 1~8 项、Redis 故障注入** —— 取证通道已就绪，**本轮尚未实跑**。
- **真实 SMTP 投递** —— 未配置，仅做静态核查。
- **多浏览器 E2E（Firefox / Safari）** —— 本机仅 Chromium / Edge。
- **原站需登录的 7 个页面 × 4 视口 = 28 条视觉对照** —— 无权访问他人账号，不拿游客态冒充。
- **四身份 UI 缺口（R-21 / R-24）** —— **本轮处理中，未闭环**。
- **CI 单元测试红灯（R-26 / V4-17）** —— `tests/floor-continuity.spec.ts` 在 CI 崩溃，
  5 条被跳过，`e2e` job 被连带跳过 ⇒ **153 条 E2E 在 CI 上从未跑过一条**。**本轮修复中，待 CI 复验**。
- **R-25 的历史残留** —— 18 个公开占位 PNG **仍在 Git 历史里**（内容无害：无用户数据、无凭据），
  彻底消除需**主人单独授权**改写历史。
- **远端 Git 历史改写** —— 仅在隔离副本演练成功（`docs/HISTORY_CLEANUP_DRILL_v0.0.4.md`），
  状态 **DEFERRED，待主人单独授权**；仓库保持 Public。

---

## [0.0.3] - 2026-11-04

> 早期开发预览版（Pre-release）。功能尚未完备，**不建议用于生产环境**。
> 界面与原站存在差异，**不保证与 V2EX 完全一致**。
>
> 本小节只记录**本轮实际做过并验证过的事**。未实现的能力列在「不包含」，
> 不以任何形式（包括占位按钮、静态演示数据）冒充已实现。

### 数据库

- 新增 **8 张表** + `topics`/`replies` 各 **5 个新字段**（26 表 / 12 枚举）：
  - `edit_history` —— 主题与回复的编辑历史快照（**只 INSERT，不可变**）
  - `password_reset_tokens` —— **只存 sha256 哈希**；含 `expires_at`/`used_at`/`revoked_at` 三重状态
  - `credit_ledger` —— 积分流水账本（含 `balance_before`/`balance_after` 快照与幂等键）
  - `daily_checkins` —— 每日签到（`(user_id, checkin_date)` 唯一）
  - `reports` —— 举报与处理记录
  - `node_requests` —— 节点创建申请
  - `avatars` —— 头像文件元数据
  - `email_logs` —— 邮件发送日志（**收件人脱敏**）
  - `topics`/`replies` 新增 `deleted_at`/`deleted_by`/`deleted_reason`/`edited_at`/`edit_count`
- 软删除**沿用已有的 `topic_status` 枚举**，不新增枚举值 —— 避免破坏 v0.0.2 已有数据。
- 迁移 `0001_striped_magdalene.sql` 做**完全幂等化**：
  `CREATE TABLE`/`CREATE INDEX`/`ADD COLUMN` 加 `IF NOT EXISTS`；
  `CREATE TYPE`/`ADD CONSTRAINT` 包入 `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
  （PostgreSQL 不支持 `CREATE TYPE IF NOT EXISTS`）。
- **迁移幂等性实测**：连续应用 3 次全部 `exit=0`，最终 26 表 / 38 约束。

### 主题与回复系统

- 主题**编辑 / 软删除 / 恢复**，回复**编辑 / 软删除 / 恢复**
- 主题**锁定 / 解锁 / 置顶 / 取消置顶**（仅 moderator/admin，全部写 `moderation_logs`）
- **可配置编辑时间限制**（`TOPIC_EDIT_WINDOW_MINUTES`，默认 60 分钟；管理角色不受限）
- **编辑历史**：每次编辑写入前后快照，仅作者本人或 staff 可查看
- **回复引用**（`replies.quoteId`）与楼层锚点跳转
- **主题投票**、**回复感谢** —— 唯一索引保证幂等，改票按差额 ±2 调整汇总
- **已删除内容不泄露**：列表与详情默认过滤；仅 staff/作者可用 `?includeDeleted=true` 显式查看
- 楼层号用 `floor_counters` 原子 UPSERT 分配 —— **12 并发回复楼层号无重复**

### 用户与账户系统

- **邮件找回密码**：防邮箱枚举（邮箱存在与否**响应完全一致**）；
  按 IP + 按邮箱哈希**双重限流**；**未配置 SMTP 时如实返回「未送达」，绝不假装已发送**
- **一次性重置令牌**：只存哈希；过期/撤销/已使用三重防护；
  消费用 `UPDATE ... WHERE used_at IS NULL` —— **8 并发消费只有一个成功**
- **改密后旧会话全部失效**（删除该用户 `sessions` 记录）
- **零依赖 SMTP 客户端**（`src/lib/smtp-client.ts`）—— 不引入 `nodemailer`，避免扩大供应链面
- **头像上传**：magic number 嗅探（**不信任 MIME 声明**）、大小上限、
  **服务端生成随机存储路径**（防路径穿越与覆盖）
- **修改资料**（`PATCH /api/users/me`）：只改本人；`url` 仅允许 http/https（防 `javascript:` 伪协议）
- **关注 / 取消关注**、**关注用户的主题列表**、**通知已读/全部已读/删除**

### 社区积分与互动机制

- **不可篡改的积分账本**（`credit_ledger`）：只 INSERT，含变动前后余额快照与幂等键
- **并发安全**：`SELECT ... FOR UPDATE` 行锁 + 幂等键唯一索引
  —— **30 并发扣 10 分恰好成功 10 次，余额为 0（未变负）**
- **余额不足拒绝扣费**并回滚，绝不产生负余额
- **每日签到**（同一天只发一次；连续签到天数递增）、**积分排行榜**、**活跃度统计**
- 管理员调整积分并写审计日志
- ⚠️ **积分额度为独立实现**：可观察依据只有 `users.balance` 字段注释与 `credit_ledger` 枚举，
  具体数值无从确证，故全部做成可配置（`TOPIC_CREDITS`/`REPLY_CREDITS`/`CHECKIN_CREDITS` 等），
  **不声称复刻原站真实数值**。

### 节点与内容分发

- **节点分类 / 子节点 / 面包屑**（面包屑含环检测，最多 10 层）
- **节点创建审批**：普通用户申请 → 管理员审批 → 真正创建节点并回填 `approved_node_id`
- **节点主题数与最新回复统计**（实时查询，不依赖可能滞后的缓存字段）
- **搜索**：参数化查询（**绝不拼接 SQL**）、分页上限 100、
  排序 `relevance`/`createdAt`/`repliesCount`、按节点/作者/时间范围过滤
- **Feed**：全站 RSS 2.0 / Atom 1.0 / JSON Feed 1.1 + 节点 RSS 2.0
  —— 全部输出**真实数据库内容**，软删除主题不出现，Content-Type 精确

### 后台管理

- **13 个管理 API**，统一走 `adminGuard`/`adminGuardWrite` 守卫：
  未登录 → **401**，角色不足 → **403**
- 用户列表/搜索/角色变更/封禁/解封、举报列表与处理、待审核聚合、
  内容隐藏与恢复、节点审批、操作日志、系统配置（**凭据一律脱敏**）、社区统计
- **不提供未经验证的危险操作** —— 没有删除用户、执行任意 SQL、修改配置的接口
  （`tests/admin-permissions.spec.ts` 会扫描路由目录验证这一点）
- 管理员**不能把自己降级**（防系统锁死）；moderator **不能封禁 admin**
- **封禁用户立即失效其全部会话**

### 视觉与响应式

- 新增 **600px / 500px 断点**（沿用原站 `combo.css` 的断点值），此前本地**零 `@media`**
- ≤600px：解除 `.content` 的 `min-width:600px`（窄屏横向滚动的根因）、
  `#Main` 占满、`#Rightbar` 改 flex `order` 排在主区之后、表单元素占满宽度
- `.fa` 图标类由 `float:left` 改为 `inline-block`（与原站 `combo.css` 对齐）
- **键盘可访问性**：`:focus-visible` 焦点可见；尊重 `prefers-reduced-motion`
- 视觉差异量化：1280/1920 视口 **Δx 一致率 96.9%**（几何量测，非像素相似率声明）

### 文档

- 新增 `FEATURE_MATRIX.md`（58 项逐项标注实现位置与证据）、
  `API_SPEC.md`（55 路由 / 72 端点，由源码提取）、
  `DATABASE_SCHEMA.md`（26 表 / 12 枚举，由运行中的数据库读取）、
  `docs/VISUAL_DIFF_REPORT.md`、`TEST_REPORT.md`、`docs/UPGRADE-v0.0.3.md`
- README 版本号与真实实现对齐（此前仍写 v0.0.1）

### 测试

- 单元测试 **185/185 全绿**（v0.0.2 基线 117 条全部保留 + 新增 68 条），零回归
  —— ⚠️ **这是 v0.0.3 的历史总数**（master @ `37710fb4`，14 个 spec 文件）；
  v0.0.4 的权威基线是 **190/190（15 文件）**，口径澄清见文首 `[Unreleased]` §5.1
- 新增 5 个测试文件，覆盖正常流程/非法输入/越权/重复请求/并发/数据一致性
- 真实 HTTP 端到端验证（真实 `next start` + 真实 PostgreSQL）：
  投票幂等、感谢自己的回复被拒、签到幂等、未登录 401、越权 403、
  **软删除主题对普通访问者返回 404（不泄露）**

### 不包含

- **未实现**：举报的前端入口、节点申请的前端页面、站内 Feed 聚合页、
  PostgreSQL 全文搜索、多语言、私信
- **部分实现**：邮件**真实投递**（SMTP 客户端与令牌流程已实现并测试，
  但本机未配置真实 SMTP 服务器，未验证真实送达）；
  头像**自动裁剪**（未安装 `sharp`，当前降级为保存原图）
- **未执行**：镜像漏洞扫描（Trivy/Grype，本机无 Docker）、多浏览器视觉回归、
  基础负载测试（k6）
- **未做**：原站移动版比对（无原站移动版证据；本项目窄屏为独立替代实现）

## [0.0.2] - 2026-11-04

> 早期开发预览版（Pre-release）。功能尚未完备，**不建议用于生产环境**。
> 界面与原站存在差异，**不保证与 V2EX 完全一致**。
>
> **本小节只记录「供应链 / CI/CD / 容器 / 文档」四个方面本轮实际做过的事。**
> 应用层（业务逻辑、接口、界面）的变更由对应负责人另行补充 ——
> 本节**不代为声明**，以免夸大。

### 供应链

- **修复** 4 个 moderate 依赖漏洞（`npm audit` 由 4 降为 **0**）：
  `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild@0.18.20`
  （GHSA-67mh-4wv8-2f99，「esbuild 开发服务器可被任意网站跨域读取响应」）。
  通过 `overrides` 把 `@esbuild-kit/core-utils` 下的 esbuild 钉到 `^0.25.0`，
  实际解析为 **0.25.12**（受影响范围 `<=0.24.2`）。
- **未降低扫描等级**：发布流水线的漏洞门禁（critical / high 即中止发布）**一个字未改**；
  漏洞数是**降下来的**，不是被藏起来的。
- 修复后**迁移能力实测未损坏**：`drizzle-kit generate` 与 `drizzle-kit migrate` 均成功，
  `tsc --noEmit` 0 错误，`vitest` **103/103** 全绿，`next build` 成功。
- 补充证据：该漏洞路径在生产**结构性不可达** ——
  `drizzle-kit` 虽声明了 `@esbuild-kit/esm-loader` 依赖，但**从不 import 它**；
  它实际加载的是 `drizzle-kit/node_modules/esbuild`（0.25.12，本就安全）。

### 容器与部署

- **修复** 生产镜像携带全部 devDependencies 的问题：
  Dockerfile 的运行层此前 `COPY --from=builder /app/node_modules`，把含
  `@playwright/test`、`vitest`、`typescript`、`@types/*` 的**完整** `node_modules`
  （本机实测 530 MB）打进了生产镜像 —— 同时把漏洞版 esbuild 也一起带了出去。
  现改为在运行层执行 `npm ci --omit=dev`，按依赖图只装生产依赖。
- 为此把 `drizzle-kit` 与 `tsx` 从 `devDependencies` **上移到 `dependencies`** ——
  它们不是测试工具，而是容器 entrypoint 的**真实运行时依赖**
  （阶段 1 迁移、阶段 2 首次初始化分别直接调用它们）。
  实测 `npm ci --omit=dev` 后 `drizzle-kit/bin.cjs`、`tsx/dist/cli.mjs`、
  `next/dist/bin/next` 三个路径均存在。
- **修复** `playwright-core`（14 MB）仍进生产镜像的问题。
  根因是 `next@15.5.28` 把 `@playwright/test` 声明为 `peerOptional`，
  npm 会自动安装 optional peer —— `--omit=dev` 裁不掉，
  `--omit=peer` 也**无效**（实测仍装 73 包 / 429 MB）。
  改为安装后显式删除，并加**防回归护栏**：删除后断言三个 entrypoint
  路径仍在，否则**构建当场失败**（而不是等容器启动时才炸）。
  依据：实测 next 的运行时代码（`dist/server/**`）**零处**引用 playwright，
  仅 `next test` / `experimental-test` 引用 —— 本项目不使用这些路径。
- **实测验证裁剪后的生产依赖闭包真的能跑**（无需 Docker）：
  - `npm audit --omit=dev --audit-level=moderate` → **found 0 vulnerabilities**
  - 依赖体积 429 MB →（删 playwright 后）**411 MB**
  - 裁剪后 `next build` ✓ Compiled successfully
  - 裁剪后 `next start` + 真实数据库：`/` `/signin` `/signup` `/nodes`
    `/api/captcha` `/t/1` **全部 200**，日志 `MODULE_NOT_FOUND` 计数 **0**
  - 裁剪后 `drizzle-kit migrate` ✓ 18 张表；`tsx` 跑 seed ✓ 完成
  - 漏洞版 esbuild 0.18.20 **已不在**生产依赖闭包内（解析为 0.25.12）
- 生产镜像**不含**原站版权素材、`.env`、凭据文件 —— 由发布流水线的
  「核验镜像不含敏感文件」步骤在真实镜像上 `docker run` 实测。

### CI/CD

- **修复** `ci.yml` 全部 action 使用 node20 版本、会在启动阶段直接失败的问题。
  GitHub 已于 2026-09-23 移除 runner 的 Node 20 运行时，且
  `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` 退避开关同时失效。
  `ci.yml` 的 `actions/checkout@v4` / `setup-node@v4` / `upload-artifact@v4`
  已全部升级到 node24 版本（`@v7`）—— 与 `release.yml` 对齐。
- **修复** 发布流水线的 `dry_run` 开关**从未生效**的问题。
  该开关此前被声明、被输出、被打印，但**没有被任何 `if:` 消费**，
  导致手动触发时勾选「仅验证」依然会推送镜像并创建 Release。
  现已让 `dry_run=true` 真正做到：不登录 GHCR、不推送镜像、
  跳过 `publish-release` 与 `verify-release`；同时镜像经 artifact 传给
  `deploy-verify`，保证「只验证」仍能跑真实镜像。
- **收紧** 发布触发条件：`push` tag 的通配由 `v*` 改为**显式白名单**。
  理由：`v*` 会把任意形如 `vX.Y.Z` 的 tag 都变成发布触发器，
  而发布流水线带 `packages:write` 与 `contents:write`。
  当前白名单为 `v0.0.2` —— 每次发版需手动加入新版本号，这是**刻意的摩擦**。
- 审计结论（**无改动**）：两个 workflow 均**无** `pull_request_target`、
  **无** `workflow_run`；`release.yml` **无** `pull_request` 触发器 ——
  **未经审查的 PR 代码无法触及任何写权限 job**。
  顶层权限为 `contents: read`，仅 `build-image`（`packages: write`）
  与 `publish-release`（`contents: write`）按需提升。

### 文档

- 新增 [`docs/UPGRADE-v0.0.2.md`](docs/UPGRADE-v0.0.2.md) ——
  v0.0.1 → v0.0.2 的升级步骤、验证清单、回滚说明、已知问题。
- 新增 [`docs/RELEASE_GATE_v0.0.2.md`](docs/RELEASE_GATE_v0.0.2.md) ——
  v0.0.2 的发布门槛检查单（缺陷 / 供应链 / CI 权限 / 产物 / 部署 / 安装 / 合规 / 密钥 / 文档）。
- 新增 [`docs/SECURITY_EXCEPTIONS.md`](docs/SECURITY_EXCEPTIONS.md) ——
  已评估并接受的风险例外登记表，每条含可复核证据与**到期日**。
- 更新 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) ——
  镜像地址更新为 `ghcr.io/alicia1030su/v2ex-clone:v0.0.2`；
  新增「GHCR 可见性说明」小节（public 包可匿名拉取；
  `denied` 的三种处理方式）；回滚小节补充「**tag 不可移动，已发布版本一律不覆盖**」；
  已知限制新增 3 条（生产镜像不含测试工具链 / 镜像体积与非 root 本机未实测 /
  Windows 只有 `install.ps1`）。
- 发行包版本号统一更新为 `0.0.2`（`deploy/VERSION`、`deploy/.env.example`
  的 `V2EX_IMAGE`、`deploy/docker-compose.yml` 的镜像默认值，
  以及 `install.sh` / `install.ps1` / `update.sh` 等脚本内的默认值）。

### 已知限制

本节**只列本轮新增或变化了的限制**；v0.0.1 已有的限制见下方 v0.0.1 小节。

- **生产镜像不再包含测试工具链** —— 若曾在生产容器里跑 `npx vitest` / `npx playwright`，
  现在会报「找不到模块」。这是**预期行为**，测试应在源码仓库或 CI 里跑。
- **镜像体积与非 root 运行的实测未能在本机完成** —— 开发环境没有 Docker。
  由 CI 的 `docker` job 与发布流水线在真实 Docker 环境验证；
  见 `docs/SECURITY_EXCEPTIONS.md` E-05。
- **Windows 发行包只有 `install.ps1`** —— `backup.sh` / `restore.sh` / `update.sh` /
  `start.sh` / `stop.sh` 均无 `.ps1` 对应版本，Windows 用户需按
  `docs/UPGRADE-v0.0.2.md` §3.2 / §5.4 的手工步骤操作。
- **Git 历史中的原站版权素材仍未清理** —— 本轮**未执行**（需单独授权改写历史或移动 tag）。
  详见 `docs/SECURITY_EXCEPTIONS.md` E-02 与 `RISK_REGISTER.md` R-01。

### 不包含

- 本轮**未**引入任何新的用户可见功能。
- 本轮**未**新增数据库迁移 —— v0.0.2 的数据库结构与 v0.0.1 相同。
- 本轮**未**接入任何大模型 API，因此**不存在** API Key 轮换与配额告警的运维负担。
  （若将来接入，必须先补齐密钥托管位置、轮换周期与配额告警阈值。）
- 本轮**未**执行任何远端写操作（未 push、未创建 tag、未创建 Release、未运行远程 workflow）——
  这些由仓库主人执行。

## [0.0.1] - 2026-11-03

> 早期开发预览版（Pre-release）。功能尚未完备，**不建议用于生产环境**。
> 界面与原站存在差异，**不保证与 V2EX 完全一致**。

### 新增

**账号体系**

- 注册、登录、退出、会话保持、修改密码全链路打通。
- 用户名唯一性由数据库唯一索引在 `lower(username)` 上强制，大小写不敏感。
- 账号状态分级（`active` / `suspended` / `banned`），登录时校验，被封禁账号返回 403。
- 服务端生成 SVG 验证码（320×80）：答案只存哈希、字段名哈希化、一次性消费。
- 用户个人主页（`/member/[username]`）。

**内容体系**

- 节点（分类）：节点列表、节点详情、子节点树、节点创建（管理员直生效 / 版主进待审）、节点审核、节点收藏。
- 主题：发布、列表（首页 / 节点页）、详情、浏览计数、Markdown 渲染。
- 回复：发布、楼层号分配、回复计数同步、分页；主题锁定时拒绝回复。
- 收藏：主题与节点两类独立收藏语义，支持取消收藏，收藏列表页 `/bookmarks`。
- 通知：回复通知自动生成、未读计数、通知列表页 `/notifications`。
- 搜索：顶栏 AJAX 联想建议、搜索结果页，支持主题 / 节点 / 会员三类检索。

**管理与权限**

- 三级角色体系：`user` / `moderator` / `admin`，操作级权限校验。
- 基础后台管理：`/admin` 概览、待审节点列表、操作日志（`moderation_logs`）。
- 运维 CLI（`npm run admin`）：`set-password` / `set-role` / `list-admins`，
  需 `ADMIN_CLI_TOKEN` 授权、`--reason` 必填、写入审计日志、拒绝降级最后一个管理员。

**数据与基础设施**

- PostgreSQL 17 持久化，18 张表，Drizzle ORM 迁移（`drizzle-kit migrate`）。
- Redis 7 可选接入；**未配置 Redis 时自动降级到 PostgreSQL**（语义等价，性能略低）。
- 键值抽象层（`src/lib/kv.ts`）统一 `get / set / del / incrWindow / clearAll`，
  Redis 与 PostgreSQL 两种实现行为一致。
- Docker 多阶段镜像（deps → builder → runner）+ Docker Compose 编排。
- 容器启动**三阶段分离**：迁移 → 首次初始化 → 启动应用（`scripts/docker-entrypoint.sh`）。
- PostgreSQL 与 Redis 配置 healthcheck，app 服务等待两者健康后再启动。
- Compose 默认**不向宿主机暴露**数据库与缓存端口，仅在内部网络可达。
- GitHub Actions CI 三个 job：类型检查 / 单元测试、E2E、Docker 镜像构建与启动验证。

**文档**

- 新增安装手册 `docs/INSTALL.md`、部署手册 `docs/DEPLOYMENT.md`、发布检查清单 `docs/RELEASE_CHECKLIST.md`。
- 新增本文件 `CHANGELOG.md`。

### 修复

- **seed 覆盖已有账号口令**：seed 改为「只初始化、不修改」，账号已存在时不覆盖其口令与角色；
  首次初始化由 `kv_store` 中的初始化标记守卫，重启与重新部署不再重置管理员口令、不再重复写入演示数据。
- **Docker 镜像构建失败**：数据库连接池改为惰性初始化并始终缓存在 `globalThis`，
  构建期不再需要数据库连接；同时修正 Dockerfile 的拷贝清单（补入 `src/db`，修复容器启动时 seed 崩溃）。
- **楼层号计数器漂移**：新增 `allocateFloor` 自愈逻辑，计数器与实际楼层不一致时自动重建，
  修复并发回复下楼层号重复导致回复接口 500 的问题。
- **配置 Redis 时「清空限流」静默失效**：限流计数器随实现存放在 Redis 或 PostgreSQL，
  原实现只清数据库表，导致配了 Redis 时清空操作静默无效（端点返回 200 但配额未清）；
  KV 抽象新增 `clearAll`，两种后端都能真正清空。
- **verify.sh 跨平台化**：移除写死的本机 Windows 路径，数据库操作统一走 Node 脚本
  （不再依赖 `psql` / `pg_dump` 命令行工具），进程管理区分 Windows（`taskkill`）与 POSIX（`kill`）。
- **verify.sh 端口匹配错误**：`netstat` 输出中端口后跟空白再跟状态列，原匹配模式 `":$PORT"`
  会误匹配 `:30301` 之类的端口，导致残留旧服务占端口、E2E 打到连着别的数据库的旧实例；
  已修正为 `":${PORT}[[:space:]]"` 并增加端口就绪断言。
- **`.gitignore` 规则未命中视口子目录**：gitignore 的 `*` 不跨越目录分隔符，
  原规则 `docs/evidence/screenshots/ref-*.png` 从未生效，30 张原站参考截图一直被 Git 跟踪；
  改为 `docs/evidence/screenshots/**/ref-*.png` 后才真正覆盖任意深度的视口子目录。
- **CI 限流参数被调高**：为「让测试跑快点」而调高限流阈值会导致限流用例永远等不到 429；
  已改回与生产一致的默认值，限流覆盖恢复正常。

### 安全

- **CSRF 防护**：显式双提交 Cookie 模式 —— 服务端下发 `v2_csrf` Cookie，
  页面把同一 token 注入表单隐藏字段 / 请求头，写操作时用 `timingSafeEqual` 比对。
- **XSS 清洗**：正文渲染前经 `sanitize-html` 白名单过滤（标签、属性、协议、样式），
  拒绝 `javascript:` 协议与 `data:image/svg+xml`，移除 `on*` 事件处理器，
  外链自动补 `rel="noopener noreferrer"`。
- **开放跳转防护**：`sanitizeRedirect` 仅允许站内相对路径，拒绝外部绝对 URL 与协议相对 URL。
- **安全响应头**：`X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy`。
- **密码哈希**：scrypt + 随机 salt，不存储明文，不使用 bcryptjs 之外的弱方案。
- **会话安全**：服务端 session 表 + HttpOnly / SameSite=Lax Cookie。
- **限流**：登录、注册、发帖、回复、建节点均有限流；
  登录与注册按「IP + 账号名」双维度计数，Redis 缺失时降级到 PostgreSQL，限流不会因缺 Redis 而失效。
- **验证码哈希化一次性**：答案与字段名均只存哈希，校验后立即作废，服务端不保存明文答案。
- **数据库端口默认不暴露**：Compose 中 PostgreSQL / Redis 仅在内部网络可达。
- **运行时开关收敛**：`DISABLE_CAPTCHA` 仅在 `APP_RUNTIME_ENV=test` 且 `TEST_ENV_ISOLATED=1` 的
  隔离测试环境生效，生产与预发环境即使误配也强制启用验证码。
- **调试端点鉴权**：`/api/debug/*` 需显式开关 + `DEBUG_ENDPOINT_TOKEN` 令牌（恒定时间比较），
  未配置令牌时一律返回 404。
- **管理员口令强度**：生产环境必须显式设置 `SEED_ADMIN_PASSWORD`（≥12 位），否则 seed 直接报错退出，
  不接受任何弱默认口令。
- **示例配置无凭据**：`.env.example` 不提供任何可用的默认口令，Compose 中必需变量缺失即启动失败。

### 已知限制

- **未经生产环境验证**：本版本仅在开发机与 CI 的隔离容器中验证过，
  未做过压力测试、未做过长时间运行稳定性验证、未在真实生产环境跑过。
- **Redis 路径未在真实 Redis 上做过长时间验证**：CI 使用 service container 提供 Redis，
  单元与 E2E 覆盖了清空限流在 Redis 下的行为，但未做性能与边界行为的长期观测。
- **未实现的交互**：投票（顶 / 踩）、回复感谢（❤️）、通知已读标记、引用回复 ——
  对应的数据表与计数字段已建，但**点击交互未接通**，页面上不提供可用的按钮。
- **未实现的完整流程**：邮件找回密码（页面已复刻入口，后端邮件发送未实现）、
  关注用户与关注流（`follows` 表已建，首页无「关注」tab）、
  积分排行榜与每日登录加分（`users.balance` 字段与发帖 +10 已实现）。
- **未实现的输出格式**：节点 RSS / JSON Feed 仅复刻了入口位置，没有真正的生成器。
- **未实现的内容扩展**：主题标签、附件上传、私信、头像上传。
- **主题编辑与删除**：仅有软删除字段与后台可见性，缺 UI 与 API。
- **第三方登录**：Google / Solana 需要外部凭据与钱包签名，无可用测试账号，UI 以禁用态呈现。
- **演示账号只在非生产环境创建**：`SEED_DEMO_USERS=1` 时创建 `lisi` / `wangwu` / `zhaoliu` / `moderator`；
  生产环境（`APP_RUNTIME_ENV=production`）自动禁用演示账号创建。
- **版本号与界面差异**：v0.0.1 是**开发预览版**，页面与原站存在差异，
  **不保证与 V2EX 完全一致**。

### 不包含

以下能力在 v0.0.1 中**完全未实现**，不提供任何形式的假实现（无占位按钮、无假接口、无静态演示数据）：

| 能力 | 说明 |
|---|---|
| 主题编辑 | 作者无法编辑已发布主题 |
| 主题删除 | 作者无法删除已发布主题 |
| 回复感谢（thank） | `thanks` 表与计数已建，点击交互未接 |
| 关注用户 / 关注流 | `follows` 表已建，无 UI |
| 积分排行榜 | 无排行榜页面 |
| 每日登录加分 | 无此逻辑 |
| RSS 输出 | 无 RSS / JSON Feed 生成器 |
| 邮件找回密码 | 页面已复刻，邮件流程未实现 |
| 主题标签 | 无标签体系 |
| 附件上传 | 无上传能力 |
| 私信 | 无站内信 |
| 头像上传 | 使用默认头像 |
| 第三方登录 | Google / Solana 未接入 |
| 投票（顶 / 踩） | `votes` 表已建，交互未接 |

[0.0.2]: https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.2
[0.0.1]: https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.1
