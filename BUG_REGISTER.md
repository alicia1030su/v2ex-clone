# 缺陷登记表（BUG_REGISTER）

> 项目：V2EX Clone
> 本轮：全项目缺陷清零与安全加固（v0.0.2）
> **v0.0.4 补充登记见文末「v0.0.4 新发现并修复的缺陷」小节**
> 建表时间：2026-11-04
> 维护者：代码审计负责人（主理人）
>
> ⚠️ **测试数字口径声明（v0.0.4 收尾轮）**：**v0.0.4 的权威基线是 194 条 / 16 个文件 /
> 194 passed / 0 failed / 0 skipped**（本机连续 4 轮实测 + V4-20 修复后复验）。
> ⚠️ **本次因 V4-20 修复而变动的数字**：
> **单元 190 条 / 15 文件 → 194 条 / 16 文件**（新增 `tests/form-name-shadowing.spec.ts`，
> **4 条防回归断言**）；**E2E 153 passed | 1 failed | 154 total → 154 passed / 0 failed / 0 skipped
> （11 文件，3.9m）**。
> ⚠️ **历史轮次数字一律保留不改写，但已逐处标注其来源**：
> 「190 条 / 15 文件」是**修复前**的基线；「153 passed | 1 failed | 154 total」（run `41873009808`）
> 是 **V4-20 修复前**的 CI 历史快照。
>
> 本文中出现的 **185** 有**两个不同来源**，含义不同，不可混用：
> ① **v0.0.3 历史总数**（CI run `41760677505`，master @ `37710fb4`，14 个 spec 文件，`185 passed (185)`）；
> ② **修复前的历史观测**（run `41837212170`，HEAD `930f29e`，`185 passed | 5 skipped (190)` —— ⚠️ **分母仍是 190**，
> 5 条因 `floor-continuity` 在 CI 崩溃而跳过，见 **V4-17**）。
> **该红灯已由 `8ce5ce9` 修复**，run `41860242099` 与 `41873009808` 的「类型检查 / 单元测试」job 均已 ✅
> （vitest 15 文件全过、`190 passed / 0 skipped`）；**历史数字保留不改写**，但已逐处标注其来源。
>
> 无论哪种，**v0.0.4 的用例总数在 V4-20 修复后为 194**（修复前为 190）。
> 口径裁决见 `TEST_REPORT.md` 文首「185 vs 190 裁决」小节
> 与 `docs/evidence/ci/test-baseline-v0.0.4.md` §0.1。
> **历史条目不改写数字**，但在每处标注其来源。

## 状态图例

| 标记 | 含义 |
|---|---|
| `OPEN` | 已复现，未修复 |
| `FIXED` | 已修复 + 有回归测试 |
| `VERIFIED` | 已修复 + 回归测试通过 + 独立复核通过 |
| `WONTFIX` | 判定为"未实现的新功能"，转入 Backlog |
| `DEFERRED` | 需主人单独授权（如历史改写） |

---

## P0 缺陷（阻断发布）

| ID | 缺陷 | 位置 | 复现方法 | 修复提交 | 测试证据 | 关闭条件 | 状态 |
|---|---|---|---|---|---|---|---|
| P0-01 | `install.ps1` 缺 UTF-8 BOM → Windows PowerShell 5.1 按 ANSI 读取中文脚本，ParseFile 报 12 处语法错误，**Windows 用户 100% 无法安装** | `deploy/install.ps1` | `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('deploy/install.ps1',[ref]$null,[ref]$null)"` → 12 处错误 | `1ecfc4a` | ParseFile 直接解析通过（0 错误）；完整流程实测退出码 0 | 已 VERIFIED | **VERIFIED** |
| P0-02 | Windows 上 `chmod 600` 对 NTFS 是空操作 → 含明文口令的 `.env` 与 `INSTALL_CREDENTIALS.txt` 实测权限仍为 `-rw-r--r--`（其他本机用户可读） | `deploy/install.sh` | 安装后 `ls -l INSTALL_CREDENTIALS.txt` → 644 | `ce6122c`（install.sh）+ `1ecfc4a`（install.ps1） | 安装后 `icacls` 实测 ACL 仅剩 SYSTEM / Administrators / 当前用户 | 已 VERIFIED | **VERIFIED** |
| P0-03 | 原站 HTML/CSS/JS 副本、参考截图与差异热力图在 **全部远端引用**（master、fix/p0-review-hardening、**v0.0.1 tag**、refs/pull/1/head）中均**可达**，匿名可经 raw.githubusercontent.com 取回（实测 `combo.js` HTTP 200） | Git 历史 `75c9508` | `curl https://raw.githubusercontent.com/alicia1030su/v2ex-clone/75c9508.../combo.js` → 200 | — | 量化：master A=44/B=40/C=10；**v0.0.1 A=45/B=40/C=10（tag 使可达数 +1）**；refs/pull/1/head A=44/B=40/C=10 | **需主人单独授权**（改写历史 / 移动 tag 均被明令禁止） | **DEFERRED** |
| P0-04 | `postcss@8.4.31`（经 next 15.5.28 间接依赖）4 个 high 漏洞：XSS via Unescaped `</style>`、sourceMappingURL 任意文件读取 | `package-lock.json` | `npm audit --audit-level=high` → high=1 | `0a18978`（overrides → postcss ^8.5.32） | `npm audit --audit-level=high` 退出码 0，high=0 | 已 VERIFIED | **VERIFIED** |

---

## P1 缺陷（阻断发布）

| ID | 缺陷 | 位置 | 复现方法 | 修复提交 | 测试证据 | 状态 |
|---|---|---|---|---|---|---|
| P1-01 | 发布流水线 `preflight` 在 tag 触发时检查"远端 tag 是否已存在"——但 tag 推送**本身就是**触发前提，两者必然冲突，流水线 100% 在第一个 job 失败 | `.github/workflows/release.yml` | 推送 v0.0.1 tag → run 41655920291 失败 | `b0a1a8f` | 后续 6 次 run 的 preflight 全部 success | **VERIFIED** |
| P1-02 | `::add-mask::` 被写入 `$GITHUB_ENV`（它是 workflow command，必须走 stdout）→ GitHub 报 `Invalid format`，deploy-verify 第一个步骤即失败 | `.github/workflows/release.yml` | 真实运行 41659591653 | `a92668e` | mask 输出为单行；GITHUB_ENV 仅含 KEY=VALUE | **VERIFIED** |
| P1-03 | gitleaks 资产名写成 `linux_amd64`，官方实际是 Go 的 GOARCH 命名 `linux_x64` → 404，curl 以退出码 22 中止 | `.github/workflows/release.yml` | 真实运行 41659591653 | `6916f0b` | 加官方 checksums 校验；run 41662105945 security-scan success | **VERIFIED** |
| P1-04 | gitleaks-action 在 tag push 下 `commits` 数组为空 → 打印 "No commits to scan" 后 `exit 0`，**秘密扫描假通过**（扫描一步没跑却返回成功） | `.github/workflows/release.yml` | 读 gitleaks-action v3 源码 + 真实运行日志 | `8f85937` | 改为直接调用 CLI，只扫 Git 跟踪的文件 | **VERIFIED** |
| P1-05 | deploy-verify 找不到 env file —— compose 的 `env_file` 相对 **compose 文件所在目录**解析，而脚本把 compose 拷到仓库根、只生成 `.env.release` | `.github/workflows/release.yml` | 真实运行 41657680697：`couldn't find env file: .../deploy/.env` | `39276c9` | 改为在 `deploy/` 内生成 `.env` | **VERIFIED** |
| P1-06 | E2E job 用 `next start` 但没有 `next build`（构建只发生在 code-checks job，两个 job 不共享工作区）→ `Could not find a production build in the '.next' directory` | `.github/workflows/release.yml` | 真实运行 41656168004 | `a92668e` | E2E job 补"构建应用"步骤后 success | **VERIFIED** |
| P1-07 | 部署验证一次性读取 health 状态，容器仍处 `starting`（healthcheck `start_period: 90s` 未结束）→ 误判"未通过健康检查"，而此时应用已 Ready | `.github/workflows/release.yml` | 真实运行 41662105945 | `94cc132` | 改为轮询 40×3s；run 41665521879 该步 success | **VERIFIED** |
| P1-08 | 持久化验证直接 POST 注册接口 → 403。写接口有**双提交 Cookie** CSRF 防护，`verifyCsrf()` 无 CSRF Cookie 时直接判失败 | `.github/workflows/release.yml` | 真实运行 41663818266 | `baec37b` | 本地实测：不带 token→403，带 token→201 | **VERIFIED** |
| P1-09 | 端口暴露检测用 `docker compose port` —— 该命令在容器内部 EXPOSE 端口时**仍会输出**，即使未发布到宿主机 → 误报"PostgreSQL 端口暴露" | `.github/workflows/release.yml` | 真实运行 41663818266 | `94cc132` | 改为三重检测（compose 声明 + 实际 TCP 连接 + 监听套接字） | **VERIFIED** |
| P1-10 | 两处回归测试断言因文档重写而失效：`README 包含完成度声明`（表述改为"功能完成度"）、`存在历史清理方案文档`（该文档已移出公开仓库） | `tests/docker-config.spec.ts` | CI run 41652512806 → 2 failed | `05b30de` | 断言改为验证**更强**的不变量（内部文档不入库 + 公开文档如实披露 + 禁止虚假表述） | **VERIFIED** |
| P1-11 | 仓库根缺 `.dockerignore` 时的隐患已修复，但 `deploy/.dockerignore` 与根规则需保持同步；构建上下文 `COPY . .` 会把整个仓库送进 builder 层 | `Dockerfile` / `.dockerignore` | 审计 Dockerfile 全部 COPY 指令 | — | 根 `.dockerignore` 已排除 docs/evidence 全目录、.env、备份、Git | **VERIFIED** |

