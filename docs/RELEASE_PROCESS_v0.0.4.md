# V2EX Clone v0.0.4 — 发布流程（第八阶段 · 重新设计并固化）

> 编制：部署运维工程师（devops-engineer / 陆上线）
> 仓库：`C:/Users/TYMO001/WorkBuddy/ai/v2ex-clone`
> 基线分支 / HEAD：`feat/v0.0.4-high-fidelity` @ `89d6b4e`
> 版本目标：`v0.0.4`（开发预览版 / Pre-release）
>
> **⚠️ 本文档只设计并固化流程，不执行发布。**
> 编制过程中**未**创建/删除/移动任何 Tag、**未**创建或修改任何 Release、**未** push、未改远端仓库可见性、未 force push、未动 v0.0.3 的 Tag 与 Release、未发布任何资产。所有「远端核验」章节均为**待授权后执行的操作说明**。

---

## 0. 为什么要重设计（本轮的真实教训）

v0.0.1 → v0.0.3 的发版过程暴露了三类问题，v0.0.4 必须用流程把它们挡住：

1. **Tag 语义被当成可擦写的草稿**：`RELEASE_GATE.md` / `RISK_REGISTER.md` 记录了「v0.0.1 tag 使原站素材持续可达」与「移动已发布 Tag」的冲突（R-11 / R-01）。Tag 一旦创建就是**对外承诺**，不能因为流水线有缺陷就删了重建。
2. **发布流水线自身的缺陷会污染正式产物**：`release.yml` 历史上出现过 `dry_run` 输入是死代码（勾选「仅验证」仍会推镜像 + 发 Release）、gitleaks 假通过、GHCR 匿名可见性误判等问题。这些缺陷**必须在非正式环境里修完并验证**，不能拿 `v0.0.4` 这个正式版本号去试错。
3. **版本号散落 10+ 处且无自动检查**：本轮 `preflight.sh` 首轮实跑发现 `package.json` / `deploy/VERSION` / `.env.example` / `install.sh` / `install.ps1` / `docker-compose.yml` / `update.sh` / README / INSTALL / 其余脚本注释 / `release.yml` 白名单 **全部仍是 0.0.3**，且 Release Notes 硬编码 `v0.0.1`。
   > **主理人裁决（已写入 `CHANGELOG.md` `[Unreleased]`）**：这**不是缺陷**——v0.0.4 开发阶段刻意保持 `0.0.3`，在最终 SHA 固定前升版本号会造成「版本已是 0.0.4、却没有对应 Tag」的中间态，且后续改 SHA 又要改版本号，等同于被禁止的「同一版本号反复移动」。正确流程是 `[Unreleased]` 累积 → 合并并固定最终 SHA → **一次性**同步版本载体、Tag、Draft Release。
   > 因此 `preflight.sh` 已改为**双模式**（`--phase=dev` 默认 / `--phase=release`），开发态把 `0.0.3` 报为 `[INFO]` 而非 FAIL；详见 §5.3 与 §14。`release.yml` 内置 Release Notes 的 `v0.0.1` 硬编码已由主理人改为 `__VERSION__` 占位符 + `sed` 动态注入，preflight 相应改为检查动态版本，现报 PASS。

---

## 1. 发布红线（不可协商）

| # | 红线 | 具体含义 |
|---|---|---|
| **R1** | **v0.0.4 期间禁止提前创建最终 Tag** | 功能完成、审查、测试、构建、部署验证、安全扫描、安装包验证、合并、固定最终 SHA 全部完成之前，`refs/tags/v0.0.4` 在**本地与远端都不允许存在**。`preflight.sh` 会检查本地；远端状态由主理人在授权后核验 |
| **R2** | **同一版本号不得反复删建或移动 Tag** | 一旦 `v0.0.4` Tag 被推送，**禁止** `git tag -d` / `git push --delete` / `git tag -f` / `git push --force`。发布后发现阻断项，只能保持 Draft、出修正版本（如 `v0.0.4.1` 或 `v0.0.5`，**由主人裁决**），并在 Release Notes 说明；绝不「删了重发」 |
| **R3** | **不动 v0.0.3 的 Tag 与 Release** | 不删除、不移动、不编辑 v0.0.3 Tag/Release/资产；也不动 v0.0.1 / v0.0.2。`preflight.sh` 会打印本地 v0.0.3 Tag 作为基线提示 |
| **R4** | **未经主人单独授权不得公开发布有阻断风险的 Release** | `RISK_REGISTER.md` R-01 目前为 **DEFERRED**。因此 `publish` 输入**默认保持 `false`**，Release **默认停在 Draft**；`gh release edit --draft=false` 属需单独授权的动作。✅ **v0.0.4 已获授权**（2026-11-05 主理人「转正式发布」），以 `gh api --method PATCH ... -F draft=false` 直接转正（未重跑流水线，资产已核验通过），发布后核验：匿名下载 HTTP 200 + SHA256 逐字匹配。 |
| **R5** | **发布流程缺陷先在独立测试版本与非正式流水线验证** | 见 §6。禁止用 `v0.0.4` 这个正式版本号去调试流水线 |
| **R6** | **固定最终 SHA 之后才建 Tag** | Tag 必须指向**合并后**的、经过全部验证的、不再变动的 commit；`release.yml: preflight` 会校验 `REMOTE_SHA == github.sha` |
| **R7** | **数据库变更与应用发布解耦** | `0002` 是纯增量索引（见升级报告 §6.3），可先迁移后发代码；回滚代码不需要回滚数据库。破坏性变更必须走「扩展 → 兼容 → 切换 → 清理」四步 |
| **R8** | **密钥绝不进代码库** | 所有口令由安装脚本随机生成 / CI `github.run_id` 派生 / `::add-mask::` 屏蔽；`deploy/.env` 与 `INSTALL_CREDENTIALS.txt` 永不入库、永不进发布包 |
| **R9** | **版本载体推迟到最终 SHA 固定时一次性同步** | 开发态所有版本载体**刻意保持 `0.0.3`**，禁止提前升到 `0.0.4`（否则产生「有版本号无 Tag」的中间态，且后续改 SHA 会反复移动版本号，违反 R1/R2）。只有在 §5 第 9 步固定最终 SHA 之后，才**一次性**把 `package.json` / `deploy/VERSION` / `deploy/.env.example` / 安装脚本 / compose / 文档 / `release.yml` 白名单同步到 `v0.0.4`，随后立刻以 `--phase=release` 复跑 preflight 验证。责任人与执行时刻见 §5.3 |

---

## 2. 环境规划

| 环境 | 用途 | 数据来源 | 配置来源 | 访问权限 |
|---|---|---|---|---|
| 开发分支 | 功能开发（`feat/v0.0.4-high-fidelity`） | 本地库 / 容器卷 | `.env.local`（不入库） | 开发者 |
| 隔离验证 | 安装/升级/恢复实跑（本轮 `v2ex_upg_v004_*`） | 每次新建独立库 | 系统 Temp 下的一次性 `.env` | 仅本任务 |
| CI（ci.yml） | 干净克隆回归 | 每 run 新建 `v2ex_ci` / `v2ex_release_unit` / `v2ex_release_e2e` | workflow 内随机口令（`github.run_id`） | 仅 runner |
| **预发 / RC（非正式）** | 发布流程缺陷演练（`v0.0.4-rc.N`） | **独立测试仓库 / fork**，独立库、独立镜像命名空间 | 非正式流水线 `release-rc.yml` 的 `workflow_dispatch` 输入 | 团队内部，**不对外** |
| 正式发布 | `v0.0.4` Tag + Draft Release + 发行包 | 不可变 GHCR 镜像 + SHA256SUMS | `release.yml` tag 白名单触发 / `dry_run` 与 `publish` 输入 | 主理人 + 主人授权 |
| 用户生产 | 自助单机安装 | `postgres-data` / `redis-data` 卷（升级不删卷） | `install.sh` / `install.ps1` 生成的 `.env`（600 / NTFS ACL） | 用户本机 |

**隔离保证**：PG / Redis 默认不暴露宿主机端口（compose 无 `ports`，CI 与 release 流水线有三重检测）；四层环境不共享凭据、不共享数据卷；生产与测试用不同镜像 tag。

---

## 3. 容器化与编排（与仓库实际映射）

- **镜像**：`Dockerfile` 多阶段 `deps → builder → runner`；runner 用 `npm ci --omit=dev` + `USER nextjs`；`drizzle-kit` / `tsx` 上移到 `dependencies` 以保证 entrypoint 迁移可用；`COPY drizzle` + `drizzle.config.ts` + `.dockerignore` 的 `!drizzle/*.sql` 白名单保证 **0002 进镜像**。
- **编排**：`deploy/docker-compose.yml` 三服务，`depends_on: service_healthy`，app healthcheck 用镜像内 `node` 探 `/`，`start_period: 90s` 覆盖冷启动迁移；`scripts/docker-entrypoint.sh` 三阶段 `migrate → init → start`，`seed.ts` 用 `kv_store.segment:initialized` 守卫，重启不重置管理员口令、不污染数据。
- **资源与伸缩**：当前单机 Compose，**无 CPU/内存 limits、无 replicas**（静态事实）。建议生产至少 2 GB 磁盘；若水平扩展，PG 是单点瓶颈，需先做读写分离/连接池治理。
- **健康检查与优雅停机**：`stop.sh` 用 `docker compose stop`（保留卷）；`install-verify.yml` 有断言确保**任何脚本都不执行 `down -v`**；`restore.sh` 要求先停服并使用 `--single-transaction` 原子恢复。
- **制品版本与追溯**：镜像同时打 `v0.0.4` 与 `sha-<SHA>`（**刻意不生成 latest**）；`org.opencontainers.image.revision` 记录 SHA；`provenance` / `sbom` attestation；安装包附 `SHA256SUMS`。

---

## 4. CI/CD 流水线（阶段 / 门禁 / 失败处理）

