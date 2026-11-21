# v0.0.19 测试报告

> 版本：`0.0.19`
> 发布日期：2026-11-21（GMT+8）
> 发布形态：GitHub Stable / Latest Release（`draft=false`、`prerelease=false`）
> 发布锚点：master `7baaae5d4704d86f145e8c5152fc3ea9abbf771c`；annotated Tag 对象 `266c0bcdc61a825c75db39bce62c9139e2205b0f`
> 产物：GHCR Digest `sha256:279324decd36c7cdaaab5758b566ee5fe7a43eaf674457ac2f2af7466f41d49e`；ZIP SHA256 `693fb7427f00f76b3090dbaa45e176b113698188174774e30b5cc5995b88ae4e`
> 原则：0 条用例、跳过用例、未采到数据都不得当作成功；24h 未完成必须保持 `not-completed`。

## 一、自动化基线

| 套件 | 结果 | 证据 |
|---|---|---|
| TypeScript | 通过 | `npx tsc --noEmit` |
| 完整单元（含静态） | **90 文件 / 1086 用例通过**，0 failed / 0 skipped | 本机隔离 PostgreSQL 55440，`vitest run` + 用例计数门禁 |
| 全量静态 | **43 文件 / 501 用例通过**，0 failed / 0 skipped | `vitest.static.config.ts` + 用例计数门禁 |
| v0.0.19 回复真库/API | **10/10** | `tests/v019-reply-threads.spec.ts` |
| 固定/滑动窗口限流 | **3/3** | `tests/rate-limit-window.spec.ts`，含 20 并发计数连续性 |
| 回复容量 | **100 / 500 / 2000 条**均通过 | 真库分页、跨页父链、软删父回复占位 |
| 双基线升级 | **PASS=30 / FAIL=0 × 2** | v0.0.4 与 v0.0.17 历史迁移集 → v0.0.19；45 项业务指纹逐字节一致；幂等 3 次；备份恢复一致 |
| Next.js 生产构建 | 通过 | `next build` |
| 生产依赖审计 | **0 漏洞** | `npm audit --omit=dev --audit-level=moderate` |
| 发行一致性（v0.0.19 正式发布态） | **PASS=19 / FAIL=0** | `verify-release-consistency.sh --expect 0.0.19` |
| 发布静态预演 | **23/23** | `preflight-dryrun.mjs --mode=static --version=v0.0.19` |
| Release Notes 预演 | **20/20** | `preflight-dryrun.mjs --mode=notes --version=v0.0.19` |
| 正式 Release 流水线 | **全部 job success** | GitHub Actions run `44888852285` |

## 二、浏览器验收

`e2e/v019-reply-experience.spec.ts` 共 8 组，全部通过：

1. 无刷新回复：列表、计数、定位与成功清空草稿。
2. 回复失败保留完整草稿并显示真实错误。
3. 父子关联：空输入可切换目标，输入后不覆盖原目标。
4. 七种显示模式即时切换，经典模式无父引用。
5. Light / Dark / System 即时生效、刷新保持与系统跟随。
6. 选择图片上传、Markdown 插入与无刷新发布。
7. 粘贴截图与拖入回复框均上传并插入。
8. 101 条回复跨页：目标页父引用与按需上下文。

既有 `feature.spec.ts`、`topic.spec.ts`、`v004-content-interaction.spec.ts` 中受无刷新回复影响的用例已迁移并复跑通过。

完整 Chromium E2E：**29 文件 / 295 用例通过**，0 failed。

跨浏览器矩阵：Chromium / Firefox / WebKit × 5 视口共 **15/15 分片 success**（GitHub Actions run `44881277162`）。期间发现并修复两项真实测试问题：Firefox 合成剪贴板事件未携带 `DataTransfer`，以及登录限流用例跨越固定窗口边界；修复后三引擎全部通过。

## 三、数据库与兼容性

- 新迁移 `0005_v019_reply_threads.sql` 只做加法。
- 历史回复 `parent_reply_id` 与 `client_request_id` 保持 `NULL`。
- 楼层号不变；旧 API 客户端忽略新增字段继续工作。
- 父回复外键、非自引用 CHECK、同主题/防环数据库触发器。
- API 写入限制父链最多 32 层；跨页读取父链最多 8 层、子回复每次最多 20 条。
- 新增 `user_preferences`、`reply_images`、`rate_limit_sliding_hits`。

## 四、负向与失败路径

- 跨主题父回复：服务端 404。
- 自引用 / 环形关系：数据库拒绝。
- SVG 上传、MIME/扩展名伪造、路径穿越：拒绝。
- 重复 `clientRequestId`：返回同一 `replyId`，不重复创建。
- 滑动窗口过期命中：丢弃；固定窗口边界：重置；20 并发：计数 1..20 连续。
- 回复失败：草稿保留；超时：先核对再安全重试。
- 发布预演：Tag 白名单移除、通配注入、缺 checkout、缺 PRERELEASE 等负向对照均真实判红。

## 五、长跑与发布后验收

- 1 小时 soak：最终候选 SHA GitHub Actions run `44881274218`，**通过**时长诚实闸门。
- 24 小时单实例连续运行：**`not-completed`**。
- 不得用 1 小时 soak 或分段累计替代 24 小时单实例连续运行。
- 发布后匿名全新安装：run `44890019049`，13 项、0 FAIL、1 个已披露 WARN。
- 官方包四角色：run `44890022618`，**30 PASS / 0 FAIL**。
- 官方包 v0.0.19 专项：run `44890893741`，**41 PASS / 0 FAIL**；覆盖父子回复、七种展示模式、Light/Dark/System、回复图片。
- 官方公开资产 v0.0.18 → v0.0.19 升级：首次 run `44890026036` 因验收脚本把预期迁移数变化误判为业务指纹变化而失败；修正后 run `44890599571` 为 **10 PASS / 0 FAIL**，12 行业务指纹逐字节一致，迁移 5→6 且与目标镜像 journal 一致。