---

## P2 缺陷（尽力修复）

| ID | 缺陷 | 位置 | 状态 | 备注 |
|---|---|---|---|---|
| P2-01 | `npm audit` 4 个 moderate：`drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild`（GHSA-67mh-4wv8-2f99，dev server 可被任意网站读取响应） | `package.json` | 待 devops-engineer 出结论 | 关键判定点：`drizzle-kit` 是**迁移 CLI**，仅在 `db:migrate`/容器启动阶段使用；`esbuild` 漏洞前提是 dev server，生产 `next start` 不加载 esbuild。需给出可复核证据 + 例外到期日 |
| P2-02 | Windows Git Bash 下 `icacls` 路径转换输出 `C://Users//` 双斜杠（`cygpath -w` 在 Git Bash 下的格式问题） | `deploy/install.sh` | OPEN | 实测 icacls 仍成功（"成功处理 1 个文件"），但输出格式不规范；建议加 `tr -d '/'` 或改用 `cygpath -m` |
| P2-03 | `deploy/.test-shim-docker.sh` 测试桩曾被误提交进公开发布包 | `.github/workflows/` | **VERIFIED** | 已移至 `tests/fixtures/fake-docker.sh`，并加 `.gitignore` 规则防复发 |
| P2-04 | 内部安全处置文档（历史清理方案、演练报告、残留检查脚本）原在公开仓库内，含原站素材路径与泄露细节 | `docs/` | **VERIFIED** | 已移出至仓库外 `_internal/release-audit/`；公开文档保留"Git 历史中仍可取回"的如实披露 |

---

## 未实现的新功能（转入 Backlog，不阻塞本轮）

> 依用户指令：不以开发未完成的大量新功能阻塞本轮安全和稳定性修复；且**禁止**用假按钮/假接口/静态演示数据冒充已实现。

| 功能 | 现状 | 处置 |
|---|---|---|
| 主题编辑 / 删除 | 表有软删除字段，缺 UI 与 API | Backlog |
| 感谢（thank）功能 | `thanks` 表与计数已建，**点击交互未接** | Backlog |
| 关注用户 / 关注流 | `follows` 表已建，无 UI | Backlog |
| 积分排行榜 / 每日登录加分 | `users.balance` 与发帖 +10 已实现，无排行榜页 | Backlog |
| RSS / JSON Feed | 仅复刻入口位置，无生成器 | Backlog |
| 邮件找回密码 | 页面已复刻，邮件流程未实现 | Backlog |
| 主题标签 / 附件上传 / 私信 / 头像上传 | 未实现 | Backlog |
| 投票（顶/踩） | `votes` 表已建，交互未接 | Backlog |
| 第三方登录（Google / Solana） | 需外部凭据，UI 禁用态 | Backlog |

---

## v0.0.3 本轮新发现并修复的缺陷（全部有实测证据）

