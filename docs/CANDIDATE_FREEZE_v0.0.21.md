# v0.0.21 候选冻结报告

> 结论：**No-Go**。
> 本报告只冻结验证事实，不创建 Tag、不改版本载体、不创建 Release、不推送正式 GHCR。
> 版本载体保持 `0.0.20`；R-01 保持 `DEFERRED`；24h soak 保持 `not-completed`。

## 1. 提交与运行边界

| 角色 | 提交 |
|---|---|
| 视觉/交互源码候选 | `3d88b56dba90a122556036b7f547074355bd248d` |
| Next dev 启动修复 | `6094160cc9781e9c5adf4365c94ac3918e411587` |
| QA 全量可移植性修正 | `c6cbcdcc65d500bd7a13bbd8170c9efbae92ca1c` |
| before 视觉/内存基线 | `e50f77988bd639823658bfcbe690643bf11d24cb` |

- 分支：`release/v0.0.21-stable`。
- 运行时：Node `v22.23.4`，指定绝对路径；Windows 11；Playwright 1.64.1；Edge/Chromium；单 worker。
- 数据库：既有隔离 PostgreSQL `127.0.0.1:55440/v2ex_test_base`；Redis 为空，走 PgKV。
- 所有 Next/Playwright/Vitest 重任务经 `tools/dev-memory/run.mjs`，串行执行。
- 生产构建目录：工作树内隔离 `.next-qa-final`；dev 目录：`.next-qa-final-dev`。

## 2. 候选门禁结果

| 门禁 | 结果 | 证据 |
|---|---|---|
| Git 工作树起始状态 | PASS，起始 `6094160` 干净 | 本报告提交前仅保留 QA 测试修正与证据 |
| TypeScript `--noEmit` | PASS | Node 22.23.4 |
| 全量 Vitest（含 static） | PASS，104 files / 1197 passed / 0 failed / 1 skipped | `candidate/vitest-final/`、`candidate/vitest-summary.json` |
| 生产构建 | PASS，exit 0 | `candidate/build/` |
| dev smoke | PASS，health 200、instrumentation delta 6、purge worker 每进程 1 次 | `candidate/dev4/dev-smoke.json` |
| production smoke | PASS，health 200 | `candidate/production/production-smoke.json` |
| 生产 E2E：visual 95 + interaction 15 | PASS，110/110，0 skipped | `candidate/production/e2e-results.json` |
| 资源报告 schema | PASS，44/44 | `candidate/schema-validation.json` |
| QA-03 数量下限 | **FAIL / not-completed** | baseline 文件缺失；非 static 685 < 1122 |
| QA-04 完整 CI | **not-completed** | 未运行全部 workflow、296 Chromium、15 跨浏览器分片、41 候选包 |
| MEM-08/09 | **not-completed** | 仅 next-build completed；其余见 `MEMORY_BENCHMARK_v0.0.21.md` |
| 官方视觉一致性 | **FAIL / UNVERIFIED** | 540/540 UNVERIFIED，其中 360 P0 |
| 发行授权 | **FAIL** | 无 `docs/RISK_DECISION_v0.0.21.md`，A3/B1 未取得 |
| 24h soak | **not-completed** | 未执行，不以短时 smoke 替代 |

## 3. 全量 Vitest 与数量下限

最终全量运行：

- Test Files：**104 passed / 0 failed**。
- Tests：**1197 passed / 0 failed / 1 skipped / 1198 total**。
- 唯一跳过：`tests/v020-upload-migration.spec.ts:61`，既有 `skipIf(process.platform === 'win32')` 的 legacy symlink 用例；未新增跳过。
- 监控：peak tree **579 MiB**、peak process **146.4 MiB**、P95 **357.7 MiB**、samples **511**、wall **254857 ms**、exit **0**、monitor errors **0**。

数量核对：

- static：**513**，高于 PRD 下限 501。
- 非 static：**685**，低于 PRD 单元下限 1122。
- `scripts/ci/baseline-v0.0.20.json` 在候选树中不存在，无法用机器可校验的单一事实源解释或豁免差距。
- 因此 QA-03 保持 **not-completed / No-Go**，不得用总用例数或 static 增长偷换分母。

## 4. 构建、dev 与 production smoke

### 生产构建

- exit **0**；peak tree **1137.9 MiB**；peak process **1042.4 MiB**；P95 **1026.0 MiB**；samples **117**；wall **57862 ms**；monitor errors **0**。

