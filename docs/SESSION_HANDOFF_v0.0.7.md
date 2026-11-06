# SESSION_HANDOFF_v0.0.7 — 跨会话交接

> 版本定位：**跨浏览器稳定性、真实 V2EX 视觉对照、测试可靠性和发行质量完善版**
> 分支：`feat/v0.0.7-cross-browser-parity`（PR #27）
> 起始基线：master `c4b3fba`（v0.0.6 已合并交付）

---

## A. 当前状态（2026-11-06 深夜）

| 项 | 状态 |
|---|---|
| 分支 | `feat/v0.0.7-cross-browser-parity`，HEAD `c793cb7` |
| PR | **#27**（https://github.com/alicia1030su/v2ex-clone/pull/27） |
| 工作区 | 干净 |
| 授权边界 | R-01 仍 DEFERRED ⇒ 不建 Tag / 不发公开 Release / 不改写历史 |

## B. 820 失败归因（P0，进行中）

### 已完成：失败面取证（来自 v0.0.6 遗留的 703 个失败产物 + 完整日志）

| 证据 | 数据 |
|---|---|
| `apiRequestContext.post: connect ECONNREFUSED 127.0.0.1:3010` | ×1022 |
| `page.goto: Could not connect to server` | ×368 |
| `expect` / `waitForURL`（连接故障的下游效应） | ×12 |

结论：v0.0.6 的 820 失败中，**绝大多数是「长时间压测后服务器不可达」**
（本机 Windows 单会话 16 project × 200 = 3200 条跑 2.5h 的资源问题），
同类用例单独跑全部通过；master worktree 对照实验早已排除产品回归。

### 结论：820 失败的最终归因

**主体是环境问题**（已由 Linux 隔离矩阵证实）：
v0.0.6 的 703 个 webkit 失败产物里，1022 处 `ECONNREFUSED` + 368 处
`Could not connect to server` ⇒ 全部是「长时间压测后服务器不可达」。
同一批用例在**隔离矩阵**（每片独立 runner VM / 库 / 端口）里
**3000 条全部执行、失败收敛到 9 个**。

**但矩阵同时暴露了 1 个真实产品缺陷**（V7-05）：303 重定向换 host。

### 进行中：Linux 分片矩阵实测（任务书 §三的方案）

**15 分片 = 3 浏览器 × 5 视口**，每片独立 runner VM / 数据库 / 端口 / SMTP 端口。

首个完整矩阵 run（`42235137721`，head `e0bad08`）实测：

| 分片 | 结果 |
|---|---|
| chromium × 5 视口 | **各 200/200 全过**（JSON 统计 expected:200 / unexpected:0） |
| firefox-375x812 | **199 passed / 1 failed** |
| firefox-390x844 / 768x1024 / 1280x900 / 1920x1080 | 待取数（artifact 已上传） |
| webkit × 5 视口 | 待取数（webkit-768x1024 有 792KB 失败产物 ⇒ 有真实失败） |

⇒ **820 失败的主体（webki 703 个 ECONNREFUSED）在 Linux 隔离环境不复现**，
环境归因成立；但矩阵同时暴露了**少量真实失败**，正在逐项根因。

### 已定位的真实失败 #1：`感谢：不能感谢自己的回复`（firefox-375x812）

- 现象：期望 400，实得 **403**
- 403 只可能来自 `guardCsrf`（业务校验在此之前）
- 已排除：thanks 路由与 middleware 自 v0.0.5 起逻辑未变（v0.0.6 只修注释乱码）；
  同分片另外 199 条全过（含 UI 感谢流程）
- **诊断 job 正在跑**（`tools/diag/firefox-thanks-403.mjs`）：
  同环境复现并打印 context cookies / document.cookie / 四种请求对照组
- 待诊断结果出来后定位根因并修复

## C. 本轮发现的 5 项缺陷（V7-01 ~ V7-05，全部有取证证据）

| ID | 性质 | 一句话 |
|---|---|---|
| V7-01 | 测试基础设施 | 矩阵汇总拿 `result.status` 比 `'expected'` ⇒ 200/200 全过被判失败（13 分片全红） |
| V7-02 | 测试辅助函数 | 浏览器有两个 `v2_csrf` cookie（按 host 各一），`cookies.find()` 取错那个 ⇒ 403 |
| V7-03 | 测试竞态 | `waitForURL` 在 URL 已匹配时**立即返回**（实测 1ms）⇒ 楼层计数早查 ⇒ 差 1 |
| V7-04 | 测试竞态 | 删除后 `router.refresh()` 的迟到 RSC（notFound）触发同 URL 导航 ⇒ 与 goto 竞态 |
| **V7-05** | **产品缺陷（严重）** | **303 重定向用 `request.url`（Next 按服务器 hostname 重建）⇒ 把用户带到错误 host ⇒ 两个 CSRF cookie ⇒ 后续写操作全 403；反代/多域名部署下用户被重定向到打不开的 host** |

V7-05 修法：新增 `src/lib/redirect-url.ts`（`buildRedirectUrl` 按请求头构造同源 URL），
replies 路由改用它；12 条单元测试锁住行为。

