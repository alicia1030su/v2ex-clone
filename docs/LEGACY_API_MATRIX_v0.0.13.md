# 旧版 V2EX API 兼容性矩阵 — v0.0.13

> 本文件是 v0.0.13 阶段二「一次性审计旧版 API」的**唯一权威产物**。
> 目标不是宣布「完全兼容」，而是把「实测到什么、实现了什么、
> 哪些地方有意偏离、哪些地方无法验证」逐项摊开。

## 0. 方法与合规边界

| 项 | 说明 |
|---|---|
| 实测时间 | 2026-11-08（首轮）、**2026-11-09**（本轮复核） |
| 渠道 | 本机代理 `127.0.0.1:10001` → `https://www.v2ex.com`，只读 `GET` |
| 频率 | 单端点间隔 ≥ 2 秒；两轮合计约 25 次请求，远低于原站 600 次/小时配额 |
| 合规 | **不绕过任何验证机制、不批量复制原站数据、不抓取用户隐私内容**；响应体只用于读取字段名 / 类型 / 条数 / 状态码，不落地为本站内容 |
| 文档依据 | 原站公开 API 说明页与多个第三方客户端公开文档（V1 端点清单、`nodes/list.json` 缺参 400 等），仅用于**交叉印证**，不替代实测 |
| 结论口径 | 「原站仍可用」= 本次实测返回 200；**不代表**未来可用，也不代表所有参数组合都验证过 |

### 本轮最重要的发现

PR #45/#46 曾记录「把原站所有旧版端点打了一遍，仍是 200 的还有 6 个」。
2026-11-09 复核发现**该审计不完整**：

| 端点 | 上一轮结论 | 本轮实测 | 处置 |
|---|---|---|---|
| `GET /api/topics/hot.json` | 未列入 | **200**，10 条，按 `replies` 降序 | 已实现（V13-02） |
| `GET /api/replies/show.json?topic_id=1` | 未列入 | **200**，178 条 | 已实现（V13-03） |
| `GET /api/nodes/list.json` | 未列入 | 裸路径 **400**；带齐参数 **200** | 已实现（V13-04） |

`nodes/list.json` 尤其容易误判：裸路径的 400 是**参数校验失败**，不是端点下线。
第三方 SDK 公开说明也记载「必须同时提供 `fields`/`sort_by`/`reverse`，缺任一返回 400」。

**仍确认下线（404）**：`/api/topics.json`、`/api/nodes.json`（本轮再次验证）。
这两条**不实现**，也不宣称兼容。

---

## 1. 端点清单与状态

| # | 端点 | 原站实测 | 本项目 | 状态 |
|---|---|---|---|---|
| 1 | `GET /api/topics/show.json` | 200 | 200 | ✅ 已实现且已验证（PR #45） |
| 2 | `GET /api/topics/latest.json` | 200 | 200 | ✅ 已实现且已验证（PR #46） |
| 3 | `GET /api/topics/hot.json` | **200** | 200 | ✅ **本轮新增**（V13-02） |
| 4 | `GET /api/replies/show.json` | **200** | 200 | ✅ **本轮新增**（V13-03） |
| 5 | `GET /api/members/show.json` | 200 | 200 | ✅ 已实现且已验证（PR #46） |
| 6 | `GET /api/nodes/show.json` | 200 | 200 | ✅ 已实现且已验证（PR #46） |
| 7 | `GET /api/nodes/all.json` | 200 | 200 | ✅ 已实现且已验证（PR #46） |
| 8 | `GET /api/nodes/list.json` | 400（缺参）/ **200**（带齐） | 同口径 | ✅ **本轮新增**（V13-04） |
| 9 | `GET /feed/{node}.xml` | 200 Atom 1.0 | 200 | ✅ 已实现且已验证（PR #46） |
| 10 | `GET /feed/{node}.json` | 200 JSON Feed 1.0 | 200 | ✅ 已实现且已验证（PR #46） |
| — | `GET /api/topics.json` | **404** | 404 | ⛔ 原站已下线，不实现 |
| — | `GET /api/nodes.json` | **404** | 404 | ⛔ 原站已下线，不实现 |

> **范围声明**：本矩阵只覆盖上表列出的 **10 个端点 + 2 个已下线端点 + 站内
> 自建 Feed**。它**不代表**覆盖原站 API 2.0（`/api/v2/*`，需 PAT）、
> 不代表覆盖原站全部历史端点，也不构成对原站未来行为的承诺。