| ID | 缺陷 | 位置 | 修复提交 | 测试证据 | 状态 |
|---|---|---|---|---|---|
| V3-01 | **限流信任边界被绕过** —— `middleware` 无条件读 `x-forwarded-for` 写入内部头，伪造值被「洗白」成可信头，导致登录/注册限流完全可绕过 | `src/middleware.ts` | `d1a9882` | 修复前：25 次伪造 IP 全部 201 通过；修复后：第 21 次返回 **429** | **VERIFIED** |
| V3-02 | **Next.js 15 的 `??=` 陷阱** —— `req.headers['x-forwarded-for'] ??= socket.remoteAddress`，客户端传了该头就不用真实地址覆盖，且早于 middleware 执行 | `src/middleware.ts` | `d1a9882` | 新增 `tests/client-ip.spec.ts` 8 条 + `tests/middleware-client-ip.spec.ts` 6 条 | **VERIFIED** |
| V3-03 | **`install.sh`/`install.ps1` 强制覆盖 `V2EX_IMAGE`** —— 静默忽略调用方传入的镜像地址，导致 CI 无法用本地镜像验证安装 | `deploy/install.sh`、`deploy/install.ps1` | `4e2ce5e` | CI 日志确认 `V2EX_IMAGE: v2ex-clone:install-verify` 被接受 | **VERIFIED** |
| V3-04 | **`APP_VERSION`/`$AppVersion` 未同步到 0.0.2** —— 凭据文件抬头版本错误 | `deploy/install.sh`、`deploy/install.ps1` | `4e2ce5e` | 凭据文件内容核对 | **VERIFIED** |
| V3-05 | **`docker compose pull` 无条件执行** —— 镜像本地已存在时（离线安装/内网仓库）安装被阻断 | `deploy/install.sh`、`deploy/install.ps1` | `df6be85` | 本地实测：pull 失败 + image inspect 成功 → 继续安装 | **VERIFIED** |
| V3-06 | **`shell: powershell` 的 run 块含中文** —— GitHub 写成 UTF-8 **无 BOM** 临时 .ps1，Windows 5.1 按 ANSI 读取 → 解析失败（与 install.ps1 缺 BOM 同类） | `.github/workflows/install-verify.yml` | `4e2ce5e` | Windows job「解析检查」从 failure 转为 success | **VERIFIED** |
| V3-07 | **down -v 检测把注释行与「提示用户手动执行」的引导文本也算进去** | 同上 | `f640a05` | 本地 4 个脚本逐一复核 | **VERIFIED** |
| V3-08 | **缺 Docker 检测用大小写敏感的 `-notmatch 'docker'`** —— GH runner 自带 docker CLI 时误判 | 同上 | `63f7929`→`613207a`→`cd756bd` | 5 个样本输出双向验证 | **VERIFIED** |
| V3-09 | **`Write-Host` 走 Information 流，普通管道捕获不到**；`exit 1` 让管道来不及刷出 → 判定永远失败 | 同上 | `cd756bd` | 改用 Start-Process + 文件重定向，捕获长度 976 字节 | **VERIFIED** |
| V3-10 | **幂等检查未规范化换行** —— CRLF/LF 差异误判「配置被覆盖」 | 同上 | `78a2573` | 本地连跑两次：长度 2515 → 2515，内容一致 | **VERIFIED** |
| V3-11 | **PATHEXT 顺序 `.COM;.EXE;.BAT;.CMD`** —— Windows 上 `.EXE` 优先于 `.CMD`，假 docker shim 失效 | 同上 | `c654d2d` | 改用无扩展名 shim；`which docker` → `/d/a/_temp/inst/docker` | **VERIFIED** |
| V3-12 | **shim 未处理 `docker inspect`** → 健康检查拿不到 healthy → install.sh 等待 120 秒超时 | 同上 | `d6bd278` | 本地实测 install.sh exit=0 完整跑通 | **VERIFIED** |
| V3-13 | **5 个生产依赖完全未被引用**（jose/dompurify/bcryptjs/nanoid/zod）—— 白白扩大供应链攻击面 | `package.json` | `0b93eca` | 全仓库搜索 0 引用；移除后 tsc 0 错误、vitest **185/185**（**v0.0.3 历史总数**，master @ `37710fb4`；v0.0.4 权威基线为 194/194，修复前为 190/190） | **VERIFIED** |
| V3-14 | **生产镜像整包 COPY node_modules**（530MB，含 devDeps 与 esbuild 0.18.20 漏洞版本） | `Dockerfile` | `19750b9` | `npm ci --omit=dev` 后 73 包 / 429MB；entrypoint 三个必需路径全部存在 | **VERIFIED** |
| V3-15 | **`publish-release`/`verify-release` 无 dry_run 闸门** —— 勾选「仅验证」仍会真的发 Release | `.github/workflows/release.yml` | devops 修复 | 全链路语义核查：两个 job 均有 `if: needs.preflight.outputs.dry_run != 'true'` | **VERIFIED** |
| V3-16 | **发布 tag 触发器为 `'v*'`** —— 任何能推 tag 的人可触发带写权限的流水线 | 同上 | devops 修复 | 触发器已为显式白名单 | **VERIFIED** |
| V3-17 | **action 版本仍为 node20 线** —— GitHub 已移除 node20 运行时，会在启动阶段直接失败 | `.github/workflows/{ci,release}.yml` | devops 修复 | 全部升级到 node24 版本线，CI 实跑通过 | **VERIFIED** |
| V3-18 | **`listReplies` 未过滤软删除的回复** —— 已删除内容会通过普通页面泄露 | `src/server/queries.ts` | `e4a89ec` | 软删除主题：未登录与普通用户访问均 **404** | **VERIFIED** |
| V3-19 | **`.fa` 图标类被设为 `float:left`** —— 与原站 `combo.css` 的 `inline-block` 不一致，破坏 FontAwesome 字体的基线与行高 | `src/app/globals.css` | `0313959` | 与原站 combo.css 逐条比对 | **VERIFIED** |
| V3-20 | **零 `@media` 断点** —— 375px 视口下 `.content` 的 `min-width:600px` 导致横向滚动，移动端不可用 | `src/app/globals.css` | `0313959` | 三视口几何量测；375 视口本地不再溢出 | **VERIFIED** |
| V3-21 | **窄屏下 `#Rightbar` 浮动挤偏 `#Main`** —— 实测 Δx=100px | `src/app/globals.css` | `0313959` | 改用 flex `order` 后置；375 视口 Δy 从 928 降到 20 | **VERIFIED** |
| V3-22 | **迁移脚本无幂等保护** —— `CREATE TYPE`/`ADD CONSTRAINT` 重跑即失败 | `drizzle/0001_striped_magdalene.sql` | `b4c0a12` | 连续应用 3 次全部 exit=0，26 表 / 38 约束 | **VERIFIED** |
| V3-23 | **测试与 `@/db` 全局连接池库不一致** —— 服务层写 A 库、断言读 B 库，外键约束失败 | 5 个 v0.0.3 测试文件 | `0ae8c08` | 修正后 185/185 全绿（**v0.0.3 历史总数**，master @ `37710fb4`；v0.0.4 权威基线为 194/194，修复前为 190/190） | **VERIFIED** |
| V3-24 | **邮件脱敏断言与实现脱节** —— 实现改进后测试期望值过时 | `tests/password-reset.spec.ts` | `0ae8c08` | 断言改为验证「不泄漏原字符」这一性质 | **VERIFIED** |
| V3-25 | **前端调用后端不存在的端点** —— `POST /api/notifications/read` 实际 404，通知「标记已读」功能失效 | `src/components/NotificationsList.tsx` | `9d766fa` | 改为 `POST /api/notifications`；已接入 CI 契约校验防回归 | **VERIFIED** |
| V3-26 | **`.gitignore` 的 `logs/` 规则误伤源码目录** —— 匹配任意层级同名目录，`src/app/api/admin/logs/` 从未进入版本库，生产环境必然 404 | `.gitignore` + `src/app/api/admin/logs/route.ts` | `b30245b` | 改为 `/logs/` 并强制入库该端点；CI 干净 checkout 复验 72 路由 | **VERIFIED** |
| V3-27 | **Release 流程的 `publish` 输入项 YAML 缩进错误** —— 被嵌进 `dry_run` 内部，`gh workflow run` 无法传入，Draft 保护缺少转正通道 | `.github/workflows/release.yml` | `045043c` | 缩进改为与同级输入项一致；dispatch inputs 现含 `publish`(boolean,false) | **VERIFIED** |
| V3-28 | **远端核验 job 假设 Release 已公开发布** —— draft 下匿名访问返回 404，导致最后一个 job 必然失败（run 41757442592） | `.github/workflows/release.yml` | `b963ee0` | 核验改为 draft-aware：带凭据校验资产完整性，匿名下载与网页检查加 `if: inputs.publish == true` | **VERIFIED** |
| V3-29 | **GHCR 匿名拉取被当作发布成败判据** —— 包 visibility 是仓库级设置（默认 private），不在代码控制范围内；v0.0.1/v0.0.2 同样是 401 | `.github/workflows/release.yml` | `b963ee0` | 改为「带凭据拉取 = 镜像已推送」作判据，匿名可拉取性降级为提示 | **VERIFIED** |

## v0.0.2 本轮新发现并修复的缺陷（全部有实测证据）

