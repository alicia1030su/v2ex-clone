# FEATURE_AUDIT_v0.0.5.md —— 真实功能审计（v0.0.5 基线）

> 审计对象：分支 `feat/v0.0.5-product-completion`，HEAD `f2740c30`
> （= v0.0.4 发布后的 master）。
> 审计时间：2026-11-05。审计方式：**源码 + 路由 + schema + 测试资产逐项核验**。
>
> ## 状态定义
>
> - **VERIFIED**：完整运行通过（有浏览器与/或自动化证据）
> - **PARTIAL**：部分实现（缺前端、缺闭环或缺证据）
> - **BROKEN**：存在真实缺陷（代码与预期不符）
> - **MISSING**：确实没有实现
> - **UNVERIFIED**：缺少足够证据，不能宣称完成
>
> ## 纪律
>
> - **API 存在 ≠ 用户功能完成**；**按钮存在 ≠ 功能完成**；**测试文件存在 ≠ 测试通过**。
> - 本表「证据」列只写**实际存在**的证据；标 `待补` 的表示 v0.0.5 需补齐。
> - 代码级核验（源码/路由/schema）本轮**已逐项实测**；浏览器与运行时证据在本轮开发中补齐。

---

## 一、四身份能力矩阵（P0 重点）

### 1.1 游客 guest

| 能力 | 状态 | 源码/入口 | 证据 |
|---|---|---|---|
| 首页 / 节点 / 主题详情 / 回复浏览 | **VERIFIED** | `src/app/page.tsx`、`/nodes`、`/t/[id]/page.tsx` | E2E `auth.spec.ts`（8 条）实跑通过 |
| 搜索 | **VERIFIED**（v0.0.5 已实测） | `src/lib/search-tokenize.ts`（CJK bigram）+ `src/app/api/search/route.ts`（两阶段：整串 → AND 回退）+ pg_trgm 索引 | **中文质量已实测**（四方案横向对比 + 5000 主题性能对照，见 `docs/SEARCH_BENCHMARK_v0.0.5.md`） |
| 注册 / 登录 | **VERIFIED** | `/signup`、`/signin` + `api/auth/*` | E2E `auth.spec.ts` 实跑通过 |
| 未登录点击发帖 / 回复的提示 | **UNVERIFIED** | `NewTopicForm`/`ReplyItem` 按钮不渲染 | ⚠️ 仅「按钮不渲染」，**无「未登录点击后的引导反馈」验证** —— v0.0.5 必须补 |
| 未登录收藏 / 感谢 / 关注 / 投票的反馈 | **UNVERIFIED** | 同上 | ⚠️ 同上 |
| 登录后返回原本目标页面 | **UNVERIFIED** | 无 `next` / `redirect` 回跳逻辑的证据 | ⚠️ v0.0.5 需验证是否实现 |

**缺口**：游客的「拒绝反馈」只在 API 层有 401/403，**UI 层没有验证用户实际看到了什么**。

### 1.2 普通用户 user

