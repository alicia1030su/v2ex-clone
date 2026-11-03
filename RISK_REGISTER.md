# 风险登记表（RISK_REGISTER）

> 项目：V2EX Clone
> 本轮：全项目缺陷清零与安全加固（v0.0.2）
> 建表时间：2026-11-04
> 维护者：代码审计负责人（主理人）

## 评级口径

- **概率**：高（>60%）／中（20–60%）／低（<20%）
- **影响**：严重（阻断发布或造成不可逆损害）／大（显著功能或安全损失）／中（可绕过/局部降级）／小（体验问题）

---

## R-01 原站版权素材经 Git 历史持续暴露 🔴 未解决

| 维度 | 内容 |
|---|---|
| **风险** | 原站 V2EX 的 HTML/CSS/JS 完整副本、像素级参考截图、差异热力图经 Git 历史对**所有匿名访问者**开放 |
| **概率** | 高（已实测发生，且已持续多日） |
| **影响** | **严重** —— 第三方受版权保护的完整源码镜像被公开分发，属法律与合规风险 |
| **证据** | `curl https://raw.githubusercontent.com/alicia1030su/v2ex-clone/75c9508.../docs/evidence/assets/combo.js` → **HTTP 200**（匿名、无凭据） |
| **可达性量化** | `master` A=44/B=40/C=10；`fix/p0-review-hardening` A=44/B=40/C=10；**`v0.0.1` tag A=45/B=40/C=10**；`refs/pull/1/head` A=44/B=40/C=10 |
| **根因** | 根提交 `75c9508` 一次性引入了 48 个原站 HTML + `combo.css`(147,710B) + `combo.js`(840,606B) + 40 张 ref 截图 + 10 张 diff 热力图，且该提交是**所有引用的共同祖先** |
| **缓解（已实施）** | ① 当前 HEAD 文件树**已无任何原站素材**（A/B/C 全部为 0）；② README / DEPLOYMENT / RELEASE_CHECKLIST 如实披露「Git 历史中仍可取回」；③ 内部处置文档已移出公开仓库 |
| **未缓解（需主人单独授权）** | 彻底消除需以下之一：<br>① 改写全部 refs 的历史（`git filter-repo` + 强推）—— 属明令禁止的「改写远端历史」<br>② 移动或删除 `v0.0.1` tag —— 属明令禁止的「移动已发布的 Tag」<br>③ 删除仓库重建 —— 影响面最大，同样需要授权 |
| **关键事实** | ⚠️ **v0.0.1 tag 的存在使 A 类对象可达数从 44 增至 45**（tag 对象本身指向的 commit 树）。这意味着**即使改写 master 与开发分支，v0.0.1 tag 仍会让原站素材可达** —— 这是"历史清理演练早于 v0.0.1 Tag 创建"这一时间差带来的**新约束**，必须重新评估清理范围 |
| **不成立的辩解** | ❌「0 Star / 0 Fork / 0 下载就代表没人获取过」—— 资产下载数已变为 **zip 3 次 / SHA256SUMS 4 次**，说明确有人下载；且匿名 raw 访问不产生任何计数 |
| **建议动作** | 提请主人单独授权以下之一：<br>**方案 A（推荐）**：授权「改写全部 refs 历史 + 重建 v0.0.1 tag」—— 因 v0.0.1 发布仅数小时、资产下载 3 次，重建的破坏可控<br>**方案 B**：授权「仅删除 v0.0.1 tag（不动历史）」—— 不解决 75c9508 可达性，仅是权宜<br>**方案 C**：接受风险，在 README 显著位置声明并改用非 V2EX 命名的项目标识<br>在获得授权前，**本轮不执行任何相关操作** |
| **状态** | **DEFERRED —— 等待主人单独授权** |

---

## R-02 GHCR 包可见性依赖自动继承 🟡 已核验

| 维度 | 内容 |
|---|---|
| **风险** | GHCR 包首次发布默认 private，匿名用户无法拉取镜像 → 安装包里的 compose 拉不到镜像 |
| **概率** | 中（曾担心） |
| **影响** | 大（安装完全不可用） |
| **实测结论** | ✅ **不成立**。用匿名 token 请求 `ghcr.io/v2/alicia1030su/v2ex-clone/manifests/v0.0.1` → **HTTP 200**，且返回 OCI index 含 `linux/amd64` layer（digest `sha256:34c11a72...`）。包已自动关联仓库并继承 public 可见性 |
| **残余风险** | 包的可见性依赖 GitHub 的"链接仓库即继承"规则。若将来仓库关联变更或包被单独设为 private，匿名拉取会静默失效 |
| **缓解** | 发布流水线的 `verify-release` job 内含**匿名 `docker pull` 实测**，失败即让发布失败并回退为 draft。已验证该步骤在 run 41665521879 中通过 |
| **状态** | **MITIGATED**（有自动化守护） |

