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
| **v0.0.3 复核（2026-11-04）** | 本轮**重新匿名实测**（无凭据、无代理）：<br>• `75c9508/docs/evidence/assets/combo.js` → **HTTP 200**（仍可达）<br>• `75c9508/docs/evidence/assets/combo.css` → **HTTP 200**<br>• `75c9508/docs/evidence/html/home.html` → **HTTP 200**<br>• `75c9508/docs/evidence/screenshots/ref-home.png` → **HTTP 200**<br>• `master` / `v0.0.1` / `v0.0.2` 的上述路径 → 全部 **404**（当前树与两个 tag 的树已无这些路径）<br>• `75c9508` 提交中受控证据文件 **48 个**，仍全部可取回<br>**结论：风险未消除，状态维持 DEFERRED。** 本轮**未执行**任何历史改写、tag 移动或仓库删除操作 |
| **v0.0.4 隔离演练（2026-11-04）** | **已完成清理方案的可行性验证，未触碰远端**：<br>• 只读调查：`75c9508` 含 **48 个**原站文件（combo.css/combo.js + 46 个完整 HTML 快照）<br>• 全部 7 个远端引用（master + v0.0.1/v0.0.2/v0.0.3 + 3 个分支）**都包含** `75c9508`<br>• 在**本地隔离副本**（`_backups/history-drill/`）执行 `git filter-branch --index-filter 'git rm -r --cached --ignore-unmatch docs/evidence/assets docs/evidence/html'`<br>• 结果：引用原站素材的提交 **2 → 0**；全引用对象 1118 → 1083<br>• 3 个 Tag 的 SHA 全部变化（v0.0.1 `94cc132`→`789d407`、v0.0.2 `4488e7f`→`40533d9`、v0.0.3 `9af3b89`→`4dbb1ac`）<br>• **清理后副本与原仓库 master 的文件清单完全一致（差异 0 行，298 个文件）**<br>• 清理后副本 `npx tsc --noEmit` **零错误** → 清理不破坏功能<br>• 报告：`docs/HISTORY_CLEANUP_DRILL_v0.0.4.md`<br>**未执行**：远端历史改写、force push、删除任何 Tag、修改任何 Release、变更仓库可见性<br>**结论**：清理方案**技术可行且不损坏项目**，但属于**不可逆的远端操作**，仍需主人单独授权 |
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
| **修复提交** | `19750b9` + `0b93eca` |
| **修复内容** | ① `Dockerfile` runner 层改用 `npm ci --omit=dev`，不再整包 COPY node_modules<br>② `drizzle-kit` 与 `tsx` 上移到 `dependencies`（entrypoint 迁移与 seed 的真实运行时依赖）<br>③ 移除 5 个零引用的生产依赖（jose / dompurify / bcryptjs / nanoid / zod） |
| **修复后实测** | `npm ci --omit=dev` → **73 包 / 429MB**（原 530MB）；`node_modules/drizzle-kit/bin.cjs`、`node_modules/tsx/dist/cli.mjs`、`node_modules/next/dist/bin/next` **三个 entrypoint 必需路径全部存在**；`npm audit --omit=dev` → **0 漏洞** |
| **残余** | `@esbuild`（12MB）与 `@esbuild-kit`（11MB）仍在生产依赖 —— 它们是 tsx / drizzle-kit 的运行时必需（本地 TS 转译），**不监听任何端口**，GHSA-67mh-4wv8-2f99 的攻击前提（dev server 监听）不成立；且 esbuild 已升级到 0.25.12（已修复版本） |
| **状态** | **MITIGATED** |

---

## R-05 npm audit 4 个 moderate 未修复 🟠 待定