| 阶段 | 步骤（对应实际 workflow） | 质量门禁 | 失败处理 |
|---|---|---|---|
| ① 校验 | `ci.yml: unit` → `npx tsc --noEmit`、`node scripts/ui-verify.cjs` | 0 类型错误；API 契约全匹配（基线 72 路由 / 30 调用） | 红灯，`needs` 阻断后续 |
| ② 代码审查 | PR review / 主理人终审 | 审查通过、无未决评论 | 不合并不建 Tag |
| ③ 完整自动化测试 | `ci.yml`（单元 + E2E + Docker 真实构建/启动）；`release.yml: unit-tests` / `e2e-tests` | 单元 **194 条 / 16 文件**（194 passed / 0 failed / 0 skipped，连续 4 轮全绿；修复前基线 190 条 / 15 文件）、E2E **154 条 / 11 文件**（`--list` 实测 `Total: 154 tests in 11 files`）—— **均已写入 `TEST_REPORT.md`**；迁移幂等。✅ **CI 单元已转绿**（run `41860242099` / `41873009808`，190 条口径）；✅ **本地 E2E 全绿 154/154（11 文件，3.9m）** —— 节点申请 UI 提交链断裂（V4-20 / R-27）**已由 `bddb3d0` 修复并本地实测验证**；✅ **CI E2E 已复验通过**（run `41949555282`，SHA `bddb3d0`：`154 passed (2.5m)` / 0 failed） | 🟢 **CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）—— 确认 CI 侧同样全绿后方可进入构建阶段 |
| ④ 独立构建 | `release.yml: code-checks`（`tsc` + `npm run build`）；`build-image`（`docker build`） | 构建成功；镜像不含 `.env` / `docs/evidence`；`dry_run=true` 时只 `load` 不 `push` | 红灯并上传报告 |
| ⑤ Docker 部署验证 | `release.yml: deploy-verify`（真实 compose 启动 → healthy → 管理员创建 → 注册探针 → 重启持久化 → 端口不暴露）；`install-verify.yml` 的 Linux 真实 Docker job | 全通过、日志上传 | 红灯，`cancel-in-progress: false` 保证不中途取消 |
| ⑥ 安全扫描 | `release.yml: security-scan` | `npm audit` critical/high = 0；gitleaks 只扫 Git 跟踪文件（避免假通过）；发布包内容检查（无 `.env` / 凭据 / 原站素材） | 红灯；报告作为 artifact 保留 7 天 |
| ⑦ 安装包验证 | `release.yml: package` + `install-verify.yml` Windows PS 5.1 / Git Bash 逻辑分支 | 14 文件齐全、SHA256SUMS、无 `down -v`、BOM 与 ACL 断言 | 红灯；中国大陆 Windows 侧只能标「脚本逻辑验证」，真实 Docker 由 Linux 侧负责 |
| ⑧ 合并 | 合并到主干（由主理人执行） | 工作区干净、无未提交变更 | 不合并不建 Tag |
| ⑨ **固定最终 SHA** | `git rev-parse HEAD` 记录**唯一** SHA 并写入发布记录 | SHA 不再变动 | 若合并后又有提交，回到 ③ |
| ⑩ 创建 v0.0.4 Tag | 基于 ⑨ 的 SHA 建 **annotated tag** 并 push（tag push 触发 `release.yml`） | `preflight` 校验 `REMOTE_SHA == github.sha`、Tag/Release 未被占用 | 冲突即中止，**绝不删建/移动** |
| ⑪ Draft Release | `publish-release`（`dry_run != true` 才调度）→ `gh release create --draft --prerelease --target <SHA>` | 默认 `--draft`；`publish` 默认 **false** | 竞态二次检查（Release / Tag 是否已存在）后中止 |
| ⑫ 远端核验 | `verify-release`（只读） | 资产齐全、GHCR 带凭据可拉取、匿名 Bearer 探测、Release 页面（仅已发布时） | 红灯并保留证据 |

**人工审批卡点**：
- `workflow_dispatch.publish`（`boolean`, `default: false`）——**R-01 未授权前永远保持 false**；
- `workflow_dispatch.dry_run`（`default: true`）——手动触发默认只验证；
- `release.yml` 的 `on.push.tags` **显式白名单**（当前仅 `v0.0.2` / `v0.0.3`）——刻意的摩擦，让「新增 tag = 新发布」必经人工确认。**发布时须由主理人手工加入 `- 'v0.0.4'`，不会自动加**（门禁 G-VER-01，见 §5.3）；
- `concurrency.cancel-in-progress: false`——不允许取消进行中的发布，避免「镜像已推、Release 未建」的半成品。

---

## 5. 发布流程总顺序（唯一合法路径）

```
开发分支 feat/v0.0.4-high-fidelity
   │
   ├─ 1. 功能完成（v0.0.4 全部修复项 + 回归用例）
   ├─ 2. 代码审查（PR review / 主理人终审）
   ├─ 3. 完整自动化测试（单元 / E2E 连续复验全绿（单元 190 条 / 15 文件、E2E 154 条 / 11 文件，均为 v0.0.4 实测权威值）；迁移幂等实跑）
   ├─ 4. 独立构建（干净克隆：tsc / next build / docker build，不依赖开发机产物）
   ├─ 5. Docker 部署验证（真实 compose 启动 + 健康 + 重启持久化 + 端口不暴露）
   ├─ 6. 安全扫描（npm audit / gitleaks / 发布包内容检查）
   ├─ 7. 安装包验证（Linux 真实 Docker 全流程 + Windows PS 5.1 / Git Bash 逻辑分支）
   │      └─ 同时完成：§6 的 RC 预演；开发态 preflight（--phase=dev）通过；
   │         核对版本同步清单（**此时不得修改版本载体**，见 R9 / §5.3）
   ├─ 8. 合并到主干（主理人执行，工作区干净）
   ├─ 9. 固定最终 SHA：主理人执行 G-VER-01「版本载体一次性同步提交」，
   │     **该提交即最终 SHA**，此后不得再改动任何代码（§5.3）
   │      · 版本载体 0.0.3 → 0.0.4；release.yml 白名单**人工加入 'v0.0.4'**
   │      · `bash scripts/release/preflight.sh --phase=release` → FAIL 必须为 0
   ├─ 10. 创建 v0.0.4 Tag（annotated，指向 ⑨ 的 SHA，push 后触发 release.yml）
   │      └─ 发布产物版本标识（Tag / Draft Release / 镜像 tag / 安装包名）在此一次性同步，不改代码
   ├─ 11. 创建 **Draft** Release（--draft --prerelease，publish 保持 false）
   └─ 12. 远端只读核验（Release 资产 / SHA256SUMS / GHCR 镜像）
```

**任何一步失败 → 停止，回到开发分支修复，从第 3 步重新走。绝不跳步、绝不「先发再补」。**

### 5.1 第 9–10 步的具体做法（固定 SHA 与 Tag 不可变）

```bash
# 仅在全部前置步骤通过、且合并已完成之后，由主理人执行
git switch <主干分支>
git rev-parse HEAD                 # 记录最终 SHA，写入发布记录
FINAL_SHA=$(git rev-parse HEAD)

# 只读确认远端尚未占用（禁止用 ls-remote 的结果反推「可以覆盖」）
git ls-remote --tags origin 'refs/tags/v0.0.4'      # 必须为空
gh release view v0.0.4 --repo <repo>                 # 必须不存在

# 基于最终 SHA 建 annotated tag（不是轻量 tag，便于追溯签名与说明）
git tag -a v0.0.4 "$FINAL_SHA" -m "V2EX Clone v0.0.4 (pre-release)"
git push origin refs/tags/v0.0.4                    # 唯一一次推送，之后不可移动
```

> `release.yml: preflight` 在 tag push 分支会 `git ls-remote --tags origin "refs/tags/$VERSION^{}"` 解引用并与 `github.sha` 比较；不一致即 `::error::` 中止。这正是 R6 的自动化保障。
>
> **不要**用 `workflow_dispatch` 代替第 10 步：手动触发时 tag 尚不存在，`publish-release` 里的 `gh release create --target "${{ github.sha }}"` 会**顺带创建 tag**，绕过「先固定 SHA、再显式建 Tag」的人工卡点。手动触发只应用于 `dry_run=true` 的演练（见 §6）。

### 5.2 第 11 步：Draft Release 的硬约束

`release.yml: publish-release` 已实现：

- `gh release create … --prerelease --draft --target "${{ github.sha }}"` —— 先建 Draft；
- 核验资产齐全后：`PUBLISH="${{ inputs.publish || 'false' }}"`；仅当 `true` 才 `gh release edit --draft=false`；
- `verify-release` 用**列表接口**读 Release（按 tag 查询端点不返回 Draft，实测 404）；draft 状态跳过匿名下载校验。

**本轮必须：`publish=false` → Release 保持 Draft**，因为 R-01 仍为 DEFERRED（见 §11 阻断项清单）。

### 5.3 【显式门禁 G-VER-01】版本载体推迟到最终 SHA 固定时一次性同步

| 字段 | 内容 |
|---|---|
| **门禁编号** | **G-VER-01**（对应红线 R9 / 检查单 C 组 / 阻断项 B-02、B-03） |
| **责任人** | **主理人（team-lead）** —— 唯一有权修改版本载体与 `release.yml` 白名单的人；部署运维工程师只提供只读检查脚本，**不执行修改** |
| **执行时刻** | **仅在第 9 步「固定最终 SHA」时**，作为形成最终 SHA 的「版本同步提交」；第 1～8 步（含当前开发态）**一律不得修改版本载体** |
| **解除条件** | `bash scripts/release/preflight.sh --phase=release` 返回 `FAIL=0`（BLOCK 项除外需主人裁决），且工作区干净 |
| **依据** | 主理人裁决，已写入 `CHANGELOG.md` `[Unreleased]` 段：v0.0.4 开发阶段 `package.json` / `deploy/VERSION` / README / FEATURE_MATRIX / RELEASE_GATE / TEST_REPORT 等**统一刻意保持 `0.0.3`**。在最终 SHA 固定前升版本号会造成「版本已是 0.0.4、却没有对应 Tag 与 Release」的中间态，且后续改动 SHA 又要改版本号 —— 正是被禁止的「同一版本号反复移动」 |

**执行时刻的可执行性澄清（必须区分两类对象，否则流程无法落地）**：

| 对象 | 是否改文件 / 改 SHA | 执行时刻 |
|---|---|---|
| **代码内版本载体**：`package.json`、`deploy/VERSION`、`deploy/.env.example`、`install.sh`、`install.ps1`、`docker-compose.yml`、`update.sh`、deploy 文档与脚本注释、`CHANGELOG.md` / `README.md` / `FEATURE_MATRIX.md` / `RELEASE_GATE.md` / `TEST_REPORT.md`、`release.yml` 的 tag 白名单条目 | **改文件 → 会改变 SHA** | 必须并入第 9 步的「版本同步提交」，**在最终 SHA 之内落地** |
| **发布产物版本标识**：annotated Tag `v0.0.4`、Draft Release 标题与 tag、GHCR 镜像 `v0.0.4` / `sha-<SHA>`、安装包文件名与 SHA256SUMS | **不改文件 → 不改 SHA** | 第 10 步最终 SHA 固定之后一次性同步 |

