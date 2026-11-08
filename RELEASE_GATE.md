# v0.0.2 发布门槛检查单（RELEASE_GATE）

> ⚠️ **状态覆盖声明（v0.0.4 收尾轮，2026-11-04）**：本文件是 **v0.0.2 的历史门禁**，
> B3「≥103 单元」/ B4「≥67 E2E」等门槛**不适用于 v0.0.4**。
> v0.0.4 的实测为**单元 194 条 / 16 个文件（194 passed / 0 failed / 0 skipped，连续 4 轮全绿）**、
> E2E **154 条 / 11 个文件**（✅ **当前权威值 = 154 passed / 0 failed / 0 skipped，3.9m** —— V4-20 修复后本地实跑全绿；
> **修复前的历史快照**：CI run `41873009808` = `153 passed | 1 failed | 154 total`）、
> 升级脚本自检 **87 项断言全 PASS / 0 FAIL**，门禁以
> `docs/RELEASE_PROCESS_v0.0.4.md`（发布流程 + 发布前检查单）与
> `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md`（验收 Go/No-Go 判定表）为准。
>
> ⚠️ **「185」有两个不同来源，不可混用**：
> ① **v0.0.3 历史总数**（master @ `37710fb4`，14 个 spec 文件，`185 passed (185)`）；
> ② **修复前的历史观测**（run `41837212170`，HEAD `930f29e`）：`185 passed | 5 skipped (190)` ——
> ⚠️ **分母仍是 190**，5 条因 `floor-continuity` 在 CI 崩溃而跳过。
> **该红灯已由 `8ce5ce9` 修复**，run `41860242099` 与 `41873009808` 的「类型检查 / 单元测试」job 均已 ✅
> （vitest 15 文件全过、`Test Files 15 passed (15)` / `Tests 190 passed (190)` / 0 skipped；
> 护栏 3 修复提交 `634a202`）。
> **无论哪种，v0.0.4 的用例总数在 V4-20 修复后是 194**（= v0.0.3 的 185 + `floor-continuity` 的 5 条
> + V4-20 防回归的 4 条）；**修复前是 190**（15 个文件）。
> 口径裁决见 `TEST_REPORT.md` 文首「185 vs 190 裁决」小节与 `docs/evidence/ci/test-baseline-v0.0.4.md` §0.1。
>
> ✅ **CI 单元测试已转绿**（run `41860242099` / `41873009808`，SHA `2773cd1`）：
> `tests/floor-continuity.spec.ts` 的 CI 崩溃已由 `8ce5ce9` 修复，`e2e` job **已真实跑过**（不再被 `needs: unit` 连带跳过）。
> `BUG_REGISTER` V4-17 状态为 **VERIFIED**、`RISK_REGISTER` R-26 为 **🟢 已修复并经 CI 复验**。
>
> ✅ **本轮唯一红灯（E2E 1 条失败）已解除** —— V4-20 / R-27 **已由 `bddb3d0` 修复并本地实测验证**：
> 根因是 HTML 规范的 `[OverrideBuiltins]` 使表单内**命名控件遮蔽 `form.nodeName`**
> ⇒ react-dom 水合代码抛 `TypeError: nodeName.toLowerCase is not a function`
> ⇒ React #418 水合失败 ⇒ 事件处理器不绑定 ⇒ 表单走原生 GET 提交。
> 修复后本地实测：单元 **194/194（16 文件）**、E2E **154/154（11 文件，3.9m）** 全绿，
> `/nodes/request` 的 React #418 **归零**，提交恢复为 `POST /api/node-requests`。
> **修复前的历史快照**：CI run `41873009808` = `153 passed | 1 failed | 154 total`。
> ✅ **CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）—— 不得写成「CI 已通过」**；剩余阻断项见下方门禁速览与本文各表。
>
> v0.0.4 新增的门槛要点：禁止提前创建最终 Tag、同一版本号不得反复删建或移动 Tag、
> 固定最终 SHA 后才能创建 Tag 与 Draft Release、远端核验；
> **不动 v0.0.3 的 Tag 与 Release**；未经主人单独授权不得公开发布有阻断风险的 Release。
> 下方历史表格保留作为版本演进记录，不删除、不改写。

> ✅ **v0.0.4 Draft Release 已交付（2026-11-05）**：
> 发布流水线 run `41991745413`（SHA `f5e1dd4`）**11/11 job 全绿** ——
> 这是 v0.0.4 发布流水线首次完整跑通。产物：
> - **Tag `v0.0.4`**：annotated tag `aed641d` → commit `c0e7396`（**未移动**，符合「同一版本号不得反复删建或移动」）
> - **Release `v0.0.4`**：id `434929894`，**`draft=true`**、`prerelease=true`、author `github-actions[bot]`
> - 资产：`v2ex-clone-v0.0.4-deploy.zip`（52,049 bytes）+ `SHA256SUMS`（95 bytes），
>   下载后实算 SHA256 `a08a1a0a…7607` **与 `SHA256SUMS` 逐字匹配**
> - GHCR 镜像 `ghcr.io/alicia1030su/v2ex-clone:v0.0.4` 已推送并拉取成功
> - 包内版本载体核对：`deploy/VERSION` = `0.0.4`、`V2EX_IMAGE=…:v0.0.4`、`APP_VERSION="0.0.4"`
>
> ✅ **已正式发布（Pre-release）**（2026-11-05，主人授权）—— R-01 仍在 Release Notes 显著披露，E-02 到期日 2026-12-04 前由主人裁决。
> 授权后以 `workflow_dispatch` 传 `publish=true` 触发，或手动在 GitHub 上发布；
> 流水线的 `verify-release` 届时会**自动补做**匿名下载校验
> （draft 状态下资产匿名不可下载，已按 GitHub 正常行为跳过）。
>
> 📌 发布流水线自身的修复过程（护栏 3 补 release 库名 / 安全扫描两处误判 /
> 「Tag 不可移动」与「流水线需修复」的死锁 / `gh release create` 连续 403 的根因
> `target_commitish`）详见 `docs/SESSION_HANDOFF_v0.0.4.md` **第 9、10 轮快照**。

