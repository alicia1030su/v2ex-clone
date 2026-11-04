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
> v0.0.4 的**测试基线权威值**：单元 **190 条 / 15 文件**（190 passed / 0 failed / 0 skipped，连续 4 轮全绿）、
> E2E **153 条 / 11 文件**（153 passed / 0 failed / 0 skipped，连续 2 轮全绿，4.5m/轮）。
> ⚠️ **「185」有两个不同来源，不可混用**：① **v0.0.3 历史总数**（master @ `37710fb4`，14 文件）；
> ② **当前分支 CI 上的通过数**（run `41837212170`，`185 passed | 5 skipped (190)`，⚠️ **分母仍是 190**）。
> **无论哪种，v0.0.4 的用例总数始终是 190。**
> 口径裁决见 `TEST_REPORT.md` 文首「185 vs 190 裁决」小节与 `docs/evidence/ci/test-baseline-v0.0.4.md` §0.1。
>
> ⚠️ **v0.0.4 新增/变更项的矩阵位置**：v0.0.4 的 12 项缺陷修复、3 项性能优化、
> 升级脚本自动同步 tag、发布前只读门禁等，**不在本表逐项列出** ——
> 它们属于「缺陷修复」与「工程化」而非「功能矩阵」的范畴，
> 完整清单见 `CHANGELOG.md` `[Unreleased]` 与 `BUG_REGISTER.md`（V4-01~V4-16）。
> 本表仍以**功能存在性**为准 —— v0.0.4 未删除任何 v0.0.3 已有的功能。

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
| SMTP 可配置发送服务 | ✅ 已实现 | `src/lib/mailer.ts` (readSmtpConfig)；`src/lib/smtp-client.ts` (零依赖 SMTP 客户端) |
| 令牌过期 / 撤销 / 重放防护 | ✅ 已实现 | `src/lib/reset-token-store.ts` (三重状态 + 原子消费)；`tests/password-reset.spec.ts` (过期/撤销/重放/并发) |
| 修改密码后旧会话失效 | ✅ 已实现 | `src/app/api/auth/reset-password/route.ts` (删除该用户全部会话)；`tests/password-reset.spec.ts` (改密后会话清空) |
| 修改用户简介/网站/个人资料 | ✅ 已实现 | `src/app/api/users/me/route.ts` (GET / PATCH) |
| 头像上传、裁剪与保存 | ✅ 已实现 | `src/lib/avatar.ts` (magic number 嗅探 + 随机路径)；`src/app/api/users/avatar/route.ts` (POST / DELETE) |
| 关注与取消关注用户 | ✅ 已实现 | `src/app/api/users/follows/route.ts` (POST / DELETE) |
| 关注用户的主题列表 | ✅ 已实现 | `src/app/api/users/follows/topics/route.ts` (GET) |
| 用户收藏管理 | ✅ 已实现 | `src/app/api/collections/route.ts` (v0.0.2 已有) |
| 通知已读 / 全部已读 / 删除 | ✅ 已实现 | `src/app/api/notifications/route.ts` (GET / POST / DELETE)；`src/components/NotificationsList.tsx` (UI) |

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
| 管理员调整积分及审计 | ✅ 已实现 | `src/lib/credit-service.ts` (adminAdjustCredits)；`src/lib/audit.ts` (USER_CREDITS_ADJUST) |

## 节点与内容分发

| 功能 | 状态 | 实现位置 | 验证证据 |
|---|---|---|---|
| 节点分类、子节点及面包屑 | ✅ 已实现 | `src/lib/node-service.ts` (nodeBreadcrumb（含环检测）)；`src/app/api/nodes/route.ts` (GET) |
| 节点创建与管理审批 | ✅ 已实现 | `src/app/api/node-requests/route.ts` (POST)；`src/app/api/admin/node-requests/[id]/approve/route.ts` (POST) |
| 节点收藏 | ✅ 已实现 | `src/app/api/collections/route.ts` (target=node) |
| 节点主题数量与最新回复统计 | ✅ 已实现 | `src/lib/node-service.ts` (listNodes 实时统计) |
| 首页最新、热门与分类列表 | ✅ 已实现 | `src/app/page.tsx` (v0.0.2 已有)；`src/app/nodes/page.tsx` (节点列表) |
| 搜索结果分页、排序与过滤 | ✅ 已实现 | `src/app/api/search/route.ts` (GET)；`tests/feed-search.spec.ts` (注入防护与分页上限) |
| 节点 RSS | ✅ 已实现 | `src/app/api/nodes/[name]/feed/route.ts` (GET) |
| 全站 RSS / Atom | ✅ 已实现 | `src/app/api/feed/route.ts` (GET)；`src/app/api/feed/atom/route.ts` (GET) |
| JSON Feed | ✅ 已实现 | `src/app/api/feed/json/route.ts` (GET) |
| 缓存与缓存失效 | ✅ 已实现 | `src/app/api/feed/route.ts` (Cache-Control 300s)；`src/app/api/nodes/route.ts` (Cache-Control 60s) |

## 后台管理

| 功能 | 状态 | 实现位置 | 验证证据 |
|---|---|---|---|
| 用户列表、搜索及角色管理 | ✅ 已实现 | `src/app/api/admin/users/route.ts` (GET)；`src/app/api/admin/users/[id]/role/route.ts` (PATCH)；`src/components/AdminConsole.tsx` (UI) |
| 用户封禁、解除封禁 | ✅ 已实现 | `src/app/api/admin/users/[id]/ban/route.ts` (POST)；`src/app/api/admin/users/[id]/unban/route.ts` (POST) |
| 主题与回复举报 | ✅ 已实现 | `src/app/api/admin/reports/route.ts` (GET)；`src/app/api/admin/reports/[id]/handle/route.ts` (POST) |
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
| 桌面端与移动端双端 | ✅ 已实现 | `src/app/globals.css` (600px / 500px 断点)；`docs/evidence/visual/layout-measurements-*.json` (三视口实测) |
| 交互状态（hover/focus/加载/禁用/错误） | ✅ 已实现 | `src/components/TopicActions.tsx` (pending/error/disabled)；`src/app/globals.css` (:focus-visible) |
| 基础无障碍能力 | ✅ 已实现 | `src/app/globals.css` (prefers-reduced-motion)；`src/components/TopicActions.tsx` (aria-label / aria-pressed) |
| 视觉回归截图 | ✅ 已实现 | `docs/evidence/screenshots/` (多视口截图)；`docs/VISUAL_DIFF_REPORT.md` (差异报告) |

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

