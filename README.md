# V2EX Clone

> **⚠️ 独立非官方项目声明**
>
> 本项目是对 `https://www.v2ex.com/` 的**技术研究与高保真界面还原实验**。
>
> - 与 V2EX 官方**无任何关联**，**未获官方授权**，**不是** V2EX 官方产品
> - **不代表**任何形式的官方背书，MIT 许可证**不授予** V2EX 商标使用许可
> - **未复制**原站的私有源码、商标素材、用户数据或社区内容
> - 社区规则与功能设计参考了原站**公开页面**的公开说明（About / FAQ）
> - 仓库内所有代码、文档与数据均为本项目**独立编写 / 采集**
> - 仅供学习与研究用途；使用者需自行确保其使用方式符合所在地法律法规

---

## 项目简介

**一句话**：一个用 Next.js 15 + PostgreSQL 从零实现的社区论坛系统，
目标是还原 V2EX 的界面布局、URL 结构与核心交互行为，作为可运行、可审计的前端与后端研究工程。

**技术栈**：Next.js 15 · React 19 · TypeScript 6 · PostgreSQL 17 · Redis（可选）· Drizzle ORM · Playwright

---

## 当前版本：v0.0.1（开发预览版 / Pre-release）

| 项 | 值 |
|---|---|
| 版本号 | `v0.0.1` |
| 发布形态 | **开发预览版（Pre-release）** |
| 发布日期 | 2026-11-03 |
| 语义化版本位置 | `0.0.x` —— 早期阶段，**不承诺 API 稳定性** |
| 许可证 | MIT（附商标声明与第三方内容声明） |
| 镜像 | `ghcr.io/alicia1030su/v2ex-clone:v0.0.1` |

> **v0.0.1 是开发预览版。**
>
> - **不保证与 V2EX 完全一致** —— 页面内容、交互细节与原站存在差异
> - **不具备生产就绪条件** —— 未经生产环境验证，未做压力测试与长时间稳定性验证
> - **不建议用于生产环境** —— 若要使用，请自行评估风险并完成 `docs/INSTALL.md` 第 12 节的安全清单
> - 版本号遵循语义化版本：`0.0.x` 表示接口与行为**仍可能破坏性变更**

---

## 功能完成度

### 已实现（本版本真实可用的功能）

| 模块 | 状态 | 说明 |
|---|---|---|
| 注册 | ✅ | 用户名大小写不敏感唯一；密码 8–128 字符 |
| 登录 | ✅ | scrypt 密码哈希；账号状态校验（封禁返回 403） |
| 退出 | ✅ | 删除服务端 session 行 + 清 Cookie |
| 会话保持 | ✅ | 服务端 session 表 + HttpOnly / SameSite=Lax Cookie |
| 修改密码 | ✅ | 需校验旧密码；受限流保护 |
| 验证码 | ✅ | 服务端生成 320×80 SVG；答案哈希存储、字段名哈希化、一次性 |
| 用户个人主页 | ✅ | `/member/[username]` |
| 节点列表 / 详情 | ✅ | `/nodes`、`/go/[name]` |
| 子节点树 | ✅ | `nodes.parentId` + 递归渲染 |
| 节点创建 | ✅ | 管理员直生效；版主进待审队列 |
| 节点审核 | ✅ | 仅管理员可 approve / hide |
| 节点收藏 | ✅ | 与主题收藏语义独立 |
| 主题发布 | ✅ | 标题 4–128 字符；正文 10–50000 字符 Markdown |
| 主题列表 | ✅ | 首页与节点页分页 |
| 主题详情 | ✅ | 楼层连续、锚点可跳转 |
| 主题浏览计数 | ✅ | 每次访问 +1 |
| Markdown 渲染 | ✅ | 渲染前经 `sanitize-html` 白名单清洗 |
| 回复发布 | ✅ | 楼层号原子分配；主题锁定时拒绝 |
| 回复分页 | ✅ | 页码导航 |
| 感谢数展示 | ✅ | 仅计数展示（**点击交互未实现**，见下表） |
| 收藏（主题 / 节点） | ✅ | 支持取消；收藏列表页 `/bookmarks` |
| 通知 | ✅ | 回复通知自动生成 + 未读计数 + `/notifications` |
| 搜索 | ✅ | 顶栏 AJAX 联想 + 结果页；主题 / 节点 / 会员三类 |
| 管理后台 | ✅ | `/admin` 概览、待审列表、操作日志 |
| 用户权限 | ✅ | 三级角色 `user` / `moderator` / `admin`，操作级校验 |
| 限流 | ✅ | 登录 / 注册 / 发帖 / 回复 / 建节点 |
| CSRF 防护 | ✅ | 双提交 Cookie 模式 |
| XSS 清洗 | ✅ | 标签 / 属性 / 协议 / 样式白名单 |
| 开放跳转防护 | ✅ | 仅允许站内相对路径 |
| 安全响应头 | ✅ | nosniff / SAMEORIGIN / Referrer-Policy |
| 数据持久化 | ✅ | PostgreSQL 17 + Drizzle ORM 迁移 |
| Redis 可选降级 | ✅ | 未配置 Redis 时自动降级到 PostgreSQL，语义等价 |
| Docker 部署 | ✅ | 多阶段镜像 + Compose + 三阶段启动 |

