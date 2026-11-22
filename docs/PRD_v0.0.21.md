# PRD v0.0.21 — V2EX 高保真视觉还原与 WorkBuddy 低内存研发环境

> 状态：开发候选 / 正式发布 **NO-GO**
> 语言：中文
> 项目名：`v2ex_clone`
> 技术栈：沿用现有 Next.js 15 + React 19 + TypeScript + PostgreSQL/Drizzle + Vitest + Playwright；本版不迁移框架。
> 工作分支：`release/v0.0.21-stable`
> 工作树：`C:/Users/TYMO001/WorkBuddy/ai/_worktrees/v0021-release`
> 起始基线：`origin/master` = `872ae726c84d755f81e2b8477f34eeb025cb889b`，tree = `d2041500dfb8c57c49dc211f011626a38b6cdc36`

## 1. 背景与已核实基线

本节结论均由当前仓库与 GitHub 只读核验得到，不采信未复核的交接声明。

| 项 | 核实结果 |
|---|---|
| `origin/master` | `872ae726c84d755f81e2b8477f34eeb025cb889b`（PR #85 合并提交，状态 MERGED） |
| 本地 `master` | `c8734f1eaa414264ef1319ed2c7b5690094c9812`，是 `origin/master` 的祖先；主工作区干净。**不得在本地 master 工作树写入。** |
| PR #85 | `release/v0.0.20-stable` → `master`，已合并；合并树与候选提交 `01ac923a79b9f24fda58a2cecc0f2970f8c2bd5a` 的树均为 `d2041500dfb8c57c49dc211f011626a38b6cdc36` |
| v0.0.20 候选冻结点 | 分支 HEAD `01ac923a79b9f24fda58a2cecc0f2970f8c2bd5a`；候选树 `d2041500dfb8c57c49dc211f011626a38b6cdc36` |
| v0.0.20 Tag / Release / GHCR | 均不存在：远端无 `v0.0.20` Tag；Release API 404；GHCR `:v0.0.20` manifest 404 |
| 最后正式发布 | `v0.0.19` Stable（Release id `453579475`，GitHub latest endpoint 指向该版本） |
| 发布授权 | **v0.0.20 未取得专属 A3/B1**，仓库中不存在 `docs/RISK_DECISION_v0.0.20.md`；v0.0.19 的一次性授权不继承 |
| R-01 | 保持 **DEFERRED**；不得改写历史、force push、移动/删除 Tag 或修改已发布 Release |
| 24h 单实例连续运行 | `not-completed`；不得用 1h soak 替代 |
| 已有 worktree | `v0019-release`、`v0020-release`、`v009-e2e-fix`、`v009-release-pipeline`、`v009-tests`，均无跟踪改动；本版新建 `v0021-release` |
| 现有视觉材料 | `docs/VISUAL_DIFF_REPORT.md`、`docs/VISUAL_AUTHENTICITY_v0.0.9.md`、`docs/VISUAL_PARITY_v0.0.6.md`、`docs/CROSS_BROWSER_VISUAL_REPORT_v0.0.5.md`、`docs/VISUAL_DIFF_v0.0.19.md`；不存在 `docs/VISUAL_FIDELITY_MATRIX_v0.0.21.md` |

## 2. 产品定义

### 2.1 产品目标

1. **目标 A — V2EX 高保真视觉还原**：以合法参考、可复现测量和真实浏览器交互为依据，修复 18 类页面在 5 个视口下的布局、样式、结构、状态与响应式差距；不得凭观感宣称视觉百分比。
2. **目标 B — WorkBuddy 低内存研发环境**：在不减少测试的前提下，为 Next.js 构建、Vitest、Playwright 和视觉审计提供真实进程树测量、动态内存预算、预检、监控与安全清理入口。
3. **目标 C — 可审计的交付边界**：开发内存与生产内存分开测量，完整 CI 在最终候选 SHA 上运行；未取得 v0.0.21 专属 A3/B1 前不创建 Tag、不推送正式 GHCR、不创建 Release。

### 2.2 用户故事

