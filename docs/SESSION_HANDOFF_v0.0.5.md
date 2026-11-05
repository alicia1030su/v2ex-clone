# docs/SESSION_HANDOFF_v0.0.5.md —— v0.0.5 跨会话交接

> 本文件在上下文接近上限前**必须更新**，不允许丢失工作现场。
> 每完成一个重要阶段就更新一次。

---

# 第 1 轮状态快照（2026-11-05，主理人）—— 基线恢复 + 功能审计完成

## A. 基线核实（任务书 §一，全部实测）

| 项 | 实测值 |
|---|---|
| master 最新 SHA | `f2740c30d627681d6acedf95f89f8c519a3c05d4`（"fix(release): Notes 模板内置 P7 披露段 (#21)"） |
| v0.0.4 Tag | annotated `aed641db28d3f4fa82b1450063fa975702ca0e86` → commit `c0e7396c52d6a9c887c37788de533f6e4b8c1b1f`，**未移动** |
| v0.0.4 Release | id `434929894`，`draft=false`、`prerelease=true`、`published_at=2026-11-05T08:34:24Z`，资产 `SHA256SUMS` + `v2ex-clone-v0.0.4-deploy.zip` |
| PR #5 | MERGED → `c0e7396c` |
| PR #20 | MERGED → `344371d0` |
| PR #21 | MERGED → `f2740c30` |
| CI（`f2740c30`） | CI ✅ success（run `41997210047`）、Docker/Redis 隔离验证 ✅ success（run `41997210053`） |
| 本地工作区 | 干净（0 未提交） |
| 开发分支 | **`feat/v0.0.5-product-completion`**，从 `origin/master` 创建（**非**从 v0.0.4 Tag），HEAD `f2740c30` |

> ⚠️ 本地 `master` 与远端是 squash 后的不同历史（曾尝试 merge 产生 `SESSION_HANDOFF_v0.0.4.md`
> 冲突，已 `merge --abort`）。**本地 master 落后于远端，勿在其上直接开发。**

## B. 本轮已完成

1. 创建 14 个任务跟踪项（阶段 1~14）。
2. 派发工程盘点子智能体，完成只读全仓盘点（文档 7 份 + 代码结构 6 类 + 16 个重点核查项）。
3. **实测验证盘点报告的 5 个关键结论**（全部确认）：
   - 无 `src/app/api/reports/` ⇒ 用户端举报上报端**确实缺失**
   - `api/admin/` 有 config/logs/node-requests/pending/reports/stats/users，**无 credits**
   - `adminAdjustCredits` 仅在 `credit-service.ts:204` 定义，**无调用方**
   - 版主 UI 存在：`canModerate`（`t/[id]/page.tsx:174` → `TopicActions.tsx:38`）
   - AdminConsole 7 tab：概览/用户/举报/节点申请/节点管理/操作日志/系统配置
4. **创建 `FEATURE_AUDIT_v0.0.5.md`**（13 节，含 4 处 BROKEN、P0×6 + P1×6 任务清单）。
5. 创建本交接文档。

## C. 审计核心结论（详见 FEATURE_AUDIT_v0.0.5.md）

