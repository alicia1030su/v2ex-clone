# 功能矩阵（FEATURE_MATRIX）

> 本表逐项核对**实际代码与实测证据**。状态定义：

| 状态 | 含义 |
|---|---|
| ✅ 已实现 | 代码存在且有自动化测试或真实运行证据 |
| ⚠️ 部分实现 | 核心路径可用，但有明确未覆盖的部分（见备注） |
| 🔶 独立实现 | 无法确认原站规则，采用本项目自定义规则（已标注） |
| ❌ 未实现 | 本轮未做 |

生成时间：v0.0.3 开发分支（版本载体刻意保持 0.0.3，直到最终 SHA 固定；
v0.0.4 的变更见 `CHANGELOG.md` `[Unreleased]` 段落与 `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md`）

> ⚠️ **本表的验证证据列引用的是 v0.0.3 时期的测试文件与用例**。
> v0.0.4 的**测试基线权威值**：单元 **194 条 / 16 文件**（194 passed / 0 failed / 0 skipped，连续 4 轮全绿）、
> E2E **154 条 / 11 文件**（✅ **当前权威实测 = 154 passed / 0 failed / 0 skipped（11 文件，3.9m）** —— V4-20 修复后本地实跑全绿；
> **本地历史轮次口径**：153 passed / 0 failed / 0 skipped，连续 2 轮全绿，4.5m/轮 —— 基于 153 条口径，早于 `ed385cf`；
> **修复前的历史快照**：CI run `41873009808` = `153 passed | 1 failed | 154 total`；****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）**）。
> ⚠️ **单元测试修复前基线为 190 条 / 15 文件**（V4-20 修复新增 `tests/form-name-shadowing.spec.ts` 的 **4 条防回归断言** ⇒ 190 → 194）。
> ⚠️ **「185」有两个不同来源，不可混用**：① **v0.0.3 历史总数**（master @ `37710fb4`，14 文件）；
> ② **修复前的历史观测**（run `41837212170`，HEAD `930f29e`，`185 passed | 5 skipped (190)`，⚠️ **分母仍是 190**）。
> **该红灯已由 `8ce5ce9` 修复**，run `41860242099` 与 `41873009808` 的单元 job 均已 ✅。
> **无论哪种，v0.0.4 的用例总数在 V4-20 修复后是 194**（修复前是 190）。
> 口径裁决见 `TEST_REPORT.md` 文首「185 vs 190 裁决」小节与 `docs/evidence/ci/test-baseline-v0.0.4.md` §0.1。
>
> ⚠️ **v0.0.4 新增/变更项的矩阵位置**：v0.0.4 的 12 项缺陷修复、3 项性能优化、
> 升级脚本自动同步 tag、发布前只读门禁等，**不在本表逐项列出** ——
> 它们属于「缺陷修复」与「工程化」而非「功能矩阵」的范畴，
> 完整清单见 `CHANGELOG.md` `[Unreleased]` 与 `BUG_REGISTER.md`（V4-01~V4-16）。
> 本表仍以**功能存在性**为准 —— v0.0.4 未删除任何 v0.0.3 已有的功能。
>
> ✅ **v0.0.6 测试基线权威值**（2026-11-06）：单元 **341 条 / 26 文件**（341 passed / 0 failed）、
> E2E **200 条**（200 passed / 0 failed，3.4m）、组件级视觉回归 **63 组合**
> （7 视口 × 3 浏览器 × 3 页面）全部测量成功、**三引擎一致**、**零横向溢出**、
> 基线二次运行**回归项 = 0**、类型检查 ✅。
> ⚠️ **原站对照**：实测原站不可达（HTTP 000）⇒ 原站对照项**全部 UNVERIFIED**，
> 本轮视觉结论仅覆盖**本站自身**的跨视口/跨浏览器一致性。
> v0.0.6 的功能增量与缺陷修复见 `CHANGELOG.md` `[Unreleased] v0.0.6` 段落
> 与 `BUG_REGISTER.md` V5-18 ~ V5-26。
>
> ✅ **v0.0.5 测试基线权威值**（集成收尾，2026-11-06）：单元 **327 条 / 25 文件**（327 passed / 0 failed）、
> E2E **200 条**（200 passed / 0 failed）、跨浏览器 × 跨视口 **160/160**（Chromium / Firefox / WebKit × 5 视口）、
> 类型检查 ✅、升级验证 **PASS=17 / FAIL=0**、发布门禁 **PASS=62 / FAIL=0 / BLOCK=1**（BLOCK = R-01 授权）。
> v0.0.5 的功能增量（举报全链路 / 积分调整 / 头像裁剪+EXIF / 中文搜索 / @ 提及 / 社区限流）
> 已**逐行标注在下方表格**（搜索「v0.0.5」）；缺陷修复清单见 `BUG_REGISTER.md` V5-01~V5-16。