> 项目：V2EX Clone
> 目标版本：v0.0.2（开发预览版 / Pre-release）
> 建表时间：2026-11-04
> 维护者：Release Engineer（主理人）
>
> **判定规则**：任一「阻断级」项未通过 ⇒ **不得发布正式 Release**，最多停在 Draft 并报告阻塞原因。

---

## 0. v0.0.4 门禁速览（收尾轮实测；**取代下方 v0.0.2 历史表作为 v0.0.4 判据**）

| 组 | v0.0.4 实测结论 | 状态 |
|---|---|---|
| 单元测试 | **194 条 / 16 文件**，194 passed / 0 failed / 0 skipped，**连续 4 轮全绿**（修复前基线 190 条 / 15 文件） | ✅ 通过（**本机**） |
| 单元测试（**CI**） | CI 上 **190 passed / 0 skipped** —— run `41860242099` 与 `41873009808` 的「类型检查 / 单元测试」job 均 ✅（vitest 15 文件全过）。**修复前的历史观测**（run `41837212170`，HEAD `930f29e`）：`185 passed \| 5 skipped (190)`，`floor-continuity` 崩溃 ⇒ `e2e` job 连带跳过；**已由 `8ce5ce9` 修复并经 CI 复验**（V4-17 / R-26）。✅ **V4-20 修复后的 194 条（16 文件）已由 CI 复验通过** —— run `41949555282`（SHA `bddb3d0`）：`Test Files 16 passed (16)` / `Tests 194 passed (194)` / 0 skipped | ✅ **通过（CI）**（190 条口径）；✅ **194 条口径已由 CI 复验通过**（run `41949555282`，SHA `bddb3d0`） |
| E2E | **154 条 / 11 文件**（`npx playwright test --list` 实测 `Total: 154 tests in 11 files`）。✅ **当前权威实测 = 154 passed / 0 failed / 0 skipped（11 文件，3.9m）** —— V4-20 修复后本地实跑全绿。**修复前的历史快照**：CI run `41873009808` = `153 passed \| 1 failed \| 154 total`，唯一失败为 `e2e/v004-four-roles-ui.spec.ts:122` 节点申请 UI 提交链断裂（V4-20 / R-27）—— **已由 `bddb3d0` 修复并本地实测验证** | ✅ **通过（本地 154/154）**；✅ **CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅） |
| 升级脚本自检 | **87 项断言全 PASS / 0 FAIL**（沙箱，不调用真实 Docker；本轮实测） | ✅ 通过 |
| 视觉对照 | 4 视口 × 17 页面 = 68 条（**40 有对照 / 28 无对照**）；严格口径桌面 Δx=0 **52/52** | ⚠️ **部分** —— 六类区分（几何位置 / 组件宽高 / 视觉样式 / 动态内容 / 缺失组件 / 实际交互）**未全部闭环**，28 条无对照；**不得宣称「像素级复刻完成」** |
| Docker 容器实跑 | **✅ 已闭环（九项全绿）** —— run `41871503684`（SHA `2773cd1`）：`docker-verify` 九项 completed/success，汇总表全 PASS。修复提交：`827eef7`（安装模拟改走首次安装路径）、`2773cd1`（安装模拟前 unset job 级 env，修 compose 插值泄漏导致的假绿） | 🟢 **已闭环（R-16）** |
| Redis 故障恢复 | **✅ 已闭环** —— 同 run `41871503684` 九项全绿，含 `[R-17a/b/c]` 三个专项（Redis / PG 中断恢复、缓存失效与内存观测） | 🟢 **已闭环（R-17）** |
| 四身份 UI 缺口 | **✅ 已修**（`ed385cf`）—— 管理员入口 / 关注 / 节点申请审批 / 通知已读全部补齐，**待主理人终验确认** | 🟢 **已修（`ed385cf`）**（R-21 / R-24） |
| Git 历史合规 | 只读复核：风险未消除；隔离演练证明方案可行 | ⛔ **阻断（需主人授权）**（R-01） |
| 版本载体 | 开发态刻意保持 `0.0.3`（R-20 裁决） | 🟢 **按裁决，非缺陷** |

---

## A. 缺陷门槛

| # | 检查项 | 门槛 | 当前 | 状态 |
|---|---|---|---|---|
| A1 | P0 缺陷未修复数 | **= 0** | P0-01/P0-02/P0-04 已修；**P0-03（历史暴露）待授权** | ⛔ **阻塞（需授权）** |
| A2 | P1 缺陷未修复数 | **= 0** | P1-01～P1-11 已修；本轮新发现 S-01～S-18 **全部已修并有回归测试** | ✅ **0 个未修复** |
| A3 | P2 缺陷修复率 | ≥ 80% | P2-01（esbuild 漏洞）已真修复；P2-02（icacls 路径双斜杠，仅输出格式问题）待处理 | ✅ **≥ 80%** |
| A4 | 新增缺陷是否都有回归测试 | **100%** | S-01/S-02 有 `tests/client-ip.spec.ts`（8 条）+ `tests/middleware-client-ip.spec.ts`；其余有 CI 断言与本地实测 | ✅ |

---

## B. 测试门槛

