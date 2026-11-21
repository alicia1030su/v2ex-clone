# v0.0.18 会话交接：工程治理 + 产品体验升级

> 发布分支：`release/v0.0.18-stable` → `fix/v0018-official-upgrade` → `fix/v0018-release-notes-digest`
> HEAD（正式 Tag 目标 commit）：`be0831cec0ba24d80740a941f04916b51146c524`
> 日期：2026-11-20（UTC）
> **状态：已正式公开发布为 Stable Release（`draft=false`、`prerelease=false`、Latest）。**

## 一、当前完成项

- P0-1 发布渠道单一事实来源与消费者迁移。
- P0-2 Git 显式暂存、pre-commit、CI 提交树门禁与 Windows 主入口修复。
- P1-1 单实例连续观测工具、Node 分段启动器、手动 workflow 与证据格式。
- P1-2 当前源码路由枚举、产品/权限/视觉差距审查。
- 追加 P0 公共内容软删/隐藏可见性治理。
- 发布链路修复：Draft 幂等转公开、annotated Tag 门禁、构建输入白名单、Release Notes 外置渲染。
- 修正 Release Notes 的 digest 导出作用域，并新增真实子进程环境探针。
- 修正发布后验收解析器工作目录，并新增静态护栏。
- 新增官方公开资产 v0.0.17 → v0.0.18 升级验收工作流。

## 二、正式发布事实

| 项 | 值 |
|---|---|
| Tag | `v0.0.18`（annotated；tag 对象 `d593436fbcc19c1539f434c4cfe0c6ba5c569065`） |
| Tag 目标 commit | `be0831cec0ba24d80740a941f04916b51146c524` |
| Release | [Stable / Latest](https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.18)，id `453305532` |
| GHCR | `ghcr.io/alicia1030su/v2ex-clone:v0.0.18`（linux/amd64） |
| 镜像 Digest | `sha256:95f7725bb94a201fb3e797dcce39d61cfe057bc4001c0c71f4e5b85e758baeb3` |
| 部署 ZIP | `v2ex-clone-v0.0.18-deploy.zip`（144,346 B） |
| ZIP SHA256 | `f31625827393f936e3f9b1429997ffa18886420ba08f53e66e0ae55e17279588` |
| 发布流水线 | 首次 Tag run `44831729786` 在 Release Notes 步骤失败且未创建 Release；修复后幂等补救 run `44838838391` 全绿 |
| 发布后匿名验收 | run `44842628787`：13 项 / 0 FAIL / 1 已披露 WARN |
| 官方包四角色 | run `44840648812`：30 PASS / 0 FAIL |
| 官方公开资产升级 | run `44840653969`：10 PASS / 0 FAIL，13 行指纹逐字节一致 |

## 三、关键文档

- 路线图：`docs/ROADMAP_v0.0.18.md`
- 实施：`docs/IMPLEMENTATION_REPORT_v0.0.18.md`
- 测试：`docs/TEST_REPORT_v0.0.18.md`
- 发布事实：`docs/release-facts.json`
- 缺陷与风险：`docs/DEFECT_RISK_REGISTER_v0.0.18.md`
- 产品差距：`docs/PRODUCT_GAP_REVIEW_v0.0.18.md`
- 长跑工具：`docs/SOAK_SINGLE_INSTANCE.md`
- 开发工作流：`docs/DEVELOPMENT_WORKFLOW.md`
- 路由证据：`docs/evidence/audit/route-inventory-v0.0.18.{json,md}`

## 四、发布边界

- 项目所有者已于 2026-11-20 对 v0.0.18 单独作出 A3 + B1 裁决，授权 Stable Release；记录见 `docs/RISK_DECISION_v0.0.18.md`。
- 授权仅覆盖 v0.0.18，一次性；不延续到其它版本。
- 不改写历史、force push、移动 Tag 或修改已发布 Release。
- R-01 保持 `DEFERRED / A3`。
- 24h 单实例连续运行保持 `not-completed`。

## 五、当前测试基线

- 完整单元回归：**87 文件 / 1056 用例通过**，0 failed / 0 skipped（run `44823003971`）。
- 全量静态：**42 文件 / 485 用例通过**。
- E2E：**283/283 通过**；跨浏览器 **15/15 通过**。
- 双基线升级：v0.0.4 / v0.0.17 → v0.0.18，PASS=20 / FAIL=0，46 项业务指纹逐字节一致。
- 官方包四角色：**30 passed / 0 failed**。
- 官方公开资产升级：**10/10 通过**。
- 1 小时 soak：真实 **1h1m3s** 通过；24h 仍为 `not-completed`。
- TypeScript、API 契约、Next.js 生产构建、Trivy、发布预演与发布后一致性检查全部通过。

## 六、授权边界与 Go/No-Go

- **授权边界**：v0.0.18 已获一次性 A3 + B1 授权；仅覆盖本版 Stable Release。
- **Go/No-Go**：全部门禁、候选安装、升级/恢复、发布预演和发布后独立验收均已通过，正式发布完成。
- R-01 保持 `DEFERRED / A3`；24h 保持 `not-completed`。

## 七、后续事项

1. R-01 仍为长期 DEFERRED；保留历史 + 披露不等于取得第三方素材授权。
2. 24 小时单实例连续运行仍未完成，不得把 1 小时 soak 或分段累计写成 24 小时通过。
3. 未来版本必须重新取得单独授权，并重新执行完整发布门禁。
