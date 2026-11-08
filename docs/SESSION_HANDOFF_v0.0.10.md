# v0.0.10 会话交接（SESSION HANDOFF）

> 本文件是本轮**持续保存的现场**。若上下文中断，从这里的「下一步」继续即可。
> 最后更新：2026-11-08

## 一、分支与 HEAD

| 项 | 值 |
|---|---|
| 工作分支 | `release/v0.0.10` → 已合并为 master |
| 起点 | `master @ 2b54371`（PR #33 squash 合并后的 master） |
| 产物基线 SHA | **`23a88cf54abda28b0e677079707c71de52ce269b`** |
| 最终 master | 以 `git rev-parse HEAD` 为准（不写死） |
| 合并记录 | PR **#34**（本体）+ PR **#35**（CRLF 产物修复），均已 squash 合并 |
| 旧 Tag | `v0.0.1`~`v0.0.9` **未移动、未删除、未覆盖**（规约：不可逆操作需单独授权） |

## 二、已完成的模块

### 1. 基线核实（第一阶段）

| 项 | 实测 |
|---|---|
| master SHA | `2b54371ecdd7688931d32f9b1a2d04361b979b4f` |
| v0.0.9 Tag 指向 | `80a3b8c4e2be6c76629d9a5dd1f4734336aef43a`（annotated） |
| v0.0.9 Tag 与 master 关系 | Tag **落后 master 8 个提交** —— 视觉整改（PR #33）、V9-09（脚本权限）、V9-13（SIGPIPE）**全部不在 Tag 内** |
| v0.0.9 Release | Pre-release，资产 2 个（`v2ex-clone-v0.0.9-deploy.zip` 57118 B + `SHA256SUMS`） |
| 版本载体 | 起点时全为 `0.0.9`（7 个载体一致） |

**结论**：v0.0.9 的公开资产确实缺少 PR #33 与两个 P0 修复。已发布资产**不可覆盖**，
因此 v0.0.10 是这些修复的**唯一合法载体**。

### 2. 页面真实性复核（第二阶段）

- 新增 `tools/visual/audit-pages.mjs`：带**真实登录态**逐页审计，覆盖
  首页 / 全部节点 / 节点详情 / 主题详情 / 回复列表 / 用户主页 / 登录 / 注册 /
  通知 / 设置 / 管理后台 / 收藏 —— **12 类页面，每页 23~29 项断言**。
- 断言内容：右栏宽度 = 270、主栏与右栏不重叠、头像真实渲染（`naturalWidth > 0`）、
  徽章白字对比度、**回复操作按钮不被卡片裁切**、首页恰好一个选中 tab、
  列表行数 > 0、所有 `/api/feed` 与 `/api/nodes/*` 链接真实可达。
- 结果：**12/12 页面全部通过**（证据 `docs/evidence/visual/pages-audit.json`）。

### 3. 安装 / 备份 P0（第三阶段）

| 缺陷 | 状态 |
|---|---|
| V9-09 脚本可执行位 | 源码 7 个脚本 `100755`；新增自研打包器**强制写入 0755 外部属性**并回读断言 |
| V9-13 SIGPIPE 假失败 | `deploy/backup.sh` / `restore.sh` 已用读到 EOF 的 `awk` 统计；新增静态反模式扫描（剔除注释） |

新增 `scripts/release/verify-install-backup-behavior.sh`：
**10 PASS / 0 FAIL / 2 SKIP**（无 Docker 的断言如实跳过，不假装通过）。

关键实测（假 docker 构造 588 KB pg_dump 输出，远超 Linux 64 KiB 管道缓冲）：

- 大体积正常备份：`backup.sh` 退出码 0，备份被保留，报「解压后 864951 字节」
- 真空 dump：退出码 1，空备份被判失败
- 损坏备份：`restore.sh` 退出码 1 拒绝恢复，且**校验先于任何写库动作**
- 缺 docker 时 `install.sh` 明确失败，且**既有 `.env` 未被改动**（口令不会被换掉）

SKIP 的两项如实记录：Windows 的 `rm` 被工作区安全 shim 拦截绝对路径；
本机无 Docker ⇒ 真实 `install.sh` / `update.sh` / compose 启动交由 CI ubuntu runner。

### 4. 双基线真实升级（第四阶段）

新增 `scripts/release/verify-upgrade-v0010.sh`：迁移集**从 git tag 取出**
（v0.0.4 = 3 个迁移、v0.0.9 = 4 个），再用当前迁移集升级 —— 是真正的「从旧结构开始」，
而不是既有脚本那种「用当前迁移集建库再跑一遍」的自我循环。

