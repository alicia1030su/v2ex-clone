# v0.0.8 会话交接文档

> **最后更新**：2026-11-07
> **用途**：上下文接近限制时，先保存现场与交接资料。
> **本轮性质**：安全加固 + 稳定性治理 + 部署可靠性（任务书 §一 定位）

---

## A. 当前 HEAD / 分支 / PR

| 项 | 值 |
|---|---|
| 特性分支 | `feat/v0.0.8-production-hardening` |
| 最新提交 | `49f70d3`（R-01 只读复核文档） |
| PR | **#29** → https://github.com/alicia1030su/v2ex-clone/pull/29 |
| master 基线 | `4fab2f5`（v0.0.7 交付报告提交，已核验） |
| 已合并的 v0.0.7 PR | #27（代码 → `535c421`）、#28（版本同步 → `a0eea16`） |
| Tag / Release | 止于 `v0.0.4`（**R-01 未授权 ⇒ 不建 v0.0.8 Tag、不发公开 Release**） |

---

## B. 本轮已完成模块

### B1. P0 —— 重定向安全（任务书 §三）

| 项 | 内容 |
|---|---|
| 审计发现 | v0.0.7 的 `src/lib/redirect-url.ts` 直接采信 `x-forwarded-host` / `host` / `x-forwarded-proto` 构造**绝对** Location ⇒ Host Header Poisoning |
| 修复 1 | **303 改用站内相对 Location**（RFC 7231 §7.1.2）—— `src/lib/redirect.ts` 的 `seeOther()`；浏览器按实际请求 URL 解析，不经任何请求头 ⇒ 投毒面为零 |
| 修复 2 | **邮件链接 fail-closed** —— `src/lib/public-base-url.ts` 的 `resolvePublicBaseUrl()` 只信运维配置（PUBLIC_BASE_URL → APP_URL）；未配置 ⇒ 拒绝发信 + 明确错误日志，响应仍统一（枚举防护不变） |
| 删除 | `src/lib/redirect-url.ts`（已无生产引用） |
| 攻击矩阵 | `tools/security/host-attack-matrix.ts` + `.github/workflows/security-host-audit.yml`：13 类 303 场景 + 4 类密码重置链接投毒 + 2 类 HTML 泄漏，**任一出现攻击者可控 Location/链接 ⇒ job 红** |
| 单元测试 | `tests/v008-redirect-security.spec.ts`（24 条断言，含反向断言） |

### B2. P0 —— SMTP 竞态根治（任务书 §四）

| 项 | 内容 |
|---|---|
| 根因 | fake SMTP server 跑在 **Playwright worker 进程内** ⇒ 与浏览器协议处理共用事件循环 ⇒ SMTP socket 事件延迟 ⇒ 客户端空闲超时 ⇒ 邮件不到 |
| 修复 | **独立进程**（`tests/helpers/fake-smtp-standalone.ts`，stdout JSON-lines）+ **事件驱动 fixture**（`e2e/smtp-fixture.ts`）：ready 才发请求、mail 到达才断言、stopped 校验 openSockets=0/exitCode=0、进程猝死立即明确失败 |
| 无 sleep 无轮询 | ✓ 事件驱动；不用重试掩盖 |
| 稳定性套件 | `e2e/v008-smtp-stability.spec.ts`：连续 30 次全流程，记录邮件延迟/耗时/资源状态；**默认 testIgnore 排除**，由专用工作流 `.github/workflows/smtp-stability.yml` 运行（避免打乱矩阵 200 条口径） |

### B3. P1 —— 运维能力（任务书 §六）

- `src/lib/observability.ts`：结构化 JSON-lines 日志 + 进程内计数窗口 + **脱敏**（敏感键名值一律 `[redacted]`）
- 埋点：mailer 投递成功/失败（按 purpose）、rate-limit 全部限流（埋点放在唯一的 `rateLimit()` ⇒ 全覆盖不漏）
- 端点：`/api/health`（存活）、`/api/health/ready`（就绪，DB 必查 + Redis 配置了才查，200/503）、`/api/admin/ops`（运维总览：依赖可用性、磁盘比例、邮件/限流/错误统计、慢请求）
- 备份完整性：`deploy/backup.sh` 生成 `.sha256` + gzip 结构校验 + 内容非空校验；`deploy/restore.sh` **恢复前**三层校验，不过则拒绝恢复
- `deploy/health-check.sh`（新增）：容器/就绪/PG/Redis/磁盘（85% 阈值）/备份存在性与完整性/新鲜度（7 天阈值）
- `deploy/docker-compose.yml` 的 app healthcheck 切到 `/api/health/ready`（DB 瞬时抖动不再把容器标记 unhealthy）

