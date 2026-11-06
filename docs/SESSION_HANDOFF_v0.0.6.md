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
