# API_SPEC — 接口规范

> 所有接口均为真实实现，连接 PostgreSQL（Redis 可选，缺失时自动降级到 PostgreSQL）。
> 约定：
>  - 请求/响应均为 `application/json`（回复接口同时支持表单提交）
>  - 写操作需要会话 Cookie `v2_session`（HttpOnly / SameSite=Lax）
>  - 错误响应统一形如 `{ "ok": false, "error": "<中文说明>" }`
>  - 限流触发返回 `429` 并带 `Retry-After` 响应头

## 1. 认证

### 1.1 `POST /api/auth/signup` — 注册

请求：

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "password123"
}
```

| 字段 | 规则 |
|---|---|
| `username` | 必填，`^[a-zA-Z0-9_]{2,32}$`，大小写不敏感唯一 |
| `email` | 选填，合法邮箱格式，全局唯一 |
| `password` | 必填，8–128 字符 |

响应 `201`：

```json
{ "ok": true, "redirect": "/" }
```

| 状态码 | 场景 |
|---|---|
| `201` | 注册成功（自动登录并下发会话 Cookie） |
| `400` | 参数格式错误 / 密码过短 |
| `409` | 用户名或邮箱已被占用 |
| `429` | 限流（键 = IP + 用户名） |

### 1.2 `POST /api/auth/signin` — 登录

请求：

```json
{
  "username": "alice",
  "password": "password123",
  "next": "/",
  "captchaId": "…",
  "captchaField": "…",
  "captchaText": "A3BK"
}
```

| 字段 | 说明 |
|---|---|
| `next` | 登录后跳转地址，仅允许站内相对路径（开放重定向防护） |
| `captchaId` / `captchaField` / `captchaText` | 验证码三元组，由 `GET /api/captcha` 返回 |

响应 `200`：

```json
{ "ok": true, "redirect": "/" }
```

| 状态码 | 场景 |
|---|---|
| `200` | 登录成功（下发 `v2_session` Cookie） |
| `400` | 验证码不正确 |
| `401` | 用户名或密码不正确 |
| `403` | 账号被封禁 / 暂停 |
| `429` | 限流（键 = IP + 用户名） |

**安全说明**：登录成功后立即清除该 (IP, 用户名) 的失败计数。
`DISABLE_CAPTCHA=1` 可关闭验证码校验（仅供自动化测试使用，生产环境必须关闭）。

### 1.3 `POST /api/auth/signout` — 退出

无请求体。响应 `200`：`{ "ok": true, "redirect": "/" }`
服务端删除 `sessions` 行并清除 Cookie。

### 1.4 `GET /api/captcha` — 获取验证码

响应 `200`：

```json
{
  "ok": true,
  "id": "660277c16054d5cfa5173653681f04af",
  "field": "5972d9e3a4f0448f…",
  "image": "data:image/svg+xml;base64,…",
  "placeholder": "请输入上图中的验证码，点击可以更换图片"
}
```

- 图片尺寸 320×80（与原站一致）
- `field` 为一次性哈希字段名（与原站做法一致）
- 答案以 SHA-256 哈希存于服务端 KV，有效期 300 秒，**一次性使用**
- 字符集排除易混淆字符（0/O、1/I/l）

## 2. 主题

### 2.1 `POST /api/topics` — 发布主题

请求：

```json
{ "nodeId": 3, "title": "标题", "content": "正文（支持 Markdown）" }
```

| 字段 | 规则 |
|---|---|
| `nodeId` | 必填，必须是 `status='active'` 的节点 |
| `title` | 必填，4–128 字符 |
| `content` | 必填，10–50000 字符，Markdown |

响应 `201`：`{ "ok": true, "redirect": "/t/42" }`

副作用：节点 `topics_count` +1；作者积分 +10。

| 状态码 | 场景 |
|---|---|
| `201` | 创建成功 |
| `400` | 参数校验失败 |
| `401` | 未登录 |
| `403` | 节点不可用 |
| `404` | 节点不存在 |
| `429` | 限流（每用户 5 次 / 60 秒） |

## 3. 回复

### 3.1 `POST /api/replies` — 回复主题

请求（JSON 或表单）：

```json
{ "topicId": 1, "content": "回复内容", "redirect": "/t/1" }
```

表单格式（主题页内嵌表单使用）：

```
topicId=1&content=…&redirect=/t/1
```

响应 `200`（JSON 请求）：`{ "ok": true, "redirect": "/t/1" }`
响应 `303`（表单请求）：`Location` 指向 `redirect`

**执行顺序（重要）**：参数校验 → 主题存在性/锁定校验 → **限流** → 写入。
主题不存在或已锁定时不消耗限流配额。

副作用：
- `replies.floor` 由独立计数表 `floor_counters` 原子分配（UPSERT），并发下不重复
- `topics.replies_count` +1，`topics.last_reply_at` 更新
- 主题作者收到 `notifications` 记录（作者回复自己不通知）

| 状态码 | 场景 |
|---|---|
| `200` / `303` | 成功 |
| `400` | 内容长度非法 / topicId 非法 |
| `401` | 未登录 |
| `403` | 主题已锁定 |
| `404` | 主题不存在 |
| `429` | 限流（每用户 20 次 / 120 秒） |

## 4. 收藏

### 4.1 `POST /api/collections` — 收藏 / 取消收藏

请求：

```json
{ "target": "topic", "id": 1, "action": "add" }
```

| 字段 | 取值 |
|---|---|
| `target` | `topic` 或 `node` |
| `id` | 主题 ID 或节点 ID |
| `action` | `add`（默认）/ `remove` |

响应 `200`：`{ "ok": true, "collected": true }`

唯一约束：`(user_id, topic_id)` 与 `(user_id, node_id)` 各一个唯一索引，重复收藏用 `onConflictDoNothing`。

### 4.2 `GET /api/collections?target=topic&id=1` — 查询收藏状态

响应 `200`：`{ "ok": true, "items": [12] }`（命中的收藏记录 ID 数组）

## 5. 搜索

### 5.1 `GET /api/search/suggest?q=<关键词>` — 顶栏联想

响应 `200`：

```json
{
  "items": [
    { "id": 1, "type": "topic",  "title": "标题", "extra": "节点名" },
    { "id": 3, "type": "node",  "title": "Claude", "extra": "claude" },
    { "id": 5, "type": "member","title": "alice", "extra": "会员" }
  ]
}
```

限制：主题 6 条、节点 4 条、会员 4 条。

## 6. 节点（管理）

### 6.1 `POST /api/nodes` — 创建节点

请求：

```json
{ "name": "my-node", "title": "我的节点", "description": "描述", "categoryId": 1 }
```

| 字段 | 规则 |
|---|---|
| `name` | `^[a-z0-9][a-z0-9_-]{1,31}$`，全局唯一 |
| `title` | 2–128 字符 |
| `categoryId` | 选填，必须存在 |
| `description` | 选填，最多 2000 字符 |

权限：`admin` → 直接生效（`status='active'`）；`moderator` → 待审（`status='pending'`）；`user` → `403`

响应 `201`：

```json
{ "ok": true, "id": 42, "name": "my-node", "status": "active", "redirect": "/go/my-node" }
```

| 状态码 | 场景 |
|---|---|
| `201` | 创建成功 |
| `400` | 名称/标题格式非法、分类不存在 |
| `401` | 未登录 |
| `403` | 权限不足 |
| `409` | 名称已被占用 |
| `429` | 限流（每用户 10 次 / 60 秒） |

### 6.2 `PATCH /api/nodes` — 审核节点

请求：`{ "id": 42, "action": "approve" | "activate" | "hide", "reason": "原因" }`

权限：仅 `admin`，否则 `403`。
响应 `200`：`{ "ok": true, "status": "active" }`
所有审核动作写入 `moderation_logs`。

## 7. 个人设置

### 7.1 `POST /api/settings/profile` — 修改资料

请求：

```json
{ "tagline": "头衔", "bio": "简介", "url": "https://example.com", "location": "上海" }
```

| 字段 | 规则 |
|---|---|
| `tagline` | ≤255 字符 |
| `bio` | ≤5000 字符 |
| `url` | 必须是 `http`/`https` 协议 URL，否则 `400` |
| `location` | ≤128 字符 |

响应 `200`：`{ "ok": true }`；`401` 未登录。

### 7.2 `POST /api/settings/password` — 修改密码

请求：`{ "current": "旧密码", "next": "新密码" }`

新密码 8–128 字符。需校验当前密码，否则 `401`。
限流：每用户 5 次 / 300 秒。

## 8. 调试端点（仅非生产环境）

以下端点在 `NODE_ENV=production` 且未设 `ENABLE_DEBUG_ENDPOINTS=1` 时返回 `404`。

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/debug/reset-rate-limits` | POST | 清空 `rate_limit_buckets` 与 `kv_store`（供 E2E 测试重置配额） |
| `/api/debug/floors?topicId=N` | GET | 返回该主题所有楼层号（供并发唯一性断言使用） |

