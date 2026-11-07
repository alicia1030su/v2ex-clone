# V2EX Clone v0.0.9 · 正式发布最终交付报告

> **报告日期**：2026-11-07（发布后验收收尾 2026-11-07T22:18Z）
> **版本**：`v0.0.9` — 公开部署就绪版（Public Pre-release）
> **仓库**：`alicia1030su/v2ex-clone`
> **独立项目声明**：本项目为独立技术研究复刻工程，与 V2EX 官方无任何关联（MIT）

---

## 〇、一句话结论

**v0.0.9 已正式公开发布（Pre-release），从 GitHub 下载官方安装包、按 Release Notes 照抄命令、
在全新环境安装、迁移、注册、发帖、回复、重启保数据、备份恢复 —— 全部由「匿名视角」的独立
流水线在隔离 runner 上真跑通过（16 项，0 FAIL）。**

但有三件事必须与本结论同时阅读，任何一条都不允许被省略：

| # | 必须同时阅读的事实 | 影响 |
|---|---|---|
| 1 | **已发布资产内含 2 个真实缺陷**（V9-09 脚本无可执行位、V9-13 备份/恢复被误判），已在 master 修复，但**已发布资产不可覆盖**（本轮规约禁止删除/覆盖已有 Release） | 用户下载 v0.0.9 后会踩到；验收流水线以 `XFAIL` 逐条记录并**证明 master 修复有效**，不把红改绿 |
| 2 | **24 小时持续运行未完成** | GitHub 托管 runner 单 job 上限 6 小时，本版只完成 **1 小时真实长跑**（1h01m13s）。**不声称达成 24h** |
| 3 | **R-01 仍为 DEFERRED** | 历史中的原站素材未清理。本次发布仅在「完整披露 R-01」前提下作一次性风险接受，**不等于 R-01 已修复** |

---

## 一、发布事实（不可变标识，可独立复核）

| 项 | 值 |
|---|---|
| **发布用 commit（最终 SHA）** | `f82d06758e8e630661bd48ce75b529b731005f61` |
| **Tag 名** | `v0.0.9`（**注解标签**） |
| **Tag 对象 SHA** | `80a3b8c4e2be6c76629d9a5dd1f4734336aef43a` |
| **Tag 解引用后的 commit** | `f82d06758e8e630661bd48ce75b529b731005f61`（与上一行一致） |
| **Release 页面** | https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.9 |
| **公开状态** | `draft=false` · `prerelease=true` · `published_at=2026-11-07T21:46:22Z` |
| **镜像** | `ghcr.io/alicia1030su/v2ex-clone:v0.0.9` |
| **镜像真实 Digest** | `sha256:0511aa2f806ad1a720845e6293135320cba9b7acb97c20aacc3b1ac59c310565` |
| **安装包** | `v2ex-clone-v0.0.9-deploy.zip` · **57,118 字节** |
| **安装包 SHA256** | `50ec3b8b01a724f8f839616985b4d20c10101d7fb94ca9e555e0e6e6fba0b026` |
| **校验文件** | `SHA256SUMS` · 95 字节 · GitHub 侧 digest `sha256:e76166dc2f804551416d36903603a14e8e621badbba94add5509719345ea316d` |
| **发布流水线** | run `42416775836` · `2026-11-07T21:37:55Z → 21:46:45Z` · **11/11 jobs success** |
| **master 现状** | `67b5e8b`（发布后修复 V9-13；**不影响**已发布资产） |

> **ZIP 的 SHA256 有三重独立一致性**：
> ① 发布流水线本地 `sha256sum` 产出并写入 `SHA256SUMS`；
> ② GitHub 对上传资产的 `digest` 字段（`sha256:50ec3b8b…`）与之一致；
> ③ 发布后验收在**另一个 runner** 上重新下载并复算，结论一致。

---

## 二、总指令 §十一：15 项交付清单

