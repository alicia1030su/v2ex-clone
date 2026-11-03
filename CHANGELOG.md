# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 版本号从 `0.0.1` 起，采用 `0.MINOR.PATCH` 形式：
> `0.0.x` 全部为**早期开发预览版**，不承诺 API 稳定性，不建议用于生产环境。

本文件只记录**本项目实际做过的事**。凡是未实现的功能，一律列在「不包含」小节，
不以任何形式（包括占位按钮、静态演示数据）冒充已实现。

## [0.0.2] - 2026-11-04

> 早期开发预览版（Pre-release）。功能尚未完备，**不建议用于生产环境**。
> 界面与原站存在差异，**不保证与 V2EX 完全一致**。
>
> **本小节只记录「供应链 / CI/CD / 容器 / 文档」四个方面本轮实际做过的事。**
> 应用层（业务逻辑、接口、界面）的变更由对应负责人另行补充 ——
> 本节**不代为声明**，以免夸大。

### 供应链

- **修复** 4 个 moderate 依赖漏洞（`npm audit` 由 4 降为 **0**）：
  `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild@0.18.20`
  （GHSA-67mh-4wv8-2f99，「esbuild 开发服务器可被任意网站跨域读取响应」）。
  通过 `overrides` 把 `@esbuild-kit/core-utils` 下的 esbuild 钉到 `^0.25.0`，
  实际解析为 **0.25.12**（受影响范围 `<=0.24.2`）。
- **未降低扫描等级**：发布流水线的漏洞门禁（critical / high 即中止发布）**一个字未改**；
  漏洞数是**降下来的**，不是被藏起来的。
- 修复后**迁移能力实测未损坏**：`drizzle-kit generate` 与 `drizzle-kit migrate` 均成功，
  `tsc --noEmit` 0 错误，`vitest` **103/103** 全绿，`next build` 成功。
- 补充证据：该漏洞路径在生产**结构性不可达** ——
  `drizzle-kit` 虽声明了 `@esbuild-kit/esm-loader` 依赖，但**从不 import 它**；
  它实际加载的是 `drizzle-kit/node_modules/esbuild`（0.25.12，本就安全）。

### 容器与部署

- **修复** 生产镜像携带全部 devDependencies 的问题：
  Dockerfile 的运行层此前 `COPY --from=builder /app/node_modules`，把含
  `@playwright/test`、`vitest`、`typescript`、`@types/*` 的**完整** `node_modules`
  （本机实测 530 MB）打进了生产镜像 —— 同时把漏洞版 esbuild 也一起带了出去。
  现改为在运行层执行 `npm ci --omit=dev`，按依赖图只装生产依赖。
- 为此把 `drizzle-kit` 与 `tsx` 从 `devDependencies` **上移到 `dependencies`** ——
  它们不是测试工具，而是容器 entrypoint 的**真实运行时依赖**
  （阶段 1 迁移、阶段 2 首次初始化分别直接调用它们）。
  实测 `npm ci --omit=dev` 后 `drizzle-kit/bin.cjs`、`tsx/dist/cli.mjs`、
  `next/dist/bin/next` 三个路径均存在。
- **修复** `playwright-core`（14 MB）仍进生产镜像的问题。
  根因是 `next@15.5.28` 把 `@playwright/test` 声明为 `peerOptional`，
  npm 会自动安装 optional peer —— `--omit=dev` 裁不掉，
  `--omit=peer` 也**无效**（实测仍装 73 包 / 429 MB）。
  改为安装后显式删除，并加**防回归护栏**：删除后断言三个 entrypoint
  路径仍在，否则**构建当场失败**（而不是等容器启动时才炸）。
  依据：实测 next 的运行时代码（`dist/server/**`）**零处**引用 playwright，
  仅 `next test` / `experimental-test` 引用 —— 本项目不使用这些路径。