| 维度 | 内容 |
|---|---|
| **风险** | `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild` 共 4 个 moderate |
| **概率** | 低（开发期工具链，非运行时） |
| **影响** | 中 |
| **实测证据** | `npm ls esbuild --omit=dev` → `(empty)`；`drizzle-kit` 在 devDependencies；生产运行时 `next start` 不加载 esbuild |
| **处置要求** | 依用户指令：**不允许仅靠降低扫描等级隐藏问题**。必须给出逐项可复核分析（包名/编号/受影响版本/攻击条件/调用路径/生产可达性/修复版本），若短期无安全修复则提供**例外到期日期** |
| **修复提交** | `01fee84`（esbuild overrides）+ `0b93eca`（移除 5 个未使用依赖） |
| **修复后实测** | `npm audit --audit-level=moderate` → **found 0 vulnerabilities**（critical/high/moderate/low 全为 0）；`npm audit --omit=dev` → **0 漏洞**；`npx drizzle-kit migrate` 在全新库执行成功（迁移能力未受影响）；esbuild 实际解析为 **0.25.12**（> 0.24.2 即修复） |
| **扫描等级是否被降低** | ❌ **否** —— 发布流水线的门禁规则未放宽（critical > 0 或 high > 0 即中止发布），且 `HIGH_BASELINE` 同步设为 **0** |
| **状态** | **CLOSED —— 真修复** |

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
| **实测结论** | ✅ **确认可绕过**。修复前用不同 `x-forwarded-for` 连发 25 次注册，**全部 201 通过**，限流完全失效 |
| **修复提交** | `d1a9882` |
| **修复内容** | 新增 `src/lib/client-ip.ts` 信任模型 + `src/lib/client-ip-constants.ts`；middleware **先剥离**客户端伪造的 `x-v2-client-ip` 再写入；四个调用点统一改用 `resolveClientIp()` |
| **关键约束（实测）** | `Next.js 15` 的 `base-server.js` 用 `req.headers['x-forwarded-for'] ??= socket.remoteAddress` —— `??=` 意味着客户端传了该头就不会被真实地址覆盖，且早于 middleware 执行；Next 15 也**没有** `experimental.nodeMiddleware`（实测为 undefined），middleware 跑在 Edge Runtime 拿不到 socket 地址 ⇒ middleware **无法区分**真实与伪造值 |
| **修复后实测** | 同一脚本、同一环境：第 **21** 次请求返回 **429** ✓（伪造 IP 无法再绕过） |
| **取舍（必须让使用者知晓）** | 默认 `TRUST_PROXY_HEADERS=0` 时**完全忽略**代理头 ⇒ IP 维度限流退化为全局单桶（所有客户端共用一个桶）；**账号维度限流仍有效**，针对同一账号的暴力破解仍被拦截。要拿到真实来源 IP，必须部署在反向代理之后并显式设 `TRUST_PROXY_HEADERS=1`；另建议把应用端口绑到 `127.0.0.1` 从根本上消除直连伪造的可能 |
| **回归测试** | `tests/client-ip.spec.ts`（8 条）+ `tests/middleware-client-ip.spec.ts` |
| **状态** | **MITIGATED** |

---

## R-09 CSRF 首次访问的严格性 🟡 待核查

| 维度 | 内容 |
|---|---|
| **风险** | `verifyCsrf()` 在无 CSRF cookie 时直接判失败（403）。这意味着「首次访问无 cookie 的写请求」被拒 —— 属**设计从严**还是**缺陷**，需确认是否影响正常用户流程 |
| **概率** | 待实测 |
| **影响** | 中 |
| **实测结论** | ✅ **确认可绕过**。修复前用不同 `x-forwarded-for` 连发 25 次注册，**全部 201 通过**，限流完全失效 |
| **修复提交** | `d1a9882` |
| **修复内容** | 新增 `src/lib/client-ip.ts` 信任模型 + `src/lib/client-ip-constants.ts`；middleware **先剥离**客户端伪造的 `x-v2-client-ip` 再写入；四个调用点统一改用 `resolveClientIp()` |
| **关键约束（实测）** | `Next.js 15` 的 `base-server.js` 用 `req.headers['x-forwarded-for'] ??= socket.remoteAddress` —— `??=` 意味着客户端传了该头就不会被真实地址覆盖，且早于 middleware 执行；Next 15 也**没有** `experimental.nodeMiddleware`（实测为 undefined），middleware 跑在 Edge Runtime 拿不到 socket 地址 ⇒ middleware **无法区分**真实与伪造值 |
| **修复后实测** | 同一脚本、同一环境：第 **21** 次请求返回 **429** ✓（伪造 IP 无法再绕过） |
| **取舍（必须让使用者知晓）** | 默认 `TRUST_PROXY_HEADERS=0` 时**完全忽略**代理头 ⇒ IP 维度限流退化为全局单桶（所有客户端共用一个桶）；**账号维度限流仍有效**，针对同一账号的暴力破解仍被拦截。要拿到真实来源 IP，必须部署在反向代理之后并显式设 `TRUST_PROXY_HEADERS=1`；另建议把应用端口绑到 `127.0.0.1` 从根本上消除直连伪造的可能 |
| **回归测试** | `tests/client-ip.spec.ts`（8 条）+ `tests/middleware-client-ip.spec.ts` |
| **状态** | **MITIGATED** |

---

## R-12 未使用依赖扩大供应链攻击面 🟡 已修