| # | 要求 | 结论 | 证据（可复核） |
|---|---|---|---|
| 1 | 最终 SHA | ✅ | `f82d06758e8e630661bd48ce75b529b731005f61` |
| 2 | Tag SHA | ✅ | 标签对象 `80a3b8c4…` → commit `f82d067`（`git rev-parse v0.0.9 v0.0.9^{}` 两行不一致才是异常） |
| 3 | Release 链接 | ✅ | https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.9 |
| 4 | 公开状态与 Pre-release 标记 | ✅ | API 实测 `draft=false` / `prerelease=true`；**匿名**（无 token）访问页面 HTTP 200 |
| 5 | 镜像地址与 Digest | ✅ | `ghcr.io/alicia1030su/v2ex-clone:v0.0.9` · `sha256:0511aa2f…310565`；本地 manifest / Registry V2 响应头 / 流水线记录**三方一致** |
| 6 | 包名、大小、SHA256 | ✅ | `v2ex-clone-v0.0.9-deploy.zip` · 57,118 B · `50ec3b8b…b026` |
| 7 | 匿名下载验证 | ✅ | 验收 runner **无任何凭据**下载 ZIP 与 SHA256SUMS，`sha256sum -c` 通过（run `42419896478` 步骤②） |
| 8 | 匿名 Pull 验证 | ✅ | Registry V2：无 token 请求 → 401 → 取匿名 token → manifest **200**；`Docker-Content-Digest` 与本地一致（步骤⑤） |
| 9 | 全新安装结果 | ✅ | 官方包 `install.sh` **原样执行**（未改一行），迁移记录 4 条，管理员初始化、首页 200、注册 201、发帖 201、回复 200、重启后数据仍在、重复安装幂等（步骤⑥ / `verify-fresh-install.sh` 22 项断言） |
| 10 | v0.0.4 → v0.0.9 升级结果 | ✅ | 以**真实发布过的 v0.0.4 官方包**为基线，本机 PG17 实跑：`PASS=17 FAIL=0`；业务数据指纹逐字节一致（**42 项业务指纹 / 指纹文件 49 行**）、索引 76→78、迁移 3→4 |
| 11 | 单元 / E2E / 安全测试 | ✅ | 发布门禁 run `42416775836` 全绿（单元测试 / E2E 矩阵 / 安全扫描 / 类型检查 / 构建 / 部署验证 11 项）。发布后 master 现状：**单元测试 420/420**、静态套件 **20/20**（run `42419865513`，含本轮新增的 5 条 V9-13 回归）；Host Header 安全审计 19 场景、视觉回归、SMTP 稳定性、安装验证、Docker/Redis 隔离验证同日独立全绿 |
| 12 | 持续运行真实完成时长 | ⚠️ **1h01m13s，不是 24h** | run `42411802997`：`2026-11-07T20:35:38Z → 21:36:51Z`，工作流内置**时长诚实性门禁**（达不到目标时长即失败），本轮通过的是 1 小时档 |
| 13 | R-01 风险说明 | ⚠️ **DEFERRED** | 见 §五；`docs/R01_COMPLIANCE_REVIEW_v0.0.9.md` |
| 14 | 全部 PR 与 CI Run 链接 | ✅ | 见 §六 |
| 15 | 剩余问题与回滚办法 | ✅ | 见 §七、§八 |

---

## 三、发布后独立验收（匿名视角 · 隔离 runner · 16 项 0 FAIL）

**流水线**：`.github/workflows/post-release-verify.yml`，run **`42419896478`**（`67b5e8b`）
**设计约束**：只读权限（`contents: read`）、**全程匿名**、只 `workflow_dispatch`、
产物**只**来自公开发布资产；验证工具跟 master 走（`ref: github.sha`），
避免出现「工具缺陷在 Tag 里永远修不好」的死角。

