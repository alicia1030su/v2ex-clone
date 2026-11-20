# v0.0.18 会话交接：工程治理 + 产品体验升级

> 分支：`feat/v0.0.18-governance`
> 基线：master `73b83061b3e36c81963fb8f0edee20673f019099`
> 日期：2026-11-20
> **状态：研发候选，未发布、无发布授权。**

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

- v0.0.17 一次性公开发布授权**不延续**到 v0.0.18。
- 不创建 v0.0.18 Tag/Release/GHCR 正式标签。
- 不改写历史、force push、移动 Tag 或修改已发布 Release。
- R-01 保持 `DEFERRED / A3`。
- 24h 单实例连续运行保持 `not-completed`。

## 四、验证结论

- 完整单元回归：**86 文件 / 1034 用例通过**，0 failed / 0 skipped。
- 全量静态：**41 文件 / 466 用例通过**。
- 内容可见性真库：**8/8 通过**。
- TypeScript、API 契约、Next.js 生产构建、发布预演与 v0.0.17 一致性检查通过。
- 24h 单实例连续运行仍为 `not-completed`。

## 五、下一步

1. 同步版本载体到 `0.0.18`（代码与测试已完成）。
2. 在同步后的提交上重跑关键门禁。
3. 推送分支、开 PR、合并；不触发发布。
