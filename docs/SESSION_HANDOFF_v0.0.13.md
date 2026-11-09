# SESSION_HANDOFF — v0.0.13 收尾交接

> 目标版本：**v0.0.13**（旧版 API 兼容收口、功能矩阵真实性、登录交互稳定性、完整发行候选）
> 本文是**持续维护**的交接文档：每次推进后更新 HEAD / PR / CI / 当前测试基线 / 待办 / 授权边界。
> 最后更新：2026-11-09
> 上位约束：本轮**不是**开始 v0.0.14，也**不是**重新开发论坛；普通开发事项自主推进，不逐步询问。

---

## 0. 一句话状态

代码、文档、护栏与测试已全部合并到 master：PR #47 功能集（merge `d6c7a96`）→ PR #48 版本同步（merge `8deeb05`）→ PR #49 行尾护栏（merge `9f76777`）。版本载体 `0.0.13`，**尚未打 Tag / 发布 Release / 推送公开镜像**。
**公开发布为 NO-GO**：未找到主人对 v0.0.13 的明确风险接受与公开发布授权，R-01 仍为 DEFERRED。
**Go/No-Go**：候选构建与候选安装判据尚未执行完；见 `RELEASE_GATE.md` §7.2 的 G1~G11。

---

## 1. 接管基线（阶段一，只读核查结果）

| 项 | 值 |
|---|---|
| 接管时 `origin/master` HEAD | `7b30d7fd82dec851fa03e402d078a86ac37efbbc` — `feat(v0.0.13): 补齐旧版 API 全家桶（4 端点）+ 节点订阅原站路径 Atom/JSON Feed（V10-24） (#46)` |
| 接管时工作区 | `working tree clean` |
| 当前分支 | `feat/v0013-release-closeout`（从 `origin/master` 新建） |
| 合并历史 | `076c550`（功能，55 文件）→ PR #47 merge `d6c7a96`；`1d576ef`（版本同步）→ PR #48 merge `8deeb05`；`5bf0dc0`（行尾护栏 V13-18）→ PR #49 merge `9f76777` |
| **本版最终 SHA** | **本文件所在提交的 `master` 提交**（用 `git rev-parse master` 取，不再手写，避免文档提交自身把 SHA 改旧） |
| 候选产物 ↔ 源码树绑定 | `candidate-verify` 自带**源码锚点校验**：日志会打印 `源码锚点校验通过：<headSha>`，该值必须等于 `git rev-parse master`；不等即视为产物与源码树不匹配 |
| PR #44 / #45 / #46 | **全部 MERGED**，上一轮已完成功能**全部保留** |
| 最新已发布版本 | **v0.0.12**（GitHub Pre-release，含部署 ZIP 与 GHCR 镜像） |
| v0.0.13 Tag / Draft / Release / GHCR | **均不存在**（已核查，无冲突） |
| 已有同类分支 | `origin/feat/v0013-legacy-api`、`origin/feat/v0013-legacy-complete` ⇒ **未重复创建同功能分支** |
| GitHub 身份 | `alicia1030su`，`gh auth status` 正常，scope 含 `repo` / `workflow` |
| 版本载体（dev 态） | `package.json` / `deploy/VERSION` / `docs/release-facts.json` 均 `0.0.12` —— 按 G-VER-01 刻意保持上一稳定版本，**最终 SHA 固定前不得同步** |

只读核查覆盖：`FEATURE_MATRIX`、`API_SPEC`、`PAGE_INVENTORY`、`README`、`CHANGELOG`、
`RELEASE_GATE`、`RISK_REGISTER`、`BUG_REGISTER`、`docs/release-facts.json`、
`.github/workflows/` 全部发布 / CI 流水线，以及旧版 API 现有源码与测试。

---

## 2. 本轮改动清单（工作区，未提交）

**新增旧版 API（阶段二/三）**
- `src/app/api/topics/hot.json/route.ts`、`src/app/api/replies/show.json/route.ts`、
  `src/app/api/nodes/list.json/route.ts`
