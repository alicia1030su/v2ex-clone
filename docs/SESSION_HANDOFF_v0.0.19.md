# v0.0.19 会话交接：V2EX 2026 年 11 月更新跟进

> 分支：`release/v0.0.19-stable`
> worktree：`C:/Users/TYMO001/WorkBuddy/ai/_worktrees/v0019-release`
> 基线：`c8734f1eaa414264ef1319ed2c7b5690094c9812`（v0.0.18 发布后文档提交）
> 日期：2026-11-21（GMT+8）
> 状态：**v0.0.19 已正式发布为 Stable / Latest，并完成发布后独立验收。**

## 一、授权边界

> HEAD（正式发布 commit）：`7baaae5d4704d86f145e8c5152fc3ea9abbf771c`。

- 项目所有者对 v0.0.19 单独作出 **A3 + B1** 裁决：保留历史并强化披露，R-01 维持 `DEFERRED`；授权本版发布 Stable Release。
- 授权记录：`docs/RISK_DECISION_v0.0.19.md`，已通过 `verify-risk-decision.mjs`。
- 授权仅限 v0.0.19，不延续到 v0.0.20。
- 不 force push、不改写历史、不移动/删除 Tag、不覆盖已有 Release、不降低门禁。
- 24 小时单实例连续运行仍为 `not-completed`，不得用 1 小时 soak 替代。

## 二、已完成实现

### P0-1 父子回复

- 新迁移 `drizzle/0005_v019_reply_threads.sql`：
  - `replies.parent_reply_id`，历史回复默认 `NULL`；
  - `replies.client_request_id` 唯一幂等键；
  - `user_preferences`；
  - `reply_images`；
  - `rate_limit_sliding_hits`。
- 数据库外键、非自引用 CHECK、同主题/防环触发器。
- API 服务端二次校验主题、父回复、节点可见性、软删状态与 32 层父链上限。
- 历史 `@` 文本不参与父子推断。

### P0-2 七种回复展示

- 经典平铺、引用条、角标与悬浮预览、楼中楼、树形缩进、对话连线、引用楼层。
- 登录用户服务端保存；游客本地保存。
- 经典分页不变；跨页父链最多 8 层、直接子回复每次最多 20 条，按需加载。
- 树形最大缩进 4 层；支持展开/收起。
- 对话连线支持桌面 hover 与键盘焦点高亮。

### P0-3 无刷新回复

- JSON 提交后本地追加回复、更新计数并滚动定位。
- 成功确认后才清空草稿；失败保留完整草稿。
- 支持 Ctrl/Cmd+Enter。
- 20 秒超时后使用同一幂等键核对；未确认时保留草稿并可安全重试。

### P1-1 回复图片

- 选择、拖拽、粘贴上传；成功后插入 Markdown。
- 最近图片桌面 10、移动端 CSS 仅展示前 6。
- 点击插入/移除；独立预览入口。
- PNG/JPEG/WebP/GIF magic 校验、MIME/扩展名一致性、5MB、4000 万像素、最长边 2400。
- 服务端随机文件名、CSRF、固定窗口 + 滑动窗口突发限流、未使用文件 TTL/数量清理。
- 二进制位于 `public/uploads/`，已确认被 `.gitignore` 排除。

### P1-2 三态主题

- Light / Dark / System。
- 登录用户写入 `user_preferences`；游客使用本地偏好。
- 首屏阻塞脚本在绘制前应用偏好，减少白屏闪烁。
- 系统主题变化时更新有效明暗值。

### P1-3 限流

- 保留既有固定窗口。
- 新增 Redis ZSET / PostgreSQL 命中表两种后端一致的滑动窗口原子实现。
- 图片突发默认 10/60s，最近列表 60/60s，回复上下文登录 60/60s、游客 IP 120/60s。
- 20 并发滑动窗口命中计数连续无丢失。

## 三、官方功能复核

见 `docs/V2EX_NOVEMBER_2026_FEATURE_REVIEW.md`。

已读取官方来源：

- <https://www.v2ex.com/t/1253703>
- <https://www.v2ex.com/t/1257127>
- <https://www.v2ex.com/t/1257225>
- <https://www.v2ex.com/t/1257567>
- <https://edge.v2ex.com/help/reply-threads>
- <https://edge.v2ex.com/t/1257128>
- <https://www.v2ex.com/go/status>

关键差异：

- 官方楼中楼只覆盖部署后创建的主题；本项目历史回复保持无父关联，但新回复可在旧主题建立父子关系，属兼容增强。
- 官方已知跨页树形分支缺陷；本项目用按需父链/子回复窗口修复。
- 官方示意图未复制，本项目使用独立文本选择器。
- 官方最近图片限 `/i` 用户；本项目无 `/i` 等级，改为所有登录用户可用并保留安全限流。

## 四、当前测试基线与证据

- TypeScript：通过。
- Next.js 生产构建：通过。
- 完整单元：**90 文件 / 1086 用例通过**，0 failed / 0 skipped。
- 全量静态：**43 文件 / 501 用例通过**，0 failed / 0 skipped。
- 完整 Chromium E2E：**29 文件 / 295 用例通过**。
- v0.0.19 回复浏览器专项：**8/8**。
- 静态契约：`tests/static/v019-reply-threads.spec.ts` **17/17**。
- 真库/API：`tests/v019-reply-threads.spec.ts` **10/10**。
- 100 / 500 / 2000 条回复容量：通过。
- 双基线升级：两条基线各 **PASS=30 / FAIL=0**，45 项业务指纹一致。
- 固定/滑动窗口与 20 并发：`tests/rate-limit-window.spec.ts` **3/3**。
- 发行一致性：**PASS=19 / FAIL=0**。
- 发布预演：static **23/23**、notes **20/20**。
- 生产依赖审计：0 漏洞。

## 五、版本冻结与正式发布状态

- 业务实现提交：`ebfabdc`；最终发布 commit：`7baaae5d4704d86f145e8c5152fc3ea9abbf771c`。
- 版本载体已按 G-VER-01 同步到 `0.0.19` 并通过 20 项写后复验。
- v0.0.19 已登记为 Stable 并正式发布；v0.0.20 未预登记、未开始。
- annotated Tag：`v0.0.19`，Tag 对象 `266c0bcdc61a825c75db39bce62c9139e2205b0f`。
- Release：ID `453579475`，Stable / Latest，`draft=false`、`prerelease=false`。
- GHCR Digest：`sha256:279324decd36c7cdaaab5758b566ee5fe7a43eaf674457ac2f2af7466f41d49e`。
- 部署 ZIP：144,346 字节，SHA256 `693fb7427f00f76b3090dbaa45e176b113698188174774e30b5cc5995b88ae4e`。
- 正式 Release 流水线 run `44888852285` 全部 job success。

## 六、Go/No-Go 与发布后验收

- **Go（已执行）**：v0.0.19 已完成正式 Stable Release 与发布后独立验收。
- 1 小时 soak：run `44881274218`，通过。
- 发布后匿名验收：run `44890019049`，13 项 0 FAIL（1 个已披露 WARN）。
- 官方包四角色：run `44890022618`，30/30 通过。
- 官方包 v0.0.19 专项：run `44890893741`，41/41 通过。
- 官方公开资产升级：run `44890599571`，10/10 通过；首次失败已定位为验收脚本误判并修复。
- **永久边界**：R-01 保持 `DEFERRED / A3`；24 小时单实例连续运行保持 `not-completed`；B1 授权仅限 v0.0.19，不延续到 v0.0.20。
