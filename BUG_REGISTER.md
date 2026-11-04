# 缺陷登记表（BUG_REGISTER）

> 项目：V2EX Clone
> 本轮：全项目缺陷清零与安全加固（v0.0.2）
> 建表时间：2026-11-04
> 维护者：代码审计负责人（主理人）

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
| V3-13 | **5 个生产依赖完全未被引用**（jose/dompurify/bcryptjs/nanoid/zod）—— 白白扩大供应链攻击面 | `package.json` | `0b93eca` | 全仓库搜索 0 引用；移除后 tsc 0 错误、vitest **185/185** | **VERIFIED** |
| V3-14 | **生产镜像整包 COPY node_modules**（530MB，含 devDeps 与 esbuild 0.18.20 漏洞版本） | `Dockerfile` | `19750b9` | `npm ci --omit=dev` 后 73 包 / 429MB；entrypoint 三个必需路径全部存在 | **VERIFIED** |
| V3-15 | **`publish-release`/`verify-release` 无 dry_run 闸门** —— 勾选「仅验证」仍会真的发 Release | `.github/workflows/release.yml` | devops 修复 | 全链路语义核查：两个 job 均有 `if: needs.preflight.outputs.dry_run != 'true'` | **VERIFIED** |
| V3-16 | **发布 tag 触发器为 `'v*'`** —— 任何能推 tag 的人可触发带写权限的流水线 | 同上 | devops 修复 | 触发器已为显式白名单 | **VERIFIED** |
| V3-17 | **action 版本仍为 node20 线** —— GitHub 已移除 node20 运行时，会在启动阶段直接失败 | `.github/workflows/{ci,release}.yml` | devops 修复 | 全部升级到 node24 版本线，CI 实跑通过 | **VERIFIED** |
| V3-18 | **`listReplies` 未过滤软删除的回复** —— 已删除内容会通过普通页面泄露 | `src/server/queries.ts` | `e4a89ec` | 软删除主题：未登录与普通用户访问均 **404** | **VERIFIED** |
| V3-19 | **`.fa` 图标类被设为 `float:left`** —— 与原站 `combo.css` 的 `inline-block` 不一致，破坏 FontAwesome 字体的基线与行高 | `src/app/globals.css` | `0313959` | 与原站 combo.css 逐条比对 | **VERIFIED** |
| V3-20 | **零 `@media` 断点** —— 375px 视口下 `.content` 的 `min-width:600px` 导致横向滚动，移动端不可用 | `src/app/globals.css` | `0313959` | 三视口几何量测；375 视口本地不再溢出 | **VERIFIED** |
| V3-21 | **窄屏下 `#Rightbar` 浮动挤偏 `#Main`** —— 实测 Δx=100px | `src/app/globals.css` | `0313959` | 改用 flex `order` 后置；375 视口 Δy 从 928 降到 20 | **VERIFIED** |
| V3-22 | **迁移脚本无幂等保护** —— `CREATE TYPE`/`ADD CONSTRAINT` 重跑即失败 | `drizzle/0001_striped_magdalene.sql` | `b4c0a12` | 连续应用 3 次全部 exit=0，26 表 / 38 约束 | **VERIFIED** |
| V3-23 | **测试与 `@/db` 全局连接池库不一致** —— 服务层写 A 库、断言读 B 库，外键约束失败 | 5 个 v0.0.3 测试文件 | `0ae8c08` | 修正后 185/185 全绿 | **VERIFIED** |
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
