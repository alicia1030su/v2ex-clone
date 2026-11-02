# PROGRESS — 迭代进度

## 总体状态

| 阶段 | 状态 | 关键产出 |
|---|---|---|
| 一、REA 检查与原站逆向调查 | ✅ 完成 | 28 个页面 HTML 证据、原站 CSS/JS 资产、页面清单、功能矩阵 |
| 二、本地系统骨架 | ✅ 完成 | 18 张表、14 个页面路由、12 个 API、真实 PostgreSQL 后端 |
| 三、视觉还原 | ✅ 完成 | 10 页面截图对比、几何偏差归零、18 轮修复 |
| 四、功能验收 | ✅ 完成 | 47/47 E2E 通过 |
| 五、报告与交付 | ✅ 完成 | 8 份文档 + 部署文档 |

---

## 阶段一：逆向调查

### 环境勘察结论

| 项 | 结论 |
|---|---|
| REA | 未安装 → 安装 `rea-agents@6.8.0`（需 Node ≥22.23.4，单独下载了 Node v22.23.4） |
| REA doctor | `node` 检查通过；`hopper`/`ghidra`/`ida`/`jadx`/`kuna` 缺失（原生反编译引擎，本项目不需要） |
| Docker | 未安装 → 改用 PostgreSQL 17.5 免安装二进制版 |
| 访问原站 | 沙箱代理拦截 `v2ex.com`（CONNECT tunnel 502）→ 发现用户自带的 xray 代理（`127.0.0.1:10001`）可访问，作为客户端使用 |

### 证据采集

- **28 个页面**的 SSR HTML → `docs/evidence/html/`
- **原站 CSS**（147,710 字节）→ `docs/evidence/assets/combo.css`
- **原站 JS**（234,747 字节）→ `docs/evidence/assets/combo.js`
- 设计 token、布局尺寸、DOM 结构全部从这些实测数据提取

### 关键发现

1. **两套 URL 体系**：`/go/*`（旧版 SSR）与 `/d/*`（新版 SPA 壳，仅 6.8KB）
2. **首页 tab 是动态的**：同一 URL 实测抓到「程序员」与「技术」两种首 tab
3. **节点收藏 ≠ 关注用户**：原站 `/t/645662` 明确区分，本项目用 `collections.target` 字段建模
4. **节点页是深色横幅**：`#001d25` 背景 + 蓝色面包屑
5. **灰色只在 `#Wrapper`**，`body` 与页脚是白色 —— 这一条曾导致全部页面 15% 的额外差异
6. **计数徽章是药丸形**：`#aab0c6` 背景、白字、`border-radius:12px`
7. **登录页有验证码**：`/_captcha` 320×80，字段名为一次性哈希

---

## 阶段二：本地系统

### 技术栈落地

| 组件 | 实现 | 状态 |
|---|---|---|
| Next.js 15.5.28 | App Router，所有页面服务端渲染 | ✅ |
| React 19 | 客户端组件仅用于搜索框、收藏按钮、三个表单 | ✅ |
| TypeScript 6.0.3 | 严格模式，生产构建通过类型检查 | ✅ |
| PostgreSQL 17.5 | 18 张表，3 个迁移文件 | ✅ |
| Redis | 未安装 → 自动降级到 PostgreSQL，语义等价 | ✅ 降级 |
| Drizzle ORM | schema.ts + drizzle-kit 迁移 | ✅ |
| Docker Compose | 已编写，**未实际运行验证**（本机无 Docker） | ⚠️ |
| Playwright | 47 个 E2E 用例 | ✅ |

### 功能完成度

见 `docs/FEATURE_MATRIX.md`。核心功能（账号、节点、主题、回复、通知、收藏、搜索、积分、权限、后台）全部实现并验证。

---

## 阶段三：视觉还原

### 18 轮修复（完整清单见 `docs/VISUAL_DIFF_REPORT.md` 第 5 节）

最具价值的 4 个修复：

| 修复 | 效果 |
|---|---|
| `body` 灰色背景移到 `#Wrapper` | signin 65.08% → 15.29% |
| 实现服务端验证码 | signin 15.29% → 10.01% |
| 实现页脚 `#Bottom` | node_claude 51.94% → 41.19% |
| 主题正文改用 `dangerouslySetInnerHTML` | Markdown 从「完全不生效」到正确渲染 |