---

## R-03 Actions 缓存中残留构建产物 🟡 低

| 维度 | 内容 |
|---|---|
| **风险** | Actions 缓存共 **83 条**，其中 **79 条** buildkit 缓存绑定在 `refs/heads/refs/tags/v0.0.1`（tag 触发的镜像构建层缓存）。缓存可能包含构建上下文内容 |
| **概率** | 低 |
| **影响** | 中（若缓存含原站素材则构成额外暴露面） |
| **实测结论** | ✅ 镜像最终层只拷 `.next` / `node_modules` / `drizzle` / `scripts` / `src/db` / `src/lib/password.ts` 等，**不含 `docs/`**；且根 `.dockerignore` 已排除 `docs/evidence/{html,assets,screenshots,visual}/` 全目录、`*.tar.gz`、`*.zip`、`*.sql`、`_backups`、`.git`、`.env*` |
| **残余风险** | buildkit 的中间层（builder 阶段的 `COPY . .`）在缓存中可能短暂包含完整工作区。本地工作区的 `docs/evidence/html/` 有 47 个文件（被 .gitignore 排除，但仍会被 `COPY . .` 送入构建上下文——除非 .dockerignore 排除，已排除） |
| **缓解** | ① 根 `.dockerignore` 完整覆盖；② 可在发布后清理 Actions 缓存（`gh cache delete`）—— **需授权后执行** |
| **状态** | **MONITORED** |

---

## R-04 生产镜像包含 devDependencies（含已知漏洞的 esbuild）🟠 待修