| 能力 | 状态 | 源码/入口 | 证据 |
|---|---|---|---|
| 发布 / 编辑 / 删除自己的主题 | **VERIFIED** | `api/topics/*`、`NewTopicForm`、`TopicEditForm` | E2E `topic.spec.ts`（8 条） |
| 回复 / 引用 / 编辑自己的回复 | **VERIFIED** | `api/replies/*`、`ReplyItem` | 同上 |
| 感谢（回复） | **VERIFIED** | `api/thanks`、`ReplyItem.tsx:205-210` | E2E `v004-content-interaction.spec.ts` |
| 投票（主题） | **VERIFIED** | `api/votes`、`TopicActions` | 同上 |
| 关注 / 取消关注 | **VERIFIED** | `api/users/follows`、`FollowButton`、`/following` | E2E UI 用例（R-23 修复后通过） |
| 收藏 | **VERIFIED** | `api/collections`、`CollectButton`、`/bookmarks` | E2E `feature.spec.ts` |
| 签到 | **VERIFIED** | `api/checkin`、`CheckinButton`（SettingsForm 内） | `tests/credits-concurrency.spec.ts`（8 条，含并发幂等） |
| 积分 / 排行榜 | **VERIFIED**（用户侧） | `api/credits`、`api/leaderboard`、`CreditBadge`、`/leaderboard` | `tests/credits-concurrency.spec.ts` |
| 通知 | **PARTIAL** | `api/notifications`、`NotificationsList`、`/notifications` | ⚠️ 仅 `reply` 与 `topic_thanks` 两种类型被写入；`mention`/`node_thanks`/`system` 在 schema 定义但**从未写入** |
| 修改个人资料 | **VERIFIED** | `api/users/me`、`api/settings/profile`、`SettingsForm` | E2E `v004-account-admin.spec.ts` |
| 头像上传 | **PARTIAL** | `api/users/avatar`、`SettingsForm` | ⚠️ 见 §七（sharp 未装、EXIF 未处理） |
| 节点申请 | **VERIFIED** | `/nodes/request`、`NodeRequestForm`、`api/node-requests` | E2E `v004-four-roles-ui.spec.ts`（V4-20 修复后通过） |
| 举报主题与回复 | **MISSING** | **无 `POST /api/reports`、无举报按钮** | ✗ 用户端上报端完全缺失（见 §三） |
| 查看自己的内容与历史 | **PARTIAL** | `/member/[username]` | ⚠️ 无「我的回复」「我的举报」聚合入口 |
| 看不到管理员入口 | **UNVERIFIED** | `buildNavLinks`（`src/lib/nav-links.ts`） | ⚠️ 仅 1 条 UI 层证据（`auth.spec.ts:89`），后台入口隐藏未验证 |
| 不能操作他人内容 | **VERIFIED** | `canModifyOwnContent`（`src/lib/permissions.ts`） | `tests/admin-permissions.spec.ts`（14 条） |
| 不能访问管理员 API | **VERIFIED** | `adminGuard`（`src/lib/admin-guard.ts`） | 同上 |

### 1.3 版主 moderator

| 能力 | 状态 | 源码/入口 | 证据 |
|---|---|---|---|
| 主题锁定 / 解锁 | **PARTIAL** | `api/topics/[id]/lock`、`unlock`；`TopicActions.tsx`（`canModerate` 渲染按钮，`t/[id]/page.tsx:174` 传参） | ⚠️ **有 UI、有 API，但零 E2E 覆盖**（`MODERATOR` 全仓仅 2 处 API 断言：`e2e/feature.spec.ts:148/157`） |
| 主题置顶 / 取消置顶 | **PARTIAL** | `api/topics/[id]/pin`、`unpin`；同上 | 同上 |
| 内容隐藏与恢复 | **PARTIAL** | `api/topics/[id]/restore`、`api/replies/[id]/restore`；`TopicActions`/`ReplyItem` 恢复按钮 | 同上。⚠️ 另见 §六 BROKEN-1（错误文案） |
| 举报审核 | **PARTIAL** | `api/admin/reports`、`POST .../handle`；`AdminConsole`「举报」tab | ⚠️ 有 UI 与 API，但**举报从哪来是断的**（用户无法提交，见 §三） |
| 节点申请审核 | **VERIFIED** | `api/admin/node-requests` + approve/reject；`AdminConsole`「节点申请」tab | `tests/admin-cli.spec.ts` + 后台 UI 存在 |
| 审核记录 | **PARTIAL** | `moderation_logs` 表；`api/admin/logs`；`AdminConsole`「操作日志」tab | ⚠️ 表与查询有，无 moderator 身份的操作记录 E2E |
| 进入后台 | **VERIFIED** | `src/app/admin/page.tsx:43`（isStaff 可进） | 代码级确认 |
| 无权限操作的明确反馈 | **UNVERIFIED** | `checkPermission`（401/403 区分） | ⚠️ API 层有，UI 层未验证 |

**结论**：版主**不是「没有实现」**，而是「**实现了但没有一条 moderator 身份的 UI 点击流测试**」。
v0.0.5 的核心工作是把这些能力用真实浏览器跑通并留下证据。

### 1.4 管理员 admin