## 主题与回复系统

| 功能 | 状态 | 实现位置 | 验证证据 |
|---|---|---|---|
| 主题编辑 | ✅ 已实现 | `src/app/api/topics/[id]/route.ts` (PUT)；`src/lib/content-service.ts` (editTopic)；`tests/content-lifecycle.spec.ts` (编辑历史快照) |
| 主题软删除 | ✅ 已实现 | `src/app/api/topics/[id]/route.ts` (DELETE)；`src/lib/content-service.ts` (softDeleteTopic) |
| 主题恢复 | ✅ 已实现 | `src/app/api/topics/[id]/restore/route.ts` (POST)；`src/lib/content-service.ts` (restoreTopic) |
| 作者权限与管理权限 | ✅ 已实现 | `src/lib/permissions.ts` (canModifyOwnContent)；`tests/admin-permissions.spec.ts` (权限矩阵逐条实测) |
| 可配置编辑时间限制 | ✅ 已实现 | `src/lib/permissions.ts` (TOPIC_EDIT_WINDOW_MINUTES)；`tests/content-lifecycle.spec.ts` (withinEditWindow 实测) |
| 编辑历史与审计记录 | ✅ 已实现 | `src/db/schema.ts` (edit_history 表)；`src/app/api/topics/[id]/edit-history/route.ts` (GET)；`src/app/api/replies/[id]/edit-history/route.ts` (GET) |
| 主题锁定 / 解锁 | ✅ 已实现 | `src/app/api/topics/[id]/lock/route.ts` (POST)；`src/app/api/topics/[id]/unlock/route.ts` (POST)；`src/lib/audit.ts` (moderation_logs 审计) |
| 主题置顶 / 取消置顶 | ✅ 已实现 | `src/app/api/topics/[id]/pin/route.ts` (POST)；`src/app/api/topics/[id]/unpin/route.ts` (POST) |
| 回复引用与楼层跳转 | ✅ 已实现 | `src/db/schema.ts` (replies.quoteId)；`src/components/ReplyItem.tsx` (引用预览 + 锚点) |
| 回复编辑与软删除 | ✅ 已实现 | `src/app/api/replies/[id]/route.ts` (PUT / DELETE)；`src/lib/content-service.ts` (editReply / softDeleteReply) |
| 回复感谢及计数 | ✅ 已实现 | `src/app/api/thanks/route.ts` (POST / DELETE)；`src/lib/content-service.ts` (thankReply)；`tests/content-lifecycle.spec.ts` (8 并发感谢只计一次) |
| 主题投票 | ✅ 已实现 | `src/app/api/votes/route.ts` (POST / DELETE)；`src/lib/content-service.ts` (voteTopic)；`tests/content-lifecycle.spec.ts` (重复投票计数不变) |
| 异常状态显示（锁定/置顶/删除/已编辑） | ✅ 已实现 | `src/app/api/topics/[id]/route.ts` (状态字段)；`src/components/TopicActions.tsx` (UI 呈现) |

