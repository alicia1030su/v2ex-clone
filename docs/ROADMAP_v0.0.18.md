# v0.0.18 研发路线图：工程治理 + 产品体验升级

> 分支：`feat/v0.0.18-governance`
> 基线：master `73b83061b3e36c81963fb8f0edee20673f019099`
> 日期：2026-11-20
> **本文件是研发计划，不是发布授权。** v0.0.18 不得继承 v0.0.17 的发布授权。

## 一、只读审计结论

### 1.1 仓库与产物（真实值）

| 项 | 审计值 |
|---|---|
| 本地 / origin/master | `73b83061b3e36c81963fb8f0edee20673f019099`，一致；工作区 clean |
| `v0.0.17` Tag | annotated；tag 对象 `0c092e758ef37022e5bd38b12ce0bf23e287ddac`；指向 `10644d72161d722904829e53b31ff4c5cbe013e6` |
| Release | `v0.0.17 — 稳定版`；`draft=false`、`prerelease=false`；Latest = `v0.0.17` |
| GHCR | `v0.0.17`；OCI index digest `sha256:1ec56dd5a6059841cf3206afca92c1dbd28fd8e8db763eb63c1c15260db3b995`；linux/amd64 |
| ZIP | `v2ex-clone-v0.0.17-deploy.zip`；145,353 B；SHA256 `e6068b9b…f5c60344918` |
| 未合并 PR | **#67**（内容已被 #68/#69/#70 覆盖，处于遗留状态） |
| R-01 | **DEFERRED / A3**，本轮不改变 |
| 24h 单实例连续运行 | **not-completed**，本轮不伪造完成 |

### 1.2 v0.0.17 八次发布失败的共同根因

八次失败不是八个独立 bug，而是**一个事实被复制到八个地方**：

> 「0.0.x 一律 Pre-release」被当成常量，写进 preflight、publish-release、
> Notes、verify-release、post-release-verify、预演、一致性检查等位置。

改成「按版本白名单」时，产出侧先改对了，判据侧逐个在真实运行中才暴露。
其中还混入了两个次生问题：

- step 不显式传入 `VERSION` / `PRERELEASE`，`set -u` 直接失败；
- 在 `run: |` 中堆叠多行 shell 与嵌套 heredoc，触发 GitHub 解析器
  `Exceeded max expression length 21000`。

### 1.3 三次 `git add -A` 误提交

`.m` / `.msg2` / `.cm` 都是**提交信息草稿**，在 `git add -A` 执行时恰好存在于
工作区根目录，于是被一起暂存、提交。`.gitignore` 已记录这些名字，但它只能防止
`git add .` 自动带上已忽略文件，**不能防止显式 `git add -f`**，也不能替代流程纪律。

---

## 二、P0-1：统一发布渠道策略

| 项 | 内容 |
|---|---|
| **现状** | `docs/STABLE_RELEASES.json` 只表达“稳定版白名单”；release.yml、预演、发布后验收各自内嵌 Node/Python 判据；`verify-release-consistency.sh` 仍要求 `isPrerelease=true`。 |
| **真实缺陷** | ① 同一渠道结论有 6 份实现；② 一致性检查与 Stable Release 冲突；③ dispatch 输入 `prerelease` 与清单可能不一致，且没有统一拒绝路径；④ 文档/Notes 文案仍写死 `0.0.x`。 |
| **根因** | 缺一个**机器可读、单一事实来源**的渠道清单与解析器；消费者直接复制业务规则。 |
| **修复方案** | 新建 `docs/RELEASE_CHANNELS.json`（`default: prerelease` + 精确版本映射），新建 `scripts/release/resolve-release-channel.mjs`；所有消费者只调用解析器。保留旧 `STABLE_RELEASES.json` 为迁移输入，由解析器校验二者一致。 |
| **修改文件** | `docs/RELEASE_CHANNELS.json`、`scripts/release/resolve-release-channel.mjs`、`.github/workflows/release.yml`、`.github/workflows/post-release-verify.yml`、`scripts/release/preflight-dryrun.mjs`、`scripts/release/verify-release-consistency.sh`、`tests/static/v018-release-channel.spec.ts`。 |
| **测试方法** | 解析器单测（默认 prerelease、v0.0.17 stable、未知版本、重复/冲突清单、错误类型、错误版本格式）；真实读取当前清单；workflow 接线静态断言；发布预演真实运行。 |
| **验收标准** | 所有渠道消费者都调用同一解析器；无“0.0.x 必须 Pre-release”的可执行断言；v0.0.17 与 v0.0.18 解析为 stable，未登记版本默认 prerelease；预演全绿；v0.0.17 既有 Release 不被修改。 |
| **风险** | 清单写错会让未来版本发错形态；用迁移校验与精确枚举降低风险；不自动发布 v0.0.18。 |