- `src/server/legacy-assemblers.ts`（共用装配器）、`src/server/legacy-replies.ts`、
  `src/lib/legacy-constants.ts`、`src/lib/legacy-node-list.ts`
- `src/lib/node-visibility.ts`（**V13-17**：`PUBLIC_NODE_CONDITION` 唯一定义处；
  纯模块无 `server-only` / `@/db` 副作用，供旧版装配器 re-export 与站内
  `feed-builder` 直接引用，避免后者反向 import 装配器时凭空建连接池）
- 重写：`src/server/legacy-topics.ts`（`kind:'hot'`）、
  `src/app/api/nodes/all.json/route.ts`、`src/app/api/nodes/show.json/route.ts`、
  `src/app/api/members/show.json/route.ts`、`src/lib/legacy-http.ts`

**Feed（阶段四）**
- `src/lib/feed-cache.ts`（强 ETag / `If-None-Match` / 304）、`src/lib/legacy-feed-format.ts`（CDATA 与控制字符）
- 6 个 Feed 路由统一接入；新增 `e2e/v013-feed-reader.spec.ts`（浏览器 `DOMParser` 真实阅读器）
- `docs/API_SPEC.md` §14.5 区分 Atom 1.0 / JSON Feed 1.0（原站路径）与 RSS 2.0 / JSON Feed 1.1（站内路径）

**登录与点击稳定性（阶段五）**
- `e2e/helpers.ts` 重写 `clickUntilRequest`（宽监听先注册 / 四道重试闸门 / 非幂等写操作默认只点一次）
- `e2e/v005-password-reset-flow.spec.ts` 7 个点位显式传 `WRITE_CLICK_RETRY`
- `tests/static/v010-click-until-request.spec.ts` 6 → 12 条（含负向对照）
- 服务端验证码校验**未改动**，生产仍强制；`tests/static/v010-captcha-parity.spec.ts` 守卫两端口径

**真实性治理与文档（阶段六/七）**
- `docs/LEGACY_API_MATRIX_v0.0.13.md`（15 项逐项核对 + 有意偏离 + 无法验证披露，**不宣称完全兼容**）
- `docs/FEATURE_MATRIX.md` 六类状态 / 范围声明 / 13.2 功能链路 / 13.3 当前证据
- 根 `FEATURE_MATRIX.md`、`API_SPEC.md` 标历史快照；`README.md`、`CHANGELOG.md`、
  `docs/API_SPEC.md`、`docs/PAGE_INVENTORY.md`、`BUG_REGISTER.md`、`RISK_REGISTER.md`、
  `RELEASE_GATE.md` 均已更新
- `tests/static/v013-docs-authenticity.spec.ts`（本轮新建的文档真实性护栏）
- `tests/static/v013-legacy-contract.spec.ts`、`v013-legacy-privacy.spec.ts`、
  `v013-feed-safety.spec.ts`、`e2e/v013-legacy-api.spec.ts`

**发行链路修复（V13-07）**
- `scripts/release/sync-version.mjs`：README 改为机器锚点、删除危险的全局历史替换、
  把 `docs/release-facts.json` 纳入载体清单
- `.github/workflows/release.yml`：Tag 白名单提前加入 `v0.0.13`（**仅链路就绪，非发布授权**）

**环境与测试基础设施（V13-10 / V13-11 / V13-18）**
- `scripts/ci/run-e2e-locally.sh`：补齐 `REDIS_URL` / `REDIS_PASSWORD` shell 注入；
  PG 就绪判据改为真实 `SELECT 1`；启动失败退出码不再被 `|| true` 吞掉
- `tests/helpers/start-test-pg.sh`：新增 `clear_stale_pid()` 安全清理；
  `pg_ctl -w start` 加 `-t 300`（上一轮被 SIGTERM 打断后需崩溃恢复 + 全目录
  fsync，累计超默认 60s 会被误判「启动失败」，实测日志 `pg-test-v004.log`）
- `tests/static/v013-e2e-env-parity.spec.ts`：环境隔离 + PG 就绪 + 超时不放宽 共 8 条

---

## 3. 当前测试基线（**本版当前证据，不是历史数字**）