> ⚠️ 若把「改版本载体文件」放在固定 SHA **之后**，必然产生新 commit 使 SHA 变化，与 R6「Tag 必须指向固定的最终 SHA」直接冲突。因此「固定最终 SHA」指的是**版本同步提交完成后的 HEAD**；此后不再有任何代码改动。这条澄清不改变裁决意图（不提前升级、不产生中间态），只保证流程可执行。

### 5.4 版本载体清单（**8 项，全部逐条可复核**）

> 用途：第 9 步「版本同步提交」时**一次性**把这 8 项改为 `v0.0.4`，**在此之前一律不得改任何一项**。
> 每项都附**取数/复核命令**，任何人一条命令即可确认当前状态。

| # | 版本载体 | 当前值（2026-11-04 实测） | 复核命令 | 改法 |
|---|---|---|---|---|
| **1** | `package.json` 的 `version` | `0.0.3` | `grep '"version"' package.json` | → `0.0.4` |
| **2** | `deploy/VERSION`（单行纯文本） | `0.0.3` | `cat deploy/VERSION` | → `0.0.4` |
| **3** | `README.md` 版本区 | `v0.0.3` | `grep -n '当前版本' README.md` | → `v0.0.4`（**版本表 + 版本历史 + 顶部提示块**三处一起改） |
| **4** | `FEATURE_MATRIX.md` 生成时间行 | `v0.0.3 开发分支` | `grep -n '生成时间' FEATURE_MATRIX.md` | → `v0.0.4`（并删掉「版本载体刻意保持 0.0.3」的说明） |
| **5** | `RELEASE_GATE.md` 标题与目标版本 | `v0.0.2 发布门槛检查单` / 目标版本 `v0.0.2` | `head -1 RELEASE_GATE.md` | → `v0.0.4`（标题、目标版本、§0 速览三处一起改） |
| **6** | `TEST_REPORT.md` 版本标识 | `0.0.3` 口径 | `grep -n '0\.0\.3' TEST_REPORT.md` | → `v0.0.4` |
| **7** | `.github/workflows/release.yml` 的 **tag 白名单** | 仅含 `- 'v0.0.2'` / `- 'v0.0.3'` | `grep -A6 'tags:' .github/workflows/release.yml` | ⚠️ **人工放行**（见下） |
| **8** | `.github/workflows/install-verify.yml` | **无版本硬编码** —— 已核实：仅 2 处 `0.0.x` 出现在**注释**里（L7「v0.0.1 暴露的两个 Windows 缺陷」、L503「not-yet-published v0.0.2 image」），**均为历史叙述**，不是版本判断逻辑 | `grep -nE '0\.0\.[0-9]' .github/workflows/install-verify.yml` | **无需改动** —— 该工作流用**本地镜像 tag** `V2EX_IMAGE: v2ex-clone:install-verify`（L85），**不依赖发布版本号** |

#### 关于第 7 项（tag 白名单）—— **人工放行，不会自动**

`release.yml` 的 `on.push.tags` 是**显式白名单**（当前仅 `v0.0.2` / `v0.0.3`）而非 `'v*'` —— 这是**刻意的摩擦**（R-19），
防止任意 tag 触发带 `packages: write` / `contents: write` 的发布流水线。
因此它**不会自动加入 `v0.0.4`，也没有脚本会替你加**。

- **发布时由主理人在白名单中手工增加一行 `- 'v0.0.4'`**（随「版本同步提交」一起合入，或在第 7 步单独合入）。
- `preflight --phase=release` 会校验该项，**缺失即 FAIL**（推 tag 将不触发任何 job）。
- 开发态该缺失只报 `[INFO] 发布时需人工加入白名单`，**不判 FAIL**。
- ⚠️ **本文件不代替人工操作** —— 文档里写「已加」不等于仓库里加了。

#### 关于第 8 项（install-verify.yml）—— **已核实无需改动**

该工作流**按本地镜像 tag 验证脚本逻辑**，与发布版本号解耦。**这与「按 tag 取版本」不同**，
但结论相同：**无需改动**。⚠️ 两处注释里的 `v0.0.1` / `v0.0.2` 是历史叙述，不是版本断言 ——
如需一并更新措辞，属 QA/CI 成员的文件，**本轮未改**。

### 5.5 版本同步的**强制执行顺序**（8 步，**不可颠倒**）

> ⚠️ **顺序错了就作废**：提前建 Tag、反复删建或移动同一 Tag、在第 2 步之前先改任何版本载体 ——
> 三者**均被明令禁止**。

| 步 | 动作 | 约束 |
|---|---|---|
| **1** | 全部开发与测试完成 | 含本轮全部缺陷修复、UI 缺口补齐、CI 红灯清零 |
| **2** | **一次性**把 §5.4 的 **6 个代码内版本载体**（第 1~6 项）改为 `0.0.4` | ⚠️ **一次性** —— 不允许分多次改；**在此之前一步都不许改** |
| **3** | **提交**这次版本同步 | 该提交**并入最终代码提交**，**不单独成为最终 SHA** |
| **4** | **测试该准确提交** | 跑完整 Vitest + Playwright —— ⚠️ **必须是改完版本号之后的那次提交**，不是改之前的 |
| **5** | 合并并确定最终 SHA | 此后**不再有任何代码改动** |
| **6** | 创建不可变 Tag `v0.0.4` | annotated，指向第 5 步的 SHA；**绝不删建/移动** |
| **7** | **手动**把 `v0.0.4` 加入 `release.yml` 的 tag 白名单 | ⚠️ **人工放行**（R-19 刻意的摩擦），**不会自动加**；`preflight --phase=release` 校验缺失即 FAIL |
| **8** | 触发发布流水线 → 创建 **Draft** Release | 有阻断风险且未获授权时**只能停在 Draft**；`publish` 输入默认 `false` |

> ⚠️ **第 2 步 vs 第 7 步的分工**：第 2 步改的是**代码内载体**（改文件 → 会改 SHA），
> 必须落在最终 SHA **之内**；第 7 步改的是 **tag 白名单**（同样是文件 → 也会改 SHA），
> 因此它**必须在第 5 步确定最终 SHA 之前完成**，或者作为第 3 步的一部分一并提交 ——
> **绝不能放在第 5 步之后**，否则会产生新的 commit 使 Tag 指向的 SHA 失效（R6 冲突）。
> ⚠️ **第 7 步的 `preflight --phase=release` 校验**，因此也必须在最终 SHA 固定**之前**跑通。

**`release.yml` tag 白名单必须人工加入 `v0.0.4`（明确写出）**：

`release.yml` 的 `on.push.tags` 是**显式白名单**（当前仅 `v0.0.2` / `v0.0.3`）而非 `'v*'` —— 这是**刻意的摩擦**，防止任意 tag 触发带 `packages: write` / `contents: write` 的发布流水线。因此它**不会自动加入 `v0.0.4`，也没有脚本会替你加**。发布时由主理人在白名单中手工增加一行 `- 'v0.0.4'`，并随「版本同步提交」一起合入；`preflight --phase=release` 会校验该项，缺失即 FAIL（推 tag 将不触发任何 job）。开发态该缺失只报 `[INFO] 发布时需人工加入白名单`，不判 FAIL。

**preflight 双模式如何配合本门禁**：

| 阶段 | 命令 | 版本载体 `0.0.3` 的判定 | 白名单未含 v0.0.4 的判定 | 期望 |
|---|---|---|---|---|
| 第 1～8 步（当前开发态） | `bash scripts/release/preflight.sh`（默认 `--phase=dev`） | `[INFO]` 开发态刻意保持，**不计 FAIL** | `[INFO]` 发布时需人工加入 | `FAIL=0`；仅 `BLOCK=1`（R-01） |
| 第 9 步版本同步提交之后 | `bash scripts/release/preflight.sh --phase=release` | `[FAIL]` 一律 FAIL | `[FAIL]` 一律 FAIL | **`FAIL=0` 才允许固定 SHA / 建 Tag** |

脚本头部会打印 `phase=dev|release`，release 模式额外提示「本模式只应在最终 SHA 固定后运行」。**两种模式都严格只读**（不写文件、不联网、不自动修复），且**任何模式下都不放宽**以下真缺陷项：R-01 授权 BLOCK、`install.ps1` BOM、6 个 `.sh` 语法、0002 迁移幂等与无破坏性 DDL、无被跟踪 `.env`、0002 进镜像、entrypoint 执行 migrate、`publish` 默认 false、`dry_run` 默认 true、Release Notes 动态版本。

---

## 6. 发布流程缺陷的独立验证（R5 的具体做法）

### 6.1 两层演练，都不碰 `v0.0.4`

**A 层：正式流水线的无副作用演练（`dry_run=true`）**

利用现有 `release.yml` 的 `workflow_dispatch`：

```
inputs:
  version:  v0.0.4
  dry_run:  true      # 默认
  publish:  false     # 默认
```

- `preflight` 在手动触发分支要求**远端 Tag 不存在**（当前满足）；
- `build-image` 只 `load` 不 `push`，并通过 artifact 把镜像归档传给 `deploy-verify`；
- `publish-release` 与 `verify-release` 因 `dry_run != 'true'` 的 job 级 `if` **整个跳过**，`contents: write` 根本不生效；
- 可验证前 8 个 job（preflight → code-checks → security-scan → unit/e2e → build-image → deploy-verify → package），**不产生任何 Tag / Release / 远端镜像**。

> 局限：A 层**不覆盖** Tag 创建与 Draft Release 两个环节（那两个 job 被跳过）。因此必须有 B 层。

**B 层：影子版本 + 非正式流水线（`v0.0.4-rc.N`）**

在**独立测试仓库 / fork**（不是主仓库）里：

1. 从 `release.yml` 复制出 `release-rc.yml`，只在该非正式副本中做以下改动：
   - `on.workflow_dispatch.version` 的版本格式校验由 `^v[0-9]+\.[0-9]+\.[0-9]+$` 放宽为允许 `-rc\.[0-9]+`（**现有正式正则不接受 rc 后缀**，这是必须先修的流程缺陷）；
   - push tag 白名单改为 RC 专用（如 `v0.0.4-rc.1`），**绝不含 `v0.0.4`**；
   - `IMAGE_NAME` 指向测试命名空间 / 测试仓库，避免污染正式 GHCR；
   - `publish-release` 永远 `--draft`，且**删除** `gh release edit --draft=false` 分支；
   - `dry_run` 闸门、竞态二次检查、`concurrency` 设置保持与正式一致。