---

## 2. 15 项逐项核对矩阵

### 2.1 主题 / 回复类（4 个端点）

| # | 核对项 | `topics/show.json` | `topics/latest.json` | `topics/hot.json` | `replies/show.json` |
|---|---|---|---|---|---|
| 1 | URL + 方法 | `GET` | `GET` | `GET` | `GET` |
| 2 | 查询参数 | `id` / `username` / `node_name` | 无有效参数 | 无有效参数 | `topic_id` |
| 3 | 参数优先级 | `id > username > node_name`；同名取**最后一个** | 全部忽略 | 全部忽略 | 同名取**最后一个**（`1&2` ⇒ 2） |
| 4 | 缺失参数 | `404` + JSON 错误体 | 200 全站最新 | 200 全站热门 | **200 `[]`** |
| 5 | 不存在的 ID / 名称 | 合法 id 不存在 ⇒ **200 `[]`**；用户名/节点名不存在 ⇒ 404 | — | — | 不存在 / `0` / `abc` ⇒ **200 `[]`** |
| 6 | 响应状态码 | 200 / 404 / 429 | 200 / 429 | 200 / 429 | **200 / 429**（无 404 分支） |
| 7 | 数据类型 | **数组** | **数组** | **数组** | **数组** |
| 8 | 字段与类型 | 13 键；`created/last_modified/last_touched` Unix 秒整数；`deleted` 整数 0/1 | 同左，完全同构 | 同左，完全同构 | 8 键；`member_id === member.id`；`content_rendered` 为 HTML |
| 9 | null / 空数组 / 空对象 | 零回复 ⇒ `last_reply_by: ''`（不是 null）；未采集社交字段 ⇒ `null` | 同左 | 同左 | 无参数 ⇒ `[]`；`member` 可选资料可为 `null` |
| 10 | 排序 / 分页 / 数量 | `created` 降序，固定 10；`limit` 被忽略 | `created` 降序，固定 **35**；`limit/page/p/node_name` 全忽略 | **`replies` 严格降序**，固定 10；`limit/node_name/id` 全忽略 | `id` 升序；`page/page_size` **被忽略**（body 逐字节相同）；原站无上限 |
| 11 | Content-Type | `application/json;charset=UTF-8` | 同左 | 同左 | 同左 |
| 12 | Cache-Control | `public, max-age=120` | `120` | `120` | **`60`** |
| 13 | 速率限制 | 600/h/IP + `x-rate-limit-*` 三元组 | 同左 | 同左 | 同左 |
| 14 | 认证 | 无需认证，匿名只读 | 同左 | 同左 | 同左 |
| 15 | 隐私字段 | 不含邮箱 / 口令哈希 / 会话令牌 / 积分；软删除主题不可见 | 同左 | 同左 | 不含私密字段；软删除回复与已删除主题的回复不可见 |

### 2.2 节点 / 会员类（4 个端点）

| # | 核对项 | `nodes/show.json` | `nodes/all.json` | `nodes/list.json` | `members/show.json` |
|---|---|---|---|---|---|
| 1 | URL + 方法 | `GET` | `GET` | `GET` | `GET` |
| 2 | 查询参数 | `name` / `id` | 无 | `fields` / `sort_by` / `reverse` **三者必填** | `username` / `id` |
| 3 | 参数优先级 | **任一命中即可**（不是 AND） | — | `fields` 为投影；`sort_by` 决定排序；`reverse` 实测**不生效** | **任一命中即可** |
| 4 | 缺失参数 | 404 | 200 全量 | **400 + 极简 HTML**（非 JSON 错误体） | 404 |
| 5 | 不存在的 ID / 名称 | 404 JSON 错误体 | — | — | 404 JSON 错误体 |
| 6 | 响应状态码 | 200 / 404 / 429 | 200 / 429 | 400 / 200 / 429 | 200 / 404 / 429 |
| 7 | 数据类型 | **单对象**（16 键） | **数组** | **数组**（元素只含请求字段） | **单对象**（20 键 + `status:"found"`） |
| 8 | 字段与类型 | `id:int`、`stars:int`、`root:bool`、`aliases:[]` | 同左 | 按 `fields` 投影；未知字段 ⇒ **`null`** | 时间 Unix 秒；`pro:0`；社交字段 `null` |
| 9 | null / 空值 | `header/footer: ''`、`aliases: []` | 同左 | 未知字段 `null`；实测 `fields=bogus` ⇒ `{"bogus":null}` | 未填资料 `null` |
| 10 | 排序 / 分页 / 数量 | 单对象 | id 升序，1380 条（实测），不分页 | `sort_by=id` ⇒ id 降序；`=name` ⇒ name 降序；其它值 ⇒ name 升序；`reverse` 无效；不分页 | 单对象 |
| 11 | Content-Type | `application/json;charset=UTF-8` | 同左 | **`application/json;charset=utf-8`**（小写 utf-8） | **`application/json; charset=UTF-8`**（带空格） |
| 12 | Cache-Control | `3600` | `7200` | **`30`** | `600` |
| 13 | 速率限制 | 600/h/IP | 同左 | 同左 | 同左 |
| 14 | 认证 | 无需认证 | 同左 | 同左 | 同左 |
| 15 | 隐私字段 | 统一只暴露 `status='active'` 节点（见下方口径说明）；不含私密字段 | 同左 | 同左 | 封禁 / 停用用户资料不公开；不含邮箱 / 哈希 / 令牌 / 积分 |

