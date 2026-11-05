# 缺陷登记表（BUG_REGISTER）

> 项目：V2EX Clone
> 本轮：全项目缺陷清零与安全加固（v0.0.2）
> **v0.0.4 补充登记见文末「v0.0.4 新发现并修复的缺陷」小节**
> 建表时间：2026-11-04
> 维护者：代码审计负责人（主理人）
>
> ⚠️ **测试数字口径声明（v0.0.4 收尾轮）**：**v0.0.4 的权威基线是 190 条 / 15 个文件 /
> 190 passed / 0 failed / 0 skipped**（本机连续 4 轮实测）。
>
> 本文中出现的 **185** 有**两个不同来源**，含义不同，不可混用：
> ① **v0.0.3 历史总数**（CI run `41760677505`，master @ `37710fb4`，14 个 spec 文件，`185 passed (185)`）；
> ② **修复前的历史观测**（run `41837212170`，HEAD `930f29e`，`185 passed | 5 skipped (190)` —— ⚠️ **分母仍是 190**，
> 5 条因 `floor-continuity` 在 CI 崩溃而跳过，见 **V4-17**）。
> **该红灯已由 `8ce5ce9` 修复**，run `41860242099` 与 `41873009808` 的「类型检查 / 单元测试」job 均已 ✅
> （vitest 15 文件全过、`190 passed / 0 skipped`）；**历史数字保留不改写**，但已逐处标注其来源。
>
> 无论哪种，**v0.0.4 的用例总数始终是 190**。口径裁决见 `TEST_REPORT.md` 文首「185 vs 190 裁决」小节
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
| V3-13 | **5 个生产依赖完全未被引用**（jose/dompurify/bcryptjs/nanoid/zod）—— 白白扩大供应链攻击面 | `package.json` | `0b93eca` | 全仓库搜索 0 引用；移除后 tsc 0 错误、vitest **185/185**（**v0.0.3 历史总数**，master @ `37710fb4`；v0.0.4 权威基线为 190/190） | **VERIFIED** |
| V3-14 | **生产镜像整包 COPY node_modules**（530MB，含 devDeps 与 esbuild 0.18.20 漏洞版本） | `Dockerfile` | `19750b9` | `npm ci --omit=dev` 后 73 包 / 429MB；entrypoint 三个必需路径全部存在 | **VERIFIED** |
| V3-15 | **`publish-release`/`verify-release` 无 dry_run 闸门** —— 勾选「仅验证」仍会真的发 Release | `.github/workflows/release.yml` | devops 修复 | 全链路语义核查：两个 job 均有 `if: needs.preflight.outputs.dry_run != 'true'` | **VERIFIED** |
| V3-16 | **发布 tag 触发器为 `'v*'`** —— 任何能推 tag 的人可触发带写权限的流水线 | 同上 | devops 修复 | 触发器已为显式白名单 | **VERIFIED** |
| V3-17 | **action 版本仍为 node20 线** —— GitHub 已移除 node20 运行时，会在启动阶段直接失败 | `.github/workflows/{ci,release}.yml` | devops 修复 | 全部升级到 node24 版本线，CI 实跑通过 | **VERIFIED** |
| V3-18 | **`listReplies` 未过滤软删除的回复** —— 已删除内容会通过普通页面泄露 | `src/server/queries.ts` | `e4a89ec` | 软删除主题：未登录与普通用户访问均 **404** | **VERIFIED** |
| V3-19 | **`.fa` 图标类被设为 `float:left`** —— 与原站 `combo.css` 的 `inline-block` 不一致，破坏 FontAwesome 字体的基线与行高 | `src/app/globals.css` | `0313959` | 与原站 combo.css 逐条比对 | **VERIFIED** |
| V3-20 | **零 `@media` 断点** —— 375px 视口下 `.content` 的 `min-width:600px` 导致横向滚动，移动端不可用 | `src/app/globals.css` | `0313959` | 三视口几何量测；375 视口本地不再溢出 | **VERIFIED** |
| V3-21 | **窄屏下 `#Rightbar` 浮动挤偏 `#Main`** —— 实测 Δx=100px | `src/app/globals.css` | `0313959` | 改用 flex `order` 后置；375 视口 Δy 从 928 降到 20 | **VERIFIED** |
| V3-22 | **迁移脚本无幂等保护** —— `CREATE TYPE`/`ADD CONSTRAINT` 重跑即失败 | `drizzle/0001_striped_magdalene.sql` | `b4c0a12` | 连续应用 3 次全部 exit=0，26 表 / 38 约束 | **VERIFIED** |
| V3-23 | **测试与 `@/db` 全局连接池库不一致** —— 服务层写 A 库、断言读 B 库，外键约束失败 | 5 个 v0.0.3 测试文件 | `0ae8c08` | 修正后 185/185 全绿（**v0.0.3 历史总数**，master @ `37710fb4`；v0.0.4 权威基线为 190/190） | **VERIFIED** |
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
> | V4-20 | 严重 | 节点申请 UI 提交链断裂（**本轮唯一红灯，修复中**） |

