# v0.0.8 交付报告

> **日期**：2026-11-07
> **版本定位**：安全加固、稳定性治理、部署可靠性与真实运营能力完善版
> **发布状态**：**候选版本**（R-01 未解决 ⇒ **未建 Tag、未发公开 Release**）

---

## 0. 一句话结论

v0.0.8 完成两个 P0（**Host Header Poisoning 真实攻击面**、**SMTP 偶发竞态**）、
补齐 14 项运维能力、量化归因本机 PG 不稳定、修复**三处 CI 假绿漏洞**，
并交付 **3060 条跨浏览器用例全通过 + 19 个攻击场景全防御 + SMTP 连续 30 次全通过**
的可验证候选产物。

---

## 1. 交付清单对照（任务书 §十三）

| # | 要求 | 交付物 | 状态 |
|---|---|---|---|
| 1 | 安全审计报告（Host Header 与重定向） | `docs/SECURITY_AUDIT_v0.0.8.md` | ✅ |
| 2 | SMTP 竞态修复 + 连续稳定性测试 | 独立进程 server + 事件驱动 fixture；**30/30 通过** | ✅ |
| 3 | PostgreSQL 测试环境报告 | `docs/POSTGRES_ENV_REPORT_v0.0.8.md` | ✅ |
| 4 | 监控及备份恢复验证 | `src/lib/observability.ts` + `/api/admin/ops` + `deploy/health-check.sh` + 备份完整性校验 | ✅ |
| 5 | 完整单元与 E2E 结果 | 见 §3 | ✅ |
| 6 | 跨浏览器矩阵结果 | **15 分片 × 204 = 3060 条全通过** | ✅ |
| 7 | 视觉回归结果 | 63 组合，**回归项 0** | ✅ |
| 8 | GitHub PR 和最终 CI 链接 | PR #29（代码）/ #30（版本同步）；CI 全绿 | ✅ |
| 9 | 安全扫描报告 | 攻击矩阵 19 场景 + 24 条安全单测 + 12 条脱敏单测 | ✅ |
| 10 | 完整源码提交 SHA | master `3dc718c`（代码）+ release 分支（版本同步） | ✅ |
| 11 | 可安装的 v0.0.8 候选 ZIP | `v2ex-clone-v0.0.8-candidate-<sha>-deploy.zip` | ✅ |
| 12 | SHA256SUMS 和镜像 Digest | SHA256SUMS 已生成；**镜像未构建**（见 §7） | ⚠️ |
| 13 | 正确的中文 CHANGELOG | CHANGELOG v0.0.8 段落（A~H 八节） | ✅ |
| 14 | 最新风险登记表 | RISK_REGISTER 已更新 v0.0.8 只读复核 | ✅ |
| 15 | 版本发布门禁 Go/No-Go | **NO-GO**（R-01 未解决）⇒ 停在候选 | ✅ |
| 16 | R-01 仍需主人决定的事项 | `docs/R01_COMPLIANCE_REVIEW_v0.0.8.md` | ✅ |

---

## 2. P0 安全加固（任务书 §三）

### 2.1 审计发现的真实攻击面

v0.0.7 为修复「request.url 按服务器 hostname 重建」引入的
`src/lib/redirect-url.ts` **直接采信请求头**构造绝对 Location：