| # | 检查项 | 门槛 | 当前 | 状态 |
|---|---|---|---|---|
| B1 | TypeScript 检查 | 0 错误 | ✅ 0 错误 | ✅ |
| B2 | Next.js 生产构建 | 成功 | ✅ Compiled successfully，35 路由 | ✅ |
| B3 | Vitest 单元测试 | **≥ 103 且全绿** | **117 passed / 117**（9 套件，20.26s） | ✅ |
| B4 | Playwright E2E | **≥ 67 且全绿** | CI run **41687529122** → E2E job **success** | ✅ |
| B5 | 单元测试**连续两轮**全绿 | 必须 | 本地两轮 + CI 三轮均通过 | ✅ |
| B6 | E2E **连续两轮**全绿 | 必须 | CI 连续三轮 success（41683621041 / 41685011064 / 41687529122） | ✅ |
| B7 | 数据库迁移与 seed 幂等 | 通过 | 全新库 `drizzle-kit migrate` 成功（18 表）；seed 两次执行第二次**不覆盖**已有账号口令与角色（`admin-cli 不会在 seed 之后偷偷改回原口令` 用例通过） | ✅ |
| B8 | Redis 实际连接 + 降级 | 通过 | 实测：`REDIS_URL` 指向不可用地址 → 自动降级 PgKV，限流计数仍正确递增（1→2→3）；`clearAll` 同时清两张表 | ✅ |
| B9 | 并发测试（楼层号/注册/发帖/收藏） | 通过 | E2E 含「并发回复不会产生重复楼层号」用例；CI E2E job success | ✅ |
| B10 | 备份与恢复 | 通过 | CI Linux job：`backup.sh` 生成 `.sql.gz` → 恢复到临时库 → 用户数校验通过 | ✅ |

---

## C. 安装验证门槛（模拟测试与真实测试分开报告）

| # | 检查项 | 门槛 | 状态 |
|---|---|---|---|
| C1 | Windows 5.1 —— 脚本可解析可执行 | 通过 | CI：ParseFile 0 错误 + BOM 检查通过 + install.ps1 完整流程 exit=0 | ✅ |
| C2 | Windows 7 —— 脚本可解析可执行 | 通过 | 本机与 GH runner 均**无 pwsh**（GH 用 `shell: pwsh` 实际回落到 5.1）→ **标记「未验证」** | ⚠️ **未验证** |
| C3 | Windows Git Bash —— install.sh 可执行、权限正确 | 通过 | CI 第 10 步 success（install.sh exit=0 + icacls 实际 ACL） | ✅ |
| C4 | Linux Bash —— install.sh 可执行 | 通过 | CI run **41687529178** Linux job（ubuntu-latest，**真实 Linux**）success | ✅ |
| C5 | `.env` 权限（Linux owner-only / Windows NTFS ACL） | 通过 | Linux：stat 600；Windows：icacls ACL 已收紧 | ✅ |
| C6 | `INSTALL_CREDENTIALS.txt` 权限 | 通过 | 同上；Windows 侧断言继承权限 `(I)` 必须不存在 | ✅ |
| C7 | 重复安装不覆盖配置、不重复初始化管理员 | 通过 | Linux + Windows 两侧幂等断言均通过；管理员口令哈希重启后不变 | ✅ |
| C8 | 任何流程都不执行 `docker compose down -v` | 通过 | 4 个脚本逐一复核（排除注释与提示文本后 0 命中） | ✅ |
| C9 | 密码不进终端历史 / CI 日志 | 通过 | 随机源用 `openssl rand -hex`；CI 用 `::add-mask::`；凭据落 600 文件 | ✅ |
| C10 | **真实 Docker 部署** | 通过 | CI run **41687529178** Linux job：全新安装 → 健康 → 管理员 → 持久化 → 重启口令不变 → 端口未暴露 → 幂等 → 备份恢复 **全部通过** | ✅ |

---

## D. 容器与部署门槛

| # | 检查项 | 门槛 | 状态 |
|---|---|---|---|
| D1 | 生产镜像不含 devDependencies（含已知漏洞的 esbuild） | 不含 | `npm ci --omit=dev` → 73 包 / 429MB（原 530MB）；esbuild 升至 0.25.12（已修复版本）；另移除 5 个零引用依赖 | ✅ |
| D2 | 镜像非 root 运行 | 是 | `Dockerfile` 有 `USER nextjs`（uid 1001）；CI 的 docker job 真实构建并启动验证通过 | ✅ |
| D3 | 镜像不含 `.env` / 源码 / 原站素材 | 不含 | ✅ Dockerfile 与 `.dockerignore` 已覆盖，待镜像内复核 |
| D4 | 数据库/Redis 端口不对宿主机暴露 | 不暴露 | ✅ compose 声明已核验，待真实容器复核 |
| D5 | 数据卷持久化，升级/重启/卸载不删卷 | 通过 | CI Linux job：stop.sh 后数据卷数 ≥ 2；4 个脚本均无 `docker compose down -v` | ✅ |
| D6 | 管理员密码在重启/升级后保持不变 | 通过 | CI Linux job：重启 app 前后 `password_hash` 完全一致 | ✅ |
| D7 | GHCR 匿名可拉取 | 通过 | ✅ 已实测（manifest 200 + amd64 layer） |
| D8 | 镜像 tag 固定（不用 latest） | 固定 | ✅ `v0.0.2` + `sha-<SHA>` |

---

## E. 供应链门槛

