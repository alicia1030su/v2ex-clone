# FEATURE_MATRIX — 功能矩阵与验证状态

> 本版（v0.0.15）的当前测试基线、门禁结果与授权边界见
> [`docs/SESSION_HANDOFF_v0.0.15.md`](SESSION_HANDOFF_v0.0.15.md)；
> v0.0.14 的发布记录见 [`docs/SESSION_HANDOFF_v0.0.14.md`](SESSION_HANDOFF_v0.0.14.md)；
> 下文「验证方式」列出的测试文件即可复现这些结论。
>
> 验证方式：每个功能都通过**实际运行**验证（HTTP 响应码 / 数据库查询 / Playwright 交互）。
> 不接受「未验证的成功声明」——状态一律按下方**六类图例**标注，
> 不得为了「全绿」把未验证项写成已验证。
>
> ⚠️ **2026-11-08 全面复核（V10-22）**：本文件自 v0.0.3 写就后**长期未同步**，
> 累计 **12 处**已实现的功能仍被标成 `❌ 未实现` / `⚠️ 仅数据模型`（详见
> `BUG_REGISTER.md` V10-22 的逐条取证）。本轮已按**代码 + 测试实测**逐条改正，
> 并新增「旧版 JSON API」一行。复核方式：对每一条负面断言，用
> `grep -r` 在 `src/` 与 `e2e/` 里找实现与用例；找不到才保留负面状态。

## 图例（v0.0.13 重定义 —— 不得为「全绿」放宽定义）

| 状态 | 含义 | 允许标为此状态的最低条件 |
|---|---|---|
| ✅ 已实现且已验证 | 代码存在，**且有当前版本可复现的自动化证据** | 引用的 spec 文件存在且在本版本 CI / 本机实跑通过 |
| 🟡 已实现但未验证 | 代码存在，但**当前版本**没有跑过对应验收 | 必须写明「缺哪一轮证据」 |
| ⚠️ 部分实现 | 核心路径可用，但有明确未覆盖部分 | 备注里列出未覆盖项 |
| 🔶 独立实现 | 与原站不同，采用本项目自定义规则 | 必须写明「原站行为未实测 / 无法确认」 |
| ❌ 确认缺失 | 明确没有实现 | 必须附可核查路径或原因 |
| ◻️ 原站行为无法确认 | 原站已下线 / 禁止访问 / 无法验证 | **不得**据此推断「已兼容」或「不需要实现」 |

> **范围声明（重要）**：本矩阵**只代表其列出的范围**，
> **不代表**覆盖 V2EX 原站的全部功能，也不代表覆盖 API 2.0、
> 未列出的历史端点或未来行为。旧版 API 的独立核对见
> `docs/LEGACY_API_MATRIX_v0.0.13.md`。
>
> **证据口径**：所有 v0.0.3 ~ v0.0.12 的测试数字都是**历史记录**，
> 只作为当时状态的存档保留；**v0.0.13 的当前验收必须引用当前证据**
> （`docs/SESSION_HANDOFF_v0.0.13.md` 的「当前测试基线」小节 +
> `docs/release-facts.json` + 本版本 CI run）。不得把历史数字写成当前结论。
>
> **状态治理**：`tests/static/v013-docs-authenticity.spec.ts` 会校验
> 本文件的图例、范围声明、当前证据段与 v0.0.13 新增行的证据路径；
> 缺一项即判红。

## 1. 账号体系

| 功能 | 原站证据 | 本地实现 | 后端 | 验证方式 | 状态 |
|---|---|---|---|---|---|
| 注册 | `/signup`（原站跳转 `edge.v2ex.com/signup`） | `/signup` + `POST /api/auth/signup` | `users` 表 | E2E：注册后自动登录并可访问 /settings | ✅ |
| 登录 | `/signin` 表单 `POST /signin`，字段 `username`/`password` | `/signin` + `POST /api/auth/signin` | `sessions` 表 + HttpOnly Cookie | E2E：登录后导航栏显示用户名 | ✅ |
| 退出 | 顶栏用户菜单 | `POST /api/auth/signout` | 删除 session 行 + 清 Cookie | E2E：退出后访问 /settings 跳转登录 | ✅ |
| 会话保持 | — | `v2_session` HttpOnly / SameSite=Lax / 14 天 | `sessions` 表 | E2E：连续请求保持登录态 | ✅ |
| 用户名唯一（大小写不敏感） | — | `uniqueIndex(lower(username))` | `users_username_lower_uidx` | 单元：注册 `Admin` 与 `admin` 冲突 | ✅ |
| 密码强度 | — | 最少 8 位，scrypt 哈希 | — | E2E：短密码被拒绝 | ✅ |
| 登录限流 | — | 每 IP 每 60 秒 10 次 | Redis/PG 计数 | E2E：连续错误登录触发 429 | ✅ |
| 账号状态（active/suspended/banned） | — | 登录时校验 | `users.status` | 单元：banned 账号登录返回 403 | ✅ |