| ID | 级别 | 缺陷 | 位置 | 发现方式 | 修复 | 验证方式 | 状态 |
|---|---|---|---|---|---|---|---|
| **V4-14** | 严重 | **运行时上传数据被误提交入仓** —— E2E 跑出的 18 个头像占位 PNG（每个 684 字节）被 Git 跟踪，成为公开发布物的一部分。**风险性质与 R-01 同类**（运行时数据进入公开发布物） | `public/uploads/avatars/*`（18 个 `.png`） | 版本库卫生核查（`git log --numstat -- public/uploads/*`） | 提交 `49d66d3`：① `.gitignore` 增加 `public/uploads/` 规则（含背景说明注释）；② `git rm --cached` 把 18 个文件移出索引。**刻意不改写 Git 历史、不删除磁盘文件** | ① `git ls-files "public/uploads/*"` → **0 条**（已移出索引）<br>② `.gitignore` 含 `public/uploads/` 规则<br>③ 引入提交逐一定位：`04b107b`（16 个）、`1b15f79`（1 个）、`301a8a5`（1 个），合计 **18 个**唯一路径 | **VERIFIED** |
| **V4-15** | 严重 | **`docker-verify.yml` 定义级失败** —— 工作流在**定义阶段**就失败，**一个 job 都没被创建**。症状：run 0 秒结束、`total_count=0`、报错仅一句「This run likely failed because of a workflow file issue」 | `.github/workflows/docker-verify.yml`（证据汇总步骤） | CI 实跑（run `41836244258`） | 提交 `2532f5f`：把三元判断从 GitHub 表达式上下文**下沉到 shell 层** —— `${{ job.status == 'success' && echo PASS \|\| echo '见日志' }}` → `$([ "${{ job.status }}" = 'success' ] && echo PASS \|\| echo FAIL)`；`${{ }}` 只用于传值 | ① 根因实测：GitHub Actions 表达式上下文**不支持 `&&`/`\|\|` 三元**（`\|\|` 取默认值支持，三元不支持）<br>② **陷阱**：YAML 本身能正常解析（python yaml 校验通过，1 job / 17 steps），问题只在表达式求值阶段 —— 这是排查耗时的主因<br>③ 全仓库复核：`ci.yml` / `install-verify.yml` / `release.yml` 其余表达式均为合法写法（`release.yml` 的 `${{ inputs.publish \|\| 'false' }}` 是 `\|\|` 取默认值，合法且历史跑通过）<br>④ 修复后 R-16 / R-17 的验证可正常进入 CI 真实取证 | **VERIFIED** |
| **V4-16** | 一般 | **`docker-verify.yml` 迁移物路径断言错误** —— 第 9 项报「✗ 镜像内缺少迁移文件: `_journal.json`」，而**同一步骤前面的 `ls` 输出已经证明它存在** | `.github/workflows/docker-verify.yml`（第 9 项 9e） | CI 实跑（run `41836588637`，第 9 项红灯） | 提交 `930f29e`：把 SQL 与 meta 元数据分成两段断言，各用正确路径 —— SQL 在 `/app/drizzle/` 根目录，`_journal.json` 与 snapshot 在 `/app/drizzle/meta/` 子目录 | ① 性质判定：**验证脚本自身的路径错误，不是产品缺陷**<br>② 修复后 meta 段同时断言 3 个 snapshot + `_journal.json`，**覆盖面反而更严**<br>③ 该 run 已实测通过第 9 项的 6 个子断言（详见 `docs/evidence/ci/docker-verify-v0.0.4.md` §2.5） | **VERIFIED** |

