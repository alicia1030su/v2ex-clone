# v0.0.18 测试报告

> 分支：`release/v0.0.18-stable`
> 代码基线：`dee31560191f31c1b6652442168921162e8c6dad`（本报告提交只更新证据文档）
> 日期：2026-11-20
> 原则：0 条用例、跳过用例、未采到数据都不得当作成功；24h 未完成必须保持 `not-completed`。

## 一、当前已执行

| 套件 | 命令 / 证据 | 结果 |
|---|---|---|
| 完整单元回归（含静态） | GitHub Actions CI run `44786766870` | **86 文件 / 1046 用例通过，0 failed / 0 skipped** |
| 全量静态 | 同 CI run 的「静态测试」步骤 | **41 文件 / 470 用例通过** |
| E2E（Chromium） | 同 CI run 的 E2E job | **283 passed / 0 failed / 0 skipped** |
| 跨浏览器矩阵 | GitHub Actions run `44786767021` | Chromium / Firefox / WebKit × 5 视口；最终以 run 结论为准 |
| Docker / Redis 隔离验证 | GitHub Actions run `44786766802` | 九项验证通过，含 Trivy CRITICAL / HIGH 阻断 |
| 安装验证 | GitHub Actions run `44786766936` | Linux 真实 Docker 安装、Windows PS 5.1 / Git Bash 均通过 |
| Host Header 安全审计 | GitHub Actions run `44786766919` | 通过 |
| SMTP 连续稳定性 | GitHub Actions run `44786766813` | 30 次全流程通过 |
| 双基线升级与恢复 | 同 CI run 的升级 job | v0.0.4 / v0.0.17 → v0.0.18：PASS=20 / FAIL=0；46 项业务指纹逐字节一致；恢复库指纹一致 |
| 候选安装链路 | GitHub Actions run `44777541932` | 运行时等价代码基线通过；最终 SHA 在 Tag 前显式重跑 |
| 候选包四角色验收 | GitHub Actions run `44777541811` | **30 passed / 0 failed**；含恢复失败原子性 |
| 内容可见性真库 | `tests/v018-content-visibility.spec.ts` | **8/8 通过**（真实 PostgreSQL 55440 隔离库） |
| TypeScript | `tsc --noEmit` | 通过 |
| 前后端 API 契约 | `node scripts/ui-verify.cjs` | 后端 91 路由 / 前端 37 调用，全部匹配 |
| 生产构建 | `next build` | 通过；27 页面 + 91 后端路由正常产出 |
| 发布预演 static | `preflight-dryrun.mjs --mode=static` | **23/23 通过** |
| 发布预演 notes | `preflight-dryrun.mjs --mode=notes` | **20/20 通过**，直接执行真实 Notes 渲染脚本 |
| v0.0.18 发行一致性 | `verify-release-consistency.sh --expect 0.0.18` | **PASS=19 / FAIL=0** |
| 生产依赖审计 | `npm audit --omit=dev --audit-level=moderate` | **0 漏洞** |
| 镜像漏洞扫描 | Trivy CRITICAL / HIGH | 通过；运行层已移除全局 npm/npx，esbuild 链升级到 0.28.2 |

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

- 1 小时持续运行：已在 v0.0.18 运行时基线上通过；最终证据提交会再次自动触发。
- 工具短时真实运行：`status=not-completed`、`claim24h=false`、退出码 3。
- 实例漂移：`status=fail`、退出码 1。
- HTTP 503：`status=fail`、退出码 1。
- 数据指纹不一致：`status=fail`、退出码 1。
- 登录失败：落盘 `fail` 摘要，样本数 0。
- **24h 单实例连续运行：not-completed。** 合成时钟测试只验证判定逻辑，不代表真实完成 24h。

## 四、已知边界

- 本轮未重新采集 v0.0.18 的 12 类视觉页面快照；`release-facts.json` 的 `visual` 小节仍明确标为
  v0.0.10 历史快照，不作为当前结论。
- 本机 Docker daemon 不可用，真实 Docker 验证由 GitHub ubuntu runner 完成。
- 路由权限枚举为静态启发式，运行授权由真库与 E2E 拒绝路径另行验证。
- 24 小时单实例连续运行仍未完成，不得把 1 小时冒烟或分段累计写成 24 小时通过。