| 能力 | 状态 | 源码/入口 | 证据 |
|---|---|---|---|
| 用户列表 / 搜索 | **PARTIAL** | `api/admin/users`、`AdminConsole`「用户」tab | ⚠️ 真实 CRUD（有搜索/筛选/角色 PATCH/封禁 prompt），但 **E2E 仅 1 条文本存在性断言**（`v004-account-admin.spec.ts:338`） |
| 用户封禁 / 解除封禁 | **PARTIAL** | `api/admin/users/[id]/ban`、`unban` | ⚠️ 同上；`canBanUser` 有单测 |
| 角色修改 | **PARTIAL** | `api/admin/users/[id]/role`（禁自我降级） | ⚠️ 同上 |
| 举报管理 | **PARTIAL** | `api/admin/reports` + handle | ⚠️ 处理操作用 `window.prompt` 交互，无批量、无历史筛选 |
| 节点审批 | **VERIFIED** | `api/admin/node-requests` | `tests/admin-cli.spec.ts` |
| 系统配置 | **PARTIAL** | `api/admin/config`（脱敏展示） | ⚠️ 只读展示，无修改能力 |
| 社区统计 | **VERIFIED** | `api/admin/stats`、「概览」tab（真实 fetch） | 代码级确认 |
| **积分调整** | **MISSING** | `credit-service.ts:204 adminAdjustCredits` —— **无任何调用方、无 API 端点、无 UI** | ✗ `permissions.ts` 的 `credits.adjust` 权限空转；`audit.ts` 的 `USER_CREDITS_ADJUST` 动作枚举无人触发。⚠️ **`FEATURE_MATRIX.md` 标注为 ✅ 已实现 —— 不实，必须修正** |
| 管理员操作日志 | **PARTIAL** | `api/admin/logs`、「操作日志」tab | ⚠️ 查询有，无写入路径的 E2E 证据 |
| 敏感操作二次确认 | **PARTIAL** | `window.prompt` / `confirm` | ⚠️ 有但体验弱，无统一的高危操作确认机制 |
| 操作失败反馈 | **UNVERIFIED** | — | ⚠️ 未验证 |

**结论**：管理员后台是**真实 CRUD**（不是文本断言），但**零 UI 点击流 E2E**。
FEATURE_MATRIX 有一处**不实标注**（积分调整）。

---

## 二、主题与回复系统

| 能力 | 状态 | 源码/入口 | 证据 |
|---|---|---|---|
| 楼层号分配 | **VERIFIED** | `src/server/floor.ts:25-58` `allocateFloor`（单条 UPSERT：INSERT 分支 `max(floor)+1`、CONFLICT 分支 `last_floor+1`；v0.0.4 修复 `GREATEST(...,EXCLUDED)+1` 跳号） | `tests/floor-continuity.spec.ts`（5 条严格 `1..n`）+ `tests/floor-counter.spec.ts`（6 条）+ `content-lifecycle` 并发唯一 |
| 楼层连续性 | **VERIFIED** | 同上 | ⚠️ `ACCEPTANCE_CHECKLIST §7.1` 第 6 条「缺 1..n 断言」**已过时**（v0.0.4 已补），文档需更新 |
| 并发回复 | **PARTIAL** | 同上 | ⚠️ 有单测，**无 100 并发真实压测**（v0.0.5 补） |
| 回复分页 | **VERIFIED** | `Pager` 组件 + API 分页 | E2E `pagination.spec.ts`（6 条） |
| 回复编辑 | **VERIFIED** | `api/replies/[id]` PUT + `ReplyItem` 内嵌表单 | E2E |
| 回复软删除 / 恢复 | **PARTIAL** | DELETE + `deletedAt`；POST restore | ⚠️ 作者视角 UI 有；**删除后楼层显示策略未明确定义**（重排与否无规则文档） |
| 引用跳转 | **UNVERIFIED** | `quoteId` 字段存在 | ⚠️ 字段有，跳转交互未验证 |
| 最后一条回复时间更新 | **VERIFIED** | `topics.lastReplyAt` | 代码级确认 |
| 回复总数准确性 | **VERIFIED** | `repliesCount` 重算 | 代码级确认 |
| 锁定主题后拒绝新增回复 | **PARTIAL** | `topics.locked` | ⚠️ 有 API 检查，无「锁定中回复被拒」的 UI 反馈测试 |

