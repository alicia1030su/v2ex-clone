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
| Docker Compose 实测 | ❌ 未验证 | 本机未安装 Docker，配置按官方镜像编写 |

完整对照见 [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md)。

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

# 单独运行
npm run test:unit                # vitest：28 项安全逻辑单元测试
LOCAL_BASE=http://localhost:3000 npm run test:e2e   # playwright：67 项 E2E
```

当前状态：**单元测试 28/28 通过 · E2E 67/67 通过（零跳过）**

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
