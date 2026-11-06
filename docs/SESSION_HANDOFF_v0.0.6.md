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

## F. Windows EPERM 诊断进展（未完结，如实记录）

- 本轮**复现了** EPERM（`scripts/ci/run-e2e-locally.sh` 运行时，
  `EPERM: operation not permitted, open '...\.next\trace'`）。
- **第一轮对照实验**（4 组 × 2 轮）：`.next` 的处置方式
  （原地删 / 同父目录移 / 跨目录移 / 同路径移走）**均 0/2 EPERM**
  ⇒ **处置方式不是触发条件**。
- **第二轮对照实验**（服务存活 / 残留子进程）首次运行**无效**
  （顺序错了：先删 `.next` 再启动服务 ⇒ 服务找不到 BUILD_ID 根本起不来），
  已修正为「先构建 → 再启动服务 → 再构建」，正在重跑。
- ⚠️ **两个「假 EPERM」干扰源已识别**（详见诊断报告 §四）：
  ① Git Bash `ln -s` 的 MSYS 文本链接；② `next-env.d.ts` 引用构建产物。
- 风险登记：**R-31**（环境级，非产品缺陷）。

## G. 下一步

1. ⏳ 等 EPERM 第二轮实验结果 → 补完诊断报告。
2. ⏳ 跑完整 E2E（core + 跨浏览器 160 条）验证 v0.0.6 改动无回归。
3. ⏳ 创建 PR → CI 全绿后合并 → 固定最终 SHA → 候选产物。
4. ⏳ 更新 CHANGELOG / FEATURE_MATRIX / TEST_REPORT 的 v0.0.6 段落。