| 门禁 | 命令 | 结果 | SHA / 说明 |
|---|---|---|---|
| 静态套件（修复前基线） | `NODE_OPTIONS="" npx vitest run --config vitest.static.config.ts` | **13 文件 / 140 用例：138 passed / 2 failed，退出码 1** | 暴露 V13-09 图例假红 + 护栏文件缺失；**如实记为失败，未用 `echo` 掩盖退出码** |
| 静态套件（补齐护栏后） | 同上 | **14 文件 / 154 用例：154 passed / 0 failed / 0 skipped，退出码 0**（9.85s） | 新增 `v013-docs-authenticity.spec.ts` 13 条 + 图例负向对照 1 条 |
| 静态套件（交接文档补齐后） | 同上 | **14 文件 / 154 用例：154 passed / 0 failed / 0 skipped，退出码 0**（9.85s） | 唯一残留失败是交接文档缺 `Go/No-Go` 字面量，已补 |
| 静态套件（Release Notes 模板护栏后） | 同上 | **14 文件 / 155 用例：155 passed / 0 failed / 0 skipped，退出码 0**（9.04s） | 新增 `release.yml` 模板真实性断言 1 条 |
| 静态套件（环境隔离护栏后） | 同上 | **15 文件 / 162 用例：162 passed / 0 failed / 0 skipped，退出码 0**（14.50s） | 过程如实记录：首跑 158/160（2 failed，护栏判据写得不精确 —— `启动应用` 命中头部注释、v004 自动发现无端点字面量）⇒ 按真实结构修正；一次复跑因并发资源竞争收到 SIGTERM（14/15 文件已绿、无失败用例）⇒ 单独复跑取最终数字。新增 `v013-e2e-env-parity.spec.ts` 7 条 |
| 静态套件（QA/架构 P1 修复后） | 同上 | **15 文件 / 191 用例：191 passed / 0 failed / 0 skipped，退出码 0** | 隐私护栏扩到 5 路径逐文件、Feed 严格扫描器 33 条 |
| 静态套件（统一收起 + ALL 大小写 + replies 收敛后） | 同上 | **15 文件 / 195 用例：195 passed / 0 failed / 0 skipped，退出码 0**（6.82s） | 工程师 A~E 交付：`replies/show.json` join nodes、`isAll` 大小写归一 |
| 静态套件（V13-18 行尾无关修复后） | 同上 | **15 文件 / 200 用例：200 passed / 0 failed / 0 skipped，退出码 0**（8.16s） | 5 个 v013 护栏的 `read()` 归一化 CRLF（`core.autocrlf=true` 下 `git reset` 会让文件变 CRLF，多行断言在 CI 假绿、本机假红）+ 元护栏扫描 `tests/static/**` 强制该约定；负向对照实跑删掉归一化即 exit 1。上一阶段基线为 197 / 198 用例 |
| 静态套件（V13-17 站内 Feed 收敛后，历史记录） | 同上 | **15 文件 / 198 用例：198 passed / 0 failed / 0 skipped，退出码 0**（8.93s） | 新增 `src/lib/node-visibility.ts` 纯模块 + 站内 `/api/feed*` 专项断言 + 纯模块「不得真实 import server-only / @/db」行首锚定判据 + `pg_ctl -t 300` 不得放宽就绪判据（V13-18）。**过程如实记录**：两次 1 failed —— ① 护栏用 `not.toContain` 朴素匹配，被纯模块注释里的说明文字误伤；② 护栏正则漏了 shell 的 `[`（`/if\s+"\$start_rc"/` 对不上 `if [ "$start_rc" ]`）。两处均按真实语法修正后复绿，未放宽任何断言 |
| TypeScript | `NODE_OPTIONS="" npx tsc --noEmit` | **通过（退出码 0）** | 改动收齐后多次复跑，均无输出 |
| 版本载体 | `node scripts/release/sync-version.mjs 0.0.12 --verify` | **20/20 载体通过，退出码 0** | 新增 README 锚点与 `docs/release-facts.json` 载体 |
| 发行一致性门禁 ⑦ | `bash scripts/release/verify-release-consistency.sh --expect 0.0.12` | **PASS=19 FAIL=0，退出码 0** | 数字新鲜度 + Release Notes 无写死历史数字的双向断言 |
| 工作流 YAML 解析 | `python -c "yaml.safe_load(...)"` 全部 13 个 | **13/13 可解析，0 失败** | 含 `release.yml`（11 jobs）/ `ci.yml`（3 jobs） |
| 0 用例负向对照 | `vitest -t "不存在的用例名XYZ"` + `assert-test-counts.mjs` | **门禁 exit 1**（`真实通过的用例数 0 < 下限 1`） | 证明「全 skip 判成功」的洞已堵 |
| Release Notes 注入（真实脚本抽取） | 从 `release.yml` heredoc 抽脚本 + 模板实跑 | `VERSION=v0.0.13` ⇒ **exit 0**，注入 2730 字符、无内部状态词；`v0.0.1` / `v0.0.12` / `garbage` ⇒ **均 exit 1** | 前缀碰撞（`v0.0.1` 命中 `v0.0.13`）已不可绕 |
| **v013 新增 E2E（真实 HTTP）** | `SPEC="v013" bash scripts/ci/run-e2e-locally.sh` | **13 passed / 0 failed，退出码 0**（1.8m） | 含 hidden 节点**前后对照**（active 时探针回复 1 条 → hide 后 `[]`；active 时主题在 `/api/feed` → hide 后消失）、`/feed/all.xml` 与 `/feed/ALL.xml` 均 200 Atom |
| **全量 E2E（本版最终）** | `SPEC="" SKIP_BUILD=1 bash scripts/ci/run-e2e-locally.sh` | **257 passed / 0 failed，退出码 0**（30.3m） | 比上一轮 256 多 1 条 = 新增 hidden 节点负向用例。前置阶段 `PASS=8 FAIL=0`；本机走 `PgKV` 降级、CI 走真实 Redis，两者各覆盖一半，不得互相冒充 |
| **一次瞬时 worker 超时（如实记录）** | 同一 `npx vitest run --config vitest.static.config.ts` | 某次运行出现 `Failed to start forks worker ... Timeout waiting for worker to respond`，Vitest 只跑了 14 文件 / 187 用例并 `Errors 1`，**退出码 1** | 本机并发资源竞争（当时同时有 5 个 node 进程与 CI 轮询）；**未改任何超时/门槛**，紧接着复跑即 15 文件 / 200 用例全绿、退出码 0。按纪律记为「环境瞬时故障 + 已复现失败必须披露」，不当作通过 |
| 完整单元套件 | CI run `42558593027`（job 类型检查 / 单元测试） | **594 passed**（首跑因护栏读 `.env.test` ENOENT 判红 ⇒ 已修真因并复绿） | 合并前 CI 全绿 |
| 跨浏览器矩阵（15 分片） | CI `E2E 跨浏览器矩阵（v0.0.7）` | **15/15 pass**（chromium / firefox / webkit × 5 视口） | 上一轮反复出问题的 firefox 窄视口本轮通过 |
| 视觉回归验收 | CI `视觉回归验收` | **success** | — |
| 安全审计 Host Header | CI `安全审计 Host Header` | **success** | — |
| Docker / Redis 隔离、SMTP 稳定性、安装验证、原站对照探测 | CI 同名工作流 | **全部 success** | — |
| **候选构建 + 隔离安装（真 Docker）** | CI `候选安装链路验证` run `42566683445`，**产物绑定 SHA `99296d9`**（源码锚点校验通过） | **success：28 项通过 / 0 失败**；候选 ZIP SHA256 `ddff0a21…8b9d`、镜像 tar `ecfb6ba2…bbf4`、镜像 ID `sha256:d1daef7c…26f9`。该 SHA 之后的提交**仅改文档**：`git diff --name-only 99296d9 HEAD -- src deploy drizzle package.json Dockerfile` 必须为空，否则产物失效、需重建 |；docker load → compose → 健康 → 登录 → 发帖 → 回复 → **重启不丢数据**；**未执行任何 `docker push`** | 三种发行状态里只完成前两种 |
| **双基线原地升级 + 备份恢复** | `verify-upgrade-v0010.sh`（v0.0.4 / v0.0.12 → 0.0.13） | **PASS=20 FAIL=0**：业务指纹 46 项逐字节一致、迁移幂等连跑 3 次、备份 → 恢复库指纹完全一致（含结构指纹） | 基线迁移集取自 `git archive v0.0.12 drizzle`（与 v0.0.9 逐字节相同，已核验） |
| **候选 ZIP（本机）** | `package-deploy-zip.mjs --version 0.0.13` | 15 文件、`deploy/VERSION=0.0.13`、7 个 .sh 均 `0o100755`、SHA256 `1f83fda9…5d71`，**两次构建 SHA256 完全一致** | 与 CI 的 `…candidate.zip` 是不同产物（前者 deploy-only，后者含镜像 tar） |
| **公开发布（Tag / Release / GHCR）** | — | **未执行**：`v0.0.13` Tag / Release 不存在；匿名拉取 `:v0.0.12`=200、`:v0.0.13`=**404** | 缺 G10 授权 + R-01 DEFERRED ⇒ **NO-GO** |
| CI run / PR | PR #47（30 pass）→ #48（24 pass）→ #49（27 pass） | **全部 CLEAN 合并**；唯一 conditional skip 是 `诊断 Firefox thanks 403`（按设计跳过） | 期间唯一失败为静态护栏读未跟踪 `.env.test`（CI ENOENT），已修真因并复绿，未用重跑掩盖 |
| CI（最终 `master` 提交） | `CI` / 视觉回归 / 安全审计 / SMTP / Docker+Redis / 候选链路 | **全部 success** | 见 `gh run list --branch master` |