```ts
resolveRequestHost   → x-forwarded-host（取链上第一个）优先于 host
resolveRequestProtocol → x-forwarded-proto 优先于 request.url
buildRedirectUrl     → `${proto}://${host}${path}`
```

⇒ 在**直连**或**代理未剥离客户端转发头**的部署形态下，
攻击者可控制 303 的**域名与协议**（开放重定向 / 协议降级 / 缓存投毒 /
反代跳错域名）。同类风险还在找回密码邮件链接的基址回退链。

### 2.2 修复

| 修复 | 做法 | 攻击面 |
|---|---|---|
| **303 改用站内相对 Location** | `src/lib/redirect.ts` 的 `seeOther()`（RFC 7231 §7.1.2）；浏览器按**实际请求 URL** 解析 | **零**（不经任何请求头） |
| **邮件链接 fail-closed** | `src/lib/public-base-url.ts` 的 `resolvePublicBaseUrl()`：只信 `PUBLIC_BASE_URL` → `APP_URL`，严格校验；未配置 ⇒ **拒绝发信** | **零**（不退回请求头） |
| 删除 `src/lib/redirect-url.ts` | 已无生产引用 | — |

**附带收益**：反代 / 多域名 / 局域网部署自动正确；
`localhost` 与 `127.0.0.1` **不可能再混用**（Location 不含 host）；
不会产生第二个域的 `v2_csrf` cookie。

### 2.3 攻击矩阵实测（19 场景，真实应用）

`tools/security/host-attack-matrix.ts` + `.github/workflows/security-host-audit.yml`
— run `42336954558`：**19/19 SAFE，0 VULNERABLE**

- **13 个 303 场景**（正常 Host / 伪造 Host / 伪造 XFH / 伪造 XFP /
  多值转发头 / 不可信代理 / 开放重定向参数 ×3 / 畸形 Host ×3）
  ⇒ Location **恒为站内相对路径**（`/t/11` 或 `/`）；
- **4 个密码重置链接投毒场景** ⇒ 重置链接**恒指向运维配置的基址**；
- **2 个 HTML 泄漏场景** ⇒ HTML 中无攻击者域名。

报告：`docs/SECURITY_AUDIT_v0.0.8.md`

---

## 3. P0 SMTP 竞态根治（任务书 §四）

### 3.1 根因

fake SMTP server 原先跑在 **Playwright worker 进程内** ⇒ 与浏览器协议处理
**共用事件循环** ⇒ worker 繁忙时 SMTP socket 的 `'data'` 事件被延迟
⇒ 客户端空闲超时竞速触发 ⇒ 投递失败 ⇒ 邮件永远不到
（v0.0.7 矩阵偶发超时，同一提交重跑即过）。

### 3.2 修复（确定性就绪 + 事件到达）

| 组件 | 作用 |
|---|---|
| `tests/helpers/fake-smtp-standalone.ts` | **独立进程** server；stdout JSON-lines（ready / mail / stopped / error）；优雅退出并回报 `openSockets`；父进程消失自动退出（防僵尸） |
| `e2e/smtp-fixture.ts` | **事件驱动** fixture：ready 后才发请求、mail 到达才断言（含消费语义防旧邮件重复匹配）、stopped 校验 `openSockets=0` + `exitCode=0`、进程猝死立即明确失败 |
| `e2e/v005-password-reset-flow.spec.ts` | 端口契约校验 + 资源释放断言 + 新增「服务中断后错误可观察」用例 |
| `e2e/v008-smtp-stability.spec.ts` | 连续 **30 次**全流程，每次记录邮件延迟/耗时/资源状态；默认 testIgnore 排除（不打乱矩阵 200 条口径） |

**无固定 sleep、无轮询、无重试掩盖。**

### 3.3 稳定性结果

**30/30 全通过**，邮件延迟 **p50=131ms / p95=174ms / max=182ms**，
server `received=30 / openSockets=0 / exitCode=0`。

---

## 4. P1 运维与部署可靠性（任务书 §六）

| 能力 | 实现 | 验证 |
|---|---|---|
| 健康检查（存活） | `GET /api/health` | 单元 + CI |
| 就绪检查 | `GET /api/health/ready`（DB 必查、Redis 配置了才查，200/503） | CI 真实栈 |
| PG / Redis 可用性 | 就绪探针 + `/api/admin/ops` | CI 真实栈 |
| 结构化错误日志 | `src/lib/observability.ts`（JSON-lines ⇒ docker logs / journald） | 12 条单测 |
| 管理员操作审计 | 既有 `/api/admin/logs` | 既有 |
| 慢查询监测 | middleware 埋点（≥2s 登记 + warn 日志） | CI |
| 关键接口错误率 | middleware 埋点（状态码分布 / 4xx / 5xx / 按路由） | CI |
| 异常限流统计 | `rateLimit()` 内埋点（**所有**限流全覆盖） | 单元 |
| SMTP 投递失败统计 | mailer 埋点（按 purpose 分类） | 单元 |
| 备份完整性校验 | `backup.sh` 生成 `.sha256` + gzip 结构 + 内容非空；`restore.sh` **恢复前**校验（不过则拒绝恢复） | 本地实测三项正确 |
| 备份恢复演练 | 既有 install-verify + **新增**升级验证脚本（备份→恢复→指纹一致） | CI |
| 容器重启恢复 | 既有 install-verify | CI |
| 磁盘空间预警 | `deploy/health-check.sh`（阈值 85%） | **CI 真实栈实跑**（docker-verify 新增步骤） |

**脱敏**（§六 硬要求）：password / token / cookie / session / secret /
authorization / database_url / redis_url / reset_token / api_key
的**值一律 `[redacted]`**；键名大小写不敏感；嵌套/数组递归；超长截断；
循环引用不栈溢出。**12 条单测锁定**。

**监控不泄露敏感信息**：只返回计数与布尔状态；
慢请求只给路由名；磁盘只给可用比例。

---

## 5. P1 测试环境稳定性（任务书 §五）

`docs/POSTGRES_ENV_REPORT_v0.0.8.md` —— **量化归因**：

| 项 | 实测 |
|---|---|
| 直接原因 | 恢复期**逐文件 fsync ≈ 10 秒**（41 次日志事件） |
| 对照 | 同盘普通文件 flush-to-disk 仅 **6~26 ms** ⇒ 非通用 fsync 路径 |
| 已排除 | 磁盘空间（770 GB 空闲）、卷健康（Healthy）、杀软（未启用）、内存（16 GB） |
| 结论 | **环境层劣化，非产品缺陷** |

**处置**：重型测试全部迁往 **Linux CI 隔离容器**；
新增 `tests/static/` **纯静态测试通道**（不依赖 DB ⇒ 本机 PG 不稳也不误报）。

**处置纪律**（严格遵守）：未清空 data 目录、未删除业务库、
未修改现有实例配置、**未用 `fsync=off` 绕过**（那会削弱数据安全性）。

---

## 6. P1 视觉与测试策略（任务书 §八 / §九）

### 6.1 视觉基线的时间炸弹（**非本轮改动引入**）

**对照实验**：master（未改任何 UI）跑视觉回归**逐字节相同地失败**。

**根因**：相对时间文案在 **Server Component** 里用 **Node 时钟**渲染
⇒ 同一份种子数据在不同时刻渲染出**不同长度**的文本
⇒ 320px 窄视口换行 ⇒ 容器高度变化 120px ⇒ 基线随时间漂移。

**修复**：`APP_NOW` 注入确定性时钟（未设置 = 真实时钟 ⇒ 生产行为不变；
非法值 ⇒ 明确错误日志）+ 基线自带 `clockAnchor` + 浏览器时钟同步冻结。
基线仅**补元数据字段**，未改任何测量值。

### 6.2 分级测试策略

| 层级 | 内容 | 本轮落地 |
|---|---|---|
| 日常提交 | 相关单测 + 针对性 E2E | ✅ 静态测试通道（0.5s，不依赖 DB） |
| PR 验证 | 完整单测 + Core E2E + 必要矩阵 + 视觉 | ✅ |
| 最终候选 | 完整矩阵 + 安全扫描 + Docker 实装 + 升级验证 | ✅ |

**未**跳过失败用例、**未**删除断言、**未**降低阈值、
**未**自动更新视觉基线、**未**用重试掩盖偶发失败。

### 6.3 原站对照：仍 UNVERIFIED

- 开发机 Windows：DNS 正常，TCP/TLS 直连与代理路径**均超时** ⇒ 网络层阻断；
- GitHub Actions Linux：DNS/TCP/TLS **全通**，但原站对自动化访问返回
  **HTTP 403 + Cloudflare 挑战页**；
- 按合规要求**不绕过**访问控制、不用异常频率、不冒充更高权限身份；
- 探测脚本已能识别挑战页 ⇒ 标记 UNVERIFIED，**不把错误页当有效对照**。

---

## 7. P1 版本与候选安装包（任务书 §七）

### 7.1 版本载体（7 个，真实一致）

| 载体 | 值 |
|---|---|
| package.json | 0.0.8 |
| deploy/VERSION | 0.0.8 |
| deploy/.env.example | `V2EX_IMAGE=…:v0.0.8` |
| deploy/install.sh | `APP_VERSION=0.0.8` / `DEFAULT_IMAGE=…:v0.0.8` |
| deploy/install.ps1 | `$AppVersion = '0.0.8'` / `$DefaultImage=…:v0.0.8` |
| deploy/docker-compose.yml | `image: …:v0.0.8` |
| README.md | 当前版本 v0.0.8 |

同步由 `scripts/release/sync-version.mjs` 执行（脏树保护 + 写后复验 + 三模式）。

### 7.2 证明链

```
代码提交（master 3dc718c）
   └─→ PR #29 合并（CI 全绿：3060 E2E + 19 攻击场景 + 30 SMTP + 63 视觉）
        └─→ 版本同步提交（release 分支，7 载体复验通过）
             └─→ 候选包构建（由该提交构建，非改名）
                  └─→ SHA256SUMS + 内容核验（14 必需文件齐全、无敏感文件、7 处版本真实 0.0.8）