## C2. 已完成的工作

### 1. E2E 分片矩阵（`.github/workflows/e2e-matrix.yml`）

- 15 分片全隔离：独立 VM / 库 `v2ex_e2e_<browser>_<viewport>` / 端口 3100-3114 /
  SMTP 3200-3214 / `workers=1` / `retries:0` / `fail-fast:false`
- 防静默跳过：解析 JSON 报告，`total < 200 ⇒ not run > 0 ⇒ 判失败`
- 失败证据（trace/截图/日志）上传 artifact，保留 14 天
- **踩坑记录**（都已修，写在注释里）：
  ① env 键大小写重复（`no_proxy` + `NO_PROXY`）⇒ GitHub 判 already defined，
     整个工作流解析失败、零 job 零日志（最难排查的一类）；
  ② CLI `--reporter=list,json` 覆盖配置的 outputFile ⇒ JSON 不生成 ⇒
     汇总步骤把「200/200 全过」误判成失败；
  ③ 功能分支新增的 dispatch input 在默认分支不存在 ⇒ 422；
  ④ 独立诊断工作流在功能分支无法 dispatch（404）⇒ 并入矩阵工作流按 event 分流

### 2. V2EX 原站探测（`tools/visual/v2ex-probe.mjs` + 工作流）

- 开发机网络诊断取证：**DNS 正常**（128.121.146.109），
  TCP/TLS 直连与代理路径**均超时** ⇒ 网络层阻断，非配置问题
- 探测脚本：只读低频（每页一次）、只用公开页面、只输出 22 项数值测量
- 判定：不可达 ⇒ 明确 UNVERIFIED；可达 ⇒ artifact + 人工审查
- ⏳ **探测工作流的结果还没看**（PR #27 触发的那次）

### 3. EPERM 补丁审计（`scripts/ci/next-build-retry.cjs`）

- 八项要求逐条核对通过（受控加载 / 不涉生产 / 不吞错误 / 有上限 / 记录原因 /
  不关安全保护 / 不动无关进程 / 不无限重试）
- **修正**：重试耗尽时原先在 setTimeout 里 throw ⇒ uncaughtException；
  改为在占位 stream 上发 error 事件 + destroy 转发
- 行为测试：非 EPERM 走原生 error 路径 ✅ / 正常写入无回归 ✅

## D. 环境注意事项（本机）

- **本地 PostgreSQL 不稳定**：磁盘 fsync 劣化（单次 30-50s），
  实例起来后会死 ⇒ 本地复现路径当前不可用，改用 Linux CI 诊断
- **本机代理**：`HTTP_PROXY`（xray）且 `NO_PROXY` 为空 ⇒ Firefox/WebKit
  会读它；两个本地脚本已显式导出 `no_proxy`，测试地址已统一 `127.0.0.1`

## D2. 最终交付状态（2026-11-07）

| 项 | 状态 |
|---|---|
| PR #27（代码） | **MERGED**（squash）→ master `535c421` |
| PR #28（版本同步 + 交付报告） | release/v0.0.7 → master |
| **E2E 跨浏览器矩阵** | **15 分片 × 200 = 3000 条全部通过**（run `42256897834`，15/15 success，零失败/零跳过/零 not run） |
| 单元测试 | 341 + 12 = 353 条 |
| 视觉回归 | 63 组合三引擎一致零溢出，双平台基线 |
| 原站对照 | **UNVERIFIED**（开发机网络层阻断 + CI 反爬拦截；**不绕过**） |
| 唯一真实产品缺陷 | **V7-05 已修复**（303 重定向换 host → `src/lib/redirect-url.ts`） |
| 候选包 | `v0.0.7-candidate-d3c1682-deploy.zip`（51,773 B，SHA256 `1c11d806…` 校验 OK，**包内真实 0.0.7**） |
| 发布门禁 | PASS=62 WARN=13 FAIL=4 BLOCK=1 —— FAIL 已是版本同步流程；**BLOCK = R-01** |
| Tag / Release | **未创建**（R-01 未授权） |

**完整交付证据**：`docs/DELIVERY_REPORT_v0.0.7.md`

## E. 下一步（按优先级）

1. ✅ 诊断 → thanks 403 根因（两个 v2_csrf cookie + 303 换 host）
2. ✅ 矩阵 15 分片全绿（3000/3000）
3. ✅ 原站探测：查清不可达原因（网络层阻断 + 反爬拦截），维持 UNVERIFIED
4. ✅ 版本同步自动化 + 实际同步到 0.0.7
5. ⏳ PR #28 CI 全绿后合并 ⇒ 复核候选包（包内真实 0.0.7 已验）
6. ⏳ 若后续取得 R-01 授权：跑 preflight `--phase=release` → 建 Tag → 发 Release

## F. 授权边界

- 未授权：改写远端历史 / force push / 删改 Tag·Release / 改可见性 / 删生产数据
- 已授权：普通开发、修 Bug、改 CI、建分支、提交推送、建 PR、门禁通过后合并