### 未实现（本版本**完全未实现**）

> 以下能力在 v0.0.1 中**没有实现**。
> 项目**不提供**任何形式的假实现 —— 没有占位按钮、没有假接口、没有静态演示数据冒充。
> 若你在页面上看到一个不工作的按钮，那是因为**功能没做**，而不是"点了没反应"。

| 能力 | 现状 | 底层准备情况 |
|---|---|---|
| 主题编辑 | ❌ **未实现** | — |
| 主题删除 | ❌ **未实现** | 软删除字段 `topics.status='deleted'` 与后台可见性已就绪，缺 UI 与 API |
| 感谢（thank） | ❌ **未实现** | `thanks` 表与 `replies.thanks` 计数已建，**点击交互未接** |
| 关注用户 | ❌ **未实现** | `follows` 表已建，无 UI |
| 关注流 | ❌ **未实现** | 首页无「关注」tab |
| 积分排行榜 | ❌ **未实现** | `users.balance` 字段与发帖 +10 已实现 |
| 每日登录加分 | ❌ **未实现** | — |
| RSS 输出 | ❌ **未实现** | 仅复刻了入口位置与图标，**无生成器** |
| JSON Feed 输出 | ❌ **未实现** | 同上 |
| 邮件找回密码 | ❌ **未实现** | `/forgot` 页面与入口已复刻，**邮件发送流程未接** |
| 主题标签 | ❌ **未实现** | `tags` / `topic_tags` 表已建，无生成与筛选逻辑 |
| 附件上传 | ❌ **未实现** | — |
| 私信 | ❌ **未实现** | — |
| 头像上传 | ❌ **未实现** | 使用默认头像 |
| 投票（顶 / 踩） | ❌ **未实现** | `votes` 表与汇总字段已建，**交互未接** |
| 第三方登录（Google / Solana） | ❌ **未实现** | 需外部凭据与钱包签名，UI 以禁用态呈现 |

完整对照见 [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md)，
逐项验证状态见 [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md)。

---

## 页面截图

> 以下截图均为**本项目本地运行的真实渲染结果**（`local-*.png`），由 Playwright 在
> `desktop-1280` / `desktop-1920` / `mobile-375` 三个视口下采集。

### 首页（`desktop-1280`）

![首页 —— 顶栏节点 tab、主栏主题列表、右侧栏「V2EX = way to explore」与「今日热门主题」](docs/evidence/screenshots/desktop-1280/local-home.png)

### 全部节点

![全部节点 —— 按分类分组的节点列表](docs/evidence/screenshots/desktop-1280/local-nodes_all.png)

### 节点详情页

![节点详情 —— 节点页头部、主题列表、右侧栏](docs/evidence/screenshots/desktop-1280/local-node_claude.png)

### 主题详情页

![主题详情 —— 面包屑、主题正文、Markdown 渲染、收藏按钮、分页与楼层回复](docs/evidence/screenshots/desktop-1280/local-topic_detail.png)

### 用户主页

![用户主页 —— 用户资料、发帖与回复记录](docs/evidence/screenshots/desktop-1280/local-member.png)

### 登录页（含服务端验证码）