| 验收项 | 结果 | 真实值 |
|---|---|---|
| 运行环境 | ✓ | v0.0.9 / Docker 29.4.2 / compose 5.1.3 |
| Release 页面匿名可访问 | ✓ | HTTP 200 |
| 安装包下载与 SHA256 | ✓ | 57,118 字节 / `50ec3b8b…b026` |
| 包内容与安全 | ✓ | 15 个文件 / 必需文件齐全 / 无 `.env` 与凭据 / 无明文 secret |
| 包内脚本可执行位 | ⚠️ WARN | 7 个 `.sh` 为 `0644`（**V9-09，已发布资产内置缺陷**）；按文档 `chmod +x` 后继续 |
| 三方版本一致 | ✓ | `VERSION=0.0.9` / `IMAGE=…:v0.0.9` / Release tag `v0.0.9` |
| 文档安装路径可达 | ✓ | **照抄 Notes 的 `unzip -d` / `cd` 命令**后 `install.sh` 可执行（V9-08 修复在此被实证） |
| 匿名镜像与 digest | ✓ | anonymous pull OK / `sha256:0511aa2f…310565`（本地与 Registry 一致） |
| 官方包全新安装 | ✓ | `install.sh` 原样执行 / 迁移 4 条 / 13 组断言全绿 |
| 通知写入路径 | ⚠️ WARN | 需第二用户回复触发，管理员登录受**强制验证码**保护，本环境无法自动化（由 CI E2E `v009-four-roles-acceptance` 覆盖） |
| 通知端点（已认证） | ✓ | signup 建会话 → `GET /api/notifications` 200 / 结构合法 |
| 备份 `backup.sh` | ✗ **XFAIL（V9-13）** | 已发布包内脚本把正常备份误判「内容为空」并删除 |
| **V9-13 修复有效性** | ✓ | master 版脚本在**同一实例**成功；解压后 **67,784 字节**（> 64 KiB 管道缓冲） |
| 恢复 `restore.sh` | ✗ **XFAIL（V9-13）** | 同一 SIGPIPE 根因，拒绝恢复正常备份 |
| 备份与恢复（修复版复跑） | ✓ | backup 11,243 字节 / gzip+SHA256 OK / 损坏备份被拒 / restore 退出 0 / 探针主题仍在 |
| Docker 重启后数据保留 | ✓ | 首页 200 / 探针主题 1 条 / 管理员 1 个 |
| **合计** | **0 FAIL** | 共 16 项，WARN 2 项，XFAIL 2 项 |

> **关于 XFAIL 的纪律**：XFAIL 不是「假装通过」的抽屉。它只允许用于
> **确实存在于已发布资产、且已发布资产不可覆盖**的缺陷，必须带缺陷编号，
> 并且必须**配套一条「master 修复有效性」的 PASS**。若修复版也失败，判真 FAIL。
> 本轮两项 XFAIL 均满足上述全部条件。

---

## 四、本轮新发现并处置的 6 个缺陷（V9-08 ~ V9-13）

| ID | 级别 | 一句话 | 是否影响已发布资产 |
|---|---|---|---|
| **V9-08** | 一般（直接命中验收标准） | Release Notes 的安装路径与包结构不符（缺 `-d`），照抄命令必然 `No such file or directory` | ❌ 发布前已修（Tag 含修复） |
| **V9-09** | 一般 | 包内 7 个 `deploy/*.sh` 在 Git 里是 `100644`，ZIP 原样继承 ⇒ Linux/macOS 解压后无执行位，`./install.sh` 直接 Permission denied | ✅ **是**（继承自 v0.0.1） |
| **V9-10** | 一般（验收工具，非产品） | 「缺 docker」负向测试只摘一个 PATH 目录 ⇒ 测试没生效却真装了一遍并污染数据卷，把干净安装伪装成产品缺陷；且工具从 Tag 检出导致修复永不生效 | ❌ 验收工具缺陷 |
| **V9-11** | 一般（公开物表述） | Release Notes 写「60 项指纹」，可复现口径是 **42 项业务指纹 / 指纹文件 49 行** | ⚠️ 文字，已在登记表与报告披露 |
| **V9-12** | 一般（验收脚本与产品设计冲突） | 硬断言「管理员登录 200」，而生产模式**强制验证码**⇒ 健康安装永远红 | ❌ 验收工具缺陷 |
| **V9-13** | **严重（数据保护 / 灾难恢复）** | `backup.sh` 把正常备份判为「内容为空」**并删除**；`restore.sh` **拒绝恢复**正常备份。根因：`gzip -cd … \| head -c 4096 \| grep -q .` 在 `set -o pipefail` 下被 SIGPIPE(141) 判为失败 | ✅ **是**（继承自 v0.0.8） |