2. 用 `v0.0.4-rc.1` 跑完整 12 步链路 → 收集失败日志 → 在 **rc 分支**修流程缺陷 → `v0.0.4-rc.2` 再跑 → 直到全绿。
3. RC 产物全部是**影子产物**：镜像 tag 带 `-rc.N`、Draft Release 在测试仓库、资产不对外分发。
4. 把验证通过的流水线修复 **cherry-pick 回开发分支**，走 §5 的正式流程。

**禁止事项**：不得在**主仓库**创建 `v0.0.4-rc.*` Tag 并触发正式 `release.yml`；不得让 RC 镜像占用 `ghcr.io/.../v2ex-clone:v0.0.4`；不得用 `v0.0.4` 这个正式版本号做任何试错。

### 6.2 本轮已实跑的流程缺陷演练（本地，只读）

| 项 | 结果 |
|---|---|
| `scripts/release/preflight.sh` 首轮实跑（**修正前口径**） | `PASS=18 WARN=3 FAIL=16 BLOCK=1`，退出码 1 |
| 首轮发现的脚本自身 bug | `grep -c … \|\| echo 0` 无匹配时输出两行 `0` → `[: 0\n0: integer expected` 与一条误报 FAIL；已修为 `grep -c … \| head -1` 并重跑通过 |
| **口径修正（主理人裁决后）** | 首轮 16 个 FAIL 中的 13 个版本类判定**不是发布缺陷** —— 版本载体 `0.0.3` 属开发态预期。脚本已改为双模式（§14）：dev 模式 `FAIL=0`、release 模式 `FAIL=14`，两种模式都保留 R-01 BLOCK。Release Notes 硬编码 `v0.0.1` 是真缺陷，已由主理人修复，preflight 现报 PASS |
| 结论 | 检查脚本本身经历了「跑 → 发现缺陷 → 按裁决修判定口径 → 双模式复跑」，符合 R5 精神；**未对正式版本号做任何试错** |

---

## 7. 发布策略

- **形态**：发行包是用户自助单机安装，无中心化流量，无法按用户/租户/流量灰度。因此采用「**RC 预演 + 单一不可变正式版本 + 全量替换**」。
- **放量节奏**：RC（团队内部）→ Draft Release（主理人/主人可见，不公开）→ 主人授权后转正式（**本轮不执行**）。
- **不可变性**：Tag 一旦推送不动；Release 资产一旦生成不替换（如需修文案，只改 notes 文本，不换资产 —— 这是 v0.0.1 已验证过的做法）；镜像 `v0.0.4` tag 不覆盖，另打 `sha-<SHA>` 便于精确回滚。
- **数据库与发布顺序**：`0002` 全是 `CREATE … IF NOT EXISTS`，无破坏性 DDL（升级报告 §6.3 实跑数据指纹不变）。因此**允许先迁移后发代码**，且**回滚代码无需回滚数据库**；旧代码不依赖新索引，只是变慢。
- **升级路径（用户侧）**：`./backup.sh` → **手工修改 `.env` 的 `V2EX_IMAGE` 为 `v0.0.4`** → `./update.sh` → 等待 healthy → 核验 7 个索引与 `pg_trgm`（SQL 见升级报告 §2.3）→ 核验 `password_hash` 与主题数不变。
  > ⚠️ **收尾轮更新（R-18 已修）**：`deploy/update.sh` 已重写（提交 `b0d68c2`），新增 `./update.sh --version vX.Y.Z` 路径 —— **自动改写 `.env` 的 `V2EX_IMAGE` 为目标镜像**，并补齐**失败自动回滚**（镜像 + `.env` 双恢复）、**备份失败中止**、**非法版本号拒绝**、**镜像未变化时告警中止（退出码 3）**。**不指定 `--version` 时仍沿用 `.env` 中的旧镜像（向后兼容路径）**，因此上面的手工步骤**仍然必须执行**。
  > 自检：`bash scripts/release/verify-update-script.sh` → **87 项断言全 PASS / 0 FAIL**（沙箱模拟，不调用真实 Docker；本轮实测，历史为 62 项）。⚠️ **残余**：真实容器级升级仍需带 Docker 的环境复跑（并入 R-16 重跑批次）。
- **回滚**：见 §8。

---

## 8. 回滚预案

| 触发条件 | 判定方式 | 执行步骤 | 预计耗时 | 验证方式 |
|---|---|---|---|---|
| 发布后应用接口 5xx / healthcheck 不 healthy | `docker compose ps`、`GET /api/nodes` 非 200、容器日志 | ① 停新版本；② `.env` 的 `V2EX_IMAGE` 改回上一个已验证 tag/digest；③ `docker compose up -d`（**不删卷**）；④ 保留 0002 索引即可（对旧代码无害） | 3–5 min | `GET /` 200、管理员可登录、`count(users)` 与升级前一致、完整指纹一致 |
| 安装包拉错镜像（N-01） | 用户现场 `docker inspect` 显示 `v0.0.3` | 停止分发该包；**不删 Tag、不覆盖 Release 资产**；修正版本走新版本号（主人裁决 `v0.0.4.1` 或 `v0.0.5`） | 需裁决 | 新镜像 digest 与 Tag 一致；安装包内 10+ 处版本字面量全为新版 |
| 数据不一致 / 迁移后账本异常 | 指纹 `a7335937…` 不一致；`sum(balance) != sum(credit_ledger.amount)` | `./stop.sh` → 恢复到**新库**（`--single-transaction`）→ 核对完整指纹 `fc3512608…` → 再切换 | 15–30 min | 完整指纹一致；余额/账本逐用户自洽 |
| Redis 运行中失效 | ioredis 错误日志、限流 5xx | 恢复 Redis → **必须重启 app**（`getKV()` 后端选择只在进程启动时发生）→ 必要时清空 `REDIS_URL` 降级 PgKV | 2–5 min | `redis-cli ping`=PONG；错误登录触发 429；业务数据不变 |
| PG 重启 / 连接池失效 | `connect_timeout` 报错 | 恢复 PG → 重启 app（entrypoint 自动重跑幂等迁移） | 3–8 min | healthcheck healthy；指纹一致 |
| 必须撤销 0002（仅在确认索引致回归时） | EXPLAIN 明确归因 | 停服 → 备份 → `DROP INDEX IF EXISTS` × 7 → 查 `pg_depend` 后再决定是否 `DROP EXTENSION pg_trgm` → 删除 journal 第 3 条 → 启动 | 10–15 min | 索引数回 69；数据指纹不变 |
| Draft Release 内容有误 | 主理人复核发现 | **只编辑 notes 文本**；**不替换已上传资产、不动 Tag**；若资产确实错误，走新版本号 | — | 资产 `createdAt`/大小未变；Tag SHA 未变 |

**回滚演练安排**：数据库层「迁移 → 升级 → 备份 → 恢复 → 再迁移」闭环已在 `v2ex_upg_v004_*` 三个隔离库实跑（升级报告 §2–§5）。**容器级回滚（改镜像 tag → 重启 → 校验数据不变）因本机无 Docker 未演练**，必须在 `install-verify.yml` 的 Linux 真实 Docker job 里补一次：候选镜像 → 回滚镜像 → 校验 `password_hash` 与 `count(topics)` 不变，并在发布记录里登记 run id。

---

## 9. 可观测性与应急

- **日志**：当前仅 `docker compose logs --tail=200` 与 `deploy-logs.txt` artifact（retention 7 天）；**无集中日志采集与留存策略** —— 改进项，不阻断本轮。
- **指标 / 告警**：未接入 Prometheus/AlertManager；`GET /api/admin/config` 可查 Redis 配置状态；healthcheck 只探 `/`。**告警分级、通知渠道、值班响应流程尚未建立** —— 改进项。
- **链路追踪**：未接入。
- **应急最小闭环（本轮可落地）**：`docker compose ps` → `logs --tail=200` → `restart app` → 用 `scripts/release/fingerprint.sql` 比对指纹 → 必要时从最近备份恢复到新库 → 填写故障复盘（保留 migrate 输出、指纹文件、容器日志三者）。
- **故障复盘机制**：任何一次回滚或失败发布，24 小时内产出「触发条件 / 判定依据 / 时间线 / 根因 / 修复 / 防回归断言」，并把防回归断言写进 `preflight.sh` 或 CI workflow。

---

## 10. 安全与成本

- **密钥与证书**：`.env` 由 `install.sh`/`install.ps1` 用 `openssl rand -hex` / `RandomNumberGenerator` 生成（Linux `chmod 600`、Windows `icacls /inheritance:r`）；CI 用 `github.run_id` 派生随机口令并 `::add-mask::`；`deploy/.env` 与 `INSTALL_CREDENTIALS.txt` 被 `.gitignore` + 发布包内容检查双重排除。证书由用户在反向代理侧自备 HTTPS，仓库不托管。**密钥绝不进代码库**。
- **漏洞扫描**：`npm audit`（critical/high 阻断，moderate 记录不静默）、gitleaks（只扫 Git 跟踪文件，避免历史噪声与假通过）、发布包内容检查（无 `.env` / 原站素材 / 硬编码口令）。**容器镜像 Trivy/Grype 仍未接入**（`RELEASE_GATE.md` E9「部分未做」）——改进项。
- **GHCR 可见性核验（避免 v0.0.3 的误判）**：`verify-release` 已实现完整 Registry V2 **Bearer** 流程 —— 匿名 manifest 请求返回 401 是**公开包的正常行为**，必须用 `WWW-Authenticate` 的 `realm/service/scope` 换匿名 token 后重试，得到 200 才算公开可拉取。主理人已实测 v0.0.3 镜像为 **Public**，E-10 的「private」结论已推翻。**只看第一步 401 会误判为 private**，该逻辑不得删改。
  **门禁判据（与 `RISK_REGISTER.md` R-02 / E-10 对齐，v0.0.4 已修正）**：① **带凭据 `docker pull` 是发布成败判据**，失败即 `exit 1`；② 匿名 Bearer 三步探测**仅作 `::notice::` 提示**，不作为判据 —— 包可见性是仓库级配置，不由代码控制；③ 匿名探测必须是完整 Bearer 流程，不能只看首次 401。发布流程不得以「匿名拉取失败」为由阻断发布，也不得以「匿名拉取成功」代替带凭据拉取。