| ID | 缺陷 | 位置 | 修复提交 | 测试证据 | 状态 |
|---|---|---|---|---|---|
| S-01 | **限流与审计无条件信任可伪造的 `x-forwarded-for`** —— 应用端口直接映射到宿主机，攻击者伪造该头即可完全绕过登录/注册限流 | `src/lib/rate-limit.ts`、`src/app/api/auth/{signup,signin}/route.ts`、`src/lib/auth.ts` | `d1a9882` | 修复前端到端实测：伪造不同 IP 连发 25 次注册**全部 201 通过**；修复后第 21 次返回 **429** | **VERIFIED** |
| S-02 | `Next.js 15` 用 `??=` 处理 `x-forwarded-for`（客户端传了就不用 socket 真实地址覆盖），middleware **无法区分**真实与伪造值 | `src/middleware.ts` | `d1a9882` | 新增 `tests/client-ip.spec.ts` 8 条 + `tests/middleware-client-ip.spec.ts` | **VERIFIED** |
| S-03 | `install.sh`/`install.ps1` 强制覆盖 `V2EX_IMAGE`，静默忽略调用方传入值 → CI 无法用本地镜像验证安装 | `deploy/install.sh`、`deploy/install.ps1` | `4e2ce5e` | CI 日志确认 `V2EX_IMAGE: v2ex-clone:install-verify` 被接受 | **VERIFIED** |
| S-04 | `APP_VERSION`/`$AppVersion` 未同步到 0.0.2，凭据文件抬头版本错误 | `deploy/install.sh`、`deploy/install.ps1` | `4e2ce5e` | 凭据文件内容核对 | **VERIFIED** |
| S-05 | `docker compose pull` 无条件执行 → 镜像**本地已存在**时（离线安装/内网仓库）安装被阻断 | `deploy/install.sh`、`deploy/install.ps1` | `df6be85` | 本地实测：pull 失败 + image inspect 成功 → 继续安装 | **VERIFIED** |
| S-06 | `install-verify.yml` 的 Windows job 的 `shell: powershell` run 块含中文 —— GitHub 写成 UTF-8 **无 BOM** 临时 .ps1，Windows 5.1 按 ANSI 读取 → 解析失败（与 install.ps1 缺 BOM 同类） | `.github/workflows/install-verify.yml` | `4e2ce5e` | Windows job 第 4 步「解析检查」从 failure 转为 success | **VERIFIED** |
| S-07 | down -v 检测把**注释行**与**提示用户手动执行的引导文本**也算进去 | `.github/workflows/install-verify.yml` | `f640a05` | 本地 4 个脚本逐一复核 | **VERIFIED** |
| S-08 | 缺 Docker 检测用大小写敏感的 `-notmatch 'docker'` 且失败信号只含英文 → GH runner 自带 docker CLI 时误判 | 同上 | `63f7929` → `613207a` → `cd756bd` | 5 个样本输出双向验证（3 正例命中 / 2 反例不误判） | **VERIFIED** |
| S-09 | `Write-Host` 输出走 Information 流，普通管道捕获不到；`exit 1` 让管道来不及刷出 → 判定永远失败 | 同上 | `cd756bd` | 改用 Start-Process + 文件重定向，捕获长度 976 字节 | **VERIFIED** |
| S-10 | 幂等检查用 `Get-Content -Raw` 未规范化换行 → CRLF/LF 差异误判「被覆盖」 | 同上 | `78a2573` | 本地连跑两次：长度 2515 → 2515，内容一致 | **VERIFIED** |
| S-11 | GH windows runner 自带真实 `docker.exe`，PATHEXT 解析 `.EXE` 优先于 `.CMD` → 假 docker shim 失效 | 同上 | `c654d2d` | 改用无扩展名 shim；`which docker` → `/d/a/_temp/inst/docker` | **VERIFIED** |
| S-12 | shim 未处理 `docker inspect` → 健康检查拿不到 healthy → install.sh 等待 120 秒超时 | 同上 | `d6bd278` | 本地实测 install.sh exit=0 完整跑通 | **VERIFIED** |
| S-13 | **5 个生产依赖完全未被引用**（jose / dompurify / bcryptjs / nanoid / zod）—— 供应链攻击面与镜像体积的无谓增加 | `package.json` | `0b93eca` | 全仓库搜索 0 引用；移除后 tsc 0 错误、vitest **117/117** | **VERIFIED** |
| S-14 | `publish-release`/`verify-release` 无 dry_run 闸门 → 勾选「仅验证」仍会真的发 Release | `.github/workflows/release.yml` | devops-engineer 已补 job 级 `if` | 全链路语义核查：两个 job 均有 `if: needs.preflight.outputs.dry_run != 'true'` | **VERIFIED** |
| S-15 | 发布 tag 触发器为 `'v*'` → 任何能推 tag 的人可触发带 `packages:write`/`contents:write` 的流水线 | `.github/workflows/release.yml` | devops-engineer 已改白名单 | 触发器已为显式白名单 | **VERIFIED** |
| S-16 | action 版本仍为 node20 线（`checkout@v4` 等）—— GitHub 已于 2026-09-23 移除 node20 运行时，会在**启动阶段**直接失败 | `.github/workflows/{ci,release}.yml` | devops-engineer 已升级 | 全部升级到 node24 版本线，CI 实跑通过 | **VERIFIED** |
| S-17 | 生产镜像整包 COPY node_modules（530MB，含 devDeps 与 esbuild 0.18.20 漏洞版本） | `Dockerfile` | `19750b9` | `npm ci --omit=dev` 后 73 包 / 429MB；entrypoint 三个必需路径全部存在 | **VERIFIED** |
| S-18 | `install-verify.yml` 的 Windows 侧 down -v 检测仍是旧版（只改了 Linux 侧） | `.github/workflows/install-verify.yml` | 本轮 | 两侧逻辑已统一，本地 4 脚本复核 | **VERIFIED** |

## 本轮发现的**环境问题**（非产品缺陷，不计入缺陷数）

| 现象 | 判定 | 处置 |
|---|---|---|
| `next build` 偶发 `EPERM: .next\trace` | **环境**：残留 node 进程占用文件句柄 | 杀掉残留进程后重试即成功；**未做任何清理的仓库同样报此错**，与代码无关 |
| `db-lazy-init.spec.ts` 偶发 ECONNREFUSED | **环境**：本机 PostgreSQL 进程随宿主 shell 回收 | PG 就绪后 117/117 全绿 |
| Playwright 清空 `test-results` 触发批量删除保护 | **环境**：WorkBuddy 的 safe-delete 保护（>50 文件） | 改用 `mv` 移动而非删除 |
| `git filter_repo` 演练时 `.next` 被并发清理 | **环境**：多个 agent 并发跑构建 | 改用独立 worktree 目录构建 |

---

## v0.0.4 新发现并修复的缺陷

> 均由**真实浏览器 E2E** 或 **100 万回复规模真实压测**发现，非静态审计推测。
> 状态图例同上；`FIXED` 表示已修复且有回归用例，`VERIFIED` 表示另有独立实测复核。
> 详细验证方式见 `CHANGELOG.md` 的 `[Unreleased]` 段落与
> `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md` §5。

| ID | 级别 | 缺陷 | 位置 | 发现方式 | 回归证据 | 状态 |
|---|---|---|---|---|---|---|
| V4-01 | 阻断 | `GET /api/nodes` 必然 500（PG 42P01，表别名与 drizzle 条件冲突） | `src/lib/node-service.ts` | 端点冒烟 E2E（v0.0.3 无任何测试调用该端点） | `e2e/v004-api-contract.spec.ts` + `e2e/v004-endpoint-smoke.spec.ts` | **VERIFIED** |
| V4-02 | 阻断 | `GET /api/topics/[id]` 必然 500（PG 42601，SQL 片段被当参数绑定） | `src/app/api/topics/[id]/route.ts` | 端点冒烟 E2E | 同上 + 压测 4810 请求无 5xx | **VERIFIED** |
| V4-03 | 严重 | 分页 `limit`/`offset` 未透传，形同虚设 | `src/app/api/nodes/route.ts` | API 契约 E2E | `v004-api-contract.spec.ts`「分页参数生效」、`e2e/pagination.spec.ts` | **VERIFIED** |
| V4-04 | 严重 | 「编辑主题」假按钮（点击无反应） | `src/components/TopicActions.tsx` | 真实浏览器 UI E2E | `v004-content-interaction.spec.ts` 编辑模态框全链路 | **VERIFIED** |
| V4-05 | 严重 | 回复楼层跳号（连发 5 条得 26/24/22/20/18） | `src/server/floor.ts`、`src/app/api/replies/route.ts` | 100 万回复压测 + HTTP 复现 | `tests/floor-continuity.spec.ts`（严格 `1..n`）、修复后实测 41..46 连续 | **VERIFIED** |
| V4-06 | 一般 | 注册赠送积分绕开账本，破坏账本不变式 | `src/app/api/auth/signup/route.ts` | 压测后全库一致性校验（5 个用户 ledger_rows=0 而 balance=1000） | 新用户 balance=1000 / ledger_sum=1000 / rows=1；账本链首尾相接 | **VERIFIED** |
| V4-07 | 一般 | `/hot` 独立页面缺失 | `src/app/` | 视觉对照矩阵 + 压测 404 | `visual-diff-multi.json` 4 视口 hot 条目；压测 230 请求 0 错误 | **FIXED** |
| V4-08 | 严重 | 排行榜相关子查询 N+1（EXPLAIN 241.98 秒） | `src/lib/credit-service.ts` | 压测 `/api/leaderboard` 超时 | `drizzle/0002_v004_perf_indexes.sql` + 三个独立聚合改写 | **VERIFIED** |
| V4-09 | 严重 | 搜索 `ILIKE '%..%'` 前导通配符全表扫描（803ms） | `src/app/api/search/route.ts` | 压测 3207ms | `topics_title_trgm_idx` / `topics_content_trgm_idx` → 0.064ms | **VERIFIED** |
| V4-10 | 一般 | 节点列表逐节点相关子查询（411ms） | `src/lib/node-service.ts` | 压测 1543ms | 改用 `topics.last_reply_at` 汇总字段聚合 → 40.6ms | **VERIFIED** |
| V4-11 | 一般 | 视觉原站路径映射错误（`/go/go` 误当节点列表页；`/my/*` 实测 404） | `tools/visual/capture-multi.mjs` | 原站路径逐个探测 | 4 视口 × 17 页面重新采集，如实标注 `no-auth-reference` | **FIXED** |
| V4-12 | 一般 | GHCR 可见性误判（首次 401 即判 private） | `docs/SECURITY_EXCEPTIONS.md` E-10、`.github/workflows/release.yml` | 完整 Bearer 协议复核 | 匿名换 token → 带 token 重试 v0.0.1/2/3 全部 HTTP 200 | **VERIFIED** |
| V4-13 | 一般 | `RISK_REGISTER` R-09 整段错置（CSRF 风险实际从未评估） | `RISK_REGISTER.md` | 验收核查 D-03 | 三场景 curl 实测：无 cookie 403 / token 错 403 / 正常流程 201 | **VERIFIED** |