| # | 检查项 | 门槛 | 当前 | 状态 |
|---|---|---|---|---|
| E1 | `npm audit` high/critical | **= 0** | ✅ high=0, critical=0（postcss 已 overrides 修复） | ✅ |
| E2 | `npm audit` moderate | 逐项有据可依 | **已真修复 → 0 漏洞**（`01fee84` esbuild overrides + `0b93eca` 移除 5 个未使用依赖）；`npm audit --omit=dev` 亦为 0 | ✅ |
| E3 | Gitleaks 秘密扫描 | 通过且**真扫了** | ✅ 已修「假通过」缺陷（改直接调 CLI，只扫 Git 跟踪文件） | ✅ |
| E4 | Actions 权限最小化 | 通过 | 全局 `contents: read`；仅 `build-image` 额外 `packages: write`、仅 `publish-release` 额外 `contents: write`；`publish-release`/`verify-release` 有 dry_run 闸门；发布 tag 触发器为**显式白名单**（非 `'v*'`） | ✅ |
| E5 | 无 `pull_request_target` 触发发布 | 禁止 | 全仓库 grep 零命中；发布仅由 tag 白名单触发 | ✅ |
| E6 | action 版本全部固定 | 全部固定 | ✅ 已升级到 node24 版本线 | ✅ |
| E7 | 锁文件一致性 | `npm ci` 成功 | 隔离目录 `npm ci` 成功（107 包）；CI 每次跑都用 `npm ci` | ✅ |
| E8 | SBOM 生成 | 生成 | `docker/build-push-action` 已开 `sbom: true` + `provenance: true` | ✅ |
| E9 | 镜像漏洞扫描 | 无 high/critical | **部分** —— `npm audit --omit=dev` = 0（生产依赖闭包干净）；容器镜像的 Trivy/Grype 扫描**本轮未接入**（需额外 action 与 CI 配额） | ⚠️ **部分未做** |

---

## F. 历史与合规门槛

| # | 检查项 | 门槛 | 当前 | 状态 |
|---|---|---|---|---|
| F1 | 发布资产不含原站版权素材 | 不含 | ✅ zip 内仅 deploy/ 14 文件，已实测 | ✅ |
| F2 | 当前 HEAD 文件树不含原站素材 | 不含 | ✅ A/B/C 全部为 0 | ✅ |
| F3 | **全部远端引用不含原站素材** | 不含 | ❌ master/fix 分支/v0.0.1 tag/pull ref 全部可达（A=44~45, B=40, C=10），匿名 raw 取回实测 200 | ⛔ **阻塞（需主人授权）** |
| F4 | 内部处置文档不公开 | 不公开 | ✅ 已移至仓库外 `_internal/release-audit/` | ✅ |
| F5 | 公开文档如实披露历史现状 | 如实 | ✅ README/DEPLOYMENT/RELEASE_CHECKLIST 均已声明 | ✅ |
| F6 | 商标与非官方声明 | 存在 | ✅ README 顶部独立声明区块 | ✅ |
| F7 | 仓库保持 Public | 是 | ✅ | ✅ |

---

## G. 文档门槛

| # | 检查项 | 门槛 | 状态 |
|---|---|---|---|
| G1 | README 含 10 项必需内容 | 全部 | ✅ |
| G2 | CHANGELOG 真实描述 v0.0.2 | 如实 | ✅ `CHANGELOG.md`（266 行）含 `## [0.0.2] - 2026-11-04` 小节，逐条列出本轮真实修复 |
| G3 | 升级说明（v0.0.1 → v0.0.2） | 存在 | ✅ `docs/UPGRADE-v0.0.2.md`（324 行） |
| G4 | 回滚说明 | 存在 | ✅ 同上，含 13 处回滚相关说明 |
| G5 | 已知问题清单 | 存在 | ✅ `docs/RELEASE_GATE_v0.0.2.md`（207 行）+ `docs/SECURITY_EXCEPTIONS.md`（108 行） |
| G6 | v0.0.1 Release Notes 顶部加 Windows 缺陷提醒 | 加了且**不替换资产** | ✅ 已加；资产 `createdAt` 仍是发布时刻（15:43:24Z），大小未变，tag 未移动 |
| G7 | v0.0.2 Release Notes 完整中文 | 完整 | ✅ 已发布（workflow 内置中文 Release Notes） |

---

## H. 发布流程门槛

| # | 检查项 | 门槛 | 状态 |
|---|---|---|---|
| H1 | v0.0.2 tag 不存在 | 不存在 | ✅ 发布前已核实；发布后 tag = `4488e7f` |
| H2 | v0.0.1 tag / 镜像 / 资产**保持不变** | 不动 | ✅ 全程未动 |
| H3 | Release 流水线 10 个 Job 全绿 | 全绿 | ✅ run **41688792289** —— 10/10 success |
| H4 | 流水线 preflight 校验 tag 指向 == 构建 commit | 是 | ✅ `94cc132` |
| H5 | 安装包 SHA256SUMS 生成并可校验 | 是 | ✅ `b30b11dd944a2b2f0ad96f464421133735d89ee8d110a37b776266e1000373cf`，匿名下载后 `sha256sum -c` → OK |
| H6 | 远端匿名核验（下载资产 + 校验和 + 结构 + GHCR 拉取） | 全过 | ✅ Release API 200 / 网页 200 / zip 下载 41367B / 校验和 OK / 14 文件齐全 / GHCR manifest 200 |

---

## I. v0.0.3 专项门槛（新增功能）