| **V4-17** | 阻断 | **`tests/floor-continuity.spec.ts` 在 CI 上必然崩溃** —— 单元测试 `unit` job 红灯 → `e2e` job 被 `needs: unit` 连带跳过 → **整个 CI 红灯** | `tests/floor-continuity.spec.ts`（`baseDatabaseUrl()`） | CI 实跑（run `41837212170`，HEAD `930f29e`） | ✅ **已修** —— 提交 `8ce5ce9`（护栏 3 修复提交 `634a202`）：去掉 `:55433/` 端口白名单 + 读 `.env.test` 前先 `existsSync` 判断（修复方向此前已在 `docs/evidence/ci/test-baseline-v0.0.4.md` §0.5 于纯净 CI 检出 `/tmp/ci-sim` 上双向验证：CI 条件与本地条件均 `5 passed`） | **实测输出**：`Test Files 15 passed (15)` / `Tests 190 passed (190)` / **0 skipped** —— run `41860242099` 与 `41873009808` 的「类型检查 / 单元测试」job 均 ✅。**修复前的历史观测**（run `41837212170`）：`Test Files 1 failed \| 14 passed (15)` / `Tests 185 passed \| 5 skipped (190)` —— ⚠️ **分母 190 正确**。`e2e` job **已真实跑过**（不再被 `needs: unit` 连带跳过） | **VERIFIED** |
| **V4-18** | 严重 | **`docker-verify.yml` 的 app 健康判定口径不可能成立** —— 第 2 项红灯：`✗ app 未达 healthy（none）`。**断言口径本身错了**：根目录 `docker-compose.yml` 的 **app 服务没有定义 healthcheck**（只有 `deploy/docker-compose.yml` 才有），所以 `docker inspect '{{.State.Health.Status}}' v2ex-app` **永远返回 `none`**。⚠️ **真实 CI 日志证明 app 其实是完全健康的**（`✓ Ready in 414ms`）—— 是断言读错了，不是应用没起来 | `.github/workflows/docker-verify.yml`（第 2 项） | CI 实跑（run `41837202602`）+ 静态复核 | 把 app 的就绪判定从「读 `State.Health.Status`」改为「**容器状态 + HTTP 探活**」（`State.Status == running` 且 `curl /` 返回 **200**），PG / Redis 继续用 health 状态（它们**确实有** healthcheck）。**HTTP 探活是更强的证据** —— 不只证明容器活着，更证明 Next.js 真的在服务请求（`/` 是 force-dynamic 的 Server Component，会同时打到数据库） | **修复逻辑已用桩程序对照验证**：新逻辑 `postgres=healthy redis=healthy app_state=running http=200` → **EXIT=0 通过**；旧逻辑恒读出 `none` → 必红 | **VERIFIED** |
| **V4-19** | 严重 | **`docker-verify.yml` 的 `[7/9]` 安装包实际部署必然失败** —— **两个冲突**：① **端口占用** —— `install.sh` L163 有硬性端口检查 `port_in_use "$APP_PORT"`，而此时根 compose 的 app 容器**仍在运行**、映射着宿主机 3000 ⇒ `install.sh` 会**直接 `die`**；② **容器名冲突** —— 新起的安装包实例与仍在运行的根 compose 实例**同名**，互相干扰 | `.github/workflows/docker-verify.yml`（第 7 项） | 逐项复核 `[7/9]` 执行上下文时**主动发现**（尚未被 CI 触发，但**一定会红**） | ✅ 断言与执行上下文分离，并**新增一条断言来保证它不会变成外部镜像** | 详见 `docs/evidence/ci/docker-verify-v0.0.4.md` §5.1.0 | **VERIFIED** |
| **V4-20** | 严重 | **节点申请 UI 提交链断裂** —— 生产构建下 React #418 hydration 不匹配 → react-dom `nodeName.toLowerCase is not a function` 崩溃 → **表单 `onSubmit` 从未执行**。**API 路径通过、纯 UI 路径失败** | `e2e/v004-four-roles-ui.spec.ts:122`「节点申请：UI 入口存在 + 真实点击提交成功 + 申请真实入库」（`/nodes/request` 表单提交链） | CI 实跑（run `41873009808`，SHA `2773cd1`）：**153 passed \| 1 failed \| 154 total** —— 本轮 E2E **唯一**失败用例 | 🔧 **修复中** —— 已移交 UI 工程师（`ed385cf` 引入的节点申请入口是本链路的触发点） | ① 浏览器原生表单 GET 提交被触发（trace 实证 URL：`/nodes/request?nodeName=...&nodeTitle=...&description=...`），整个 trace **无任何** `POST /api/node-requests` —— React `onSubmit` 从未执行<br>② 点击过程中抛出未捕获 `TypeError: nodeName.toLowerCase is not a function`（react-dom 的 hydration 遍历函数 `canHydrateInstance`）<br>③ 另一实例：`Minified React error #418`（hydration 不匹配）在首页 `/` 触发<br>④ 失败瞬间截图：表单空、按钮回 disabled、无 toast<br>**trace 级证据见 `docs/SESSION_HANDOFF_v0.0.4.md` 第 5 轮 B2 段** | 🔴 **未修复（修复中）** |

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
