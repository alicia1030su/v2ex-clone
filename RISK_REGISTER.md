# 风险登记表（RISK_REGISTER）

> 项目：V2EX Clone
> 本轮：全项目缺陷清零与安全加固（v0.0.4）
> 建表时间：2026-11-04
> 维护者：代码审计负责人（主理人）
>
> ⚠️ **状态口径声明（v0.0.4 收尾轮，2026-11-04）**：本表的状态标注**只反映本轮实测证据**。
> ① **已修复的问题不再显示 OPEN**；② **未解决的问题不因为「本轮没再复现」就自动标 FIXED**。
> ③ 凡本轮**未实测 / 未复核**的数据，一律标注「待实测」或「历史快照」，不填推测值。
> ④ R-21 / R-24（UI 缺口）**已由 `ed385cf` 修复**（管理员入口 / 关注 / 节点申请审批 / 通知已读全部补齐），
>    状态标为「**已修复（`ed385cf`）**」，**待主理人终验确认**。
> ⑤ **R-26（CI 单元测试红灯）已由 `8ce5ce9` 修复并经 CI 复验** —— run `41860242099` 与 `41873009808`
>    的「类型检查 / 单元测试」job 均 ✅（vitest 15 文件全过、`190 passed / 0 skipped`），`e2e` job 已真实跑过。
> ⑥ 测试数字权威基线：**单元 194 条 / 16 文件 / 194 passed / 0 failed / 0 skipped**、
>    **E2E 154 条 / 11 文件 / 154 passed / 0 failed / 0 skipped（3.9m）**。
>    ⚠️ 表内出现的 **190** 是**V4-20 修复前**的基线（修复后新增 `tests/form-name-shadowing.spec.ts` 的
>    **4 条防回归断言** ⇒ 190 条 / 15 文件 → **194 条 / 16 文件**）。
>    ⚠️ 表内出现的 **185** 有两个不同来源，**不可混用**：
>    **v0.0.3 历史总数**（master @ `37710fb4`，`185 passed (185)`）与
>    **修复前的历史观测**（run `41837212170`，HEAD `930f29e`，`185 passed | 5 skipped (190)`，⚠️ 分母仍是 190）。
> ⑦ ~~**本轮唯一红灯 = R-27 / V4-20**（节点申请 UI 提交链断裂）~~
>    —— ✅ **已由 `bddb3d0` 修复并本地实测验证**（**本轮唯一红灯已解除**）。
>    **修复前的历史快照**：CI run `41873009808` = **153 passed | 1 failed | 154 total**。
>    **修复后本地实测**：单元 **194/194（16 文件）**、E2E **154/154（11 文件，3.9m）** 全绿，
>    `/nodes/request` 的 React #418 **归零**，提交请求恢复为 `POST /api/node-requests`。
>    ****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）** —— 剩余阻断项见 `RELEASE_GATE.md`。

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
| **v0.0.4 收尾轮只读复核（2026-11-04）** | **本轮只做只读复核，未执行任何历史改写 / tag 移动 / 仓库删除**：<br>• 结论与上轮一致 —— **风险未消除，状态维持 DEFERRED**<br>• **隔离演练结论**（`docs/HISTORY_CLEANUP_DRILL_v0.0.4.md`）：在**本地隔离副本**（`_backups/history-drill/`）执行 `git filter-branch --index-filter 'git rm -r --cached --ignore-unmatch docs/evidence/assets docs/evidence/html'`，引用原站素材的提交 **2 → 0**，全引用对象 1118 → 1083，3 个 Tag 的 SHA 全部变化（v0.0.1 `94cc132`→`789d407`、v0.0.2 `4488e7f`→`40533d9`、v0.0.3 `9af3b89`→`4dbb1ac`）；**清理后副本与原仓库 master 的文件清单完全一致（差异 0 行，298 个文件）**；清理后副本 `npx tsc --noEmit` **零错误** → **清理不破坏功能**<br>• ⚠️ **注意**：演练改的是 3 个 Tag 的 SHA，而**已发布的 v0.0.1 / v0.0.2 / v0.0.3 Tag 不得移动**（明令禁止）。这意味着**即使授权改写历史，也必须先解决「已发布 Tag 的 SHA 变了」这一冲突** —— 该冲突本轮**未解决**，仍待主人裁决<br>• **未执行**：远端历史改写、force push、删除任何 Tag、修改任何 Release、变更仓库可见性 |
| **状态** | **DEFERRED —— 等待主人单独授权**（收尾轮只读复核：风险未消除；隔离演练证明方案技术可行且不损坏项目，但与「不得移动已发布 Tag」的约束存在待裁决冲突） |

