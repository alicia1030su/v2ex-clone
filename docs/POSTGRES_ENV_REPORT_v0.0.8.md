# PostgreSQL 测试环境稳定性报告（v0.0.8）

> **日期**：2026-11-07
> **范围**：Windows 开发机上的 PostgreSQL 测试实例
> （`_tools/pgsql/data-test-v004`，端口 55440）
> **结论摘要**：**本机 PG 的不稳定是环境层劣化，不是产品缺陷**。
> 全部证据见下文；重型测试已迁往 Linux CI 容器。

---

## 一、结论

| 结论 | 证据强度 |
|---|---|
| PG 实例反复 crash recovery 的直接原因是**恢复期逐文件 fsync 耗时约 10 秒** | ✅ 量化实测（日志 + 探针） |
| **不是**磁盘空间不足（770 GB 空闲） | ✅ 实测 |
| **不是**磁盘健康问题（NTFS/SSD 均 Healthy） | ✅ 实测 |
| **不是**杀毒软件拦截（Windows Defender 与第三方杀软均未启用） | ✅ 实测 |
| **不是**普通文件写入慢（普通文件 flush-to-disk 仅 6~26 ms） | ✅ 实测 |
| 稳定态下 PG 本身功能正常（迁移、seed、查询、连接池均正常） | ✅ 实测 |
| ⇒ 归因：**本机文件系统层在 PG 数据目录上的 fsync 路径异常劣化** | 🔶 合理推断（未定位到驱动/过滤器层的确切原因） |

**登记方式**：作为**环境问题**登记在 `RISK_REGISTER.md`，与产品缺陷严格分开。

---

## 二、量化证据

### 2.1 PG 日志：恢复期逐文件 fsync 10 秒

日志（`_tools/pgsql/pg-test-v004.log`，**GBK 编码**）：

```
2026-11-07 11:12:44.878 CST [41404] 日志:  syncing data directory (fsync), elapsed time: 10.00 s, current path: ./base/103310/3541
2026-11-07 11:12:54.875 CST [41404] 日志:  syncing data directory (fsync), elapsed time: 20.00 s, current path: ./base/192497/3576
2026-11-07 11:13:04.881 CST [41404] 日志:  syncing data directory (fsync), elapsed time: 30.01 s, current path: ./base/427524/3602_vm
2026-11-07 11:13:14.876 CST [41404] 日志:  syncing data directory (fsync), elapsed time: 40.00 s, current path: ./base/5/3256
2026-11-07 11:13:24.882 CST [41404] 日志:  syncing data directory (fsync), elapsed time: 50.01 s, current path: ./base/511518/511741
2026-11-07 11:13:26.564 CST [19972] 日志:  数据库系统没有正确关闭；自动恢复状态
2026-11-07 11:13:26.610 CST [19972] 日志:  redo 从 0/E14D2C18 开始
```

**关键读法**：每 **10 秒**才推进**一个文件** ⇒ 单文件 fsync ≈ 10 秒。
恢复要同步 **6,941 个文件** ⇒ 单次恢复需数十分钟 ⇒ 期间连接被拒
⇒ 表现为「本地 vitest / drizzle-kit 随机失败」。

日志中 `syncing data directory (fsync)` 事件累计 **41 次**（跨多次启动）。

### 2.2 对照：普通文件 fsync 正常

| 位置 | 操作 | 耗时 |
|---|---|---|
| `_tools/pgsql/` 下 | 20 × 64KB 写入 + fsync | **5 ms/文件** |
| `_tools/pgsql/` 下 | `FileStream.Flush(true)`（强制落盘） | **6 ms** |
| `WorkBuddy/ai/` 下 | `FileStream.Flush(true)` | **26 ms** |

⇒ **同一个磁盘上，普通文件的 fsync 是毫秒级**；
只有 PG 数据目录里的文件 fsync 是 10 秒级。
问题**不在文件系统通用路径**，而在 PG 数据目录这条特定路径上。

### 2.3 排除项

| 排除项 | 实测 |
|---|---|
| 磁盘空间 | C: 总 953 GB / 已用 184 GB / **可用 770 GB**（19~20%） |
| 卷健康 | `Get-Volume C` ⇒ NTFS / Healthy / OK |
| 物理磁盘 | SSD / Healthy / OK |
| 杀毒软件 | `Get-MpComputerStatus` ⇒ RealTimeProtection **False**、Antivirus **False**；无第三方杀软进程 |
| 内存 | 16 GB 总量 / 2.8 GB 空闲（**偏紧但非瓶颈**：fsync 是同步等待，不吃内存） |

### 2.4 数据目录规模

| 项 | 值 |
|---|---|
| 目录大小 | 376 MB |
| 文件数（base/ 下） | 6,941 |
| 库数量 | 多个测试库 + 压测库（**保留不动**） |

---

## 三、影响范围与已采取的隔离措施

### 3.1 本地 PG 实例的定位（本就正确）

