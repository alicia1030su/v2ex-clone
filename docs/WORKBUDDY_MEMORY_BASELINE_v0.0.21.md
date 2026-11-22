# WorkBuddy 内存基线 v0.0.21

> 采集时间：2026-11-22 21:00–21:04（GMT+8）
> 主机：Windows 11 专业版 10.0.26300
> 方法：PowerShell 5.1 + CIM/WMI 只读采样；未启动 Next build、完整 Vitest、Playwright 或 Docker。
> 原始证据：`docs/evidence/memory/baseline-samples.json`

## 1. 主机资源

| 指标 | 实测值 | 说明 |
|---|---:|---|
| 物理内存 | 16,905,920,512 B（约 15.75 GiB / 16 GB） | `Win32_ComputerSystem.TotalPhysicalMemory` |
| 可用物理内存 | 三次样本 3,810.2 / 3,860.5 / 3,857.3 MiB | 中位数约 3,857.3 MiB |
| 虚拟地址总量 | 31,707,028 KiB | `Win32_OperatingSystem.TotalVirtualMemorySize` |
| 提交上限 | 32,467,996,672 B（约 30.24 GiB） | 由 TotalVirtualMemorySize 换算 |
| 当前提交量 | 16,527,949,824 B（约 15.40 GiB） | Total − Free Virtual |
| 页面文件分配 | 14,841 MB | `Win32_PageFileUsage.AllocatedBaseSize` |
| 页面文件当前/峰值 | 655 MB / 4,232 MB | 当前使用低，但历史峰值较高 |
| CPU | 13th Gen Intel Core i5-13500H | 16 逻辑核心 |
| 系统盘 | C: 952.78 GB，可用 705.28 GB | 仅检测到 C: |

## 2. 工具链

| 工具 | 版本/路径 | 结论 |
|---|---|---|
| 当前 shell Node | `v22.22.2`，`C:\Users\TYMO001\.workbuddy\binaries\node\versions\22.22.2-6\node.exe` | **低于 package.json 的 `>=22.23.4`** |
| 本机已发现的 Node | 仅 `22.22.2-6` | 未发现满足项目要求的 Node 22.23.4；不擅自安装或改全局环境 |
| npm / npx | 10.9.7 / 10.9.7 | PowerShell 直接调用 `.ps1` 被执行策略拦截，改用同目录 `.cmd` 取得成功 |
| Next.js | 15.5.29 | 主仓库 `node_modules` 已安装 |
| Vitest | 5.0.5 | 主仓库 `node_modules` 已安装 |
| Playwright | 1.64.1 | 主仓库 `node_modules` 已安装 |
| v0.0.21 worktree | 无 `node_modules` | 实施前需确定批准 Node 与依赖安装方式 |

## 3. 三次分类快照

分类规则：

- `workbuddy`：WorkBuddy.exe、sandbox、browser-mcp、computer-use、editor_sdk、betterleaks 等 WorkBuddy 子进程。
- `agent`：命令行含 `codebuddy` 的 WorkBuddy CLI/代理进程。
- `node`：其余 `node.exe`。
- `browser`：Edge/WebView2/Chromium/Firefox/WebKit。
- `project-dev-test`：Next/Vitest/Playwright 进程；本次采样中没有真实命中。
- `infra`：PostgreSQL/Redis/Docker/WSL/vmmem；本次采样中没有真实命中。

| 类别 | 进程数 | Working Set 中位数 MiB | Private Bytes 中位数 MiB |
|---|---:|---:|---:|
| WorkBuddy 自身 | 19 | 2,709.5 | 4,265.7 |
| AI 编码代理 | 6 | 1,983.6 | 1,977.3 |
| 其它 Node | 9 | 606.3 | 736.7 |
| 浏览器/WebView | 19 | 448.0 | 656.4 |
| 项目开发/测试 | 0 | — | — |
| Docker/WSL/数据库/缓存 | 0 | — | — |

> 上表是同一快照内的简单求和。Windows 进程会共享代码页、GPU 缓冲和 WebView 内存，因此 **Private Bytes 合计可能重复计数共享页**；它用于识别量级与最高占用进程，不能当作唯一精确的“项目总内存”。WorkBuddy 与 Edge/WebView2 也可能同时承载本项目与其它工作负载。