> **纪律**：0 条用例收集必须判失败；跳过用例必须披露；失败退出码必须传播；
> 不得靠重跑掩盖竞态；每条证据必须对应准确 SHA。
> `docs/release-facts.json` 中的 444 单元 / 220 E2E 是 **v0.0.12 历史实测**，
> 不是 v0.0.13 结论；本版数字必须在实跑后写入，并同步 README 的测试表与 Release Notes 模板。

---

## 4. 环境事实（本机 Windows）

| 项 | 事实 |
|---|---|
| Docker | **守护进程不可用** —— Docker Desktop 已装但 WSL2 后端被安全策略阻止（`wsl.exe` 在黑名单），无管理员权限 ⇒ 依赖真实 Docker 的验证**必须**走 GitHub Actions ubuntu runner |
| PostgreSQL | 17.5 便携版 `_tools/pgsql/pgsql/bin`，端口 55433（主验证）/ 55440（单元测试隔离实例） |
| Redis | 无（zip 损坏）；应用有 `PgKV` 降级路径 |
| 环境变量注入 | **必须 shell 注入，不能用 `ENV_FILE`** —— `.env.local` 指向开发库，Next.js 的 `@next/env` 会先占位 |
| Vitest | 本机需 `NODE_OPTIONS=""`，避免 WorkBuddy 的 `node-language-shim.cjs` 干扰 |
| `next build` | 会改写 `tsconfig.json` / `next-env.d.ts` 指向 `NEXT_DIST_DIR`；**提交前必须恢复** |
| 原站探测 | 代理 `127.0.0.1:10001`，**低频、只读、间隔 ≥ 2 秒**；不绕过访问控制、不批量复制数据 |
| PowerShell | 仅 5.1；PS 7 由 CI `windows-latest` 覆盖 |