| 基线 | 索引 | 迁移记录 | 业务指纹 |
|---|---|---|---|
| v0.0.4 → v0.0.10 | 76 → **78** | 3 → **4** | **46 项逐字节一致** |
| v0.0.9 → v0.0.10 | 78 → 78 | 4 → 4 | **46 项逐字节一致** |

另：迁移连跑 3 次幂等、幂等后指纹不变、备份→恢复指纹与升级后**完全一致**。
**20 项断言全过**（`PASS=20 FAIL=0`）。

过程中修掉三个「按猜的列名写会静默无效」的坑（`collections.target`、
`votes.direction`、`credit_ledger.balance_before/after`），并把探针失败从
「记录后继续」改为**硬失败** —— 否则空库也能全绿。

### 5. 发行版真实性门禁（第六阶段）

新增 `scripts/release/verify-release-consistency.sh`，核对**六件东西是否同一版本**：

1. 源码载体（package.json / deploy/VERSION / install.sh / compose / .env.example / install.ps1）
2. Tag 与构建来源提交是否同一（且必须是 annotated tag）
3. 镜像标签与 Digest
4. ZIP（文件名 / SHA256 可复算 / 包内版本 / 必需文件 15 项 / 无凭据 / 无原站素材 / shell 语法）
5. README（版本、下载链接、**无旧版本残留**）
6. Release（形态必须是 Pre-release、资产齐全）

**脚本权限读 ZIP 中央目录的 Unix mode**，不看解压后的磁盘位 ——
实测 Windows NTFS 没有 POSIX exec 位，把权限改成 0644 的 ZIP 在 Git Bash 里
仍被判「带执行位」，是典型的平台假绿。现在能点名
`deploy/backup.sh=0o100644` 并拒绝发布。

新增 `scripts/release/package-deploy-zip.mjs`：可复现 ZIP 打包器
（store 模式、固定时间戳、强制 0755 + host=Unix）。正式产物：

- `dist/v2ex-clone-v0.0.10-deploy.zip`
- SHA256 = `2f35e5f6e9905a83963d6f3bd27eda1305e0b8261d0c70fc04f3abb12713e0d2`
- 门禁结果：**21 PASS / 0 FAIL**

### 6. 四身份真实交互验收（第五阶段）

新增 `tools/visual/audit-four-roles.mjs`：**28 项**，逐条走真实浏览器。

| 身份 | 步数 | 覆盖 |
|---|---|---|
| 游客 | 5 | 浏览 / 节点切换 / 搜索 / 未登录重定向 / 未登录发帖被拒（401） |
| 普通用户 | 8 | 注册 / 发帖 / 回复 / 感谢按钮状态 / 收藏 / **编辑回复** / 通知 / 修改简介持久化 |
| 版主 | 4 | 登录 / 进后台 / 管理按钮存在 / 锁定主题 |
| 管理员 | 11 | 登录 / 5 个后台 tab / 用户列表 / 举报 / 操作日志 / 运维指标（byStatus 含真实 200/201/303/401） |

**实测 28/28 通过**（`docs/evidence/visual/roles-audit.json`）。

期间发现并修复 **1 个真实产品缺陷**：

> `ReplyItem` 的 `saveEdit()` / `remove()` 成功后只调 `onChanged?.()`，
> 而主题页**从未传这个可选回调** ⇒ PUT 返回 200、编辑框收起，
> 但正文仍是旧内容、「（已编辑 N 次）」也不出现 ⇒ 用户必须手动刷新。
> 修复：与同组件 `restore()` 一致改用 `router.refresh()`。

### 7. 本轮其它真实缺陷（走查发现）

| # | 缺陷 | 取证 |
|---|---|---|
| 1 | 页脚 `VERSION: 3.9.8.5` 硬编码（**原站版本号**）⇒ 页面版本与实际包无关，发行门禁无法核对 | 改为构建期从 package.json 注入；漏注入时显式写 `unknown` |
| 2 | 页脚「最高记录 {online + 3835}」—— 3835 是硬编码原站数据，且随在线人数虚增 | 改为 KV 累计的真实峰值（`getOnlinePeak`，Redis/PG 两套后端） |
| 3 | `#Wrapper` 顶部阴影带 118px（原站实测 30px） | 改为 30px + 三档色标，逐点偏差 ≤2 色阶 | 