- **实测验证裁剪后的生产依赖闭包真的能跑**（无需 Docker）：
  - `npm audit --omit=dev --audit-level=moderate` → **found 0 vulnerabilities**
  - 依赖体积 429 MB →（删 playwright 后）**411 MB**
  - 裁剪后 `next build` ✓ Compiled successfully
  - 裁剪后 `next start` + 真实数据库：`/` `/signin` `/signup` `/nodes`
    `/api/captcha` `/t/1` **全部 200**，日志 `MODULE_NOT_FOUND` 计数 **0**
  - 裁剪后 `drizzle-kit migrate` ✓ 18 张表；`tsx` 跑 seed ✓ 完成
  - 漏洞版 esbuild 0.18.20 **已不在**生产依赖闭包内（解析为 0.25.12）
- 生产镜像**不含**原站版权素材、`.env`、凭据文件 —— 由发布流水线的
  「核验镜像不含敏感文件」步骤在真实镜像上 `docker run` 实测。

### CI/CD

- **修复** `ci.yml` 全部 action 使用 node20 版本、会在启动阶段直接失败的问题。
  GitHub 已于 2026-09-23 移除 runner 的 Node 20 运行时，且
  `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` 退避开关同时失效。
  `ci.yml` 的 `actions/checkout@v4` / `setup-node@v4` / `upload-artifact@v4`
  已全部升级到 node24 版本（`@v7`）—— 与 `release.yml` 对齐。
- **修复** 发布流水线的 `dry_run` 开关**从未生效**的问题。
  该开关此前被声明、被输出、被打印，但**没有被任何 `if:` 消费**，
  导致手动触发时勾选「仅验证」依然会推送镜像并创建 Release。
  现已让 `dry_run=true` 真正做到：不登录 GHCR、不推送镜像、
  跳过 `publish-release` 与 `verify-release`；同时镜像经 artifact 传给
  `deploy-verify`，保证「只验证」仍能跑真实镜像。
- **收紧** 发布触发条件：`push` tag 的通配由 `v*` 改为**显式白名单**。
  理由：`v*` 会把任意形如 `vX.Y.Z` 的 tag 都变成发布触发器，
  而发布流水线带 `packages:write` 与 `contents:write`。
  当前白名单为 `v0.0.2` —— 每次发版需手动加入新版本号，这是**刻意的摩擦**。
- 审计结论（**无改动**）：两个 workflow 均**无** `pull_request_target`、
  **无** `workflow_run`；`release.yml` **无** `pull_request` 触发器 ——
  **未经审查的 PR 代码无法触及任何写权限 job**。
  顶层权限为 `contents: read`，仅 `build-image`（`packages: write`）
  与 `publish-release`（`contents: write`）按需提升。

### 文档

- 新增 [`docs/UPGRADE-v0.0.2.md`](docs/UPGRADE-v0.0.2.md) ——
  v0.0.1 → v0.0.2 的升级步骤、验证清单、回滚说明、已知问题。
- 新增 [`docs/RELEASE_GATE_v0.0.2.md`](docs/RELEASE_GATE_v0.0.2.md) ——
  v0.0.2 的发布门槛检查单（缺陷 / 供应链 / CI 权限 / 产物 / 部署 / 安装 / 合规 / 密钥 / 文档）。
- 新增 [`docs/SECURITY_EXCEPTIONS.md`](docs/SECURITY_EXCEPTIONS.md) ——
  已评估并接受的风险例外登记表，每条含可复核证据与**到期日**。
- 更新 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) ——
  镜像地址更新为 `ghcr.io/alicia1030su/v2ex-clone:v0.0.2`；
  新增「GHCR 可见性说明」小节（public 包可匿名拉取；
  `denied` 的三种处理方式）；回滚小节补充「**tag 不可移动，已发布版本一律不覆盖**」；
  已知限制新增 3 条（生产镜像不含测试工具链 / 镜像体积与非 root 本机未实测 /
  Windows 只有 `install.ps1`）。
- 发行包版本号统一更新为 `0.0.2`（`deploy/VERSION`、`deploy/.env.example`
  的 `V2EX_IMAGE`、`deploy/docker-compose.yml` 的镜像默认值，
  以及 `install.sh` / `install.ps1` / `update.sh` 等脚本内的默认值）。