## 9. 页面路由

| 路由 | 说明 |
|---|---|
| `/` | 首页（`?tab=` 切换分类，`?p=` 分页） |
| `/go/[name]` | 节点页（`?p=` 分页） |
| `/go/search?q=` | 搜索结果页 |
| `/go/new` | 发布主题（需登录） |
| `/t/[id]` | 主题详情（`?p=` 回复分页） |
| `/member/[username]` | 用户主页 |
| `/nodes` | 全部节点 |
| `/signin` `/signup` | 登录 / 注册 |
| `/settings` | 个人设置（需登录） |
| `/notifications` | 通知（需登录） |
| `/bookmarks` | 收藏（需登录） |
| `/admin` | 管理后台（需 moderator/admin） |

## 10. 限流参数一览

| 作用域 | 键 | 阈值 | 窗口 |
|---|---|---|---|
| 登录 | IP + 用户名 | 10 | 60s |
| 注册 | IP + 用户名 | 5 | 60s |
| 发帖 | 用户 ID | 5 | 60s |
| 回复 | 用户 ID | 20 | 120s |
| 建节点 | 用户 ID | 10 | 60s |
| 改密码 | 用户 ID | 5 | 300s |

阈值可通过环境变量覆盖：`RATE_LIMIT_LOGIN_MAX`、`RATE_LIMIT_POST_MAX`、
`RATE_LIMIT_REPLY_MAX`、`RATE_LIMIT_REPLY_WINDOW_SECONDS`、
`RATE_LIMIT_CREATE_NODE_MAX`、`RATE_LIMIT_CREATE_NODE_WINDOW_SECONDS`。

