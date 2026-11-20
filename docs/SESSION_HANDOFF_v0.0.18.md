# v0.0.18 会话交接：工程治理 + 产品体验升级

> 分支：`release/v0.0.18-stable`
> 基线：master `d1d66fbe0636330085e8592e821968247cd49500`
> 日期：2026-11-20
> **状态：已获一次性 Stable Release 授权，发布门禁执行中。**

## 一、当前完成项

- P0-1 发布渠道单一事实来源与消费者迁移。
- P0-2 Git 显式暂存、pre-commit、CI 提交树门禁与 Windows 主入口修复。
- P1-1 单实例连续观测工具、Node 分段启动器、手动 workflow 与证据格式。
- P1-2 当前源码路由枚举、产品/权限/视觉差距审查。
- 追加 P0 公共内容软删/隐藏可见性治理。

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

- HEAD：`9893946`（最终代码与版本载体提交；本交接文档随后单独提交）。
- 完整单元回归：**86 文件 / 1036 用例通过**，0 failed / 0 skipped。
- 全量静态：**41 文件 / 468 用例通过**。
- 内容可见性真库：**8/8 通过**。
- TypeScript、API 契约、Next.js 生产构建、发布预演与 v0.0.17 一致性检查通过。
- 24h 单实例连续运行仍为 `not-completed`。

## 五、授权边界与 Go/No-Go

- **授权边界**：v0.0.18 已获一次性 A3 + B1 授权；仅覆盖本版 Stable Release。
- **Go/No-Go**：只有全部门禁、候选安装、升级/恢复和发布预演通过后才允许创建 Tag。
- R-01 保持 `DEFERRED / A3`；24h 保持 `not-completed`。

## 六、下一步

1. 修复版本切换后的静态护栏并重跑全量门禁。
2. 在最终提交上重跑关键测试。
3. 推送分支、开 PR、合并；不触发发布。