---

## 三、内容治理系统（举报与审核）—— **P0 最大缺口**

| 能力 | 状态 | 说明 |
|---|---|---|
| `reports` 表 | **VERIFIED** | `schema.ts:538`：`targetType(topic/reply/user)` / `reason` / `status(pending/accepted/rejected)` / `handledBy` / `handleNote` |
| 处理端 API | **VERIFIED** | `GET /api/admin/reports`、`POST /api/admin/reports/[id]/handle`（accept → 隐藏内容）、`GET /api/admin/pending` 聚合 |
| 处理端 UI | **VERIFIED** | `AdminConsole`「举报」tab（列表 + 接受/驳回 + `prompt` 输入说明） |
| **用户端举报提交 API** | **MISSING** | ✗ **无 `src/app/api/reports/`**（已实测 `ls` 确认） |
| **主题/回复页举报按钮** | **MISSING** | ✗ `TopicItem` / `ReplyItem` / `t/[id]/page.tsx` 均无举报入口 |
| 举报原因选择 | **MISSING** | 无表单 |
| 举报补充说明 | **MISSING** | 无表单 |
| 防重复举报 | **MISSING** | 无唯一约束 / 无检查 |
| 防恶意刷举报 | **MISSING** | 无限流（对比：`api/node-requests` 有限流） |
| 举报处理状态（用户可见） | **MISSING** | 无「我的举报」入口 |
| 被处理内容的隐藏与恢复 | **PARTIAL** | accept 时隐藏内容有；**用户可见的处理反馈无** |
| 举报者身份不泄露 | **N/A**（无上报端故无泄露面） | 但实现时必须保证 |
| 举报处理写审计日志 | **PARTIAL** | `moderation_logs` 表有；需确认 handle 时是否写入 |

**结论**：**处理端齐全、上报端完全缺失** —— 整个举报闭环是断的。
这是 v0.0.5 的 P0 首要任务。

---

## 四、节点与内容分发

| 能力 | 状态 | 证据 |
|---|---|---|
| 节点列表 / 详情 / 子节点树 | **VERIFIED** | E2E `feature.spec.ts` |
| 节点创建（admin 直生效 / moderator → pending） | **VERIFIED** | `api/nodes/route.ts:102` |
| 节点申请（用户提交 + 审批） | **VERIFIED** | `/nodes/request` + `NodeRequestForm` + `api/node-requests` + 后台 tab |
| 节点状态管理（active/pending/hidden） | **VERIFIED** | `api/nodes` PATCH |
| Feed（全站 / 节点 / atom / json） | **VERIFIED** | `api/feed/*` + `tests/feed-search.spec.ts`（12 条） |
| 分类 categories | **VERIFIED** | schema + `api/nodes` |

---

## 五、搜索能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 实现方式 | **PARTIAL** | `ILIKE $1 ESCAPE '\'`（`api/search/route.ts:106`），参数化 + `%`/`_`/`\` 转义；relevance 用 CASE 标题加权 |
| 索引 | **VERIFIED** | `0002_v004_perf_indexes.sql:80-91`：`topics_title_trgm_idx` / `topics_content_trgm_idx`（GIN `gin_trgm_ops`）；扩展创建失败降级全表扫描 + NOTICE |
| SQL 注入防护 | **VERIFIED** | 参数化查询 |
| 压测表现 | **VERIFIED** | 0.064ms（v0.0.4 压测） |
| **中文搜索质量** | **VERIFIED**（v0.0.5 实测） | ✅ **已实测**：`tests/v005-search-quality.spec.ts`（8 条方案对比）+ `tests/v005-search-tokenize.spec.ts`（26 条）+ `e2e/v005-search.spec.ts`（9 条端到端）。实测结论：FTS `simple` 对中文**几乎无用**（不切中文）；本机 PG **无** `zhparser`/`pg_jieba` ⇒ 自研 bigram；bigram OR 假阳性严重 ⇒ 最终「整串 + AND 回退」两阶段 |
| 用户名 / 节点名搜索 | **PARTIAL** | ⚠️ 主题搜索已实测（E2E 9 条）；但**用户名 / 节点名的独立搜索入口**未做实测（`/api/search` 只搜主题） |
| 分页与排序 | **PARTIAL** | 有分页；排序仅 relevance |
| FTS 是否可用 | **UNVERIFIED** | 未对比测试 |