## 11. CSRF 防护

所有写接口（`/api/auth/*`、`/api/topics`、`/api/replies`、`/api/collections`、
`/api/nodes`、`/api/settings/*`）都要求 CSRF token。

- **下发**：`src/middleware.ts` 对所有页面路径下发 `v2_csrf` Cookie
  （非 HttpOnly，供客户端读取；`SameSite=Lax`；`Secure`（生产）；有效期 14 天）
- **传递**：
  - `fetch` / XHR —— 客户端组件通过 `csrfFetch()` 自动注入 `x-csrf-token` 头
  - 原生 HTML 表单 —— 隐藏字段 `csrfToken`（服务端组件用 `readCsrfToken()` 注入）
- **校验**：`src/lib/csrf.ts` 的 `verifyCsrf()`，恒定时间比较
- **顺序**：鉴权（401）在 CSRF 校验（403）**之前**，未登录请求不泄露端点存在性

不携带 token 的写请求返回 `403 {"error":"CSRF 校验失败，请刷新页面后重试"}`。

## 12. 运行时开关

`src/lib/runtime-flags.ts` 集中管理所有可影响安全行为的开关：

| 开关 | 生效条件 | 说明 |
|---|---|---|
| `DISABLE_CAPTCHA` | `APP_RUNTIME_ENV=test` **且** `TEST_ENV_ISOLATED=1` | 生产/预发一律忽略 |
| `ENABLE_DEBUG_ENDPOINTS` | 显式设为 `1` | 仍需 `DEBUG_ENDPOINT_TOKEN` 才能访问 |
| `DEBUG_ENDPOINT_TOKEN` | 非空 | 未配置时调试端点一律返回 404 |
| `APP_RUNTIME_ENV` | `production`/`staging`/`test`/`development` | 决定上述开关的生效范围 |