| 维度 | 内容 |
|---|---|
| **风险** | 5 个生产依赖在全仓库**零引用**：jose / dompurify / bcryptjs / nanoid / zod。未使用的依赖每一条都是潜在的投毒路径，且让 `npm audit` 的结论失真（把与运行时无关的漏洞算进来） |
| **概率** | 中（供应链攻击的现实概率） |
| **影响** | 中 |
| **实测证据** | 在 `src/` `e2e/` `tests/` `scripts/` 中搜索（含动态 import 形式）：5 个依赖**各 0 处引用**。会话实际用 `randomBytes(32)` + 服务端 session 表；XSS 清洗实际用 `sanitize-html`；口令哈希实际用 `node:crypto` 的 scrypt |
| **修复** | `0b93eca` —— 移除这 5 个依赖。**保留 `tsx` 与 `drizzle-kit`**（entrypoint 迁移与 seed 的真实运行时依赖，移除会导致容器起不来） |
| **验证** | 移除后 tsc 0 错误；vitest **117/117** 全绿 |
| **状态** | **MITIGATED** |

---

## R-13 安装验证工作流自身的检测逻辑误报 🟡 已修

| 维度 | 内容 |
|---|---|
| **风险** | `install-verify.yml` 的检测逻辑有 6 处误报（down -v 检测把注释与提示文本算进去；缺 Docker 检测大小写敏感；`Write-Host` 输出捕获不到；幂等检查未规范化换行；PATHEXT 导致假 docker shim 失效；shim 未处理 `docker inspect`）。误报会让**验证结论不可信** —— 比没有验证更危险 |
| **概率** | 已发生（6 次 CI 运行中逐步暴露） |
| **影响** | 中（若未发现，可能误判「产品有缺陷」或误判「验证通过」） |
| **修复** | `f640a05` / `63f7929` / `613207a` / `cd756bd` / `78a2573` / `c654d2d` / `d6bd278` —— 逐个用**本地实测 + 样本双向验证**（正例必须命中、反例必须不误判）后才写入 |
| **附带发现** | Windows 侧 run 块必须**纯 ASCII** —— GitHub 会把 run 写成 UTF-8 无 BOM 的临时 .ps1，Windows 5.1 按 ANSI 读取会解析失败。这与 `install.ps1` 缺 BOM 是**同一类缺陷** |
| **最终结果** | install-verify run **41687529178** —— Linux + 真实 Docker 与 Windows 两个 job **全部 success** |
| **状态** | **MITIGATED** |

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

## R-14 v0.0.3 新增功能的残余风险 🟡 已声明

| 项 | 风险 | 缓解 | 状态 |
|---|---|---|---|
| 邮件真实投递未验证 | SMTP 客户端已实现，但**未在真实 SMTP 服务器上验证过送达** | 未配置时 API 如实返回「未送达」；测试环境只写本地 outbox | 🟡 已声明 |
| 头像未自动裁剪 | 未安装 `sharp`，当前保存原图 | magic number 校验与大小上限仍生效；`processAvatar` 已预留 sharp 分支 | 🟡 已声明 |
| 积分规则为独立实现 | 额度数值**无法从公开信息确证原站真实值** | 全部做成可配置环境变量；代码与文档均标注「独立替代实现」 | 🟡 已声明 |
| 窄屏响应式为独立实现 | 原站桌面版 `min-width:600px`，原站移动版是**独立站点**（无证据可比对） | 已在 `docs/VISUAL_DIFF_REPORT.md` 明确标注 | 🟡 已声明 |
| 负载测试未执行 | 未做吞吐量压测 | 并发正确性已由并发单元测试与并发 HTTP 验证覆盖（30 并发扣费、12 并发回复） | 🟡 已声明 |

## R-15 v0.0.3 的并发与一致性风险 🟢 已闭环

| 项 | 验证方式 | 结果 |
|---|---|---|
| 并发扣费产生负余额 | `SELECT ... FOR UPDATE` 行锁 + 幂等键 | ✅ 30 并发扣 10 分恰好成功 10 次，余额为 0 |
| 重复请求重复发放积分 | `credit_ledger.idempotency_key` 唯一索引 | ✅ 10 并发只 1 条流水 |
| 并发回复楼层号重复 | `floor_counters` 原子 UPSERT + 唯一索引兜底 | ✅ 12 并发楼层号全不同 |
| 重复感谢重复计数 | `thanks` 唯一索引 + 原子递增 | ✅ 8 并发只计 1 次 |
| 重置令牌重放 | `UPDATE ... WHERE used_at IS NULL` 原子消费 | ✅ 8 并发只 1 个成功 |
| 账本被篡改 | 只 INSERT + balanceBefore/After 快照 | ✅ 自洽性校验通过 |