- As a 前端工程师，I want 逐页、逐层、逐视口的视觉差距矩阵，so that 我能按证据修复而不是凭感觉改样式。
- As a 低内存机器上的开发者，I want 命令执行前自动计算预算并在执行中监控真实进程树，so that 构建和测试不会拖垮 WorkBuddy 或触发系统级 OOM。
- As a QA 工程师，I want 低内存入口不删减/跳过着例且保留完整 CI，so that 内存优化不会掩盖功能回归。
- As a 发布负责人，I want 开发态与生产态内存证据分离、授权边界机器可校验，so that 候选成功不会被误写成正式发布成功。
- As a 项目所有者，I want 所有无法合法验证的视觉项明确标为 `UNVERIFIED`，so that 不会把独立实现误称为官方像素规格。

### 2.3 范围与非目标

**本版必须做**

- P0 内存治理先于大规模前端改造。
- P0 完成 18 类页面 × 5 视口 × 六层视觉审计，并按既定顺序实施视觉改造。
- 完成交互验收、完整 CI、开发/生产内存分开测量与最终候选冻结。
- 维护真实文档、证据路径和 No-Go/Go 判定。

**本版明确不做**

- 不重复开发楼中楼、回复图片上传、灾难恢复（DR）或权限系统；仅允许修复本版审计直接暴露的回归缺陷。
- 不以后端接口数量、功能数量或测试数量膨胀作为成功标准。
- 不复制 V2EX 官方 HTML、CSS、JS、示意图、截图或其他素材；不把历史证据重新引入当前树。
- 不宣称“像素完全一致”“视觉还原度 XX%”或“24h 已通过”。
- 未获 v0.0.21 专属 A3/B1 前，不创建/移动 Tag、不创建/修改 Release、不推送正式 GHCR。

## 3. 需求池

优先级定义：**P0 = 必须完成，否则候选 No-Go**；**P1 = 应该完成**；**P2 = 可选增强**。

### 3.1 P0 — 内存治理

| ID | 需求 | 验收要求 |
|---|---|---|
| MEM-01 | 真实进程树基线 | 对每个受测命令记录根 PID、全部后代 PID/PPID、进程名、启动/结束时间、RSS；Linux 容器 additionally 读取 cgroup limit/current。不得只记录 Node 单进程或任务管理器瞬时值。 |
| MEM-02 | 动态低内存预算 | 实现跨平台 preflight：读取有效内存上限（物理内存与 cgroup limit 取小）、系统预留、当前可用量和用户上限，输出 JSON 决策。预算公式必须可复算，不得写死单一 MB 数。 |
| MEM-03 | 预算不足 fail-closed | 无法测量有效内存、无法建立进程树或预算低于任务安全下限时，默认非零退出并给出原因；仅允许显式 `--unsafe-override`，且日志必须标记 `UNSAFE`。 |
| MEM-04 | 执行中监控 | 至少每秒采样一次进程树；输出峰值树 RSS、峰值单进程 RSS、P95 RSS、样本数、wall-clock 耗时、退出码、命令、commit、profile、机器标识。监控失败不得被静默忽略。 |
| MEM-05 | 安全清理 | 只允许终止 preflight 记录的根进程及其已确认后代；不得使用宽泛的 `taskkill /IM node.exe`、`pkill node` 或按命令行模糊匹配。不得杀死 WorkBuddy、编辑器、PostgreSQL、Redis、系统服务或进程树外进程。 |
| MEM-06 | 低内存入口 | 提供 `build:low`、`test:unit:low`、`test:e2e:low`、`visual:audit:low`（名称可调整，能力不可缺）；入口统一调用 preflight/monitor/cleanup，并生成机器可读报告。 |
| MEM-07 | 清理安全边界验证 | 注入一个进程树外探针，证明清理后仍存活；注入后代进程，证明超预算时按记录树终止；证明日志、测试结果和用户数据不会被删除。 |
| MEM-08 | 同条件前后对照 | Next build、Vitest、Playwright 各自在相同 commit、依赖、数据、环境变量、机器、命令和 warm-up 条件下各跑 3 次；报告 before/after 的峰值树 RSS 与 wall-clock 耗时。 |
| MEM-09 | 优化有效性 | 每个低内存入口 after 峰值必须低于同条件 before 峰值，且 after 耗时不得超过 `before × 1.3 + 30s`；全部用例必须通过。未达到则该项保持 `not-completed`，不得用单次幸运跑动宣称成功。 |
| MEM-10 | 开发/生产分离 | 开发态（`next dev`/Vitest/Playwright/视觉工具）与生产态（`next build` + `next start`）使用独立基线、独立报告和独立结论；不得互相替代。 |

