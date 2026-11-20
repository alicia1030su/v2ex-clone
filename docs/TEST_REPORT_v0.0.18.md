# v0.0.18 测试报告

> 分支：`feat/v0.0.18-governance`
> 日期：2026-11-20
> 原则：0 条用例、跳过用例、未采到数据都不得当作成功；24h 未完成必须保持 `not-completed`。

## 一、当前已执行

| 套件 | 命令 | 结果 |
|---|---|---|
| 发布渠道 | `vitest ... tests/static/v018-release-channel.spec.ts` | 8/8 通过（含冲突/通配/缺失/非法值负向对照） |
| Git 暂存安全 | `vitest ... tests/static/v018-git-staging-safety.spec.ts` | 8/8 通过（真实 Git 仓库、hook 正负向、CI 树模式） |
| 单实例长跑工具 | `vitest ... tests/static/v018-soak-tool.spec.ts` | 9/9 通过（真实进程采样、mock HTTP、漂移/HTTP/指纹负向） |
| 路由枚举 | `vitest ... tests/static/v018-route-inventory.spec.ts` | 3/3 通过（真实源码 + 合成目录 + CLI 负向） |
| 内容可见性真库 | `vitest run tests/v018-content-visibility.spec.ts --maxWorkers=1` | 8/8 通过（真实 PostgreSQL 55440 隔离库） |
| 全量静态 | `vitest run --config vitest.static.config.ts --maxWorkers=2` | 41 文件 / 468 用例通过 |
| **完整单元回归** | `vitest run --maxWorkers=1`（隔离 PG 55440） | **86 文件 / 1036 用例通过，0 failed / 0 skipped** |
| TypeScript | `tsc --noEmit` | 通过 |
| 工作流 YAML | `yaml.parse` | `ci.yml` / `soak-single-instance.yml` 通过 |
| 前后端 API 契约 | `node scripts/ui-verify.cjs` | 后端 91 路由 / 前端 37 调用，全部匹配 |
| 生产构建 | `next build`（隔离测试环境变量） | 通过；27 页面 + 91 后端路由正常产出 |
| 发布预演 static | `node scripts/release/preflight-dryrun.mjs --mode static` | 21/21 通过 |
| 发布预演 notes | `node scripts/release/preflight-dryrun.mjs --mode notes` | 17/17 通过 |
| v0.0.17 已发布一致性 | `bash scripts/release/verify-release-consistency.sh --expect 0.0.17` | PASS=21 / FAIL=0 |
| v0.0.18 候选一致性 | `bash scripts/release/verify-release-consistency.sh --expect 0.0.18` | PASS=20 / FAIL=0 |
| 最终提交树路径 | `node scripts/git/check-staged-files.mjs --tree HEAD` | 741 个文件通过 |

## 二、隐私修复回归

- 真库测试：`tests/v018-content-visibility.spec.ts`，8/8 通过。
- 覆盖：正常内容可读/可互动；软删主题从公共列表、详情、搜索、联想、关注流、Feed、通知、
  会员页、XNA、收藏中消失；软删回复正文与最后回复者回退被过滤；
  举报人自己的历史反馈保留目标标题/回复片段，但不进入任何公共读取面；
  隐藏节点不可互动；`includeDeleted` / `includeHiddenNode` 管理入口保持显式开放。
- 每个负面断言前直接查库证明原始行仍存在，避免“数据没写入”假绿。
- 既有回归 `content-lifecycle`、`feed-search`、`v014-node-visibility`、
  `v015-notifications-db`、`v016-last-replier`、`v017-search-pagination` 全部通过。
- `vitest.config.ts` 增加 Oxc `{ jsx: { runtime: 'automatic' } }`，用于直接渲染 Server Component 页面；
  未改变任何测试断言或超时门槛。

## 三、长跑结论

- 工具短时真实运行：`status=not-completed`、`claim24h=false`、退出码 3。
- 实例漂移：`status=fail`、退出码 1。
- HTTP 503：`status=fail`、退出码 1。
- 数据指纹不一致：`status=fail`、退出码 1。
- 登录失败：落盘 `fail` 摘要，样本数 0。
- **24h 单实例连续运行：not-completed。** 合成时钟测试只验证判定逻辑，不代表真实完成 24h。

## 四、已知边界

- 本轮未重新采集 E2E/视觉全量截图；不得引用历史数字作为 v0.0.18 当前结论。
- 本机 Docker daemon 不可用，真实 Docker 验证需 GitHub runner。
- 路由权限列为静态启发式，不等于运行授权证明。