---

## R-02 GHCR 包可见性依赖自动继承 🟡 已核验

| 维度 | 内容 |
|---|---|
| **风险** | GHCR 包首次发布默认 private，匿名用户无法拉取镜像 → 安装包里的 compose 拉不到镜像 |
| **概率** | 中（曾担心） |
| **影响** | 大（安装完全不可用） |
| **实测结论** | ✅ **不成立**。用匿名 token 请求 `ghcr.io/v2/alicia1030su/v2ex-clone/manifests/v0.0.1` → **HTTP 200**，且返回 OCI index 含 `linux/amd64` layer（digest `sha256:34c11a72...`）。包已自动关联仓库并继承 public 可见性 |
| **残余风险** | 包的可见性依赖 GitHub 的"链接仓库即继承"规则。若将来仓库关联变更或包被单独设为 private，匿名拉取会静默失效 |
| **v0.0.4 修正（E-10 复核后）** | v0.0.3 曾把「匿名请求 manifest 返回 401」判为 private，**这是错的**：Docker Registry V2 的公开包第 1 步同样返回 401，必须走完「401 → 换匿名 token → 带 token 重试 → **200**」三步。本轮按完整协议实测，v0.0.1 / v0.0.2 / v0.0.3 **全部 HTTP 200** ⇒ 镜像公开可拉取，`docs/SECURITY_EXCEPTIONS.md` E-10 已改写 |
| **缓解（当前实现）** | `release.yml` 的 `verify-release`：① **带凭据 `docker pull` 作为发布成败判据**（失败即 `exit 1`）；② 匿名 Bearer 三步探测**仅作提示**（`::notice::`），不作为判据 —— 包可见性是仓库级配置，不由代码控制；③ 匿名探测已改为完整 Bearer 流程，不再只看首次 401 |
| **状态** | **MITIGATED**（有自动化守护，且 2026-11-04 已按完整协议复核） |

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

## R-09 CSRF 首次访问的严格性 🟢 已复核（设计从严，不影响正常流程）

| 维度 | 内容 |
|---|---|
| **风险** | `verifyCsrf()` 在无 CSRF cookie 时直接判失败（403）。「首次访问无 cookie 的写请求」被拒 —— 属**设计从严**还是**缺陷**，需确认是否影响正常用户流程 |
| **概率** | 仅影响「不经过任何页面 GET、直接构造 POST」的客户端；真实浏览器用户不会发生 |
| **影响** | 中（若为缺陷会导致正常注册/登录失败） |
| **v0.0.4 实测结论（2026-11-04，本地 3021 隔离环境）** | ① 无任何 cookie 直接 `POST /api/auth/signup` → **403** `{"ok":false,"error":"CSRF 校验失败，请刷新页面后重试"}`；② 有 cookie 但 `x-csrf-token: deadbeef` → **403**；③ 先 `GET /` 拿到 `v2_csrf`（64 位 hex），再带正确 token POST → **201** `{"ok":true,"redirect":"/"}` |
| **机制** | `src/middleware.ts` 在**首次 GET 响应**就下发 `v2_csrf` cookie（`CSRF_MAX_AGE` 14 天，可读，供 JS 放入请求头）；`src/lib/csrf.ts` 的 `verifyCsrf()` 用 `timingSafeEqual` 比对 cookie 与请求头/表单字段。攻击者受同源策略限制读不到该 cookie ⇒ 双提交模式成立 |
| **判定** | ✅ **不是缺陷，是设计从严**。任何真实用户都会先加载页面（GET）拿到 cookie，再发起写请求；E2E **154 条 / 11 文件**（含注册/登录/发帖/回复全链路）验证了这条路径全部可用。「无 cookie 的裸 POST」被拒是正确的防护行为 |
| **取舍（须让使用者知晓）** | 非浏览器客户端（curl / 脚本 / 第三方集成）**必须**先 GET 一次拿 cookie 与 token，不能直接 POST。这是显式 CSRF 防护的必然代价，README 与 API 文档应说明 |
| **回归证据** | `e2e/` 全部写操作用例均先 `page.goto()` 取 cookie；`e2e/helpers.ts` 的 `getCsrfToken()`；本轮三场景 curl 实测输出 |
| **状态** | **VERIFIED**（v0.0.4 重新评估并实测；原登记错置内容已彻底替换） |