## 2. 节点与分类

| 功能 | 原站证据 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|---|
| 节点列表（按分类） | `/go/go` 页面 | `/nodes` | HTTP 200 + 渲染分类块 | ✅ |
| 节点详情页 | `/go/tech` | `/go/[name]` | HTTP 200 | ✅ |
| 节点订阅（Atom/JSON Feed） | `/feed/{node}.xml`、`.json` | **原站路径** `GET /feed/{node}.xml`（Atom 1.0，50 条）与 `/feed/{node}.json`（JSON Feed 1.0）；另保留 `GET /api/nodes/{name}/feed`（RSS 2.0） | 静态形状护栏（`tests/static/v010-legacy-feed-shape.spec.ts` 13 条）+ E2E（`e2e/v010-legacy-feed.spec.ts` 6 条） | ✅ |
| 子节点 | 节点页「子节点」区块 + `<node-sidebar>` 自定义元素 | `nodes.parentId` + 渲染 | 数据模型 + 渲染 | ✅ |
| 管理员创建节点 | — | `POST /api/nodes`（admin→active，moderator→pending） | E2E + 单元 | ✅ |
| 节点审核 | — | `PATCH /api/nodes`（approve/hide） | 单元 | ✅ |
| 节点名唯一 | — | `uniqueIndex(nodes_name_uidx)` | 单元 | ✅ |
| 节点名格式校验 | — | `^[a-z0-9][a-z0-9_-]{1,31}$` | 单元 | ✅ |
| 节点收藏（"加入收藏"） | 原站节点页有「加入收藏」按钮 | `POST /api/collections` target=node | E2E | ✅ |
| **节点可见性（hidden/pending 不得漏出）** | 原站隐藏节点不下发内容 | `src/lib/node-visibility.ts` 的 `PUBLIC_NODE_CONDITION` 被**站内全部公共读取路径**引用（`queries.ts` 的 8 个查询 + 14 个直接持 SQL 的文件 + 6 个委托页面）；`includeHiddenNode` 仅 staff 审核入口显式放行 | 真库 `tests/v014-node-visibility.spec.ts` 6 条（active→hidden→active 三态闭环）+ 静态 `tests/static/v014-node-visibility.spec.ts` + E2E `e2e/v014-node-visibility.spec.ts`（首页/热门/最新/节点目录/节点页/标签页/主题页/主题API/搜索/联想/Feed 全链路，且 staff 与公众视角分离） | ✅ 已实现且已验证（**v0.0.14 补齐**：v0.0.13 只覆盖旧版 API 与 Feed 7 条路径，站内一条都没接） |
| **分类管理（创建/改名/排序/禁用）** | 原站分类由后台维护 | 迁移 `0004_v014_categories`（`hidden` / `updated_at` / `(sort,id)` 索引）+ `src/server/categories.ts`（`pg_advisory_xact_lock` 串行化）+ `GET/POST /api/admin/categories`、`PATCH /api/admin/categories/[id]` + 后台「分类」tab | 真库 `tests/categories-admin.spec.ts` 22 条（含并发同名 create 只成功一个）+ 静态 `tests/static/v014-categories.spec.ts` | ✅ 已实现且已验证（**v0.0.14 补齐**：此前全仓零写入，分类只能由 seed 写入） |

## 3. 主题