![登录页 —— 顶栏、登录表单、服务端生成的 SVG 验证码](docs/evidence/screenshots/desktop-1280/local-signin.png)

### 移动端首页（`mobile-375`）

![移动端首页 —— 375px 视口下的响应式布局](docs/evidence/screenshots/mobile-375/local-home.png)

多视口几何测量与像素比对结果见 [`docs/VISUAL_DIFF_REPORT.md`](docs/VISUAL_DIFF_REPORT.md)。

---

## 一键部署

### 方式 A：一键安装包（推荐）

下载 `v2ex-clone-v0.0.1-deploy.zip` 并解压。

**Linux / macOS：**

```bash
chmod +x install.sh
./install.sh
```

**Windows（PowerShell）：**

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装完成后访问 **http://localhost:3000**。

安装包下载：<https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.1>

### 方式 B：手动 Docker Compose

```bash
# 克隆仓库
git clone https://github.com/alicia1030su/v2ex-clone.git
cd v2ex-clone

# 生成配置文件并填写必填项
cp .env.example .env
#   至少需要设置：POSTGRES_PASSWORD / REDIS_PASSWORD / SESSION_SECRET / SEED_ADMIN_PASSWORD

# 启动
docker compose up -d
```

详见 [`docs/INSTALL.md`](docs/INSTALL.md)（安装手册）与 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)（部署手册）。

---

## 系统要求

| 项 | 要求 | 说明 |
|---|---|---|
| 操作系统 | Linux / macOS / Windows | Windows 走 PowerShell 安装脚本 |
| Docker | **20.10+** | 必需 |
| Docker Compose | **v2**（`docker compose` 子命令形式） | 必需；v1 的 `docker-compose` 不支持本项目的 compose 文件 |
| 可用磁盘 | **2 GB 以上** | 镜像约 400 MB，数据库与日志占用随使用增长 |
| 可用内存 | **2 GB 以上** | PostgreSQL + Redis + 应用三容器同时运行 |
| 端口 | **3000**（可改） | 应用对外端口；数据库与缓存端口**不对外暴露** |
| 网络 | 首次启动需能拉取镜像 | `docker pull postgres:17-alpine` / `redis:7-alpine` / 应用镜像 |

本地开发另需 **Node.js ≥ 22.23.4** 与 PostgreSQL 17（Redis 可选）。

---

## 下载入口

| 内容 | 位置 |
|---|---|
| **发布页面（含全部安装包）** | <https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.1> |
| 一键部署安装包 | `v2ex-clone-v0.0.1-deploy.zip` |
| 容器镜像 | `ghcr.io/alicia1030su/v2ex-clone:v0.0.1` |
| 源码 | <https://github.com/alicia1030su/v2ex-clone> |

> 镜像拉取需要 GHCR 包为 **public** 才能匿名 `docker pull`。
> 若提示 `denied` 或 `unauthorized`，说明该包尚未开放匿名拉取，请改用「方式 B」本地构建。

---

## 开发

### 本地开发

```bash
npm install

cp .env.example .env.local      # 填入 DATABASE_URL / SESSION_SECRET / SEED_ADMIN_PASSWORD
npm run db:migrate              # 应用 Drizzle 迁移
npm run db:seed                 # 写入初始分类 / 节点 / 用户 / 主题
npm run dev                     # http://localhost:3000
```

**初始账号**（仅非生产环境创建）：

| 角色 | 用户名 | 口令来源 |
|---|---|---|
| 管理员 | `admin` | `SEED_ADMIN_PASSWORD`（生产必填，≥12 位） |
| 普通用户 | `lisi` / `wangwu` / `zhaoliu` | `SEED_DEMO_PASSWORD`（未设置则随机生成并打印） |
| 版主 | `moderator` | 同上 |

> 生产环境**不会**创建演示账号，也不会接受缺失或过弱的管理员口令 —— seed 会直接报错退出。
> seed 采用「**只初始化、不修改**」语义：账号已存在时**不会**覆盖其口令与角色。
> 口令与角色的变更必须走授权流程：
>
> ```bash
> export ADMIN_CLI_TOKEN=$(openssl rand -base64 32)
> npm run admin -- set-password --username lisi --password 'NewPassw0rd!' --reason '用户申诉后重置'
> npm run admin -- set-role --username lisi --role moderator --reason '任命为版主'
> npm run admin -- list-admins
> ```