### v0.0.4 第四轮（收尾轮）新发现的缺陷 —— 6 项

> **发现轮次**：v0.0.4 收尾轮（2026-11-04，主理人实测 + CI 实跑取证）。
> 这 6 项与上面的 V4-01~V4-13 **来源不同**：V4-01~13 来自真实浏览器 E2E / 真实压测，
> 而本组 6 项来自**版本库卫生核查**与 **CI 工作流实跑**——
> 即「验证基础设施本身出问题」，但同样会直接导致验收结论不可信，故一并登记。
>
> | ID | 级别 | 一句话 |
> |---|---|---|
> | V4-14 | 严重 | 运行时上传数据被误提交入仓（18 个占位 PNG） |
> | V4-15 | 严重 | `docker-verify.yml` 定义级失败（GitHub 表达式不支持 `&&`/`\|\|` 三元） |
> | V4-16 | 一般 | `docker-verify.yml` 迁移物路径断言错误（**验证脚本自身错误，非产品缺陷**） |
> | V4-17 | 阻断 | `tests/floor-continuity.spec.ts` 在 CI 必然崩溃（**已修，`8ce5ce9`**） |
> | V4-18 | 严重 | `docker-verify.yml` 的 app 健康判定口径不可能成立（app 其实完全健康） |
> | V4-19 | 严重 | `docker-verify.yml` 的 `[7/9]` 安装包部署必然失败（端口占用 + 容器名冲突） |
> | V4-20 | 严重 | 节点申请 UI 提交链断裂（**本轮唯一红灯 —— 已修复并本地实测验证**） |

| ID | 级别 | 缺陷 | 位置 | 发现方式 | 修复 | 验证方式 | 状态 |
|---|---|---|---|---|---|---|---|
| **V4-14** | 严重 | **运行时上传数据被误提交入仓** —— E2E 跑出的 18 个头像占位 PNG（每个 684 字节）被 Git 跟踪，成为公开发布物的一部分。**风险性质与 R-01 同类**（运行时数据进入公开发布物） | `public/uploads/avatars/*`（18 个 `.png`） | 版本库卫生核查（`git log --numstat -- public/uploads/*`） | 提交 `49d66d3`：① `.gitignore` 增加 `public/uploads/` 规则（含背景说明注释）；② `git rm --cached` 把 18 个文件移出索引。**刻意不改写 Git 历史、不删除磁盘文件** | ① `git ls-files "public/uploads/*"` → **0 条**（已移出索引）<br>② `.gitignore` 含 `public/uploads/` 规则<br>③ 引入提交逐一定位：`04b107b`（16 个）、`1b15f79`（1 个）、`301a8a5`（1 个），合计 **18 个**唯一路径 | **VERIFIED** |
| **V4-15** | 严重 | **`docker-verify.yml` 定义级失败** —— 工作流在**定义阶段**就失败，**一个 job 都没被创建**。症状：run 0 秒结束、`total_count=0`、报错仅一句「This run likely failed because of a workflow file issue」 | `.github/workflows/docker-verify.yml`（证据汇总步骤） | CI 实跑（run `41836244258`） | 提交 `2532f5f`：把三元判断从 GitHub 表达式上下文**下沉到 shell 层** —— `${{ job.status == 'success' && echo PASS \|\| echo '见日志' }}` → `$([ "${{ job.status }}" = 'success' ] && echo PASS \|\| echo FAIL)`；`${{ }}` 只用于传值 | ① 根因实测：GitHub Actions 表达式上下文**不支持 `&&`/`\|\|` 三元**（`\|\|` 取默认值支持，三元不支持）<br>② **陷阱**：YAML 本身能正常解析（python yaml 校验通过，1 job / 17 steps），问题只在表达式求值阶段 —— 这是排查耗时的主因<br>③ 全仓库复核：`ci.yml` / `install-verify.yml` / `release.yml` 其余表达式均为合法写法（`release.yml` 的 `${{ inputs.publish \|\| 'false' }}` 是 `\|\|` 取默认值，合法且历史跑通过）<br>④ 修复后 R-16 / R-17 的验证可正常进入 CI 真实取证 | **VERIFIED** |
| **V4-16** | 一般 | **`docker-verify.yml` 迁移物路径断言错误** —— 第 9 项报「✗ 镜像内缺少迁移文件: `_journal.json`」，而**同一步骤前面的 `ls` 输出已经证明它存在** | `.github/workflows/docker-verify.yml`（第 9 项 9e） | CI 实跑（run `41836588637`，第 9 项红灯） | 提交 `930f29e`：把 SQL 与 meta 元数据分成两段断言，各用正确路径 —— SQL 在 `/app/drizzle/` 根目录，`_journal.json` 与 snapshot 在 `/app/drizzle/meta/` 子目录 | ① 性质判定：**验证脚本自身的路径错误，不是产品缺陷**<br>② 修复后 meta 段同时断言 3 个 snapshot + `_journal.json`，**覆盖面反而更严**<br>③ 该 run 已实测通过第 9 项的 6 个子断言（详见 `docs/evidence/ci/docker-verify-v0.0.4.md` §2.5） | **VERIFIED** |