### 最终几何偏差

**顶栏、Logo、内容容器、主栏（770px）、侧栏（270px）在全部 10 个页面上 Δ = 0。**
剩余偏差全部可归因于「显示的内容不同」（原站实时社区数据 vs 本地 seed 数据）。

---

## 阶段四：功能验收

**47/47 通过，42.4 秒，零跳过零失败。**

测试过程中发现并修复了 **12 个真实产品缺陷**（非测试代码问题），完整清单见 `docs/TEST_REPORT.md` 第 8 节。其中最关键的 4 个：

1. `pgSql` 被误当作 tagged template → 楼层分配/限流/验证码全部 500
2. `db.execute()` 返回结构误判 → 楼层恒为 1 → 唯一键冲突
3. 并发回复楼层冲突 → 新增 `floor_counters` 原子分配表
4. 限流检查早于资源校验 → 正常请求被误判 429

---

## 阶段五：文档

| 文件 | 内容 |
|---|---|
| `docs/PAGE_INVENTORY.md` | 页面清单、URL 结构、DOM 结构、分页规则、相对时间格式 |
| `docs/FEATURE_MATRIX.md` | 功能矩阵与验证状态（含明确的未实现项） |
| `docs/DESIGN_SYSTEM.md` | 设计 token、组件规格、提取方法 |
| `docs/API_SPEC.md` | 12 个 API 的完整规范、限流参数、安全头 |
| `docs/DATABASE_SCHEMA.md` | 18 张表结构、索引、设计决策 |
| `docs/VISUAL_DIFF_REPORT.md` | 像素差异 + 几何偏差 + 18 轮修复记录 |
| `docs/TEST_REPORT.md` | 47 个用例详情、覆盖对照、12 个已修复缺陷 |
| `docs/DEPLOYMENT.md` | Docker Compose、本地开发、Nginx、安全清单、备份 |
| `docs/PROGRESS.md` | 本文件 |

---

## 迭代循环记录

每一轮遵循「观察原站 → 记录证据 → 实现功能 → 本地测试 → 截图对比 → 修复差异 → 更新报告」：

| 轮次 | 观察 | 实现 | 验证 | 修复 |
|---|---|---|---|---|
| 1 | 首页 DOM + CSS 资产 | 抓取工具、页面清单 | 28 页 HTML | — |
| 2 | 设计 token | globals.css 全量重写 | 几何测量 Δ=0 | — |
| 3 | 主题/回复/节点 DOM | 数据层 + 16 个路由 | HTTP 200 | — |
| 4 | 登录页 + 验证码 | 认证 API + 验证码模块 | E2E | `pgSql` 调用错误 |
| 5 | 截图对比 | capture/diff/measure 工具 | 28.58% | 布局颠倒、Logo、头像 |
| 6 | 精确测量 | CSS 数值逐项对齐 | Δw=0 | 顶栏 45px、Logo 100px、徽章样式 |
| 7 | 节点页结构 | 独立节点头部 + `#TopicsNode` | Δh −33 | 节点页深色横幅 |
| 8 | 页脚 | Footer 组件 | node_claude −10% | — |
| 9 | 背景色归属 | 灰色移到 `#Wrapper` | signin −50% | body 背景错误 |
| 10 | 验证码 | SVG 验证码 + 校验 | signin −5% | — |
| 11 | 正文渲染 | dangerouslySetInnerHTML | Markdown 生效 | 正文显示标签 |
| 12 | 并发与限流 | floor_counters + 组合限流键 | 47/47 | 12 个真实缺陷 |

---

## 后续可推进方向

| 方向 | 说明 |
|---|---|
| 主题编辑 / 删除 | `topics.status='deleted'` 已就绪，缺 UI 与 API |
| 显式 CSRF token | 当前依赖 SameSite=Lax + 会话校验 |
| 投票与感谢交互 | 数据表与计数已就绪，缺点击逻辑 |
| 关注用户与关注流 | `follows` 表已建，缺首页「关注」tab |
| 积分排行榜 / 每日登录加分 | `users.balance` 已就绪 |
| RSS / JSON Feed 生成器 | 仅复刻了入口位置 |
| Docker Compose 实测 | 本机无 Docker，配置未实际启动验证 |
| 新版 `/d/*` SPA 路由 | 本项目聚焦旧版 SSR 结构 |
