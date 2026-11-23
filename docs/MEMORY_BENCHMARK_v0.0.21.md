# v0.0.21 开发/生产内存基准报告

> 状态：主基准仅 `next-build` completed；其余场景 not-completed。补充基准单独列示，不覆盖主基准失败样本。
> 公式：`afterPeakMax < beforePeakMedian && afterWallMax <= beforeWallMedian × 1.3 + 30s && 六个样本全部有效`。
> 所有 Next/Playwright/Vitest 重任务均经 `tools/dev-memory/run.mjs`，串行执行；失败与 0 样本均保留。

## 1. 环境与同条件边界

- Node：`v22.23.4`，可执行文件 `C:\Users\TYMO001\AppData\Local\npm-cache\_npx\361c55be1121897e\node_modules\node\bin\node.exe`。
- before：`e50f77988bd639823658bfcbe690643bf11d24cb`，tree `7fd2a7bdf1d6dc5770efdf8af04cf8f902dabdf9`，独立 worktree + 独立 `npm ci`。
- after：`3d88b56dba90a122556036b7f547074355bd248d`，tree `16387172e33234eb0c40be54eb96124d5762dcbc`，独立 worktree + 独立 `npm ci`。
- 机器标识：`wb-246e8e89178a9816ea7e`；PostgreSQL `127.0.0.1:55440/v2ex_test_base`；Redis 空/PgKV。
- Playwright 固定 `e2e/v021-visual-contract.spec.ts` 95 条、Edge/Chromium、单 worker、相同端口/视口/URL；输出在系统临时目录。
- Next 构建目录使用工作树内隔离 `.next-qa-*`，不共享 before/after node_modules；未关闭 WorkBuddy 批量删除保护。
- warm-up：主基准与补充基准均为 0，before/after 使用相同冷启动策略。
- 依赖锁：before/after 工作树 `package-lock.json` SHA-256 均为 `7e5b1a9230a0b1699f5c35480271d56a998edde8ea3346d1af7409ddbe88c553`；Git blob SHA-256 均为 `468f7586cb1259a8a18e3f30d3c6e5237f6d8b8007fd17351cf8cb85297c9f12`。

## 2. 主基准汇总

| 场景 | before peak 中位数 MiB | after peak 最大 MiB | before wall 中位数 ms | after wall 最大 ms | 有效样本 | 结论 |
|---|---:|---:|---:|---:|---:|---|
| next-dev | 2186.4 | 1976.8 | 91968.3 | 92064.1 | 0/6 | not-completed |
| next-build | 2317.9 | 1118.8 | 53980.8 | 51601.4 | 6/6 | completed |
| vitest | 585.6 | 595.2 | 22916.3 | 24297.5 | 0/6 | not-completed |
| playwright-dev | 1951.3 | 2205.4 | 91977.3 | 92058.2 | 0/6 | not-completed |
| playwright-production | 196.5 | 132.1 | 1982.9 | 2670.1 | 0/6 | not-completed |

## 3. 主基准原始样本

### next-dev

| phase | run | peak tree MiB | peak process MiB | P95 tree MiB | samples | wall ms | exit | valid | commit |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| before | 1 | 2191.7 | 1980.2 | 2104.5 | 185 | 92045.2 | 1 | false | `e50f77988bd6` |
| before | 2 | 1915.7 | 1703.4 | 1908.7 | 185 | 91968.3 | 1 | false | `e50f77988bd6` |
| before | 3 | 2186.4 | 1973.6 | 2186.0 | 185 | 91925.8 | 1 | false | `e50f77988bd6` |
| after | 1 | 1976.8 | 1759.9 | 1966.3 | 185 | 92037.5 | 1 | false | `3d88b56dba90` |
| after | 2 | 1935.8 | 1719.9 | 1896.5 | 185 | 91811.3 | 1 | false | `3d88b56dba90` |
| after | 3 | 1957.1 | 1741.0 | 1904.3 | 185 | 92064.1 | 1 | false | `3d88b56dba90` |

### next-build

| phase | run | peak tree MiB | peak process MiB | P95 tree MiB | samples | wall ms | exit | valid | commit |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| before | 1 | 2297.7 | 843.6 | 1507.3 | 179 | 88849.0 | 0 | true | `e50f77988bd6` |
| before | 2 | 2336.5 | 963.3 | 1577.1 | 109 | 53980.8 | 0 | true | `e50f77988bd6` |
| before | 3 | 2317.9 | 972.0 | 1565.0 | 101 | 50212.9 | 0 | true | `e50f77988bd6` |
| after | 1 | 971.3 | 875.2 | 944.4 | 101 | 50207.1 | 0 | true | `3d88b56dba90` |
| after | 2 | 1118.8 | 1023.1 | 934.6 | 104 | 51601.4 | 0 | true | `3d88b56dba90` |
| after | 3 | 1074.2 | 979.1 | 923.1 | 102 | 50706.6 | 0 | true | `3d88b56dba90` |

