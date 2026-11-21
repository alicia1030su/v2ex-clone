# V2EX 2026 年 11 月更新功能复核

> 复核日期：2026-11-21（GMT+8）
> 目标版本：v0.0.19
> 方法：只读官方公告、官方帮助页与公开 Demo；不绕过访问控制，不复制官方 HTML/CSS/JS/图片或商标素材。
>
> 状态口径：`IMPLEMENTED`、`PARTIAL`、`MISSING`、`UNVERIFIED`、`INTENTIONALLY_DIFFERENT`。
> 视觉细节没有合法、可重复的像素证据时一律标为 `UNVERIFIED`，不声称“完全一致”。

## 一、官方时间线

| 官方来源 | 标题日期 | 页面显示时间 | 主题 | 本复核可确认内容 |
|---|---|---|---|---|
| <https://www.v2ex.com/t/1253703> | 2026-11-01 | 2026-11-04 20:10:34 +08:00 | 回复、图片和钱包充值更新 | 无刷新回复、成功清空草稿、失败保留草稿、Ctrl/Cmd+Enter、最近图片桌面 10 / 手机 6、拖拽与粘贴上传、点击插入/移除、悬停预览 |
| <https://www.v2ex.com/t/1257127> | 2026-11-14 | 页面仅显示“6 天前” | 楼中楼样式、黑暗模式跟随系统 | 设置页提供 6 种楼中楼样式；黑暗模式可自动跟随系统；作者说明该功能只覆盖部署后创建的主题 |
| <https://www.v2ex.com/t/1257225> | 2026-11-15 | 页面仅显示“5 天前” | 示意图选择、改进版树形缩进 | 设置页用示意图选择样式；树形缩进改进；回复中确认跨页回复未进入对应树形分支 |
| <https://www.v2ex.com/t/1257567> | 2026-11-16 | 页面仅显示“4 天前” | 对话连线 | 保持默认时间排序，在左侧用连线表达对话；桌面悬停高亮对应对话 |
| <https://www.v2ex.com/go/status> | 2026-11-05 | 状态页当前条目 | 第三方插件异常重复请求 | 第三方插件 bug 造成反复请求，用户可能遇到 Cloudflare Interactive Challenge |
| <https://edge.v2ex.com/help/reply-threads> | 帮助页 | 当前版本 | 楼中楼完整行为契约 | 默认经典平铺；七种阅读方式；关联只由回复按钮建立；手动 `@` 不建立关联；跨页父楼层显示引用；楼层号不变；Block/忽略/隐藏回复不进入引用、角标或预览 |

> 说明：11 月 1 日主题标题中的日期与页面显示发帖时间不一致，本表同时保留两者，不把标题日期冒充精确发帖时间。其余公告页面只提供相对时间，因此不编造绝对时间。

## 二、官方楼中楼行为契约

| 模式 | 官方行为 | 本项目实现 | 状态 |
|---|---|---|---|
| 经典平铺（默认） | 按楼层平铺，不显示回复关联 | `classic`；保持原分页与楼层顺序，不渲染父引用 | IMPLEMENTED |
| 引用条 | 楼层顺序不变，回复上方显示一行引用，可点击跳转 | `quote`；父回复摘要 + 上下文入口 | IMPLEMENTED |
| 角标 + 悬浮预览 | 楼层顺序不变，时间旁显示 `↩ #N`，悬停预览；每层下列出回复它的人 | `badge`；桌面 hover/focus 预览，移动端点击预览 | IMPLEMENTED；像素级视觉 UNVERIFIED |
| 楼中楼 | 同父回复收进父楼层下方灰色框，回复的回复也在同一框内 | `nested`；当前页直接嵌套，跨页按需加载直接子回复 | IMPLEMENTED；跨页行为为本项目增强 |
| 树形缩进 | 用细线挂在父楼层下，点击线收起其下回复 | `tree`；最大深度 4，展开/收起，跨页父链按需读取 | IMPLEMENTED；官方已知跨页缺陷未复刻 |
| 对话连线 | 保持时间排序，左侧彩色连线；桌面悬停高亮对话 | `lines`；保持楼层顺序，父关系连线，hover/focus 高亮相关回复 | IMPLEMENTED；移动端高亮为焦点/点击可达 |
| 引用楼层 | 回复上方完整引用原文，更早上文默认折叠 | `excerpt`；`<details>` 折叠父回复摘要 | IMPLEMENTED；长链折叠阈值 UNVERIFIED |

### 关联建立规则

| 官方规则 | 本项目实现 | 状态 |
|---|---|---|
| 只有点击楼层回复按钮才建立父子关联 | `ReplyItem` 的“回复”按钮设置 `parentReplyId` | IMPLEMENTED |
| 手动输入 `@某人` 不建立关联 | `@` 只用于提及通知；父字段只来自显式按钮 | IMPLEMENTED |
| 未输入内容时切换回复目标会更新父楼层 | `dirty=false` 时允许切换 | IMPLEMENTED |
| 已输入内容后点击其他楼层不覆盖原目标 | `dirty=true` 时保留原目标并提示；文字不丢失 | IMPLEMENTED |
| 点击提示旁 `×` 取消关联 | “取消关联”清空父目标 | IMPLEMENTED |
| 父回复在另一页时显示一行引用并链接到所在页 | 当前页显示跨页父摘要；上下文接口按需读取父链 | IMPLEMENTED；链接到精确页码受经典分页约束，当前提供上下文面板 |
| 楼层号不随模式变化 | 所有模式都使用 `replies.floor`，迁移不改写旧楼层 | IMPLEMENTED |
| Block/忽略/隐藏回复不出现在引用、角标、预览 | 新回复写入拒绝不可见父回复；读取使用 `PUBLIC_REPLY_CONDITION` 与节点可见性 | IMPLEMENTED；项目尚无完整用户 Block 系统，隐藏/软删/节点条件已覆盖 |