### B4. P1 —— 视觉基线时间漂移（**非本轮改动引入**）

- 对照实验：**master（`4fab2f5`，未改任何 UI）跑视觉回归逐字节相同地失败** ⇒ 与代码改动无关
- 根因：相对时间文案在 **Server Component** 里用 Node 时钟渲染 ⇒ 同一份种子数据在不同时刻文本长度不同 ⇒ 320px 窄视口换行 ⇒ 容器高度差 120px
- 修复：`src/lib/app-now.ts`（`APP_NOW` 注入确定性时钟，未设置 = 真实时钟 ⇒ 生产行为不变）+ `src/lib/time.ts` 默认 now 走 `nowMs()` + `tools/visual/regression.mjs` 基线自带 `clockAnchor` + 浏览器时钟同步冻结 + `tests/v008-app-now.spec.ts`（8 条，含「不影响令牌有效期/限流」的回归护栏）

### B5. R-01 —— 历史合规只读复核（任务书 §十）

- 报告：`docs/R01_COMPLIANCE_REVIEW_v0.0.8.md`
- 受影响对象 **81 个**全量登记（assets 2 / html 46 / screenshots 20 / visual 13）
- 可达性：**master 已不可达** ✅；仍可达 = **4 个已发布 Tag + 6 个远端分支**
- 新增区分：`globals.css` 与 `combo.css` **声明块交集 = 0** ⇒ 本站样式独立实现，清理不应包含它
- **未执行**任何不可逆操作（历史改写 / force push / Tag 移动 / Release 修改 / 仓库删除 / 可见性变更）

---

## C. 尚未完成模块

| # | 模块 | 状态 | 剩余动作 |
|---|---|---|---|
| 1 | CI 全绿 | ⏳ 进行中 | 等 PR #29 全部检查通过后合并 |
| 2 | 跨浏览器矩阵（3000 条） | ⏳ 进行中 | 新提交触发 15 分片重跑 |
| 3 | 视觉基线重建 | ⏳ 待人工审查 | 冻结时钟后旧基线失效 ⇒ 需 `workflow_dispatch` + `update_baseline=true` **经人工审查**重建（不得自动更新） |
| 4 | SMTP 稳定性 30 次 | ✅ **完成** | 30/30 通过（run 见上）；报告已随 artifact 上传 |
| 5 | 真实 Docker 安装 / 升级 / 备份恢复 / 回滚验证 | ⏳ 待候选包 | 版本同步到 0.0.8 后由最终提交构建候选包再验证 |
| 6 | 版本同步到 0.0.8 + 候选包 + 证明链 | ⏳ 待 PR 合并 | 按 G-VER-01：最终 SHA 固定后一次性同步，再由该提交构建候选包 |
| 7 | 交付报告 / CHANGELOG / 交接定稿 | ⏳ 待收尾 | 全部验证完成后写 |
| 8 | **R-01 实际清理** | 🔴 **待主人单独授权** | 本轮只做只读调查；清理属不可逆操作，未授权前不执行 |

---

## D. 测试证据

| 证据 | 位置 | 状态 |
|---|---|---|
| 攻击矩阵（19 个场景） | run `42336954558` 的 artifact | ✅ **19/19 SAFE，0 VULNERABLE**（13 个 303 场景 Location 恒为相对路径；4 个重置链接恒指向配置基址） |
| SMTP 稳定性报告 | PR #29 的「SMTP 稳定性」artifact（`test-results/smtp-stability.json`） | ✅ **30/30 全通过**，邮件延迟 p50=131ms / p95=174ms / max=182ms，server received=30 / openSockets=0 / exit=0 |
| 跨浏览器矩阵 | PR #29 的「E2E 跨浏览器矩阵」artifact（每分片 `e2e-results.json`） | ⏳ |
| 视觉回归 | PR #29 的「视觉回归验收」artifact | ⏳ |
| 单元测试 | PR #29 的「CI」job | ⏳ |
| 本地实测记录 | 见下方「本地实测」 | ✅ 已完成 |

