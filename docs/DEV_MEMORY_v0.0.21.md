# WorkBuddy 低内存研发入口 v0.0.21

> 状态：工具实现完成，性能结论 **not-completed**
> 适用分支：`release/v0.0.21-stable`
> Node 要求：`>=22.23.4`

本文说明 `tools/dev-memory/` 的动态预算、进程树监控、安全清理和低内存入口。它不声称本机最低支持内存，也不替代完整 CI、生产构建或跨浏览器矩阵。

## 1. 入口

```bash
npm run memory:preflight -- --profile next-build --worktree . --json test-results/dev-memory/preflight.json
npm run memory:monitor   -- --lease test-results/dev-memory/<run>/lease.json --report test-results/dev-memory/<run>/monitor.json
npm run memory:cleanup   -- --lease test-results/dev-memory/<run>/lease.json --report test-results/dev-memory/<run>/cleanup.json
npm run memory:run       -- --profile vitest --json-dir test-results/dev-memory/manual -- node -e "setTimeout(()=>{},1000)"

npm run dev:low
npm run build:low
npm run test:unit:low
npm run test:e2e:low
npm run visual:audit:low
```

`memory:run` 与四个低内存脚本使用精确 argv 和 `shell: false`。`--` 后的内容不会被重新拼接或解释，因此路径可以包含空格。

`memory:benchmark` 默认对一个任务各执行一次丢弃的 standard/low warm-up，再各测量 3 次：

```bash
npm run memory:benchmark -- --task next-build --mode both --runs 3 --json test-results/dev-memory/benchmark.json
```

本任务没有运行完整 Next 构建、完整 Vitest、Playwright 或视觉矩阵；因此本文不包含 before/after 性能通过结论。

## 2. 动态预算

每次运行重新测量，不沿用历史快照：

```text
effectiveLimitMB = min(physicalMemoryMB, cgroupLimitMB)
hostReserveMB   = max(1024, WORKBUDDY_RESERVE_MB)
availableMB     = max(0, effectiveLimitMB - hostReserveMB)
taskBudgetMB    = min(userCeilingMB,
                      max(taskFloorMB, availableMB × taskShare))
sum(activeTaskBudgetsMB) + taskBudgetMB + hostReserveMB <= effectiveLimitMB
```

- Linux cgroup v2 读取 `memory.max` / `memory.current`；v1 读取 `memory.limit_in_bytes` / `memory.usage_in_bytes`。
- `max` 或明显超过物理内存的哨兵值视为无 cgroup 限制。
- 当前可用量取 `os.freemem()` 与 cgroup 可用量的较小值。
- 环境变量必须是有限非负数；解析失败直接 `DENY`，不静默回退。
- 机器级槽位位于系统临时目录的 `workbuddy-dev-memory-slots/`。只有精确 owner/root 身份已消失时才回收陈旧槽位。
- `--unsafe-override` 只能绕过“任务预算低于 profile 下限”。无法测量内存、槽位冲突、lease 无法建立或清理身份不确定时仍然失败。

| profile | taskShare | taskFloorMB | 派生并发 |
|---|---:|---:|---|
| `next-dev` | 0.40 | 384 | Node 堆；不伪造 Next 私有参数 |
| `next-build` | 0.55 | 768 | `experimental.cpus` |
| `vitest` | 0.35 | 384 | forks / 1 worker / 文件不并行 |
| `playwright` | 0.45 | 512 | 1 worker / 不完全并行 |
| `visual-audit` | 0.45 | 512 | 1 worker / 串行浏览器上下文 |

```text
nodeMaxOldSpaceMB = max(256, floor(taskBudgetMB × 0.60))
nextBuildCpus     = clamp(floor(taskBudgetMB / 512), 1, min(cpuCount, 4))
```

`NODE_OPTIONS` 只写入 `run.mjs` 创建的子进程环境；父 shell、用户配置和系统配置不被修改。`next.config.mjs` 只从 `WORKBUDDY_NEXT_CPUS` 派生 `experimental.cpus`。

## 3. 进程归属与清理边界

每个运行生成随机 `run_id` 和 ownership lease。lease 记录：