> ⚠️ **登记勘误**：v0.0.3 的 R-09 曾整段误贴为 R-08「`x-forwarded-for` 伪造绕过限流 / `d1a9882` / `client-ip.ts`」的内容，与 CSRF 无关，却标为 MITIGATED —— 等于该风险**实际从未被评估**。v0.0.4 验收核查（D-03）发现后已按实测重写。

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
| 长时间稳定性 /  soak 测试未做（v0.0.4 已执行 **20 秒 × 并发 10、13 场景 / 24785 请求**的吞吐量压测，见 `docs/evidence/loadtest/`） | 未做长时间稳定性（soak）与容量衰减观测 | 并发正确性已由并发单元测试、并发 HTTP 验证（30 并发扣费、12 并发回复）与压测写场景（50 并发发帖/回复 0 错误）覆盖 | 🟡 已声明 |

## R-15 v0.0.3 的并发与一致性风险 🟢 已闭环

| 项 | 验证方式 | 结果 |
|---|---|---|
| 并发扣费产生负余额 | `SELECT ... FOR UPDATE` 行锁 + 幂等键 | ✅ 30 并发扣 10 分恰好成功 10 次，余额为 0 |
| 重复请求重复发放积分 | `credit_ledger.idempotency_key` 唯一索引 | ✅ 10 并发只 1 条流水 |
| 并发回复楼层号重复 | `floor_counters` 原子 UPSERT + 唯一索引兜底 | ✅ 12 并发楼层号全不同 |
| 重复感谢重复计数 | `thanks` 唯一索引 + 原子递增 | ✅ 8 并发只计 1 次 |
| 重置令牌重放 | `UPDATE ... WHERE used_at IS NULL` 原子消费 | ✅ 8 并发只 1 个成功 |
| 账本被篡改 | 只 INSERT + balanceBefore/After 快照 | ✅ 自洽性校验通过 |

---

## R-16 ~ R-27：v0.0.4 新增风险（主理人汇编，2026-11-04；收尾轮已更新状态）

> 来源：第六/八阶段部署验证（devops-engineer）、第二轮验收核查与四身份 UI 实测（qa-engineer）、
> 真实压测证据核查、收尾轮版本库卫生核查与 CI 实跑。**凡「未验证」项均如实标注，不以静态核查冒充实跑。**
> **收尾轮（2026-11-04）状态同步**：R-18 已修并验证；R-22 已定案并复验；
> **R-16 / R-17 已闭环**（run `41871503684` 九项全绿）；**R-21 / R-24 已修**（`ed385cf`，待主理人终验确认）；
> **R-26 已修并经 CI 复验**（`8ce5ce9`）；新增 R-25、R-26、**R-27**。
> **本轮（V4-20 修复轮）状态同步**：**R-27 已由 `bddb3d0` 修复并本地实测验证**（本轮唯一红灯已解除）。