---

## 5. 授权边界（**最重要，不得越界**）

**已自主执行 / 允许自主执行**：代码修改、静态/单元/E2E 测试、分支推送、PR 创建、
必要 CI 修复、正常合并、合并后版本载体同步、候选镜像 / ZIP 构建、候选环境安装与升级验证、文档维护。

**未获授权，禁止执行**：
创建或推送 `v0.0.13` Tag · 创建 / 修改 GitHub Release（**含已发布的 v0.0.12 Release Notes**）·
推送公开 GHCR 镜像 · `release.yml` 的 `workflow_dispatch` 发布 · 远端历史改写 ·
force push · 移动 / 删除旧 Tag · 删除 / 覆盖旧 Release · 更改仓库 Public 状态 ·
删除生产数据或用户文件。

**授权核查结论**：检索历史 transcript 与工作日志，**未发现**对 v0.0.13 的明确风险接受
及公开发布授权。`docs/RISK_DECISION_v0.0.9.md` §二第 4 条限定「仅针对 v0.0.9」，
`docs/RISK_DECISION_v0.0.10.md` 亦为本版本单独裁决 —— **均不构成 v0.0.13 先例**。
R-01（81 个对象，历史仍可达）维持 **DEFERRED**。

**v0.0.12 Release Notes**：只做只读核查，**不修改**（修改已发布 Release 属不可逆操作）。
若发现过时内容，在 `RELEASE_GATE.md` 与本文披露，而不是改动线上说明。