## 三、测试证据（本机，2026-11-08）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 错误 |
| 单元测试 | **440 passed / 0 failed / 0 skipped（35 文件）** |
| E2E | **220 passed / 0 failed / 0 skipped（20 文件，8.1m）** |
| 静态测试（`vitest.static.config.ts`） | **40 passed**（含 SIGPIPE 行为级 5 项） |
| 页面真实性审计 | **12/12 页面通过**（23~29 项/页） |
| 四身份验收 | **28/28 通过** |
| 双基线升级 | **20/20 通过** |
| 安装/备份行为 | **10 PASS / 0 FAIL / 2 SKIP**（SKIP 如实记录原因） |
| 截图重拍 | 72 张（1280/1920/768/375），全部通过 18 项健康门禁 |
| 发行一致性 | **21/21 通过** |

## 四、未完成 / 待办

| 项 | 状态 |
|---|---|
| E2E 全量 | ✅ **220 passed / 0 failed / 0 skipped（8.1m）**；上一轮 skip 的 5xx 用例已转真实断言 |
| CI（PR #34） | ✅ **25 pass / 0 fail**（1 项 skipping = 本分支不触发的可选诊断步骤） |
| CI（PR #35） | ✅ **31 pass / 0 fail**（同上 1 项 skipping） |
| 真实 Docker 安装（Linux） | ✅ CI `Linux + 真实 Docker 安装` **pass**（ubuntu runner） |
| R-16/R-17 九项（含 Redis 中断） | ✅ CI **pass**（该项抓到并验证了 V10-13 的修复） |
| 三浏览器 E2E 矩阵 | ✅ chromium / firefox / webkit 三引擎全 **pass** |
| 候选产物 | ✅ `dist/v2ex-clone-v0.0.10-deploy.zip`，SHA256 `2d10957f…`，门禁 30/30 |
| GHCR 镜像推送 | ⛔ 未推送（需 Tag + 授权） |
| 正式 Tag / Release | ⛔ **未创建**（R-01 待裁决） |
| 匿名下载复验 | ⛔ 待 Release 后 |

## 五、风险与授权边界

**R-01（Git 历史中原站素材可达）：状态维持 DEFERRED。**

- 受影响对象 81 个（assets 2 / html 46 / screenshots 20 / visual 13）
- 已发布的 4 个 Release ZIP 与 4 个 GHCR 镜像**均不含素材** ⇒ 用户可获得面干净
- 本轮**允许**：只读审计、记录引用、隔离演练、准备清理方案
- 本轮**未授权**：远端历史改写、force push、删除/移动旧 Tag、删除/覆盖已有 Release、改仓库可见性
- **v0.0.9 的发布决定不自动等于 v0.0.10 获得风险接受** ⇒ v0.0.10 需**单独**的风险决定

**因此本轮停在发布门禁处**：所有普通工程工作、PR、CI、候选包完成；
正式 Tag / Release 需一次性的授权决策（见 `docs/RISK_DECISION_v0.0.10.md`）。

## 六、下一步（**已停在发布门禁**）

普通工程工作**全部完成**。剩余动作都需要**一次授权**：

1. ~~等 E2E 全量结果~~ ✅
2. ~~PR + CI 全绿~~ ✅（PR #34 / #35 均已合并）
3. ~~维护三份登记文档~~ ✅
4. ~~写升级实测报告~~ ✅ `docs/UPGRADE_VERIFICATION_v0.0.10.md`
5. ~~写授权请求~~ ✅ `docs/RISK_DECISION_v0.0.10.md`
6. ⛔ **待授权**：打 annotated Tag `v0.0.10` → 推镜像 → 建 Pre-release → 匿名复验

**为什么停在这里**：`RISK_DECISION_v0.0.9.md` §二第 4 条明确「仅针对 v0.0.9，
不构成后续版本先例」；任务书 §九 同样重申。R-01 仍为 DEFERRED。
**未获授权前不创建 Tag、不推镜像、不建 Release。**

## 七、本版本最终产物清单

| 产物 | 位置 / 值 |
|---|---|
| 产物基线 SHA | `23a88cf54abda28b0e677079707c71de52ce269b` |
| 安装包 | `dist/v2ex-clone-v0.0.10-deploy.zip`（143,345 B） |
| SHA256 | `2d10957fa2bffacccb443ad6a6e879184764a236557865d4025355bec5dbb2cf` |
| 产物报告 | `docs/RELEASE_ARTIFACT_v0.0.10.md` |
| 发布事实（单一事实来源） | `docs/release-facts.json` |
| 页面审计证据 | `docs/evidence/visual/pages-audit.json` |
| 四身份证据 | `docs/evidence/visual/roles-audit.json` |
| 截图索引 | `docs/evidence/screenshots/capture-multi-index.json` |