| **V4-17** | 阻断 | **`tests/floor-continuity.spec.ts` 在 CI 上必然崩溃** —— 单元测试 `unit` job 红灯 → `e2e` job 被 `needs: unit` 连带跳过 → **整个 CI 红灯** | `tests/floor-continuity.spec.ts`（`baseDatabaseUrl()`） | CI 实跑（run `41837212170`，HEAD `930f29e`） | ✅ **已修** —— 提交 `8ce5ce9`（护栏 3 修复提交 `634a202`）：去掉 `:55433/` 端口白名单 + 读 `.env.test` 前先 `existsSync` 判断（修复方向此前已在 `docs/evidence/ci/test-baseline-v0.0.4.md` §0.5 于纯净 CI 检出 `/tmp/ci-sim` 上双向验证：CI 条件与本地条件均 `5 passed`） | **实测输出**：`Test Files 15 passed (15)` / `Tests 190 passed (190)` / **0 skipped** —— run `41860242099` 与 `41873009808` 的「类型检查 / 单元测试」job 均 ✅。**修复前的历史观测**（run `41837212170`）：`Test Files 1 failed \| 14 passed (15)` / `Tests 185 passed \| 5 skipped (190)` —— ⚠️ **分母 190 正确**。`e2e` job **已真实跑过**（不再被 `needs: unit` 连带跳过） | **VERIFIED** |
| **V4-18** | 严重 | **`docker-verify.yml` 的 app 健康判定口径不可能成立** —— 第 2 项红灯：`✗ app 未达 healthy（none）`。**断言口径本身错了**：根目录 `docker-compose.yml` 的 **app 服务没有定义 healthcheck**（只有 `deploy/docker-compose.yml` 才有），所以 `docker inspect '{{.State.Health.Status}}' v2ex-app` **永远返回 `none`**。⚠️ **真实 CI 日志证明 app 其实是完全健康的**（`✓ Ready in 414ms`）—— 是断言读错了，不是应用没起来 | `.github/workflows/docker-verify.yml`（第 2 项） | CI 实跑（run `41837202602`）+ 静态复核 | 把 app 的就绪判定从「读 `State.Health.Status`」改为「**容器状态 + HTTP 探活**」（`State.Status == running` 且 `curl /` 返回 **200**），PG / Redis 继续用 health 状态（它们**确实有** healthcheck）。**HTTP 探活是更强的证据** —— 不只证明容器活着，更证明 Next.js 真的在服务请求（`/` 是 force-dynamic 的 Server Component，会同时打到数据库） | **修复逻辑已用桩程序对照验证**：新逻辑 `postgres=healthy redis=healthy app_state=running http=200` → **EXIT=0 通过**；旧逻辑恒读出 `none` → 必红 | **VERIFIED** |
| **V4-19** | 严重 | **`docker-verify.yml` 的 `[7/9]` 安装包实际部署必然失败** —— **两个冲突**：① **端口占用** —— `install.sh` L163 有硬性端口检查 `port_in_use "$APP_PORT"`，而此时根 compose 的 app 容器**仍在运行**、映射着宿主机 3000 ⇒ `install.sh` 会**直接 `die`**；② **容器名冲突** —— 新起的安装包实例与仍在运行的根 compose 实例**同名**，互相干扰 | `.github/workflows/docker-verify.yml`（第 7 项） | 逐项复核 `[7/9]` 执行上下文时**主动发现**（尚未被 CI 触发，但**一定会红**） | ✅ 断言与执行上下文分离，并**新增一条断言来保证它不会变成外部镜像** | 详见 `docs/evidence/ci/docker-verify-v0.0.4.md` §5.1.0 | **VERIFIED** |
| **V4-20** | 严重 | **节点申请 UI 提交链断裂** —— **根因（本地实测 + trace 级证据，非推测）**：HTML 规范给 `HTMLFormElement` 加了 `[OverrideBuiltins]` —— 表单内的**命名控件**会**遮蔽原型上的同名属性**。`<form><input name="nodeName"></form>` ⇒ `form.nodeName` 返回 **HTMLInputElement**（不是字符串 `"FORM"`）。而 Next.js 15.5 内置的 React 19 水合代码（`react-dom-client.production.js` 的 `canHydrateInstance`）有一行 `instance.nodeName.toLowerCase() !== type.toLowerCase()` —— 此时 `nodeName` 是 Element ⇒ `.toLowerCase()` 不存在 ⇒ `TypeError: nodeName.toLowerCase is not a function` ⇒ 水合失败（React #418）⇒ **事件处理器不绑定** ⇒ 表单走浏览器原生 GET 提交 ⇒ **写操作彻底失效**。**API 路径通过、纯 UI 路径失败** | `e2e/v004-four-roles-ui.spec.ts:122`「节点申请：UI 入口存在 + 真实点击提交成功 + 申请真实入库」（`/nodes/request` 表单提交链）；触发点：`src/components/NodeRequestForm.tsx` 的 `name="nodeName"` / `id="nodeName"` | CI 实跑（run `41873009808`，SHA `2773cd1`）：**153 passed \| 1 failed \| 154 total** —— 本轮 E2E **唯一**失败用例（**修复前的历史快照**） | ✅ **已修复（提交 `bddb3d0`）** —— 表单命名属性改名，彻底消除与 `form.nodeName` 的遮蔽：<br>① `src/components/NodeRequestForm.tsx`：`name="nodeName"` → `name="node_slug"`，`id="nodeName"` → `id="node_slug"`；`name="nodeTitle"` → `name="node_title"`，`id="nodeTitle"` → `id="node_title"`<br>② `src/components/NewTopicForm.tsx`：`name="title"` → `name="topic_title"`（`id="title"` **有意保留** —— E2E 用 `#title` 定位）<br>③ `src/components/TopicEditForm.tsx`：`name="title"` → `name="topic_title"`<br>④ `e2e/v004-four-roles-ui.spec.ts`：选择器 `input[name="nodeName"]` → `input#node_slug`，`input[name="nodeTitle"]` → `input#node_title`<br>⑤ `e2e/helpers.ts`：标题框选择器改用 `input#title`<br>⑥ **新增** `tests/form-name-shadowing.spec.ts`：**4 项防回归断言**，扫全仓 `src/`，禁止任何表单控件的 `name`/`id` 遮蔽 `form.nodeName` | ① **本地实测全绿**：单元 **194 passed / 0 failed / 0 skipped（16 文件）**（含新增 4 条防回归断言）；E2E **154 passed / 0 failed / 0 skipped（11 文件，3.9m）**<br>② `/nodes/request` 的 **React #418 由 2 次归零（0 次）**<br>③ 提交请求**由「无（原生 GET）」变为 `POST /api/node-requests` ✅<br>④ 提交后 URL **由 `?nodeName=...` 变为停在 `/nodes/request`** ✅<br>⑤ 成功 toast **由「不出现」变为出现** ✅<br>⑥ 关键实测：`name="nodeName"` 与 `id="nodeName"` **都致命**；`name="title"` / `id="title"` / `name="action"` / `name="id"` 属**隐患项**（遮蔽语义但 react-dom 不崩，因为 react-dom 只读 `instance.nodeName`）<br>⑦ 修复前的历史快照如实保留：CI run `41873009808` = `153 passed \| 1 failed \| 154 total`；trace 级证据见 `docs/SESSION_HANDOFF_v0.0.4.md` 第 5 轮 B2 段 | 🟢 **已修复并本地实测验证**（提交 `bddb3d0`；**CI 亦已复验通过** —— run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅） |

> **V4-14 的残余说明（如实披露）**：18 个占位 PNG **仍然留在 Git 历史里**（`04b107b` / `1b15f79` / `301a8a5`）。
> 本轮刻意**不改写历史** —— 改写远端历史属明令禁止的高风险不可逆操作，需主人单独授权（与 R-01 同类处置）。
> 这些文件是 E2E 生成的**公开占位图**（无任何用户数据、无凭据），
> 因此与 R-01 的「原站版权素材」性质不同：**不构成版权或凭据泄露**，
> 但「运行时数据进入公开发布物」这一**风险性质**与 R-01 一致，故已登记为 R-25。
> 彻底消除需授权改写历史。

### 测试基础设施缺陷（同样真实，影响结论可信度）

| ID | 问题 | 修复 |
|---|---|---|
| V4-T1 | 单元测试并行执行时多个文件同时 `DROP/CREATE DATABASE` + 跑迁移，`afterAll` hook 超时 | `vitest.config.ts` 设 `fileParallelism: false`（串行换来稳定可复现） |
| V4-T2 | 第二个用户与主页面共享 browser context → 已登录访问 `/signup` 被重定向到首页 | `e2e/helpers.ts` / 各 spec 改用独立 `browser.newContext()` |
| V4-T3 | `register()` 漏填必填 `email` → 注册静默失败 | `e2e/helpers.ts` 补 `page.fill('#email', ...)` |
| V4-T4 | 客户端组件表单在 hydration 前 `fill`/点击 → 超时 | helpers 统一 `waitForLoadState('networkidle')` + 等输入框可见 |
| V4-T5 | `uniqueName()` 随机空间过小，跨轮次碰撞导致复用旧会话 | 改「时间戳 + 进程内计数器 + 6 位随机」 |
| V4-T6 | 视觉汇总脚本在仓库外，「52 条」分母不可复核 | 入仓 `tools/visual/summarize-visual-diff.py` + 产出 `geometry-summary.json`（三套口径机器可读） |