- **最小权限**：`release.yml` 顶层 `contents: read`；仅 `build-image` 提 `packages: write`、仅 `publish-release` 提 `contents: write`；`publish-release`/`verify-release` 有 `dry_run` 闸门；发布触发用 tag 白名单而非 `'v*'`；无 `pull_request_target`。
- **大模型 API Key**：本项目**不涉及**任何大模型 API，无 Key 轮换/配额告警需求。若将来引入，必须：环境变量注入 + 独立轮换周期（≤90 天）+ 用量预算告警 + 不写入 `.env.example` 示例值。
- **成本**：单机 Compose 无固定成本；主要变量是 GHCR 存储与 Actions 分钟数。已用 `cache-from/to: type=gha`、dry-run 镜像归档 retention 1 天、安装包 30 天。**建议**（未实施）对 GHCR 存储与 Actions 用量设置预算告警。

---

## 11. 发布前检查单（可勾选）

> 用法：由主理人在**每次发布前**逐项勾选；任一项未勾选 ⇒ 不得进入 §5 的第 9 步。
> `bash scripts/release/preflight.sh [--phase=dev|--phase=release]` 可自动覆盖其中「版本一致性 / 流水线闸门 / 迁移幂等 / 安装包结构」四类（**只读，不写、不联网**）。
> **C 组为 G-VER-01 门禁项，只在第 9 步「固定最终 SHA」时执行；当前开发态刻意保持 `0.0.3`，不勾选不代表缺陷**（见 §5.3 / R9）。

### A. 代码与测试

- [ ] 功能完成：v0.0.4 全部修复项（`GET /api/nodes` 500、`GET /api/topics/[id]` 500、分页、编辑按钮、楼层跳号、注册赠送绕开账本、`/hot` 页面）已合入并自查
- [ ] 代码审查通过，无未决评论
- [ ] `npx tsc --noEmit` 零错误
- [ ] `npm run build` 成功
- [x] 单元测试 **194/194** 全绿（**16 个文件，194 passed / 0 failed / 0 skipped，连续 4 轮全绿**。**本轮隔离实例实测 81.68s**；历史轮次 170~210 秒，共享实例 55433 口径。⚠️ **修复前基线为 190 条 / 15 文件** —— V4-20 修复新增 `tests/form-name-shadowing.spec.ts` 的 4 条防回归断言）—— 已写入 `TEST_REPORT.md`「v0.0.4 单元测试（权威口径）」小节
  - ⚠️ **「185」有两个来源**：**v0.0.3 历史总数**（master @ `37710fb4`）与 **修复前的历史观测**（`185 passed | 5 skipped (190)`，⚠️ **分母仍是 190**）。**v0.0.4 的用例总数在 V4-20 修复后为 194（修复前为 190）。**
  - ✅ **CI 侧已通过**（190 条口径）：run `41860242099` 与 `41873009808` 的「类型检查 / 单元测试」job 均 success（vitest 15 文件全过、`190 passed / 0 skipped`）。✅ **V4-20 修复后的 194 条（16 文件）已由 CI 复验通过** —— run `41949555282`（SHA `bddb3d0`）：`Test Files 16 passed (16)` / `Tests 194 passed (194)` / 0 skipped —— 当前仅**本地实测全绿**。**修复前的历史观测**（run `41837212170`，HEAD `930f29e`）：`floor-continuity` 在 CI 崩溃 ⇒ `unit` job 红 ⇒ `e2e` job 被 `needs: unit` 连带跳过 —— **已由 `8ce5ce9` 修复并经 CI 复验**（V4-17 VERIFIED / R-26 已闭环），`e2e` job **已真实跑过**
- [x] E2E 全绿 —— ✅ **当前权威实测 = 154 passed / 0 failed / 0 skipped（11 文件，3.9m）**（V4-20 修复后本地实跑）；**本地历史轮次口径**：153 passed / 0 failed / 0 skipped，**连续 2 轮全绿**，4.5m/轮 —— 基于 153 条口径，早于 `ed385cf`）—— 已写入 `TEST_REPORT.md`「v0.0.4 真实浏览器 E2E（权威口径）」小节。**当前权威分母 = 154 条 / 11 文件**（`--list` 实测 `Total: 154 tests in 11 files`）。口径分解见 `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md` §10.10.3 与 `docs/evidence/e2e/TEST_COUNT_DEFINITION_v0.0.4.md`
  - ✅ **修复前的历史快照**（run `41873009808`，SHA `2773cd1`）：**153 passed | 1 failed | 154 total**，唯一失败用例 `e2e/v004-four-roles-ui.spec.ts:122`「节点申请：UI 入口存在 + 真实点击提交成功 + 申请真实入库」—— **真实产品缺陷**（生产构建下节点申请 UI 提交链断裂），登记 V4-20 / R-27 —— **✅ 已由 `bddb3d0` 修复并本地实测验证**（根因：HTML 规范 `[OverrideBuiltins]` 使表单内**命名控件遮蔽 `form.nodeName`** ⇒ react-dom 水合代码 `canHydrateInstance` 中 `instance.nodeName.toLowerCase()` 抛 `TypeError` ⇒ React #418 水合失败 ⇒ 事件处理器不绑定 ⇒ 表单走原生 GET 提交；修复：表单命名属性改名 + 新增 `tests/form-name-shadowing.spec.ts`（4 条防回归断言）。实测：单元 194/194（16 文件）、E2E 154/154（11 文件，3.9m）全绿，React #418 **由 2 次归零**，提交恢复 `POST /api/node-requests`、URL 停在 `/nodes/request`、成功 toast 出现）。✅ **CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅） ⇒ **正式 Release 前必须确认 CI 侧同样 154/154 全绿**
- [ ] **口径区分（防止把专项当全量）**：qa-engineer 第二轮是**专项实跑** —— `tests/floor-continuity.spec.ts` 5/5、`e2e/v004-four-roles-ui.spec.ts` 8/8（连续三轮，最新 `expected=8, skipped=0, unexpected=0, flaky=0`）、`npx tsc --noEmit` EXIT=0。**全量判定只认 team-lead 任务 #1 写入 `TEST_REPORT.md` 的结果**；qa-engineer 无权修改 `TEST_REPORT.md`（其所有权仅 3 个文件）
  - [x] `test-list-v0.0.4.txt` 已由主理人重新 `npx playwright test --list` 生成并更新为 **154**（`Total: 154 tests in 11 files`）；正式发布前仍须再跑一次 `--list` 固定口径（端点冒烟用例数随 GET 路由数浮动）
- [ ] **测试环境注入**：`tests/setup.ts` 默认加载 `.env.local`，其 `DATABASE_URL` 指向 **5432**（本机无实例）；裸跑 vitest（未注入 `ENV_FILE` / `DATABASE_URL`）时 15 个单测文件中 11 个会连 5432 失败（实证 `ECONNREFUSED 127.0.0.1:5432`）。CI / 本地全量复验**必须注入 `ENV_FILE`**（如 `.env.test`，指向隔离实例 —— **按 `.env.test` 实际解析的端口，当前 55440**）。**`preflight.sh` 本身不触发任何测试**（只做只读存在性检查与 `bash -n`），不受此项影响
- [ ] 连续两轮全绿（本地 + CI），记录 CI run id
- [ ] `node scripts/ui-verify.cjs` API 契约校验通过

### B. 数据库（第六阶段报告 `docs/UPGRADE_RECOVERY_v0.0.4.md`）

- [ ] 全新安装实跑：26 表 / 76 索引 / 3 条迁移 / `pg_trgm 1.6` ✅（本轮已实跑通过）
- [ ] 升级实跑：数据指纹 `a7335937…` 前后一致、口令哈希/头像/积分账本不变 ✅（本轮已实跑通过）
- [ ] 迁移幂等连跑 3 次 exit=0、索引不重复 ✅（本轮已实跑通过）
- [ ] 备份恢复实跑：完整指纹 `fc3512608…` 一致 ✅（本轮已实跑通过，含一次失败与单事务重试）
- [ ] `0002` 无破坏性 DDL、可先迁移后发代码 ✅
- [ ] 回滚预案（§8）已评审，且**容器级回滚演练已补做**（⛔ 本机无 Docker，待 CI 补）

### C. 版本载体一次性同步（**G-VER-01 门禁，仅在第 9 步执行**；当前开发态为预期状态，见 §5.3）

> 责任人：**主理人**。执行时刻：**第 9 步固定最终 SHA 时**，随「版本同步提交」一次性完成；第 1～8 步**不得提前修改**。
> 开发态由 `preflight.sh --phase=dev` 把 `0.0.3` 报为 `[INFO]`；第 9 步提交后必须 `--phase=release` 且 `FAIL=0`。

- [ ] `package.json` → `0.0.4`
- [ ] `deploy/VERSION` → `0.0.4`
- [ ] `deploy/.env.example` `V2EX_IMAGE` → `…:v0.0.4`
- [ ] `deploy/install.sh` `APP_VERSION` / `DEFAULT_IMAGE` → `0.0.4` / `v0.0.4`
- [ ] `deploy/install.ps1` `$AppVersion` / `$DefaultImage` → `0.0.4` / `v0.0.4`
- [ ] `deploy/docker-compose.yml` 默认镜像 → `v0.0.4`
- [ ] `deploy/update.sh` 默认镜像 → `v0.0.4`
- [ ] `deploy/README.md` / `INSTALL.md` / 6 个 `.sh` 注释中的 `v0.0.3` 全部更新
- [ ] **`.github/workflows/release.yml` tag 白名单由主理人人工加入 `- 'v0.0.4'`**（刻意的摩擦，不会自动加，见 §5.3）
- [ ] `CHANGELOG.md` / `README.md` / `FEATURE_MATRIX.md` / `RELEASE_GATE.md` / `TEST_REPORT.md` 版本号与目标版本一致
- [ ] `deploy/INSTALL.md` 增加「v0.0.3 → v0.0.4 升级：先改 `.env` 的 `V2EX_IMAGE` 再 `./update.sh`」
- [ ] 版本同步提交完成后 `bash scripts/release/preflight.sh --phase=release` → **FAIL=0**
- [x] `release.yml` 内置 Release Notes 已去除 `v0.0.1` 硬编码，改为 `__VERSION__` 占位符 + `sed` 动态注入（主理人已修，preflight 现报 PASS，两种模式均校验）

### D. 流水线与安装包