### 本地实测（v0.0.8 已验证）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过 |
| `npx next build` | **exit 0** |
| 独立 SMTP server 冒烟 | 事件序列 `ready → mail → stopped(recv=1 sock=0)`，退出码 0 |
| SMTP fixture 自身跑 | `port=54516`（随机）、`stop={"received":0,"openSockets":0,"exitCode":0}` |
| 备份完整性校验 | 正常通过；**截断被 gzip -t 拒绝**；**篡改被 SHA256 拒绝** |
| 视觉护栏 5 项 + 夹具护栏 6 项 | 全部通过（本地模拟） |
| `relativeTime` 冻结时钟 | 冻结 ⇒ 确定性；未冻结 ⇒ 真实时钟 |
| `page.clock.setFixedTime` | 浏览器时钟确实冻结（两次 evaluate 时刻相同） |
| 磁盘 fsync 对比 | 普通文件 flush-to-disk 6~26ms；**PG 恢复时每文件 10s** ⇒ 环境层劣化 |

---

## E. 失败与根因（本轮全部已定位）

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| 1 | 攻击矩阵 job 显示 success 但脚本第一行就崩 | ESM 里用裸 `require`；`npx tsx \| tee` 吞退出码 ⇒ **假绿** | `createRequire` + `set -o pipefail` + artifact 缺失即 error |
| 2 | fake SMTP 在 CI 退出 code=1 | fixture 用 `path.join(__dirname, 'fake-smtp-standalone.ts')`，但脚本在 `tests/helpers/` | 修正路径 + `existsSync` 前置检查 + stderr 无条件附于错误 |
| 3 | Windows 上 stop 无 `stopped` 事件 | `child.kill('SIGTERM')` 在 Windows 是 TerminateProcess，不触发信号处理器 | 改走 stdin `{"cmd":"quit"}`（跨平台）+ SIGKILL 兜底 |
| 4 | 六个工作流全红（构建失败） | `import from './app-now.js'` —— **Next/webpack 不做 .js→.ts 映射** | 改无扩展名（仓库既有约定） |
| 5 | 视觉护栏两条断言失败 | 护栏用精确字符串匹配，被我的重构打破 | 改 `lastIndexOf` + 正则容忍换行；**语义未变** |
| 6 | 视觉回归在 master 上也失败 | 相对时间文案用墙上时钟 ⇒ 基线是时间炸弹 | 注入 `APP_NOW` 确定性时钟 + 基线自带 `clockAnchor` |
| 7 | SMTP 稳定性首轮「第 1 次迭代就收不到邮件」 | v008 自己拼了 `@stability.local`，而 `register()` 里写死 `@e2e.local` ⇒ 申请的邮箱**未注册** ⇒ 一封都不发（接口仍返回 200，日志无错） | 修法：`register()` **返回实际注册的邮箱**，v008 用返回值 + 域名导出为常量（结构上杜绝再拼错） |
| 8 | 攻击矩阵「19/19 SAFE」但 303 从未发生 | Playwright `APIRequestContext` 默认 `maxRedirects: 20` **自动跟随**重定向 ⇒ Location 头消失 | `maxRedirects: 0` + 前置探针（P1/P2）证明被测路径确实执行 |
| 9 | 15 个分片「0 个用例被收集」却显示 success | ① helpers.ts 注释块语法错误（**tsc 抓不到**）② 汇总步骤的 exit 1 **无人消费** | ① 新增 `tests/static/` 语法护栏（TS parseDiagnostics，不依赖 DB）② 汇总退出码由独立判定步骤落地为 job 失败 |
| 10 | 本地 PG 反复 crash recovery | **PG 恢复时每文件 fsync 10 秒**（普通文件实测仅 6~26ms）；磁盘健康、空间 770G 空闲、无杀软 ⇒ 环境层问题 | 登记为环境问题；重型测试迁到 Linux CI 容器；不删 data 目录、不改现有库 |

