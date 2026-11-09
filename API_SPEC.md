# API 规格（API_SPEC）—— ⚠️ 历史快照

> **⚠️ 本文件是 v0.0.4 时期的历史快照，不是当前权威 API 规格。**
> 权威版本：[`docs/API_SPEC.md`](docs/API_SPEC.md)
> （含 v0.0.13 补齐的 3 个旧版端点、Feed 格式区分、ETag/304 与
> 公共数据一致性口径；完整兼容矩阵见 `docs/LEGACY_API_MATRIX_v0.0.13.md`）。
> 本文件保留仅供追溯历史口径，**不得**作为当前版本的接口依据。
> 静态护栏 `tests/static/v013-docs-authenticity.spec.ts` 会校验此声明不被删除。

> 本表由**真实路由源码**提取生成 —— 路径、HTTP 方法、鉴权要求与 CSRF 要求
> 均以 `src/app/api/**/route.ts` 的实际实现为准。

## 通用约定

| 项 | 约定 |
|---|---|
| 响应格式 | 成功 `{ ok: true, ... }`；失败 `{ ok: false, error: "<中文原因>" }` |
| 认证方式 | HttpOnly 会话 Cookie `v2_session`（服务端 session 表） |
| CSRF | 所有写操作要求请求头 `x-csrf-token` 与 `v2_csrf` Cookie 一致（双提交 Cookie 模式） |
| 未登录 | HTTP **401** `{ ok:false, error:"需要登录" }` |
| 权限不足 | HTTP **403** `{ ok:false, error:"权限不足" }` |
| 限流触发 | HTTP **429** + `Retry-After` 头 |
| 软删除内容 | 列表与详情默认**过滤**；仅 staff/作者可用 `?includeDeleted=true` 显式查看 |
| 分页 | `limit` 上限 100（Feed 类 200/500），`offset` 分页 |

## 路由总览（共 55 个）

| 分组 | 数量 |
|---|---|
| 后台管理 | 13 |
| 认证 | 5 |
| 其他 | 1 |
| 积分与互动 | 3 |
| 用户与账户 | 8 |
| 调试（生产环境默认 404） | 3 |
| Feed 订阅 | 4 |
| 节点与搜索 | 4 |
| 主题与回复 | 14 |

## 后台管理

| 方法 | 路径 | 鉴权 | CSRF | 说明 |
|---|---|---|---|---|
| GET | `/api/admin/config` | 需登录 + 权限 config.view | 否（只读） | 权限：config.view（moderator / admin） |
| GET | `/api/admin/logs` | 需登录 + 权限 logs.view | 否（只读） | 权限：logs.view（moderator / admin） |
| GET | `/api/admin/node-requests` | 需登录 + 权限 nodes.approve | 否（只读） | 权限：nodes.approve（moderator / admin） |
| POST | `/api/admin/node-requests/[id]/approve` | 需登录 + 权限 nodes.approve | 是 | 权限：nodes.approve（moderator / admin） |
| POST | `/api/admin/node-requests/[id]/reject` | 需登录 + 权限 nodes.approve | 是 | 权限：nodes.approve（moderator / admin） |
| GET | `/api/admin/pending` | 需登录 + 权限 reports.view | 否（只读） | 权限：reports.view（moderator / admin） |
| GET | `/api/admin/reports` | 需登录 + 权限 reports.view | 否（只读） | 权限：reports.view（moderator / admin） |
| POST | `/api/admin/reports/[id]/handle` | 需登录 + 权限 reports.handle | 是 | body: { action: 'accept' | 'reject', note?: string } |
| GET | `/api/admin/stats` | 需登录 + 权限 config.view | 否（只读） | 权限：config.view（moderator / admin） |
| GET | `/api/admin/users` | 需登录 + 权限 users.view | 否（只读） | 权限：users.view（moderator / admin） |
| POST | `/api/admin/users/[id]/ban` | 需登录 + 权限 users.ban | 是 | 权限：users.ban（moderator / admin）；封禁 admin 需 users.ban_admin |
| PATCH | `/api/admin/users/[id]/role` | 需登录 + 权限 users.role | 是 | 权限：users.role（仅 admin） |
| POST | `/api/admin/users/[id]/unban` | 需登录 + 权限 users.ban | 是 | 权限：users.ban（moderator / admin） |

## 认证