### V9-13 为什么值得单独说明

这条缺陷的**故障方向与用户预期完全相反**：

- 备份越重要（数据越多）→ pg_dump 输出越大 → 越必然超过 64 KiB 管道缓冲 → **越必然失败**；
- 而且失败发生在 `rm -f` **之后**吗？不是 —— 是**之前**：脚本先打印「[成功] 数据库备份完成」，
  再打印「[成功] 校验文件已生成」，然后才报「备份内容为空」**并把这份好备份删掉**。
  用户看到的是「备份失败，请重试」，实际上他刚才有过一份可用的备份。

**为什么从 v0.0.8 活到发布**：本仓的运维验证脚本 `verify-ops-resilience.sh` 只用
「**空**备份必须被拒」做负向断言。空备份在旧写法下确实返回非零 —— 但返回非零的真实原因是
`gzip` 被信号杀死，不是「内容为空」。**用错误的判据「测对」了答案**，于是护栏给了假合格证。
本轮已补**正向对照**（>64 KiB 的备份必须被判为非空），这才是能抓到它的断言。

**本次发布为何不能修好它**：v0.0.9 的资产在缺陷被发现之前就已发布，而本轮规约明确禁止
删除/覆盖已有 Release、禁止移动 Tag。因此处置为：
① master 修复并补回归（`tests/static/v009-pipefail-sigpipe-guards.spec.ts`，含负向对照）；
② 发布后验收**如实记录缺陷存在**（XFAIL），并**在同一实例上证明修复有效**；
③ 在本报告与 `BUG_REGISTER.md` 显著披露，用户可自行套用 master 的 `deploy/backup.sh`、`deploy/restore.sh` 覆盖包内同名文件。

---

## 五、R-01 风险说明（DEFERRED，未修复）

- 受影响对象 **81 个**（`docs/evidence/`：assets 2 / html 46 / screenshots 20 / visual 13）。
- **已发布的 4 个 Release ZIP 与 4 个 GHCR 镜像均不含这些素材** ⇒ 用户实际获得的内容面是干净的。
- 隔离副本清理演练已证明：清理后业务代码 blob **逐字节一致**、仍可编译 ⇒ 清理不会损坏项目。
- **但改写历史无法消除已被下载/缓存的内容**，且本轮未获历史改写授权 ⇒ **R-01 维持 DEFERRED**。
- 本次发布的授权边界是：**在完整披露 R-01 的前提下，对 v0.0.9 发布门禁作一次性风险接受**。
  这**不是**把 R-01 标为 FIXED，**也不是**历史清理授权。

报告：`docs/R01_COMPLIANCE_REVIEW_v0.0.9.md`。

---

## 六、全部 PR 与关键 CI Run

### PR