> **节点可见性的统一口径（不是「目录端点过滤、内容端点不过滤」）**：
> v0.0.13 收尾复核发现，此前只有节点目录类端点经 `loadLegacyNodeRecords()`
> 带 `eq(schema.nodes.status, 'active')`，而主题查询、`?node_name=` 存在性检查、
> 节点 Feed 查询都没有该条件 ⇒ 同一 `pending` / `hidden` 节点在目录里查不到，
> 却仍可从 `topics/show.json?node_name=`、`/feed/{node}.xml|json`、
> `/api/nodes/{name}/feed` 取到，是 V13-01 声称「结构上杜绝」的真实跨接口泄漏。
> 现全部旧版 / Feed 公共路径**统一引用**
> `src/lib/node-visibility.ts` 导出的 `PUBLIC_NODE_CONDITION`
> （旧版装配器 `src/server/legacy-assemblers.ts` re-export，站内
> `src/lib/feed-builder.ts` 直接引用；放纯模块是为了不让 feed-builder
> 反向 import `@/db`）：
> 目录端点不列出、`?node_name=` 走 404、按 id 查主题返回 `[]`、
> `replies/show.json` 按 `topic_id` 取不到、节点 Feed 走 404 / 空、
> 全站 Feed（旧版与站内 `/api/feed*`）都不含其主题。
> 原站对非 active 节点的旧版 API 行为**无法验证**，本项目**不宣称完全兼容**，
> 这是**有意策略**，已在 §3 登记。
>
> **Feed 节点名大小写口径（如实登记）**：`/feed/{node}.xml|json` 与
> `/api/nodes/{name}/feed` 均**大小写不敏感**、命中即返回 200 ——
> 前者后缀正则带 `/i`（`src/app/feed/[file]/route.ts`），
> `src/server/legacy-feed.ts` 与 `nodes/[name]/feed` 查库前先 `toLowerCase()`。
> **原站该行为无法确认**，本项目不宣称与原站一致，属**有意策略**（§3）。
> 不存在的节点名仍返回 404，与大小写无关；**不写成「404 / 区分大小写」**。

### 2.3 Feed 类（2 个旧版端点 + 站内自建）

| # | 核对项 | `/feed/{node}.xml` | `/feed/{node}.json` | 站内 `/api/feed*` |
|---|---|---|---|---|
| 1 | URL + 方法 | `GET`，节点名为路径段 | `GET`，节点名为路径段 | `GET` |
| 2 | 查询参数 | 无 | 无 | `?format=json`（节点路径） |
| 3 | 参数优先级 | 后缀 `.xml` 决定格式；无扩展名 ⇒ 404 | 后缀 `.json` 决定格式 | — |
| 4 | 缺失参数 | 不适用 | 不适用 | 不适用 |
| 5 | 不存在节点 | **404**（JSON 错误体） | **404** | 404 |
| 6 | 响应状态码 | 200 / 404 / 429 / **304** | 200 / 404 / 429 / **304** | 200 / 304 |
| 7 | 数据类型 | **Atom 1.0 XML** | **JSON Feed 1.0** | RSS 2.0 / Atom 1.0 / JSON Feed 1.1（**不同格式，见 §4**） |
| 8 | 字段与类型 | 元素顺序 `title→subtitle→icon→logo→link→link→id→updated→entry*` | `version: jsonfeed.org/version/1`、`author{}`（**不是 1.1 的 `authors[]`**）、条目无 `content_text/summary` | 各自规范 |
| 9 | 空值行为 | 节点无主题 ⇒ 0 个 `<entry>`（仍是合法 feed） | `items: []` | 同 |
| 10 | 排序 / 数量 | 最近活跃降序，固定 **50** | 同左 | 30 条（站内） |
| 11 | Content-Type | `application/atom+xml;charset=UTF-8` | `application/json;charset=utf-8` | 各自类型 |
| 12 | Cache-Control | `600` | `1800` | 300 / 120 |
| 13 | 速率限制 | 600/h/IP | 同左 | 无独立配额 |
| 14 | 认证 | 无需认证 | 同左 | 无需认证 |
| 15 | 隐私字段 | 只含已发布主题；正文经 `sanitize-html` 清洗；不含私密字段 | 同左 | 同左 |