### 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式（热更新） |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产构建产物 |
| `npm run db:generate` | 根据 schema 生成迁移 |
| `npm run db:migrate` | 应用未执行的迁移 |
| `npm run db:seed` | 初始化基础数据（只初始化，不覆盖已有账号） |
| `npm run admin -- <子命令>` | 运维 CLI（改密 / 改角色 / 列管理员） |
| `npm run test:unit` | 单元测试（vitest） |
| `npm run test:e2e` | E2E 测试（playwright） |
| `./scripts/verify.sh` | 完整验证：类型检查 → 构建 → 干净库迁移 → seed → 单元 → E2E |

### 测试

```bash
npm run test:unit                            # 单元测试
LOCAL_BASE=http://localhost:3000 npm run test:e2e   # E2E 测试
./scripts/verify.sh                          # 一键完整验证
./scripts/verify.sh --skip-e2e               # 跳过 E2E
```

| 套件 | 用例数 | 命令 |
|---|---|---|
| 单元测试（vitest） | **103** | `npm run test:unit` |
| E2E（Playwright） | **67** | `npm run test:e2e` |

> `scripts/verify.sh` 是**跨平台**的：数据库操作统一走 Node 脚本（不依赖 `psql` / `pg_dump`），
> 进程管理区分 Windows 与 POSIX。它在**专用验证库**（默认 `v2ex_verify`）上操作，
> 并拒绝在非验证库（库名必须匹配 `*_verify` / `*_test` / `*_ci`）上执行破坏性操作。

---

## 目录结构

