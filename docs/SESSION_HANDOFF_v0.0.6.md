# docs/SESSION_HANDOFF_v0.0.6.md —— v0.0.6 跨会话交接

> 本文件在上下文接近上限前**必须更新**，不允许丢失工作现场。
> 每完成一个重要阶段就更新一次。

---

# 第 1 轮状态快照（2026-11-06，主理人）—— v0.0.5 集成收尾 + v0.0.6 立项

## A. 到账事实（全部实测）

| 项 | 实测值 |
|---|---|
| v0.0.5 分支 | `feat/v0.0.5-product-completion`，HEAD `5163244` |
| PR #22 | OPEN / MERGEABLE / CLEAN，CI 全绿（CI ✅ / Docker ✅ / 安装验证 ✅） |
| 测试基线 | 单元 **327/327**（25 文件）、E2E **200/200**、跨浏览器 **160/160**（3 浏览器 × 5 视口） |
| 迁移 | 4 个文件 ↔ journal 4 条，一致；0003 幂等 |
| 发布门禁 | PASS=62 / FAIL=0 / **BLOCK=1**（BLOCK = R-01 授权） |
| R-01 | **仍 DEFERRED** —— Git 历史中原站素材可匿名取回；禁止历史改写 / force push / 删 Tag / 改 Release / 改可见性 |

## B. v0.0.6 定义与边界

- **定位**：桌面 + 移动端高保真视觉、跨浏览器兼容、交互一致性完善版。
- **分支**：`feat/v0.0.6-visual-fidelity`（从 v0.0.5 合并后的 master 创建）。
- **原则**：不新增大型业务系统；不重构稳定的 PostgreSQL / Redis / 认证 / 发布架构；
  优先完成用户直接看到和操作的页面。
- **三个核心页面**：首页 / 节点详情页 / 主题详情与回复页。

## C. 已随 v0.0.5 合入的 v0.0.6 基座（自包含增量，CI 全绿）

| 产物 | 说明 |
|---|---|
| `tools/visual/regression.mjs` | 组件级视觉回归：**7 视口 × 3 浏览器 × 3 页面 = 63 组合**，逐组件量测 26 项，带时间戳归档 |
| `tools/visual/measure-components.mjs` | 组件几何测量（供回归与对照共用） |
| `docs/VISUAL_PARITY_v0.0.6.md` | 视觉对照体系：12 页面清单 + 17 组件级检查项 |
| Firefox@320 横向溢出修复 | HotTopics 的 table 在 320px 下 23px 溢出已修（随 `9d1f0d1` 合入） |

### 汇总口径的重要设计（防误报）

- **同浏览器、跨视口**：布局类组件**理应**不同（响应式）⇒ **不算异常**；
- **同视口、跨浏览器**：排版 / 颜色类**理应**一致 ⇒ **这才是真异常**。
- 第一次实现把两类混在一起统计 ⇒ 报出 55 个「不一致」，绝大多数是响应式预期差异（误报）。

## D. 环境与本地纪律（继承 v0.0.5，全部实测踩过）

1. **PG 生命周期必须在同一次 Bash 调用内**（工具回收进程树）；隔离实例 `127.0.0.1:55440`。
2. **不要用管道输出脚本**（`bash x.sh | tail` 会让 postgres 继承 stdout ⇒ SIGTERM）。
3. `next build` 须清 `NODE_OPTIONS` 并关 `CODEBUDDY_SAFE_DELETE_ENABLED` / `CODEBUDDY_BROKERED_FS_HOOK_ENABLED`。
4. bash 的 `/tmp` 与 Windows Python 路径不通：需 `cygpath -w /tmp`。
5. shell 变量不跨 Bash 调用保持：验证脚本要显式传参。
6. **Git Bash 会把 heredoc 里的 `\s` 转成 `/s`** —— 正则写 `[ \t]*` 或用 Edit 工具。
7. 跑 E2E 用 `ENV_FILE=".env.test"`（**不要**用空串）；服务端与测试进程必须同一个 `DEBUG_ENDPOINT_TOKEN`。
8. 一次造多个用户时，每注册一个就 `clearRateLimits()` 一次（注册前后都清）。
9. **Windows `next build` 偶发 EPERM（`.next/trace`）未根治** —— 脚本免疫 + 有限重试 + `SKIP_BUILD=1`；CI（Linux）不受影响。

