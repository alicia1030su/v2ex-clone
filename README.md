# V2EX Clone — 高保真全栈复刻工程

> **独立复刻项目声明**
>
> 本项目是对 `https://www.v2ex.com/` 的**技术研究与高保真界面还原实验**。
> - 与 V2EX 官方**无任何关联**，未获官方授权，非官方产品
> - **未复制**原站的私有源码、商标素材、用户数据或社区内容
> - 社区规则与功能设计参考了原站公开页面的**公开说明**（About / FAQ）
> - 仓库内的所有代码、文档与数据均为本项目独立编写/采集
> - 仅供学习与研究用途

对 V2EX 进行系统性逆向调查后开发的独立论坛系统，
在视觉、交互、功能、URL 结构与业务行为上尽可能接近原站。

**技术栈**：Next.js 15 · React 19 · TypeScript 6 · PostgreSQL 17 · Redis（可选）· Drizzle ORM · Playwright

---

## 实际完成度

| 模块 | 完成度 | 说明 |
|---|---|---|
| 账号（注册/登录/退出/会话/改密/资料） | ✅ 完成 | scrypt 密码哈希、HttpOnly 会话、账号状态分级 |
| 验证码 | ✅ 完成 | 服务端生成 320×80 SVG，哈希存储、一次性、字段名哈希化（与原站机制一致） |
| 节点（分类/详情/子节点树/创建/审核/收藏） | ✅ 完成 | 管理员直生效、版主待审 |
| 主题（发布/列表/详情/浏览计数/Markdown） | ✅ 完成 | Markdown → 安全 HTML（sanitize-html 白名单） |
| 回复（发布/楼层分配/感谢数/分页） | ✅ 完成 | 楼层号用独立计数表原子分配，并发安全 |
| 通知（回复通知/未读计数） | ✅ 完成 | |
| 收藏（主题/节点，两类独立） | ✅ 完成 | 与原站语义一致（收藏节点 ≠ 关注用户） |
| 搜索（AJAX 联想/结果分页） | ✅ 完成 | 主题、节点、会员三类 |
| 权限（三级角色/操作级校验） | ✅ 完成 | user / moderator / admin |
| 管理后台（概览/待审/日志） | ✅ 完成 | |
| 安全（CSRF/XSS/限流/开放重定向/安全头） | ✅ 完成 | 详见 `docs/API_SPEC.md` |
| 静态页面（About/FAQ/Privacy/找回密码/世界时钟/VXNA） | ✅ 完成 | |
| 视觉还原（3 视口 × 10 页面） | ✅ 完成 | 几何偏差已归零，详见 `docs/VISUAL_DIFF_REPORT.md` |
| 投票 / 回复感谢交互 | ⚠️ 部分 | 数据表与计数已就绪，点击交互未接 |
| 关注用户 / 关注流 | ⚠️ 部分 | `follows` 表已建，首页无「关注」tab |
| 主题编辑 / 删除 | ❌ 未实现 | 软删除字段与后台可见性已就绪 |
| 积分排行榜 / 每日登录加分 | ❌ 未实现 | `users.balance` 字段与发帖 +10 已实现 |
| RSS / JSON Feed 生成器 | ❌ 未实现 | 仅复刻入口位置与图标 |
| 邮件找回密码流程 | ❌ 未实现 | 页面与入口已复刻 |
| 第三方登录（Google / Solana） | ❌ 未实现 | 需外部凭据；UI 以禁用态呈现 |
| Docker Compose 部署 | ✅ 已验证 | 镜像构建 + compose 启动 + 重启不污染数据，见 CI `docker` job |

完整对照见 [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md)。

### 完成度声明（可验证的口径）

上表的「✅ 完成」指**功能已实现且有自动化测试覆盖**，不是「看起来能用」。
可验证的口径如下：

| 指标 | 数值 | 验证方式 |
|---|---|---|
| 单元测试 | **36** 个用例全部通过 | `npm run test:unit` |
| E2E 测试 | **67** 个用例全部通过 | `npm run test:e2e` |
| 视觉对比 | 3 视口 × 10 页面 = 30 组 | `docs/VISUAL_DIFF_REPORT.md` |
| 端到端验证 | 类型检查 → 构建 → 干净库迁移 → seed → 单元 → E2E | `scripts/verify.sh` |
| CI | 单元 / E2E / Docker 构建与启动三个 job | `.github/workflows/ci.yml` |

**尚不具备生产就绪条件**，具体差距：

- 缺少完整的端到端加密邮件找回密码流程（页面已复刻，邮件发送未接）；
- 投票、感谢、关注流的**交互**尚未接通（数据表与计数已就绪）；
- 主题编辑 / 删除仅有软删除字段，后台操作界面未做；
- 积分排行榜与每日登录加分未实现；
- RSS / JSON Feed 只有入口位置，没有真正的生成器；
- **Redis 路径尚未在真实 Redis 上验证过** —— 本地与 CI 走的是 PostgreSQL 降级路径
  （语义等价，但性能与边界行为差异未验证）；