## 三、P0-2：Git 暂存与提交安全治理

| 项 | 内容 |
|---|---|
| **现状** | 开发过程中使用 `git add -A`；三次把提交信息草稿带入仓库；只有 `.gitignore` 兜底。 |
| **真实缺陷** | 无差别暂存会把草稿、临时证据、敏感文件与业务改动一起提交；提交后才发现，只能再写清理提交。 |
| **根因** | 缺“提交前暂存区审计”和“明确文件清单”流程；忽略规则被当成提交控制。 |
| **修复方案** | 新增 `scripts/git/safe-stage.mjs`（只接受显式路径、拒绝通配/目录全量、拦截草稿与敏感文件名、先 dry-run）；新增 `.githooks/pre-commit`（检查暂存区是否含禁止文件/疑似凭据）；`scripts/git/check-staged-files.mjs` 作为唯一检查实现。 |
| **修改文件** | `scripts/git/safe-stage.mjs`、`scripts/git/check-staged-files.mjs`、`.githooks/pre-commit`、`docs/DEVELOPMENT_WORKFLOW.md`、`tests/static/v018-git-staging-safety.spec.ts`。 |
| **测试方法** | 真实临时 Git 仓库：只暂存指定文件；拒绝 `.m`/`.msg2`/`.cm`；拒绝 `-A`/`.`；拒绝 `.env`、私钥、`INSTALL_CREDENTIALS.txt`；hook 在暂存草稿时非零退出。 |
| **验收标准** | 误提交草稿在提交前被拦截；无差别暂存命令被工具拒绝；正常业务文件可暂存；hook 可安装且不绕过。 |
| **风险** | hook 未安装时仍可误提交；CI 增加暂存内容/提交树检查，文档强制使用 `safe-stage`；不跳过 hook。 |

## 四、P1-1：24 小时单实例连续运行验证工具

| 项 | 内容 |
|---|---|
| **现状** | 已有 `soak-segment.yml` 分段链，每段重建实例，累计时长不能证明单实例连续。 |
| **真实缺陷** | 缺“同一 PID/实例连续 24h”的工具与证据格式；现有汇总仍把“没采到”与“0”混淆的风险留在边界。 |
| **根因** | GitHub-hosted runner 单 job 上限 6h；没有授权的持久运行环境。 |
| **修复方案** | 新增 `scripts/soak/single-instance.mjs`：固定实例 ID/PID/启动时间，周期采样 HTTP/DB/Redis/进程资源，检测实例漂移，支持中途备份/恢复探针，输出 `summary.json` + `samples.jsonl`；不足 24h 或实例漂移必须 `not-completed`。 |
| **修改文件** | `scripts/soak/single-instance.mjs`、`.github/workflows/soak-single-instance.yml`（手动，≤5.5h 单段）、`docs/SOAK_SINGLE_INSTANCE.md`、`tests/static/v018-soak-tool.spec.ts`。 |
| **测试方法** | 短时真实运行（mock HTTP + 真实本地进程采样）；实例 ID 变化、时长不足、HTTP 失败、数据漂移均不得 PASS；输出 schema 校验。 |
| **验收标准** | 工具可运行、证据可审计、24h 状态**仍为 not-completed**；明确“分段累计 ≠ 单实例连续”。 |
| **风险** | 无持久环境时无法完成 24h；本轮只交工具与使用说明，不伪造 PASS。 |