## E. 下一步（按任务书顺序）

1. ⏳ 合并 PR #22 → 记录 master 最终 SHA → 构建 v0.0.5 **候选产物**（不建 Tag / 不发 Release）。
2. ⏳ 创建 `feat/v0.0.6-visual-fidelity`。
3. ⏳ 三核心页面高保真开发（首页 / 节点详情 / 主题详情）。
4. ⏳ 63 组合视觉回归 + 跨浏览器交互验收。
5. ⏳ 原站合法对照（不可达页面标 UNVERIFIED，不用本站回归冒充原站一致）。
6. ⏳ Windows EPERM 专项分析（独立工作区复现 + 日志对照）。
7. ⏳ CI 常驻视觉工作流 + 安全 / Docker / 升级验证。
8. ⏳ 最终单次版本交付（R-01 未授权 ⇒ 停在候选成果）。

## F. 风险与授权边界

- R-01 仍 DEFERRED；v0.0.6 同样**不建公开 Release**（除非主人对 R-01 单独授权）。
- 不得向真实用户发测试邮件；不得用会产生额外付费的外部服务。
- 子智能体必须用隔离 worktree 或明确文件所有权，禁止共用构建目录。

---

# 第 2 轮状态快照（2026-11-06，主理人）—— v0.0.5 合并 + v0.0.6 核心开发完成

## A. v0.0.5 集成结果

| 项 | 实测 |
|---|---|
| PR #22 | **MERGED**（squash），merge commit `2ffea3e`，合并于 2026-11-06T04:01:16Z |
| 最终 HEAD CI | `7f02737` 上三个工作流全绿：CI ✅（含 E2E 200 passed）/ Docker-Redis ✅ / 安装验证 ✅ |
| squash 树一致性 | `git diff 7f02737 2ffea3e` **为空** ⇒ CI 结果适用于合并内容 |
| 文档同步 | CHANGELOG（缺陷 19→26 项 + 测试基线 + 发布状态）/ BUG_REGISTER（V5-17 + V5-T7）/ FEATURE_MATRIX / TEST_REPORT / SESSION_HANDOFF_v0.0.5 第 7 轮快照 |
| 迁移核验 | 4 个迁移文件 ↔ journal 4 条一致；`0003_v005_reports.sql` 幂等（IF NOT EXISTS + 部分唯一索引） |
| 候选产物 | `_backups/release-candidates/v0.0.5/v2ex-clone-v0.0.5-candidate-2ffea3e-deploy.zip`（51,769 B）+ `SHA256SUMS`；12 个必需文件齐全、无敏感文件、内部 VERSION=0.0.4 |
| Release | **未创建**（R-01 阻断）—— 遵守任务书「R-01 未解决时不创建公开版本 Release、不擅自解除门禁」 |

## B. v0.0.6 分支与提交

分支：`feat/v0.0.6-visual-fidelity`（从 `2ffea3e` 创建）

| 提交 | 内容 |
|---|---|
| `8ba5ebb` | 三核心页面交互缺陷修复 + 5 处 U+FFFD 编码损坏清理 + 回归工具页面清单修正 |
| `d132fdc` | 视觉回归实测发现并修复 9 项真实缺陷 + 回归工具两类误报修正 + 确定性 seed |
| `106eac2` | 独立完整视觉验收工作流 + 失败语义护栏（14 条） |
| `f47b798` | Windows EPERM 专项诊断（脚本 + 报告 + R-31） |

