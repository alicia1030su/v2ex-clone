# v0.0.18 实施报告：工程治理 + 产品体验升级

> 分支：`feat/v0.0.18-governance`
> 基线：master `73b83061b3e36c81963fb8f0edee20673f019099`
> 日期：2026-11-20
> **本报告不是发布授权。**

## 一、交付总览

| 工作项 | 交付 | 结果 |
|---|---|---|
| P0-1 发布渠道治理 | 单一渠道清单、统一解析器、消费者迁移、历史授权兼容 | 完成 |
| P0-2 Git 暂存安全 | 安全暂存工具、检查器、hook、CI 门禁、开发文档 | 完成 |
| P1-1 单实例长跑 | 观测工具、Node 分段启动器、手动 workflow、证据 schema | 工具完成；24h `not-completed` |
| P1-2 产品差距 | 路由枚举、权限抽样、功能/视觉审查、优先级报告 | 完成 |
| 追加 P0 | 公共内容软删/隐藏可见性统一治理 | 本轮修复，结果见测试报告 |

## 二、P0-1：发布渠道单一事实来源

### 2.1 新增

- `docs/RELEASE_CHANNELS.json`：`default=prerelease` + 精确版本映射；当前 `v0.0.17=stable`。
- `scripts/release/resolve-release-channel.mjs`：唯一渠道解析器；不决定授权、不查询 GitHub。
- `tests/static/v018-release-channel.spec.ts`：真实清单、默认渠道、冲突、通配、缺失、非法值负向对照。

### 2.2 消费者迁移

- `.github/workflows/release.yml`：移除独立 `prerelease` 输入；meta 与 publish-release 都调用解析器；
  Notes 形态在 Node 中生成，避免多行 shell/heredoc。
- `.github/workflows/post-release-verify.yml`：期望形态从解析器读取。
- `scripts/release/preflight-dryrun.mjs`：Notes 预演与真实发布共用渠道结论。
- `scripts/release/verify-release-consistency.sh`：按声明渠道比较实际 Release；修复 Windows `/tmp` 路径问题。
- `scripts/release/verify-risk-decision.mjs`：授权操作改为通用 `create-public-release`，兼容历史裁决字段。
- 旧 `STABLE_RELEASES.json` 保留为迁移输入，由解析器校验冲突。

### 2.3 效果

- v0.0.17 解析为 stable / Latest；v0.0.18 未登记，默认 prerelease。
- 预演 static 21/21、notes 17/17；真实 v0.0.17 Release 一致性检查通过。
- 不存在可执行的“0.0.x 必须 Pre-release”断言。

## 三、P0-2：Git 暂存与提交安全

### 3.1 工具链

- `scripts/git/safe-stage.mjs`：只接受显式文件；拒绝 `-A` / `--all` / `.` / 目录 / glob；
  支持已跟踪文件删除；先 dry-run 再暂存；拒绝仓库外路径。
- `scripts/git/check-staged-files.mjs`：唯一策略实现；禁止草稿/环境文件/私钥/运行时目录；
  只扫描暂存新增行疑似凭据；支持 `--tree HEAD` 提交树路径检查。
- `.githooks/pre-commit`：真实提交前调用 checker。
- `.github/workflows/ci.yml`：安装依赖前执行 `--tree HEAD`，兜底漏装 hook 的干净克隆。
- `docs/DEVELOPMENT_WORKFLOW.md`：安装、使用、禁止绕过、CI 边界。

### 3.2 Windows 根因与修复

hook 已执行，但 checker 主入口判断使用 `new URL(import.meta.url).pathname`。
Windows 下该值为 `/C:/...`，与 `process.argv[1]` 的 `C:\...` 不相等，导致检查逻辑静默跳过。
改用 Node 官方 `fileURLToPath()` 后，正常提交显示检查输出，草稿提交被拦截且 HEAD 不前进。

### 3.3 验证