| 方法 | 路径 | 鉴权 | CSRF | 说明 |
|---|---|---|---|---|
| POST | `/api/auth/forgot-password` | 公开 | 是 | ## 防止邮箱枚举 |
| GET | `/api/auth/reset-password` | 公开 | 是 | body: { token: string, newPassword: string } |
| POST | `/api/auth/reset-password` | 公开 | 是 | body: { token: string, newPassword: string } |
| POST | `/api/auth/signin` | 公开 | 是 |  |
| POST | `/api/auth/signout` | 公开 | 是 |  |
| POST | `/api/auth/signup` | 公开 | 是 |  |

## 其他

| 方法 | 路径 | 鉴权 | CSRF | 说明 |
|---|---|---|---|---|
| GET | `/api/captcha` | 公开 | 否（只读） | 验证码端点 |

## 积分与互动

| 方法 | 路径 | 鉴权 | CSRF | 说明 |
|---|---|---|---|---|
| GET | `/api/checkin` | 需登录 | 是 | 取 UTC 日期字符串 YYYY-MM-DD |
| POST | `/api/checkin` | 需登录 | 是 | 取 UTC 日期字符串 YYYY-MM-DD |
| GET | `/api/credits` | 需登录 | 否（只读） | 查询参数：limit（默认 50，最大 200）、offset |
| GET | `/api/leaderboard` | 公开 | 否（只读） | 查询参数：limit（默认 50，最大 200）、offset |

## 用户与账户

| 方法 | 路径 | 鉴权 | CSRF | 说明 |
|---|---|---|---|---|
| GET | `/api/collections` | 需登录 | 是 | 收藏 / 取消收藏 主题或节点 |
| POST | `/api/collections` | 需登录 | 是 | 收藏 / 取消收藏 主题或节点 |
| GET | `/api/notifications` | 需登录 | 是 | 查询参数：limit（默认 30，最大 100）、offset、unreadOnly |
| POST | `/api/notifications` | 需登录 | 是 | 查询参数：limit（默认 30，最大 100）、offset、unreadOnly |
| DELETE | `/api/notifications` | 需登录 | 是 | 查询参数：limit（默认 30，最大 100）、offset、unreadOnly |
| POST | `/api/settings/password` | 需登录 | 是 |  |
| POST | `/api/settings/profile` | 需登录 | 是 |  |
| POST | `/api/users/avatar` | 需登录 | 是 | 安全要求（全部在服务端强制）： |
| DELETE | `/api/users/avatar` | 需登录 | 是 | 安全要求（全部在服务端强制）： |
| GET | `/api/users/follows` | 需登录 | 是 | body: { userId: number } |
| POST | `/api/users/follows` | 需登录 | 是 | body: { userId: number } |
| DELETE | `/api/users/follows` | 需登录 | 是 | body: { userId: number } |
| GET | `/api/users/follows/topics` | 需登录 | 否（只读） | 查询参数：limit（默认 30，最大 100）、offset |
| GET | `/api/users/me` | 需登录 | 是 | 各字段的长度上限 |
| PATCH | `/api/users/me` | 需登录 | 是 | 各字段的长度上限 |

## 调试（生产环境默认 404）

| 方法 | 路径 | 鉴权 | CSRF | 说明 |
|---|---|---|---|---|
| GET | `/api/debug/floors` | 公开 | 否（只读） | 调试辅助接口：返回指定主题的所有楼层号。 |
| POST | `/api/debug/rate-limit-probe` | 公开 | 否（只读） | 调试端点：验证限流窗口的跨窗口重置语义。 |
| POST | `/api/debug/reset-rate-limits` | 公开 | 否（只读） | 调试端点：清空限流计数。 |

## Feed 订阅

| 方法 | 路径 | 鉴权 | CSRF | 说明 |
|---|---|---|---|---|
| GET | `/api/feed` | 公开 | 否（只读） | - 内容来自真实数据库（topics + users + nodes），软删除主题不出现 |
| GET | `/api/feed/atom` | 公开 | 否（只读） | - 内容来自真实数据库；软删除的主题不出现 |
| GET | `/api/feed/json` | 公开 | 否（只读） | - 内容来自真实数据库；软删除的主题不出现 |
| GET | `/api/nodes/[name]/feed` | 公开 | 否（只读） | - 内容来自真实数据库；软删除的主题不出现 |

## 节点与搜索

| 方法 | 路径 | 鉴权 | CSRF | 说明 |
|---|---|---|---|---|
| GET | `/api/node-requests` | 需登录 | 是 | 普通用户可申请；申请进入 node_requests 表 status=pending， |
| POST | `/api/node-requests` | 需登录 | 是 | 普通用户可申请；申请进入 node_requests 表 status=pending， |
| GET | `/api/nodes` | 需登录 + moderator/admin | 是 | 查询参数： |
| POST | `/api/nodes` | 需登录 + moderator/admin | 是 | 查询参数： |
| PATCH | `/api/nodes` | 需登录 + moderator/admin | 是 | 查询参数： |
| GET | `/api/search` | 公开 | 否（只读） | 分页上限 —— 防止一次性拉取过多数据 |
| GET | `/api/search/suggest` | 公开 | 否（只读） |  |