- 未做过压力测试与长时间运行稳定性验证。

### 已知的安全边界

- `seed` 脚本**只初始化、不修改**已有账号。改密与角色变更必须走
  `npm run admin -- set-password|set-role`（需 `ADMIN_CLI_TOKEN` 授权令牌，
  并写入审计日志）。
- 容器启动分三阶段：迁移 → **首次**初始化（仅一次）→ 启动应用。
  重新部署不会重置管理员口令，也不会重复写入演示数据。
- Docker Compose 默认**不向宿主机暴露** PostgreSQL / Redis 端口；
  本地直连调试请显式叠加 `docker-compose.debug.yml`。

---

## 快速开始

### Docker（推荐）

```bash
cp .env.example .env
# 至少设置：POSTGRES_PASSWORD / REDIS_PASSWORD / SESSION_SECRET / SEED_ADMIN_PASSWORD
docker compose up -d --build
```

> `docker-compose.yml` 中所有凭据**无默认值** —— 未设置时容器会直接启动失败，
> 而不是带着弱口令运行。

### 本地开发

```bash
npm install
cp .env.example .env.local      # 填入 DATABASE_URL / SESSION_SECRET
npm run db:migrate
npm run db:seed
npm run dev                     # http://localhost:3000
```

**初始账号**（仅非生产环境创建）：

| 角色 | 用户名 | 口令来源 |
|---|---|---|
| 管理员 | `admin` | `SEED_ADMIN_PASSWORD`（生产必填，≥12 位） |
| 普通用户 | `lisi` / `wangwu` / `zhaoliu` | `SEED_DEMO_PASSWORD`（未设置则随机生成并打印） |
| 版主 | `moderator` | 同上 |

> 生产环境**不会**创建演示账号，也不会接受缺失或过弱的管理员口令 ——
> seed 会直接报错退出。

详见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

---

## 验证

```bash
# 完整验证流程（类型检查 → 构建 → 干净库迁移 → seed → 单元测试 → E2E）
./scripts/verify.sh

# 跳过 E2E
./scripts/verify.sh --skip-e2e

# 单独运行
npm run test:unit                # vitest：36 项单元测试
LOCAL_BASE=http://localhost:3000 npm run test:e2e   # playwright：67 项 E2E
```

当前状态：**单元测试 36/36 通过 · E2E 67/67 通过（零跳过）**

`scripts/verify.sh` 是**跨平台**的：Node 与数据库操作均不依赖特定机器的路径，
Windows / Linux / macOS 上行为一致。它会：

1. 在**专用验证库**（默认 `v2ex_verify`）上重建数据库并跑全部迁移；
2. 拒绝在非验证库上执行破坏性操作（库名必须匹配 `*_verify` / `*_test` / `*_ci`）；
3. 启动被测服务前先清空端口占用，避免打到残留的旧实例。

首次运行前需要一个可用的 PostgreSQL：

```bash
# 复制隔离测试配置并按需修改 DATABASE_URL
cp .env.example .env.test
```

CI（`.github/workflows/ci.yml`）用 GitHub Actions 的 **service container**
提供隔离的 PostgreSQL 与 Redis，跑三个 job：单元测试、E2E、Docker 构建与启动验证。

验证方式包含**克隆副本独立验证**：把仓库克隆到全新目录，从零执行
`npm ci` → 类型检查 → 构建 → 干净库迁移 → seed → 单元测试 → E2E，全部通过。
这一步能暴露"测试环境本身没生效"这类问题（详见 `docs/AUDIT_REPORT.md` 第 4.1 节）。

单元测试直接覆盖服务端安全逻辑（验证码一次性、运行时开关限制、HTML 清洗、
redirect 规范化），**不依赖** `DISABLE_CAPTCHA` 等运行时开关，
因此在测试环境下也能验证真实的生产行为。

---

## 目录结构