**纪律**：不能简单使用英文 FTS 配置就宣称中文全文搜索完成。v0.0.5 必须先实测再决定是否升级。

---

## 六、发现的具体缺陷（BROKEN）

### BROKEN-1：恢复权限错误文案与实际不符（轻微）

- 位置：`src/lib/content-service.ts:197`
- 现象：错误消息写「**只有管理员**可以恢复主题」，但代码实际允许 `role ∈ {moderator, admin}`
- 影响：用户看到误导性错误信息
- 修法：改为「只有管理员或版主可以恢复主题」

### BROKEN-2：FEATURE_MATRIX 不实标注（文档缺陷）

- 位置：`FEATURE_MATRIX.md`「管理员调整积分及审计 ✅」
- 现象：标注实现位置仅 `credit-service.ts (adminAdjustCredits)`，但该函数**无任何调用方、无 API 端点、无 UI**
- 影响：文档宣称的能力实际不可达
- 修法：v0.0.5 补全 API + UI 后更新矩阵；**在那之前必须先降级标注**

### BROKEN-3：README 过时条目（文档缺陷）

- 「节点申请的前端入口 ❌ 未实现 / 缺页面」—— `/nodes/request` 实际存在（v0.0.4 `ed385cf` 补齐）
- 「24 个页面」—— 实测 **26 个 `page.tsx`**

### BROKEN-4：ACCEPTANCE_CHECKLIST §7.1 第 6 条过时（文档缺陷）

- 原写「楼层连续性：缺 1..n 连续断言（B-05 漏检根因未消除）」
- 实际 v0.0.4 已新增 `tests/floor-continuity.spec.ts` 5 条严格 `1..n` 断言并在 CI 实跑

---

## 七、头像与图片

| 能力 | 状态 | 说明 |
|---|---|---|
| magic number 嗅探（不信 MIME） | **VERIFIED** | `src/lib/avatar.ts:67-112` |
| 服务端随机路径 + `wx` 独占创建 + 越界检查 | **VERIFIED** | `avatar.ts:125-141` |
| 2MB 大小上限 | **VERIFIED** | 同上 |
| sharp 软依赖 256×256 cover 裁剪 + `limitInputPixels` 1e8 | **PARTIAL** | `avatar.ts:190-238` 代码已备，**但本机未安装 sharp，实际降级保存原图** |
| **EXIF 元数据处理** | **MISSING** | 无 EXIF 剥离 / 方向校正；JPEG 可能带 GPS 等隐私元数据 |
| 前端裁剪 / 缩放 / 预览 | **MISSING** | `SettingsForm` 仅上传/移除 |
| 头像替换 / 删除 | **PARTIAL** | 有删除；替换即重新上传 |
| Docker Linux 原生依赖兼容性 | **UNVERIFIED** | 未验证 sharp 在 standalone 镜像中的兼容性 |

---

## 八、邮件系统

| 能力 | 状态 | 说明 |
|---|---|---|
| SMTP 客户端 | **VERIFIED**（**协议级实测**，v0.0.5 更正） | 生产实现是 `src/lib/mailer.ts` 的 `deliverViaSmtp()`（零依赖，EHLO / STARTTLS / AUTH LOGIN / MAIL FROM / RCPT TO / DATA / QUIT）；**v0.0.5 已删除死代码 `src/lib/smtp-client.ts`**（经全仓检索确认**无任何生产调用方** —— 此前的 ✅ 标注与文档引用均不实）。本轮新增 `tests/v005-smtp-protocol.spec.ts` **直测生产路径 `sendMail()`**（6 条全绿）；无 DKIM / 多收件人 / **真实外部 SMTP 投递未验证**（无凭据，不向真实用户发邮件） |
| 配置读取 | **VERIFIED**（代码级） | `src/lib/mailer.ts`：`SMTP_HOST/PORT/FROM/USER/PASS/SECURE`；「绝不假装已发送」，未配置如实返回 |
| 收件人脱敏 + `email_logs` | **VERIFIED** | 同上 |
| 测试运行时进内存 outbox | **VERIFIED** | `NODE_ENV`/`APP_RUNTIME_ENV=test` 时不连真 SMTP |
| **`.env.example` SMTP 配置段** | **MISSING** | 无任何 SMTP 配置项，部署者无从发现 |
| **Mailpit / MailHog 测试基建** | **MISSING** | `docker-compose.yml` 无邮件容器 |
| 忘记密码全链路 | **PARTIAL** | `api/auth/forgot-password` + `reset-password` 有；`tests/password-reset.spec.ts`（11 条）覆盖令牌一次性/重放/过期 |
| **真实 SMTP 投递** | **UNVERIFIED** | R-14 / E-06；v0.0.5 用 Mailpit 完成全链路隔离验证，并如实标注外部投递未验证 |

