# v0.0.18 缺陷与风险清单

> 分支：`feat/v0.0.18-governance`
> 日期：2026-11-20
> 口径：只登记有代码/运行证据的问题；历史风险与当前缺陷分开。

## 一、当前缺陷

| ID | 级别 | 问题 | 证据 | 状态 | 后续 |
|---|---|---|---|---|---|
| D-01 | P0 | 公开发布面软删内容可见性不一致 | 会员最近回复、XNA、收藏、收藏/投票/感谢/举报目标校验、最后回复者回退 | **已修复** | 真库 8/8、全量单元 1036/1036、生产构建通过 |
| D-02 | P1 | 通知角标直接统计 notifications，未复用列表可见性条件 | `src/components/SiteNav.tsx` vs `src/server/notifications.ts` | **开放** | 复用 `listNotificationsForUser().unread`，补真库测试 |
| D-03 | P1 | 回复深链锚点混用 reply id / floor / repliesCount | `member/[username]/page.tsx`、`TopicItem.tsx`、`ReplyItem.tsx` | **开放** | 统一返回真实 floor，加删除楼层后的 E2E |
| D-04 | P1 | API_SPEC 覆盖落后于 74 个真实 API 路由 | `docs/evidence/audit/route-inventory-v0.0.18.json` | **开放** | 按模块补契约与权限点 |
| D-05 | P2 | `nodes_all` 视觉参考 INVALID，不能证明还原 | `FEATURE_MATRIX.md` §12.1 | **开放** | 取得合法新参考前保持 UNVERIFIED |
| D-06 | P2 | 可访问性缺系统化证据 | 现有探针无键盘/焦点/对比度/语义矩阵 | **开放** | 下一轮补专项检查 |

## 二、本轮已修复的工程缺陷

| ID | 问题 | 根因 | 修复 | 验证 |
|---|---|---|---|---|
| E-01 | 发布渠道规则复制到多个消费者，Stable Release 被判红 | 缺单一事实来源 | `RELEASE_CHANNELS.json` + `resolve-release-channel.mjs`；所有消费者调用解析器 | 解析器/消费者测试、发布预演、v0.0.17 一致性检查 |
| E-02 | `git add -A` 三次误提交 `.m` / `.msg2` / `.cm` | 只有 `.gitignore`，无暂存区门禁 | `safe-stage` + checker + pre-commit + CI 提交树检查 | 真实临时 Git 仓库正负向 7/7 |
| E-03 | Windows hook 执行但 checker 静默跳过 | `import.meta.url.pathname` 为 `/C:/...`，主入口比较失败 | 改用 `fileURLToPath(import.meta.url)` | hook 正向放行、负向拦截且 HEAD 不前进 |
| E-04 | 缺单实例连续观测工具，分段累计易被误读 | GitHub job 上限与证据格式缺失 | 双身份校验、指纹、备份恢复探针、诚实状态机 | 工具测试 9/9；24h 仍 not-completed |
| E-05 | 路由/权限/视觉文档与当前源码有时间差 | 旧快照未自动交叉核对 | 可复跑路由枚举 + 产品差距报告 | 路由测试 3/3；27/74/93 当前事实 |

## 三、长期风险

| ID | 状态 | 说明 |
|---|---|---|
| R-01 | **DEFERRED / A3** | 第三方素材历史可达性风险；保留历史 + 强化披露。技术清理不等于取得授权。 |
| R-02 | **OPEN** | 24h 单实例连续运行尚未完成；工具与分段 workflow 不能替代持久环境真实 24h。 |
| R-03 | **OPEN** | 本机 Docker daemon 不可用；依赖真实 Docker 的验证必须走 GitHub runner 或其它授权环境。 |
| R-04 | **OPEN** | API 契约文档覆盖率不足，新增端点存在漏测/漏文档风险。 |
| R-05 | **OPEN** | `nodes_all` 合法视觉参考缺失，该页视觉结论保持 UNVERIFIED。 |

## 四、发布边界

- v0.0.18 本轮**不自动发布**，不继承 v0.0.17 授权。
- 不创建 Tag/Release/GHCR 正式标签，不改写历史、force push、移动 Tag 或修改已发布 Release。
- R-01 不因本轮代码修复而改变状态。
