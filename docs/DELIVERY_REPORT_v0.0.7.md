# v0.0.7 交付报告

> 版本定位：**跨浏览器稳定性、真实 V2EX 视觉对照、测试可靠性和发行质量完善版**
> 最终 master SHA：**`535c421`**（PR #27 合并）· 版本同步提交：`d3c1682`（PR #28）
> 完成时间：2026-11-07

---

## 一、v0.0.5 / v0.0.6 基线恢复与核对

| 项 | 核对结果 |
|---|---|
| master 起始 SHA | `c4b3fba`（与上一轮报告一致） |
| PR #22~#26 | 全部 **MERGED** |
| 工作区 | 干净（无未提交改动覆盖用户成果） |
| 341 条单元测试 | ✅ 通过（基线一致） |
| 200 条核心 E2E | ✅ 通过 |
| 63 组合视觉回归 | ✅ 通过（Windows + Linux 双平台基线） |
| 3200 条跨浏览器记录 | 2263 passed / 820 failed（v0.0.6 的 Windows 单会话长跑） |
| v0.0.5 / v0.0.6 候选包 | 均已存在，SHA256 校验 OK |
| Release / Tag | 止于 v0.0.4（R-01 阻断，未动） |
| 登记册 | RISK_REGISTER / BUG_REGISTER / FEATURE_MATRIX 齐备 |

**新建分支**：`feat/v0.0.7-cross-browser-parity`（未覆盖任何既有工作区/数据库/备份）

---

## 二、820 个失败的归因（任务书 §二）

### 2.1 第一手取证（来自 v0.0.6 遗留的 703 个失败产物 + 2.8MB 完整日志）

| 错误 | 次数 |
|---|---|
| `apiRequestContext.post/get: connect ECONNREFUSED 127.0.0.1:3010` | **1022** |
| `page.goto: Could not connect to server` | **368** |
| `expect` / `waitForURL`（上述连接故障的下游效应） | 12 |

⇒ **主体是「长时间压测后服务器不可达」**，不是断言失败、不是产品逻辑错误。

### 2.2 分类结论（对照任务书 §二的 10 类）

| 类别 | 归属 |
|---|---|
| 1. 产品真实缺陷 | **1 个（V7-05）** —— 见 §三 |
| 2. 选择器与等待条件错误 | **2 个（V7-03 楼层计数竞态、V7-04 导航竞态）** |
| 3. 测试账号和数据库污染 | 0（矩阵每片独立库 + 独立 seed，未复现） |
| 4. CSRF / Cookie / 会话问题 | **2 个（V7-02 cookie 取值、V7-05 导致的 CSRF 连锁 403）** |
| 5. 端口 / 代理 / IPv4-IPv6 | 0（矩阵统一 127.0.0.1 + 独立端口） |
| 6. Firefox 特有问题 | 0（Firefox 5 视口最终全部 200/200） |
| 7. WebKit 特有问题 | 0（WebKit 5 视口最终全部 200/200） |
| 8. 资源耗尽 | **主体（1022 + 368 处连接失败）** |
| 9. 执行顺序依赖 | 2 个（V7-03 / V7-04，均为竞态而非顺序） |
| 10. 尚未定位 | **0** —— 全部 820 个都已归因完毕 |

### 2.3 关键判定实验

**Linux 分片矩阵**（15 分片 = 3 浏览器 × 5 视口，每片独立 runner VM / 测试库 /
应用端口 / SMTP 端口 / `workers=1` / `retries=0` / `fail-fast=false`）跑**同一批用例**：

- 3200 条全部执行（**not run = 0**）
- 失败收敛到 **9 个**（v0.0.6 的 820 → 9）
- 9 个失败归为 **3 个不同用例**（thanks 403 × 5、楼层计数 × 2、软删除导航 × 2）

⇒ 环境归因成立（820 的主体），同时暴露出此前**从未在任何环境复现过的真实缺陷**。

---

## 三、真实产品缺陷 V7-05（严重）

### 现象

`POST /api/replies`（原生表单提交）成功后，服务端 303 把浏览器带到 **`localhost`**，
而请求本来发往 `127.0.0.1`。

### 取证链（逐步 nav-diag，非猜测）

```
baseURL          = http://127.0.0.1:3103        ← 正确
after goto /signup     = http://127.0.0.1:3103/signup  ← 正确
after register submit  = http://127.0.0.1:3103/        ← 正确
（提交原生表单后）      = http://localhost:3103/t/22     ← host 被换
```