## 用户与账户系统

| 功能 | 状态 | 实现位置 | 验证证据 |
|---|---|---|---|
| 邮件找回密码 | ✅ 已实现 | `src/app/api/auth/forgot-password/route.ts` (POST)；`src/lib/mailer.ts` (sendMail) |
| 一次性密码重置令牌 | ✅ 已实现 | `src/lib/reset-token.ts` (generateResetToken（纯函数）)；`src/lib/reset-token-store.ts` (createResetToken / consumeResetToken)；`tests/password-reset.spec.ts` (11 条安全属性) |
| SMTP 可配置发送服务 | ✅ 已实现（v0.0.5 接通生产路径并实测） | `src/lib/mailer.ts`：`readSmtpConfig()` / `deliverViaSmtp()`（**零依赖 SMTP 客户端**，生产实现）/ `sendMail()`。**v0.0.5 已删除死代码 `src/lib/smtp-client.ts`**（无任何生产调用方），协议级测试改为直测 `sendMail()` ⇒ 「测试通过」= 「生产可用」 |
| 令牌过期 / 撤销 / 重放防护 | ✅ 已实现 | `src/lib/reset-token-store.ts` (三重状态 + 原子消费)；`tests/password-reset.spec.ts` (过期/撤销/重放/并发) |
| 修改密码后旧会话失效 | ✅ 已实现 | `src/app/api/auth/reset-password/route.ts` (删除该用户全部会话)；`tests/password-reset.spec.ts` (改密后会话清空) |
| 修改用户简介/网站/个人资料 | ✅ 已实现 | `src/app/api/users/me/route.ts` (GET / PATCH) |
| 头像上传、裁剪与保存 | ✅ 已实现 | `src/lib/avatar.ts` (magic number 嗅探 + 随机路径)；`src/app/api/users/avatar/route.ts` (POST / DELETE) |
| 关注与取消关注用户 | ✅ 已实现 | `src/app/api/users/follows/route.ts` (POST / DELETE) |
| 关注用户的主题列表 | ✅ 已实现 | `src/app/api/users/follows/topics/route.ts` (GET) |
| 用户收藏管理 | ✅ 已实现 | `src/app/api/collections/route.ts` (v0.0.2 已有) |
| 通知已读 / 全部已读 / 删除 | ✅ 已实现 | `src/app/api/notifications/route.ts` (GET / POST / DELETE)；`src/components/NotificationsList.tsx` (UI) |
| **@ 提及通知** | ✅ 已实现（**v0.0.5 补齐半成品**） | `src/lib/mentions.ts`（解析 `@username`，边界：只对真实用户 / 不给自己 / 去重 / 单条上限 10）；`src/app/api/replies/route.ts`（回复时写入 `type: 'mention'` 通知）；`tests/v005-mentions.spec.ts`（19 条）、`e2e/v005-mentions.spec.ts`（6 条端到端）；`docs/COMMUNITY_FEATURES_EVALUATION_v0.0.5.md`（**含原站实测：无私信功能的证据**）。**v0.0.5 修复**：提及的用户名长度规则曾与注册校验不一致（3-20 vs 2-32）⇒ 13-32 字符的合法用户名 @ 提及**静默失效** ⇒ 已对齐并加一致性守护测试 |

## 社区积分与互动机制