### vitest

| phase | run | peak tree MiB | peak process MiB | P95 tree MiB | samples | wall ms | exit | valid | commit |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| before | 1 | 568.9 | 121.3 | 568.9 | 54 | 26369.4 | 1 | false | `e50f77988bd6` |
| before | 2 | 586.4 | 123.8 | 586.4 | 45 | 22172.8 | 1 | false | `e50f77988bd6` |
| before | 3 | 585.6 | 132.6 | 585.6 | 47 | 22916.3 | 1 | false | `e50f77988bd6` |
| after | 1 | 583.0 | 130.5 | 583.0 | 49 | 23943.2 | 1 | false | `3d88b56dba90` |
| after | 2 | 595.2 | 130.9 | 595.2 | 47 | 22739.3 | 1 | false | `3d88b56dba90` |
| after | 3 | 552.1 | 130.4 | 552.1 | 50 | 24297.5 | 1 | false | `3d88b56dba90` |

### playwright-dev

| phase | run | peak tree MiB | peak process MiB | P95 tree MiB | samples | wall ms | exit | valid | commit |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| before | 1 | 1957.1 | 1745.0 | 1913.2 | 185 | 92095.5 | 1 | false | `e50f77988bd6` |
| before | 2 | 1935.8 | 1724.4 | 1908.0 | 185 | 91977.3 | 1 | false | `e50f77988bd6` |
| before | 3 | 1951.3 | 1739.0 | 1901.6 | 185 | 91961.7 | 1 | false | `e50f77988bd6` |
| after | 1 | 1976.8 | 1759.0 | 1902.0 | 185 | 92058.2 | 1 | false | `3d88b56dba90` |
| after | 2 | 1959.0 | 1741.7 | 1906.2 | 185 | 92055.5 | 1 | false | `3d88b56dba90` |
| after | 3 | 2205.4 | 1989.8 | 2196.9 | 185 | 91986.5 | 1 | false | `3d88b56dba90` |

### playwright-production

| phase | run | peak tree MiB | peak process MiB | P95 tree MiB | samples | wall ms | exit | valid | commit |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| before | 1 | 196.5 | 69.9 | 196.5 | 5 | 1995.9 | 1 | false | `e50f77988bd6` |
| before | 2 | 197.0 | 70.1 | 197.0 | 5 | 1982.9 | 1 | false | `e50f77988bd6` |
| before | 3 | 44.5 | 36.8 | 44.5 | 4 | 1728.3 | 1 | false | `e50f77988bd6` |
| after | 1 | 130.8 | 64.3 | 130.8 | 6 | 2670.1 | 1 | false | `3d88b56dba90` |
| after | 2 | 132.1 | 65.9 | 132.1 | 5 | 2227.0 | 1 | false | `3d88b56dba90` |
| after | 3 | 43.7 | 36.0 | 43.7 | 4 | 1679.4 | 1 | false | `3d88b56dba90` |

## 4. 生产构建（独立于生产运行样本）

| phase | mode | peak tree MiB | peak process MiB | P95 MiB | samples | wall ms | exit |
|---|---|---:|---:|---:|---:|---:|---:|
| before | standard | 2319.0 | 991.8 | 1715.4 | 110 | 54698.9 | 0 |
| after | low | 1083.6 | 986.5 | 989.6 | 103 | 51169.8 | 0 |

## 5. 主基准失败原因（不剔除）

- `next-dev`：6/6 wrapper 在 90s readiness 上限退出，样本均有 RSS 但退出码 1，按规则判失败。
- `vitest`：6/6 中 visual matrix static 因临时 worktree 未复制 `docs/evidence/visual/v0.0.21` 而 `reference hash mismatch SELF-V021-BEFORE`；每次 31/32 通过，整组退出码 1。
- `playwright-dev`：6/6 在 90s readiness 上限退出，尚未进入 95 条测试。
- `playwright-production`：6/6 wrapper 误用 per-sample dist，`next start` 找不到对应构建并退出 1；生产构建本身两次均成功。
- 两次更早的 after build 配置尝试也保留在 `memory/after-build-smoke*`：绝对 `NEXT_DIST_DIR` 被拼到工作树内、外部 dist 类型无法解析 next 类型；均未计入成功样本。

## 6. 补充基准（修正 QA 装置后的独立 3×2）

补充基准修正：readiness 上限 180s；before/after 复制同一 59MB visual evidence fixture；production 使用主基准已构建的正确 dist。主基准失败仍保留。next-dev 的 180s 补充尝试仍在 readiness 阶段失败，已停止重复等待并保留 `benchmark-supplemental/` 原始报告；Playwright-dev 未再重复等待，保持主基准 90s 失败证据。因此开发服务器场景保持 not-completed。