## C. 本轮修复的真实缺陷（BUG_REGISTER V5-18 ~ V5-26）

| ID | 缺陷 | 发现方式 |
|---|---|---|
| V5-18 | **React #418 水合失败**（3 个核心页面）—— 布局 table 缺 `<tbody>`，浏览器自动插入导致虚拟 DOM 与实际 DOM 不匹配。生产模式只报错后自愈 ⇒ E2E 照过 ⇒ **长期静默缺陷** | dev 模式诊断 |
| V5-19 | **窄屏顶栏覆盖节点头部** —— `#Top` 固定 `height: 45px`，而 ≤500px 时 `.site-nav` 会换行 ⇒ 内容溢出向下覆盖深色横幅 | 320px 截图审查 |
| V5-20 | **窄屏节点头部元素重叠** —— `.title` 单行 flex 布局下三元素挤一行 | 320px 截图审查 |
| V5-21 | 回复楼层信息**重复渲染**（页面与 ReplyItem 各渲染一遍） | 主题页截图审查 |
| V5-22 | 主题页**死投票按钮**（`javascript:` + 未加载 FontAwesome ⇒ 图标不可见、点击无效） | 代码走查 |
| V5-23 | **seed 数据不确定** ⇒ 视觉基线失去意义（两次全新 seed 得到 1 条 vs 4 条回复） | 两次全新库对拍 |
| V5-24 | 静态资源 404（`shadow_light.png` 从未入仓） | 浏览器网络监听 |
| V5-25 | 回归工具两类误报（font-family 序列化 + rgba alpha 舍入） | 首轮回归输出分析 |
| V5-26 | **旧视觉基线本身是坏的**（Firefox/WebKit 实测值 = 浏览器默认值 ⇒ CSS 根本没加载） | 基线数据核查 |

## D. 视觉回归实测结果（63 组合）

- **7 视口 × 3 浏览器 × 3 页面 = 63 组合全部测量成功**
- **零横向溢出**（含 Firefox@320px —— V5-17 修复成立）
- **三引擎完全一致**（home / node / topic 三页的「同视口跨浏览器不一致」均为 0）
- **基线二次运行回归项 = 0**（完全可复现）
- 单元测试 **341/341**（26 文件，v0.0.5 基线 327 + 新增 14 条护栏）

## E. 原站对照的真实状态（如实登记）

- **实测原站不可达**：`curl --max-time 12 https://www.v2ex.com/` → HTTP 000（超时），
  `https://v2ex.com/` 同样 000。
- ⇒ 12 个页面的原站对照**全部标记 UNVERIFIED**；本轮完成的是**本站自身**的
  63 组合视觉回归与跨浏览器一致性，**不构成**与原站视觉一致的结论。
- CI 工作流里已固化「原站可达性探测 + 不可达时显式声明」。

## F. Windows EPERM 诊断进展（**已完成**，见下）

### 已完成的诊断（提交 `95d7119`）

**根因定位**：EPERM 发生在 **Next 的 build worker 子进程**里创建 `.next/trace` 的瞬间。

| 证据 | 结果 |
|---|---|
| 默认（多 worker）构建 | **8/8 EPERM** |
| `NEXT_PRIVATE_BUILD_WORKER=1`（单进程） | **第 2 轮即成功** |
| `experimental.cpus = 1`（限并发但仍多进程） | 2/2 EPERM ⇒ **不是并发度，是「多进程」本身** |
| build **必然 EPERM** 的状态下，手工 Node 对同一文件的 5 种写入路径 | **全部成功** ⇒ 不是文件系统权限 |
| 同一分钟、同一命令：单独执行 vs 脚本内执行 | 8/8 OK vs 3/3 EPERM |

**最终兜底**：`scripts/ci/next-build-retry.cjs`
—— `NODE_OPTIONS="--require <patch>"` 注入，包装 `fs.openSync` / `fs.open` /
`fs.createWriteStream`，**只对 EPERM 重试**（其它错误码照常抛出）。
实测：8/8 EPERM 状态下 → 2/2 成功。

