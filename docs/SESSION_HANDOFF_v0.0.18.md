# v0.0.18 会话交接：工程治理 + 产品体验升级

> 分支：`release/v0.0.18-stable`
> HEAD（代码基线）：`dee31560191f31c1b6652442168921162e8c6dad`（本交接提交只更新证据文档）
> 日期：2026-11-20
> **状态：已获一次性 Stable Release 授权，发布门禁执行中。**

## 一、当前完成项

- P0-1 发布渠道单一事实来源与消费者迁移。
- P0-2 Git 显式暂存、pre-commit、CI 提交树门禁与 Windows 主入口修复。
- P1-1 单实例连续观测工具、Node 分段启动器、手动 workflow 与证据格式。
- P1-2 当前源码路由枚举、产品/权限/视觉差距审查。
- 追加 P0 公共内容软删/隐藏可见性治理。
- 发布链路修复：Draft 幂等转公开、annotated Tag 门禁、构建输入白名单、Release Notes 外置渲染。

## 二、关键文档

- 路线图：`docs/ROADMAP_v0.0.18.md`
- 实施：`docs/IMPLEMENTATION_REPORT_v0.0.18.md`
- 测试：`docs/TEST_REPORT_v0.0.18.md`
- 缺陷与风险：`docs/DEFECT_RISK_REGISTER_v0.0.18.md`
- 产品差距：`docs/PRODUCT_GAP_REVIEW_v0.0.18.md`
- 长跑工具：`docs/SOAK_SINGLE_INSTANCE.md`
- 开发工作流：`docs/DEVELOPMENT_WORKFLOW.md`
- 路由证据：`docs/evidence/audit/route-inventory-v0.0.18.{json,md}`

## 三、发布边界

- 项目所有者已于 2026-11-20 对 v0.0.18 单独作出 A3 + B1 裁决，授权 Stable Release；记录见 `docs/RISK_DECISION_v0.0.18.md`。
- 实际 Tag / Release / GHCR 结果必须以发布流水线和匿名核验为准。
- 不改写历史、force push、移动 Tag 或修改已发布 Release。
- R-01 保持 `DEFERRED / A3`。
- 24h 单实例连续运行保持 `not-completed`。

## 四、当前测试基线

- 完整单元回归：**87 文件 / 1055 用例**；新增官方公开资产升级护栏 9 条本地已通过，最终 SHA CI 复核中。
- 全量静态：**42 文件 / 484 用例**；新增 9 条本地已通过。
- E2E：**283/283 通过**；跨浏览器 15 个分片以最终 run 结论为准。
- 双基线升级：v0.0.4 / v0.0.17 → v0.0.18，PASS=20 / FAIL=0，46 项业务指纹逐字节一致。
- 候选包四角色验收：**30 passed / 0 failed**；最终 SHA 在 Tag 前显式重跑。
- TypeScript、API 契约、Next.js 生产构建、Trivy、发布预演与 v0.0.18 一致性检查通过。
- 24h 单实例连续运行仍为 `not-completed`。

## 五、授权边界与 Go/No-Go

- **授权边界**：v0.0.18 已获一次性 A3 + B1 授权；仅覆盖本版 Stable Release。
- **Go/No-Go**：只有全部门禁、候选安装、升级/恢复和发布预演通过后才允许创建 Tag。
- R-01 保持 `DEFERRED / A3`；24h 保持 `not-completed`。

## 六、下一步

1. 等待最终证据提交触发的 1 小时 soak 与全部 CI 完成。
2. 在最终 master SHA 上显式重跑候选安装、四角色验收与发布预演。
3. 合并 PR #76，固定最终完整 SHA，执行发行前一致性门禁。
4. 创建并推送一次 annotated `v0.0.18` Tag，监控正式发布工作流。
5. 使用正式 Release 资产做全新 runner 独立验收，并触发 `official-upgrade.yml` 的 v0.0.17 → v0.0.18 官方包真实升级验收。
6. 回填发布态文档、真实 Tag / Release / Digest / ZIP SHA256 与最终交付报告。