- [ ] §6 的 A 层 `dry_run=true` 演练全绿，记录 run id
- [ ] §6 的 B 层 `v0.0.4-rc.N` 影子演练全绿，且**未在主仓库创建任何 rc Tag**
- [ ] `ci.yml` 最近一次 run 全绿，记录 run id
- [ ] `install-verify.yml` 在 v0.0.4 上重跑全绿（Linux 真实 Docker + Windows 逻辑分支），记录 run id
- [ ] `security-scan`：critical/high = 0；gitleaks 真扫且通过；发布包内容检查通过
- [ ] `deploy/` 14 文件齐全；`install.ps1` BOM `EF BB BF`；6 个 `.sh` `bash -n` 通过
- [ ] `.dockerignore` 的 `!drizzle/*.sql` 白名单仍在（0002 进镜像）
- [ ] SHA256SUMS 生成且可 `sha256sum -c`
- [ ] 发布后核验 7 个 0002 索引与 `pg_trgm` 确实存在（防 N-05 静默降级）

### E. 红线与授权

- [ ] 本地与远端**均无** `v0.0.4` Tag（发布前）
- [ ] `v0.0.3` Tag / Release / 资产**未被改动**
- [ ] v0.0.1 / v0.0.2 的 Tag / Release / 资产未被改动
- [ ] 最终 SHA 已固定并记录，之后无新提交
- [ ] `publish` 输入保持 **false**，Release 保持 **Draft**
- [ ] **R-01 授权状态已确认**：若仍 DEFERRED ⇒ 只停在 Draft，不公开发布
- [ ] 远端核验（§13）由授权人执行并留证
- [ ] 开发态：`bash scripts/release/preflight.sh`（默认 `--phase=dev`）→ **FAIL=0**；版本载体 `0.0.3` 报 `[INFO]` 属预期
- [ ] 第 9 步后：`bash scripts/release/preflight.sh --phase=release` → **FAIL=0**（版本载体已同步 + 白名单已加入）
- [ ] 两种模式下 `[BLOCK] R-01 DEFERRED` 均保留 ⇒ 退出码为 1、Release 停在 Draft 是**正确语义**，需主人单独授权才可能解除

---

## 12. 阻断项清单（当前状态）

> 数据来源：`scripts/release/preflight.sh` **双模式实跑** + 仓库静态核查（HEAD=`89d6b4e`）。
> **主理人裁决后已重新判定**：版本载体 `0.0.3` 属**开发态预期状态**，不是发布缺陷（见 §5.3 / R9）。因此 preflight 改为 `--phase=dev` / `--phase=release` 双模式，开发态不再产生 13 个版本类 FAIL。
>
> | 模式 | 真实汇总 | 退出码 | 判定理由 |
> |---|---|---|---|
> | `bash scripts/release/preflight.sh`（默认 dev） | **`PASS=22 WARN=1 FAIL=0 BLOCK=1 INFO=14`** | 1 | 无工程 FAIL；`BLOCK=1` 是 R-01 授权未决，禁止发布属**正确语义**；14 条 INFO 为版本载体 0.0.3 与「发布时需人工加白名单」 |
> | `bash scripts/release/preflight.sh --phase=release` | **`PASS=22 WARN=1 FAIL=14 BLOCK=1 INFO=0`** | 1 | 14 个 FAIL = 版本载体 13 项 + 白名单 1 项；本模式本就只应在最终 SHA 固定后运行，现在提前跑出 FAIL 是**预期** |
>
> （历史沿革：首轮 `PASS=18 WARN=3 FAIL=16 BLOCK=1` → 修 grep 误报后的中间版 `PASS=21 WARN=1 FAIL=15 BLOCK=1`（**裁决前单模式口径，已作废**）→ 主理人裁决后改为双模式，以上表与 §14 为准。保留沿革仅为可追溯，不代表当前判定。）

| # | 阻断项 | 类别 | 当前状态 | 归属 / 解除条件 |
|---|---|---|---|---|
| **B-01** | `RISK_REGISTER.md` **R-01** Git 历史原站素材经远端 refs 匿名可达，状态 **DEFERRED** | 🔴 合规 | ⛔ **仍阻断** | 需**主人单独授权**远端历史改写 / force push / 移动 v0.0.1 Tag / 改仓库可见性。隔离副本演练已成功（`docs/HISTORY_CLEANUP_DRILL_v0.0.4.md`），但远端操作本轮**未执行**。未授权 ⇒ Release 只能停在 Draft |
| **B-02** | 发行版 10+ 处版本字面量仍为 `0.0.3`（N-01） | 🟢 开发态非缺陷 / 🔴 发布态门禁 | ✅ **开发态预期（INFO）**；⏳ **发布态须清零** | 主理人裁决：开发阶段刻意保持 `0.0.3`（`CHANGELOG.md [Unreleased]`）。由 **G-VER-01** 在**第 9 步固定最终 SHA 时一次性同步**，随后 `--phase=release` 必须 FAIL=0。若不同步 ⇒ 安装包拉 v0.0.3 镜像，0002 不生效（见 §5.3） |
| **B-03** | `release.yml` tag 白名单无 `v0.0.4`（N-03） | 🔧 **工程阻断项（保留）**｜🟢 dev 预期 / 🔴 release 门禁 | ⏳ **发布态尚未解除**；开发态预期（INFO） | 白名单是**刻意的摩擦**，不会自动加。由主理人在 G-VER-01 的版本同步提交中手工加入 `- 'v0.0.4'`（§5.3）；`--phase=release` 缺失即 FAIL。不加入 ⇒ 推 tag 不触发任何 job |
| **B-04** | `release.yml` 内置 Release Notes 硬编码 `v0.0.1`（N-03） | 🔧 **工程阻断项（保留，防回归）**｜🔴 流水线 | ✅ **已修复，但门禁项保留** | 主理人已改为 `## __VERSION__ — 开发预览版` 占位符 + `sed -i "s\|__VERSION__\|${VERSION}\|g"` 动态注入（`VERSION` 取 `needs.preflight.outputs.version`，全文件 16 处动态引用）。本地实跑：6 处替换、0 残留、YAML 合法。preflight 已改为检查动态版本，两种模式均报 **PASS** |
| **B-05** | `deploy/update.sh` 未引导改镜像 tag，v0.0.3 用户无法升级（N-04） | 🔧 **工程阻断项（保留）**｜🟠 高 | 🟢 **已修并验证（收尾轮）** | 提交 `b0d68c2` 重写 `deploy/update.sh`（+688 行）：新增 `--version vX.Y.Z` 自动改写 `.env` 的 `V2EX_IMAGE` + **失败自动回滚**（镜像与 `.env` 双恢复）+ 备份失败中止 + 非法版本号拒绝 + 镜像未变化时告警中止（退出码 3）。**自检 87 项断言全 PASS / 0 FAIL**（本轮实测）。⚠️ 残余：不带 `--version` 时仍沿用 `.env` 旧镜像（向后兼容），故 `deploy/INSTALL.md` §8 的「先改 `.env` 再 `./update.sh`」说明**仍需保留**；真实容器级升级待带 Docker 的环境复跑 |
| **B-06** | 容器级回滚演练未做（本机无 Docker） | 🟠 高 | ⚠️ **未验证** | 由 `install-verify.yml` Linux 真实 Docker job 补做并登记 run id |
| **B-07** | `install-verify.yml` 未在 v0.0.4 重跑 | 🟠 高 | ⚠️ **未验证** | 发布前重跑全绿 |
| **B-08** | 0002 的 `pg_trgm` 权限不足会静默跳过 trigram 索引（N-05） | 🟡 中 | ⚠️ **未监控** | 发布后核验 `pg_extension` + 7 索引；长期补告警 |
| **B-09** | Redis 运行中失效不会自动降级（N-02） | 🟠 高 | ⚠️ **静态核查** | 恢复步骤强制重启 app；长期建议加健康探测 |
| **B-10** | 工作区有未提交变更（`git status --porcelain` 非空） | 🟡 中 | ⚠️ **待主理人统一提交** | 本轮明确不 `git commit`；由主理人统一提交后复跑 preflight |
| **B-11** | `RELEASE_GATE.md` 仍是 v0.0.2 视角、E9 容器镜像漏洞扫描「部分未做」 | 🟡 中 | ⚠️ **已知限制** | 不阻断本轮，但需在最终交付文档中如实披露 |
| **B-12** | 本机 Node `v22.22.2` < `engines >=22.23.4` | 🟢 低 | ⚠️ **未在 CI 版本复验** | 迁移工具链实跑正常；以 CI 的 22.23.4 结果为准 |

**当前结论（主理人裁决后重判）**：
- **开发态（现在）**：`preflight --phase=dev` 得到 `FAIL=0`。版本载体 `0.0.3`、白名单未含 v0.0.4 均为**预期状态**（14 条 `[INFO]`），B-04 已修复，B-05 已由文档缓解。**唯一的 BLOCK 是 B-01（R-01 DEFERRED，需主人单独授权）**。
- **发布态（第 9 步之后）**：G-VER-01 一次性同步版本载体并人工加入白名单后，`--phase=release` 必须 `FAIL=0`；否则禁止固定 SHA / 建 Tag。
- B-06～B-12 是需在发布记录中如实披露的未验证 / 已知限制。
- **按主理人要求，B-02～B-05 中只有「版本一致性」（B-02）按裁决降级为开发态预期；B-03 / B-04 / B-05 一律保留为工程阻断项并如实带进最终报告**：
  - **B-03 白名单**：开发态 INFO、**发布态尚未解除**（须由主理人人工加入 `- 'v0.0.4'`，`--phase=release` 缺失即 FAIL）；
  - **B-04 Release Notes**：**已修复**（`__VERSION__` + `sed` 动态注入）但**门禁项保留以防回归** —— preflight 两种模式都持续校验「无 `v0.0.1` 硬编码 + 动态版本注入存在」，现报 PASS；
  - **B-05 `update.sh` 升级**：✅ **收尾轮已修（R-18）** —— `deploy/update.sh` 已重写（`b0d68c2`），新增 `./update.sh --version vX.Y.Z` **自动改写 `.env` 的 `V2EX_IMAGE`** + **失败自动回滚**（镜像与 `.env` 双恢复）+ 备份失败中止 + 非法版本号拒绝 + 镜像未变化时告警中止（退出码 3）；`bash scripts/release/verify-update-script.sh` → **87 项断言全 PASS / 0 FAIL**（本轮实测；历史为 62 项）。⚠️ **残余**：不带 `--version` 时是**向后兼容路径**（沿用 `.env` 旧镜像），故 `deploy/INSTALL.md` §8 的「先改 `.env` 再 `./update.sh`」说明**仍需保留**；**真实容器级升级仍需带 Docker 的环境复跑**。
- **即使工程门禁全部清零，只要 B-01 仍为 DEFERRED，v0.0.4 Release 也只能停在 Draft，不得公开发布。**

---

## 13. 远端核验（**待授权后执行，本轮未执行**）

以下均为只读核验动作，仅在第 10–11 步完成、且获得授权后由主理人执行：

