# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 版本号从 `0.0.1` 起，采用 `0.MINOR.PATCH` 形式：
> `0.0.x` 全部为**早期开发预览版**，不承诺 API 稳定性，不建议用于生产环境。

本文件只记录**本项目实际做过的事**。凡是未实现的功能，一律列在「不包含」小节，
不以任何形式（包括占位按钮、静态演示数据）冒充已实现。

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

[0.0.1]: https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.1