| 功能 | 原站证据 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|---|
| 主题列表（首页） | `/` 50 条 `item_title` | `/` 每页 20 条 | HTTP 200 + 计数 | ✅ |
| **「最后回复来自 X」必须是真实值** | 原站每行显示真实最后回复者 | `loadLastRepliers(ids)` 供 `listTopics` / `listTopicsByNodeIds`（最热 tab）/ `listTopicsByTag`（标签页）**三处共用**；`CROSS JOIN LATERAL (… LIMIT 1)` 每帖只取 1 行；组件在 `lastReplier === null` 时**不渲染该片段** | 真库 `tests/v016-last-replier.spec.ts` **5 条**（三列表口径一致 / 零回复必须 null / 同一时刻多回复用 id 兜底保证确定性）+ 静态 `tests/static/v016-structure-guards.spec.ts` 3 条（不得 `lastReplier: null` / 组件不得作者兜底） | ✅（**v0.0.16 修缺陷**：最热 tab 与标签页此前把 `lastReplier` 硬编码 `null`，组件用 `?? author.username` 兜底 ⇒ 每行都写「最后回复来自 <楼主>」。实测 6 条里 **5 条**是错的） |
| 主题列表（节点页） | `/go/tech` 20 条 | `/go/[name]` | HTTP 200 | ✅ |
| **热门页 `/hot`** | 原站有独立热门页 | `/hot`（`listTopics({ sort:'hot' })`） | 站内入口由 `src/lib/nav-links.ts` 的 `CONTENT_LINKS` 提供（游客与登录用户都有）；静态 `tests/static/v014-orphan-pages.spec.ts` 断言四种身份导航都含该入口 | ✅（**v0.0.14 补入口**：页面早已存在但全站零链接，属孤儿页） |
| **最新页 `/recent`** | 原站有独立最新页 | `/recent`（`listTopics({ sort:'created' })`） | 同上 | ✅（**v0.0.14 补入口**，同上） |
| **公共列表 `page` 参数校验** | — | `src/lib/page-param.ts`：`parsePageParam()` 只接受十进制正整数，非法一律回退第 1 页，超过 `MAX_PAGE=1000` **钳到上限**；`clampOffset()` 保证 OFFSET 不溢出 | 单元 `tests/page-param.spec.ts` 24 条 + 静态 `tests/static/v014-page-param.spec.ts`（10 个页面必须接入 + 全仓反向断言 + 正则鉴别力对照） | ✅（**v0.0.14 补齐**：原实现 `Math.max(1, Number(p ?? 1) || 1)` 会放过 `'1.5'` 与 `'Infinity'` ⇒ SQL 报错 500） |
| 主题详情 | `/t/1253638` | `/t/[id]` | HTTP 200 + 楼层号连续 | ✅ |
| 主题浏览计数 | `· N 次点击` | `topics.views` 每次 +1 | DB 查询前后对比 | ✅ |
| 主题投票（顶/踩） | `upVoteTopic(id)` / `downVoteTopic(id)` JS 函数 | `TopicActions.tsx` 箭头按钮 → `POST/DELETE /api/votes` | E2E：点击后计数增加、刷新仍正确、重复点击不叠加、未登录不显示 | ✅ |
| 主题置顶 | — | `topics.pinned` + `POST /api/topics/[id]/pin`/`unpin` + 后台按钮 | E2E：管理员操作成功并写入状态、普通用户被拒 | ✅ |
| 主题锁定 | — | `topics.locked` + 回复时 403 校验 | 单元 + E2E | ✅ |
| 主题编辑（作者） | — | `TopicActions.tsx` 编辑表单 → `PUT /api/topics/[id]`（含编辑时限） | E2E：改正文后页面展示、刷新仍生效；他人主题无编辑按钮 | ✅ |
| 主题软删除（作者/管理员） | — | `DELETE /api/topics/[id]` → `deleted_at` 软删；`POST /api/topics/[id]/restore` 恢复 | E2E：作者删除后普通访问者不可见、管理员恢复后重新可见 | ✅ |
| 主题编辑历史 | — | `GET /api/topics/[id]/edit-history` | 单元 | ✅ |
| 标签（发帖/编辑追加/**移除** + 检索） | 主题页 `/tag/{name}` 标签块；**原站标签由后台算法生成、前台无输入框** | `src/lib/tag-normalize.ts`（规范化：小写/去重/折叠空白/上限 5×24）+ `src/server/tags.ts`：`attachTags` 在**事务内 `FOR UPDATE`** 锁主题行、按剩余额度写入（**总量** ≤ 5，追加不会累加超限）、`detachTags` 只删关联不删本体、`loadTagNames` 码点排序；`PUT /api/topics/[id]` 支持 `tags`（追加）与 `removeTags`（移除），且**鉴权先于写标签** | 单元 `tests/tag-normalize.spec.ts` 15 条 + `tests/tag-encoding.spec.ts` 15 条 + 真库 `tests/tags-db.spec.ts` **25 条**（含真 `Promise.all` 并发总量 ≤ 5、已有标签不占额度、detach 释放额度）+ 静态 `tests/static/v014-tag-chain.spec.ts` + E2E `e2e/v014-tags.spec.ts` 4 条（发帖→主题页→标签页→大小写归一→中文编码路径→`%` 不 500） | ✅ 已实现且已验证（**v0.0.14 收口**：写入链路 + 总量上限 + 移除语义 + 编码边界） |

## 4. 回复

| 功能 | 原站证据 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|---|
| 回复列表 | `#r_{id}` 锚点 | `/t/[id]` | HTTP 200 + 楼层连续 | ✅ |
| 楼层号 | `<span class="no">N</span>` | `replies.floor` 唯一索引 | DB 查询 | ✅ |
| 提交回复 | 主题页回复框 | `POST /api/replies` | E2E：回复后楼层+1 | ✅ |
| 回复计数同步 | `topics.repliesCount` | 事务内 `+1` | E2E | ✅ |
| 最后回复时间同步 | `topics.lastReplyAt` | 同步更新 | DB | ✅ |
| 回复感谢（❤️） | `<span class="small fade">❤️ N</span>` | `ReplyItem.tsx` 感谢按钮 → `POST /api/thanks`；`thanks` 表 | E2E：跨用户感谢成功、重复不叠加、不能感谢自己 | ✅ |
| 回复编辑 / 软删除 | — | `ReplyItem.tsx` 内联编辑 → `PUT /api/replies/[id]`；删除走软删 | E2E（四身份验收 28 步含「编辑回复」） | ✅ |
| 引用回复 | — | `replies.quoteId` + `ReplyItem` 显示被引用内容与跳转锚点 | E2E（v004 内容交互套件） | ✅ |
| 回复限流 | — | 每用户每 60 秒 20 次 | E2E | ✅ |
| **回复区结构（不得 `.box > .cell > .cell` 嵌套）** | 原站回复头是**单行**「N 条回复 • 时间」+ 右上标签 | `TopicActions` 在**主题内容区**的独立 cell，不在回复区；且与 `user` **同生命周期条件渲染**（未登录不渲染，避免空 20px 盒子） | 静态 `tests/static/v016-structure-guards.spec.ts` 4 条（回复区不得嵌套 cell / 回复区内不得出现 TopicActions / 返回 null 的组件不得裸包 cell）+ 结构探针 `tools/visual/probe-pages.mjs` 的 `badNesting` 与 `emptyCells` **已计入硬缺陷退出码** | ✅（**v0.0.16 修缺陷**：操作栏曾写在回复头 cell **内部**，匿名访客看到空 21px cell，回复头被拆三段；探针的 emptyCells 此前只打印不判红） |

## 5. 通知

| 功能 | 原站证据 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|---|
| 回复通知 | 原站 `/notifications` | `POST /api/replies` 自动写入 | 真库 + E2E：**真实双用户**（两个独立 `BrowserContext`，A 发主题 / B 回复 / A 收到） | ✅（**v0.0.15 补齐双用户真实验收**） |
| 通知列表 | — | `/notifications` + `GET /api/notifications` | 静态 200（登录态）+ 真库 20 条 + E2E 8 条 | ✅ |
| **通知可见性（hidden 节点 / 软删主题不得泄露标题）** | — | `src/server/notifications.ts` 的 `visibleNotificationCondition()`；`list / total / unread` **同一带 join 基座**（`count(*) FILTER` 一次聚合） | 真库 `tests/v015-notifications-db.spec.ts` 20 条 + 静态护栏；**负向对照**：条件改恒真 ⇒ 6 条判红 | ✅（**v0.0.15 补齐**：修复前 `message` 内嵌的标题在节点 hidden / 主题软删后仍照常返回，且提及通知的收件人是**任意第三方** ⇒ 真实跨用户泄露） |
| 未读计数 | — | 与列表**同口径**（`count(*) FILTER`） | 真库（「列表已过滤但总数没过滤」的分页错位已被结构性排除） | ✅ |
| 通知已读标记 | — | `NotificationsList.tsx` → `POST /api/notifications`（给 id 标单条，不给则全部已读） | E2E（v004 账号套件 + v015 刷新后状态保留） | ✅ |
| @ 提及通知 | 原站 `@username` | `POST /api/replies` 解析提及 | E2E：被提及者收到、不给自己发、邮箱不误判、重复去重、上限 10；**v0.0.15 加双用户真实验收** | ✅ |
| **系统通知（举报处理结果）** | — | `/api/admin/reports/[id]/handle` 写 `type='system'` | 真库 3 条：`topicId=null` / 指向已删主题 / 指向 hidden 节点，**三者都必须可见** | ✅（**v0.0.15 修掉一个回归**：`accept` 会先软删被举报主题再写通知，若按主题可见性过滤则**举报人永远收不到结果**） |
| 收藏触发通知 | ❌ **产品未设计** | `/api/collections` 从不写通知 | 断言「确实不产生」（**不凭空新增**） | ⬜ **不适用** |
| 节点感谢通知（`node_thanks`） | ❌ **产品未设计** | 枚举有，全仓**零写入点** | 断言「从未出现」（**不凭空新增**） | ⬜ **不适用** |

## 6. 收藏

| 功能 | 原站证据 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|---|
| 收藏主题 | 原站主题页收藏按钮 | `POST /api/collections` target=topic | E2E | ✅ |
| 取消收藏 | — | action=remove | E2E | ✅ |
| 收藏节点 | 原站「加入收藏」 | target=node | E2E | ✅ |
| 收藏列表页 | 原站 `/bookmarks` | `/bookmarks` | HTTP 200 | ✅ |
| 收藏唯一约束 | — | 唯一索引 + onConflictDoNothing | 单元 | ✅ |
| **收藏交互幂等（状态不得被异步校准覆盖）** | — | `CollectButton.tsx`：`userActedRef` 保证「用户操作过就丢弃挂载校准结果」；`if (pending) return` 阻止双击发两个 POST | 静态 `v016-structure-guards.spec.ts` 2 条；真实浏览器实测「点击后 2.5s 仍稳定 + 刷新后保持」 | ✅（**v0.0.16 修缺陷**：点收藏 → 变「已收藏」 → 一两秒后**自己变回「收藏」**，刷新又显示已收藏。数据库对、UI 错、无任何报错） |

## 7. 关注

| 功能 | 原站证据 | 本地实现 | 状态 |
|---|---|---|---|
| 关注用户 | 原站「关注」tab 明确区别于节点收藏（见 `/t/645662` 讨论） | `FollowButton.tsx` → `POST/DELETE /api/users/follows`；`follows` 表 | ✅ |
| 关注流（关注的用户发布的主题） | 原站首页「关注」tab | `/following` 页（关注的人 + 其发布的主题）+ `GET /api/users/follows/topics` | ✅ |

## 8. 搜索

| 功能 | 原站证据 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|---|
| 顶栏搜索建议（AJAX） | 原站 `#search-result` 下拉 | `/api/search/suggest` | E2E：输入后出现建议 | ✅ |
| 搜索结果页 | 原站 `/go/search?q=` | `/go/search?q=` | HTTP 200 | ✅ |
| 主题搜索（标题+正文） | — | `ilike` on title/content | E2E | ✅ |
| 节点搜索 | — | `ilike` on title/name | E2E | ✅ |
| 会员搜索 | — | `ilike` on username | E2E | ✅ |

## 9. 积分

| 功能 | 原站证据 | 本地实现 | 状态 |
|---|---|---|---|
| 积分字段 | 原站 `/values`（新版）、用户页显示 | `users.balance` | ✅ |
| 发帖加积分 | — | `POST /api/topics` 后 +10（额度可配置，非原站确认值） | ✅ |
| 每日签到加分 | 原站每日登录行为 | `POST /api/checkin`（同日重复不重复发放、连续签到额外奖励） | ✅ |
| 积分排行榜 | 原站 `/values` | `/leaderboard` 页 + `GET /api/leaderboard`（与页面同一服务函数，口径一致） | ✅ |
| 管理员积分调整 | — | 后台 `POST /api/admin/credits`（含 `credit_ledger` 幂等） | ✅ |

> ⚠️ 积分**额度**（TOPIC_CREDITS / REPLY_CREDITS / CHECKIN_CREDITS 等）是
> **独立替代实现**，原站真实数值无法从公开信息确证，一律可配置，见
> `src/lib/credit-service.ts` 文件头。

## 10. 权限与管理

| 功能 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|
| 角色体系（user/moderator/admin） | `users.role` | — | ✅ |
| 普通用户不能创建节点 | `POST /api/nodes` 要求 staff | E2E | ✅ |
| 版主创建节点进入待审 | status=pending | 单元 | ✅ |
| 仅管理员可审核节点 | `PATCH /api/nodes` 要求 admin | 单元 | ✅ |
| 管理后台页面 | `/admin`（staff only） | E2E | ✅ |
| 管理日志 | `moderation_logs` 表 + 后台展示 | DB + 渲染 | ✅ |
| 非 staff 访问 /admin 重定向 | — | E2E | ✅ |
| 版主可看审计日志、看不到管理员专属控件 | 后台 tab 按角色渲染 | E2E（四身份验收） | ✅ |

## 11. 安全

| 项目 | 实现 | 验证方式 | 状态 |
|---|---|---|---|
| 密码哈希 | scrypt + 随机 salt | 单元 | ✅ |
| 会话 Cookie HttpOnly/SameSite | `setSessionCookie` | 响应头检查 | ✅ |
| 开放重定向防护 | `sanitizeRedirect` 仅允许 `/` 开头且非 `//` | 单元 | ✅ |
| XSS 防护（正文） | `sanitize-html` 白名单清洗（`src/lib/markdown.ts`） | 单元 + E2E | ✅ |
| XSS 防护（搜索/昵称等） | React 自动转义 | E2E | ✅ |
| CSRF 防护 | **双提交 Cookie**（`v2_csrf` 非 HttpOnly）+ 服务端 `guardCsrf` 校验请求头 `x-csrf-token`；所有写路由覆盖 | E2E（无 token 403 / 合法 token 通过 / 重放被拒）+ 静态守卫 | ✅ |
| Host Header 投毒防护 | 303 用站内相对 Location；邮件链接 fail-closed（`resolvePublicBaseUrl`） | 攻击矩阵 19/19 SAFE | ✅ |
| 速率限制 | 登录/注册/发帖/回复/改密/建节点/投票/举报 | E2E | ✅ |
| SQL 注入 | Drizzle 参数化查询 + 静态守卫禁止 `sql.raw` 与模板拼接 | 代码审查 + 静态守卫 | ✅ |
| 越权访问他人收藏 | 按 `userId` 过滤 | 单元 | ✅ |
| 越权编辑/删除他人内容 | `PUT/DELETE /api/topics/[id]` 服务端二次校验作者或 staff | E2E：他人主题页无编辑/删除按钮 + 服务端 403 | ✅ |
| 安全响应头 | X-Content-Type-Options / X-Frame-Options / Referrer-Policy | 响应头检查 | ✅ |

## 12. 视觉还原

| 项目 | 实测结果 | 状态 |
|---|---|---|
| 设计 token 提取（`:root` CSS 变量） | 40 个变量全部从原站 combo.css 实测提取 | ✅ |
| 页面宽度（内容容器 1100px / 主栏 770px / 侧栏 270px） | 10/10 页面 Δw = 0 | ✅ |
| 顶栏高度 / Logo 位置尺寸 | 10/10 页面 Δx=Δy=Δw=Δh = 0 | ✅ |
| 配色、圆角、阴影、字号、行高 | 逐项按实测值对齐 | ✅ |
| 主题项 / 回复项 DOM 结构 | 与原站结构一致（`#TopicsNode > .cell.from_{uid}.t_{id}`） | ✅ |
| 背景色归属（灰色只在 `#Wrapper`） | 修复后 signin 差异率由 65.08% 降至 15.29% | ✅ |
| 顶栏阴影带高度 | v0.0.10 修复：118px → 28px（原站 30px），逐点灰度偏差 ≤2 色阶 | ✅ |
| 页脚 `#Bottom` | 已实现（链接组、在线人数、版本行、世界时钟、标语） | ✅ |
| 登录页验证码 | 服务端生成 320×80 SVG，哈希存储、一次性、字段名哈希化 | ✅ |
| 截图对比与量化差异报告 | 12 类页面 × 4 视口 = 72 张，每页 23~29 项断言；详见 `docs/evidence/visual/pages-audit.json` | ✅ |
| 像素差异（signin 最低 / topic_detail 最高） | 10.01% / 48.48% —— 差异全部来自内容数据不同 | ✅ |

### 12.1 v0.0.16 视觉与结构复核（**本轮新实测，不是历史结论**）

| 项目 | 实测结果 | 状态 |
|---|---|---|
| 几何骨架（1280×900） | 内容宽 **1060**、主栏 **770**、右栏 **270**、顶栏高 **44**、主题行高 **71** —— 与参考截图**逐项 Δ=0** | ✅ |
| 结构探针覆盖 | **21 页**（原 14 页，v0.0.16 补入 `/tag/[name]`、`/leaderboard`、`/following`、`/privacy`、`/worldclock`、`/reports`、`/admin` 访客态） | ✅ |
| 结构探针结果 | 全部 **200 / 0 空 cell / 0 非法嵌套 / 0 横向溢出 / 0 页面错误 / 0 失败请求** | ✅ |
| 六视口横向溢出 | 320×568 / 375×812 / 390×844 / 768×1024 / 1280×900 / 1920×1080 **全部无溢出** | ✅ |
| 第三方登录按钮 | 由「图标在上/文案在下的方块」改为参考站的**整行横向**（图标左 28px 槽位、文案右、250×44），可点击区同时变大 | ✅（B 类样式差异，v0.0.16 修） |
| 登录 / 注册输入框宽度 | 实测参考站约 **318px**；本站原为 `width:100%`（约 616px）⇒ 收敛为 `.auth-form` 作用域内 **320px** | ✅（B 类，v0.0.16 修） |
| 结构缺陷分级 | 已按 A（真实布局缺陷）/ B（样式实现差异）/ C（内容数据不同）/ D（有意保留）/ E（参考信息不足）分级；**`ref-nodes_all.png` 实际内容是 Go 节点页**（索引标 `no-auth-reference`）⇒ 归 **E 类**，不据此改代码 | ✅（如实登记，未拿失效参考冒充对照） |

> ⚠️ **不得**用「还原度百分比」宣传。本表只给出**可复现的测量值与 Δ**，
> 不把「差 0」外推成「视觉完全一致」—— 内容数据不同、字体渲染差异、
> 采集时原站版本差异都会影响像素比对。

## 13. 旧版 JSON API 兼容

| 端点 | 原站实测 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|---|
| `/api/topics/show.json?id=` | 200，长度 1 的数组；不存在的 id 返回 `[]`；`id=abc`/`id=0` 返回 404 `Object Not Found` | `src/app/api/topics/show.json/route.ts` | E2E 7 条（含真实数据回读、软删除不可见）+ 静态 13 条形状断言 | ✅ |
| `?username=` / `?node_name=` | 200，固定 10 条，`created` 降序；不存在 ⇒ 404 | 同上（`id > username > node_name` 优先级） | E2E | ✅ |
| `?id=…&id=…`（同名参数） | 取**最后**一个 | `parseLegacyId()` | 单元 + E2E | ✅ |
| `?limit=` | 被忽略（固定 10 条） | 同样忽略 | 单元 | ✅ |
| 响应头 | `application/json;charset=UTF-8`、`Cache-Control: public, max-age=120`、`x-rate-limit-*` | 逐项对齐 | E2E | ✅ |

> 与原站**不同**的三处已在 `src/lib/legacy-topic-api.ts` 文件头逐条写明：
> `pro` 恒 0、`twitter/github/psn/btc` 恒 null、头像为确定性占位 data URI、
> 软删除主题对公众不可见。

## 13.1 旧版 API 兼容面（v0.0.13 收尾核对）

> ⚠️ 上一版写「原站 `/api/*` 下仍有 5 个端点返回 200」—— **该结论不完整**。
> 2026-11-09 复核又发现 2 个仍返回 200 的端点，并确认
> `nodes/list.json` 的 400 是缺参而非下线。逐项实测、偏离与未验证项见
> `docs/LEGACY_API_MATRIX_v0.0.13.md`。**本表不宣称覆盖原站全部 API。**

| 端点 | 载荷 | 条数 | 当前证据（**本版本真实验收**） | 状态 |
|---|---|---|---|---|
| `GET /api/topics/show.json` | 数组（13 键） | 1 / 10 / 10 | `e2e/v010-legacy-api.spec.ts`、`tests/static/v010-legacy-api-shape.spec.ts` | ✅ 已实现且已验证 |
| `GET /api/topics/latest.json` | 数组，同形状 | 35 | `e2e/v010-legacy-api.spec.ts`、`tests/static/v010-legacy-api-shape.spec.ts` | ✅ 已实现且已验证 |
| `GET /api/topics/hot.json` | 数组，replies 降序 | 10 | `e2e/v013-legacy-api.spec.ts`、`tests/static/v013-legacy-contract.spec.ts` | ✅ 已实现且已验证（V13-02 新增） |
| `GET /api/replies/show.json` | 数组（8 键） | 主题全部回复 | `e2e/v013-legacy-api.spec.ts`、`tests/static/v013-legacy-contract.spec.ts` | ✅ 已实现且已验证（V13-03 新增） |
| `GET /api/members/show.json` | 单对象（+`status:"found"`） | — | `e2e/v013-legacy-api.spec.ts`、`tests/static/v013-legacy-privacy.spec.ts` | ✅ 已实现且已验证 |
| `GET /api/nodes/show.json` | 单对象（16 键） | — | `e2e/v013-legacy-api.spec.ts`、`tests/static/v013-legacy-privacy.spec.ts` | ✅ 已实现且已验证 |
| `GET /api/nodes/all.json` | 数组 | 库内 active 节点 | `e2e/v013-legacy-api.spec.ts` | ✅ 已实现且已验证 |
| `GET /api/nodes/list.json` | 投影数组（缺参 400） | 库内 active 节点 | `e2e/v013-legacy-api.spec.ts`、`tests/static/v013-legacy-contract.spec.ts` | ✅ 已实现且已验证（V13-04 新增） |
| `GET /feed/{node}.xml` | Atom 1.0 | 50 | `e2e/v013-feed-reader.spec.ts`、`tests/static/v013-feed-safety.spec.ts` | ✅ 已实现且已验证 |
| `GET /feed/{node}.json` | JSON Feed 1.0 | 50 | `e2e/v013-feed-reader.spec.ts`、`tests/static/v013-feed-safety.spec.ts` | ✅ 已实现且已验证 |
| `GET /api/topics.json` / `/api/nodes.json` | 原站 **404** | — | 2026-11-09 实测记录见矩阵文档 §1 | ◻️ 原站行为无法确认（已下线，不实现） |

细节与「与原站的差异」见 `docs/API_SPEC.md` §14.2 ~ §14.6。

## 13.2 功能 → 页面 → API → 权限 → 数据库 → 测试 → 状态（v0.0.13 新增面）

| 功能 | 页面入口 | API | 权限 | 数据库 | 测试 | 状态 |
|---|---|---|---|---|---|---|
| 热门主题（旧版） | 无（第三方客户端） | `GET /api/topics/hot.json` | 匿名只读 | `topics` + `users` + `nodes` + `collections` | `e2e/v013-legacy-api.spec.ts` | ✅ 已实现且已验证 |
| 主题回复（旧版） | 无（第三方客户端） | `GET /api/replies/show.json` | 匿名只读 | `replies` + `users` + `topics` | `e2e/v013-legacy-api.spec.ts` | ✅ 已实现且已验证 |
| 节点投影列表（旧版） | 无（第三方客户端） | `GET /api/nodes/list.json` | 匿名只读 | `nodes` + `collections` | `e2e/v013-legacy-api.spec.ts` | ✅ 已实现且已验证 |
| 节点订阅（原站路径） | `/go/{node}` 侧栏 Feed 图标 | `GET /feed/{node}.xml\|.json` | 匿名只读 | `topics` + `users` + `nodes` | `e2e/v013-feed-reader.spec.ts` | ✅ 已实现且已验证 |
| 跨接口字段一致性 | 无（契约约束） | 全部旧版端点 | 匿名只读 | 同上 | `e2e/v013-legacy-api.spec.ts` | ✅ 已实现且已验证 |
| 隐私与软删除不泄露 | 无（契约约束） | 全部旧版端点 | 匿名只读 | 同上 | `tests/static/v013-legacy-privacy.spec.ts` | ✅ 已实现且已验证 |
| 非幂等点击不重复提交 | 登录 / 注册 / 找回密码 | 写接口 | 登录态 | — | `tests/static/v010-click-until-request.spec.ts` | ✅ 已实现且已验证 |
| ETag / 304 增量订阅 | 6 类 Feed 路径 | Feed 路由 | 匿名只读 | — | `e2e/v013-feed-reader.spec.ts` | ✅ 已实现且已验证 |
| 原站 API 2.0（`/api/v2/*`） | — | — | 需 PAT | — | — | ❌ 确认缺失（不在 v0.0.13 范围） |
| 原站 24 小时持续运行对照 | — | — | — | — | — | ◻️ 原站行为无法确认 |

## 13.3 v0.0.13 当前验收证据（**当前，不是历史**）

> 下面只列**本次收尾 PR 实际新增 / 实跑**的证据文件；
> 具体通过数、耗时、SHA 与 CI run 见 `docs/SESSION_HANDOFF_v0.0.13.md`
> 「当前测试基线」小节和 `docs/release-facts.json`。
> v0.0.3 ~ v0.0.12 的数字在上文均标注为历史记录，**不得**当作本版本结论。

- 静态：`tests/static/v013-legacy-contract.spec.ts`、`v013-legacy-privacy.spec.ts`、
  `v013-feed-safety.spec.ts`、`v013-docs-authenticity.spec.ts`、
  `v010-click-until-request.spec.ts`
- E2E：`e2e/v013-legacy-api.spec.ts`、`e2e/v013-feed-reader.spec.ts`
- 契约矩阵：`docs/LEGACY_API_MATRIX_v0.0.13.md`
- 发布门禁：`RELEASE_GATE.md` 的 v0.0.13 Go/No-Go 段

## 14. 端到端测试覆盖

> ⚠️ 本节原有数字（「67/67 通过、约 1.1 分钟」）是 **v0.0.3 的快照**；
> 紧随其后的「220 条 / 20 文件」是 **v0.0.12 的历史记录**，同样不是当前结论。
> 权威数字见 `docs/release-facts.json`（单一事实来源），
> v0.0.13 的当前实测见 `docs/SESSION_HANDOFF_v0.0.13.md`「当前测试基线」；
> 发行门禁会与实际跑次交叉核对。

| 需求项 | 状态 | 备注 |
|---|---|---|
| 注册登录及退出 | ✅ | `e2e/auth.spec.ts` |
| 账户权限 | ✅ | `e2e/v004-account-admin.spec.ts` |
| 创建节点（管理员） | ✅ | `e2e/feature.spec.ts`（含「普通用户不能建」「版主进待审」「仅管理员审核」） |
| 创建主题 | ✅ | `e2e/v004-content-interaction.spec.ts` |
| 编辑和管理主题 | ✅ | 同上（编辑 / 软删 / 恢复 / 锁定 / 置顶各有用例） |
| 回复主题 | ✅ | `e2e/topic.spec.ts` + `e2e/v004-content-interaction.spec.ts` |
| 分页 | ✅ | `e2e/pagination.spec.ts` |
| 收藏 | ✅ | `e2e/auth.spec.ts` + `e2e/feature.spec.ts` + 四身份验收 |
| 通知 | ✅ | `e2e/v004-account-admin.spec.ts` |
| 搜索 | ✅ | `e2e/v005-search.spec.ts` |
| 用户信息更新 | ✅ | `e2e/v004-account-admin.spec.ts` |
| 管理审核 | ✅ | `e2e/v009-four-roles-acceptance.spec.ts` |
| 并发操作 | ✅ | 楼层号 / 投票并发用例 |
| 异常输入 | ✅ | `e2e/security.spec.ts` |
| CSRF | ✅ | 无 token 403 / 合法 token 通过 / 重放被拒 |
| XSS | ✅ | `e2e/security.spec.ts` |
| 越权 | ✅ | 四身份验收 + 权限边界用例 |
| 速率限制 | ✅ | 各写接口均有 429 用例 |
| 旧版 JSON API 兼容 | ✅ | `e2e/v010-legacy-api.spec.ts`（7 条）+ `e2e/v010-legacy-feed.spec.ts`（6 条） |

测试过程中发现并修复的真实产品缺陷累计 **100+ 条**，逐条取证见 `BUG_REGISTER.md`
（v0.0.4 ~ v0.0.13，编号 V4-xx / V5-xx / V6-xx / V7-xx / V8-xx / V9-xx / V10-xx）。