| 领域 | 结论 |
|---|---|
| **版主 moderator** | **不是没实现，而是零测试覆盖**。`/admin` 对 isStaff 开放；`TopicActions` 有锁定/置顶/恢复按钮；建节点进 pending。但 `MODERATOR` 全仓仅 2 处 API 断言，**无一条 moderator 身份 UI 点击流** |
| **管理员 admin** | 后台是**真实 CRUD**（非文本断言），但 **E2E 仅 2 条文本存在性断言**，封禁/角色/配置/审批零 UI 流 |
| **举报系统** | **处理端齐全、上报端完全缺失** —— 整个闭环是断的（无 `POST /api/reports`、无举报按钮、无防重复/防刷、无用户可见状态） |
| **管理员积分调整** | `adminAdjustCredits` **无调用方/无端点/无 UI** ⇒ FEATURE_MATRIX 的 ✅ 标注**不实** |
| **节点申请** | 完整闭环 VERIFIED |
| 感谢/投票/关注/收藏/签到/积分(用户侧)/通知(2/5 类型) | 全链路齐备 |
| **私信** | 完全 MISSING。**产品判断：V2EX 原站无私信，建议以 @ 提代替**（schema 已定义 `mention` 但从未写入） |
| **头像** | 校验/存储强；sharp 软依赖**未安装**（实际保存原图）；**EXIF 未处理**；无前端裁剪 |
| **邮件** | SMTP 客户端完整；**无 Mailpit 基建**；`.env.example` **无 SMTP 段**；真实投递未验证 |
| **搜索** | ILIKE + pg_trgm GIN 索引（0.064ms）；**中文质量未测** |
| **楼层号** | `floor.ts` UPSERT 算法 + 5 条严格 `1..n` 断言（v0.0.4 已补，ACCEPTANCE §7.1 该条**过时**） |

### 发现的 4 处 BROKEN

1. `src/lib/content-service.ts:197` 错误文案「只有管理员可以恢复主题」与实际允许 moderator **矛盾**
2. `FEATURE_MATRIX.md`「管理员调整积分 ✅」**不实**（能力不可达）
3. `README.md`「节点申请前端入口 ❌ 未实现」**过时**（实际已实现）；「24 个页面」实测 **26 个**
4. `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md` §7.1 第 6 条「楼层连续性缺 1..n 断言」**过时**（v0.0.4 已补）

## D. v0.0.5 开发顺序（P0 优先）

1. **P0-1 用户端举报全链路**（最大缺口）
2. **P0-2 管理员积分调整**
3. **P0-3 四身份真实浏览器 E2E**
4. **P0-4 楼层规则文档化 + 100 并发**
5. **P0-5 BROKEN-1~4 修复**
6. **P0-6 安全复核补项**
7. P1：搜索实测 / 头像 sharp+EXIF / Mailpit / 多浏览器多视口 / @ 提及 / 性能压测

## E. 环境与本地纪律

- 数据库：隔离实例 `127.0.0.1:55440`（`bash tests/helpers/start-test-pg.sh start`）
- **PG 生命周期须在同一次 Bash 调用内**（工具回收进程树）
- `next build` 须清 `NODE_OPTIONS` 并关 `CODEBUDDY_SAFE_DELETE_ENABLED` / `CODEBUDDY_BROKERED_FS_HOOK_ENABLED`
- 输出不用管道（`bash x.sh | tail` 会让 postgres 继承 stdout 导致 SIGTERM）
- **bash 的 `/tmp` 与 Windows Python 路径不通**：需 `cygpath -w /tmp` 转换
- **shell 变量不跨 Bash 调用保持**：验证脚本要显式传参

## F. 下一步具体执行任务

按 §D 顺序从 **P0-1 用户端举报全链路** 开始：
1. 新建 `src/app/api/reports/route.ts`（POST 提交 + GET 我的举报）
2. `schema.ts` 的 `reports` 表已存在，需补「防重复」唯一约束迁移
3. 主题/回复页加举报按钮 + 原因选择 + 补充说明
4. `/reports` 或 `/settings` 下加「我的举报」列表与状态
5. 处理端补用户可见反馈 + 审计日志
6. E2E：游客/用户提交、重复防护、版主处理、身份不泄露

## G. 风险与授权边界

- **R-01 仍 DEFERRED**：禁止未授权改写远端历史 / force push / 删 Tag / 改 Release / 改仓库可见性
- v0.0.5 Pre-release 已获授权自主发布（任务书 §十四），**但 R-01 相关危险操作仍需单独授权**
- 不得向真实用户发测试邮件；不得用会产生额外付费的外部服务

---

# 第 2 轮状态快照（2026-11-05，主理人）—— P0-1/2/3/5 + P1-2/3 完成