---

## F. 数据库环境

| 项 | 值 |
|---|---|
| 本地 PG | `_tools/pgsql/data-test-v004`，端口 **55440**，用户 `v2ex` |
| 本机状态 | **不稳定** —— crash recovery 时逐文件 fsync 10s（实测）；日志 `_tools/pgsql/pg-test-v004.log`（GBK 编码） |
| 现有库 | 多个测试库（`v2ex_test_base` 等）+ 压测库；**禁止清空 data 目录 / 删除业务库** |
| CI 隔离 | 每个工作流独立 service container + 独立库名（`v2ex_ci` / `v2ex_sechost` / `v2ex_stab` / `v2ex_e2e_<browser>_<viewport>`） |
| 迁移 | `npx drizzle-kit migrate`（幂等） |

---

## G. CI Run（PR #29）

| 工作流 | 用途 |
|---|---|
| CI | 类型检查 / 单元测试 / E2E / Docker 构建与启动验证 |
| E2E 跨浏览器矩阵（v0.0.7） | 15 分片 × 200 = 3000 条 |
| 安全审计 Host Header | **本轮新增** —— 19 个攻击场景 |
| SMTP 稳定性 | **本轮新增** —— 30 次连续全流程 |
| 视觉回归验收 | 7 视口 × 3 浏览器 × 3 页面 = 63 组合 |
| 安装验证 | Linux 真实 Docker 安装 + Windows 脚本 |
| Docker/Redis 隔离验证 | R-16/R-17 九项验证 |

---

## H. 风险状态

| 风险 | 状态 | 备注 |
|---|---|---|
| **R-01** 原站素材历史暴露 | 🔴 **DEFERRED** | 本轮只读复核完成；**实际清理待主人单独授权**（属不可逆操作） |
| R-02 GHCR 可见性 | 🟢 MITIGATED | 无变化 |
| R-25 运行时数据入仓 | 🟡 已缓解 | 历史仍可达，与 R-01 同源 |

---

## I. 下一步具体动作（按优先级）

1. 等 PR #29 全部检查通过 ⇒ 合并（不绕过任何保护规则）
2. 视觉基线：经**人工审查**后用 `workflow_dispatch` + `update_baseline=true` 重建（冻结时钟后的新基线）
3. 跑通 SMTP 稳定性 30 次 ⇒ 取报告
4. 跨浏览器矩阵 15 分片全绿 ⇒ 取 3000 条统计
5. 版本同步到 **0.0.8**（`scripts/release/sync-version.mjs 0.0.8`）⇒ 提交 ⇒ 由该最终提交构建候选包（真实版本号 + SHA256SUMS）⇒ 真实 Docker 安装 / 升级 / 备份恢复 / 回滚验证
6. 写 `docs/DELIVERY_REPORT_v0.0.8.md` + CHANGELOG v0.0.8 段落 + 本文档定稿
7. **发布门禁 Go/No-Go**：R-01 未解决 ⇒ 停在**经验证的候选版本**，不建 Tag、不发公开 Release
8. R-01 实际清理：**等主人单独授权**（方案 A/B/C 见 `docs/R01_COMPLIANCE_REVIEW_v0.0.8.md`）

---

## J. 关键纪律提醒

- ❌ 不得跳过失败用例、删除断言、降低阈值
- ❌ 不得自动更新视觉基线（必须人工审查 + 显式 dispatch）
- ❌ 不得用重试次数掩盖偶发失败（如实登记）
- ❌ 不得 force push / 移动已发布 Tag / 修改已发布 Release / 删除仓库 / 改仓库可见性
- ❌ 不得清空本地 PG data 目录、删除已有业务库、乱改现有数据库配置
- ✅ 安全修复必须带**攻击复现 + 反向断言**
- ✅ 业务修复必须带**实际操作回归**
- ✅ 分级测试：日常提交跑相关单测 + 针对性 E2E；PR 验证跑完整单测 + Core E2E + 必要矩阵 + 视觉；最终候选跑完整矩阵 + 安全扫描 + Docker 实装