---

## 6. 阶段进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 一 | 接管真实状态 | ✅ 完成 |
| 二 | 一次性审计旧版 API（15 项矩阵 + 3 个补齐端点） | ✅ 代码完成，待完整门禁 |
| 三 | 接口数据一致性与隐私 | ✅ 代码完成，待完整门禁 |
| 四 | Feed 完整兼容与真实阅读器验证 | ✅ 代码完成，待完整门禁 |
| 五 | 登录 / 验证码 / 点击幂等收尾 | ✅ 代码完成，待完整门禁 |
| 六 | 功能矩阵真实性治理 | ✅ 完成 |
| 七 | 修复发行文档 | ✅ 完成 |
| 八 | 完整质量验收（16 项） | ⏳ **进行中**（静态 / tsc 先行，其余待 CI） |
| 九 | 集成收尾 PR 与发行候选交付 | ⏳ 未开始 |
| 十 | 正式发布权限与风险边界 | ⛔ **NO-GO（缺授权）** |
| 十一 | 发布后验收 | ⛔ 仅在获授权并实际发布后执行 |
| 十二 | 自主推进与上下文保护 | ✅ 本文持续维护 |

---

## 7. 待办（按执行顺序，不逐步询问）

1. 复跑完整静态套件 + `tsc --noEmit`，把真实数字写回本表与 `docs/release-facts.json`。
2. 核查 `e2e/` 与 `tests/` 新增 spec 的语法 / 配置（`playwright.config.ts` 是否收录）。
3. 针对 3 个新端点与 Feed 跑本地可用范围的真实 HTTP 验收（隔离库 + `next start`）。
4. 提交并推送 `feat/v0013-release-closeout`，创建**单一发行收尾 PR**，修复必需 CI 直至全绿。
5. 正常合并到 master；固定最终 SHA；运行 `node scripts/release/sync-version.mjs 0.0.13`；
   在**同步后的提交**上重新执行必要门禁。
6. 构建候选 Docker 镜像与 ZIP、计算 SHA256、验证候选环境安装 / v0.0.12 原地升级 / 备份恢复。
7. 检查发布工作流 / Tag / Release 冲突，出具最终 Go / No-Go。
8. **集中提交一次最终发布决策**：因缺 v0.0.13 风险接受与公开发布授权，
   候选交付完成后停止在「候选」，不创建 Tag、不推公开镜像、不发 Pre-release。

---

## 8. 三种发行状态不得混为一谈

1. **候选构建成功**：镜像 / ZIP 生成、SHA256 可核验；
2. **候选环境安装成功**：干净 Linux 可部署、可注册登录发帖、可从 v0.0.12 原地升级且数据保留；
3. **正式公开发布成功**：Tag 指向准确、公开 Pre-release 可见、匿名下载 / 拉取通过、发布后验收全绿。

当前 **1、2 尚未执行，3 明确 NO-GO**。候选交付完成 ≠ 已发布。

---

## 9. 变更记录

- 2026-11-09：接管 master `7b30d7f`，创建 `feat/v0013-release-closeout`；
  完成阶段二~七代码与文档主体；静态套件首跑 138/140（2 failed，退出码 1）暴露 V13-09；
  建立本交接文档。后续每次推进追加一行。