| ID | 风险 | 概率 | 影响 | 应对 / 状态 |
|---|---|---|---|---|
| **R-16** | Docker 容器与安装包**未实跑**：本机 `docker NOT FOUND`，容器启动、健康检查、数据卷持久化、`USER nextjs`、容器内迁移、CPU/内存均无法验证 | 高 | 大（正式发布后可能装不上） | 🟢 **已闭环（run `41871503684`，SHA `2773cd1`）**：`docker-verify` **九项全部 completed / success**，九项汇总表**全 PASS**。① 取证通道：`docker-verify.yml`（9 项验证），并修复了四个**工作流自身**的缺陷（BUG_REGISTER **V4-15** 定义级失败 / **V4-16** 迁移物路径断言错误 / **V4-18** app 健康判定口径 / **V4-19** `[7/9]` 端口与容器名冲突）。② 九项实证：镜像真实构建 ✅ / Compose 启动 + PG·Redis 健康检查 ✅ / 数据卷持久化 ✅ / 容器重启（数据与口令不变）✅ / **Redis 中断与恢复 `[R-17a]`** ✅ / **PG 中断与恢复 `[R-17b]`** ✅ / 安装包实际部署 `[7/9]` ✅ / 容器资源观察 `[8/9]` ✅ / 镜像内容与权限检查 `[9/9]` ✅。③ 修复提交：**`827eef7`**（安装模拟改走首次安装路径 —— 删掉不完整的 `.env` 预置）、**`2773cd1`**（安装模拟前 unset job 级 env —— 修 compose 插值被 shell 环境变量覆盖导致的**假绿**）。④ 安装模拟段实证输出：`app health = healthy` / `POSTGRES_USER=v2ex POSTGRES_DB=v2ex SEED_ADMIN_USERNAME=admin` / 管理员账号数 = 1 |
| **R-17** | Redis 故障恢复 / 缓存失效 / 内存观测**未验证**：压测环境未配 Redis | 中 | 中 | 🟢 **已闭环（run `41871503684`，SHA `2773cd1`）**：`docker-verify` **九项全部 completed / success**，九项汇总表**全 PASS**，含三个专项子任务 —— **`[R-17a]` Redis 中断与恢复** ✅（`stop redis` → 应用降级不 5xx → `start redis` → 回到 200 且 `PING` = `PONG`）、**`[R-17b]` PostgreSQL 中断与恢复** ✅（`stop postgres` → 断言应用**自动**回到 200，不需重启容器）、**`[R-17c]` 缓存失效与 Redis 内存观测** ✅（`info memory` / `info keyspace` / `dbsize` 观测 → 连续 40 次请求触发缓存写入 → `FLUSHDB` → 断言 `dbsize == 0` 且首页仍 200）。修复提交：**`827eef7`**（安装模拟改走首次安装路径）+ **`2773cd1`**（安装模拟前 unset job 级 env，修 compose 插值泄漏导致的假绿） |
| **R-18** | 升级路径断点：`deploy/update.sh` 不更新 `.env` 里的 `V2EX_IMAGE`，用户从 v0.0.3 升级后仍拉旧镜像（「看似升级实则仍跑旧版」） | 高 | 大（升级后功能不变） | 🟢 **已修并验证（收尾轮）**：提交 `b0d68c2` 重写 `deploy/update.sh`（+688 行），补齐**镜像 tag 自动同步**与**失败回滚**。新增 `scripts/release/verify-update-script.sh`（749 行）作为**不依赖 Docker 的沙箱自检**：在 `mktemp -d` 里放假的 `deploy/.env` + 真实 `backup.sh` 副本 + 记录调用参数的 docker stub，跑真实的 `update.sh` 并断言版本参数生效、pull 目标为新 tag、全程无 `down -v`、pull 失败时非零退出且 `.env` 恢复旧值、备份失败中止升级、非法版本号被拒、镜像未变化时告警中止、仓库真实文件未被改动。**实测结果：87 项断言全 PASS / 0 FAIL**（本轮实测；历史为 62 项）（硬约束：不执行任何真实 Docker 命令、不触碰仓库真实文件）。同步扩展 `scripts/release/preflight.sh` 覆盖此项。**⚠️ 边界**：真实容器级升级仍需在带 Docker 的环境复跑（并入 R-16 的重跑批次） |
| **R-19** | `release.yml` tag 白名单不含 `v0.0.4`，且 Release Notes 曾硬编码 `v0.0.1` | 高 | 大（发布流水线不触发 / 说明写错版本） | 🟡 **部分已修**：Release Notes 已改动态版本（6 处实跑验证 0 残留）；白名单按「刻意的摩擦」保留，**发布时人工加入**并写入 `RELEASE_PROCESS` 门禁（G-VER-01，第 9 步「固定最终 SHA」时由主理人手工加 `'v0.0.4'`）—— **不会自动加** |
| **R-20** | 版本载体全部为 `0.0.3`，验收时易被误判为「版本不一致」 | 高 | 中（对外解释成本） | 🟢 **已裁决（维持）**：开发态刻意保持 0.0.3，`CHANGELOG.md` `[Unreleased]` 显式记录决策；`preflight` 改 `--phase=dev` / `--phase=release` 双模式区分。**与 devops 的 N-01「🔴 阻断」结论冲突，主理人裁决以本条为准**。收尾轮据此在 `CHANGELOG.md` 补齐 v0.0.4 段落并显式标注「版本号尚未同步」 |
| **R-21** | 四身份 UI 验收缺口（**修复前状态**）：管理员导航栏**完全无 `/admin` 入口**、版主「锁定/置顶」UI 无按钮且 API 返回「无权限」、部分管理操作仅 API 层 | 高 | 中（权限边界与可用性） | 🟢 **已修复（`ed385cf`），待主理人终验确认**：提交 `ed385cf`「v0.0.4 补齐八项 UI 缺口 —— 管理员入口/关注/节点申请审批/通知已读」，导航收敛到单一事实来源 `src/lib/nav-links.ts`（`buildNavLinks(user)` / `renderNavLinks(links)`，此前导航链接在 4 个地方各写一遍）。**权限红线未削弱**：服务端鉴权仍是唯一权威（`src/app/admin/page.tsx` 的 `isStaff(user)` + `src/lib/admin-guard.ts`），前端加链接**不构成**权限放宽。主理人独立复核（真实浏览器，16 项断言全 PASS）：管理员导航含 `/admin` 且可点击到达；版主可进后台；**普通用户访问 `/admin` 被拒 + 导航无 `/admin` 入口**。⚠️ 与 R-27 相关：该提交补齐的节点申请入口在**生产构建**下暴露了新的提交链缺陷（`BUG_REGISTER` V4-20）—— **✅ 已由 `bddb3d0` 修复并本地实测验证** |
| **R-22** | 单测 `beforeAll` 建库超时：`CREATE DATABASE` 在本机实测单次 **38.6 秒**，超过 `vitest.config.ts` 的 `hookTimeout: 30_000` → 4 个自建库测试文件 hook 超时、28 条用例被跳过 | 高 | 中（本地复验假失败） | 🟢 **已定案并复验（收尾轮）**：经**三次归因勘误**后定案 —— 前两个假设（① `.env.local` → 5432 污染、② 并行 PG 负载竞争）均被实测推翻；真实根因是**本机建库慢且处于 crash recovery / I/O 积压态**。**稳态实测 `CREATE DATABASE` 耗时 2.0~2.3 秒**（同一 1.4GB 实例连测 3 次：2277 / 1978 / 2243 ms）。处置：`vitest.config.ts` 的 `hookTimeout` 由 30s 提到 **120s**（附完整实测注释），`fileParallelism: false` 串行化。**复验结果：单元测试连续 4 轮全绿（190 passed / 0 failed / 0 skipped）** —— **本轮隔离实例实测 81.68s**；历史轮次 170~210 秒（共享实例 55433 口径），`numPendingTests: 0` 证明**没有任何用例被静默跳过**（比「全绿」更强的结论） |
| **R-23** | 全量 E2E 中 `v004-account-admin.spec.ts:191`「关注：关注后出现在关注列表，取消后移除，重复关注幂等」被条件跳过：测试从 `/settings` 页 body 文本用 `/@([a-z0-9_]+)/i` 提取目标用户名，匹配不到即 `test.skip`。因此**关注链路三条断言本轮未被验证** | 高 | 中（覆盖缺口） | 🟢 **已修复并实跑通过**（主理人，2026-11-04）：用 `--grep` 精确定位（另候选「限流窗口重置」实跑通过，排除它）；把用例改为从 `/api/users/me` 取**确定性目标 id**，删除 `test.skip`，并补齐原本宣称却从未执行的三条断言（关注出现 / 重复幂等 / 取消移除）。实跑 `1 passed (9.8s)`、`npx tsc --noEmit` 零错误。**修复前**的 152 passed / 1 skipped 仍如实保留在 `docs/evidence/e2e/e2e-full-run-v0.0.4.md`，不回写历史 |
| **R-24** | 关注功能**无 UI 入口**（**修复前状态**）：全仓 `src/` 下没有任何关注按钮组件，个人主页不渲染关注按钮；功能只能通过 `POST/DELETE /api/users/follows` 使用 | 高 | 中（可用性） | 🟢 **已修复（`ed385cf`），待主理人终验确认**：提交 `ed385cf` 补齐关注功能的真实浏览器 UI 点击流 —— 个人主页有**真实可点击的关注按钮**；主理人独立复核：**点击「关注」→「已关注」→ 刷新后仍为「已关注」（持久化，非纯前端状态）→ 可取消关注还原**。E2E 侧同步补了一条「关注（UI）：真实点击关注/取消，刷新后状态持久化，关注列表出现该用户」用例（落在 `e2e/v004-account-admin.spec.ts`，该文件由 20 条增至 21 条）。与 R-21 同批修复 |
| **R-26** | **CI 上单元测试红灯**（**修复前状态**）—— `tests/floor-continuity.spec.ts` 在 CI 必然崩溃（ENOENT `.env.test`），5 条用例被跳过，`unit` job 红灯 ⇒ `e2e` job 被 `needs: unit` **连带跳过** ⇒ 整个 CI 红灯。⚠️ **这正是「185 vs 190」之谜的答案**：`.env.test` 是**本地隔离测试配置**（被 gitignore、从未入仓）⇒ 本地有、CI 没有；**CI 靠环境变量注入** `DATABASE_URL`（`ci.yml` 的 PG service），但该 spec 的 `:55433/` 端口白名单让它**拒绝采用 CI 注入的值** ⇒ 两条路都走不通。**CI 的分母仍是 190**（`185 passed \| 5 skipped (190)`）⇒ **v0.0.4 的用例总数在 V4-20 修复前是 190（修复后为 194）** | 高（**已发生**，实测 run `41837212170`） | 大（**PR 无法合并**；且**掩盖了「楼层连续性」这条关键回归的 CI 覆盖** —— 而它正是 B-05 楼层跳号缺陷的守护用例） | 🟢 **已修复并经 CI 复验**：提交 **`8ce5ce9`**（护栏 3 修复提交 **`634a202`**）—— 去掉 `:55433/` 端口白名单 + 读 `.env.test` 前先 `existsSync` 判断（修复方向此前已在纯净 CI 检出上双向验证均 `5 passed`，见 `docs/evidence/ci/test-baseline-v0.0.4.md` §0.5）。**CI 复验结果**：run `41860242099` 与 `41873009808`（SHA `2773cd1`）的「类型检查 / 单元测试」job 均 ✅ —— `Test Files 15 passed (15)` / `Tests 190 passed (190)` / **0 skipped**，且 `e2e` job **已真实跑过**（不再被 `needs: unit` 连带跳过）。**修复前的历史观测**（run `41837212170`，HEAD `930f29e`）：`Test Files 1 failed \| 14 passed (15)` / `Tests 185 passed \| 5 skipped (190)`。登记 `BUG_REGISTER` V4-17（**VERIFIED**） |