| # | 门槛 | 状态 | 证据 |
|---|---|---|---|
| I1 | 主题编辑 / 软删除 / 恢复闭环 | ✅ | `PUT/DELETE /api/topics/[id]`、`POST /api/topics/[id]/restore`；编辑历史写 `edit_history` |
| I2 | 回复编辑 / 软删除 / 恢复闭环 | ✅ | `PUT/DELETE /api/replies/[id]`、`POST /api/replies/[id]/restore`；同步重算 `replies_count` |
| I3 | 主题锁定 / 解锁 / 置顶 / 取消置顶 | ✅ | 四个独立路由；仅 moderator/admin；写 `moderation_logs` |
| I4 | 投票与感谢的幂等性 | ✅ | 唯一索引；实测投票连发 3 次 → votes=1、votes 表 1 行 |
| I5 | 已删除内容不通过普通 API/页面泄露 | ✅ | 软删除主题：未登录与普通用户访问均 **404**；`listReplies` 默认过滤 |
| I6 | 越权防护（服务端） | ✅ | 普通用户 lock/pin → **403**；5 个管理 API → 全部 **403**；未登录 → **401** |
| I7 | 并发安全（楼层号 / 感谢 / 积分 / 令牌） | ✅ | 12 并发回复楼层无重复；8 并发感谢只计 1；30 并发扣费余额为 0；8 并发消费令牌只 1 成功 |
| I8 | 邮件找回密码（含防枚举与防重放） | ✅ | 响应一致；三重状态防护；改密后旧会话失效；**未配置 SMTP 时如实显示未送达** |
| I9 | 积分账本不可篡改 | ✅ | 只 INSERT；含 balanceBefore/After 快照；自洽性校验通过 |
| I10 | 后台权限矩阵服务端强制 | ✅ | 11 权限 × 3 角色逐条实测（`tests/admin-permissions.spec.ts` 24 条） |
| I11 | 后台不提供未经验证的危险操作 | ✅ | 无删除用户/执行 SQL/改配置接口；测试扫描路由目录验证 |
| I12 | Feed 输出真实内容与标准格式 | ✅ | RSS/Atom/JSON Feed 三格式；软删除主题不出现；Content-Type 精确；12 条格式测试 |
| I13 | 搜索 SQL 安全与分页上限 | ✅ | 参数化查询（注入尝试后表完好）；limit 钳制到 100 |
| I14 | 响应式（375 / 1280 / 1920） | ✅ | 600px/500px 断点；375 无横向滚动；几何量测三视口完成 |
| I15 | 数据库迁移幂等与原地升级 | ✅ | 连续应用 3 次 exit=0；v0.0.2 结构+真实数据 → 26 表且指纹一致 |
| I16 | 单元测试零回归 | ✅ | **v0.0.3 当时 185/185**（v0.0.2 基线 117 条全部保留 + 新增 68 条）—— **v0.0.3 历史总数**；**v0.0.4 权威基线为 194/194（16 文件，连续 4 轮全绿）**（修复前为 190/190（15 文件）） |
| I17 | 13 份交付文档齐备且与实现一致 | ✅ | 逐份由真实代码/数据库/测量数据生成 |
| I18 | README 版本号与真实实现一致 | ✅ | 此前 README 仍写 v0.0.1（实际 v0.0.2），已修正为 v0.0.3 |
| I19 | 前后端 API 契约一致 | ✅ | `scripts/ui-verify.cjs` 扫描前端写死的 API 路径并与后端路由比对：**72 路由 / 30 处调用 → 全部匹配**；已接入 CI 常驻检查（run 41754998422 success） |
| I20 | 版本库内容完整（无「本地有、仓库无」） | ✅ | 全量核查 `src/` `scripts/` `tools/` `e2e/`：工作区中**无任何未跟踪的源文件**；`src/app/api/admin/logs/` 曾被 `.gitignore` 误伤，已修正 |
| I21 | 发布流水线全绿且产物真实存在 | ✅ | run `41759712235` **10/10 job success**；镜像已推送 GHCR；安装包 41,867 B + SHA256SUMS；Release `isDraft=true` / `publishedAt=null`（按约定停在 Draft） |

## 发布判定

### v0.0.3 的判定

| 门槛组 | 结果 |
|---|---|
| A 缺陷门槛 | ✅ 通过 —— v0.0.3 新增 24 条缺陷全部修复并有实测证据；P0/P1 未修复数为 **0** |
| B 测试门槛 | ✅ 通过（本机）—— v0.0.3 当时：单元 **185/185**（**历史总数**）；v0.0.4 权威：单元 **194/194**（16 文件，修复前为 190/190（15 文件））、E2E **154 条 / 11 文件**（分母口径），见 TEST_REPORT.md。✅ **CI 侧单元已通过**（run `41860242099` / `41873009808`，190 条口径）；✅ **本地 E2E 全绿 154/154（11 文件，3.9m）** —— V4-20 / R-27 已由 `bddb3d0` 修复；✅ **CI 侧 E2E 已复验通过**（run `41949555282`，SHA `bddb3d0`：`154 passed (2.5m)` / 0 failed） —— 修复前的历史快照为 `153 passed \| 1 failed \| 154 total` |
| C 安装验证门槛 | ✅ 通过 —— v0.0.2 已在真实 Linux Docker + Windows 双平台验证通过；v0.0.3 沿用同一套脚本，CI 会重跑 |
| D 容器与部署门槛 | ✅ 通过 —— 生产镜像 429MB；`npm ci --omit=dev` 三个 entrypoint 路径全部存在 |
| E 供应链门槛 | ✅ 通过 —— `npm audit` **0 漏洞**；移除 5 个零引用依赖 |
| F 历史与合规门槛 | ⛔ **阻断** —— Git 历史中原站素材仍可匿名取回（详见 `RISK_REGISTER.md` R-01）。**历史改写需单独授权，未执行** |
| G 文档门槛 | ✅ 通过 —— 13 份文档齐备且与实现一致 |
| H 发布流程门槛 | ✅ 通过 —— tag 白名单、dry_run 闸门、node24 action 线均已生效 |
| I v0.0.3 专项门槛 | ✅ 通过 —— 18 项全部通过 |

### 结论

**代码与功能层面：全部通过，可以发布。**

**唯一的阻断项是 F（历史合规）** —— Git 历史中原站素材仍可通过
`raw.githubusercontent.com` 匿名取回。这需要「改写远端历史」或「移动/删除 v0.0.1 tag」，
两者均**超出本轮授权范围**，本轮**未执行**。

按任务约定：

> 「该风险如仍被发布门槛判定为阻断项，应完成所有其他开发和验证，
> 将候选版本停在 Draft，并提交准确的风险决策报告。」

因此 v0.0.3 的处理方式为：

1. 完成全部开发与验证（✅ 已完成）
2. **创建 v0.0.3 Release 但保持 Draft 状态**，不公开发布
3. 附上准确的风险决策报告，说明阻断原因与可选方案
4. 等待主人对「历史清理」与「正式发布」两个独立决策的明确授权

**不做的事**：不通过「创建新版本」的方式伪装历史风险已修复。