| 功能 | 状态 | 实现位置 | 验证证据 |
|---|---|---|---|
| 铜币余额显示 | ✅ 已实现 | `src/app/api/credits/route.ts` (GET)；`src/app/leaderboard/page.tsx` (排行榜页) |
| 不可篡改的积分流水 | ✅ 已实现 | `src/db/schema.ts` (credit_ledger 表（只 INSERT）)；`src/lib/credit-service.ts` (verifyLedgerIntegrity) |
| 发帖与回复积分规则 | 🔶 独立实现 | `src/lib/credit-service.ts` (topic_created / reply_created) |
| 感谢行为与积分处理 | 🔶 独立实现 | `src/lib/credit-service.ts` (topic_thanked) |
| 每日签到 | ✅ 已实现 | `src/app/api/checkin/route.ts` (GET / POST)；`src/components/CheckinButton.tsx` (UI)；`tests/credits-concurrency.spec.ts` (并发只签到一次) |
| 积分排行榜 | ✅ 已实现 | `src/app/api/leaderboard/route.ts` (GET)；`src/app/leaderboard/page.tsx` (页面) |
| 用户活跃度统计 | ✅ 已实现 | `src/lib/credit-service.ts` (leaderboard 附带统计) |
| 重复奖励防护 | ✅ 已实现 | `src/lib/credit-service.ts` (idempotencyKey 唯一索引)；`tests/credits-concurrency.spec.ts` (10 并发只 1 条流水) |
| 余额不足时拒绝扣费 | ✅ 已实现 | `src/lib/credit-service.ts` (InsufficientCreditsError)；`tests/credits-concurrency.spec.ts` (30 并发恰好 10 成功) |
| 管理员调整积分及审计 | ✅ 已实现（v0.0.5 接通） | `src/lib/credit-service.ts` (adminAdjustCredits，行锁 + 余额校验 + 不可篡改账本)；`src/app/api/admin/credits/route.ts`（POST，权限 `credits.adjust` **仅 admin**）；`src/components/AdminConsole.tsx`「积分」tab（二次确认 + 理由必填 + 单次上限 100 万）；`src/lib/audit.ts` (USER_CREDITS_ADJUST)。⚠️ v0.0.5 前该 service **无任何调用方、无 API、无 UI**，此前的 ✅ 标注不实 —— 已由本轮接通 |

## 节点与内容分发

| 功能 | 状态 | 实现位置 | 验证证据 |
|---|---|---|---|
| 节点分类、子节点及面包屑 | ✅ 已实现 | `src/lib/node-service.ts` (nodeBreadcrumb（含环检测）)；`src/app/api/nodes/route.ts` (GET) |
| 节点创建与管理审批 | ✅ 已实现 | `src/app/api/node-requests/route.ts` (POST)；`src/app/api/admin/node-requests/[id]/approve/route.ts` (POST) |
| 节点收藏 | ✅ 已实现 | `src/app/api/collections/route.ts` (target=node) |
| 节点主题数量与最新回复统计 | ✅ 已实现 | `src/lib/node-service.ts` (listNodes 实时统计) |
| 首页最新、热门与分类列表 | ✅ 已实现 | `src/app/page.tsx` (v0.0.2 已有)；`src/app/nodes/page.tsx` (节点列表) |
| 搜索结果分页、排序与过滤 | ✅ 已实现 | `src/app/api/search/route.ts` (GET)；`tests/feed-search.spec.ts` (注入防护与分页上限) |
| **中文搜索（bigram 分词）** | ✅ 已实现（**v0.0.5 实测选型**） | `src/lib/search-tokenize.ts`（CJK 相邻二元组 + 拉丁整词，**零扩展依赖**）；`src/app/api/search/route.ts`（**两阶段**：整串快查 → 无结果时 bigram AND 回退）；`docs/SEARCH_BENCHMARK_v0.0.5.md`（**四方案横向实测 + 性能对照报告**）；`tests/v005-search-quality.spec.ts`（8 条方案对比）、`tests/v005-search-tokenize.spec.ts`（26 条）、`e2e/v005-search.spec.ts`（9 条端到端）。**实测结论**：本机 PG **没有** `zhparser`/`pg_jieba` ⇒ 中文分词必须自研；bigram OR 有严重假阳性（5000/5000 全中）⇒ 最终采用「整串 + AND 回退」 |
| 节点 RSS | ✅ 已实现 | `src/app/api/nodes/[name]/feed/route.ts` (GET) |
| 全站 RSS / Atom | ✅ 已实现 | `src/app/api/feed/route.ts` (GET)；`src/app/api/feed/atom/route.ts` (GET) |
| JSON Feed | ✅ 已实现 | `src/app/api/feed/json/route.ts` (GET) |
| 缓存与缓存失效 | ✅ 已实现 | `src/app/api/feed/route.ts` (Cache-Control 300s)；`src/app/api/nodes/route.ts` (Cache-Control 60s) |