| **R-25** | **运行时上传数据被误提交入仓** —— E2E 跑出的 **18 个头像占位 PNG**（每个 684 字节）被 Git 跟踪，进入公开发布物。**风险性质与 R-01 同类**（运行时数据进入公开发布物） | 中（已发生，但内容无害） | 小～中（**发布物含非预期文件**，且暴露「运行时目录未被忽略」这一类根因） | 🟡 **已缓解（收尾轮）—— 历史仍可达，与 R-01 同源**：提交 `49d66d3` —— ① `.gitignore` 增加 `public/uploads/` 规则（附背景说明注释）；② `git rm --cached` 把 18 个文件移出索引。**刻意不改写 Git 历史、不删除磁盘文件**（改写远端历史属明令禁止的高风险不可逆操作）。验证：`git ls-files "public/uploads/*"` → **0 条**。⚠️ **残余**：18 个占位 PNG **仍在 Git 历史里**（引入提交 `04b107b` 16 个 / `1b15f79` 1 个 / `301a8a5` 1 个）。这些是 E2E 生成的**公开占位图，无用户数据、无凭据**，因此**不构成版权或凭据泄露**（与 R-01 的原站版权素材性质不同）；彻底消除需授权改写历史。**已登记 BUG_REGISTER V4-14** |

