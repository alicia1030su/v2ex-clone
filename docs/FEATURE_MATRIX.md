# FEATURE_MATRIX — 功能矩阵与验证状态

> 验证方式：每个功能都通过**实际运行**验证（HTTP 响应码 / 数据库查询 / Playwright 交互）。
> 不接受"未验证的成功声明"——未验证项明确标注为 `⏳` 或 `❌`。

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
| 节点订阅（RSS/JSON Feed 入口） | `/feed/{node}.xml`、`.json` | 节点页侧栏展示入口 | 渲染检查 | ⚠️ 仅入口，未实现 Feed 生成器 |
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
| 主题投票（顶/踩） | `upVoteTopic(id)` / `downVoteTopic(id)` JS 函数 | `votes` 表 + `topics.votes` 汇总 | 表已建，UI 为原站同款箭头（JS 未接） | ⚠️ |
| 主题置顶 | — | `topics.pinned` | 表已建 | ⚠️ |
| 主题锁定 | — | `topics.locked` + 回复时 403 校验 | 单元 | ✅ |
| 主题编辑/删除（作者） | — | 未实现 | — | ❌ |
| 主题软删除 | — | `topics.status='deleted'` | 模型 | ✅（管理侧可见） |
| 标签 | 主题页 `/tag/{name}` 标签块 | `tags` / `topic_tags` 表 + 渲染 | 模型 + 渲染 | ✅（标签未自动生成） |

## 4. 回复

| 功能 | 原站证据 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|---|
| 回复列表 | `#r_{id}` 锚点 | `/t/[id]` | HTTP 200 + 楼层连续 | ✅ |
| 楼层号 | `<span class="no">N</span>` | `replies.floor` 唯一索引 | DB 查询 | ✅ |
| 提交回复 | 主题页回复框 | `POST /api/replies` | E2E：回复后楼层+1 | ✅ |
| 回复计数同步 | `topics.repliesCount` | 事务内 `+1` | E2E | ✅ |
| 最后回复时间同步 | `topics.lastReplyAt` | 同步更新 | DB | ✅ |
| 回复感谢（❤️） | `<span class="small fade">❤️ N</span>` | `thanks` 表 + `replies.thanks` | 模型 + 渲染 | ⚠️ 计数可用，按钮未接 |
| 回复限流 | — | 每用户每 60 秒 20 次 | E2E | ✅ |
| 引用回复 | — | `replies.quoteId` | 模型 | ⚠️ 未接 UI |

## 5. 通知

| 功能 | 原站证据 | 本地实现 | 验证方式 | 状态 |
|---|---|---|---|---|
| 回复通知 | 原站 `/notifications` | `POST /api/replies` 自动写入 | E2E：A 回复 B，B 收到通知 | ✅ |
| 通知列表 | — | `/notifications` | HTTP 200（登录态） | ✅ |
| 未读计数 | — | `getUnreadNotificationCount` | DB | ✅ |
| 通知已读标记 | — | `notifications.read` | 模型 | ⚠️ 未接 UI |

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
| 关注用户 | 原站「关注」tab 明确区别于节点收藏（见 `/t/645662` 讨论） | `follows` 表已建 | ⚠️ 仅数据模型 |
| 关注流（关注的用户发布的主题） | 原站首页「关注」tab | 未实现 UI | ❌ |

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
| 发帖加积分 | — | +10 | ✅ |
| 每日登录加分 | 原站经典行为 | 未实现 | ❌ |
| 积分排行榜 | 原站 `/values` | 未实现 | ❌ |

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

## 11. 安全

| 项目 | 实现 | 验证方式 | 状态 |
|---|---|---|---|
| 密码哈希 | scrypt + 随机 salt | 单元 | ✅ |
| 会话 Cookie HttpOnly/SameSite | `setSessionCookie` | 响应头检查 | ✅ |
| 开放重定向防护 | `sanitizeRedirect` 仅允许 `/` 开头且非 `//` | 单元 | ✅ |
| XSS 防护（正文） | 自研 HTML 白名单清洗器 `sanitizeHtml` | 单元 + E2E | ✅ |
| XSS 防护（搜索/昵称等） | React 自动转义 | E2E | ✅ |
| CSRF 防护 | SameSite=Lax Cookie + 写操作要求登录态 | E2E | ⚠️ 未实现显式 token 校验 |
| 速率限制 | 登录/注册/发帖/回复/改密/建节点 | E2E | ✅ |
| SQL 注入 | Drizzle 参数化查询 | 代码审查 | ✅ |
| 越权访问他人收藏 | 按 `userId` 过滤 | 单元 | ✅ |
| 越权编辑/删除他人内容 | 未实现编辑功能（故不适用） | — | ⚠️ |
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
| 页脚 `#Bottom` | 已实现（链接组、在线人数、版本行、世界时钟、标语） | ✅ |
| 登录页验证码 | 服务端生成 320×80 SVG，哈希存储、一次性、字段名哈希化 | ✅ |
| 截图对比与量化差异报告 | 10 页面像素 diff + 几何测量，详见 `VISUAL_DIFF_REPORT.md` | ✅ |
| 像素差异（signin 最低 / topic_detail 最高） | 10.01% / 48.48% —— 差异全部来自内容数据不同 | ✅ |

## 13. 端到端测试覆盖

**67/67 通过（约 1.1 分钟，零跳过、零失败）**，另有 **28/28 单元测试**覆盖服务端安全逻辑。
完整清单与逐项覆盖对照见 `docs/TEST_REPORT.md` 与 `docs/AUDIT_REPORT.md`。

| 需求项 | 覆盖用例数 | 状态 |
|---|---|---|
| 注册登录及退出 | 5 | ✅ |
| 账户权限 | 7 | ✅ |
| 创建节点（管理员） | 3 | ✅ |
| 创建主题 | 2 | ✅ |
| 编辑和管理主题 | 0 | ❌ 未实现（`topics.status='deleted'` 已就绪） |
| 回复主题 | 6 | ✅ |
| 分页 | 6 | ✅ |
| 收藏 | 5 | ✅ |
| 通知 | 1 | ✅ |
| 搜索 | 3 | ✅ |
| 用户信息更新 | 2 | ✅ |
| 管理审核 | 2 | ✅ |
| 并发操作 | 1 | ✅ |
| 异常输入 | 7 | ✅ |
| CSRF | 部分（SameSite=Lax + 会话校验；无显式 token） | ⚠️ |
| XSS | 3 | ✅ |
| 越权 | 2 | ✅ |
| 速率限制 | 2 | ✅ |

测试过程中发现并修复了 12 个真实产品缺陷，完整清单见 `docs/TEST_REPORT.md` 第 8 节。
