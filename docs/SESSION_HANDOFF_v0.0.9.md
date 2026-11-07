# 会话交接文档 · v0.0.9

> **日期**：2026-11-07
> **分支**：`feat/v0.0.9-release-readiness`
> **基线**：`master` @ `faf8d89`（v0.0.8 交付报告提交）
> **状态**：**候选开发与验证进行中** —— 未创建正式 Tag、未创建/修改 Release、
> 未推送 GHCR 镜像、未改写远端历史。

---

## 一、当前分支与 HEAD

| 项 | 值 |
|---|---|
| 分支 | `feat/v0.0.9-release-readiness` |
| HEAD | 见 `git rev-parse HEAD`（本文件随最终提交更新） |
| 上游 | `origin/feat/v0.0.9-release-readiness` |
| PR | [#31](https://github.com/alicia1030su/v2ex-clone/pull/31) → `master` |
| 工作区 | 干净 |

### 本轮提交序列

| SHA | 内容 |
|---|---|
| `16b5f3c` | 候选离线安装链路（模式 B）+ 升级基线数据生成器 |
| `358a5c3` | **修复 API 错误率统计失效**（§六，两个叠加缺陷） |
| `9fc6571` | 可观测性跨 bundle 可见性回归测试（6 项） |
| `5955649` | 四角色完整 UX 验收（12 项）+ 调试端点 table-count |
| `3789957` | 运维可靠性故障注入验证脚本（21 项） |
| `506b246` | 全新用户安装验收脚本（22 项断言） |
| `a4d71c8` | 长时间运行稳定性验证（本地脚本 + CI 持久运行器） |
| `be47395` | **收紧 .gitignore**（防止隔离环境文件入库） |
| `fef02a6` | 同步版本载体到 0.0.9（7 个载体） |
| `e766198` | 修复候选构建与长跑脚本的两个 CI 实测缺陷 |

---

## 二、已完成任务

### P0 §二 · 候选离线安装链路（模式 B）

| 文件 | 作用 |
|---|---|
| `scripts/release/build-candidate.sh` | 固定 SHA → 构建候选镜像 → 导出 tar → 候选 ZIP + SHA256SUMS + 候选清单。强制校验 `HEAD == --sha` 且工作区干净；**不推送任何远端镜像仓库**。 |
| `scripts/release/rewrite-candidate-image.mjs` | 改写候选包内 4 处镜像引用（compose / `.env.example` / `install.sh` / `install.ps1`）为候选标签 —— 解决 v0.0.8「候选包指向不存在的远端镜像」问题。 |
| `scripts/release/verify-candidate-install.sh` | 独立环境 `docker load` → compose → 迁移 / Redis / 健康检查 / 登录 / 发帖 / 回复 / 重启不丢数据 / 端口未暴露。 |

**三种状态在产物清单与 CI 输出中明确区分**：
候选构建成功 ✅ / 候选环境安装成功 ✅ / 正式公开发布成功 ⬜（本轮未涉及）。

### P0 §三 · 全新用户安装验收

`scripts/release/verify-fresh-install.sh` —— 13 项清单逐条可执行，**22 项断言全通过**。
全新目录 + 显式清空开发机环境变量（`DATABASE_URL` / `SESSION_SECRET` / `V2EX_IMAGE` …）。

### P0 §四 · v0.0.4 → v0.0.9 真实升级

基线用**真实发布过的 v0.0.4**（tag `c0e7396`，3 个迁移），不是 v0.0.8。

`scripts/release/generate-upgrade-fixture.mjs` 通过**真实 HTTP 接口**生成 seed 缺失、
而升级最易丢失的数据：通知 / 积分流水 / 感谢 / 投票 / 收藏 / 头像文件。

### P0 §五 · 四角色 UX 验收

`e2e/v009-four-roles-acceptance.spec.ts` —— **12 例全通过**，每项都用
「操作前计数 → 操作 → 操作后计数」验证**真实数据库变化**。

### P1 §六 · 运维可靠性故障注入

`scripts/release/verify-ops-resilience.sh` —— **21 项全通过，0 跳过**。

### P1 §七 · 长时间运行

`scripts/release/verify-soak.sh` + `.github/workflows/soak-test.yml`。
工作流带**时长诚实性门禁**：实际时长达不到目标 ⇒ job 失败。

---

## 三、本轮修复的真实缺陷

### 缺陷 1（P0）· API 错误率统计失效 —— §六「API 5xx 是否能够被统计」

v0.0.8 的 API 埋点存在**两个叠加缺陷**：

1. **模块实例隔离**：Next.js 把 middleware 编译成独立 webpack bundle
   （Edge 版 `.next/server/src/middleware.js`），与路由处理器的 bundle
   **不共享模块实例** ⇒ `observability.ts` 被求值两次 ⇒ 两个互不相通的 `Map`
   ⇒ 埋点写进 middleware 那份、`/api/admin/ops` 读路由那份 ⇒ **`api.requests` 恒为 0**。
2. **拿不到真实状态码**：`NextResponse.next()` 返回的是 **middleware 自己**的响应（恒 200），
   下游真实响应会**替换**它 ⇒ **`byStatus` 恒为 `{200: N}`**，连真实的 401/403/404 都不计入。

⇒ 「关键接口错误率」在架构上就是**瞎的**。

**修复**（三处**必须同时存在**）：
- `src/lib/observability.ts` —— 状态挂到 `globalThis`（带版本化存储键）
- `src/middleware.ts` —— `export const runtime = 'nodejs'`（与路由同进程）
- `src/instrumentation.ts`（新增）—— Node HTTP 层拦截 `ServerResponse.writeHead`，
  拿**真实** statusCode 与完整耗时

仅做前两处时 `byStatus` 仍恒为 `{200}` —— 这是实测确认的。

### 缺陷 2（P0）· .gitignore 凭据泄露风险

既有规则只覆盖**固定名字**（`.env` / `.env.local` / `.env.test`），
而本轮使用的 `.env.v009` / `.env.e2e009` / `.env.v009upg`
**不匹配任何规则** ⇒ 含真实密钥且会被 `git add -A` 带进仓库。
已改为忽略一切 `.env.*` 并显式放行模板。

**历史核查（已实测）**：对全部 ref 扫描本轮 5 个密钥字面量，**命中数均为 0**
⇒ 凭据从未进入 Git 历史，无需历史清理。

### 缺陷 3（P1）· build-candidate.sh 残留 `PYEOF`

改写镜像引用时把 heredoc 换成独立脚本，旧结束标记留在原地成为独立命令。
本地 `bash -n` 检不出来（语法合法，运行期命令不存在）—— 由 CI 首次实跑暴露。

### 缺陷 4（P1）· verify-soak.sh 缺 `--pg-pass`

工作流传了该参数但脚本未实现 ⇒ `未知参数` ⇒ 脚本立刻退出，长跑完全没跑。
由 CI 首次实跑暴露。

### 缺陷 5（P1）· soak-test.yml 未在功能分支注册

`push` 触发只监听 `master` ⇒ 该工作流在功能分支上**从未被注册** ⇒
手动 dispatch 404。已补上功能分支。

---

## 四、测试结果（本机实跑）

| 套件 | 结果 | 说明 |
|---|---|---|
| 单元测试 | ✅ **394/394**（31 文件） | `npx vitest run` |
| 四角色 E2E | ✅ **12/12** | `npx playwright test e2e/v009-four-roles-acceptance.spec.ts` |
| 运维故障注入 | ✅ **21/21**（0 跳过） | `scripts/release/verify-ops-resilience.sh` |
| 全新安装验收 | ✅ **22/22** | `scripts/release/verify-fresh-install.sh` |
| 长跑验证（短时） | ✅ **10/10** | `scripts/release/verify-soak.sh --duration 90s` |
| v0.0.4→v0.0.9 升级 | ✅ 数据指纹**逐字节一致** | 60 项指标 diff 为空 |

### 升级验证的关键证据

```
=== DATA FINGERPRINT DIFF (must be empty) ===
✅ 数据指纹逐字节一致（无差异）

=== SCHEMA DIFF (expected to change) ===
< schema.index.count|76      →  schema.index.count|78
< schema.migration.rows|3    →  schema.migration.rows|4
```

- 迁移幂等：连跑 3 次仍为 4 条迁移记录
- 旧口令哈希在 v0.0.9 仍可登录（`{"ok":true,"redirect":"/"}`）
- 升级前通知（含原始时间戳）在升级后可读

---

## 五、CI 状态

| 工作流 | 状态 | run |
|---|---|---|
| CI | 见 GitHub | — |
| E2E 跨浏览器矩阵 | 见 GitHub | — |
| 安装验证 | 见 GitHub | — |
| Docker/Redis 隔离验证 | 见 GitHub | — |
| SMTP 稳定性 | 见 GitHub | — |
| 安全审计 Host Header | ✅ success | — |
| 视觉回归验收 | 见 GitHub | — |
| V2EX 原站对照探测 | ✅ success | — |
| **候选安装链路验证**（新增） | ✅ **success** | run `42360418959`（3m14s，真实 Docker 全链路通过）|
| **长时间运行稳定性**（新增） | ✅ **success** | run `42356528005`（1h1m32s，**实际时长 3600 秒** = 目标）|

---

## 六、已知环境问题

### ⚠️ 本机 Docker 守护进程不可用

Docker Desktop 已安装，但其 WSL2 后端**被本机安全策略阻止**
（`wsl.exe` 在程序黑名单里），且当前会话**无管理员权限**启用虚拟化功能。

后果：
- 依赖真实 Docker 的验证**改由 GitHub Actions 的 ubuntu runner 执行**；
- 全新安装验收的 4~8 项（启动 / 迁移 / Redis / 管理员初始化 / 首页）
  改为**静态核验**并**明确标注**未能实测的原因 —— **不冒充通过**；
- 候选镜像构建与候选环境安装的**权威结果在 CI**，不在本机。

### ⚠️ 本机无 Redis

`_tools/redis/*.zip` 已损坏（可解压但中央目录缺失）。应用有 `PgKV` 降级路径
（`src/lib/kv.ts`），`REDIS_URL` 为空时自动启用 ⇒ 本机验证走的是降级路径。
Redis 相关验证在 CI（有真实 Redis service container）完成。

### ⚠️ 本机无 PowerShell 7

只有 PowerShell 5.1（`5.1.26100.9168`）。
任务书 §三 要求的「PowerShell 5.1 与 7 的解析与安装逻辑测试」中，
PS 7 部分**由 CI 的 windows-latest runner 覆盖**（该 runner 自带 PS 7）。

---

## 七、数据库与安装环境

| 项 | 值 |
|---|---|
| PostgreSQL | 17.5（便携版，`_tools/pgsql/pgsql/bin`） |
| 实例 A（端口 55433） | 主验证库 `v2ex_v009` |
| 实例 B（端口 55440） | 单元测试库 `v2ex_test_base` |
| 升级基线库 | `v2ex_v009_upg`（v0.0.4 的 3 迁移 + 真实业务数据） |
| 镜像引用改写测试库 | `v2ex_upg_v004_old`（历史遗留） |
| 启动脚本 | `_tools/run-v009-e2e.sh`（**必须用 shell 注入环境变量**） |

### ⚠️ 为什么必须用 shell 注入而不是 `ENV_FILE`

本机存在 `.env.local`（指向开发库 5432/v2ex）。Next.js 在应用代码执行**之前**
就用 `@next/env` 自动加载它 ⇒ `DATABASE_URL` 已被占位 ⇒ `ENV_FILE` 只能填空位，
赢不了已被占位的变量 ⇒ 表现为「以为在测试库跑、其实连的是开发库」。
这正是 `src/lib/env-loader.mjs` 顶部注释描述的 Next.js 预加载特例。
**官方 CI 也是用 shell 注入的。**

---

## 八、子智能体状态

| 智能体 | 状态 | 产出 |
|---|---|---|
| `r01-auditor` | 进行中 | R-01 历史合规专项（任务 #11~#15） |

工作区：`C:/Users/TYMO001/WorkBuddy/ai/_worktrees/r01-audit`（独立 worktree，detached HEAD）
v0.0.4 源码 worktree：`C:/Users/TYMO001/WorkBuddy/ai/_worktrees/v004-src`

---

## 九、最新风险

| 风险 | 等级 | 状态 |
|---|---|---|
| **R-01** 原站版权素材经 Git 历史持续暴露 | 🔴 | **DEFERRED** —— 等待单独授权。本轮**只做调查与方案准备**，未执行任何远端改写。 |
| 本机 Docker 不可用 | 🟡 | 已通过 CI 覆盖；本机相关项如实标注为「静态核验」。 |
| 24h 长跑尚未跑完 | 🟡 | CI 进行中；**未跑完前不得声称达成 24 小时验证**。 |
| 正式发布未授权 | 🟢 | 本轮停在候选状态，未创建 Tag / Release / GHCR 镜像。 |

---

## 十、下一步实际操作

1. ✅ **已完成**：候选链路（run `42360418959` ✅）与 1 小时长跑（run `42356528005` ✅，实际 3600 秒）
   均通过；候选产物已作为 artifact 产出（250,808,944 B）。
2. **24h 长跑派发**：工作流文件需先存在于默认分支才能 `workflow_dispatch`。
   合并 PR 到 master 后再派发；或用 `gh api .../dispatches` 带 `-f ref=<分支>`。
3. **合并 PR #31**：全部检查通过且未绕过保护规则时正常合并。
4. **R-01 报告合入**：子智能体产出 `docs/R01_COMPLIANCE_REVIEW_v0.0.9.md` 后，
   独立复核后再合入（**不代替它下结论**）。
5. **更新交付文档**：`CHANGELOG.md` / `BUG_REGISTER.md` / `RISK_REGISTER.md` /
   `RELEASE_GATE.md` / `docs/DELIVERY_REPORT_v0.0.9.md`。
6. **Go/No-Go 判定**：R-01 若仍阻断，则按既有约定停在候选状态，
   提交准确的风险决策报告，**不擅自绕过**。

### 授权边界（上一轮未执行、需单独授权）

force push · 删除或移动现有 Tag · 修改已有 Release · 改写远端历史 ·
删除仓库 · 更改 Public 状态 · 推送 GHCR 镜像 · 创建正式 Tag 或 Release。

> ⚠️ 上面这段是**上一轮**的状态。下面第十一节是本轮（2026-11-08）最新接管信息，
> 以第十一节为准。

---

## 十一、本轮接管信息（2026-11-08 00:xx GMT+8，正式发布进行中）

### 11.1 最新事实基线（只读核实过，勿用旧线索）

| 项 | 真实值 |
|---|---|
| `origin/master` | `af616356004877005153ad39bc187c3aed06e082` |
| PR #31 | 已合并（2026-11-07 10:07Z） |
| PR #32 | `fix/v0.0.9-soak-design-and-release-notes`，head `8d6df8a`，**全绿 / CLEAN**（firefox 1280x900 重跑已 success） |
| 24h Run 42362649887 | **cancelled**；证据最大 `elapsed_s=4687`（≈1h18m），79 次采样全 200、0 错误；**24h 未完成** |
| 1h 冒烟 | run `42384566949` / job `128439124955`，**1h1m5s，success**（PR #32 上真实跑满） |
| 已有 Tag | `v0.0.1` ~ `v0.0.4`；**无 v0.0.9** |
| 已有 Release | 4 个（v0.0.4 为最新公开 Pre-release；v0.0.3 为 Draft） |
| GHCR | 包为 Public，`v0.0.1/2/4` 匿名 manifest HTTP 200；**`v0.0.9` 返回 404（尚不存在）** |
| self-hosted runners | **0**（无授权长期运行环境）；本机 Docker daemon 不可用 |
| 版本载体 | 7 个全部 0.0.9，`sync-version.mjs 0.0.9 --verify` 通过 |
| R-01 | **DEFERRED**；git 树零命中；本机工作树 113 个被 `.gitignore` 忽略的遗留素材不进入任何产物 |

### 11.2 本轮授权（主人《v0.0.9 一站式正式发布总指令》）

✅ 已授权：常规代码修复、GitHub Actions 修复、自动化测试与安全审计、创建开发/发布修复分支、
提交/推送/创建 PR、检查通过后正常合并、从最终固定 SHA 构建并推送 v0.0.9 GHCR 镜像、
创建一次新的 v0.0.9 Tag、创建并**公开发布 Pre-release**、上传 ZIP 与 SHA256SUMS、更新 Release Notes。
✅ 主人已知悉 R-01 未解决，在完整披露前提下作**一次性、仅针对 v0.0.9 发行决定**的风险接受。
详见 `docs/RISK_DECISION_v0.0.9.md`。

⛔ 仍禁止：远端历史改写 / force push / 移动或删除已有 Tag / 删除覆盖已有 Release /
删除真实数据库或用户数据 / 更改仓库 Public 状态 / 绕过分支保护 / 额外付费服务。

### 11.3 已完成的专业产出（不要重复做）

| 产出 | 文件 / 结论 |
|---|---|
| 24h 设计缺陷核查 | `docs/SOAK_24H_FINDING_v0.0.9.md`；`.github/workflows/soak-test.yml` 头部注释 |
| 风险决策登记 | `docs/RISK_DECISION_v0.0.9.md` |
| 安全与发行审计 | `docs/AUDIT_v0.0.9_SECURITY_FINAL.md` —— **P0 = NO**；A-01/A-03 已派修复，A-02 如实披露 |
| 发布流水线评审 | `docs/AUDIT_v0.0.9_RELEASE_PIPELINE.md` —— **5 个阻断项 B1~B5**，判定「PR #32 合并后仍不具备可靠公开发布入口」 |
| Firefox E2E 不稳定性修复 | commit `840a78a`（隔离 worktree）/ 主仓 cherry-pick 为 `16805f2`：只调时间预算，不动断言 |
| 部署包版本标注统一 | `deploy/` 下 10 个文件头 + README/INSTALL 的版本标注改为 v0.0.9；**保留 3 处 R-18 历史语境的 v0.0.4** |
| 主仓 README 当前版本段 | 已改为 v0.0.9，并如实写入「24h 未完成」「升级基线只有 v0.0.4」 |

### 11.4 正在进行（三个隔离 worktree，勿互相合并）

| worktree | 分支 | 任务 |
|---|---|---|
| `_worktrees/v009-release-pipeline` | `fix/v0.0.9-release-pipeline` | 工程师：release.yml 六组修复（A/B1/B2/B3/B4/B5/N1/N2/N3/N5/N10）+ 新增 `post-release-verify.yml` + 两处源码（A-01/A-03） |
| `_worktrees/v009-tests` | `test/v0.0.9-http-status-regression` | QA：补 `e2e/v009-ops-metrics.spec.ts`、更新 `tests/captcha.spec.ts`、A-03 单测、消除悬空引用 |
| 主仓工作树 | `fix/v0.0.9-soak-design-and-release-notes` | 主理人：24h 记录、风险登记、部署文档、README（**尚未 push**） |

### 11.5 接管后的固定顺序（不要跳步）

1. **收敛**：把两个隔离 worktree 的 commit cherry-pick 到主仓发布分支，与主仓未提交改动合成**一次提交**；复验 `sync-version.mjs 0.0.9 --verify`、shell/YAML 语法、版本一致。
2. **一次 push**（不要反复推送）：等待 PR #32 全套 CI 全绿，含 1 小时冒烟（因改了 `src/` 与 `soak-test.yml`，会真实重跑）。
3. **合并**：PR #32 正常合并到 master → **固定最终完整 SHA**。所有后续产物必须来自该 SHA。
4. **干跑验证**（正式 Tag 之前）：`gh workflow run release.yml --ref master -f version=v0.0.9 -f dry_run=true`；确认**没有**推镜像、没有建 Tag/Release/资产。
5. **建一次 Tag**：`git tag v0.0.9 <最终 SHA>` + `git push origin v0.0.9`（轻量 tag，勿移动）。tag 白名单已含 v0.0.9，会触发正式发布流水线；修复后该路径应**直接产出公开 Pre-release**。
6. **发布后独立验收**：`gh workflow run post-release-verify.yml --ref master -f version=v0.0.9`（全新 runner、匿名下载、匿名 docker pull、官方包全新安装、迁移/登录/发帖/回复/通知/重启持久化/备份恢复）。
7. **如实报告**：15 项交付报告；24h 标「未完成」、R-01 标 DEFERRED，不得标 PASSED/FIXED。

### 11.6 关键纪律

- 若发布流水线在「Tag 已建但发布失败」时中断：**不移动/删除 Tag**。把流水线修复合入 master，
  用 `gh workflow run release.yml --ref master -f version=v0.0.9 -f dry_run=false -f publish=true -f prerelease=true`
  走 B2 幂等转公开补救路径。该路径**无法在正式发布前实跑**，只能静态审查，须如实披露。
- 不得把「1 小时冒烟通过」写成「24 小时验证通过」；不得把旧版候选 ZIP 改名冒充 v0.0.9。
- 镜像 Digest 必须记录真实值；安装包 VERSION / compose 镜像引用 / Release tag 三者必须一致。