---

## 九、私信与其他社区能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 私信 / 站内信 | **MISSING** | 全仓 grep「私信 / conversation」零命中；无表、无 API、无 UI、无测试 |

**产品判断（待 v0.0.5 确认）**：任务书要求「先确认原站公开可观察的行为和当前项目现有功能」，
「对于确实属于目标社区体验、且尚未实现的功能，纳入本轮」。
V2EX 原站**没有**私信功能（其社区互动依赖公开回复与 @ 提及）。
因此私信**不属于** V2EX 风格论坛体验，**不建议纳入 v0.0.5**。
更符合定位的替代是 **@ 提及（mention）** —— schema 的 `notifications.type` 已定义 `mention`，
但从未写入。**建议以 @ 提替代私信**，并在审计文档与 Release Notes 中如实说明该决策。

---

## 十、安全与治理

| 项 | 状态 | 证据 |
|---|---|---|
| CSRF | **VERIFIED** | `CsrfProvider` + `adminGuardWrite` + E2E `security-regression.spec.ts`（19 条） |
| XSS 清洗 | **VERIFIED** | Markdown 渲染链路 + E2E `security.spec.ts`（10 条） |
| SQL 注入 | **VERIFIED** | 参数化查询 + 搜索转义 |
| SSRF | **UNVERIFIED** | 未见到针对性测试 |
| 开放重定向 | **VERIFIED** | E2E `security.spec.ts` |
| 文件上传 | **PARTIAL** | 头像校验强；无恶意图片（多帧、EXIF 炸弹）测试 |
| 会话管理 | **VERIFIED** | `sessions` 表 + `tests/password-reset.spec.ts`（改密后旧会话失效） |
| 权限提升 | **VERIFIED** | `tests/admin-permissions.spec.ts`（14 条） |
| 暴力登录 | **VERIFIED** | `login_attempts` + 限流 + `tests/captcha.spec.ts`（28 条） |
| 注册滥用 | **PARTIAL** | 有限流 + 验证码；**无新账号防垃圾内容机制** |
| **举报滥用** | **N/A** | 上报端不存在（补上时必须加防刷） |
| 积分重复发放 | **VERIFIED** | `credit_ledger.idempotencyKey` 唯一 + `credits-concurrency.spec.ts`（8 条） |
| 并发扣费 | **VERIFIED** | 同上 |
| 管理员越权 | **VERIFIED** | `tests/admin-permissions.spec.ts` |
| 敏感信息泄露 | **VERIFIED** | `api/admin/config` 脱敏 + `admin-cli.ts` 需 token + reason |
| 日志脱敏 | **VERIFIED** | `mailer.ts` 收件人脱敏 |
| **用户内容频率限制** | **PARTIAL** | 有全站限流桶；无「新账号发文频率」专项 |
| **管理员高危操作确认** | **PARTIAL** | `prompt`/`confirm`，无统一机制 |
| **重要行为审计** | **PARTIAL** | `moderation_logs` + `edit_history` + `admin-cli` 有；举报处理、积分调整的审计路径不完整 |
| **异常登录和会话处理** | **UNVERIFIED** | `login_attempts` 记录了，无「异常登录告警 / 会话批量失效」能力 |

---

## 十一、测试与 CI 资产