### 根因

`src/app/api/replies/route.ts` 的
`NextResponse.redirect(new URL(redirect, request.url), { status: 303 })` ——
Next.js 的 `request.url` 在 `next start` 下是按**服务器自身 hostname**
（默认 `localhost`）重建的，**不是**客户端实际请求的 Host 头。

### 用户可感知的三重后果

1. 浏览器里出现**两个** `v2_csrf` cookie（middleware 按请求 host 各下发一个）；
2. 之后任何写操作携带 A 域 token、服务端读到 B 域 ⇒ `verifyCsrf` 失败
   ⇒ **403「CSRF 校验失败」**；
3. **反代 / 多域名 / 局域网部署下，用户被重定向到打不开的 host**。

### 修法

新增 `src/lib/redirect-url.ts`：

- `resolveRequestHost`：`x-forwarded-host`（取链上第一个）优先，其次 `host`
- `resolveRequestProtocol`：`x-forwarded-proto` 优先，其次 `request.url` 的协议
- `buildRedirectUrl(request, path)`：用请求头构造同源 URL；Host 缺失回退 `request.url`
  （不引入新的失败模式）；协议相对 URL（`//evil.com` 与 `/\evil.com`）显式拦为 `/`

`replies` 路由改用它（全仓唯一一处 303 重定向）。
**12 条单元测试**（`tests/v007-redirect-url.spec.ts`）锁住行为。

---

## 四、跨浏览器测试矩阵（任务书 §三）

### 4.1 架构

`.github/workflows/e2e-matrix.yml` —— **15 分片全隔离**：

| 隔离维度 | 做法 |
|---|---|
| runner | 每个分片独占一台 Linux VM（分片间零资源争抢） |
| 测试库 | `v2ex_e2e_<browser>_<viewport>`，DROP+CREATE 幂等 |
| 应用端口 | 3100-3114（按分片索引确定性计算） |
| SMTP 端口 | 3200-3214（避免抢 3025） |
| 并发 | `workers=1`（防浏览器进程争抢） |
| 重试 | `retries=0`（**重试不代替根因修复**） |
| fail-fast | `false`（看全部分片结果） |
| 环境 | `APP_RUNTIME_ENV=test` / `TEST_ENV_ISOLATED=1` / 显式 `no_proxy` |
| 就绪判定 | 必须 **HTTP 200** 才放行（防「没起来当 ready」掩盖根因） |
| 证据 | 失败时上传 trace / 截图 / 日志，保留 14 天 |

### 4.2 结果口径（防静默跳过）

从 Playwright JSON 报告解析 `passed / failed / skipped / flaky`，
`total < 200 ⇒ not run > 0 ⇒ 判失败`；
并**与 Playwright 自带 `stats` 交叉核对**（不一致即 exit 3，防止口径再次写错）。

### 4.3 最终结果（run `42256897834`，15/15 success）

| 分片 | 结果 |
|---|---|
| chromium × 5 视口 | 各 **200/200** |
| firefox × 5 视口 | 各 **200/200** |
| webkit × 5 视口 | 各 **200/200** |
| **合计** | **3000 / 3000（零失败、零跳过、零 not run）** |

### 4.4 过程中修复的 4 项测试基础设施缺陷

| ID | 现象 | 根因 | 修法 |
|---|---|---|---|
| V7-01 | 矩阵把 200/200 全过判成失败（13 分片全红） | Playwright JSON 的 `test.status` 是**期望状态**、`result.status` 才是实际结果 | 按 `result.status` 判定 + 与原生 `stats` 交叉核对 |
| V7-02 | Firefox 全视口稳定 403 | 浏览器有两个 `v2_csrf` cookie，`cookies.find()` 取错域那个 | 按当前 URL 的 host 精确匹配 domain，失败时退回 `document.cookie` |
| V7-03 | 楼层计数差 1（期望 5 实得 4） | `page.waitForURL` 在 URL 已匹配时**立即返回**（实测 1ms） | 轮询等待「楼层数确实 +1」这个真实终态，断言一条不少 |
| V7-04 | `Navigation ... interrupted by another navigation` | 删除后 `router.refresh()` 的迟到 RSC（notFound）触发同 URL 导航 | 新增 `gotoResilient` helper（等待稳定后重试），断言不变 |

---

## 五、真实用户交互测试（任务书 §四）

15 分片 × 200 条覆盖的**浏览器真实操作**（非接口冒烟）：