### 已知限制

本节**只列本轮新增或变化了的限制**；v0.0.1 已有的限制见下方 v0.0.1 小节。

- **生产镜像不再包含测试工具链** —— 若曾在生产容器里跑 `npx vitest` / `npx playwright`，
  现在会报「找不到模块」。这是**预期行为**，测试应在源码仓库或 CI 里跑。
- **镜像体积与非 root 运行的实测未能在本机完成** —— 开发环境没有 Docker。
  由 CI 的 `docker` job 与发布流水线在真实 Docker 环境验证；
  见 `docs/SECURITY_EXCEPTIONS.md` E-05。
- **Windows 发行包只有 `install.ps1`** —— `backup.sh` / `restore.sh` / `update.sh` /
  `start.sh` / `stop.sh` 均无 `.ps1` 对应版本，Windows 用户需按
  `docs/UPGRADE-v0.0.2.md` §3.2 / §5.4 的手工步骤操作。
- **Git 历史中的原站版权素材仍未清理** —— 本轮**未执行**（需单独授权改写历史或移动 tag）。
  详见 `docs/SECURITY_EXCEPTIONS.md` E-02 与 `RISK_REGISTER.md` R-01。

### 不包含

- 本轮**未**引入任何新的用户可见功能。
- 本轮**未**新增数据库迁移 —— v0.0.2 的数据库结构与 v0.0.1 相同。
- 本轮**未**接入任何大模型 API，因此**不存在** API Key 轮换与配额告警的运维负担。
  （若将来接入，必须先补齐密钥托管位置、轮换周期与配额告警阈值。）
- 本轮**未**执行任何远端写操作（未 push、未创建 tag、未创建 Release、未运行远程 workflow）——
  这些由仓库主人执行。

## [0.0.1] - 2026-11-03

> 早期开发预览版（Pre-release）。功能尚未完备，**不建议用于生产环境**。
> 界面与原站存在差异，**不保证与 V2EX 完全一致**。

### 新增

**账号体系**

- 注册、登录、退出、会话保持、修改密码全链路打通。
- 用户名唯一性由数据库唯一索引在 `lower(username)` 上强制，大小写不敏感。
- 账号状态分级（`active` / `suspended` / `banned`），登录时校验，被封禁账号返回 403。
- 服务端生成 SVG 验证码（320×80）：答案只存哈希、字段名哈希化、一次性消费。
- 用户个人主页（`/member/[username]`）。

**内容体系**

- 节点（分类）：节点列表、节点详情、子节点树、节点创建（管理员直生效 / 版主进待审）、节点审核、节点收藏。
- 主题：发布、列表（首页 / 节点页）、详情、浏览计数、Markdown 渲染。
- 回复：发布、楼层号分配、回复计数同步、分页；主题锁定时拒绝回复。
- 收藏：主题与节点两类独立收藏语义，支持取消收藏，收藏列表页 `/bookmarks`。
- 通知：回复通知自动生成、未读计数、通知列表页 `/notifications`。
- 搜索：顶栏 AJAX 联想建议、搜索结果页，支持主题 / 节点 / 会员三类检索。

**管理与权限**

- 三级角色体系：`user` / `moderator` / `admin`，操作级权限校验。
- 基础后台管理：`/admin` 概览、待审节点列表、操作日志（`moderation_logs`）。
- 运维 CLI（`npm run admin`）：`set-password` / `set-role` / `list-admins`，
  需 `ADMIN_CLI_TOKEN` 授权、`--reason` 必填、写入审计日志、拒绝降级最后一个管理员。

**数据与基础设施**

- PostgreSQL 17 持久化，18 张表，Drizzle ORM 迁移（`drizzle-kit migrate`）。
- Redis 7 可选接入；**未配置 Redis 时自动降级到 PostgreSQL**（语义等价，性能略低）。
- 键值抽象层（`src/lib/kv.ts`）统一 `get / set / del / incrWindow / clearAll`，
  Redis 与 PostgreSQL 两种实现行为一致。