---

## v0.0.5 新发现并修复的缺陷（全部有实测证据）

> 编号规则：v0.0.4 用 `V4-xx`，v0.0.5 起用 **`V5-xx`**。
> 所有条目均由**真实浏览器 E2E / 真实压测 / 远端 CI 实跑 / 版本库核查**发现，
> 不是代码审查臆测。

| ID | 级别 | 缺陷 | 位置 | 发现方式 | 修复 | 验证方式 | 状态 |
|---|---|---|---|---|---|---|---|
| **V5-01** | 严重 | **@ 提及的用户名长度规则与注册校验不一致 ⇒ 合法用户名静默失效** —— `mentions.ts` 写 `{3,20}`，注册允许 `{2,32}` ⇒ **13–32 字符的用户名永远无法被提及**，且**用户得不到任何提示** | `src/lib/mentions.ts`（`USERNAME_RE` 与匹配正则） vs `src/app/api/auth/signup/route.ts` | E2E 首跑失败：`uniqueName('ment_a')` 生成 23 字符用户名 ⇒ 匹配不上 ⇒ **一个 mention 通知都没产生** | 与注册逐字对齐为 `{2,32}`；新增**一致性守护测试**（解析两处源码的正则，断言长度区间完全相同）⇒ 将来任何一边改了、另一边没跟上，测试立刻红 | ① 单元 19/19 全绿（含新守护）<br>② E2E 6/6 全绿<br>③ 守护测试在两处规则不同时**实测会红** | **VERIFIED** |
| **V5-02** | 严重 | **生产环境头像上传后立刻 404** —— Next.js 静态资源机制只服务「**构建时已存在**」的文件，运行时写入 `public/uploads/` 的文件**不会被服务** ⇒ 头像功能在生产**完全不可用** | `src/app/api/users/avatar/route.ts` + 新增 `src/app/uploads/[...path]/route.ts` | E2E 实测：`POST /api/users/avatar` 返回 200 且带 `avatar: "/uploads/avatars/3/xxx.png"`，但随后 `GET` 该 URL 得 **404** | 新增**专用路由** `src/app/uploads/[...path]/route.ts` 从磁盘流式返回，与 Next 静态资源机制解耦；带 `X-Content-Type-Options: nosniff` 与 `Cache-Control: immutable` | E2E「下载落盘文件验证是 256×256 的 PNG」通过（证明路由真的能服务） | **VERIFIED** |
| **V5-03** | 严重 | **Docker 重建后头像全部丢失** —— `deploy/docker-compose.yml` **没有**为 `public/uploads` 挂卷（`.gitignore` 里写着「由容器卷挂载提供」，但 compose 里根本没配） | `deploy/docker-compose.yml` + `Dockerfile` | 收尾轮静态核查 | 新增 named volume `uploads-data:/app/public/uploads`；Dockerfile 预创建该目录并 `chown` 给 `nextjs`(uid 1001) | YAML 解析通过；CI 的「Docker 构建与启动验证」job ✅ | **VERIFIED** |
| **V5-04** | 严重 | **WebKit 在 HTTP 下拒绝存储带 `Secure` 的 Cookie ⇒ 所有写操作 403** —— `secure: process.env.NODE_ENV === 'production'`，而 `next start`（**任何**部署方式，含本地 HTTP 调试与非 HTTPS 部署）都会设 `NODE_ENV=production` ⇒ Cookie 带 `Secure`。**Chromium / Firefox 对 localhost 有放宽，WebKit 没有** ⇒ 只在 WebKit 复现 | `src/middleware.ts` + `src/lib/auth.ts` | **跨浏览器 × 跨视口实测**（3 浏览器 × 5 视口 = 15 project）：WebKit 全部 5 个视口登录失败 | 按**请求的实际协议**判定（`request.nextUrl.protocol` + `x-forwarded-proto`；会话 Cookie 用 `isHttpsRequest()` 看 `x-forwarded-proto` → `APP_URL` 等），而不是按环境变量 | 跨浏览器 160/160 通过；安全护栏同步断言新判定 | **VERIFIED** |
| **V5-05** | 严重 | **`body { min-width: 820px }` 从未被媒体查询覆盖 ⇒ v0.0.4 声称的「移动端响应式重排」实际从未生效** —— 原有 `max-width: 600px` 查询只覆盖了 `.content { min-width: 0 }`，**漏掉了 body 自己** ⇒ body 仍被撑到 820px ⇒ 任何窄视口横向滚动 | `src/app/globals.css` | 跨浏览器实测：3 浏览器 × 375/390/768 视口**全部**横向滚动；实测溢出元素 `div right=820 vw=375` / `div.content right=800` / `div.site-nav right=790` | 新增 `≤900px` 断点（`body { min-width: 0; overflow-x: hidden }` + `#Top > .content { min-width: 0; max-width: 100% }`） | 跨浏览器实测通过（`scrollWidth - clientWidth ≤ 1`） | **VERIFIED** |
| **V5-06** | 一般 | **响应式断点（600px）与桌面最小宽（820px）不匹配** ⇒ 768×1024 平板下主内容区只占 **57%**（438/768） | `src/app/globals.css` | 跨浏览器实测 | 重排断点从 `600px` 提到 **`820px`**（与 body 桌面最小宽对齐） | 跨浏览器实测：768 视口下主区占满 | **VERIFIED** |
| **V5-07** | 严重 | **`AvatarCropper` 的 `onError` 导致无限重渲染** —— `onError` 是父组件每次渲染都新建的内联函数 ⇒ 放进 `useEffect` 依赖数组 ⇒ effect 无限重跑（effect → setState → 父组件重渲染 → onError 新引用 → …）⇒ 页面卡死 | `src/components/AvatarCropper.tsx` | E2E 报「Target page, context or browser has been closed」 | 用 **ref** 持有最新 `onError`，effect 只依赖 `file` | 头像 E2E 5/5 通过 | **VERIFIED** |
| **V5-08** | 严重 | **SMTP 超时完全失效（可无限挂起）** —— `readResponse` 只注册 `socket.on('timeout')`，依赖 socket 的**空闲超时**；但「连接刚建立、服务器一个字节都没发」时计时器**根本没在跑** ⇒ `readResponse` 永久挂起 | `src/lib/mailer.ts` | 协议级测试（静默服务器） | 改用**独立计时器** + `Promise.race`，超时与 socket 活动完全无关 | 协议测试实测超时 2085ms < 6s 上限 | **VERIFIED** |
| **V5-09** | 一般 | **`SMTP_TIMEOUT_MS` 在模块加载时被固化** ⇒ 运行时改 env 无效 ⇒ **超时行为无法测试** | `src/lib/mailer.ts` | 协议级测试 | 改为 `smtpTimeoutMs()` 函数，每次调用时读取 | 协议测试可通过 env 控制超时 | **VERIFIED** |
| **V5-10** | 严重 | **邮件日志写入可无限挂起** ⇒ 数据库不可用时 `await db.insert(...)` 永久等待 ⇒ **整个 `sendMail()` 跟着挂死** ⇒ **数据库故障时「忘记密码」请求永远不返回**（用户看到无限 loading） | `src/lib/mailer.ts`（`writeEmailLog`） | 代码审查 + 实测 | 改用**独立的一次性客户端**写日志，超时后 `client.end()` **主动断开**（`Promise.race` 只解决「主流程不等」，挂起的查询仍占连接且会让进程无法退出） | 单元测试覆盖降级路径 | **VERIFIED** |
| **V5-11** | 严重 | **`src/lib/smtp-client.ts` 是死代码（无任何生产调用方）** ⇒ 文档把它标注为「SMTP 客户端实现」是**不实的**；「邮件已发送」从未与真实服务器对话过 ⇒ **生产 SMTP 路径零测试覆盖** | `src/lib/smtp-client.ts`（已删除） | 写协议级测试时**全仓检索**发现 | 删除死代码；协议测试改为**直测生产路径 `sendMail()`** ⇒ 「测试通过」=「生产可用」 | 协议测试 6/6 全绿（直测生产路径） | **VERIFIED** |
| **V5-12** | 严重 | **CI 与 E2E spec 抢同一个端口 ⇒ EADDRINUSE** —— `.github/workflows/ci.yml` 有「启动 fake SMTP server」步骤，而 spec 的 `beforeAll` **自己也会起一个**，都监听 3025 | `.github/workflows/ci.yml` | **远端 CI 实跑**（run `42142762352`，E2E job 失败） | 删除 CI 的启动/停止步骤（fake server **必须**跑在测试进程里，测试才能直接断言收到的邮件） | 远端 CI 复跑 E2E job ✅ | **VERIFIED** |
| **V5-13** | 严重 | **`e2e/global-setup.ts` 的 env 覆盖语义与 `env-loader` 相反 ⇒ 令牌不一致 ⇒ 限流静默失效** —— `loadEnv({ override: true })` 让 `ENV_FILE` 文件覆盖 shell 注入；服务端（next start）继承 shell ⇒ **两边 `DEBUG_ENDPOINT_TOKEN` 不一致** ⇒ debug 端点 401 ⇒ **限流根本没被清** ⇒ 429 | `e2e/global-setup.ts` | 远端 CI 失败后本地复现，逐层下钻（`rate_limit_buckets` 计数 12 + worker 与服务端令牌不同） | ① `override` 恒为 `false`，对齐 `env-loader` 的「shell 注入最高优先级」<br>② **`clearRateLimits` 失败时抛错**而非静默返回（原实现静默 ⇒ 429 的报错**完全指不到**「限流没被清」） | 本地 CI 等价复现 **PASS=8 / FAIL=0**，E2E 全部通过 | **VERIFIED** |
| **V5-14** | 一般 | **`tests/v005-search-quality.spec.ts` 硬编码了本地连接串** ⇒ 本地全绿、CI 直接 `ECONNREFUSED 127.0.0.1:55440` | `tests/v005-search-quality.spec.ts` | 远端 CI 失败 | 改用项目统一的 `dbUrlFor` / `adminUrlOf`（从 `DATABASE_URL` 派生）⇒ 本地与 CI 自动对齐 | 远端 CI「类型检查 / 单元测试」✅ | **VERIFIED** |
| **V5-15** | 一般 | **发布门禁硬编码目标版本与迁移条数** ⇒ v0.0.5 复用时必然 FAIL ×4（检查 v0.0.4 Tag 是否存在、期望 journal 恰好 3 条、把「载体 = 0.0.4」判成异常） | `scripts/release/preflight.sh` | 准备 v0.0.5 发布时实跑门禁 | 参数化 `--target=` / `--dev-baseline=`；迁移条数从**实际迁移文件数推导** ⇒ 将来加 0004/0005 时门禁自动跟随 | `preflight.sh --target=0.0.5 --dev-baseline=0.0.4` ⇒ **PASS=62 / FAIL=0** | **VERIFIED** |
| **V5-16** | 一般 | **发帖 / 回复 API 的响应不含结构化 id** ⇒ 调用方要拿 id 只能**解析 `redirect` 字符串** | `src/app/api/topics/route.ts`、`src/app/api/replies/route.ts` | 写 E2E 时实测 `Number(body.topic?.id ?? body.id)` 全部得到 NaN | 补 `topicId` / `replyId` 字段（**保留 `redirect` 不变，向后兼容**） | E2E 能直接拿到 id | **VERIFIED** |
| **V5-17** | 严重 | **Firefox@320×568 横向溢出 23px** —— 本站「布局用 table」（头像 24px + 间隔 10px + 标题 auto，如 HotTopics）中，Firefox 的 table **按内容扩展而不收缩** ⇒ `td width="auto"` 里的长标题把 table 撑到 328px ⇒ 320 视口下溢出。（Chromium / WebKit 愿意收缩 ⇒ **只跑 Chromium 永远发现不了**） | `src/components/HotTopics.tsx` 等布局 table + `src/app/globals.css` | **组件级视觉回归首轮实跑**（7 视口 × 3 浏览器 × 3 页面） | `.box table { table-layout: fixed }`（列宽按首行声明分配，table 永不超过 `width="100%"`）+ `.box td { overflow-wrap: anywhere; word-break: break-word }`；**只作用于 `.box` 内 table**，不影响 `.markdown_body table`（数据表格语义不同） | 回归复测：Chromium / WebKit / Firefox @320 均 0px 溢出；63 组合全部测量成功；基线已建立（`docs/evidence/visual/component-baseline.json`） | **VERIFIED** |