## 后台管理

| 功能 | 状态 | 实现位置 | 验证证据 |
|---|---|---|---|
| 用户列表、搜索及角色管理 | ✅ 已实现 | `src/app/api/admin/users/route.ts` (GET)；`src/app/api/admin/users/[id]/role/route.ts` (PATCH)；`src/components/AdminConsole.tsx` (UI) |
| 用户封禁、解除封禁 | ✅ 已实现 | `src/app/api/admin/users/[id]/ban/route.ts` (POST)；`src/app/api/admin/users/[id]/unban/route.ts` (POST) |
| 主题与回复举报（**用户端提交**） | ✅ 已实现（v0.0.5 新增） | `src/app/api/reports/route.ts`（POST 提交 / GET 我的举报）；`src/components/ReportButton.tsx`（原因单选 + 补充说明，内联表单）；`src/lib/report-reasons.ts`（固定原因列表，服务端与前端共用）。防护：CSRF + 限流（10 次/小时）+ 防重复（部分唯一索引 `reports_reporter_target_uidx`）+ 不能举报自己 + 目标必须存在 |
| 举报处理（管理端） | ✅ 已实现 | `src/app/api/admin/reports/route.ts` (GET)；`src/app/api/admin/reports/[id]/handle/route.ts` (POST，accept 隐藏内容)；`AdminConsole`「举报」tab |
| 举报结果用户可见反馈 | ✅ 已实现（v0.0.5 新增） | `src/app/reports/page.tsx`「我的举报」页（状态 + 处理备注 + 目标标题）；处理时写 `notifications`（`type: 'system'`）通知举报者 |
| 防重复举报 / 防刷举报 | ✅ 已实现（v0.0.5 新增） | `drizzle/0003_v005_reports.sql`：`reports_reporter_target_uidx`（**部分唯一索引** `WHERE status='pending'` —— 只拦进行中的重复，不阻断驳回后再举报）+ `rateLimitByUser('report', ...)` |
| 举报者身份保护 | ✅ 已实现 | 「我的举报」页与 `GET /api/reports` 只返回**自己**的举报；**不显示处理人 ID 与用户名**（避免骚扰/报复处理人）；处理通知的消息不含处理人身份 |
| 举报提交审计 | ✅ 已实现（v0.0.5 新增） | `AuditAction.REPORT_SUBMIT`（提交）+ `AuditAction.REPORT_HANDLE`（处理）构成完整链路 |
| 待审核列表 | ✅ 已实现 | `src/app/api/admin/pending/route.ts` (GET) |
| 内容隐藏与恢复 | ✅ 已实现 | `src/lib/content-service.ts` (softDelete / restore)；`src/app/api/admin/reports/[id]/handle/route.ts` (accept 时隐藏) |
| 节点审核 | ✅ 已实现 | `src/app/api/admin/node-requests/route.ts` (GET) |
| 管理员操作日志 | ✅ 已实现 | `src/app/api/admin/logs/route.ts` (GET)；`src/lib/audit.ts` (moderation_logs) |
| 违规内容处理记录 | ✅ 已实现 | `src/app/api/admin/reports/route.ts` (处理状态与备注) |
| 系统配置展示 | ✅ 已实现 | `src/app/api/admin/config/route.ts` (GET，凭据脱敏) |
| 基础社区统计 | ✅ 已实现 | `src/app/api/admin/stats/route.ts` (GET) |