**Feed 额外验证（本轮新增，见 `e2e/v013-feed-reader.spec.ts`）**：
浏览器原生 `DOMParser` 严格解析、条目 id 唯一且稳定、`#replyN` 锚点、
`+00:00` / 秒级 `Z` 时间、UTF-8 中文无替换字符、`]]>` 与非法控制字符不破坏 XML、
Markdown 正文无 `<script>` / `javascript:` / `onerror=`、内部链接指向本站、
UI 订阅链接真实可点击、`If-None-Match` ⇒ 304 且 body 为空。

---

## 3. 有意偏离清单（不掩盖）

| # | 偏离 | 原因 | 登记位置 |
|---|---|---|---|
| 1 | 限流按端点分桶（原站是所有 `/api/*` 共享 600/h 大桶） | 避免单个端点被打满拖垮全部端点 | `docs/API_SPEC.md` §14.2 |
| 2 | 软删除主题对公众不可见 | 安全策略；原站行为未实测，取更保守一侧 | `src/lib/legacy-topic-api.ts` 文件头 |
| 3 | `member.pro` 恒 0、社交字段恒 `null` | 未建模，给空值而非编造 | 同上 |
| 4 | 头像为确定性占位 SVG data URI | 不复制原站受保护图像资源 | 同上 |
| 5 | `/feed/all.xml` 返回合法全站 Atom | 原站返回 200 但 **body 长度 0**，任何阅读器都会失败 | `docs/API_SPEC.md` §14.3 |
| 6 | `nodes/list.json` 未建模字段投影为 `null` | 与原站「未知字段 ⇒ null」同口径 | `src/lib/legacy-node-list.ts` |
| 7 | `replies/show.json` 单次响应硬上限 1000 条 | 原站无上限；防止超大响应 | `src/server/legacy-replies.ts` |
| 8 | `hot.json` 同回复数时以 `id` 降序兜底 | 原站同值顺序未实测；补强排序确定性 | `src/server/legacy-topics.ts` |
| 9 | 封禁 / 停用用户的资料端点返回 404 | 隐私保守策略；原站行为未实测 | `src/app/api/members/show.json/route.ts` |
| 10 | 所有 Feed 增加 `ETag` / 304 | 按 HTTP 缓存规范补强，不改变原站形状 | `src/lib/feed-cache.ts` |
| 11 | 非 active 节点在所有旧版 / Feed 公共端点一律不可见（统一只暴露 active） | 修复 V13-01 声称「结构上杜绝」的真实跨接口泄漏：此前只有目录端点过滤，主题 / Feed / 回复路径仍可取到 `pending` / `hidden` 节点；站内 `/api/feed*` 一度漏收敛，现一并修掉；原站行为无法验证，不宣称完全兼容 | `docs/API_SPEC.md` §14.6、`src/lib/node-visibility.ts`（`PUBLIC_NODE_CONDITION` 唯一定义）、`src/server/legacy-assemblers.ts`（re-export）、`src/server/legacy-topics.ts`、`src/server/legacy-feed.ts`、`src/server/legacy-replies.ts`、`src/app/api/topics/show.json/route.ts`、`src/app/api/nodes/[name]/feed/route.ts`、`src/lib/feed-builder.ts` |
| 12 | Feed 节点名大小写不敏感（`/i` + `toLowerCase()`），命中返回 200 | 按本项目实现如实登记；原站该行为无法确认，不宣称与原站一致；不存在的节点名仍为 404 | `docs/API_SPEC.md` §14.3、`src/app/feed/[file]/route.ts`、`src/server/legacy-feed.ts` |