| 场景 | before peak 中位数 MiB | after peak 最大 MiB | before wall 中位数 ms | after wall 最大 ms | 有效样本 | 结论 |
|---|---:|---:|---:|---:|---:|---|
| vitest | 584.4 | 595.2 | 22374.0 | 23480.2 | 6/6 | not-completed |
| playwright-production | 1284.9 | 1284.9 | 65317.1 | 69981.8 | 6/6 | not-completed |

### 补充基准原始样本

#### vitest

| phase | run | peak tree MiB | peak process MiB | P95 tree MiB | samples | wall ms | exit | valid | commit |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| before | 1 | 537.3 | 126.4 | 537.3 | 46 | 22374.0 | 0 | true | `e50f77988bd6` |
| before | 2 | 586.0 | 130.2 | 586.0 | 45 | 22132.2 | 0 | true | `e50f77988bd6` |
| before | 3 | 584.4 | 130.8 | 584.4 | 46 | 22547.7 | 0 | true | `e50f77988bd6` |
| after | 1 | 594.7 | 130.2 | 594.7 | 48 | 23265.1 | 0 | true | `3d88b56dba90` |
| after | 2 | 595.2 | 130.3 | 595.2 | 47 | 22951.7 | 0 | true | `3d88b56dba90` |
| after | 3 | 556.4 | 130.4 | 556.4 | 48 | 23480.2 | 0 | true | `3d88b56dba90` |

#### playwright-production

| phase | run | peak tree MiB | peak process MiB | P95 tree MiB | samples | wall ms | exit | valid | commit |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| before | 1 | 1241.4 | 215.6 | 1237.9 | 132 | 65322.8 | 0 | true | `e50f77988bd6` |
| before | 2 | 1284.9 | 252.1 | 1275.8 | 125 | 62219.2 | 0 | true | `e50f77988bd6` |
| before | 3 | 1287.8 | 257.8 | 1285.3 | 132 | 65317.1 | 0 | true | `e50f77988bd6` |
| after | 1 | 1267.9 | 244.6 | 1264.1 | 141 | 69981.8 | 0 | true | `3d88b56dba90` |
| after | 2 | 1275.3 | 247.4 | 1262.0 | 132 | 65464.3 | 0 | true | `3d88b56dba90` |
| after | 3 | 1284.9 | 252.6 | 1214.1 | 126 | 62461.9 | 0 | true | `3d88b56dba90` |

## 7. 原始证据与剩余风险

- 主基准：`docs/evidence/v0.0.21/memory/benchmark/benchmark.json` 及各 run 的 preflight/lease/monitor/cleanup/command.log。
- 补充基准：`docs/evidence/v0.0.21/memory/benchmark-supplemental-remaining/benchmark.json` 及各 run 原始报告；开发服务器失败尝试保留在 `benchmark-supplemental/`。
- 树 RSS 是进程 RSS 之和，会重复计算共享页；不称为 PSS。
- 未运行 24h soak、完整跨浏览器 E2E、完整生产发布；本报告不构成发行授权。
- profile 份额与下限仍未校准；next-dev readiness 在本机连续超过 180s，说明当前默认上限与开发服务器启动路径需要校准。

## 8. 候选后诊断与修复（不改变主基准结论）

- `next-dev` 连续未 ready 已定位为两个独立问题：
  1. 真实源码缺陷：instrumentation 独立 webpack bundle 静态/动态链入 `node:http`、`node:crypto`、`sharp`，Next dev 按 Edge 资源规则解析，健康检查持续 500。
  2. QA 环境问题：临时 worktree 的 Next dev 优先加载 `.env.local`（55433 开发库），未显式注入 `.env.test`（55440 隔离库），即使 instrumentation 修好也会返回 503。
- 修复：附件清理 worker 移到根布局 Node server bundle，并用 `globalThis` Symbol 保证每进程只启动一次；头像/回复图片的路径校验与删除拆到无 sharp 的存储模块；instrumentation 通过 `process.getBuiltinModule('http')` 在运行时加载内置模块；`sharp` 加入 `serverExternalPackages`。
- 验证：shell 显式注入 `.env.test` 后，`next dev /api/health/ready` 返回 200；生产 `next start /api/health/ready` 返回 200；Node 22.23.4 生产构建通过，峰值 1024.2MiB；相关回归 78/78。
- MEM-08 `next-dev` 仍为 **not-completed**：before `e50f779` 本身包含上述启动缺陷，无法形成有效 before 运行样本；修复后的 after smoke 不能替代 3×2 基准。
