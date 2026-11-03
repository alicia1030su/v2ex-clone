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
| P0-03 | 原站 HTML/CSS/JS 副本、参考截图与差异热力图在 **全部远端引用**（master、fix/p0-review-hardening、**v0.0.1 tag**、refs/pull/1/head）中均**可达**，匿名可经 raw.githubusercontent.com 取回（实测 `combo.js` HTTP 200） | Git 历史 `75c9508` | `curl https://raw.githubusercontent.com/alicia1030su/v2ex-clone/75c9508.../combo.js` → 200 | — | 量化：master A=44/B=40/C=10；v0.0.1 A=45/B=40/C=10 | **需主人单独授权**（改写历史 / 移动 tag 均被明令禁止） | **DEFERRED** |
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

## 并行审计发现（由 backend-engineer / data-engineer / devops-engineer 补充）

> 本表由并行审计回传后填入。审计仍在进行中。

（待回传）