## 签字

| 角色 | 结论 | 日期 |
|---|---|---|
| 代码审计负责人（主理人） | 待终审 | — |
| 安全工程师（backend-engineer） | 待回传 | — |
| 数据库工程师（data-engineer） | 待回传 | — |
| Release Engineer（devops-engineer） | 待回传 | — |
| 主人（历史改写授权） | **待裁决** | — |

---

# v0.0.9 发布门槛检查单---

# v0.0.9 发布门槛检查单（RELEASE_GATE）

> **日期**：2026-11-07
> **分支**：`feat/v0.0.9-release-readiness` · **PR**：#31
> **基线**：`master` @ `faf8d89`
> **状态覆盖声明**：本节是 **v0.0.9 的现行门禁**，取代上方 v0.0.2 的历史门禁
> （历史表格保留作为版本演进记录，不删除、不改写）。

## 一、门禁总览

| 门槛组 | v0.0.9 结果 | 说明 |
|---|---|---|
| **A 缺陷门槛** | ✅ 通过 | 本轮新发现 **7 条**（V9-01~V9-07）**全部修复并有实测取证**；P0/P1 未修复数 = **0** |
| **B 测试门槛** | ✅ 通过 | 单元 **394/394**（31 文件）；E2E 四角色 **12/12**；跨浏览器矩阵 CI 全绿 |
| **C 安装验证门槛** | 🟡 **部分通过** | 全新安装验收 **22/22**（4~8 项因本机 Docker 不可用改为静态核验并标注）；**真实 Docker 路径由 CI ubuntu runner 覆盖**（`安装验证` + `候选安装链路验证`） |
| **D 容器与部署门槛** | ✅ 通过 | 候选镜像构建 + `docker load` + Compose 启动 + 迁移 + Redis + 健康检查 + 登录 + 发帖 + 回复 + 重启不丢数据 —— **全部在真实 Docker 上验证** |
| **E 供应链门槛** | ✅ 通过 | 未新增运行时依赖；`npm audit` 沿用既有结论 |
| **F 历史与合规门槛** | ⛔ **阻断（维持 DEFERRED）** | R-01 —— 见 §三。**但已新增「用户可获得面干净」这一新证据** |
| **G 文档门槛** | ✅ 通过 | CHANGELOG / BUG_REGISTER / RISK_REGISTER / SESSION_HANDOFF / DELIVERY_REPORT / R01 复核 全部更新 |
| **H 发布流程门槛** | ✅ 通过 | 候选链路 + 产物可溯（固定 SHA + SHA256SUMS）+ 不推送未授权镜像 |
| **I 长时运行门槛** | 🟡 **进行中** | CI `长时间运行稳定性` 运行中；**未跑完前不得声称达成 24h** |
| **J v0.0.9 专项门槛** | ✅ 通过 | 见 §四 |

## 二、三种发行状态的区分（任务书 §二硬要求）

| 状态 | 含义 | v0.0.9 现状 |
|---|---|---|
| ✅ **候选构建成功** | 候选 ZIP + 镜像 tar + SHA256SUMS 产出且校验通过 | **达成**（CI 产出为 artifact） |
| ✅ **候选环境安装成功** | 独立环境 `docker load` → compose → 全流程 → 重启不丢数据 | **达成**（CI ubuntu runner 真实 Docker） |
| ⬜ **正式公开发布成功** | GHCR 推送 + digest 核验 + 匿名 pull + 正式 Release + Tag | **未达成，且本轮不涉及**（需单独授权） |

⇒ **不得**把「候选构建 + 候选安装成功」表述为「已发布」。

## 三、F 组：R-01 历史合规（唯一阻断项，维持 DEFERRED）

详见 `docs/R01_COMPLIANCE_REVIEW_v0.0.9.md`（本轮**独立实测**，非照抄旧报告）。

**已确认的事实**：

| 项 | 结果 |
|---|---|
| 受影响对象 | **81 个**（assets 2 / html 46 / screenshots 20 / visual 13）—— 重新枚举 |
| 当前 master 树中原站素材 | **0 个** ✅（`ref-*.png` / `diff-*.png` / `combo.css` / `combo.js` 实测零命中） |
| 仍可达的 refs | **4 个已发布 Tag + 12 个分支** ⚠ |
| **已发布的 4 个 Release ZIP** | ✅ **不含**素材（实测下载 v0.0.4：只含 `deploy/` 15 个文件）⇒ **无需重做** |
| **已发布的 4 个 GHCR 镜像** | ✅ **不含**素材（Dockerfile 无任何 `COPY` 含 `docs/`；实测匿名 pull 200）⇒ **无需重做** |
| 隔离副本清理演练 | ✅ **成功** —— 业务代码 blob SHA256 **逐字节一致**（405 文件），清理后 `tsc` 退出码 0 |
| ⚠️ **改写历史无法消除的部分** | 已下载 / 已缓存 / 已 fork 的副本**不受仓库方控制** ⇒ 改写只降低「未来可达性」 |

**本轮未执行**（明令禁止项，需单独授权）：force push · 删除或移动现有 Tag ·
修改已有 Release · 改写远端历史 · 删除仓库 · 更改 Public 状态 ·
删除 CI artifact · 向 GitHub Support 提交工单。

**建议**：**方案 E（保留历史 + 正式披露）** 作为默认路径 ——
已发布的安装包与镜像均不含素材（用户可获得面干净），
而 C/D 方案触及多项不可逆操作且无法消除已发生的暴露。

## 四、J 组：v0.0.9 专项门槛（12 项）