> 本轮把 §D 开发顺序里的 **P0-1、P0-2、P0-3、P0-5** 与 **P1-2、P1-3** 做完。
> 累计提交 7 个（`3400c16` … `0db8418`），分支 `feat/v0.0.5-product-completion`。

## A. 已完成工作（按 §D 顺序）

| # | 任务 | 状态 | 关键产出 |
|---|---|---|---|
| P0-1 | 用户端举报全链路 | ✅ | `POST/GET /api/reports`、**部分唯一索引**防重复、`ReportButton`、`/reports` 我的举报页、处理时通知举报者、`REPORT_SUBMIT` 审计 |
| P0-2 | 管理员积分调整 | ✅ | `POST /api/admin/credits`（仅 admin）+ AdminConsole「积分」tab（二次确认 + 理由必填） |
| P0-3 | 四身份真实浏览器 E2E | ✅ | `e2e/v005-four-roles-deep.spec.ts` 11 条 + **修复 4 个真实缺陷** |
| P0-5 | 楼层规则文档化 + 100 并发 | ✅ | `docs/FLOOR_NUMBERING_v0.0.5.md` + `tests/v005-floor-concurrency.spec.ts` 6 条（调**真实** `allocateFloor`） |
| P1-2 | 头像与图片体验 | ✅ | 前端 Canvas 裁剪器（零依赖）+ 服务端 EXIF 校正/元数据剥离 + sharp 提为直接依赖 + **修复 3 个真实缺陷** |
| P1-3 | 邮件系统真实集成验证 | ✅ | `tests/v005-smtp-protocol.spec.ts` 6 条（**直测生产路径**）+ 忘记密码全链路 E2E 4 条 + **修复 4 个生产级缺陷 + 1 个环境缺陷** |
| — | BROKEN-1~4 修复 | ✅ | 见 §C |
| — | 楼层连续性文档 | ✅ | 验收清单 §5/§7.1 已更正 |

## B. 本轮发现并修复的**真实缺陷**（不是测试问题）

| # | 缺陷 | 影响 |
|---|---|---|
| 1 | 软删除后**版主无法在 UI 恢复主题**（`t/[id]/page.tsx` 对 `status==='deleted'` 直接 `notFound()`） | 管理动作不可达 |
| 2 | 软删除后 **UI 不刷新**（`onDeleted` 回调从未被传入） | 用户必须手动刷新 |
| 3 | 重复举报返回 **500 而非 409**（Drizzle 把 pg 错误码放在 `err.cause.code`） | 用户看到「网络错误」 |
| 4 | 积分 tab 对版主**可见**（权限做成内容级而非入口级） | 权限边界无法断言 |
| 5 | **SMTP 超时完全失效**（Node 空闲超时在「服务器一个字节没发」时不启动） | 邮件发送可无限挂起 |
| 6 | `SMTP_TIMEOUT_MS` 在**模块加载时固化** | 超时行为无法测试 |
| 7 | 邮件日志写入**无限挂起** | **数据库故障时「忘记密码」永远不返回** |
| 8 | `src/lib/smtp-client.ts` 是**死代码**（无任何生产调用方） | 文档失实 + 生产 SMTP 零覆盖 |
| 9 | 删除主题用 `window.location.reload()` 引发**导航竞态** | E2E 间歇失败 |
| 10 | 后台「举报」tab 文本带数量（`举报（3）`），`exact: true` 匹配不到 | 单跑绿、全量红 |
| 11 | `AvatarCropper` 的 `onError` 导致**无限重渲染** | 页面卡死 |
| 12 | **生产环境头像上传后立刻 404**（Next 只服务构建时已存在的静态文件） | 头像功能在生产**完全不可用** |
| 13 | Docker compose **没给 `public/uploads` 挂卷** | 重建容器头像全丢 |
| 14 | `start-test-pg.sh` 稳态判定用 **UTF-8 字面量匹配 GBK 日志** ⇒ 永远匹配不到 | **每次启动 PG 死等 300 秒** ⇒ 伪装成「产品代码死锁」 |