- Docker 多阶段镜像（deps → builder → runner）+ Docker Compose 编排。
- 容器启动**三阶段分离**：迁移 → 首次初始化 → 启动应用（`scripts/docker-entrypoint.sh`）。
- PostgreSQL 与 Redis 配置 healthcheck，app 服务等待两者健康后再启动。
- Compose 默认**不向宿主机暴露**数据库与缓存端口，仅在内部网络可达。
- GitHub Actions CI 三个 job：类型检查 / 单元测试、E2E、Docker 镜像构建与启动验证。

**文档**

- 新增安装手册 `docs/INSTALL.md`、部署手册 `docs/DEPLOYMENT.md`、发布检查清单 `docs/RELEASE_CHECKLIST.md`。
- 新增本文件 `CHANGELOG.md`。

### 修复

- **seed 覆盖已有账号口令**：seed 改为「只初始化、不修改」，账号已存在时不覆盖其口令与角色；
  首次初始化由 `kv_store` 中的初始化标记守卫，重启与重新部署不再重置管理员口令、不再重复写入演示数据。
- **Docker 镜像构建失败**：数据库连接池改为惰性初始化并始终缓存在 `globalThis`，
  构建期不再需要数据库连接；同时修正 Dockerfile 的拷贝清单（补入 `src/db`，修复容器启动时 seed 崩溃）。
- **楼层号计数器漂移**：新增 `allocateFloor` 自愈逻辑，计数器与实际楼层不一致时自动重建，
  修复并发回复下楼层号重复导致回复接口 500 的问题。
- **配置 Redis 时「清空限流」静默失效**：限流计数器随实现存放在 Redis 或 PostgreSQL，
  原实现只清数据库表，导致配了 Redis 时清空操作静默无效（端点返回 200 但配额未清）；
  KV 抽象新增 `clearAll`，两种后端都能真正清空。
- **verify.sh 跨平台化**：移除写死的本机 Windows 路径，数据库操作统一走 Node 脚本
  （不再依赖 `psql` / `pg_dump` 命令行工具），进程管理区分 Windows（`taskkill`）与 POSIX（`kill`）。
- **verify.sh 端口匹配错误**：`netstat` 输出中端口后跟空白再跟状态列，原匹配模式 `":$PORT"`
  会误匹配 `:30301` 之类的端口，导致残留旧服务占端口、E2E 打到连着别的数据库的旧实例；
  已修正为 `":${PORT}[[:space:]]"` 并增加端口就绪断言。
- **`.gitignore` 规则未命中视口子目录**：gitignore 的 `*` 不跨越目录分隔符，
  原规则 `docs/evidence/screenshots/ref-*.png` 从未生效，30 张原站参考截图一直被 Git 跟踪；
  改为 `docs/evidence/screenshots/**/ref-*.png` 后才真正覆盖任意深度的视口子目录。
- **CI 限流参数被调高**：为「让测试跑快点」而调高限流阈值会导致限流用例永远等不到 429；
  已改回与生产一致的默认值，限流覆盖恢复正常。

### 安全

- **CSRF 防护**：显式双提交 Cookie 模式 —— 服务端下发 `v2_csrf` Cookie，
  页面把同一 token 注入表单隐藏字段 / 请求头，写操作时用 `timingSafeEqual` 比对。
- **XSS 清洗**：正文渲染前经 `sanitize-html` 白名单过滤（标签、属性、协议、样式），
  拒绝 `javascript:` 协议与 `data:image/svg+xml`，移除 `on*` 事件处理器，
  外链自动补 `rel="noopener noreferrer"`。
- **开放跳转防护**：`sanitizeRedirect` 仅允许站内相对路径，拒绝外部绝对 URL 与协议相对 URL。
- **安全响应头**：`X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy`。
- **密码哈希**：scrypt + 随机 salt，不存储明文，不使用 bcryptjs 之外的弱方案。
- **会话安全**：服务端 session 表 + HttpOnly / SameSite=Lax Cookie。
- **限流**：登录、注册、发帖、回复、建节点均有限流；
  登录与注册按「IP + 账号名」双维度计数，Redis 缺失时降级到 PostgreSQL，限流不会因缺 Redis 而失效。
