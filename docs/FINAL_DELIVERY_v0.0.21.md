# v0.0.21 最终交付报告

> 结论：**候选工程交付完成，正式发布 NO-GO**。
> 冻结 HEAD：`a704b9aea3e245e0c9b200df342260250a5ad05b`
> 分支：`release/v0.0.21-stable`
> 工作树：`C:/Users/TYMO001/WorkBuddy/ai/_worktrees/v0021-release`
> 基线：`master = 872ae726c84d755f81e2b8477f34eeb025cb889b`
> 版本载体：`0.0.20`（未同步为 `0.0.21`）
> 当前正式最新 Release：`v0.0.19`

## 1. TL;DR

- 本版已交付低内存资源守护、540 条视觉矩阵与 before/after 证据、视觉/可访问性改造、15 条交互契约、95 条视觉契约、Next dev 运行时修复及候选冻结报告。
- 最终候选在 Node 22.23.4 下通过 TypeScript、104 文件 Vitest、生产构建、dev/production smoke 与 110 条目标 E2E；资源报告 schema 44/44 通过。
- **不能发布**：QA-03 数量基线缺失且非 static 685 < 1122；完整 CI/296 Chromium/15 跨浏览器/41 候选包未跑；MEM-08/09 总体未完成；540 条视觉记录全部 `UNVERIFIED`（360 条 P0）；R-01 仍为 `DEFERRED`；无 v0.0.21 专属 A3/B1；24h soak 未执行；存在 1 个既有 Windows 条件跳过。
- 未创建 Tag、未推送正式 GHCR、未创建 Release、未生成 v0.0.21 正式 ZIP/digest、未推 master。候选构建成功不等于正式发布成功。

## 2. 交付概览

| 领域 | 已交付 | 结果边界 |
|---|---|---|
| 产品与架构 | `docs/PRD_v0.0.21.md`、`docs/ARCHITECTURE_v0.0.21.md`、类图/时序图 | 明确目标 A/B 同级、范围、证据与发行边界 |
| 低内存工具 | `tools/dev-memory/` 的 preflight/monitor/cleanup/run/benchmark、5 个 JSON Schema、低内存入口 | 工具实现与独立 QA 完成；性能验收未整体完成 |
| 视觉审计 | 18 类页面 × 5 视口 × 六层 = 540 条矩阵；before/after 证据 | 内部差距已治理；官方视觉一致性仍 `UNVERIFIED` |
| 视觉与可访问性 | 主题行、布局 token、搜索、表单标签、焦点环、对比度、移动端与右栏 | 内部契约通过，不宣称官方像素一致 |
| 交互契约 | 15 条真实浏览器交互用例 | 15/15 通过 |
| 视觉契约 | 95 条布局、可访问性与运行时噪声用例 | 95/95 通过 |
| 运行时修复 | instrumentation/worker 依赖拆分、存储模块拆分、`getBuiltinModule` | dev/production health 均 200 |
| 候选冻结 | `docs/CANDIDATE_FREEZE_v0.0.21.md` | 正式发行 **No-Go** |

关键提交链：`01f834b`（QA 清理）→ `bb6beea`（资源守护）→ `e50f779`（视觉审计）→ `3d88b56`（视觉改造）→ `a121fda`（交互测试）→ `ba5aa0e`（验收报告）→ `6094160`（dev 运行时修复）→ `c6cbcdc`（全量可移植性修正）→ `a704b9a`（No-Go 冻结）。

## 3. 文件与证据清单

### 3.1 产品、架构与报告

- `docs/PRD_v0.0.21.md`
- `docs/ARCHITECTURE_v0.0.21.md`
- `docs/class-diagram.mermaid`
- `docs/sequence-diagram.mermaid`
- `docs/sequence-diagram-lifecycle.mermaid`
- `docs/WORKBUDDY_MEMORY_BASELINE_v0.0.21.md`
- `docs/DEV_MEMORY_v0.0.21.md`
- `docs/MEMORY_BENCHMARK_v0.0.21.md`
- `docs/VISUAL_FIDELITY_MATRIX_v0.0.21.md`
- `docs/VISUAL_CHANGELOG_v0.0.21.md`
- `docs/INTERACTION_ACCEPTANCE_v0.0.21.md`
- `docs/CANDIDATE_FREEZE_v0.0.21.md`