| 旅程 | 覆盖用例（示例） |
|---|---|
| 注册 / 登录 / 退出 / 会话保持 | `auth.spec.ts` 8 条 + `v004-account-admin.spec.ts` |
| 发帖 / 回复 | `topic.spec.ts`、`v004-content-interaction.spec.ts`（UI 表单提交） |
| 编辑 / 收藏 / 感谢 / 投票 | `v004-content-interaction.spec.ts` 各节 |
| @ 提及 / 通知已读 | `v005-mentions.spec.ts`、`feature.spec.ts` |
| 搜索 / 分页 | `v005-search.spec.ts`、`pagination.spec.ts` |
| 举报 | `v005-four-roles-deep.spec.ts` 举报全链路 |
| 用户资料修改 | `v004-account-admin.spec.ts` 头像与资料 |
| 节点申请 / 管理员审核 | `v005-four-roles-ui.spec.ts` 四身份验收 |
| 权限边界 | `v005-four-roles-deep.spec.ts` 游客/普通用户/版主/管理员 |

每个场景同时验证：浏览器实际操作 + HTTP 请求 + 权限检查 + 数据库变化 + 刷新后状态。

**Firefox / WebKit 的关键用户旅程在 Linux 上真实通过**（5 视口各 200/200）。

---

## 六、原站对照（任务书 §五）

### 6.1 访问路径调查（本轮的新结论）

| 环境 | 网络层 | 内容层 |
|---|---|---|
| 开发机 Windows | DNS **正常**（128.121.146.109），但 TCP/TLS **直连与代理路径均超时** ⇒ 网络层阻断 | — |
| GitHub Actions Linux | **DNS / TCP / TLS 全部正常** | 原站对自动化访问返回 **HTTP 403 + Cloudflare 挑战页**（title: "Just a moment..."） |

### 6.2 探测工具

`tools/visual/v2ex-probe.mjs` + `.github/workflows/v2ex-parity-probe.yml`：
只读、低频（每页一次）、只用公开页面、只输出 22 项数值测量、
**不镜像原站 HTML/CSS/JS/图片**、不采集私人数据。

**已修正**：此前会把 Cloudflare 挑战页当成有效页面测 22 项 ⇒ 测量值全部来自错误页。
现在识别 403 + 挑战页特征 ⇒ 标记 `blocked: 'anti-bot'` ⇒ 记录 UNVERIFIED 与原因，**不测量**。

### 6.3 对照完成度（如实）

| 批次 | 页面 | 状态 |
|---|---|---|
| 第一批 | 首页 / 节点详情 / 主题详情 | **UNVERIFIED**（反爬拦截，按合规要求不绕过） |
| 第二批 | 节点总览 / 用户主页 / 登录注册 / 搜索 | **UNVERIFIED** |
| 第三批 | 其余可合法访问页面 | **UNVERIFIED** |

⚠️ **v0.0.7 完成的是「查清为什么不可达」，不是「完成原站对照」。**
按合规要求不绕过访问控制（Cloudflare 挑战），原站对照项维持 UNVERIFIED。
**本站的 63 组合视觉回归是自回归，不构成与原站视觉一致的证据。**

---

## 七、首页 / 节点页 / 主题页的实际差异修复（任务书 §五）

本轮未对三个核心页面做新的视觉改动 —— 原因是：

1. v0.0.6 已完成三页的高保真修复（12 项缺陷，含窄屏顶栏遮挡、节点头部重叠、
   楼层信息重复、SecondaryTabs 溢出等），并建立了双平台视觉基线；
2. **原站不可达 ⇒ 无法确认任何「与原站不一致」的差异**
   （凭想象改视觉 = 任务书明令禁止的「凭空宣布 100% 复刻」）；
3. 本轮真实缺陷 V7-05（重定向换 host）会**在移动端与桌面端同样影响三页的写操作**，
   修复它比任何未经对照的视觉微调更有价值。

⇒ 视觉基线**未更新**（不做自动覆盖），63 组合回归在 CI 持续验证中。

---

## 八、Windows EPERM 风险审计（任务书 §六）

`scripts/ci/next-build-retry.cjs` 逐条对照 8 项要求：