| PR | 内容 | 状态 |
|---|---|---|
| [#31](https://github.com/alicia1030su/v2ex-clone/pull/31) | v0.0.9 发布就绪主体（门禁修复、可观测性修复、候选链路） | MERGED |
| [#32](https://github.com/alicia1030su/v2ex-clone/pull/32) | 发布门禁加固（单一事实来源、双硬闸门、幂等转公开、并发组、三方 digest） | MERGED（rebase 后 tree SHA 与 PR head 一致：`93b38604…`） |

### Run

| 用途 | Run |
|---|---|
| **正式发布流水线**（11/11） | https://github.com/alicia1030su/v2ex-clone/actions/runs/42416775836 |
| **发布后独立验收**（16 项 0 FAIL） | https://github.com/alicia1030su/v2ex-clone/actions/runs/42419896478 |
| 1 小时持续运行（时长诚实性门禁） | https://github.com/alicia1030su/v2ex-clone/actions/runs/42411802997 |
| 候选安装链路验证 | https://github.com/alicia1030su/v2ex-clone/actions/runs/42360418959 |

---

## 七、剩余问题（如实披露）

| # | 问题 | 原因 / 影响 | 处置 |
|---|---|---|---|
| 1 | **24 小时长跑未完成** | GitHub 托管 runner 单 job 上限 6 小时；需长期授权环境才能真跑 24h。本版完成 **1h01m13s** 真实长跑 | **明确列为未完成**，不修改历史测试数据、不标注 PASSED。`soak-test.yml` 的时长诚实性门禁会拒绝任何「短跑冒充长跑」 |
| 2 | **已发布包 V9-09**：脚本无可执行位 | 继承自 v0.0.1；ZIP 外部属性原样保留 Git 的 `100644` | master 已 `git update-index --chmod=+x` 并在打包流水线加断言；**已发布资产不可覆盖** ⇒ 用户需 `chmod +x deploy/*.sh`（Release Notes 未写此步，属已知不便） |
| 3 | **已发布包 V9-13**：备份/恢复误判 | 见 §四 | master 已修 + 回归 + 正向对照；用户可覆盖包内两个脚本；验收流水线以 XFAIL 记录并证明修复有效 |
| 4 | **V9-11**：Release Notes 的「60 项指纹」与可复现口径不符 | 公开 Release 已发布，按规约不改 | 内部四份文档已改为可复现口径（42 项 / 49 行）；在本报告与登记表披露 |
| 5 | 通知**写入**路径未在发布后验收中自动化 | 触发通知需「第二个用户回复」，而第二用户只能是管理员，管理员登录受强制验证码保护 | 记 WARN；由 CI E2E `v009-four-roles-acceptance`（12/12）覆盖 |
| 6 | Windows 真实 Docker 端到端安装 | 本机 Docker 守护进程不可用（WSL2 后端被安全策略阻止，无管理员权限） | 明确标记 **UNVERIFIED**，不冒充通过；由 CI ubuntu runner 覆盖真实 Docker 路径 |
| 7 | Windows PowerShell 7 本机验证 | 本机仅 PS 5.1 | 由 CI `windows-latest` 覆盖 |

---

## 八、回滚办法

**结论先行：v0.0.9 是「新增」，未覆盖任何历史版本 ⇒ 回滚不需要动 v0.0.9 本身。**

| 场景 | 操作 |
|---|---|
| 升级后想退回 v0.0.4 | 用 v0.0.4 官方包重新 `install.sh`（数据卷保留）或 `restore.sh` 回退到升级前备份。**升级前必须先 `./backup.sh`** —— 注意 v0.0.9 包内 `backup.sh` 有 V9-13 缺陷，**请先用 master 版覆盖** |
| 只想回退镜像 | `IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.4` 后 `docker compose up -d app`；数据库向下兼容性未承诺，跨小版本回退应先备份 |
| 应用起不来 | `deploy/health-check.sh` → `docker compose logs app --tail 200` → 按 `INSTALL.md` 的失败恢复指引 |
| 彻底重来 | `docker compose down -v` 会**删除数据卷**（不可逆）。仅在确认无数据价值时执行 |

**回滚不能用「移动 Tag / 覆盖 Release」实现** —— 本轮的不可逆操作清单明确禁止，
且已发布的 SHA256 与 digest 是对外承诺，改动即破坏可复核性。

---

## 九、文档索引

| 文档 | 内容 |
|---|---|
| `docs/SESSION_HANDOFF_v0.0.9.md` | 阶段状态 / 已修缺陷 / 环境限制 / 下一步 |
| `docs/R01_COMPLIANCE_REVIEW_v0.0.9.md` | R-01 独立复核 + 隔离副本演练 |
| `BUG_REGISTER.md` | **V9-01 ~ V9-13** + 环境限制 |
| `CHANGELOG.md` | v0.0.9 段落 |
| `RELEASE_GATE.md` | 门禁口径与证据 |
| `RISK_REGISTER.md` | R-01 的 v0.0.9 复核行 |