```bash
# 1) Tag 指向必须与固定 SHA 一致，且未被移动
git ls-remote --tags origin 'refs/tags/v0.0.4^{}'

# 2) Release 状态：必须 draft=true / publishedAt=null / prerelease=true
gh release view v0.0.4 --repo <repo> --json isDraft,publishedAt,isPrerelease,tagName,targetCommitish,assets

# 3) 资产齐全且校验和一致（仅已发布后；draft 资产匿名不可下载，属 GitHub 正常行为）
curl -sL -o /tmp/v2ex-clone-v0.0.4-deploy.zip \
  https://github.com/<repo>/releases/download/v0.0.4/v2ex-clone-v0.0.4-deploy.zip
sha256sum -c SHA256SUMS

# 4) 镜像带凭据拉取 + 匿名 Bearer 完整流程（只看第一步 401 会误判为 private）
docker pull ghcr.io/<repo>:v0.0.4
#  匿名 401 → 解析 WWW-Authenticate 的 realm/service/scope → 换 token → 带 Bearer 重试 → 200 才算公开

# 5) v0.0.3 未被改动（对照基线）
git ls-remote --tags origin 'refs/tags/v0.0.3^{}'
gh release view v0.0.3 --repo <repo> --json isDraft,publishedAt,assets
```

`release.yml: verify-release` 已实现 2/3/4 的自动化版本（用列表接口读 Draft、带凭据 pull、完整 Bearer 探测、SHA256 校验）。本轮**没有执行任何一条**。

---

## 14. 只读发布前检查脚本

`scripts/release/preflight.sh`（本轮新建）：

- **只读**：只用 `git status/rev-parse/branch/tag -l/ls-files`、`grep`、`sed`、`cut`、`tr`、`od`、`cat`、`node -p`、`bash -n`；
- **不写**：不建/删文件、不改文件、不 `git add/commit/tag/stash/checkout`、不跑迁移、不跑测试；
- **不联网**：无 `fetch/push/ls-remote/gh/curl/docker pull`；
- **不自动修复**：发现 FAIL / BLOCK 只报告，退出码 1；
- 检查 7 组：本地 Git 状态、版本号一致性、发布流水线闸门、迁移物与幂等性、安装包结构、测试记录与阻断项、汇总。

```bash
bash scripts/release/preflight.sh                    # 默认 --phase=dev
bash scripts/release/preflight.sh --phase=release   # 仅最终 SHA 固定后运行
bash scripts/release/preflight.sh --help
```

脚本为**双模式**，只改变「版本载体 / tag 白名单」的判定口径；R-01 BLOCK、`install.ps1` BOM、`.sh` 语法、0002 迁移幂等、密钥泄漏、Release Notes 动态版本等真缺陷项在**两种模式下都不放宽**（见 §5.3 门禁 G-VER-01）。

**两种模式的真实输出（HEAD=`89d6b4e`；以下为节选，同类行已合并压缩，非逐字逐行；完整输出可由上述命令复现）**：

```
############ MODE 1: 默认 dev ############        ############ MODE 2: --phase=release ############
=== v0.0.4 PREFLIGHT (READ-ONLY, phase=dev) ===   === v0.0.4 PREFLIGHT (READ-ONLY, phase=release) ===
repo   : /c/Users/TYMO001/WorkBuddy/ai/v2ex-clone  repo   : /c/Users/TYMO001/WorkBuddy/ai/v2ex-clone
target : 0.0.4 / v0.0.4                            target : 0.0.4 / v0.0.4
phase  : dev                                       phase  : release
        开发态刻意保持 0.0.3，版本同步推迟到最终             ⚠ 本模式只应在最终 SHA 固定后运行：
        SHA 固定时一次性执行（主理人裁决）                       所有版本载体必须为 0.0.4 / v0.0.4
        本模式不把版本载体 0.0.3 判为缺陷；                   依据：CHANGELOG.md [Unreleased] + 发布流程 §5 第 9 步
        真缺陷项（R-01 / 语法 / 幂等 / 密钥）仍严格判定

--- 1. 本地 Git 状态（只读）--- 两种模式相同 ---
        branch = feat/v0.0.4-high-fidelity
        HEAD   = 89d6b4e (89d6b4e30de711a4a99b46faa6aec1eb5bef9b4d)
[PASS]  当前分支可确定：feat/v0.0.4-high-fidelity
[WARN]  工作区有 23 处未提交变更（本脚本不清理、不 stash）
[PASS]  本地不存在最终 Tag v0.0.4（远端状态需人工核验，本脚本不访问网络）
        v0.0.3 本地 Tag（必须保持不动）：v0.0.3

--- 2. 版本号一致性 ---
[dev]  [INFO]  package.json version = 0.0.3 —— 开发态刻意保持 0.0.3，版本同步推迟到最终 SHA 固定时一次性执行
       [INFO]  deploy/VERSION = 0.0.3 —— 同上
       [INFO]  deploy/.env.example V2EX_IMAGE = ...:v0.0.3 —— 同上
       [INFO]  deploy/install.sh / install.ps1 / docker-compose.yml / update.sh / README.md
               / INSTALL.md / backup.sh / restore.sh / start.sh / stop.sh：保持 v0.0.3 字面量
               （2/2/2/2/4/8/1/1/1/1 处）—— 开发态预期，最终 SHA 固定时一次性同步
[rel]  [FAIL]  package.json version = 0.0.3（发布态期望 0.0.4；须在最终 SHA 固定时一次性同步）
       [FAIL]  deploy/VERSION = 0.0.3（同上）
       [FAIL]  deploy/.env.example V2EX_IMAGE = ...:v0.0.3（发布态期望 ...:v0.0.4）
       [FAIL]  deploy/install.sh / install.ps1 / docker-compose.yml / update.sh / README.md
               / INSTALL.md / backup.sh / restore.sh / start.sh / stop.sh 仍有 v0.0.3
               （发布态必须全部同步为 v0.0.4）—— 共 10 条

--- 3. 发布流水线闸门 ---
[dev]  [INFO]  发布时需人工把 'v0.0.4' 加入 release.yml 的 push tag 白名单
               （刻意的摩擦，符合 R1；开发态不判定为缺陷）
[rel]  [FAIL]  release.yml 的 push tag 白名单**未包含** v0.0.4（当前仅 v0.0.2 / v0.0.3）
               —— 发布时必须人工加入，否则推 tag 不触发任何 job
[both] [PASS]  publish 输入默认 false（Release 保持 Draft）
       [PASS]  dry_run 输入默认 true（手动触发默认只验证）
       [PASS]  release.yml 内置 Release Notes 使用动态版本（__VERSION__ 占位符 + sed 注入，
               16 处动态引用；无 v0.0.1 硬编码）
       [PASS]  release concurrency 不允许取消进行中的发布

--- 4/5/6：两种模式完全相同（均 PASS / 同一 BLOCK）---
[PASS]  journal 3 条；3 个 SQL 文件齐全；0002 的 7 条 CREATE INDEX 全带 IF NOT EXISTS；
        pg_trgm 带 IF NOT EXISTS；0002 无破坏性 DDL/DML
[PASS]  deploy/ 必需文件检查完成（14 项）；install.ps1 BOM=EF BB BF；6 个 .sh bash -n 通过；
        无被跟踪 .env；.dockerignore 保留 !drizzle/*.sql；entrypoint 执行 migrate
[PASS]  TEST_REPORT.md / 第六阶段报告 / 第八阶段文档均存在
           单元基线 190 条 / 15 文件 / E2E 154 条 / 11 文件（均为 v0.0.4 实测权威值）
[BLOCK] RISK_REGISTER R-01 仍为 DEFERRED —— 需主人单独授权；未授权前 Release 只能停在 Draft

--- 7. 汇总 ---
[dev]  phase=dev  PASS=22  WARN=1  FAIL=0   BLOCK=1  INFO=14
        开发态口径：版本载体 0.0.3 为预期状态（INFO），不计 FAIL；
        最终 SHA 固定后须以 --phase=release 复跑
        结论：无工程 FAIL，但存在 1 个 BLOCK（R-01 授权未决）—— **禁止发布 / Release 只能停在 Draft**
        DEV_EXIT=1
[rel]  phase=release  PASS=22  WARN=1  FAIL=14  BLOCK=1  INFO=0
        发布态口径：本模式只应在最终 SHA 固定后运行；版本载体 0.0.3 一律 FAIL
        结论：存在 14 个 FAIL / 1 个 BLOCK —— **禁止发布**
        RELEASE_EXIT=1
[参数] --help → HELP_EXIT=0；--phase=nonsense → BADARG_EXIT=2
```

> 注：两种模式均**严格只读**（无写文件、无远端操作、无自动修复）。`[WARN] 工作区有 23 处未提交变更` 中 `?? docs/RELEASE_PROCESS_v0.0.4.md`、`?? docs/UPGRADE_RECOVERY_v0.0.4.md`、`?? scripts/release/` 是本轮新建交付物；其余为团队其他成员并行修改（含 `M .github/workflows/release.yml`、`M RISK_REGISTER.md`、`M deploy/INSTALL.md` 等），**本轮未修改这些文件**。
> dev 模式退出码 1 并非缺陷：它来自唯一保留的 `[BLOCK] R-01 DEFERRED`，正是「未经主人单独授权不得公开发布」的自动化体现。

配套的 `scripts/release/fingerprint.sql` 是**只读**数据/结构指纹脚本（升级前后比对用），同样不含任何写语句。

---

## 15. 待确认（需主人 / 主理人裁决）