| **R-27** | **节点申请 UI 提交链断裂** —— 生产构建下 React #418 hydration 不匹配 → react-dom `nodeName.toLowerCase is not a function` 崩溃 → **表单 `onSubmit` 从未执行**。**API 路径通过、纯 UI 路径失败**（`POST /api/node-requests` 本身可用，但用户从 UI 点「提交申请」走不通） | 高（**已发生**，实测 run `41873009808`） | **严重（曾阻断正式 Release）** —— 用户可见的核心写路径在**生产构建**下完全不可用；且 E2E 唯一红灯会阻断 CI 放行。**✅ 该阻断已解除**；剩余阻断项见 `RELEASE_GATE.md` | 🟢 **已修复并本地实测验证（`bddb3d0`）** —— **根因（复盘，本地实测 + trace 级证据，非推测）**：HTML 规范给 `HTMLFormElement` 加了 `[OverrideBuiltins]` —— 表单内的**命名控件**会**遮蔽原型上的同名属性**。`<form><input name="nodeName"></form>` ⇒ `form.nodeName` 返回 **HTMLInputElement**（不是字符串 `"FORM"`）。Next.js 15.5 内置的 React 19 水合代码（`react-dom-client.production.js` 的 `canHydrateInstance`）有一行 `instance.nodeName.toLowerCase() !== type.toLowerCase()` —— 此时 `nodeName` 是 Element ⇒ `.toLowerCase()` 不存在 ⇒ `TypeError: nodeName.toLowerCase is not a function` ⇒ 水合失败（React #418）⇒ **事件处理器不绑定** ⇒ 表单走浏览器原生 GET 提交 ⇒ **写操作彻底失效**。**修复方式**：表单命名属性改名，消除与 `form.nodeName` 的遮蔽 —— `NodeRequestForm.tsx`（`nodeName` → `node_slug`、`nodeTitle` → `node_title`，`name` 与 `id` 均改）、`NewTopicForm.tsx` / `TopicEditForm.tsx`（`name="title"` → `name="topic_title"`，`id="title"` 有意保留供 E2E 定位）、`e2e/v004-four-roles-ui.spec.ts` 与 `e2e/helpers.ts` 选择器同步；**新增** `tests/form-name-shadowing.spec.ts`（4 条防回归断言，扫全仓 `src/`）。**实测结果**：单元 **194 passed / 0 failed / 0 skipped（16 文件）**、E2E **154 passed / 0 failed / 0 skipped（11 文件，3.9m）** 全绿；`/nodes/request` 的 React #418 **由 2 次归零（0 次）**；提交请求由「无（原生 GET）」恢复为 `POST /api/node-requests` ✅；提交后 URL 停在 `/nodes/request` ✅；成功 toast 出现 ✅。**修复前的历史快照如实保留**：CI run `41873009808`（SHA `2773cd1`）= `153 passed \| 1 failed \| 154 total`，唯一失败用例 `e2e/v004-four-roles-ui.spec.ts:122`「节点申请：UI 入口存在 + 真实点击提交成功 + 申请真实入库」。**trace 级证据见 `docs/SESSION_HANDOFF_v0.0.4.md` 第 5 轮 B2 段**，****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）**。登记 `BUG_REGISTER` **V4-20** |