## C. 本轮同步的文档

- `FEATURE_AUDIT_v0.0.5.md`（SMTP 条目更正为「协议级实测」）
- `FEATURE_MATRIX.md`（举报 6 行 + 积分调整 + SMTP 条目）
- `CHANGELOG.md` / `docs/SECURITY_EXCEPTIONS.md`（死代码引用更正）
- `docs/FLOOR_NUMBERING_v0.0.5.md`（**新增**：楼层编号规则）
- `README.md` / `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md`（BROKEN-3/4）

## D. 当前测试基线

| 项 | 结果 |
|---|---|
| 单元测试 | **248 passed / 248（20 文件）** |
| E2E | **175 passed / 0 failed（4.4m）** |
| 类型检查 | ✅ `npx tsc --noEmit` |

## E. 本地执行纪律（**重要 —— 本轮踩了很多坑**）

1. **PG 生命周期必须在同一次 Bash 调用内** —— 工具会回收进程树，
   跨调用 PG 必被杀掉（表现为 `ECONNREFUSED 127.0.0.1:55440` / 页面 500）。
2. **不要用管道输出脚本**（`bash x.sh | tail` 会让 postgres 继承 stdout ⇒ SIGTERM）。
3. `next build` 须清 `NODE_OPTIONS` 并关 `CODEBUDDY_SAFE_DELETE_ENABLED` / `CODEBUDDY_BROKERED_FS_HOOK_ENABLED`。
4. **bash 的 `/tmp` 与 Windows Python 路径不通** —— 需 `cygpath -w /tmp`。
5. **Git Bash 会把 heredoc 里的 `\s` 转成 `/s`** —— 正则要写 `[ \t]*` 或用 Edit 工具。
6. **Playwright 的 `getAttribute()` 带 auto-wait** —— 元素不存在时等满 30 秒；
   先 `count()` 再取。
7. **`waitForHydration` 只能用于客户端组件内部的节点** —— 服务端渲染的 input 不行。
8. **E2E 里不要反复 `register()`** —— 会触发注册限流；用 seed 用户。

## F. 下一步（§D 剩余）

| # | 任务 | 优先级 |
|---|---|---|
| P0-6 | 安全与社区治理完整复核（CSRF/XSS/SQLi/SSRF/开放重定向/上传/会话/提权/暴力登录/注册滥用/举报滥用/积分重复/并发扣费/管理员越权/日志脱敏）+ 补充频率限制与审计 | **P0** |
| P1-1 | 搜索能力升级（ILIKE vs pg_trgm vs FTS vs 中文分词） | P1 |
| P1-4 | 多浏览器（Chromium/Firefox/WebKit）× 5 视口 + 移动端专项 + 视觉回归基线 | P1 |
| P1-5 | 私信与其他社区能力评估 | P1 |
| P2 | 性能压测（继承 v0.0.4 规模，覆盖新增的搜索/通知/积分路径） | P2 |
| P3 | 部署与升级验证（Linux/Windows 全新装、v0.0.4→v0.0.5 原地升级、备份恢复、镜像拉取） | P3 |
| P4 | 最终集成：CI 全绿 → 固定 SHA → 安装包 + SHA256SUMS → GHCR 镜像 + Digest → Tag → **Pre-release** → 匿名下载校验 → 真实安装运行 | P4 |

## G. 风险与授权边界（不变）

- **R-01 仍 DEFERRED**：禁止未授权改写远端历史 / force push / 删 Tag / 改 Release / 改仓库可见性。
- v0.0.5 Pre-release 已获授权自主发布，但 R-01 相关危险操作仍需单独授权。
- 不得向真实用户发测试邮件；不得用会产生额外付费的外部服务。
- **R-01 必须在 v0.0.5 Pre-release Notes 中继续披露。**