1. **R-01 历史清理授权**：是否授权改写远端历史 / 移动 v0.0.1 Tag / 调整仓库可见性？未授权前 Release 永远停在 Draft。（B-01）
2. **是否公开发布 v0.0.4**：即使其他阻断全清，仍需主人对「公开发布有阻断风险的 Release」单独授权。（R4）
3. **G-VER-01 版本载体一次性同步的执行**：`deploy/**`、`package.json`、`.github/workflows/release.yml` 不在我的所有权边界内，由**主理人在第 9 步固定最终 SHA 时**一次性执行（含人工加入白名单 `'v0.0.4'`），随后请复跑 `bash scripts/release/preflight.sh --phase=release` 确认 FAIL=0。当前开发态请以默认 `--phase=dev` 为准（`FAIL=0` 即正常）。
4. **若发布后发现 N-01 类错误，修正版本号用 `v0.0.4.1` 还是 `v0.0.5`**：按 R2 不得删建 `v0.0.4` Tag，需主人裁决新版本号。
5. **容器级回滚演练与 `install-verify.yml` 重跑的 run id**：因本机无 Docker，需主理人在 CI 侧补做并回填发布记录。（B-06/B-07）
6. **是否接入容器镜像漏洞扫描（Trivy/Grype）与预算告警**：`RELEASE_GATE.md` E9 仍为「部分未做」，本轮未变更。
7. **可观测性建设**（集中日志 / 指标告警 / 值班与复盘）是否纳入 v0.0.5 范围：本轮仅给出最小应急闭环。
8. **CHANGELOG / README / FEATURE_MATRIX / RELEASE_GATE / TEST_REPORT 版本一致性**：属 G-VER-01 范围，需主理人在「版本同步提交」中一并核对（C 组检查单）。另：qa-engineer 指出 `RELEASE_GATE.md` 仍是 v0.0.2 门槛（B3 ≥103 单元 / B4 ≥67 E2E），与 v0.0.4 实测 **190 / 154** 不匹配（收尾轮已在 `RELEASE_GATE.md` 顶部补 v0.0.4 门禁速览） —— **v0.0.4 门禁以 `TEST_REPORT.md` 实测与 `preflight.sh` 双模式为准，RELEASE_GATE.md 的旧阈值仅作历史基线，不得作为 v0.0.4 判据**（该文件不在我的所有权边界内，仅在此标注）。

---

## 16. 收尾轮（2026-11-04）新增的取证通道与已闭环项

> 本节记录 v0.0.4 收尾轮对发布流程的实质影响。**只记录本轮实测过的内容。**

### 16.1 Docker / Redis 取证通道（服务 R-16 / R-17）

新建 `.github/workflows/docker-verify.yml`（9 项验证 + 3 个 R-17 专项子任务），
作为本机无 Docker 时的**替代取证通道**。收尾轮修了它自身的**四个**缺陷（全部由真实 CI 跑出来）：

| 缺陷 | 现象 | 根因 | 修复 | 登记 |
|---|---|---|---|---|
| **V4-15** 定义级失败 | run 0 秒结束、`total_count=0`、**无任何 job 被创建**，报错仅「This run likely failed because of a workflow file issue」 | GitHub 表达式上下文**不支持 `&&`/`\|\|` 三元**（`\|\|` 取默认值支持） | 三元判断下沉到 shell 层：`$([ "${{ job.status }}" = 'success' ] && echo PASS \|\| echo FAIL)`；`${{ }}` 只用于传值 | `BUG_REGISTER` V4-15 |
| **V4-16** 迁移物路径断言错误 | 第 9 项报「✗ 镜像内缺少迁移文件: `_journal.json`」 | drizzle 的 SQL 在 `/app/drizzle/` 根目录，`_journal.json` 与 snapshot 在 `/app/drizzle/meta/` 子目录；初版混用同一路径断言 | SQL 与 meta 分成两段断言，各用正确路径 | `BUG_REGISTER` V4-16 |
| **V4-18** app 健康判定口径 | 第 2 项红灯 `✗ app 未达 healthy（none）` | 根目录 `docker-compose.yml` 的 **app 服务没有 healthcheck**（只有 `deploy/docker-compose.yml` 才有）⇒ `State.Health.Status` **永远返回 `none`**。⚠️ **CI 日志证明 app 完全健康**（`✓ Ready in 414ms`）—— 是断言读错 | 改为「**容器状态 + HTTP 探活**」（`State.Status == running` 且 `curl /` == 200）；PG/Redis 仍用 health 状态。**HTTP 探活是更强的证据** | `BUG_REGISTER` V4-18 |
| **V4-19** `[7/9]` 安装包部署必然失败 | 尚未被 CI 触发，但**一定会红** | ① **端口占用**：`install.sh` L163 的端口检查会因根 compose 的 app 容器仍占 3000 而 `die`；② **容器名冲突** | 断言与执行上下文分离 + 新增断言保证不变成外部镜像 | `BUG_REGISTER` V4-19 |

> ⚠️ **V4-15 的排查陷阱**：YAML 本身**能正常解析**（python yaml 校验通过，1 job / 17 steps），
> 问题只在**表达式求值阶段** —— 这是排查耗时的主要原因。已在工作流内留踩坑注释。

**首轮 CI 实跑已通过第 9 项「镜像内容与权限检查」的 6 个子断言**：
非 root（`Config.User` 非 root 且容器内 `id -u` ≠ 0）、8 项 devDependency 未检出、
3 个运行时文件已检出、5 个 env/凭据文件未检出、迁移 SQL 完整、镜像体积打印。

**✅ 后续已闭环（R-16 / R-17）**：run `41871503684`（SHA `2773cd1`）—— `docker-verify`
**九项全部 completed / success，九项汇总表全 PASS**。修复提交：
**`827eef7`**（安装模拟改走首次安装路径 —— 删掉不完整的 `.env` 预置）、
**`2773cd1`**（安装模拟前 unset job 级 env —— 修 compose 插值被 shell 环境变量覆盖导致的**假绿**）。
安装模拟段实证输出：`app health = healthy` / `POSTGRES_USER=v2ex POSTGRES_DB=v2ex SEED_ADMIN_USERNAME=admin` /
管理员账号数 = 1。

### 16.2 升级脚本（R-18 已修并验证）

| 项 | 内容 |
|---|---|
| 修复提交 | `b0d68c2`（`deploy/update.sh` +688 行） |
| 新增能力 | `--version vX.Y.Z` **自动改写 `.env` 的 `V2EX_IMAGE`**；**失败自动回滚**（镜像 + `.env` 双恢复）；备份失败中止升级；非法版本号拒绝；镜像未变化时告警中止（退出码 3） |
| 自检脚本 | `scripts/release/verify-update-script.sh`（749 行）—— **不依赖 Docker**：`mktemp -d` 沙箱 + 假 `.env` + 真实 `backup.sh` 副本 + docker stub，跑**真实的** `update.sh` |
| 实测结果 | **87 项断言全 PASS / 0 FAIL**（本轮实测；收尾轮独立复跑确认，历史为 62 项） |
| 硬约束 | 绝不执行真实 Docker 命令；绝不触碰仓库真实文件（自检末尾有校验和断言） |
| ⚠️ 残余 | **不带 `--version` 时是向后兼容路径**（沿用 `.env` 旧镜像）⇒ `INSTALL.md` §8 的手工步骤**仍需保留**；**真实容器级升级**仍需带 Docker 的环境复跑 |

### 16.4 ✅ CI 单元测试红灯（V4-17 / R-26）—— **已修复并经 CI 复验**

> **修复前的历史观测**（CI run `41837212170`，HEAD `930f29e`）：
> ```
>  Test Files  1 failed | 14 passed (15)
>       Tests  185 passed | 5 skipped (190)
> Error: ENOENT: no such file or directory, open '/home/runner/work/v2ex-clone/v2ex-clone/.env.test'
>  FAIL  tests/floor-continuity.spec.ts > 楼层号严格连续 1..N（真实 allocateFloor + 真实 INSERT）
> ```
>
> ⚠️ **注意这个形态**：是 `1 failed + 5 skipped`，**不是「少了几条」**。
> **分母是 190，与本机实测的 190 一致** —— 也就是说 **v0.0.4 的用例总数在 V4-20 修复前是 190（修复后为 194）**，
> 185 只是 **CI 上的通过数**（`floor-continuity` 5 条崩溃被跳过）。
> **核对 CI 时必须看 `Test Files` 行，不能只看 `Tests` 行** —— 这正是 R-23 那类静默跳过。
>
> **根因**：`tests/floor-continuity.spec.ts` 的 `baseDatabaseUrl()` ① 硬编码
> `readFileSync(path.join(repoRoot, '.env.test'))`，而 `.env.test` **被 `.gitignore` 排除**
> ⇒ **CI 检出里根本没有这个文件**；② 对 `process.env.DATABASE_URL` 有 `:55433/` 端口白名单，
> 而 CI 的 `DATABASE_URL` 是 `localhost:5432` ⇒ **即使环境变量已注入也不会被采用**。
> 两条路都走不通 ⇒ ENOENT 崩溃。
>
> **影响面（当时）**：① `unit` job 红灯 → **PR 无法合并**；② `e2e` job 被 `needs: unit` **连带跳过**
> → E2E 在 CI 上跑不起来；③ 掩盖了「楼层连续性」这条关键回归的 CI 覆盖
> —— 而它正是 B-05 楼层跳号缺陷（`allocateFloor` 双重 `+1`）的守护用例。
>
> **修复方向已实跑验证**（`docs/evidence/ci/test-baseline-v0.0.4.md` §0.5，在纯净 CI 检出 `/tmp/ci-sim` 上双向验证）：
> 去掉 `:55433/` 端口白名单 + 读 `.env.test` 前先 `existsSync` 判断 ⇒ **CI 条件与本地条件均 `5 passed`**。
>
> **✅ 状态：已由 `8ce5ce9` 修复并经 CI 复验**（护栏 3 修复提交 `634a202`）。
> **CI 复验结果**：run `41860242099` 与 `41873009808`（SHA `2773cd1`）的「类型检查 / 单元测试」job
> 均 ✅ —— `Test Files 15 passed (15)` / `Tests 190 passed (190)` / **0 skipped**，
> 且 `e2e` job **已真实跑过**（不再被 `needs: unit` 连带跳过）。
> 登记 `BUG_REGISTER` **V4-17（VERIFIED）** / `RISK_REGISTER` **R-26（🟢 已修复并经 CI 复验）**。

### 16.3 版本库卫生（R-25）

E2E 生成的 18 个头像占位 PNG 曾被 Git 跟踪。已 `.gitignore` 加规则 + `git rm --cached` 移出索引
（**不改写历史、不删磁盘文件**）。`git ls-files "public/uploads/*"` → **0 条**。
⚠️ **残余**：18 个占位图**仍在 Git 历史**里，彻底消除需授权改写历史。

---

## 附：本轮交付物与所有权边界

| 文件 | 类型 | 说明 |
|---|---|---|
| `docs/UPGRADE_RECOVERY_v0.0.4.md` | 新建 | 第六阶段安装/升级/恢复验证报告（含真实输出与失败记录） |
| `docs/RELEASE_PROCESS_v0.0.4.md` | 新建 | 本文档 |
| `scripts/release/fingerprint.sql` | 新建 | 只读指纹脚本 |
| `scripts/release/preflight.sh` | 新建 | 只读发布前检查脚本 |

**未做**：`git commit`（主理人统一提交）、任何 Tag/Release 操作、任何远端操作、任何现有受保护文件的修改、任何真实发布动作。