## 4. 最高占用进程（第三次快照）

| PID | PPID | 类别 | 进程 | Working Set MiB | Private MiB | 启动时间 | 工作目录 |
|---:|---:|---|---|---:|---:|---|---|
| 15828 | 23384 | WorkBuddy | WorkBuddy.exe renderer | 1,250.2 | 1,995.9 | 06:38:39 | UNKNOWN（Windows 标准 API 不提供任意进程 cwd） |
| 16920 | 8792 | agent | WorkBuddy.exe / codebuddy --serve | 898.3 | 957.1 | 11:14:04 | UNKNOWN |
| 24724 | 23384 | WorkBuddy | WorkBuddy.exe daemon | 479.6 | 680.5 | 06:38:39 | UNKNOWN |
| 25900 | 23384 | WorkBuddy | WorkBuddy.exe GPU process | 184.3 | 550.3 | 06:38:38 | UNKNOWN |
| 18512 | 24724 | agent | WorkBuddy.exe 代理子进程 | 513.2 | 494.1 | 11:14:01 | UNKNOWN |
| 14484 | 24724 | agent | WorkBuddy.exe 代理子进程 | 453.5 | 429.9 | 11:14:01 | UNKNOWN |
| 25788 | 23384 | WorkBuddy | sandbox-center.exe | 62.8 | 294.9 | 06:38:43 | UNKNOWN |
| 23384 | 6904 | WorkBuddy | WorkBuddy.exe 主进程 | 172.8 | 192.2 | 06:38:38 | UNKNOWN |
| 6988 | 3008 | browser | msedgewebview2.exe GPU process | 27.3 | 133.4 | 2026-11-21 17:07:10 | UNKNOWN |
| 5712 | 24724 | Node | node.exe（WorkBuddy 扩展） | 87.4 | 123.6 | 06:38:43 | UNKNOWN |
| 12052 | 24724 | Node | node.exe（WorkBuddy 扩展） | 91.4 | 97.5 | 12:59:36 | UNKNOWN |

完整 PID/PPID/角色/启动时间/内存字段见原始 JSON。原始证据已删除所有进程 CommandLine，避免会话令牌或插件参数入库。初次采样曾把采样器自身误分类为 `project-dev-test`，已排除自身并重写证据。

## 5. 当前未运行的本项目相关组件

- 未检测到 `postgres`、`redis`、Docker Desktop、`com.docker.backend`、`vmmem`、`wsl` 进程。
- 未检测到 `next-server`、Next dev/build、Vitest worker、Playwright、Chromium/Firefox/WebKit 测试进程。
- 因此本次基线只测量 WorkBuddy 自身、代理、常驻 Node 与浏览器占用；不能据此推断构建或测试峰值。

## 6. 初始预算建议（未校准）

按 PRD 公式，以 16 GB 机型、至少 1 GiB 系统预留为起点：

- 单重量级任务（Next build / Playwright / 视觉审计）应串行运行。
- 本地 Vitest 默认 `maxWorkers=1`、`fileParallelism=false`、`pool=forks`。
- 本地 Playwright 默认 `workers=1`、`fullyParallel=false`。
- 不得同时运行生产构建、完整 Vitest 和跨浏览器 E2E。
- 当前可用物理内存中位数约 3.86 GiB，已接近保守下限；任何新重任务启动前必须重新 preflight，不能沿用本次快照。

这些只是保守初始值，**尚未经过 before/after 基准校准**，不能宣称最低支持内存或优化比例。

## 7. 阻塞与下一步

1. **Node 版本阻塞**：当前只有 22.22.2，不满足 `>=22.23.4`。实施前必须找到批准的 22.23.4 执行路径，或由项目所有者确认受控安装方式；不得修改全局环境。
2. v0.0.21 worktree 尚无依赖；安装前先解决 Node 路径，避免用错误运行时产生假基线。
3. Windows 任意进程 cwd 不可稳定重读；资源守护采用“supervisor 启动时捕获 cwd + PID 启动时间/PPID/exe 身份 fencing”，该决策已由主理人批准。
4. 下一项是实现 preflight/monitor/cleanup，然后用真实 Next/Vitest/Playwright 任务做各 3 次同条件 before/after 基准。