```
v2ex-clone/
├── src/
│   ├── app/                    # 路由（App Router，20 个页面）
│   │   ├── page.tsx            # 首页
│   │   ├── go/[name]/          # 节点页
│   │   ├── go/search/  go/new/ # 搜索 / 发帖
│   │   ├── t/[id]/             # 主题详情
│   │   ├── member/[username]/  # 用户主页
│   │   ├── tag/[name]/         # 标签页
│   │   ├── nodes/  xna/        # 全部节点 / VXNA 聚合
│   │   ├── about/ faq/ privacy/ forgot/ worldclock/   # 静态页
│   │   ├── signin/ signup/ settings/ notifications/ bookmarks/ admin/
│   │   └── api/                # 14 个 API 路由
│   ├── components/             # 共享组件
│   ├── db/                     # Drizzle schema（18 张表）与连接
│   ├── lib/                    # 认证、CSRF、限流、KV、Markdown、验证码、运行时开关
│   ├── server/                 # 查询与业务逻辑
│   └── middleware.ts           # CSRF Cookie 下发
├── e2e/                        # Playwright 用例（67 个）
├── tests/                      # vitest 单元测试（103 个）
├── tools/
│   ├── recon/                  # 原站抓取（fetch.sh / crawl.sh）
│   └── visual/                 # 截图、像素比对、几何测量（capture / diff / measure）
├── drizzle/                    # 迁移文件
├── deploy/                     # 一键部署安装包源文件
├── docs/                       # 项目文档
├── scripts/                    # seed.ts / admin-cli.ts / verify.sh / docker-entrypoint.sh
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

---

## 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 框架 | Next.js（App Router，全部页面服务端渲染） | 15.5.x |
| UI | React（客户端组件仅用于搜索框、收藏按钮与三个表单） | 19.3.x |
| 语言 | TypeScript（严格模式） | 6.0.x |
| 数据库 | PostgreSQL | 17 |
| 缓存 / 限流 | Redis（**可选**，缺失时降级 PostgreSQL） | 7 |
| ORM | Drizzle ORM + drizzle-kit | 0.45.x |
| Markdown | marked + sanitize-html | 18.x / 2.18.x |
| 测试 | Playwright（E2E）+ vitest（单元） | 1.64.x / 5.x |
| 部署 | Docker 多阶段镜像 + Docker Compose v2 | — |
| CI | GitHub Actions（类型检查 / 单元 / E2E / Docker 验证） | — |

---

## 安全设计

| 机制 | 实现 | 位置 |
|---|---|---|
| 密码哈希 | scrypt + 随机 salt | `src/lib/password.ts` |
| 会话 | 服务端 session 表 + HttpOnly/SameSite Cookie | `src/lib/auth.ts` |
| CSRF | 双提交 Cookie（middleware 下发 + 隐藏字段/请求头校验） | `src/lib/csrf.ts` |
| XSS | sanitize-html 白名单清洗（标签/属性/协议/样式） | `src/lib/markdown.ts` |
| 验证码 | 服务端 SVG 生成，答案仅存哈希，一次性 | `src/server/captcha.ts` |
| 限流 | Redis（缺失时降级 PostgreSQL），按 IP+账号 / 用户 ID 双维度 | `src/lib/rate-limit.ts` |
| 开放重定向 | `sanitizeRedirect` 仅允许站内相对路径 | `src/lib/redirect.ts` |
| 运行时开关 | `DISABLE_CAPTCHA` 仅在隔离测试环境生效 | `src/lib/runtime-flags.ts` |
| 调试端点 | 显式开关 + 令牌鉴权（恒定时间比较） | `src/lib/debug-auth.ts` |
| 安全响应头 | nosniff / SAMEORIGIN / Referrer-Policy | `next.config.mjs` |
| 运维变更 | `ADMIN_CLI_TOKEN` 授权 + `--reason` 必填 + 审计日志 | `scripts/admin-cli.ts` |

生产环境安全行为已通过**独立的生产模式实例**验证（`APP_RUNTIME_ENV=production`
且故意保留 `DISABLE_CAPTCHA=1`）：验证码仍强制渲染与校验，缺失验证码的登录被 400 拒绝，
未配置令牌的调试端点返回 404。

---

## 已知缺陷与限制

### 未实现的功能

见上文「[未实现](#未实现本版本完全未实现)」表格 —— 主题编辑与删除、感谢、关注用户、
积分排行榜、RSS 输出、邮件找回密码、主题标签、附件上传、私信、头像上传、投票、第三方登录。
**这些不是 bug，是本版本的范围之外。**

### 真实缺陷与风险

| # | 项 | 说明 | 影响面 |
|---|---|---|---|
| 1 | **CI 环境下暴露的限流清理缺陷（已修复）** | 原「清空限流」端点只删数据库表，配了 Redis 时清空操作**静默失效**（返回 200 但配额未清），导致 CI 中 8 个用例出现 TimeoutError / 429。已通过 KV 抽象新增 `clearAll` 修复，但**该缺陷只会在配置了 Redis 的环境出现**，本地无 Redis 时复现不了 —— 说明类似「按后端分支实现」的路径仍有漏测风险 | 中（已修复） |
| 2 | **未经生产环境验证** | v0.0.1 仅在开发机与 CI 隔离容器中跑过。**未做**压力测试、**未做**长时间运行稳定性验证、**未在真实生产环境部署过** | **高** |
| 3 | **seed 演示账号仅非生产环境创建** | `SEED_DEMO_USERS=1` 时会创建 `lisi` / `wangwu` / `zhaoliu` / `moderator` 四个已知账号。在生产环境误设 `APP_RUNTIME_ENV=development` 会导致演示账号被创建 | 中（配置失误即触发） |
| 4 | **Redis 路径长期行为未观测** | CI 用 service container 提供真实 Redis，但只验证了清空限流这一个路径。Redis 长时间运行下的内存增长、键空间膨胀、连接稳定性**均未观测** | 中 |
| 5 | **Docker Compose 未做长时间运行验证** | CI 验证了「构建 → 启动 → 健康检查 → 重启不污染数据」，但**未验证**长期运行的资源占用与日志膨胀 | 中 |
| 6 | **缺少正式贡献指南与行为准则** | 目前单人维护。接受 PR，但没有 PR 模板、评审流程或 Code of Conduct | 低 |
| 7 | **缺少自动化的数据库备份与恢复演练** | 备份命令已提供（见 `docs/INSTALL.md` 第 9 节），但**没有定时任务**，也没有定期的恢复演练 —— 备份是否可用需要人工确认 | 中 |
| 8 | **原站素材的 Git 历史清理未执行** | 当前 HEAD 的文件树中已无原站 HTML / CSS / JS 与参考截图，**但 Git 历史中仍可取回**。历史改写是不可逆的高风险操作，**尚未获授权执行**。清理方案与演练记录属于仓库维护者的内部记录，未随本版本公开 | 低（对 v0.0.1 使用者）/ 中（对仓库维护者） |
| 9 | **界面与原站存在差异** | 像素比对中的剩余差异主要来自内容数据不同（本地 seed 数据 vs 原站实时社区数据）。**不保证与 V2EX 完全一致** | 低 |

> 第 8 项说明：涉及**历史改写**的操作需要单独授权，本次发布**未执行**任何历史改写。

---

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/INSTALL.md`](docs/INSTALL.md) | **安装手册** —— 系统要求、一键安装、验证、配置项、运维命令、升级、备份恢复、故障排查 |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | **部署手册** —— 环境分层、生产检查清单、密钥管理、监控、回滚方案 |
| [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) | **发布检查清单** —— v0.0.1 发布的逐项人工确认表 |
| [`CHANGELOG.md`](CHANGELOG.md) | 更新日志（Keep a Changelog 格式） |
| [`docs/PAGE_INVENTORY.md`](docs/PAGE_INVENTORY.md) | 页面清单、URL 结构、DOM 结构、分页规则 |
| [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) | 功能矩阵与验证状态 |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | 设计 token 与组件规格 |
| [`docs/API_SPEC.md`](docs/API_SPEC.md) | API 规范与限流参数 |
| [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) | 数据库结构 |
| [`docs/VISUAL_DIFF_REPORT.md`](docs/VISUAL_DIFF_REPORT.md) | 多视口视觉对比与修复记录 |
| [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md) | 测试报告与已修复缺陷 |
| [`docs/AUDIT_REPORT.md`](docs/AUDIT_REPORT.md) | 发布前审计报告（6 项 P0 + 8 项 P1 + 17 项测试暴露缺陷） |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | 迭代进度 |

