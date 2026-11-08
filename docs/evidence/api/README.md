# 旧版 JSON API 兼容端点 —— 实测证据

> 采集时间：2026-11-08 23:32（北京时间）
> 采集对象：**本项目自身**的 `next start`（隔离库 `v2ex_legacy_api_verify`，端口 3210）
> 采集方式：`curl` 直取，响应体原样落盘

## 为什么保存这些文件

`GET /api/topics/show.json` 是**给第三方客户端用的兼容端点**，
它的价值全部押在「字段名 / 类型 / 空值语义与原站一致」上。
这类契约一旦被改动，**站内页面毫无变化、大多数测试也不会红**，
但所有外部客户端会静默解析失败 —— 因此保存**真实响应原文**作为基线，
供 `tests/static/v010-legacy-api-shape.spec.ts` 之外的**人工复核**使用。

## 文件对应关系

| 文件 | 请求 | 说明 |
|---|---|---|
| `legacy-show-id1.json` | `GET /api/topics/show.json?id=1` | 单条模式；含完整 `member` / `node` 子结构 |
| `legacy-show-username.json` | `?username=lisi` | 用户模式；4 条（本库该用户只有 4 条主题），`created` 降序 |
| `legacy-show-node.json` | `?node_name=programmer` | 节点模式；2 条 |
| `legacy-show-404.json` | `?id=abc` | 404 错误体（`status/message/rate_limit` 三段） |

## 已核对的关键约定（与 `src/lib/legacy-topic-api.ts` 文件头一致）

- 顶层是**数组**（不是 `{ok:true}` 包裹），单条模式也是长度 1 的数组
- `created` / `last_modified` / `last_touched` 均为 **Unix 秒整数**
- `deleted` 为**整数 0/1**（不是布尔）
- 零回复时 `last_reply_by` 是**空字符串**（不是 `null`）
- `content` 是 Markdown 源文本，`content_rendered` 是 HTML（两者不相等）
- `url` 字段为**绝对地址**，指向本站（`APP_URL` 决定基址）

## 与原站的差异（不掩盖）

`member.pro` 恒 0、`member.twitter/github/psn/btc` 恒 `null`、
`node.header/footer/aliases` 为空值、头像为确定性占位 SVG 的 `data:` URI、
软删除主题对公众不可见。逐条理由见 `src/lib/legacy-topic-api.ts` 文件头。

## 合规说明

这些文件是**本项目自身输出**的响应，不含原站任何内容
（原站契约只记录了**字段名与类型**，未镜像原站数据）。