### 3.2 实现与测试入口

- 资源守护：`tools/dev-memory/`
- 视觉矩阵与审计：`tools/visual/v021/`
- 低内存入口：`build:low`、`dev:low`、`test:unit:low`、`test:e2e:low`、`visual:audit:low`
- 低内存配置：`vitest.low.config.ts`、`playwright.low.config.ts`
- 双平台资源守护 workflow：`.github/workflows/dev-memory.yml`
- 视觉/交互契约：`e2e/v021-visual-contract.spec.ts`、`e2e/v021-interaction-contract.spec.ts`
- 资源守护测试：`tests/dev-memory/`、`tests/static/v021-dev-memory-guards.spec.ts`
- 视觉矩阵静态门禁：`tests/static/v021-visual-matrix.spec.ts`
- 全局设计 token：`src/app/tokens.css`

### 3.3 原始证据

- 最终候选汇总：`docs/evidence/v0.0.21/candidate/summary.json`
- Vitest：`docs/evidence/v0.0.21/candidate/vitest-final/`
- 生产构建：`docs/evidence/v0.0.21/candidate/build/`
- dev smoke：`docs/evidence/v0.0.21/candidate/dev4/`
- production smoke/E2E：`docs/evidence/v0.0.21/candidate/production/`
- 资源 schema：`docs/evidence/v0.0.21/candidate/schema-validation.json`
- 内存基准：`docs/evidence/v0.0.21/memory/benchmark/`、`docs/evidence/v0.0.21/memory/benchmark-supplemental-remaining/`
- 交互契约：`docs/evidence/v0.0.21/interaction/results.json`、`summary.json`
- 视觉契约：`docs/evidence/v0.0.21/visual-contract/results.json`、`summary.json`
- 视觉矩阵：`docs/evidence/visual/v0.0.21/fidelity-matrix.json`、`before/`、`after/`、`reference-manifest.json`

## 4. 测试矩阵

| 门禁 | 结果 | 实测 |
|---|---|---|
| TypeScript `--noEmit` | PASS | Node 22.23.4 |
| 全量 Vitest（含 static） | PASS（执行） / QA-03 FAIL（数量门槛） | 104 files；1197 passed / 0 failed / 1 skipped / 1198 total |
| static 数量 | PASS | 513，高于下限 501 |
| 非 static 数量 | **FAIL / not-completed** | 685，低于下限 1122；`scripts/ci/baseline-v0.0.20.json` 缺失 |
| 生产构建 | PASS | exit 0；peak tree 1137.9 MiB；wall 57.862s |
| dev smoke | PASS | health 200、admin login 200、instrumentation delta 6、purge interval 1、duplicate 0 |
| production smoke | PASS | health 200 |
| 生产目标 E2E | PASS | visual 95 + interaction 15 = 110/110，0 failed / 0 skipped |
| 最终资源 schema | PASS | 44/44 |
| 交互验收阶段资源 schema | PASS | 210/210 |
| MEM-08/09 `next-build` | completed | before peak median 2317.9 MiB → after peak max 1118.8 MiB；wall 53.98s → 51.60s |
| MEM-08/09 其它场景 | **not-completed** | next-dev、Vitest、playwright-dev、playwright-production 未形成有效通过基准 |
| 官方视觉一致性 | **FAIL / UNVERIFIED** | 540/540 UNVERIFIED，其中 360 P0 |
| 完整 CI | **not-completed** | 未跑全部 workflow、296 Chromium、15 跨浏览器分片、41 候选包 |
| 24h soak | **not-completed** | 未执行 |
| 发行授权 | **FAIL** | 无 v0.0.21 专属 A3/B1 |

## 5. 失败、跳过与未执行

### 5.1 失败与修正