## 主题与回复

| 方法 | 路径 | 鉴权 | CSRF | 说明 |
|---|---|---|---|---|
| POST | `/api/replies` | 需登录 | 是 |  |
| PUT | `/api/replies/[id]` | 需登录 | 是 | 权限：作者本人（受编辑时限）或 moderator/admin。 |
| DELETE | `/api/replies/[id]` | 需登录 | 是 | 权限：作者本人（受编辑时限）或 moderator/admin。 |
| GET | `/api/replies/[id]/edit-history` | 需登录 | 否（只读） | 仅内容作者本人或 moderator/admin 可查看。 |
| POST | `/api/replies/[id]/restore` | 需登录 | 是 | 仅 moderator/admin 可执行；写入 moderation_logs。 |
| POST | `/api/thanks` | 需登录 | 是 | body: { replyId: number } |
| DELETE | `/api/thanks` | 需登录 | 是 | body: { replyId: number } |
| POST | `/api/topics` | 需登录 | 是 |  |
| GET | `/api/topics/[id]` | 需登录 | 是 | 软删除处理：已删除主题对普通访问者返回 404（表现得像不存在）， |
| PUT | `/api/topics/[id]` | 需登录 | 是 | 软删除处理：已删除主题对普通访问者返回 404（表现得像不存在）， |
| DELETE | `/api/topics/[id]` | 需登录 | 是 | 软删除处理：已删除主题对普通访问者返回 404（表现得像不存在）， |
| GET | `/api/topics/[id]/edit-history` | 需登录 | 否（只读） | 仅内容作者本人或 moderator/admin 可查看。 |
| POST | `/api/topics/[id]/lock` | 需登录 + moderator/admin | 是 | 锁定主题：锁定后禁止新回复。 |
| POST | `/api/topics/[id]/pin` | 需登录 + moderator/admin | 是 | 置顶主题：在节点列表中优先展示。 |
| POST | `/api/topics/[id]/restore` | 需登录 | 是 | 仅 moderator/admin 可执行；写入 moderation_logs。 |
| POST | `/api/topics/[id]/unlock` | 需登录 + moderator/admin | 是 | 解锁主题：恢复后可继续回复。 |
| POST | `/api/topics/[id]/unpin` | 需登录 + moderator/admin | 是 | 取消置顶。 |
| POST | `/api/votes` | 需登录 | 是 | body: { topicId: number, direction: 'up' | 'down' } |
| DELETE | `/api/votes` | 需登录 | 是 | body: { topicId: number, direction: 'up' | 'down' } |

## 权限矩阵（后台 API）

来源：`src/lib/permissions.ts` 的 `MATRIX`（单一事实来源）。

| 权限 | user | moderator | admin |
|---|---|---|---|
| `users.view` | 查看用户列表/搜索 | ✗ | ✓ | ✓ |
| `users.role` | 改变他人角色 | ✗ | ✗ | ✓ |
| `users.ban` | 封禁/解封用户 | ✗ | ✓ | ✓ |
| `users.ban_admin` | 封禁 admin 用户 | ✗ | ✗ | ✓ |
| `reports.view` | 查看举报列表 | ✗ | ✓ | ✓ |
| `reports.handle` | 处理举报 | ✗ | ✓ | ✓ |
| `content.hide` | 隐藏/恢复内容 | ✗ | ✓ | ✓ |
| `nodes.approve` | 节点审批 | ✗ | ✓ | ✓ |
| `credits.adjust` | 调整积分 | ✗ | ✗ | ✓ |
| `logs.view` | 查看操作日志 | ✗ | ✓ | ✓ |
| `config.view` | 查看系统配置 | ✗ | ✓ | ✓ |

## 特别说明

1. **后台不提供危险操作** —— 没有删除用户、执行任意 SQL、修改系统配置的接口。
   `tests/admin-permissions.spec.ts` 会扫描路由目录验证这一点。
2. **管理员不能把自己降级** —— `canChangeRole` 拦截，避免系统无人可恢复。
3. **moderator 不能封禁 admin** —— `canBanUser` 拦截。
4. **封禁用户立即失效其全部会话** —— 封禁事务内删除 `sessions` 记录。