| **R-31** | **Windows 本机 `next build` 偶发 EPERM**（`EPERM: operation not permitted, open '.next\trace'`）—— v0.0.5 记录「完全相同的命令序列有时 rc=0、有时 EPERM」，与 `rm -rf` / `mv` / 残留进程**均非单一因果** | 中（**环境级**，非产品缺陷） | 小～中（本机构建可能需重试；**不影响** Linux CI 与交付） | 🟡 **已做专项诊断，机制未查明（如实登记）**：v0.0.6 新增 `scripts/ci/eperm-diagnose.sh` 固化排查过程并出具 `docs/WINDOWS_EPERM_DIAGNOSIS_v0.0.6.md`。**本轮实测：同工作区连续构建 3/3 成功（45s/轮）、`.next/trace` 可创建、无残留监听进程 ⇒ 未复现**。**已排除**：残留 next 进程句柄、`.next` 跨任务共用、路径长度/特殊字符、系统权限与杀毒拦截、产品代码缺陷。**本轮最有价值的产出是识别出两个「假 EPERM」干扰源**：① Git Bash 的 `ln -s` 创建 MSYS 文本链接 ⇒ 报「找不到 next 包」而错误文本含 EPERM 字样；② `next-env.d.ts` 引用构建产物 `.next/types/routes.d.ts` ⇒ 干净工作区类型检查必失败。**处置**：本地脚本对 EPERM 免疫（识别后清理 + 有限重试，非 EPERM 立即中断）；**权威验证环境为 Linux CI**（GitHub Actions Linux runner 从未出现该问题）。⚠️ **不构成隐藏缺陷的许可**：CI 与本地均需持续观察；详见诊断报告 §六（未查明部分） |