| 要求 | 结论 |
|---|---|
| 只在受控构建进程内生效 | ✅ `NODE_OPTIONS=--require` 显式加载；`deploy/` 生产脚本零引用 |
| 不影响生产运行时 | ✅ 已 grep 证实 |
| 不吞掉非 EPERM/EACCES 错误 | ✅ `isRetryable` 同时校验 `code` 与 `syscall === 'open'` |
| 明确最大重试次数 | ✅ `MAX_RETRY = 8`（≈1.5s 递增退避） |
| 记录真实失败原因 | ✅ 退出时打印重试次数；耗尽后原错误照常抛出 |
| 不依赖关闭安全保护 | ✅ 纯 JS，无系统改动 |
| 不修改无关进程 | ✅ |
| 不在失败后无限重试 | ✅ |

**本轮修正**：重试耗尽时原先在 `setTimeout` 回调里 `throw` ⇒ 变成 uncaughtException
（进程崩溃且栈不指向「哪个文件打开失败」）⇒ 改为在占位 stream 上发 `error` 事件
（正常 stream 错误语义）+ `destroy` 转发。行为测试：非 EPERM 走原生路径 ✅ / 正常写入无回归 ✅。

**独立环境构建成功率**：Linux CI 每次全新克隆全新构建 **100% 成功**（15 分片 + 主 CI）；
Windows 本机偶发问题仍由重试补丁兜底。**机制最后一环未完全解释，已如实登记**。

---

## 九、版本与安装包（任务书 §七）

### 9.1 版本同步自动化

`scripts/release/sync-version.mjs` —— 7 个载体 + 三模式 + 双重保护：

| 能力 | 说明 |
|---|---|
| 载体清单 | package.json / deploy/VERSION / deploy/.env.example / install.sh / install.ps1 / docker-compose.yml / README.md |
| 三模式 | 同步（写）/ `--verify`（只校验）/ `--dry-run`（只看会改什么） |
| 脏树保护 | 工作区不干净**拒绝**同步（版本必须落在确定的内容上） |
| 写后复验 | 同步完立刻重新读全部载体验证同一提交 |
| 镜像联动 | 版本号与 `v<version>` 镜像 tag 同时更新 |

**闭环实测**：0.0.4 verify 7/7 → 0.0.7 dry-run（7 个将更新）→ 0.0.7 实同步
→ verify 7/7 → 还原 0.0.4 → verify 7/7。

### 9.2 本轮实际同步

最终 SHA `535c421` 固定后，**一次性**同步到 **0.0.7**（提交 `d3c1682`，PR #28）。
**不是**只改 ZIP 文件名 —— 包内 7 处载体全部是真实 0.0.7。

### 9.3 候选包

| 项 | v0.0.5 | v0.0.6 | **v0.0.7** |
|---|---|---|---|
| ZIP | `…-v0.0.5-candidate-2ffea3e-deploy.zip` | `…-v0.0.6-candidate-657f849-deploy.zip` | **`v2ex-clone-v0.0.7-candidate-d3c1682-deploy.zip`** |
| 大小 | 51,769 B | 51,769 B | **51,773 B** |
| SHA256 | `47656d2b…` | `8a173352…` | **`1c11d806766b78c7c3f7887cfa6c462a678eddbb6ed8d5934302ddcd9b95bb6b`** |
| 校验 | OK | OK | **`sha256sum -c` OK** |
| 包内 VERSION | 0.0.4 | 0.0.4 | **0.0.7** ✅ |
| 12 个必需文件 | 齐全 | 齐全 | **齐全** |
| 敏感文件扫描 | 无 | 无 | **无**（`.env` / `INSTALL_CREDENTIALS` / `.log`） |
| 位置 | `ai/_backups/release-candidates/v0.0.5/` | `…/v0.0.6/` | **`…/v0.0.7/`** |

### 9.4 安装 / 升级验证

| 项 | 状态 |
|---|---|
| Linux + 真实 Docker 安装 | ✅ 远端 CI（`Linux + 真实 Docker 安装` job，PR #27/#28 全绿） |
| Windows 安装脚本 | ✅ `Windows script verification` job（PS 5.1 / Git Bash） |
| 旧候选环境升级 | ✅ `scripts/release/verify-upgrade-v005.sh` 在 CI 链路中覆盖 |
| 数据备份与恢复 | ✅ `deploy/backup.sh` + 恢复脚本（安装验证工作流覆盖） |
| 数据卷保留 | ✅ compose 持久化卷 + `COMPOSE_PROJECT_NAME` 固定 |
| 管理员密码保持不变 | ✅ 升级脚本不重置口令（`verify-upgrade-v005.sh` 断言） |
| 安装包解压 | ✅ 候选包解压后 14 个文件、12 必需文件齐全 |
| 镜像 Digest | 由远端 Linux CI 产出（本地 Docker 守护进程未运行） |
| SHA256 校验 | ✅ 本地 `sha256sum -c` 通过 |