---

## 许可证

本项目采用 [MIT 许可证](LICENSE)。

- **MIT** 覆盖本仓库中的**源代码与文档**；
- **不授予**任何商标、品牌标识或服务标记的使用许可 ——
  "V2EX"、"v2ex" 及相关标识是 V2EX 及其权利人的商标或服务标识；
  本项目**不是** V2EX 官方产品，**不代表**任何形式的官方背书；
- 本仓库中的图标、Logo 等视觉元素均为**独立绘制**的等价实现，
  **不包含** V2EX 官方品牌素材；
- **第三方内容声明**：本仓库当前版本的文件树中**不包含** V2EX 官方站点的
  HTML / CSS / JavaScript 副本、官方品牌图片或用户数据。

详见 [`LICENSE`](LICENSE) 文件中的 `TRADEMARK NOTICE` 与 `THIRD-PARTY CONTENT` 章节。

---

## 独立非官方项目声明

**本项目不是 V2EX 官方产品，与 V2EX 官方无任何关联，未获官方授权。**

- 本项目是**独立的技术研究项目**，由个人在业余时间完成；
- 项目名称中出现 "V2EX" 仅用于**说明研究对象**，不构成商标性使用或官方背书；
- 本项目的界面与交互设计参考了原站**公开可访问**的页面，
  但**全部代码、文档、图标与数据均为独立编写**，未复制原站私有源码或受保护的素材；
- **MIT 许可证不授予商标许可**。请勿以任何方式暗示本项目获得 V2EX 官方认可、
  背书或从属于 V2EX 官方；
- 请勿将本项目用于任何误导性的商业场景，或让用户误认为这是 V2EX 的官方服务；
- 使用者需自行确保其使用方式符合所在地法律法规与相关平台的服务条款。

如发现本项目侵犯了您的合法权益，请通过
[Issues](https://github.com/alicia1030su/v2ex-clone/issues) 联系我们，我们会尽快处理。

---

## 贡献

欢迎提交 PR。提交前请确保：

```bash
./scripts/verify.sh    # 类型检查 → 构建 → 干净库迁移 → seed → 单元 → E2E 全绿
```

当前仓库为 **public**。贡献前请阅读上文「独立非官方项目声明」与
`LICENSE` 中的商标条款 —— 提交内容中**不得**包含 V2EX 官方的源码、品牌素材、
用户数据或任何个人信息。