**动态预算默认规则（实现必须参数化）**

```text
effectiveLimitMB = min(physicalMemoryMB, cgroupLimitMB)       # 有 cgroup 限制时取小
hostReserveMB   = max(1024, WORKBUDDY_RESERVE_MB)             # 默认至少 1 GiB，可显式调整
availableMB     = max(0, effectiveLimitMB - hostReserveMB)
taskBudgetMB    = min(userCeilingMB,
                      max(taskFloorMB, availableMB × taskShare))
sum(taskBudgets) + hostReserveMB <= effectiveLimitMB
```

- `taskShare` 按 Next/Vitest/Playwright 的串行执行计划分配，不得让多个重型任务同时按满额启动。
- Node 子进程的 `--max-old-space-size`、Vitest 并发/线程数、Playwright workers、Next build 并发都必须从同一预算派生。
- 默认 profile 为 `auto-low`；完整 CI 仍使用标准入口，低内存入口不得成为跳过 CI 的理由。

### 3.2 P0 — 视觉审计

#### 3.2.1 18 类页面

| # | 页面类 | 代表路由/状态 |
|---|---|---|
| 1 | 首页 | `/`，含 `tab=hot/all/r2` |
| 2 | 主题列表/分页 | `/recent`、`/hot`，含第 1/中间/末页 |
| 3 | 关注流 | `/following`，空态与非空态 |
| 4 | 节点总览 | `/nodes` |
| 5 | 节点详情 | `/go/[name]` |
| 6 | 主题详情 | `/t/[id]`，长标题/长正文/无回复/锁定态 |
| 7 | 七种回复模式 | 同一主题详情下的 classic/quote/badge/nested/tree/lines/excerpt |
| 8 | 用户页 | `/member/[username]` |
| 9 | 登录 | `/signin` |
| 10 | 注册与账号恢复 | `/signup`、`/forgot`、`/reset-password` |
| 11 | 设置 | `/settings` |
| 12 | 通知 | `/notifications`，空态/未读/已读 |
| 13 | 收藏 | `/bookmarks`，空态与非空态 |
| 14 | 搜索 | `/go/search`，无结果/有结果/建议下拉 |
| 15 | 标签页 | `/tag/[name]`，空态与非空态 |
| 16 | 积分榜 | `/leaderboard` |
| 17 | 管理与举报 | `/admin`、`/reports`，按 guest/user/moderator/admin 角色 |
| 18 | 静态、帮助与发布入口 | `/about`、`/faq`、`/privacy`、`/worldclock`、`/xna`、`/nodes/request`、`/go/new` |

#### 3.2.2 5 个视口

- `375×812`（移动）
- `390×844`（移动）
- `768×1024`（平板）
- `1280×900`（桌面）
- `1920×1080`（桌面宽屏）

移动视口必须启用触摸语义；不得只把桌面页面缩小后判定通过。

#### 3.2.3 六层视觉检查

| 层 | 必检内容 | 主要证据 |
|---|---|---|
| L1 参考资格与采集完整性 | 来源、URL、抓取时间、登录态、视口、DPR、locale、合法性；失效参考必须标 `INVALID/UNVERIFIED` | `reference-manifest.json`、采集日志 |
| L2 宏观布局几何 | 顶栏、内容容器、主栏、右栏、卡片、列表项、分页、表单的 x/y/w/h、间距、对齐、溢出 | DOM `getBoundingClientRect()` 差值 |
| L3 设计 token 与排版 | 字体、字号、字重、行高、颜色、背景、边框、圆角、阴影、图标尺寸 | computed style 差值 |
| L4 DOM/组件结构与语义 | 层级、选择器契约、标题/地标/表单标签、空节点、嵌套结构、DOM 顺序 | 结构探针 + 可访问性树 |
| L5 状态、交互与无障碍 | hover/focus/active/disabled/loading/error/empty、键盘操作、触控、ARIA、对比度、减少动效 | Playwright 交互与截图/断言 |
| L6 响应式与内容鲁棒性 | 5 视口、200% 缩放、超长字符串、0/1/多条数据、图片缺失、明暗主题、无横向溢出 | 多状态截图与布局断言 |