- worktree realpath、Git HEAD/tree、分支；
- 精确 argv、supervisor 捕获的 cwd、环境变量哈希；
- 根 PID、PPID、启动时间/ticks、exe realpath、身份哈希；
- 已观察后代和 preflight 时的 protected 进程集合；
- profile、预算、状态和 fence。

清理规则：

1. lease 必须属于当前 worktree；跨 worktree 直接 `ABORTED`。
2. 根 PID 必须仍存在，且启动时间/ticks、PPID、exe 与 lease 完全一致。若 supervisor 已直接观察到子进程退出或 lease 已为 `FINISHED`，而该 PID 已被复用，则记录 `PID_REUSED_AFTER_CONFIRMED_EXIT` 并跳过；活动 lease 的独立 cleanup 没有退出确认，仍按 `IDENTITY_MISMATCH` 失败关闭。
3. 后代必须在当前进程表中沿 PPID 链追溯到根，且启动时间不早于根进程启动时间。lease 在 spawn 后才写入，Windows 的 console host 等真实系统后代可能早于 lease 毫秒级时间戳；根启动时间是更强且跨平台可用的归属下界。
4. protected 集合命中任何目标时放弃整个清理，不会跳过受保护进程继续杀其它进程。
5. 按最深后代到根排序；每次发信号前重新读取身份；先 `SIGTERM`，宽限期后重新校验再升级 `SIGKILL`。
6. 只发信号。不删除日志、报告、测试结果、数据库、证据或用户数据。

明确禁止：`taskkill /IM`、`pkill node`、按端口选择、按进程名选择、按命令行模糊匹配。Windows 任意进程 cwd 无法通过标准 API 稳定重读，因此根 cwd 使用 supervisor 启动时捕获的权威值；其它进程不可读时报告 `UNKNOWN`。

## 4. 监控与报告

`ProcessMonitor` 启动时立即采样，默认请求 1000ms 报告间隔。为吸收 Windows 进程枚举延迟，调度器以 2Hz 预留窗口；任意相邻采样起点仍不得超过 1000ms，否则写入 `monitor_errors`。每次局部更新都通过同目录临时文件、`fsync`、`rename` 原子写入。

监控摘要包含：

- 根 PID、完整树样本、每进程 RSS；
- 峰值树 RSS、峰值单进程 RSS；
- nearest-rank P95（`ceil(0.95*n)-1`）；
- 样本数、wall-clock、退出码、signal；
- 命令、commit、profile、机器标识；
- 采样与身份错误。

树 RSS 是各进程 RSS 之和，会重复计算共享页；该口径不称为 PSS。

五个 JSON Schema 位于 `tools/dev-memory/schemas/`：

- `preflight.schema.json`
- `lease.schema.json`
- `monitor.schema.json`
- `cleanup.schema.json`
- `benchmark.schema.json`

## 5. 测试与 CI

普通工具单测覆盖公式、fail-closed、UNSAFE 标记、Linux/Windows 解析、lease fencing、监控数学、supervisor 正常/非零退出/信号退出，以及真实进程树清理。真实清理测试不使用平台条件跳过；它在 Windows 与 Linux 上都会验证：

- 正常完成与精确身份；
- 树外探针存活；
- 记录树内后代先于根终止；
- PID 复用时零信号；
- 跨 worktree 时零信号；
- protected 命中时整体放弃；
- 无关 Node 进程不被选择；
- 证据文件内容不变。

`.github/workflows/dev-memory.yml` 在 Windows/Linux 双平台运行新增单测、静态门禁、三个独立 CLI 和一次 supervisor smoke。它不运行完整生产构建、完整 Vitest、跨浏览器 E2E 或视觉矩阵。

## 6. 已知限制

- profile 份额与下限仍是未校准的保守默认值。
- `visual:audit:low` 依赖视觉任务提供的 `tools/visual/v021/run-audit.mjs`；在该模块尚未落地前，该入口会按精确命令正常失败，并由 supervisor 产出报告。
- benchmark 的 `standard` 模式仍使用 preflight/monitor/cleanup 外层，以取得同口径报告；唯一有意的优化变量是 standard/low 运行时参数与对应测试配置。
- 本文件不构成 v0.0.21 性能验收、24h soak 或正式发布授权。
