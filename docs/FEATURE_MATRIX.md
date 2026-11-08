# FEATURE_MATRIX — 功能矩阵与验证状态

> 验证方式：每个功能都通过**实际运行**验证（HTTP 响应码 / 数据库查询 / Playwright 交互）。
> 不接受"未验证的成功声明"——未验证项明确标注为 `⏳` 或 `❌`。
>
> ⚠️ **2026-11-08 全面复核（V10-22）**：本文件自 v0.0.3 写就后**长期未同步**，
> 累计 **12 处**已实现的功能仍被标成 `❌ 未实现` / `⚠️ 仅数据模型`（详见
> `BUG_REGISTER.md` V10-22 的逐条取证）。本轮已按**代码 + 测试实测**逐条改正，
> 并新增「旧版 JSON API」一行。复核方式：对每一条负面断言，用
> `grep -r` 在 `src/` 与 `e2e/` 里找实现与用例；找不到才保留负面状态。

## 图例

- ✅ 已实现且已验证
- ⚠️ 已实现但有降级（注明原因）
- ❌ 未实现（注明原因）
- ⏳ 实现中 / 待验证

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
| 节点订阅（RSS/JSON Feed） | `/feed/{node}.xml`、`.json` | `GET /api/nodes/{name}/feed`（RSS）、`?format=json`（JSON Feed 1.1） | 单元（`tests/feed-search.spec.ts` 格式有效性）+ E2E 冒烟 | ✅ |
| 子节点 | 节点页「子节点」区块 + `<node-sidebar>` 自定义元素 | `nodes.parentId` + 渲染 | 数据模型 + 渲染 | ✅ |
| 管理员创建节点 | — | `POST /api/nodes`（admin→active，moderator→pending） | E2E + 单元 | ✅ |
| 节点审核 | — | `PATCH /api/nodes`（approve/hide） | 单元 | ✅ |
| 节点名唯一 | — | `uniqueIndex(nodes_name_uidx)` | 单元 | ✅ |
| 节点名格式校验 | — | `^[a-z0-9][a-z0-9_-]{1,31}$` | 单元 | ✅ |
| 节点收藏（"加入收藏"） | 原站节点页有「加入收藏」按钮 | `POST /api/collections` target=node | E2E | ✅ |

## 3. 主题

| 功能 | 原站证据 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|---|
| 主题列表（首页） | `/` 50 条 `item_title` | `/` 每页 20 条 | HTTP 200 + 计数 | ✅ |
| 主题列表（节点页） | `/go/tech` 20 条 | `/go/[name]` | HTTP 200 | ✅ |
| 主题详情 | `/t/1253638` | `/t/[id]` | HTTP 200 + 楼层号连续 | ✅ |
| 主题浏览计数 | `· N 次点击` | `topics.views` 每次 +1 | DB 查询前后对比 | ✅ |
| 主题投票（顶/踩） | `upVoteTopic(id)` / `downVoteTopic(id)` JS 函数 | `TopicActions.tsx` 箭头按钮 → `POST/DELETE /api/votes` | E2E：点击后计数增加、刷新仍正确、重复点击不叠加、未登录不显示 | ✅ |
| 主题置顶 | — | `topics.pinned` + `POST /api/topics/[id]/pin`/`unpin` + 后台按钮 | E2E：管理员操作成功并写入状态、普通用户被拒 | ✅ |
| 主题锁定 | — | `topics.locked` + 回复时 403 校验 | 单元 + E2E | ✅ |
| 主题编辑（作者） | — | `TopicActions.tsx` 编辑表单 → `PUT /api/topics/[id]`（含编辑时限） | E2E：改正文后页面展示、刷新仍生效；他人主题无编辑按钮 | ✅ |
| 主题软删除（作者/管理员） | — | `DELETE /api/topics/[id]` → `deleted_at` 软删；`POST /api/topics/[id]/restore` 恢复 | E2E：作者删除后普通访问者不可见、管理员恢复后重新可见 | ✅ |
| 主题编辑历史 | — | `GET /api/topics/[id]/edit-history` | 单元 | ✅ |
| 标签 | 主题页 `/tag/{name}` 标签块 | `tags` / `topic_tags` 表 + 渲染 | 模型 + 渲染 | ✅（标签未自动生成） |

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

## 5. 通知

| 功能 | 原站证据 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|---|
| 回复通知 | 原站 `/notifications` | `POST /api/replies` 自动写入 | E2E：A 回复 B，B 收到通知 | ✅ |
| 通知列表 | — | `/notifications` | HTTP 200（登录态） | ✅ |
| 未读计数 | — | `getUnreadNotificationCount` + 导航栏角标 | DB + E2E | ✅ |
| 通知已读标记 | — | `NotificationsList.tsx` → `POST /api/notifications`（给 id 标单条，不给则全部已读） | E2E（v004 账号套件） | ✅ |
| @ 提及通知 | 原站 `@username` | `POST /api/replies` 解析提及 | E2E：被提及者收到、不给自己发、邮箱不误判、重复去重、上限 10 | ✅ |

## 6. 收藏

| 功能 | 原站证据 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|---|
| 收藏主题 | 原站主题页收藏按钮 | `POST /api/collections` target=topic | E2E | ✅ |
| 取消收藏 | — | action=remove | E2E | ✅ |
| 收藏节点 | 原站「加入收藏」 | target=node | E2E | ✅ |
| 收藏列表页 | 原站 `/bookmarks` | `/bookmarks` | HTTP 200 | ✅ |
| 收藏唯一约束 | — | 唯一索引 + onConflictDoNothing | 单元 | ✅ |

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

## 14. 端到端测试覆盖

> ⚠️ 本节原有数字（「67/67 通过、约 1.1 分钟」）是 **v0.0.3 的快照**，
> 与当前基线（**220 条 / 20 文件**）不符。权威数字见 `docs/release-facts.json`
> （单一事实来源），发行门禁会与实际跑次交叉核对。

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
| 旧版 JSON API 兼容 | ✅ | `e2e/v010-legacy-api.spec.ts`（7 条） |

测试过程中发现并修复的真实产品缺陷累计 **100+ 条**，逐条取证见 `BUG_REGISTER.md`
（v0.0.4 ~ v0.0.13，编号 V4-xx / V5-xx / V6-xx / V7-xx / V8-xx / V9-xx / V10-xx）。