完整矩阵规模为 **18 × 5 × 6 = 540 条记录**。每条记录必须有以下唯一终态之一：`VERIFIED`、`INTENTIONAL_DIFFERENCE`、`UNVERIFIED`；不得留空。P0 差距不得以 `UNVERIFIED` 结案。

#### 3.2.4 合法参考与 UNVERIFIED 规则

- 只使用公开可合法获取的页面/帮助文档所确认的交互契约，或项目自有的基线截图。
- 不得下载、复制或提交官方 HTML/CSS/JS、示意图、截图；不得从 Git 历史重新检出 R-01 涉及素材。
- 官方未提供可复现像素规格时（例如 2026-11 回复模式的颜色、线宽、圆角、动画、移动端紧凑度），状态必须为 `UNVERIFIED`，并写明缺哪种参考。
- `UNVERIFIED` 不等于“无需修复”，也不等于“已经一致”；不得用历史报告或观感替它转正。
- R-01 保持 `DEFERRED`；视觉工作不得以“更相似”为由扩大素材使用范围。

#### 3.2.5 差距矩阵字段

`docs/VISUAL_FIDELITY_MATRIX_v0.0.21.md` 及机器可读配套文件必须包含：

`gap_id`、`page_class`、`route`、`auth_role`、`viewport`、`layer`、`reference_id`、`reference_url_or_path`、`captured_at`、`legal_basis`、`baseline_selector`、`baseline_value`、`current_selector`、`current_value`、`delta`、`classification`、`severity`、`status`、`evidence_before`、`evidence_after`、`owner`、`commit`、`retest_result`、`notes`。

- `classification`：A=真实布局缺陷；B=样式实现差异；C=内容数据差异；D=有意保留；E=参考不足。
- `severity`：P0/P1/P2。
- `status`：`OPEN/FIXED/VERIFIED/INTENTIONAL_DIFFERENCE/UNVERIFIED/WAIVED`。
- 只有同时具备 before/after 证据与复测结果的记录才可标 `FIXED/VERIFIED`。

#### 3.2.6 P0 视觉改造顺序

必须按以下顺序实施；前一阶段出现阻断性结构问题时先修复再进入下一阶段：

1. 首页
2. 主题列表
3. 右侧栏
4. 导航
5. 主题详情与七种回复
6. 用户页
7. 登录与设置
8. 移动端
9. 微交互

### 3.3 P0 — 交互、CI 与发行边界

| ID | 需求 | 验收要求 |
|---|---|---|
| QA-01 | 交互验收 | 所有可交互组件必须有真实点击/键盘路径；覆盖登录、导航、搜索、设置、发帖、七种回复模式、收藏、关注、通知与角色可见性。移动端至少覆盖触摸与焦点可达。 |
| QA-02 | 无运行时噪声 | 审计页面不得有 hydration 错误、未捕获 page error、控制台 error、4xx/5xx 本站资源请求或横向溢出。 |
| QA-03 | 测试数量不得减少 | 以 v0.0.20 候选为下限：单元 1122、静态 501、Chromium E2E 296、跨浏览器 15 个分片、候选包四角色 41 项。最终各项数量只能增加或持平，且 0 failed / 0 skipped（既有专用条件排除项须单独披露，不得偷换分母）。 |
| QA-04 | 完整 CI | 最终候选 SHA 上运行现有全部相关工作流与测试矩阵；低内存快速入口不能替代完整 CI，也不能删除/跳过 workflow job。 |
| QA-05 | 交互与视觉证据绑定 | 每个视觉修复必须有对应交互或结构断言；不得只改截图基线。 |
| REL-01 | 版本载体 | 开发态继续使用已核实的 `0.0.20` 载体；仅在候选冻结后按发布流程统一同步 `0.0.21` 并重新跑同一 SHA 的门禁。 |
| REL-02 | R-01 | 始终保持 `DEFERRED`；不历史改写、不 force push、不移动/删除 Tag、不改已发布 Release。 |
| REL-03 | 24h | 始终保持 `not-completed`，除非未来存在真实、单实例、连续 24h 的可复现证据；本版不得虚构。 |
| REL-04 | v0.0.21 专属授权 | 只有存在机器可校验的 `docs/RISK_DECISION_v0.0.21.md`，且 `decision_a=A3`、`decision_b=B1`、`public_release_authorized=true`、`scope=single-version`、`r01_status=DEFERRED` 时，才允许进入 Tag/GHCR/Release。旧授权不继承。 |
| REL-05 | 本任务停止边界 | 本 PRD 阶段不创建/推送 Tag，不推送正式 GHCR，不创建/修改 Release。 |