| 维度 | 内容 |
|---|---|
| **风险** | Dockerfile 的 deps 阶段执行 `npm ci`（**未加 `--omit=dev`**），runner 阶段整包 `COPY node_modules` → **esbuild 及 @esbuild-kit/* 进入生产镜像**。esbuild 存在 GHSA-67mh-4wv8-2f99（dev server 可被任意网站读取响应，CVSS 6.5 moderate） |
| **概率** | 低（生产用 `next start`，不启动 esbuild dev server） |
| **影响** | 中（不必要的暴露面 + 镜像体积 + 依赖扫描噪音） |
| **实测证据** | ① `npm ls esbuild --omit=dev` → **`(empty)`** —— esbuild **不在生产依赖树**，仅经 devDependencies 的 `drizzle-kit` 引入<br>② `ls node_modules/esbuild/bin/` → 存在 `esbuild` 二进制<br>③ Dockerfile 第 16 行 `npm ci --no-audit --no-fund`（无 `--omit=dev`）<br>④ Dockerfile 第 38 行整包拷贝 node_modules |
| **关键区分** | ⚠️ **迁移需要 drizzle-kit**（`scripts/docker-entrypoint.sh` 阶段 1 执行 `drizzle-kit migrate`），因此**不能简单用 `--omit=dev`** —— 否则容器启动时迁移会失败 |
| **正确修法** | 把 `drizzle-kit` 及其必要传递依赖**提升为生产依赖**，其余 devDeps 在生产镜像中排除。需要：runner 阶段 `npm ci --omit=dev` + 单独安装 drizzle-kit，或把迁移改为在 builder 阶段预编译成 SQL |
| **状态** | **OPEN —— 已派给 devops-engineer 出方案** |

---

## R-05 npm audit 4 个 moderate 未修复 🟠 待定

| 维度 | 内容 |
|---|---|
| **风险** | `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild` 共 4 个 moderate |
| **概率** | 低（开发期工具链，非运行时） |
| **影响** | 中 |
| **实测证据** | `npm ls esbuild --omit=dev` → `(empty)`；`drizzle-kit` 在 devDependencies；生产运行时 `next start` 不加载 esbuild |
| **处置要求** | 依用户指令：**不允许仅靠降低扫描等级隐藏问题**。必须给出逐项可复核分析（包名/编号/受影响版本/攻击条件/调用路径/生产可达性/修复版本），若短期无安全修复则提供**例外到期日期** |
| **状态** | **OPEN —— 已派给 devops-engineer** |

---

## R-06 Windows 安装脚本已发布版本不可用 🟠 已知悉

| 维度 | 内容 |
|---|---|
| **风险** | v0.0.1 安装包内的 `install.ps1` 无 UTF-8 BOM → Windows PowerShell 5.1 执行时 12 处解析错误 → **Windows 用户 100% 安装失败**（Linux 侧不受影响） |
| **概率** | 已发生（100%） |
| **影响** | 大（半数目标用户无法安装） |
| **实测证据** | 下载 v0.0.1 安装包 → `head -c 3 deploy/install.ps1` → `23202d`（**无 BOM**） |
| **缓解** | ① 已在 master 修复（`1ecfc4a`）并实测 PowerShell 5.1 完整流程通过；② 依用户指令，**在 v0.0.1 Release Notes 顶部补充 Windows 缺陷提醒**（仅改文字，不替换资产）；③ v0.0.2 提供修复后的安装包 |
| **残余风险** | 用户若已下载 v0.0.1 仍会遇到问题 —— 故必须在 Release Notes 显式提醒 |
| **状态** | **MITIGATED（v0.0.1 提醒 + v0.0.2 修复）** |

---

## R-07 凭据文件在 Windows 上的访问控制 🟠 已修

| 维度 | 内容 |
|---|---|
| **风险** | NTFS 不支持 POSIX 权限位，`chmod 600` 是空操作 → 含明文口令的 `.env` / `INSTALL_CREDENTIALS.txt` 实测权限仍为 `-rw-r--r--` |
| **概率** | 已发生（100%） |
| **影响** | 中（多用户机器上凭据可被同机其他用户读取） |
| **缓解** | 已修（`ce6122c` / `1ecfc4a`）：install.sh 用 `cygpath` + `icacls /inheritance:r` + `/grant:r`；install.ps1 新增 `Set-FileOwnerOnly`。实测 ACL 仅剩 SYSTEM / Administrators / 当前用户 |
| **残余风险** | Windows 上 `icacls` 输出路径格式为 `C://Users//`（双斜杠）—— `cygpath -w` 在 Git Bash 下的格式问题，功能正常但输出不规范（P2-02） |
| **状态** | **MITIGATED** |

---

## R-08 限流依赖可信代理头 🟡 待核查

| 维度 | 内容 |
|---|---|
| **风险** | 若应用直接取 `x-forwarded-for` 作为限流 IP，客户端可任意伪造该头绕过注册/登录限流 |
| **概率** | 待实测 |
| **影响** | 大（限流失效 → 批量注册/暴力破解） |
| **状态** | **OPEN —— 已派给 backend-engineer 实测** |

---

## R-09 CSRF 首次访问的严格性 🟡 待核查

| 维度 | 内容 |
|---|---|
| **风险** | `verifyCsrf()` 在无 CSRF cookie 时直接判失败（403）。这意味着「首次访问无 cookie 的写请求」被拒 —— 属**设计从严**还是**缺陷**，需确认是否影响正常用户流程 |
| **概率** | 待实测 |
| **影响** | 中 |
| **状态** | **OPEN —— 已派给 backend-engineer 实测** |

---

## R-10 无 P0/P1 修复之外的"降级凑绿"风险 🟢 已控

| 维度 | 内容 |
|---|---|
| **风险** | 为让 CI 变绿而降低安全阈值、关闭安全功能、删除或跳过测试 |
| **概率** | 低（已逐项核验） |
| **影响** | 严重（违背发布初衷） |
| **缓解证据** | ① postcss high 漏洞用 `overrides` **真修复**，非降级（high 1→0）<br>② 漏洞门禁设为 `HIGH_BASELINE = 0` —— **任何**新的 high 立即阻断，而非放宽<br>③ 所有测试数量只增不减（103 单元 / 67 E2E 为基线）<br>④ 流水线无 `continue-on-error`<br>⑤ 发布前 `preflight` 校验 tag 指向 == 构建 commit，防止绕过 |
| **状态** | **CONTROLLED** |

---

## R-11 v0.0.1 已发布资产的不可变性约束 🟢 已控

| 维度 | 内容 |
|---|---|
| **风险** | 依用户指令「v0.0.1 保持 Tag、镜像和安装包不变，禁止 clobber 既有资产」—— 不得用替换资产的方式修复 Windows 缺陷 |
| **概率** | — |
| **影响** | — |
| **缓解** | 采用「仅在 Release Notes 顶部加提醒 + 发布全新 v0.0.2」路径。**不移动 v0.0.1 tag、不替换资产** |
| **注意** | 这与 R-01 的彻底清理需求**直接冲突**：不移动 v0.0.1 tag ⇒ v0.0.1 持续使原站素材可达。两项约束只能满足其一，需主人裁决 |
| **状态** | **CONFLICT —— 待主人裁决** |