```
v2ex-clone/
├── src/
│   ├── app/                    # 路由（App Router，16 个页面）
│   │   ├── page.tsx            # 首页
│   │   ├── go/[name]/          # 节点页
│   │   ├── go/search/  go/new/ # 搜索 / 发帖
│   │   ├── t/[id]/             # 主题详情
│   │   ├── member/[username]/  # 用户主页
│   │   ├── tag/[name]/         # 标签页
│   │   ├── nodes/  xna/        # 全部节点 / VXNA 聚合
│   │   ├── about/ faq/ privacy/ forgot/ worldclock/   # 静态页
│   │   ├── signin/ signup/ settings/ notifications/ bookmarks/ admin/
│   │   └── api/                # 12 个 API
│   ├── components/             # 共享组件
│   ├── db/                     # Drizzle schema（18 张表）与连接
│   ├── lib/                    # 认证、CSRF、限流、KV、Markdown、验证码、运行时开关
│   ├── server/                 # 查询与业务逻辑
│   └── middleware.ts           # CSRF Cookie 下发
├── e2e/                        # 67 个 Playwright 用例
├── tests/                      # 28 个 vitest 单元测试
├── tools/
│   ├── recon/                  # 原站抓取（fetch.sh / crawl.sh）
│   └── visual/                 # 截图、像素比对、几何测量（单/多视口）
├── drizzle/                    # 迁移文件
├── docs/                       # 10 份文档
├── scripts/                    # seed.ts / verify.sh
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

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

生产环境安全行为已通过**独立的生产模式实例**验证（`APP_RUNTIME_ENV=production`
且故意保留 `DISABLE_CAPTCHA=1`）：验证码仍强制渲染与校验，缺失验证码的登录被 400 拒绝，
未配置令牌的调试端点返回 404。

---

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/PAGE_INVENTORY.md`](docs/PAGE_INVENTORY.md) | 页面清单、URL 结构、DOM 结构、分页规则 |
| [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) | 功能矩阵与验证状态 |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | 设计 token 与组件规格 |
| [`docs/API_SPEC.md`](docs/API_SPEC.md) | API 规范与限流参数 |
| [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) | 数据库结构 |
| [`docs/VISUAL_DIFF_REPORT.md`](docs/VISUAL_DIFF_REPORT.md) | 多视口视觉对比与修复记录 |
| [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md) | 测试报告与已修复缺陷 |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | 部署文档与安全清单 |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | 迭代进度 |
| [`docs/AUDIT_REPORT.md`](docs/AUDIT_REPORT.md) | 本轮审计与修复报告 |

---

## 逆向调查方法说明

调查工具位于 `tools/`：

```bash
# 抓取原站页面（只读，限速 1 请求/秒）
./tools/recon/fetch.sh "/" /tmp/out.html

# 视觉对比
node tools/visual/capture-multi.mjs --viewport desktop-1280
node tools/visual/diff-multi.mjs
```

原站访问说明：本机沙箱代理会拦截 `v2ex.com`，
调查时通过用户自带的 xray HTTP 代理（`127.0.0.1:10001`）以**客户端方式**出站，
未修改任何代理或浏览器配置，未执行写操作，未绕过验证码或访问限制。

> 采集到的一手证据（原站 HTML / CSS / JS / 参考截图）保存在本机
> `docs/evidence/` 下，**不纳入版本控制**（见 `.gitignore`），
> 以避免分发原站受保护素材的镜像副本。

---

## 开源发布

本项目采用 [MIT 许可证](LICENSE)。

发布前需注意：

| 项 | 状态 | 说明 |
|---|---|---|
| 许可证 | ✅ MIT | 见 [`LICENSE`](LICENSE)，含商标声明与第三方内容声明 |
| 商标 | ✅ 已声明 | MIT **不**授予 V2EX 商标使用许可；不得暗示官方背书 |
| 原站素材 | ⚠️ **部分清理** | 参考截图已移出当前版本；48 个原站 HTML/CSS/JS 副本仍在初始提交的历史里，清理方案见 `docs/HISTORY_CLEANUP_PLAN.md`（需授权执行） |
| 凭据 | ✅ 无默认口令 | `.env.example` 不提供任何可用默认值；`docker-compose.yml` 缺变量即启动失败 |
| 贡献指南 | ⚠️ 未提供 | 目前单人维护；接受 PR 但无正式流程 |
| 行为准则 | ⚠️ 未提供 | 目前单人维护 |
| 变更日志 | ⚠️ 未提供 | 变更记录在 `docs/PROGRESS.md` 与 Git 提交历史中 |

### 仓库可见性与历史清理

当前仓库为 **public**。

⚠️ **已知未清理项**：初始提交 `75c9508` 中仍保留 **48 个原站 HTML/CSS/JS 副本**。
公开仓库下任何人都能通过 `git show 75c9508:docs/evidence/html/index.html` 取回它们。

- 原站**参考截图**（30 个 `ref-*.png`）已从当前版本移除 —— 顺带修复了一个
  `.gitignore` 规则从未命中的缺陷（`*` 不跨越目录分隔符）；
- 原站**源码副本**（48 个）仍在历史中，彻底清理需要重写 Git 历史 ——
  方案已制定并在副本上完整演练验证，见 `docs/HISTORY_CLEANUP_PLAN.md`。
  该操作不可逆，需单独授权后执行。

在历史清理完成之前，请勿将本仓库用于任何需要「不含第三方素材」的场合。

### 贡献

欢迎提交 PR。提交前请确保：

```bash
./scripts/verify.sh    # 类型检查 → 构建 → 干净库迁移 → seed → 单元 → E2E 全绿
```