## 4. 格式区分（不得混为一谈）

| 路径 | 格式 | 版本 | 条数 | 服务对象 |
|---|---|---|---|---|
| `/feed/{node}.xml` | **Atom 1.0** | `http://www.w3.org/2005/Atom` | 50 | 按原站地址配置的第三方阅读器 |
| `/feed/{node}.json` | **JSON Feed 1.0** | `jsonfeed.org/version/1` | 50 | 同上 |
| `/api/feed` | RSS 2.0 | — | 30 | 站内自建 |
| `/api/feed/atom` | Atom 1.0 | — | 30 | 站内自建 |
| `/api/feed/json` | JSON Feed **1.1** | `jsonfeed.org/version/1.1` | 30 | 站内自建 |
| `/api/nodes/{name}/feed` | RSS 2.0（+`?format=json` → 1.1） | — | 30 | 站内兼容保留 |

## 5. 无法验证 / 未实测项（诚实披露）

| 项 | 状态 | 说明 |
|---|---|---|
| 原站 `429` 响应体 | **未实测** | 刻意不打满配额；本项目按公开文档实现 `Rate Limit Exceeded` + `Retry-After` |
| 原站软删除主题 / 回复的公开行为 | **未实测** | 本项目取「不可见」的保守一侧 |
| 原站封禁用户的资料端点行为 | **未实测** | 本项目取「不公开」的保守一侧 |
| 原站 `hot.json` 同回复数的并列顺序 | **未实测** | 本项目用 id 降序兜底 |
| 原站 `nodes/list.json` 的 `fields` 完整白名单 | **未穷举** | 已实测 `id/name/title/topics/stars` 与未知字段 `bogus`；其余字段按「未知 ⇒ null」处理 |
| 原站 `sort_by` 全部合法值 | **未穷举** | 已实测 `id` / `name` / `topics` / `bogus`；其它值归入「其它 ⇒ name 升序」 |
| 原站 API 2.0（`/api/v2/*`） | **不在本轮范围** | 需 PAT，本轮不做认证相关对接 |
| 原站非 active 节点（`pending` / `hidden`）的旧版 API 行为 | **无法验证** | 本项目所有旧版 / Feed 公共端点统一只暴露 active 节点（共用 `PUBLIC_NODE_CONDITION`）；不宣称与原站一致 |
| 原站 Feed 节点名大小写敏感性 | **无法确认** | 本项目按实现登记为大小写不敏感（`/i` + `toLowerCase()`），命中返回 200；不宣称与原站一致 |
| 原站端点未来可用性 | **无法保证** | 2026-11-09 的 200 不代表明天仍 200 |
| 原站 `/api/topics.json`、`/api/nodes.json` | **已确认 404** | 本项目不实现；文档明确标注「原站已下线」 |

**因此：本文件不宣称「完全兼容原站旧版 API」**，只宣称
「上表 10 个端点在 2026-11-09 实测可用，本项目按实测契约实现，
偏离与未验证项已逐条登记」。

## 6. 证据与测试映射

| 证据类型 | 位置 |
|---|---|
| 原站实测契约（首轮 10 组） | `src/lib/legacy-topic-api.ts` 文件头 |
| 原站实测契约（本轮 22 组） | `src/lib/legacy-node-list.ts` 文件头、`src/server/legacy-replies.ts` 文件头、本文件 §2 |
| 纯函数 / 常量护栏 | `tests/static/v010-legacy-api-shape.spec.ts`、`v013-legacy-contract.spec.ts` |
| 隐私与共用装配器护栏 | `tests/static/v013-legacy-privacy.spec.ts` |
| Feed 解析 / 转义 / ETag 护栏 | `tests/static/v010-legacy-feed-shape.spec.ts`、`v013-feed-safety.spec.ts` |
| 真实 HTTP 契约 | `e2e/v010-legacy-api.spec.ts`、`e2e/v013-legacy-api.spec.ts` |
| 真实阅读器订阅 | `e2e/v010-legacy-feed.spec.ts`、`e2e/v013-feed-reader.spec.ts` |
| 跨接口一致性 | `e2e/v013-legacy-api.spec.ts` §「跨接口字段一致性与隐私」 |