## 五、P1-2：页面 / 功能 / API / 权限 / 视觉差距审查

| 项 | 内容 |
|---|---|
| **现状** | 27 个页面路由、72 个 API 路由；`docs/FEATURE_MATRIX.md` 是权威功能矩阵；`PAGE_INVENTORY` / `API_SPEC` / 视觉证据并存。 |
| **真实缺陷** | 历史快照与当前代码存在时间差；部分“未实现”可能已实现，部分“已实现”可能只到 API 层。 |
| **根因** | 文档分散、状态口径不统一；缺路由枚举与矩阵的自动交叉核对。 |
| **修复方案** | 新增路由枚举脚本，输出页面/API/权限/视觉四张差距表；只依据当前源码与可复跑证据排序；不开发新功能。 |
| **修改文件** | `docs/PRODUCT_GAP_REVIEW_v0.0.18.md`、`scripts/audit/route-inventory.mjs`、`tests/static/v018-route-inventory.spec.ts`。 |
| **测试方法** | 真实枚举当前路由；与矩阵中的路由/端点逐项比对；抽样读取权限守卫与 UI 入口。 |
| **验收标准** | 不重复登记已实现功能；每项差距有代码路径与证据；给出 P0/P1/P2 排序和“不开发”理由。 |
| **风险** | 静态枚举不能证明运行行为；标记“需运行复核”，不冒充已验证。 |

## 六、执行状态（2026-11-20）

| 任务 | 状态 | 结果 |
|---|---|---|
| P0-1 统一发布渠道 | **完成** | `RELEASE_CHANNELS.json` + 统一解析器；release/preflight/post-release/consistency 全部接线；历史授权兼容 |
| P0-2 Git 暂存安全 | **完成** | `safe-stage`、统一 checker、pre-commit hook、CI 提交树门禁、开发文档；修复 Windows `fileURLToPath` 主入口静默跳过 |
| P1-1 单实例长跑工具 | **工具完成 / 24h not-completed** | `single-instance.mjs` + Node 分段启动器 + 手动 workflow + 证据 schema；真实短时运行与负向对照通过 |
| P1-2 产品差距审查 | **完成** | 27 页面 / 74 API / 93 方法；报告 `PRODUCT_GAP_REVIEW_v0.0.18.md`；权限无水平越权，发现内容可见性 P0 |
| 追加 P0 内容可见性 | **完成** | 会员回复、XNA、收藏、互动写接口与最后回复者统一过滤软删/隐藏内容；真库 8/8、全量单元 1036/1036 通过 |

### 6.1 P0-2 实施修正

路线图原方案提到“先 dry-run”。最终实现同时包含：

- `safe-stage` 显式文件路径、仓库边界、已跟踪删除、`git add --dry-run` 后再真实暂存；
- pre-commit 对暂存新增行做疑似凭据扫描；
- CI 对 HEAD 完整文件树做禁止路径兜底；
- Windows 根因：`new URL(import.meta.url).pathname` 产生 `/C:/...`，与 `process.argv[1]`
  不相等，检查主入口被静默跳过；改用 `fileURLToPath()`。

### 6.2 P1-1 实施补充

新增 `scripts/soak/run-workflow-segment.mjs`，把应用启动、就绪等待、工具调用与清理收敛到 Node，
避免 workflow 多行 shell 拼接。GitHub-hosted runner 分段上限 330 分钟，退出码 3 / `not-completed`
是预期结论，不得把分段 job 绿色或累计时长写成 24h PASS。

### 6.3 追加修复边界

P1-2 审查发现的公共内容可见性缺陷按**安全缺陷**处理，不视为新产品功能：
统一 `PUBLIC_TOPIC_CONDITION` / `PUBLIC_REPLY_CONDITION`，覆盖公开读取与用户互动写入。
其余体验缺口（通知角标、回复锚点、API 文档覆盖、视觉参考）保留在差距报告中，留待后续版本。