真实临时 Git 仓库覆盖：显式暂存、删除暂存、无差别暂存拒绝、禁止文件拒绝、
hook 正向放行、hook 负向拦截、CI 提交树模式、文档/工作流接线，共 7/7。

## 四、P1-1：单实例连续运行观测

### 4.1 工具

`scripts/soak/single-instance.mjs`：

- 应用身份：`/api/admin/ops` 的 `instanceId/pid/startedAt/uptimeSeconds`；
- OS 身份：Linux boot ID + proc start ticks；Windows StartTime；macOS `ps lstart`；
- 探针：ready、首页、ops、DB/Redis/PostgreSQL、进程 RSS/CPU 时间；
- 数据指纹：`users/topics/replies` 全行确定性 MD5；
- 备份恢复：`pg_dump` → 随机临时库 → `pg_restore` → 指纹比对 → 清理；
- 证据：`summary.json` + `samples.jsonl`；未知资源为 `null`，不伪装成 0。

### 4.2 诚实状态机

- `pass` 仅允许同一实例连续 >= 24h、全部证据齐全且无失败；
- 时长不足或证据缺失：`not-completed` / exit 3；
- HTTP/依赖失败、漂移、指纹不一致、探针失败：`fail` / exit 1；
- 登录失败也落盘 `fail` 摘要，不产生“无证据的成功”。

### 4.3 工作流

`.github/workflows/soak-single-instance.yml` 仅手动触发，最长 330 分钟，job 超时 340 分钟。
`scripts/soak/run-workflow-segment.mjs` 用 Node 完成启动/等待/采样/清理，避免多行 shell。
分段结果以 `not-completed` 结束，step 预期非零，`if: always()` 仍上传证据。

### 4.4 当前结论

**24h 单实例连续验证仍未完成。** 本轮只证明工具链路、状态机与负向门禁可用。

## 五、P1-2：产品差距审查与追加 P0 修复

### 5.1 审查

- `scripts/audit/route-inventory.mjs` 从当前源码枚举 27 页面 / 74 API / 93 方法；
- 输出 JSON/Markdown 到 `docs/evidence/audit/`；
- `docs/PRODUCT_GAP_REVIEW_v0.0.18.md` 记录已实现能力、差距、权限抽样、视觉证据与优先级；
- 明确否定“搜索入口未挂载”“搜索分页丢 q”两项初判，避免重复开发。

### 5.2 追加 P0

审查发现公开软删内容可见性不一致，按安全缺陷修复：

- 新增纯模块 `src/lib/content-visibility.ts`：
  `PUBLIC_TOPIC_CONDITION = published AND deleted_at IS NULL`；
  `PUBLIC_REPLY_CONDITION = deleted_at IS NULL`；
- 修复会员最近回复、XNA、收藏列表、搜索/关注/Feed 等公共读取面；
- 修复收藏、投票、感谢、举报对不可见目标的写入校验；
- 修复 `loadLastRepliers()` 在最后回复已删时错误回退为楼主；
- 管理端 `includeDeleted/includeHidden` 显式例外保持不变；
- 正负向测试与静态护栏见 `docs/TEST_REPORT_v0.0.18.md`。

## 六、版本与发布边界

- 按 G-VER-01，代码与测试完成后才运行 `scripts/release/sync-version.mjs 0.0.18`。
- 版本载体从 0.0.17 同步到 0.0.18 只表示进入候选开发态，不是发布。
- 不创建 v0.0.18 Tag/Release/GHCR 正式标签，不继承 v0.0.17 发布授权。
- 不移动 Tag、不改写历史、不 force push、不修改已发布 Release。
- R-01 保持 `DEFERRED / A3`。

## 七、遗留项

- 24h 单实例连续运行：需授权的持久环境，当前 `not-completed`。
- 通知角标口径、回复锚点、API 文档覆盖、合法视觉参考、可访问性矩阵：见产品差距报告，留待后续版本。
- 本机 Docker daemon 不可用；真实 Docker 验证需 GitHub runner。
