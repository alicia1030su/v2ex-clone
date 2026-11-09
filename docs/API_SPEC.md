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

### 14.2 旧版 API 全家桶（v0.0.13 补齐）

原站 `/api/*` 下**仍有 5 个端点返回 200**（`/api/topics.json`、`/api/nodes.json`
已下线 404）。v0.0.13 一次性补齐，契约全部经本机 xray 代理实测：

| 端点 | 参数 | 200 载荷 | 条数 | Cache-Control | 与原站差异 |
|---|---|---|---|---|---|
| `GET /api/topics/show.json` | `id` / `username` / `node_name`（优先级 id > username > node_name） | 数组（元素 13 键） | 1 / 10 / 10 | 120s | 见 §14.1 |
| `GET /api/topics/latest.json` | **全部被忽略**（`limit`/`page`/`p`/`node_name`） | 数组，形状同上 | **35** | 120s | 同上 |
| `GET /api/members/show.json` | `username` / `id`（任一命中，大小写不敏感） | **单对象**（20 键 + `status:"found"`） | — | 600s | `pro` 恒 0、社交字段 null |
| `GET /api/nodes/show.json` | `name` / `id`（任一命中，大小写不敏感） | **单对象**（16 键） | — | 3600s | `header`/`footer` 空、`aliases` `[]` |
| `GET /api/nodes/all.json` | 无 | **数组**（元素同节点对象） | 库内 active 节点数 | 7200s | 同上；只含 `status='active'` |

共同约定（**全部实测**）：

- 错误体：`{"status":"error","message":"Object Not Found","rate_limit":{"used":N,"quota":600,"reset_at":<unix秒>}}`
- 限流：600 次/小时/IP，回写 `x-rate-limit-limit/remaining/reset` 三元组
- `Content-Type`：`application/json;charset=UTF-8`
  （**例外**：`/api/members/show.json` 实测带空格 `application/json; charset=UTF-8`，照抄）

**配额的实现差异（如实登记）**：原站 600 次/小时是**所有 `/api/*` 共享一个大桶**；
本项目按端点分桶（`scope` 不同）。原因是本项目的限流实现按 scope 计数，
共用大桶会让「某个端点被脚本打满」影响全部端点。这属于**有意偏离**。

### 14.3 旧版节点订阅路径 `/feed/{node}.xml|json`

原站节点订阅地址是 `/feed/{node}.xml`（**Atom 1.0**，50 条）与
`/feed/{node}.json`（**JSON Feed 1.0**，50 条）。本项目此前只有
`/api/nodes/{name}/feed`（**RSS 2.0**，30 条）—— **路径与格式都不同**，
按原站地址配置的阅读器直接 404。

| 路径 | 格式 | 条数 | Content-Type | Cache-Control |
|---|---|---|---|---|
| `/feed/{node}.xml` | Atom 1.0 | 50 | `application/atom+xml;charset=UTF-8` | 600s |
| `/feed/{node}.json` | JSON Feed **1.0** | 50 | `application/json;charset=utf-8` | 1800s |
| `/feed/all.xml` / `.json` | 同上，全站 | 50 | 同上 | 同上 |
| `/feed/{不存在}.xml` | — | — | 404（JSON 错误体） | — |
| `/feed/{node}`（无扩展名） | — | — | 404（原站亦然） | — |

**三处刻意的形状约定**（照抄原站，不「顺手升级」）：

1. Atom 元素顺序：`title → subtitle → icon → logo → link(alternate) →
   link(self) → id → updated → entry*`
2. JSON Feed 用 **1.0**（`jsonfeed.org/version/1`）的 `author{}`，
   **不用** 1.1 的 `authors[]`；条目**无** `content_text`/`summary`
3. 条目 `id` 两套：Atom 为 `tag:{host},{YYYY-MM-DD}:/t/{id}`，
   JSON Feed 为主题绝对地址；两者 `link`/`url` 都带 `#reply{N}` 锚点

**与原站的一处有意偏离**：原站 `/feed/all.xml` 返回 **200 但 body 长度为 0**
（任何阅读器都解析失败，视为原站缺陷）。本项目返回合法的全站 50 条 Atom。

**Feed 节点名大小写口径（如实登记）**：`/feed/{node}.xml|json` 的后缀正则带
`/i`（`src/app/feed/[file]/route.ts`），`src/server/legacy-feed.ts` 查库前
`toLowerCase()`；`/api/nodes/{name}/feed` 同样先 `toLowerCase()`。
因此 `/feed/{Node}.xml` 与 `/feed/{node}.xml` 等价、命中均返回 **200**，
即**大小写不敏感**。**原站该行为无法确认**，本项目不宣称与原站一致，
属**有意策略**，见兼容矩阵 §3「有意偏离清单」。不存在的节点名仍返回 404，
与大小写无关；**不写成「404 / 区分大小写」**。

### 14.4 v0.0.13 收尾补齐的 3 个旧版端点

> 完整 15 项兼容性矩阵（含「未实测 / 无法验证」披露）见
> [`docs/LEGACY_API_MATRIX_v0.0.13.md`](LEGACY_API_MATRIX_v0.0.13.md)。
> 上一轮 PR #45/#46 的「全量审计」遗漏了 `hot.json` 与 `replies/show.json`，
> 并把 `nodes/list.json` 的 400 误当成不可用；本轮逐条复核后补齐。