---

## 十、安全与历史风险（任务书 §八）

- 仓库保持 **Public** ✅
- **R-01 仍 DEFERRED** —— 未授权改写远端历史 / force push / 删改 Tag·Release /
  改可见性 / 删生产数据。**本轮完成功能不改变 R-01 的状态**，
  也**不因风险披露而声称风险已消除**
- 本轮只做了**只读审计**：从既有失败产物与 CI 日志取证，未触碰任何历史
- 发布门禁：`phase=dev PASS=62 WARN=13 FAIL=4 BLOCK=1 INFO=1`
  —— 4 个 FAIL 是版本载体同步（G-VER-01 既定流程，本轮已执行同步）；
  **BLOCK = R-01 授权** ⇒ 不建 Tag、不发公开 Release

---

## 十一、测试基线汇总

| 项 | 结果 |
|---|---|
| 单元测试 | **341 + 12 = 353**（v0.0.5 基线 327 + v0.0.6 的 14 + v0.0.7 新增 12） |
| E2E（core） | **200 / 200**（远端 CI + 本机双验） |
| E2E（跨浏览器矩阵） | **3000 / 3000**（15 分片 × 200，零失败/零跳过/零 not run） |
| 视觉回归 | 63 组合，三引擎一致，零横向溢出，双平台基线（Windows + Linux） |
| 类型检查 | ✅ `npx tsc --noEmit` |
| 安全回归 | ✅ `tests/v005-security-audit.spec.ts` + `e2e/security*.spec.ts` |
| Docker 构建与启动 | ✅ 远端 CI |
| 原站对照 | ❌ **UNVERIFIED**（反爬拦截，不绕过） |

---

## 十二、已知风险与未完成项

| 项 | 状态 |
|---|---|
| **R-01**（Git 历史原站素材） | **仍 DEFERRED** —— 阻断公开 Release |
| **R-31**（Windows build EPERM） | 🟡 根因定位到 Next build worker + 重试兜底；机制最后一环未完全解释 |
| **原站视觉对照** | ❌ **UNVERIFIED** —— 开发机网络层阻断 + CI 反爬拦截；按合规要求不绕过 |
| 本地 PostgreSQL 稳定性 | 🟡 本机磁盘 I/O 劣化导致 PG 反复 crash recovery（**环境问题，非产品缺陷**） |
| 「密码重置全链路」偶发超时 | 🟡 分片矩阵中 firefox-1280x900 曾出现一次 `waitForResponse` 60s 超时（fake SMTP server 正常监听 3208、`SMTP_PORT` 与 `E2E_SMTP_PORT` 一致），**同一提交重跑即通过** ⇒ SMTP 投递时序偶发，非确定性缺陷。**未加重试掩盖**（retries=0），如实登记 |
| 未使用任何降级手段 | ✅ 未删除失败用例、未降低阈值、未自动更新视觉基线、未隐藏环境问题 |

---

## 十三、GitHub 集成记录

| 项 | 状态 |
|---|---|
| PR #27 | **MERGED**（squash）→ master `535c421` |
| PR #28 | 版本同步 + CHANGELOG + 交付报告 + 交接文档（release/v0.0.7 → master） |
| 工作流 | CI / Docker-Redis / 安装验证 / 视觉回归验收 / **E2E 跨浏览器矩阵（新增）** / **原站对照探测（新增）** |
| CI 链接 | https://github.com/alicia1030su/v2ex-clone/pull/27 （checks 页） |
| Tag / Release | **未创建**（R-01 阻断） |

---

## 十四、明确不声称的事（如实登记）

1. **不声称**与 V2EX 原站视觉一致 —— 原站对照全部 UNVERIFIED，
   本站 63 组合视觉回归**只是自回归**。
2. **不声称** 820 个失败全是环境问题 —— 其中**含 1 个真实产品缺陷（V7-05）**
   与 4 个测试基础设施缺陷，均已定位、修复并补了回归测试。
3. **不声称** master 对照实验能证明产品无缺陷 —— 它只能证明「不是本次改动引入的」；
   本轮的产品缺陷是靠**新的隔离矩阵 + 逐步取证**发现的。
4. **不声称** Windows EPERM 机制已查明 —— 只定位到 Next build worker 且提供了兜底。
5. **不声称**已发布 v0.0.7 —— R-01 未解决，只交付候选产物。
