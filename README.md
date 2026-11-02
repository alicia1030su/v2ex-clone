# V2EX Clone — 高保真全栈复刻工程

对 `https://www.v2ex.com/` 进行系统性逆向调查后开发的独立论坛系统，
在视觉、交互、功能、URL 结构与业务行为上尽可能接近原站。

**技术栈**：Next.js 15 · React 19 · TypeScript · PostgreSQL 17 · Redis（可选）· Drizzle ORM · Playwright

---

## 快速开始

```bash
npm install
cp .env.example .env.local      # 修改 DATABASE_URL / SESSION_SECRET
npm run db:migrate
npm run db:seed
npm run dev                     # http://localhost:3000
```

Docker 一键部署：

```bash
cp .env.example .env            # 至少修改 SESSION_SECRET
docker compose up -d --build
```

详见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

**初始账号**：`admin` / `admin12345`（管理员）、`lisi` / `password123`（普通用户）。
生产部署后请立即修改。

---

## 已实现的功能

| 领域 | 功能 |
|---|---|
| 账号 | 注册、登录、退出、会话管理、密码修改、资料修改、账号状态（active/suspended/banned） |
| 节点 | 分类浏览、节点详情、子节点树、管理员创建、版主创建待审、管理员审核、节点收藏 |
| 主题 | 发布、列表、详情、浏览计数、Markdown 渲染、软删除、锁定 |
| 回复 | 发布、楼层号原子分配（并发安全）、感谢数、分页 |
| 通知 | 回复通知、未读计数 |
| 收藏 | 收藏主题、收藏节点、取消收藏（两者为独立概念，与原站一致） |
| 搜索 | 顶栏 AJAX 联想、主题/节点/会员搜索、结果分页 |
| 权限 | user / moderator / admin 三级角色、按操作校验 |
| 积分 | 用户积分字段、发帖 +10、积分展示 |
| 后台 | 数据概览、待审节点、已隐藏主题、操作日志 |
| 安全 | scrypt 密码哈希、HttpOnly 会话、HTML 白名单清洗（XSS）、限流、开放重定向防护、安全响应头、验证码 |
| 验证码 | 服务端生成的 320×80 SVG 验证码，哈希存储、一次性使用、字段名哈希化（与原站机制一致） |

---

## 目录结构

```
v2ex-clone/
├── src/
│   ├── app/                    # 路由（App Router）
│   │   ├── page.tsx            # 首页
│   │   ├── go/[name]/          # 节点页
│   │   ├── go/search/          # 搜索
│   │   ├── go/new/             # 发帖
│   │   ├── t/[id]/             # 主题详情
│   │   ├── member/[username]/  # 用户主页
│   │   ├── nodes/              # 全部节点
│   │   ├── signin/ signup/     # 登录 / 注册
│   │   ├── settings/           # 个人设置
│   │   ├── notifications/      # 通知
│   │   ├── bookmarks/          # 收藏
│   │   ├── admin/              # 管理后台
│   │   └── api/                # 12 个 API
│   ├── components/             # 共享组件
│   ├── db/                     # Drizzle schema 与连接
│   ├── lib/                    # 认证、限流、KV、Markdown、时间、密码、验证码
│   └── server/                 # 查询与业务逻辑
├── e2e/                        # 47 个 Playwright 用例
├── tools/
│   ├── recon/                  # 原站抓取（fetch.sh / crawl.sh）
│   └── visual/                 # 截图、像素比对、几何测量
├── drizzle/                    # 3 个 SQL 迁移
├── docs/                       # 8 份文档 + 部署文档
│   └── evidence/               # 原站 HTML/CSS/JS 证据、截图、差异热力图
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

---

## 常用命令

```bash
npm run dev              # 开发模式
npm run build            # 生产构建
npm run start            # 生产启动
npm run db:generate      # 生成迁移
npm run db:migrate       # 应用迁移
npm run db:seed          # 种子数据
npm run test:e2e         # E2E 测试（需先启动服务）

node tools/recon/fetch.sh "/" /tmp/out.html    # 抓取原站页面
node tools/visual/capture.mjs                  # 截图对比
node tools/visual/diff.mjs                     # 像素差异
node tools/visual/measure.mjs                  # 几何偏差
```

---

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/PAGE_INVENTORY.md`](docs/PAGE_INVENTORY.md) | 页面清单、URL 结构、DOM 结构、分页规则 |
| [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) | 功能矩阵与验证状态 |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | 设计 token 与组件规格 |
| [`docs/API_SPEC.md`](docs/API_SPEC.md) | API 规范 |
| [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) | 数据库结构 |
| [`docs/VISUAL_DIFF_REPORT.md`](docs/VISUAL_DIFF_REPORT.md) | 视觉对比报告与 18 轮修复记录 |
| [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md) | 测试报告（47/47 通过） |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | 部署文档 |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | 迭代进度 |

---

## 当前状态

| 项 | 结果 |
|---|---|
| E2E 测试 | **47/47 通过**（42.4 秒，零跳过） |
| 视觉对比 | 10 页面；关键布局元素几何偏差 **Δ = 0**；像素差异 signin 10.0% ~ topic_detail 48.5% |
| 已知未实现项 | 见 `docs/FEATURE_MATRIX.md` 与 `docs/TEST_REPORT.md` 第 6 节 |

---

## 合规声明

- 原站内容与数据**未被复制**；本项目使用独立的 seed 数据。
- 原站品牌图片（Logo、头像、节点图标）属受保护素材，本项目使用**等价尺寸的占位实现**（文字标志 / 确定性 SVG）。
- 原站广告位与第三方统计脚本未复刻。
- 调查阶段仅做**只读抓取**（单页、限速 1 请求/秒），未执行任何写操作、未绕过验证码或访问限制。
- 本仓库代码以研究目的提供，未推送至任何远端，未部署到生产环境。