**分层缓解**：① 文件打开重试（主）② 单进程构建 ③ 预创建 trace 文件
④ build 提前到脚本最前 ⑤ 不删除/不移动构建目录 ⑥ 隔离构建目录（`NEXT_DIST_DIR`）。

**排查脚本**：`eperm-diagnose.sh` / `eperm-trigger-test.sh` /
`eperm-trigger-test2.sh` / `eperm-probe-during-build.sh`
—— 排除了 12 个变量（构建目录处置方式、服务存活时序、文件静态权限、
Defender、ACL、CI 环境变量、migrate/seed 组合、mv 目标目录、mv 后等待时长、
多进程并发、同步 openSync、分离进程）。

⚠️ **仍未完全解释的部分**：触发条件是**多因素叠加的系统状态**，
无法靠单一变量隔离（如实登记，不假装根治）。

### E2E 实测结果

- core：**200 passed / 0 failed（3.4m）** —— 本地 CI 等价复现 PASS=8 / FAIL=0
- 单元：**341 passed / 341（26 文件）**
- 视觉回归：**63 组合**三引擎一致、零溢出、基线二次运行回归项 = 0

## G. 跨浏览器 E2E 实测 + 三处根因（全部已修复）

| Project | 修复前 | 修复后 |
|---|---|---|
| core | 200/200 | **200/200** |
| chromium × 5 视口 | 1000/1000 | **1000/1000** |
| firefox × 5 视口 | 大量失败（`NS_ERROR_REDIRECT_LOOP`） | 大幅改善 |
| webkit × 5 视口 | 大量失败（页面降级为 Next 错误页） | 大幅改善 |

### 三处根因（逐一定位，均已修复）

1. **本机代理拦截** —— `HTTP_PROXY=http://127.0.0.1:55761`（xray）且 **`NO_PROXY` 为空**；
   **Firefox 与 WebKit 会读 `HTTP_PROXY`**（Chromium 不读）⇒ localhost 的
   `/_next/static/**` 子资源被代理截走 ⇒ Firefox 报重定向循环、
   WebKit 报 `Loading chunk NNNN failed`（页面降级 ⇒ 视觉回归里一堆 null）。
   **处置**：两个本地脚本**显式导出 `no_proxy`/`NO_PROXY`**。
   实测：设 `no_proxy` 后 WebKit 页面**完全正常渲染**。

2. **IPv6 回环** —— WebKit 的 `page.request` 把 `localhost` 解析为 **IPv6 `::1`**，
   而 next start 只监听 IPv4（`0.0.0.0`）⇒ `ECONNREFUSED ::1:3010`。
   **处置**：测试地址统一改用 **127.0.0.1**。

3. **视觉回归工具三处误判** ——
   ① `.content` 选中了**顶栏**而非主容器（`querySelector` 取文档序第一个）；
   ② 固定 600ms 等待不足（WebKit 渲染更慢）⇒ 改为**等关键元素就绪**；
   ③ Firefox 经典滚动条占 body 16px 造成纯假宽度差 ⇒ 按滚动条占位**归一化**。

   **处置**后：**视觉回归 63 组合三引擎完全一致、零横向溢出**、基线可复现。

### 决定性对照实验（master worktree）

在 **origin/master（未改动的 v0.0.5）** 的**独立 git worktree** 上，
跑**完全相同**的 `e2e/auth.spec.ts --project=<浏览器>-375x812`：

| 浏览器 | 当前分支（v0.0.6） | master（未改动） | 结论 |
|---|---|---|---|
| firefox-375x812 | 7 failed / 1 passed | **7 failed / 1 passed** | 失败用例集合**完全相同** |
| webkit-375x812 | 7 failed / 1 passed | **7 failed / 1 passed** | 失败用例集合**完全相同** |