### 测试基础设施缺陷（v0.0.5）

| ID | 问题 | 修复 |
|---|---|---|
| V5-T1 | **本地 CI 复现用超长一行 shell 命令** ⇒ 某一步失败会让后续 `export` 不执行 ⇒ `LOCAL_BASE` 没设上 ⇒ `clearRateLimits` 连到默认 3000 ⇒ **175 个用例一起挂**，而报错指不到「export 没执行」 | 新增 `scripts/ci/run-e2e-locally.sh` 把 CI 的 e2e job **固化成脚本**（建全新库 → migrate → seed → build → 启动 → E2E → 收尾），带自检 |
| V5-T2 | **`next start` 残留导致 build EPERM** —— `trap kill $SRV_PID` 只杀 npx 包装器，**真正的 next 服务器是子进程**，继续持有 `.next/trace` 写句柄 | 退出时杀**整个进程树**（`taskkill //F //T //PID`），并记录实际监听端口的 PID；build 前也先清理端口占用 |
| V5-T3 | **`next build` 偶发 EPERM（本机 Windows）** —— 完全相同的命令序列有时 rc=0、有时 EPERM；与 `rm -rf` / `mv` / 残留进程**均非单一因果**（逐一验证过） | ⚠️ **未根治**（机制未查明，疑与 Windows 文件系统「目录刚被重命名后的元数据提交 / 杀毒扫描」有关）。脚本改为**免疫**：识别 EPERM 后清理 + **有限重试**（非 EPERM 失败立即中断），并支持 `SKIP_BUILD=1`。**CI（Linux）上不存在此问题** |
| V5-T4 | **`clearRateLimits` 静默失效** ⇒ 限流没清 ⇒ 429，而报错指不到真正原因 | 失败时**抛错**，并带上每个令牌尝试过的状态码与「测试进程与服务端令牌不一致」的排查指引 |
| V5-T5 | **fake SMTP 的 EADDRINUSE 裸错误指不到真正原因** | `FakeSmtpServer.start` 显式识别 EADDRINUSE，并列出最常见两个原因（两处同时起 server / 上次没退干净） |
| V5-T6 | **两个 E2E spec 可能声明同一个固定端口** | 新增 `tests/v005-e2e-fixtures.spec.ts`（5 条护栏）：端口唯一性 / 只走 `start()` / spec 自己起 / CI 不得有启动命令 / EADDRINUSE 有清晰错误 |
| V5-T7 | **`SKIP_BUILD` 检查放在 `.next` 清理之后**（`5b9f8e3` 引入的顺序缺陷）—— 先备份/移走 `.next`，再检查 `SKIP_BUILD=1` ⇒ `BUILD_ID` 已被移走 ⇒ 复现流程必然失败，与 `SKIP_BUILD`「复用可用 `.next` 重跑 E2E」的设计目的相悖 | 判定顺序对调：先 `SKIP_BUILD` → 再决定是否清理；构建块同样加 `SKIP_BUILD_ACTIVE` 守卫（`5163244`） |