| # | 门槛 | 结果 | 证据 |
|---|---|---|---|
| 1 | 候选安装链路（模式 B）完整可执行 | ✅ | `build-candidate.sh` / `rewrite-candidate-image.mjs` / `verify-candidate-install.sh` + `candidate-verify.yml` |
| 2 | 候选包引用的镜像**真实存在** | ✅ | 候选包 4 处镜像引用全部改写为候选标签；CI 实测 `docker load` 后 `image inspect` 通过 |
| 3 | 候选产物可溯到确定 SHA | ✅ | 构建脚本强制 `HEAD == --sha` 且工作区干净；版本载体未同步即拒绝构建（CI 实测拦截） |
| 4 | 候选包内 shell 脚本为 LF 换行 | ✅ | 构建时强制归一化 + CI 核验（Windows 构建机的 CRLF 坑） |
| 5 | 全新安装 13 项验收 | ✅ | `verify-fresh-install.sh` 22 项断言全通过 |
| 6 | v0.0.4 → v0.0.9 数据逐字节不变 | ✅ | 42 项业务指纹 diff 为空（指纹文件 49 行）；索引 76→78；迁移 3→4；迁移幂等；旧口令哈希仍可登录 |
| 7 | 四角色 UX 每项验证真实 DB 变化 | ✅ | 12/12；「操作前计数 → 操作 → 操作后计数」 |
| 8 | 运维故障注入 | ✅ | 21/21（0 跳过）；含 DB 断开、备份损坏检测、真实恢复 |
| 9 | 指标接口鉴权与脱敏 | ✅ | 匿名访问 4 个后台 API 全部 401；指标与就绪探针均不泄露连接串/密钥/令牌 |
| 10 | **API 错误率统计真实可用** | ✅ | **修复 V9-01**；实测 `byStatus={'200':4,'401':2,'404':1}`、`error4xxByRoute` 按路由聚合 |
| 11 | 长时间运行（24h） | 🟡 **进行中** | CI 持久运行器 + **时长诚实性门禁**；未跑完不声称达成 |
| 12 | R-01 独立处置报告 | ✅ | `docs/R01_COMPLIANCE_REVIEW_v0.0.9.md`（含 12 项逐条实测证据） |

## 五、v0.0.9 的 Go / No-Go 判定

### 🟡 **有条件 Go** —— 建议合并 PR + 继续候选化，**暂不正式发布**

**Go 的依据**：候选交付链在真实 Docker 上完整闭环；升级数据完整性是逐字节证明的；
修复了一个此前让运维失明的严重缺陷；R-01 演练证明清理不损坏项目；
CI 实跑暴露 5 个缺陷全部修复、无一被绕过。

**暂不正式发布的依据**：R-01 维持 DEFERRED（4 个已发布 Tag 仍使素材可达）；
正式发布授权未获得（模式 A 需 GHCR 推送 + digest + 匿名 pull + Release + Tag）；
24 小时长跑尚未跑完。

### 待主人裁决的两个**独立**决策

| 决策 | 内容 | 默认 |
|---|---|---|
| **决策 A（历史改写）** | 是否执行方案 C/D（改写全部 refs + 移动已发布 Tag + 删 artifact + Support 工单） | **不执行** |
| **决策 B（正式发布）** | 是否在 R-01 维持 DEFERRED 的前提下正式发布 v0.0.9 | **不发布**，停在候选状态 |

### 未获授权前**不做**的事

不创建正式 Tag · 不创建或修改 Release · 不推送 GHCR 镜像 ·
不改写远端历史 · 不移动或删除 Tag · 不删除 artifact · 不改变仓库可见性。

## 签字

| 角色 | 结论 | 日期 |
|---|---|---|
| 首席架构师 / 主理人（本轮执行） | **有条件 Go** —— 候选交付就绪，正式发布待授权 | 2026-11-07 |
| 安全负责人 | ✅ 本轮修复 V9-06（安全守卫判红）；R-01 报告已出 | 2026-11-07 |
| 测试负责人 | ✅ 394 单元 + 12 E2E + 21 运维 + 22 安装断言；CI 实跑暴露 5 缺陷全修 | 2026-11-07 |
| DevOps 负责人 | ✅ 候选链路 + 长跑工作流已实跑；CI 侧真实 Docker 全绿 | 2026-11-07 |
| 主人（决策 A：历史改写） | **待裁决** | — |
| 主人（决策 B：正式发布） | **待裁决** | — |


---

# v0.0.10 发布门禁（现行）

> 状态覆盖声明：本节是 **v0.0.10 的现行门禁**，取代上方 v0.0.2 / v0.0.4 / v0.0.9 的历史门禁。
> 判定规则：任一「阻断级」项未通过 ⇒ **不得发布正式 Release**，最多停在候选。

## 一、门禁总览

| 组 | 项 | 状态 | 证据 |
|---|---|---|---|
| **A 版本载体** | package.json / deploy/VERSION / install.sh / install.ps1 / compose / .env.example / README 七处一致 | ✅ | `sync-version.mjs 0.0.10 --verify` 全过 |
| **B 构建** | `next build` 成功、`tsc --noEmit` 零错误 | ✅ | 本机实测 |
| **C 单元测试** | 全量单元测试 0 失败 0 跳过 | ✅ | **440 passed / 35 文件 / 182.21s** |
| **D 静态测试** | 语法守卫 + SIGPIPE 行为级 | ✅ | **40 passed** |
| **E E2E** | Core E2E 全量 | ✅ **220 passed / 0 failed / 0 skipped（8.1m）** | 本机 3010 + 独立库 |
| **F 视觉真实性** | 12 类页面（含登录态）逐页断言 | ✅ | **12/12**，`pages-audit.json` |
| **G 截图门禁** | 72 张截图全部通过 18 项判据 | ✅ | `capture-multi-index.json` |
| **H 四身份验收** | 游客 / 用户 / 版主 / 管理员真实浏览器 | ✅ | **28/28**，`roles-audit.json` |
| **I 升级** | v0.0.4 → v0.0.10、v0.0.9 → v0.0.10 双基线 | ✅ | **20/20**，`UPGRADE_VERIFICATION_v0.0.10.md` |
| **J 安装/备份行为** | 脚本语法 / SIGPIPE / 损坏备份 / 幂等 | ✅ 10 PASS / 2 SKIP | SKIP 原因已披露，**对应项已由 CI 覆盖并通过** |
| **K 真实 Docker 安装** | Linux runner 上 ZIP → 解压 → `./install.sh` → 健康检查 | ✅ CI **pass**（`Linux + 真实 Docker 安装`） | PR #34 的 install-verify job |
| **L 发行一致性** | 源码/Tag/镜像/ZIP/README/Release + 发布事实 | ✅ **30/30**（Tag/镜像/Release 三组在产物存在后自动复核） | `verify-release-consistency.sh` |
| **M 安全** | Host Header / CSRF / 重定向 / 依赖扫描 | ✅ CI **pass** | `Host Header 攻击矩阵` / 安全套件 |
| **N 合规（R-01）** | Git 历史中原站素材仍可取回 | ⛔ **阻断（需主人单独授权）** | `RISK_REGISTER.md` / `RISK_DECISION_v0.0.10.md` |