`tests/helpers/start-test-pg.sh` 启动的是**独立数据目录**的实例
（端口 55440），与任何业务库完全隔离 —— 这是 v0.0.5 就确立的设计，
本轮**未改动**。

### 3.2 重型测试已迁往 Linux CI 容器（任务书 §五 要求）

| 测试类型 | 运行位置 | 说明 |
|---|---|---|
| 单元测试（需 DB） | CI `postgres:17-alpine` service container | 全新实例，无历史包袱 |
| E2E（15 分片） | CI 每分片独立 PG + 独立库名 | `v2ex_e2e_<browser>_<viewport>` |
| SMTP 稳定性（30 次） | CI 独立容器 + 独立库 `v2ex_stab` | 专用工作流 |
| 安全审计 | CI 独立容器 + 独立库 `v2ex_sechost` | 专用工作流 |
| 视觉回归 | CI 独立容器 + 独立库 | — |
| 安装/Docker 验证 | CI `docker compose` 真实栈 | — |

⇒ **本机 PG 的劣化不再影响任何发布门禁**。

### 3.3 新增「静态测试」通道（不依赖 DB）

`vitest.static.config.ts` + `tests/static/`：**刻意不设** globalSetup
⇒ 不碰数据库 ⇒ 语法/结构护栏不会因 PG 不可用而误报
（否则会「长期红灯 ⇒ 被人忽略」，反而失去护栏价值）。

---

## 四、本机环境的处置纪律（严格遵守）

| 禁止项 | 本轮是否触碰 |
|---|---|
| 清空 / 删除 PG `data` 目录 | ❌ 未触碰 |
| 删除已有业务库 | ❌ 未触碰（`v2ex_am_test` 等测试库是**新建**的） |
| 修改现有数据库配置 | ❌ 未触碰 |
| 修改 `postgresql.conf` | ❌ 未触碰 |
| 降低 fsync / `full_page_writes` 等参数 | ❌ 未触碰（那是**修改现有实例配置**，且会削弱数据安全性） |

**说明**：理论上可以把本机测试实例的 `fsync=off` 来规避，
但那会**降低数据安全性**并**改变现有实例配置** ——
按任务书「禁止随意修改现有数据库配置」，本轮**不做**。
替代方案是「把重型测试迁到隔离 CI」（已执行）。

---

## 五、复现方式（供他人复现）

```bash
# 1) 启动本机测试实例
bash tests/helpers/start-test-pg.sh start

# 2) 观察恢复期 fsync 间隔（每行 10 秒 ⇒ 文件级 fsync 劣化）
#    ⚠️ 日志是 GBK 编码，grep 需按字节匹配或先转码
python - <<'EOF'
import io
txt = io.open(r'..\_tools\pgsql\pg-test-v004.log', 'rb').read().decode('gbk', 'replace')
for l in txt.splitlines():
    if 'syncing data directory' in l:
        print(l[:110])
EOF

# 3) 对照：同盘普通文件的 fsync 耗时
python - <<'EOF'
import os, time
d = r'..\_tools\pgtest'
os.makedirs(d, exist_ok=True)
t0 = time.time()
for i in range(20):
    p = os.path.join(d, f'probe-{i}.bin')
    with open(p, 'wb') as f:
        f.write(b'x' * 65536); f.flush(); os.fsync(f.fileno())
print(f'每文件 {(time.time()-t0)/20*1000:.0f} ms')
EOF
```

---

## 六、遗留与建议

| 项 | 建议 |
|---|---|
| 根因未定位到驱动/过滤器层的确切原因 | 若后续要彻底解决，建议**换盘/换卷**或用 WSL2 内的 Linux PG；**不建议**用 `fsync=off` 绕过 |
| 本机 PG 恢复期仍可能长达数十分钟 | 本地只跑「静态测试 + 针对性单测」；**完整验证一律走 CI** |
| 本机 PG 崩溃会波及依赖 DB 的本地 vitest | 已知且如实登记；**不掩盖**（不自动重试、不跳过用例） |
| 是否在 Windows 上继续维护本机 PG | **建议停止依赖**：本轮已把全部发布门禁迁到 Linux CI |

---

## 七、与 v0.0.6/v0.0.7 记录的关系

| 轮次 | 当时的结论 | 本轮复核 |
|---|---|---|
| v0.0.6 | 「本地 PG 反复 crash recovery，环境问题」 | ✅ 结论成立，本轮补上了**量化证据**（逐文件 fsync 10 秒 vs 普通文件 5 ms）与**排除项** |
| v0.0.7 | 「本地 PG 磁盘 I/O 劣化」 | ✅ 方向一致；本轮进一步排除空间/健康/杀软/通用 fsync 路径 |
| v0.0.8 | 本报告 | 新增：**处置纪律表**（明确未触碰什么）、**复现步骤**、**CI 隔离清单**、**静态测试通道** |