| 端点 | 关键契约 | 缓存 | 状态 |
|---|---|---|---|
| `GET /api/topics/hot.json` | 200 数组 **10 条**，`replies` 严格降序；`limit` / `node_name` / `id` **全部忽略** | 120s | ✅ |
| `GET /api/replies/show.json` | `topic_id`（同名取最后一个）；无参 / 非法 / 不存在 ⇒ **200 `[]`**；`page`/`page_size` 忽略；8 键；`id` 升序 | **60s** | ✅ |
| `GET /api/nodes/list.json` | `fields`/`sort_by`/`reverse` **三者必填**，缺任一 ⇒ **400 + 极简 HTML**；`fields` 投影，未知字段 ⇒ `null`；`reverse` 实测不生效 | **30s** | ✅ |

`nodes/list.json` 的 Content-Type 为 `application/json;charset=utf-8`（小写），
缺参 400 的 body 是原站的
`<html><title>400: Bad Request</title><body>400: Bad Request</body></html>`，
**刻意不统一成 JSON 错误体**。

**仍确认下线、不实现**：`GET /api/topics.json`、`GET /api/nodes.json`（2026-11-09
再次实测 404）。原站 API 2.0（`/api/v2/*`，需 PAT）不在本轮范围。

### 14.5 Feed 格式区分与条件请求

旧版路径与站内自建 Feed **格式不同**，不得混为一谈：

| 路径 | 格式 | 版本 | 条数 |
|---|---|---|---|
| `/feed/{node}.xml` | Atom 1.0 | `http://www.w3.org/2005/Atom` | 50 |
| `/feed/{node}.json` | JSON Feed **1.0** | `jsonfeed.org/version/1` | 50 |
| `/api/feed` | RSS 2.0 | — | 30 |
| `/api/feed/atom` | Atom 1.0 | — | 30 |
| `/api/feed/json` | JSON Feed **1.1** | `jsonfeed.org/version/1.1` | 30 |
| `/api/nodes/{name}/feed` | RSS 2.0（+`?format=json`） | — | 30 |

v0.0.13 起，**全部 6 类 Feed 响应**统一支持 `ETag`（响应体 SHA-256 强校验）
与 `If-None-Match` ⇒ **304 且 body 为空**；同时处理 `W/` 弱前缀、列表与 `*`。
实现见 `src/lib/feed-cache.ts`。Atom 正文用 CDATA，已处理 `]]>` 拆分与
XML 1.0 非法控制字符，保证严格解析器可读。

### 14.6 旧版 API 的公共数据一致性与隐私口径

返回 `member` / `node` 的旧版端点共用 `src/server/legacy-assemblers.ts`
装配字段，因此同一实体的 `id`、`stars`、`topics`、`founder_id`、
头像、时间戳在各接口必然一致；`topics/*.json` 与 `replies/show.json`
共用 `parseLegacyId` 的参数语义与 `loadNodeStars` 的收藏计数。

- 节点：旧版 / Feed 公共端点**统一只暴露 `status='active'` 节点**。
  `PUBLIC_NODE_CONDITION`（**唯一定义处** `src/lib/node-visibility.ts`，
  由 `src/server/legacy-assemblers.ts` re-export）是唯一的
  节点可见性条件，以下路径**全部引用它**，不存在「目录端点过滤、内容端点不过滤」的分层：
  - 节点目录类：`nodes/all.json`、`nodes/show.json`、`nodes/list.json`
    经 `loadLegacyNodeRecords()` 查询；
  - 主题类：`topics/show.json` / `latest.json` / `hot.json` 的主查询
    （`src/server/legacy-topics.ts` 的 `innerJoin(schema.nodes, ...)`）与
    `?node_name=` 存在性检查（`src/app/api/topics/show.json/route.ts`）；
  - 回复类：`replies/show.json`（`src/server/legacy-replies.ts` 已 `innerJoin(schema.nodes, ...)`）；
  - Feed 类：`/feed/{node}.xml|json`（`src/server/legacy-feed.ts`）与
    `/api/nodes/{name}/feed`（`src/app/api/nodes/[name]/feed/route.ts`）；
  - **站内订阅**：`/api/feed`、`/api/feed/atom`、`/api/feed/json` 也经
    `src/lib/feed-builder.ts` 引用同一条件（否则站内 RSS 会把隐藏节点的主题
    继续吐给订阅者，而旧版 Feed 已过滤 —— 两边口径必须一致）。
  `pending` / `hidden` 节点一律不进入公共载荷：目录端点不列出、
  `?node_name=` 走 404、按 id 查主题返回 `[]`、节点 Feed 走 404 / 空，
  全站 Feed（旧版与站内）都不含其主题、其主题的回复也不再按 `topic_id` 可取。
  - 原站对非 active 节点的旧版 API 行为**无法验证**，本项目
    **不宣称完全兼容**（也不宣称与原站一致）；这是本项目的**有意策略**，
    见 [`docs/LEGACY_API_MATRIX_v0.0.13.md`](LEGACY_API_MATRIX_v0.0.13.md) §3「有意偏离清单」。
- Feed 节点名大小写：**大小写不敏感**（详见 §14.3）；**原站该行为无法确认**，
  本项目不宣称与原站一致，属**有意策略**（§3 有意偏离清单）。
- 用户：`members/show.json` 只公开 `status='active'`；封禁 / 停用用户的
  自填资料字段在内嵌 member 中被置空
- 内容：软删除主题 / 回复、已删除主题的回复，一律不进入公共接口
- 载荷：不含 email / password_hash / 会话令牌 / 积分余额 / CSRF token
- ID 恒为整数；时间恒为 Unix 秒整数（Feed 内为 RFC 3339 字符串，按格式区分）
- 排序均有确定性兜底（`created` 降序 + `id` 降序；hot 为 `replies` 降序 + `id` 降序）