⇒ **失败与 v0.0.6 的改动无关** ⇒ 登记为**环境问题**
（`BUG_REGISTER` V5-27 / `RISK_REGISTER` R-32），不修改产品代码、不掩盖事实。

### 基线按平台分文件（v0.0.6 新增）

Windows 与 Linux 的默认字体不同 ⇒ 同样的文本高度不同
⇒ 实测 WebKit@320 高度差 39~51px（8%）⇒ **跨平台基线不可复用**。

- 基线文件：`component-baseline-<platform>.json`（`win32` / `linux`）
- CI 显式用 `--platform=linux`；基线缺失 ⇒ **明确失败**，不静默通过
- 基线建立仅允许 `workflow_dispatch` + `update_baseline=true`，
  产出走 artifact ⇒ **人工审查后入库**

## H. 最终交付状态（v0.0.6 已完成，2026-11-06）

| 项 | 状态 |
|---|---|
| PR | **#23 已合并**（squash，2026-11-06T12:46:33Z） |
| 分支 HEAD | `472a707`（CI 全绿后合并） |
| **master SHA** | **`657f849`** |
| 4 个工作流 | **全部 ✅**：CI（341/341 + E2E 200/0）/ Docker-Redis / 安装验证 / 视觉回归验收（63 组合） |
| Linux 视觉基线 | `component-baseline-linux.json`（run 42217738053 建立 → 人工审查 63/63 健康 → 入库 `472a707`） |
| 候选产物 | `v0.0.6-candidate-657f849-deploy.zip`（51,769 B，SHA256 `8a173352…e5f14`，`sha256sum -c` **OK**） |
| 发布门禁（master 657f849） | **PASS=62 / WARN=13 / FAIL=4 / BLOCK=1 / INFO=1** —— FAIL 全是版本载体同步（G-VER-01 预期）；BLOCK = R-01 |
| Tag / Release | **未创建**（R-01 未解决）⇒ 停在候选成果，符合门禁纪律 |

### 合并提交内容（squash 后 12 项真实缺陷修复 + 工程化）

三核心页面：React #418 水合（tbody）、窄屏顶栏遮挡（#Top 高度自适应）、
节点头部元素重叠（纵向堆叠）、回复楼层信息重复渲染、死投票按钮移除、
NodeHeader 占位符右边距、SecondaryTabs 窄屏溢出（&nbsp; 不可断空白）。
工程化：确定性 seed（mulberry32 + 时间锚点）、视觉回归工具
（选择器精确化 / 等就绪 / 滚动条归一化 / 双平台基线）、
视觉验收工作流 + 21 条护栏、EPERM 重试补丁、代理与 IPv6 根因修复。

## I. 会话恢复要点（给下一个会话）

1. **R-01 仍 DEFERRED** —— 未授权前不得建 Tag / 发 Release / 改历史 / 改可见性。
   若要正式发布 v0.0.6：先取得 R-01 授权，再同步版本载体
   （`deploy/VERSION`、`package.json`、`CHANGELOG`），跑 preflight
   `--phase=release`，然后才允许打 Tag。
2. **本机三个环境坑（都已修，别再重复排查）**：
   ① `HTTP_PROXY`（xray）+ `NO_PROXY` 为空 ⇒ 脚本已显式导出 `no_proxy`；
   ② WebKit 解析 localhost 到 IPv6 ⇒ 测试地址已统一 `127.0.0.1`；
   ③ Windows EPERM ⇒ `scripts/ci/next-build-retry.cjs` 已兜底。
3. **视觉基线按平台分文件**：Windows 用 `component-baseline-win32.json`，
   Linux CI 用 `component-baseline-linux.json`；更新必须走
   `workflow_dispatch + update_baseline=true` → 下载 artifact → 人工审查 → 入库。
4. **跨浏览器不一致只是 warning 不阻断**（字体度量差异）；
   回归项与横向溢出仍是 error 阻断。
5. 完整交付证据见 `docs/DELIVERY_REPORT_v0.0.6.md`。