| 项 | 数值 | 说明 |
|---|---|---|
| 单元测试 | **194 条 / 16 文件**（194 passed / 0 failed / 0 skipped） | CI run `41949555282` 复验 |
| E2E | **154 条 / 11 文件**（154 passed / 0 failed / 0 skipped） | 3.9m；⚠️ `v004-endpoint-smoke` 用例数随 GET 路由数浮动 |
| Playwright projects | ✅ **v0.0.5 已扩展**（core + 15 个跨浏览器视口 project） | `E2E_CROSS=1` 时展开 **3 浏览器（Chromium / Firefox / WebKit）× 5 视口**；实测 160/160 通过，并因此发现 **3 个真实缺陷**（body min-width / 断点不匹配 / WebKit CSRF Cookie 被丢弃）。⚠️ CI 默认只跑 `core`（避免用例数爆炸）；⚠️ WebKit ≠ 真实 Safari |
| 升级脚本自检 | **87 项断言全 PASS** | 沙箱，不调真实 Docker |
| 压测 | 10000 用户 / 1000 节点 / 100000 主题 / 1000000 回复；24785 请求 / 13 场景 / **0 个 5xx** | `tools/loadtest/bench.mjs` |
| 视觉对照 | 4 视口 × 17 页面 = 68 条（40 有对照 / 28 无对照） | 严格口径桌面 Δx=0 52/52（仅几何维度） |
| docker-verify | 九项全 PASS | run `41871503684` |

---

## 十二、v0.0.5 开发任务清单（按优先级）

### P0（必须先完成）

| # | 任务 | 现状 | 验收标准 |
|---|---|---|---|
| P0-1 | **用户端举报全链路** | MISSING | `POST /api/reports`（原因 + 补充说明 + 防重复 + 限流）；主题/回复页举报按钮；「我的举报」列表与状态；处理结果用户可见反馈；举报者身份不泄露给普通用户；处理写审计日志 |
| P0-2 | **管理员积分调整** | MISSING | `POST /api/admin/credits`（`credits.adjust` 权限 + 审计 + 幂等）；AdminConsole UI；修正 FEATURE_MATRIX 标注 |
| P0-3 | **四身份真实浏览器 E2E** | 版主/管理员零 UI 流 | 游客拒绝反馈、版主 6 类操作、管理员 9 类操作全部有 UI 点击流 + DB 状态变化 + 刷新后结果验证 |
| P0-4 | **楼层号规则文档化 + 100 并发测试** | PARTIAL | 明确「删除后楼层显示策略」规则并写入文档；100 并发回复无重复无跳号 |
| P0-5 | **BROKEN-1~4 修复** | 4 处 | 文案修正 + 3 处文档债 |
| P0-6 | **安全复核补项** | PARTIAL | SSRF 测试、新账号防垃圾、高危操作统一确认、举报处理审计、异常登录处理 |

### P1

| # | 任务 | 现状 |
|---|---|---|
| P1-1 | 搜索质量实测（中文完整/部分/中英混合/错别字/用户名/节点名）与方案选型 |
| P1-2 | 头像 sharp 落地 + EXIF 剥离 + 前端裁剪预览 + Docker 兼容性验证 |
| P1-3 | Mailpit 邮件隔离环境 + 全链路验证 + `.env.example` SMTP 段 |
| P1-4 | 多浏览器（Chromium/Firefox/WebKit）+ 5 视口交互 E2E + 视觉回归基线 |
| P1-5 | @ 提代替私信（含产品决策记录） |
| P1-6 | 性能压测（继承 v0.0.4 规模，补 P50/P95/P99/慢 SQL/连接池/缓存命中） |

---

## 十三、纪律声明

- 本审计**未运行任何测试、未修改任何文件**，全部结论来自对 `f2740c30` 工作区的源码级核验。
- 标 `UNVERIFIED` 的项**不得**在 README / Release Notes 中宣称完成。
- 标 `待补` 的证据必须在本轮开发中补齐，否则该功能的状态不得升级为 VERIFIED。
- `FEATURE_MATRIX.md` 与 `README.md` 的不实标注（BROKEN-2/3）必须随对应功能的实现一并修正。