## 13. 安全响应头

所有响应附带：

```
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
```

## 14. 旧版 V2EX JSON API 兼容端点

### 14.1 `GET /api/topics/show.json`

为**第三方 V2EX 客户端 / 脚本**提供与原站旧版 API 同形状的只读端点。
原站该端点是「旧版 API 中唯一仍返回 200 的 JSON 端点」（`/api/topics.json`、
`/api/nodes.json` 均已下线 404），见 `docs/PAGE_INVENTORY.md` §2.4。

#### 查询参数与优先级

| 优先级 | 参数 | 行为 |
|---|---|---|
| 1 | `id` | 返回**长度 1** 的数组；合法但不存在的 id ⇒ `200 []`；`id=abc` / `id=0`（非正整数）⇒ `404` |
| 2 | `username` | 返回该用户**最新 10 条**主题（`created` 降序）；用户不存在 ⇒ `404` |
| 3 | `node_name` | 返回该节点**最新 10 条**主题；节点不存在 ⇒ `404` |
| — | 无任何参数 | `404` |

- 同名参数取**最后一个**：`?id=1&id=2&id=3` ⇒ 只返回 id=3
- `limit` / `offset` **被忽略**（与原站一致，固定 10 条）
- 用户名与节点名大小写不敏感（站内口径）

#### 响应

`200` —— **数组**（不是 `{ok:true,...}` 包裹），元素形状与原站逐字段一致：

```json
[{
  "id": 1,
  "title": "…",
  "url": "http://<base>/t/1",
  "content": "Markdown 源文本",
  "content_rendered": "<p>HTML</p>",
  "replies": 3,
  "member": { "id": 1, "username": "lisi", "url": "…", "pro": 0, "avatar_mini": "…", … },
  "node": { "id": 3, "name": "programmer", "url": "…", "topics": 42, "stars": 5, … },
  "created": 1767225600,
  "last_modified": 1767225600,
  "last_touched": 1767312000,
  "last_reply_by": "wangwu",
  "deleted": 0
}]
```

要点：

- 三个时间字段都是 **Unix 秒整数**
- `deleted` 是 **整数 0/1**（不是布尔）
- 零回复时 `last_reply_by` 是 **空字符串**（原站实测），不是 `null`
- `content_rendered` 经 `renderMarkdown`（marked + sanitize-html），与站内正文同源

`404` —— 对象不存在（原站形状）：

```json
{ "status": "error", "message": "Object Not Found",
  "rate_limit": { "used": 5, "quota": 600, "reset_at": 1794154067 } }
```

`429` —— 超限（600 次 / 小时 / IP，与原站同口径），带 `Retry-After`。

#### 响应头

```
Content-Type: application/json;charset=UTF-8
Cache-Control: public, max-age=120
x-rate-limit-limit: 600
x-rate-limit-remaining: <剩余>
x-rate-limit-reset: <unix 秒>
X-Content-Type-Options: nosniff
```

#### 与原站的三处差异（已在代码注释中逐条写明）

| 字段 | 本项目 | 原因 |
|---|---|---|
| `member.pro` | 恒 `0` | 无 Pro 会员体系（原站非 Pro 亦为 0，形状一致） |
| `member.twitter/github/psn/btc` | 恒 `null` | 未采集社交账号（原站未填时同样 `null`） |
| `node.header/footer/aliases` | `''` / `''` / `[]` | 未建模，给空值而非编造文案 |
| 头像各尺寸 | 确定性占位 SVG 的 `data:` URI | 不复制原站受保护图像资源 |
| 软删除主题 | **对公众不可见**（`?id=` 命中 ⇒ `200 []`） | 本项目安全策略；原站行为未实测，取更保守一侧 |

契约的完整实测记录（10 种请求组合的逐条结果）见
`src/lib/legacy-topic-api.ts` 文件头；形状护栏见
`tests/static/v010-legacy-api-shape.spec.ts`（13 条）与
`e2e/v010-legacy-api.spec.ts`（7 条真实 HTTP）。