- **验证码哈希化一次性**：答案与字段名均只存哈希，校验后立即作废，服务端不保存明文答案。
- **数据库端口默认不暴露**：Compose 中 PostgreSQL / Redis 仅在内部网络可达。
- **运行时开关收敛**：`DISABLE_CAPTCHA` 仅在 `APP_RUNTIME_ENV=test` 且 `TEST_ENV_ISOLATED=1` 的
  隔离测试环境生效，生产与预发环境即使误配也强制启用验证码。
- **调试端点鉴权**：`/api/debug/*` 需显式开关 + `DEBUG_ENDPOINT_TOKEN` 令牌（恒定时间比较），
  未配置令牌时一律返回 404。
- **管理员口令强度**：生产环境必须显式设置 `SEED_ADMIN_PASSWORD`（≥12 位），否则 seed 直接报错退出，
  不接受任何弱默认口令。
- **示例配置无凭据**：`.env.example` 不提供任何可用的默认口令，Compose 中必需变量缺失即启动失败。

### 已知限制

- **未经生产环境验证**：本版本仅在开发机与 CI 的隔离容器中验证过，
  未做过压力测试、未做过长时间运行稳定性验证、未在真实生产环境跑过。
- **Redis 路径未在真实 Redis 上做过长时间验证**：CI 使用 service container 提供 Redis，
  单元与 E2E 覆盖了清空限流在 Redis 下的行为，但未做性能与边界行为的长期观测。
- **未实现的交互**：投票（顶 / 踩）、回复感谢（❤️）、通知已读标记、引用回复 ——
  对应的数据表与计数字段已建，但**点击交互未接通**，页面上不提供可用的按钮。
- **未实现的完整流程**：邮件找回密码（页面已复刻入口，后端邮件发送未实现）、
  关注用户与关注流（`follows` 表已建，首页无「关注」tab）、
  积分排行榜与每日登录加分（`users.balance` 字段与发帖 +10 已实现）。
- **未实现的输出格式**：节点 RSS / JSON Feed 仅复刻了入口位置，没有真正的生成器。
- **未实现的内容扩展**：主题标签、附件上传、私信、头像上传。
- **主题编辑与删除**：仅有软删除字段与后台可见性，缺 UI 与 API。
- **第三方登录**：Google / Solana 需要外部凭据与钱包签名，无可用测试账号，UI 以禁用态呈现。
- **演示账号只在非生产环境创建**：`SEED_DEMO_USERS=1` 时创建 `lisi` / `wangwu` / `zhaoliu` / `moderator`；
  生产环境（`APP_RUNTIME_ENV=production`）自动禁用演示账号创建。
- **版本号与界面差异**：v0.0.1 是**开发预览版**，页面与原站存在差异，
  **不保证与 V2EX 完全一致**。

### 不包含

以下能力在 v0.0.1 中**完全未实现**，不提供任何形式的假实现（无占位按钮、无假接口、无静态演示数据）：

| 能力 | 说明 |
|---|---|
| 主题编辑 | 作者无法编辑已发布主题 |
| 主题删除 | 作者无法删除已发布主题 |
| 回复感谢（thank） | `thanks` 表与计数已建，点击交互未接 |
| 关注用户 / 关注流 | `follows` 表已建，无 UI |
| 积分排行榜 | 无排行榜页面 |
| 每日登录加分 | 无此逻辑 |
| RSS 输出 | 无 RSS / JSON Feed 生成器 |
| 邮件找回密码 | 页面已复刻，邮件流程未实现 |
| 主题标签 | 无标签体系 |
| 附件上传 | 无上传能力 |
| 私信 | 无站内信 |
| 头像上传 | 使用默认头像 |
| 第三方登录 | Google / Solana 未接入 |
| 投票（顶 / 踩） | `votes` 表已建，交互未接 |

[0.0.2]: https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.2
[0.0.1]: https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.1