## REA 高保真视觉复刻

| 功能 | 状态 | 实现位置 | 验证证据 |
|---|---|---|---|
| 桌面端与移动端双端 | ✅ 已实现（**v0.0.5 修复断点**） | `src/app/globals.css`（**820px / 500px 断点** —— v0.0.5 把重排断点从 600px 提到 820px，与 body 的桌面最小宽对齐）；`docs/CROSS_BROWSER_VISUAL_REPORT_v0.0.5.md`（**3 浏览器 × 5 视口实测**，160/160 通过）|
| 交互状态（hover/focus/加载/禁用/错误） | ✅ 已实现 | `src/components/TopicActions.tsx` (pending/error/disabled)；`src/app/globals.css` (:focus-visible) |
| 基础无障碍能力 | ✅ 已实现 | `src/app/globals.css` (prefers-reduced-motion)；`src/components/TopicActions.tsx` (aria-label / aria-pressed) |
| 视觉回归截图 | ✅ 已实现 | `docs/evidence/screenshots/` (多视口截图)；`docs/VISUAL_DIFF_REPORT.md` (差异报告) |
| **v0.0.5 升级 / 备份恢复验证** | ✅ 已实现（**实跑通过**） | `scripts/release/verify-upgrade-v005.sh`（**PASS=17 / FAIL=0**：v0.0.4→v0.0.5 原地升级、业务数据指纹逐字节一致、迁移幂等、备份→恢复指纹一致）；`docs/UPGRADE_RECOVERY_v0.0.5.md`（**实测报告**，含**实跑中发现的 4 个 Windows 专属缺陷**）。⚠️ Linux 全新装与 Docker 容器验证**未实跑**（本机无 Docker / 无 Linux 环境）|
| **v0.0.5 新增路径性能压测** | ✅ 已实现 | `scripts/perf/v005-path-benchmark.ts`（搜索/通知/积分三条路径，**测生产 SQL 形态**）；`docs/PERF_BENCHMARK_v0.0.5.md`（**实测报告**：搜索 P95 6ms / 通知 1ms / 积分 1ms；并记录「**2 字中文查询命中不了 trigram 索引**」这一实测发现与决策依据）|
| **多浏览器 × 多视口 E2E** | ✅ 已实现（**v0.0.5 新增**） | `playwright.config.ts`（`E2E_CROSS=1` 展开 **3 浏览器 × 5 视口 = 15 个 project**）；`e2e/v005-cross-browser.spec.ts`（11 条 × 15 project = **160 条全绿**）；`docs/CROSS_BROWSER_VISUAL_REPORT_v0.0.5.md`（**实测发现 3 个真实缺陷**）。⚠️ WebKit ≠ 真实 Safari（Playwright 移植版），真实 Safari 未验证 |

## 统计

- 需求条目总数：**58**
- 已实现（含独立实现标注）：**58**
- 未实现：**0**

## 独立实现标注说明

以下内容**无法从公开信息确证原站规则**，本项目采用独立实现并已在代码与文档中标注：

1. **积分额度数值** —— 可观察到的依据只有 `users.balance` 字段注释
   （「原站通过每日登录/发帖等行为累积」）与 `credit_ledger` 枚举类型。
   具体数值无从确证，故全部做成可配置：
   `TOPIC_CREDITS`(5) / `REPLY_CREDITS`(2) / `CHECKIN_CREDITS`(2) /
   `CHECKIN_STREAK_BONUS`(1) / `CHECKIN_STREAK_BONUS_MAX`(10)。
2. **窄屏响应式重排** —— 原站桌面版 `.content` 有 `min-width:600px`，
   在 375px 视口下会横向滚动（原站移动版是独立站点）。
   本项目改为响应式重排（主区占满、侧栏后置），**有意与原站桌面版不同**。
3. **编辑时间限制默认值** —— 60 分钟为可配置默认值，非原站确认值。