| **O 产物字节** | ZIP 内 7 个 .sh 的 Unix mode / 无 CRLF / 15 项必需文件 / 无凭据 / 无原站素材 | ✅ 全部通过 | `docs/RELEASE_ARTIFACT_v0.0.10.md` |

## 二、唯一阻断项：N（R-01）

R-01 状态 **DEFERRED**，且 `RISK_DECISION_v0.0.9.md` 明确「不构成后续版本先例」。
因此 v0.0.10 的公开发布需要**新的**裁决：

- **决策 A**：是否执行历史改写（本轮禁止，默认不执行）
- **决策 B**：是否在 R-01 维持 DEFERRED 的前提下发布 v0.0.10 Pre-release

`docs/RISK_DECISION_v0.0.10.md` 是这次授权请求的正本。**未获批准前不创建 Tag、不推镜像、不建 Release。**

## 三、为什么 v0.0.10 值得发布（供裁决参考）

1. v0.0.9 的已发布资产**确实带两个确定性缺陷**（脚本 0644、备份 SIGPIPE），
   而这两个修复**只能通过新版本交付**（已发布资产不可覆盖）。
2. 本轮新增的发行真实性门禁把「源码 / Tag / 镜像 / ZIP / README / Release」
   绑成一条链，任一不一致即拒绝发布 —— 同类问题不会再次静默流出。
3. 页面真实性从「README 8 张图」扩展到「12 类页面 × 23~29 项断言 + 四身份 28 步」，
   且带真实登录态。

## 四、E2E 实测（220 用例，**零跳过**）

| 项 | 值 |
|---|---|
| 环境 | 本机 `next start`（生产构建产物）+ 独立库 `v2ex_e2e_v0010` + Redis 缺省（走 PG 降级） |
| 结果 | **220 passed / 0 failed / 0 skipped（8.1m，20 个 spec 文件）** |
| 上一轮跳过的那 1 条 | **已消除**：`5xx 计入 api.error.5xx / error5xxByRoute` 从 `test.fixme` 转为真实断言，见下 |

### 关于上一轮被 skip 的那条用例（任务书 §七 要求逐条核查）

v0.0.9 时它是 `test.fixme`，理由写得很实：全仓没有能稳定返回 5xx 的真实
`/api/` 端点，而「向共享环境注入故障」被明令禁止。

**但那个理由在观测链路的可信度上留了一个洞**：`/api/admin/ops` 的
`api.error.5xx` 与 `error5xxByRoute` 是「关键接口错误率」的唯一数据源，
它此前**只被分桶函数的单元测试覆盖，从未被真实 HTTP 验证过**。

v0.0.10 新增 `src/app/api/debug/boom`（三重闸门：调试令牌 + `APP_RUNTIME_ENV=test`
+ `TEST_ENV_ISOLATED=1`；只返回错误、不读写数据；状态码白名单 {500,502,503}），
把这一条变成**真实断言**，而且比原来更强：

1. `byStatus['500']` 真的 +1（证明真实状态码被采到，不是恒 `{200}`）
2. `api.error.5xx` +1
3. `error5xxByRoute` 按路由归因到 `/api/debug/boom`
4. 再打一个 503，确认**不同 5xx 状态码被分开计**

实测：该文件 2 passed。三重闸门也单独验过：
带正确令牌 → 500；`?status=503` → 503；不带令牌 → 401。

## 五、发布顺序（获批准后）

```
全部代码合并 → 统一版本载体（已完成）→ 最终 CI → 固定发行 SHA
→ 构建候选镜像 + ZIP → 候选环境真实安装 → 安全与风险门禁
→ 创建 annotated Tag v0.0.10 → 推送镜像 → 创建公开 Pre-release
→ 匿名下载 + 镜像拉取复验 → 更新 README 的下载链接
```

**Tag 创建后不移动、不删除、不重建。**


## 六、最终状态（2026-11-08）

| 项 | 值 |
|---|---|
| 候选 SHA | `23a88cf54abda28b0e677079707c71de52ce269b` |
| 合并 PR | #34（本体）、#35（CRLF 产物修复） |
| CI | PR #34：25 pass / 0 fail；PR #35：31 pass / 0 fail（各 1 项 skipping 为本分支不触发的可选诊断） |
| 候选 ZIP | `v2ex-clone-v0.0.10-deploy.zip`，SHA256 `2d10957fa2bffacccb443ad6a6e879184764a236557865d4025355bec5dbb2cf` |
| 门禁 | A~O 除 N 外**全部通过**；N（R-01）为唯一阻断 |
| 未执行 | 创建 Tag、推镜像、建 Release、匿名复验（**均需授权**） |

> 本文件不构成发布批准的替代物。N 组的判定权限在主人，见
> `docs/RISK_DECISION_v0.0.10.md`。