### dev smoke

- shell 显式 `source .env.test`，独立端口 `3330`。
- `/api/health/ready` **200**；admin 登录 **200**。
- instrumentation：`api.requests` 从 **3** 增至 **9**，delta **6**，对应 5 次 health + 1 次 ops-after；进程 `pid/instanceId` 保持一致。
- attachment purge：每进程 hourly interval **1** 次，duplicate processes **0**，runtime errors **0**。
- 监控：peak tree **1018.3 MiB**；wall **20216 ms**；exit **0**。

### production smoke 与 E2E

- `next start` 使用同一 `.next-qa-final` 构建，独立端口 `3331`；`/api/health/ready` **200**。
- `e2e/v021-visual-contract.spec.ts` **95/95**。
- `e2e/v021-interaction-contract.spec.ts` **15/15**。
- 合计 **110 passed / 0 failed / 0 skipped**，duration **88131.368 ms**。
- 监控：peak tree **1387.4 MiB**、peak process **248.3 MiB**、P95 **1319.7 MiB**、samples **188**、wall **93425.7 ms**、exit **0**、monitor errors **0**。

## 5. MEM-08/09 与视觉事实

- `next-build`：before peak median **2317.9 MiB** → after peak max **1118.8 MiB**；wall **53.98s → 51.60s**，结论 completed。
- `next-dev`：主基准 6/6 readiness 失败；补充 180s 仍失败。6094160 修复后 dev smoke 已通过，但不能替代 before/after 3×2，保持 not-completed。
- Vitest 补充 3×2：before peak median **584.4 MiB**，after peak max **595.2 MiB**，峰值未下降，not-completed。
- Playwright production 补充 3×2：before peak median **1284.9 MiB**，after peak max **1284.9 MiB**，峰值未下降，not-completed。
- 树 RSS 是进程 RSS 之和，会重复计算共享页，不称为 PSS。
- 视觉矩阵：540 条全部 `UNVERIFIED`，其中 360 条 P0；内部差距清零不等于官方像素通过。

## 6. 失败、跳过与未执行分列

### 失败（已修正后复跑）

- 首轮全量 Vitest 4 个失败：protected-slot 测试未适配 `snapshotDirectChild`；Windows tar 把 `C:` 当远程且反斜杠路径未转 POSIX；SHA sidecar 转义前缀；reply-image 静态断言未跟随存储模块拆分。
- 修正提交 `c6cbcdc` 后，定向用例与全量 Vitest 均通过。
- 首次 dev smoke 的 `.env.test` 相对路径 source 失败，以及探针日志格式/解析问题，均为 QA 装置问题；最终 `dev4` 通过。

### 跳过

- 1 个既有 Windows 条件跳过：`tests/v020-upload-migration.spec.ts:61`。
- 生产 E2E：0 skipped。

### 未执行

- 完整 GitHub Actions / 全部 workflow。
- Chromium E2E 全量 296 条下限（本轮只跑 110 条目标契约）。
- 跨浏览器 15 分片。
- 候选包四角色 41 项。
- 真实 Linux 容器清理。
- 24h 单实例 soak。
- 正式 Tag、GHCR、Release。

## 7. 发行阻断清单

1. QA-03 baseline 文件缺失，非 static 685 < 1122。
2. QA-04 完整 CI 与全量矩阵未执行。
3. MEM-08/09 总体 not-completed。
4. 540 条官方视觉记录 UNVERIFIED，360 P0 阻断。
5. R-01 `DEFERRED` 未解除。
6. v0.0.21 专属 A3/B1 授权不存在。
7. 24h soak 未执行。
8. 1 个既有 Windows 条件跳过需单独披露。

## 8. 证据索引

- 汇总：`docs/evidence/v0.0.21/candidate/summary.json`。
- Vitest：`docs/evidence/v0.0.21/candidate/vitest-final/`。
- 构建：`docs/evidence/v0.0.21/candidate/build/`。
- dev：`docs/evidence/v0.0.21/candidate/dev4/`。
- production/E2E：`docs/evidence/v0.0.21/candidate/production/`。
- schema：`docs/evidence/v0.0.21/candidate/schema-validation.json`。
- 既有内存基准：`docs/MEMORY_BENCHMARK_v0.0.21.md`。
- 既有交互验收：`docs/INTERACTION_ACCEPTANCE_v0.0.21.md`。
- 视觉记录：`docs/VISUAL_CHANGELOG_v0.0.21.md`。