| **R-32** | **Firefox / WebKit 移动视口 E2E 在本机全部失败** —— Firefox 报 `NS_ERROR_REDIRECT_LOOP`（页面快照是 Firefox 的「无法连接服务器」错误页）；WebKit 报断言超时（30s 级，注册流程卡住）。**与 v0.0.6 的改动无关** —— 在 **master（未改动）** 的独立 worktree 上**两者同样 7/8 失败**（失败用例集合完全相同）；同轮 Chromium 5 视口 **1200/1200 全绿** | 中（**本机环境**，非产品缺陷） | 小（不影响 Chromium 与 CI；仅影响本机 Firefox/WebKit 移动视口 E2E） | 🟡 **已用对照实验定性为环境问题**：① master（未改动）在独立 worktree 上**同样失败**（Firefox 与 WebKit 各 7/8，失败用例集合完全一致）⇒ **排除产品回归**；② Chromium 5 视口 1200/1200 全绿 ⇒ 与 v0.0.6 的 `<tbody>` / 移动端 CSS 改动无关；③ 组件级视觉回归中 **Firefox 的 21 个组合全部测量成功、零溢出** ⇒ 浏览器本身可用，失败只出现在**长时间运行的 E2E 并发**场景。**未完全查明的部分**：Firefox 读取 `HTTP_PROXY=http://127.0.0.1:55761`（本机代理，`NO_PROXY` 为空）而 Chromium 不读 —— 该代理与移动模拟（`isMobile: true`）的交互是**最可能的嫌疑**，但本环境缺少可归因的观测手段，**不作为结论**。**处置**：不修改产品代码；本机以 Chromium 覆盖交互验收，Firefox/WebKit 以**组件级视觉回归**（63 组合、三引擎一致、零溢出）覆盖；CI（Linux）不受影响 |

### 风险裁决记录（决策与权衡）
| 冲突点 | devops 结论 | QA 结论 | **主理人裁决** | 理由 |
|---|---|---|---|---|
| 版本载体 0.0.3 是否为阻断项 | N-01：🔴 阻断，发布前必须全量同步 | P2：可升到 0.0.4 或显式记录决策 | **开发态保持 0.0.3，显式记录决策** | 任务书明令禁止提前创建最终 Tag、禁止同一版本号反复移动；在最终 SHA 固定前升版本会造成「版本 0.0.4 但无 Tag」的中间态。`[Unreleased]` 累积 → 固定 SHA → 一次性同步 |
| 是否可进入 Draft Release | B-01~B-05 建议停在 Draft | 有条件可以 | **可以进入 Draft，但不得公开发布** → ✅ **已进入并已正式发布** | 功能与安全条件已满足；R-01 维持 DEFERRED；**R-27（节点申请 UI 提交链断裂）已由 `bddb3d0` 修复并本地实测验证，本轮唯一红灯已解除** —— 原作为 Draft Notes 已知限制披露的条目**可从该清单移除**（**CI 已复验通过**，run `41949555282`）；正式 Release 需另行授权 —— ✅ **v0.0.4 已获主人授权并于 2026-11-05 正式发布（Pre-release，Release id `434929894`）**；R-01 已在 Release Notes 显著披露（E-02 到期日 2026-12-04）。**R-16 / R-17 已闭环**（run `41871503684` 九项全绿）、**R-21 / R-24 已修**（`ed385cf`）—— 四项均**不再作为已知限制披露**；**R-18 已修并验证（62 项自检全 PASS）**；**R-22 已定案并复验**；**R-26 已修并经 CI 复验**（`8ce5ce9`）；**R-25 已处置，残余待授权** |
| 几何量测「52 条」是否可作放行依据 | — | D-01：不可复核，不得作为依据 | **已闭环，可用** | 脚本入仓 `tools/visual/summarize-visual-diff.py` + 机器证据 `geometry-summary.json`，三套口径（严格 52/52、历史 64/84、v0.0.3 96.9%）全部可复算 |