- 首轮全量 Vitest 有 4 个失败：protected-slot 未适配 `snapshotDirectChild`、Windows tar 路径处理、SHA sidecar 转义、reply-image 静态断言未跟随存储模块拆分。`c6cbcdc` 修正后，定向与全量 Vitest 均通过。
- 首次 dev smoke 的 `.env.test` 相对路径 source 与探针解析问题属于 QA 装置问题；最终 `dev4` 通过。
- MEM 主基准保留全部失败样本：next-dev 6/6 readiness 失败；Vitest 6/6 因视觉 fixture 缺失失败；playwright-dev 6/6 readiness 失败；playwright-production 6/6 因 per-sample dist 配置错误失败。补充基准修正装置后，Vitest 与 Playwright production 峰值仍未下降，next-dev 仍未形成有效 before/after。

### 5.2 跳过

- 唯一跳过：`tests/v020-upload-migration.spec.ts:61`，既有 `skipIf(process.platform === 'win32')` 的 legacy symlink 用例；本版未新增跳过。
- 生产目标 E2E：0 skipped。

### 5.3 未执行

- 完整 GitHub Actions / 全部 workflow。
- Chromium E2E 全量 296 条下限。
- 三浏览器 15 个跨视口分片。
- 候选包四角色 41 项。
- 真实 Linux 容器清理。
- 24h 单实例连续 soak。
- 正式 Tag、GHCR、Release 与正式 ZIP 发行。

## 6. Go / No-Go 与阻断

**候选工程交付：GO（仅保留为未发布候选）。**

**正式发布：NO-GO。**

阻断项：

1. QA-03 机器基线缺失，非 static 685 < 1122。
2. QA-04 完整 CI 与全量测试矩阵未执行。
3. MEM-08/09 总体 `not-completed`；仅 `next-build` 形成有效前后对照。
4. 540 条视觉记录全部 `UNVERIFIED`，其中 360 条 P0；内部差距 A231→A0 不等于官方视觉通过。
5. R-01 保持 `DEFERRED`。
6. v0.0.21 专属 A3/B1 授权不存在。
7. 24h soak 未执行。
8. 1 个既有 Windows 条件跳过需继续披露。

## 7. 发行边界

本次只读核验结果：

| 项 | 状态 |
|---|---|
| 远端 `master` | `872ae726c84d755f81e2b8477f34eeb025cb889b`，未推进 |
| 远端 `release/v0.0.21-stable` | `a704b9aea3e245e0c9b200df342260250a5ad05b` |
| `v0.0.21` Tag | 不存在 |
| v0.0.21 Release | API 404 |
| GHCR `:v0.0.21` | manifest 404；对照 `:v0.0.19` 为 200 |
| 当前正式最新 Release | `v0.0.19` Stable |
| 版本载体 | `package.json` / `package-lock.json` / `deploy/VERSION` / 部署镜像默认值 / `release-facts.version` 均为 `0.0.20` |
| `docs/RISK_DECISION_v0.0.21.md` | 不存在；A3/B1 未取得 |
| R-01 | `DEFERRED` |
| 24h soak | `not-completed` |
| 正式 ZIP / GHCR digest | 未生成 |

本报告提交仅新增交付文档，不改变版本载体、Tag、Release、GHCR 或 master。

## 8. 下一步建议

1. **恢复 QA-03 单一事实源**：补齐并核验 `scripts/ci/baseline-v0.0.20.json`，按真实测试归属解释 1122/685 差距；不得下调门槛或用 static 增长抵扣。
2. **跑完整 CI 矩阵**：在冻结候选上执行全部 workflow、296 Chromium、15 跨浏览器分片与 41 项候选包四角色验收，并保留全部失败/跳过证据。
3. **完成 MEM-08/09**：修复 next-dev 启动与基准装置，为 Next/Vitest/Playwright 建立有效 3×2 同条件前后样本；Vitest 与 Playwright production 必须出现真实峰值下降。
4. **关闭视觉 P0 阻断**：取得合法官方参考或由项目所有者明确调整范围；540 条记录按证据逐项转正，未取得参考的项继续保持 `UNVERIFIED`，不得宣称视觉百分比。
5. **再评估发行**：在完整门禁、24h 状态和 v0.0.21 专属 A3/B1 均明确后，才考虑同步 `0.0.21` 载体并进入 Tag/GHCR/Release；否则继续保持 No-Go。