## 三、逐项功能对照

| 官方更新 | 当前实现 | 证据 | 状态 / 差异 |
|---|---|---|---|
| 无刷新回复 | JSON 提交后客户端追加新回复、更新计数并滚动定位，不刷新整页 | `ReplyComposer.tsx`、`ReplyList.tsx`、`POST /api/replies` | IMPLEMENTED；真实浏览器验收待完整 E2E |
| 成功后清空草稿 | 仅在服务端 `ok=true` 且返回新回复后清空本地草稿 | 同上 | IMPLEMENTED |
| 失败保留完整草稿 | 内容持久化到 `localStorage`；HTTP/网络/超时不清空 | 同上 | IMPLEMENTED |
| Ctrl/Cmd+Enter | 编辑器快捷键提交 | `ReplyComposer.tsx` | IMPLEMENTED |
| 网络超时不假定成功/失败 | 20 秒中止后用同一 `clientRequestId` 轮询核对；未确认时保留草稿并可安全重试 | `/api/replies/submission`、`replies.client_request_id` 唯一索引 | IMPLEMENTED |
| 防重复回复 | 客户端请求幂等键 + 服务端唯一索引；重试返回同一 `replyId` | 真库测试 10/10 | IMPLEMENTED |
| 最近上传图片 | 登录用户最近未使用图片；桌面 10、移动端 CSS 仅展示前 6 | `/api/reply-images`、`ReplyComposer.tsx` | IMPLEMENTED |
| 拖拽/粘贴/选择图片 | 三种入口均上传成功后插入 Markdown | `ReplyComposer.tsx` | IMPLEMENTED |
| 点击插入/移除、悬停/点击预览 | 缩略图切换 Markdown；独立预览按钮；移动端固定底部预览 | `ReplyComposer.tsx`、`globals.css` | IMPLEMENTED |
| 官方 `/i` 权限门槛 | 本项目没有 `/i` 用户等级，改为所有登录用户可用，仍受 CSRF、限流与存储配额约束 | `POST /api/reply-images` | INTENTIONALLY_DIFFERENT |
| 黑暗模式跟随系统 | Light/Dark/System 三态；登录用户服务端保存，游客本地保存；首屏阻塞脚本防闪烁 | `user_preferences`、`ThemeToggle.tsx`、`layout.tsx` | IMPLEMENTED |
| 树形跨页缺陷 | 官方确认跨页回复未进入对应分支；本项目用按需父链/子回复窗口修复，不一次加载全主题 | `getReplyContext()` | INTENTIONALLY_DIFFERENT（明确增强） |
| 示意图选择样式 | 本项目使用文本下拉而非官方示意图 | `ReplyList.tsx` | INTENTIONALLY_DIFFERENT；示意图素材未复制 |
| 第三方插件反复请求 | 回复、图片上传、上下文查询均走服务端限流；后续补固定/滑动窗口负载测试 | `rate-limit.ts`、API 路由 | PARTIAL |

## 四、与现有数据模型的兼容性

- 新迁移 `0005_v019_reply_threads.sql` 只做加法。
- 历史回复 `parent_reply_id = NULL`，不根据历史 `@` 文本猜测关系。
- 历史回复 `floor` 不变，`(topic_id, floor)` 唯一索引保持不变。
- `parent_reply_id` 有外键、非自引用 CHECK，以及数据库触发器强制同主题、拒绝成环。
- API 写入前重新验证主题、父回复、节点可见性和软删状态。
- 回复图片使用独立 `reply_images` 元数据表；二进制写入持久化上传卷，不进入 Git。
- 旧客户端忽略新增 JSON 字段即可继续工作；旧表单仍可无 `parentReplyId` 提交。

## 五、无法验证项

- 官方示意图、对话连线颜色、圆角、间距、动画和移动端紧凑版的具体像素值：`UNVERIFIED`。
- 官方“引用楼层”的长链折叠阈值与最多展开层数：`UNVERIFIED`。
- 官方对话连线在触控端的完整交互：公告只明确桌面 hover；本项目提供焦点/点击高亮，属独立实现。
- 官方最近图片权限 `/i` 的完整判定规则：公告只说明“可以使用 `/i` 的用户”，未给出权限模型。
- 官方图片格式、大小、像素、数量与费用上限：公告未说明；本项目采用独立安全白名单。

## 六、测试证据

- 静态契约：`tests/static/v019-reply-threads.spec.ts`，14/14 通过。
- 真库与 API：`tests/v019-reply-threads.spec.ts`，10/10 通过。
- 容量：100 / 500 / 2000 条回复分页与跨页父链通过。
- TypeScript：`tsc --noEmit` 通过。
- Next.js 生产构建：通过。
- 浏览器七模式、无刷新、图片拖拽/粘贴与主题切换：需在完整 E2E/发布后独立验收中补齐。