### 3.4 P1 / P2

- **P1**：为内存报告和视觉矩阵提供稳定的 JSON schema、汇总脚本与 CI 摘要；完善 200% 缩放与减少动效检查。
- **P1**：完成九阶段视觉顺序中的微交互与边界态打磨。
- **P2**：在证据齐备后增加本地可视化报告页面；不得用仪表盘替代原始证据。

## 4. UI 设计草案

- 保持现有 V2EX 风格信息架构：44px 顶栏、1060px 内容容器、770px 主栏、270px 右栏、白卡 + 灰底。
- 全局组件优先级：顶栏/搜索/导航 → 右栏卡片 → 主题行 → 主题详情/回复 → 用户/认证/设置 → 移动端重排。
- 响应式行为必须显式设计，而不是依赖桌面布局自然换行；移动端不得出现横向滚动。
- 明暗主题复用现有 `data-theme`/`data-effective-theme` 机制；图片与头像不做 CSS 反色。
- 不为本版新增管理后台、上传中心或权限配置界面。

## 5. 验收指标

### 5.1 内存

- 3 个低内存入口均有 preflight、monitor、cleanup JSON 报告。
- 每个入口都有同条件 before/after 各 3 次的峰值树 RSS 与 wall-clock 耗时；不得只报单次或只报 Node 堆内存。
- after 峰值低于 before，且 after 耗时满足 `≤ before × 1.3 + 30s`；测试全部通过。
- 开发内存与生产内存分别出结论；任一“优化”缺少对照数据即 `not-completed`。
- 清理安全测试通过：树外进程存活、记录树内后代被终止、证据文件与用户数据保留。

### 5.2 视觉

- 540 条矩阵记录完整，P0 差距全部关闭；`UNVERIFIED` 仅用于合法参考确实不足的项。
- 不输出、不宣传任何“视觉相似度/还原度百分比”。
- 每个 `FIXED/VERIFIED` 有 before/after 证据和复测结果。
- 18 类页面在 5 个视口均无横向溢出、结构缺陷、hydration 错误或本站资源失败请求。

### 5.3 测试与发行

- 测试数量不低于 v0.0.20 基线，0 failed / 0 skipped；不得删例、改跳过条件或降门槛凑绿。
- 最终候选 SHA、版本载体、CI run、候选 ZIP/镜像哈希可互相追溯。
- 24h 未完成则明确写 `not-completed`；R-01 明确写 `DEFERRED`。
- 未取得 v0.0.21 专属 A3/B1：Tag/GHCR/Release 全部保持不存在。

## 6. 交付物

1. `docs/PRD_v0.0.21.md`（本文件）
2. 低内存 preflight/monitor/cleanup 入口与机器可读报告
3. Next/Vitest/Playwright 开发内存 before/after 报告
4. 生产内存独立报告
5. `docs/VISUAL_FIDELITY_MATRIX_v0.0.21.md` 与机器可读矩阵
6. 视觉修复的 before/after 证据与交互回归测试
7. 完整 CI 结果、候选冻结记录与最终 Go/No-Go 报告

## 7. 待确认问题（不阻塞开发，按默认值执行）

1. **最低支持内存**：默认按 1 GiB 系统预留 + 动态任务份额执行；首次真实基线后锁定具体机型/内存下限。未锁定前，低于安全下限必须 fail-closed。
2. **官方视觉参考不足项**：默认标 `UNVERIFIED`，不以独立实现冒充官方规格；如后续取得合法参考，只新增参考条目，不复制素材。
3. **24h 连续运行环境**：当前不存在可复现实例，继续 `not-completed`。
4. **v0.0.21 A3/B1**：当前不存在，正式发行保持 No-Go；不得用 v0.0.19/v0.0.20 的结论推断授权。