```

**回答任务书 §七 的四个问题**：

| 问题 | 答案 |
|---|---|
| 这个 ZIP 来自哪个提交？ | 文件名含提交 SHA；由 release 分支的同步提交构建 |
| 镜像是否来自同一源码树？ | **本轮未构建镜像**（GHCR 未推送新 tag）⇒ 见下 |
| ZIP 内的版本号是什么？ | **7 处载体全是真实 0.0.8**（已逐项核验） |
| 实际安装的又是哪一份？ | 由 CI 的 install-verify 实测（Linux 真实 Docker + Windows 脚本） |

### 7.3 镜像 Digest：未产出（如实登记）

本轮**未构建也未推送** v0.0.8 镜像到 GHCR ⇒ **无镜像 Digest**。
原因：
1. R-01 未解决 ⇒ 不应发布公开制品（推 tag 到 GHCR 会产生公开可见的镜像层）；
2. 任务书 §十三 的「镜像 Digest（如已构建）」本身允许「未构建」的状态。

**若后续授权发布**，需按顺序执行：构建 → 推送 → 记录 digest →
在候选包内记录该 digest → 复验安装。

### 7.4 安装与升级验证

| 验证 | 位置 | 状态 |
|---|---|---|
| Linux 真实 Docker 安装 | CI install-verify（ubuntu runner + 真 Docker） | ✅ |
| Windows PowerShell 5.1 / Git Bash 脚本 | CI install-verify（windows runner） | ✅ |
| 数据持久化 / 管理员口令不变 / 端口未暴露 | CI install-verify | ✅ |
| 备份与恢复 | CI install-verify | ✅ |
| 运维体检脚本实跑 | CI docker-verify（**本轮新增步骤**） | ✅ |
| **原地升级 v0.0.7 → v0.0.8** | `scripts/release/verify-upgrade-v008.sh`（CI 新增步骤）：旧迁移集建库 → 灌探针 → **同一库上**跑新迁移 → 指纹不变 → 幂等（连跑 3 次）→ 备份 → 恢复 → 指纹一致 | ✅ |

---

## 8. P1 R-01 历史合规（任务书 §十）

`docs/R01_COMPLIANCE_REVIEW_v0.0.8.md` —— **只读复核**：

- 受影响对象**全量登记 81 个**（assets 2 / html 46 / screenshots 20 / visual 13）
  —— 含历史参考截图与差异热力图，**不止** HTML/CSS/JS；
- 可达性：`master` **已不可达** ✅；
  仍可达 = **4 个已发布 Tag**（v0.0.1~v0.0.4）+ **6 个远端分支**；
- **新增区分**：`src/app/globals.css` 与原站 `combo.css` 的**声明块交集 = 0**
  ⇒ 本站样式是**独立实现** ⇒ 清理**不应**包含它；
- 方案 A 细化（受影响 Tag 由 3 个增至 4 个；filter-repo 只含 4 个 evidence 目录）
  + 回滚方案 + GitHub Support 资料清单 + 建议执行顺序 + 不可逆风险说明。

**本轮未执行**任何历史改写 / force push / Tag 移动或删除 / Release 修改 /
仓库删除 / 可见性变更 —— **仍待主人单独授权**。

---

## 9. CI 纪律：三处「假绿」漏洞（任务书 §九）

| # | 漏洞 | 现象 | 修复 |
|---|---|---|---|
| 1 | **汇总退出码无人消费** | e2e-matrix 汇总判失败（exit 1）时 **job 仍绿** | 新增独立判定步骤把退出码落地为 job 失败；v2ex-parity-probe 同类问题一并修 |
| 2 | **语法错误 tsc 抓不到** | helpers.ts 的注释块错误 ⇒ 15 个分片「0 个用例被收集」却显示 success | 新增 `tests/static/` 语法护栏（TS `parseDiagnostics`，**不依赖 DB**） |
| 3 | **测试前提未验证** | 攻击矩阵曾「19/19 SAFE」但 **303 从未发生** | `maxRedirects: 0` + 前置探针（P1/P2）证明被测路径确实执行 |

**教训**：**「测试全绿」不等于「被测行为被检查到了」。**

---

## 10. 测试结果总表

| 项 | 结果 | 证据 |
|---|---|---|
| 跨浏览器矩阵 | **15 分片 × 204 = 3060 条全通过**，零失败/零跳过/零 not run | run `42341171720` |
| Host 攻击矩阵 | **19/19 SAFE**，0 VULNERABLE | run `42336954558` |
| SMTP 稳定性 | **30/30 通过**，p50=131ms / max=182ms | smtp-stability artifact |
| 单元测试 | 341 + 24（安全）+ 8（时钟）+ 12（观测）+ 3（静态护栏） | CI unit job |
| 视觉回归 | 63 组合，**回归项 0** | 视觉回归 artifact |
| 静态测试 | 15/15（不依赖 DB） | vitest.static.config.ts |
| Docker / 安装 / 升级 / 运维体检 | 全绿 | 各 workflow |

---

## 11. 已知限制（如实披露）

| 限制 | 说明 |
|---|---|
| `PUBLIC_BASE_URL` 未配置 ⇒ **不发**重置邮件 | fail-closed 的**预期行为**；运维须配置（`.env.example` 已写明）。生产部署必须设置，否则「忘记密码」不可用 |
| **无 v0.0.8 镜像 Digest** | 本轮未构建/未推送镜像（见 §7.3） |
| 原站视觉对照 **UNVERIFIED** | 反爬拦截，不绕过（见 §6.3） |
| 本机 PostgreSQL 不稳定 | 环境层劣化（见 §5）；全部发布门禁已迁往 Linux CI |
| R-01 未解决 | 仓库仍为 Public；81 个历史对象在 4 个 Tag + 6 个分支上仍可达（见 §8） |
| SMTP 稳定性只覆盖「找回密码」链路 | 其它邮件用途（通知/验证）未做 30 次连续验证 |

---

## 12. 发布门禁 Go/No-Go

### **NO-GO —— 不公开发布**

| 门禁 | 状态 |
|---|---|
| 功能与安全条件 | ✅ 满足（3060 E2E + 19 攻击场景 + 30 SMTP + 63 视觉全绿） |
| 版本载体一致性 | ✅ 7/7 真实 0.0.8 |
| 候选包可安装性 | ✅ CI 实测（Linux Docker + Windows 脚本） |
| 备份/恢复/升级 | ✅ 实测（含新增的原地升级验证） |
| **R-01 历史合规** | 🔴 **未解决**（需主人单独授权） |
| 镜像 Digest | ⚠️ 未构建（与 R-01 联动） |

### 需要主人决定的事项

1. **R-01 清理方案 A / B / C**（见 `docs/R01_COMPLIANCE_REVIEW_v0.0.8.md` §五）；
2. 是否授权**构建并推送 v0.0.8 镜像**到 GHCR（会产生公开可见的镜像层）；
3. 是否授权**创建 v0.0.8 Tag 与 Release**（当前 tags/releases 止于 v0.0.4）。

**在获得上述授权前**：停在**经验证的候选版本**，
不建 Tag、不发公开 Release、不推镜像、不动历史。
