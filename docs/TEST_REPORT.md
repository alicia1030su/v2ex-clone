# TEST_REPORT — 测试报告

## 1. 运行环境

| 项目 | 取值 |
|---|---|
| Node.js | v22.23.4（WorkBuddy 自带 Node 为 22.22.2，REA 要求 ≥22.23.4，已单独安装） |
| Next.js | 15.5.28（生产模式 `next start`） |
| PostgreSQL | 17.5（免安装二进制版，监听 127.0.0.1:5432） |
| Redis | 未安装 → 自动降级到 PostgreSQL（`kv_store` / `rate_limit_buckets`） |
| 浏览器 | Microsoft Edge（Chromium 内核），Playwright 驱动 |
| 测试目标 | `http://localhost:3010`（生产构建） |
| 执行耗时 | **42.4 秒**（47 个用例） |

## 2. 执行结果（2026-11-03 复审后）

| 套件 | 通过 | 失败 | 跳过 | 耗时 |
|---|---|---|---|---|
| 单元测试（vitest） | **28** | 0 | 0 | 0.87s |
| E2E（Playwright） | **67** | 0 | 0 | ~1.1 min |
| **合计** | **95** | **0** | **0** | — |

**通过率 100%，无跳过、无失败、无重试。**

一键复现：`./scripts/verify.sh`（类型检查 → 构建 → 干净库迁移 → seed → 单元测试 → E2E）。

机器可读结果：`test-results/e2e-results.json`（Playwright JSON reporter）。

### 2.0 克隆副本独立验证

把仓库克隆到全新目录后从零验证（这是发现 ENV_FILE 失效的关键手段）：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 克隆 | `git clone https://github.com/alicia1030su/v2ex-clone.git` | ✅ 200 个文件，HEAD 一致 |
| 依赖 | `npm ci` | ✅ 117 包 |
| 类型检查 | `npx tsc --noEmit` | ✅ 零错误 |
| 构建 | `npx next build` | ✅ Compiled successfully |
| 干净库 | `CREATE DATABASE v2ex_clone_test` | ✅ |
| 迁移 | `drizzle-kit migrate` | ✅ 18 张表 |
| 种子 | `tsx scripts/seed.ts` | ✅ 9 分类 / 5 用户 / 23 节点 / 10 主题 |
| 单元测试 | `npx vitest run` | ✅ **28/28** |
| E2E | `npx playwright test` | ✅ **67/67** |

### 2.1 新增的安全回归套件（20 项）

`e2e/security-regression.spec.ts` —— 逐项对应本轮修复的 P0/P1 缺陷：

| 组 | 项数 | 覆盖 |
|---|---|---|
| P0-1 / P0-2 验证码强制校验 | 4 | 缺失 captchaId、错误答案、字段名不匹配、挑战端点可用 |
| P0-3 调试端点鉴权 | 3 | 缺令牌、错令牌、floors 端点 |
| P0-4 限流窗口重置 | 1 | 跨窗口计数归零（经探针端点） |
| P1-10 注册限流双维度 | 1 | 换用户名批量注册被 IP 维度拦截 |
| P1-11 redirect 验证 | 2 | 外部 URL、协议相对 URL |
| P1-13 CSRF | 4 | 缺 token、错 token、正确 token、Cookie 下发 |
| P1-14 HTML 清洗 | 4 | data:image/svg+xml、javascript:、style 丢弃、外链 rel |

### 2.2 新增的单元测试（28 项）

`tests/captcha.spec.ts` —— **直接覆盖服务端安全模块，不经由 `DISABLE_CAPTCHA` 等运行时开关**，
因此在隔离测试环境下也能验证真实的生产行为：

| 组 | 项数 | 内容 |
|---|---|---|
| 验证码逻辑 | 5 | 错误答案、一次性作废、不存在 ID、空答案、字段名匹配 |
| 运行时开关 | 6 | production/staging 忽略 DISABLE_CAPTCHA、非隔离 test 拒绝、仅隔离 test 允许、未设变量拒绝、运行时环境判定、调试端点需显式开启 |
| HTML 清洗器 | 10 | script / onerror / javascript: / data-svg / style / 控制字符绕过 / iframe / object / embed / 保留 Markdown 与表格 |
| redirect 规范化 | 5 | 站内路径 / 外部 URL / 协议相对 / CR-LF 注入 / 非字符串 |

## 3. 用例清单

### 3.1 账号体系 — `e2e/auth.spec.ts`（8 项）

| # | 用例 | 验证内容 | 状态 |
|---|---|---|---|
| 1 | 注册后自动登录并可访问设置页 | 注册 → 自动下发会话 → `/settings` 显示用户名与退出按钮 | ✅ |
| 2 | 重复用户名注册被拒绝 | 独立浏览器上下文用同名注册 → 409 文案「已被使用」 | ✅ |
| 3 | 短密码注册被拒绝 | 3 位密码 → 400 文案「至少 8 位」 | ✅ |
| 4 | 错误密码登录失败并给出提示 | 错误密码 → 401 文案「用户名或密码不正确」 | ✅ |
| 5 | 登录后导航栏显示用户名，退出后恢复游客态 | 登录 → 导航栏含用户名；退出 → 含「登录」且不含用户名 | ✅ |
| 6 | 未登录访问受保护页面会跳转到登录页 | `/settings` `/notifications` `/bookmarks` `/go/new` 全部 307 到 `/signin?next=` | ✅ |
| 7 | 登录限流生效 | 连续错误登录 → 出现 429 且带 `Retry-After` | ✅ |
| 8 | 管理员账号可访问管理后台，普通用户不可 | admin → `/admin` 显示概览；user → 重定向回 `/` | ✅ |

### 3.2 收藏与通知、搜索、权限 — `e2e/feature.spec.ts`（16 项）

| # | 用例 | 验证内容 | 状态 |
|---|---|---|---|
| 9 | 收藏主题后出现在收藏页，可取消收藏 | 按钮状态翻转；`/bookmarks` 含「收藏的主题」 | ✅ |
| 10 | 收藏节点后出现在收藏页 | 节点页「加入收藏」→ 「已收藏」；`/bookmarks` 含「收藏的节点」 | ✅ |
| 11 | 未登录用户收藏被拒绝 | POST `/api/collections` → 401 | ✅ |
| 12 | 收到回复后通知列表出现对应条目 | B 回复 A 的主题 → A 的 `/notifications` 含「回复了你的主题」 | ✅ |
| 13 | 收藏接口校验目标类型 | `target: 'invalid'` → 400 | ✅ |
| 14 | 搜索框输入后出现建议下拉 | 输入 `claude` → `#search-result` 可见且含条目 | ✅ |
| 15 | 搜索结果页返回匹配的主题 | `/go/search?q=deepseek` → 含「主题」区块与主题项 | ✅ |
| 16 | 搜索关键词无结果时给出提示 | 无匹配 → 「没有找到相关主题」 | ✅ |
| 17 | 普通用户不能创建节点 | user POST `/api/nodes` → 403 | ✅ |
| 18 | 管理员可以创建节点 | admin → 201 且 `status='active'`，节点页可见 | ✅ |
| 19 | 版主创建的节点需要审核 | moderator → 201 且 `status='pending'` | ✅ |
| 20 | 非管理员不能审核节点 | moderator PATCH → 403 | ✅ |
| 21 | 节点名格式非法被拒绝 | `Invalid Name!` → 400 | ✅ |
| 22 | 重复节点名被拒绝 | `programmer` → 409 | ✅ |
| 23 | 用户只能修改自己的资料 | 更新头衔/简介 → 自己的主页显示新内容 | ✅ |
| 24 | 修改密码需要校验当前密码 | 错误当前密码 → 401 | ✅ |

### 3.3 分页 — `e2e/pagination.spec.ts`（6 项）

| # | 用例 | 验证内容 | 状态 |
|---|---|---|---|
| 25 | 首页分页：每页 20 条，页码可跳转 | `.cell.item` 数量 ≤ 20 且 > 0 | ✅ |
| 26 | 节点页分页参数生效 | 第 1 页 ≤20 条、`.page_current` = "1"；第 2 页与第 1 页无重复且页码 = "2" | ✅ |
| 27 | 主题数不足一页时不显示分页器 | claude 节点 → 无 `.page_current` | ✅ |
| 28 | 超出范围的页码不报错 | `?p=9999` → HTTP 200 | ✅ |
| 29 | 主题详情回复分页器存在且格式正确 | `.ps_container .page_current` = "1" | ✅ |
| 30 | 分页输入框可跳转到指定页 | `.page_input` 有 `min="1"` | ✅ |

### 3.4 安全性 — `e2e/security.spec.ts`（9 项）

| # | 用例 | 验证内容 | 状态 |
|---|---|---|---|
| 31 | 主题正文中的脚本被执行前被清洗（XSS） | 提交 `<script>` 与 `<img onerror>` → 页面中 `window.__xss__`/`__xss2__` 均为 undefined；HTML 中不含 `<script` 与 `onerror`；正文文字保留 | ✅ |
| 32 | 回复中的脚本被清洗（XSS） | 同上，针对回复 | ✅ |
| 33 | 用户名中的 HTML 被转义而非执行 | 侧栏 innerHTML 不含 `<script` | ✅ |
| 34 | 会话 Cookie 为 HttpOnly | `v2_session` 的 `httpOnly=true`、`sameSite=Lax` | ✅ |
| 35 | 登录 next 参数不允许开放重定向 | `?next=https://evil.example.com/` → 登录后 URL 仍在 localhost | ✅ |
| 36 | 回复接口无法引用不存在的主题（防注入/越权） | `topicId='1; DROP TABLE topics;--'` → 400 | ✅ |
| 37 | 设置接口拒绝非法 URL 协议 | `url='javascript:alert(1)'` → 400 | ✅ |
| 38 | 响应包含安全头 | `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` | ✅ |
| 39 | 未登录状态下的写操作全部被拒绝 | 6 个写接口全部返回 401 | ✅ |

### 3.5 主题与回复 — `e2e/topic.spec.ts`（8 项）

| # | 用例 | 验证内容 | 状态 |
|---|---|---|---|
| 40 | 发布主题后出现在节点页与首页列表中 | 发布 → 跳转 `/t/{id}` → `h1` 匹配 → 正文可见 → 节点页 `#TopicsNode` 含标题 → 首页含标题 | ✅ |
| 41 | 回复主题后楼层号递增且计数同步 | 回复后回复总数 +1；最大楼层号增大；楼层号唯一 | ✅ |
| 42 | 未登录用户无法提交回复 | → 401 | ✅ |
| 43 | 回复内容长度受限 | 20001 字符 → 400「过长」 | ✅ |
| 44 | 对不存在的主题回复返回 404 | topicId=999999 → 404 | ✅ |
| 45 | 发帖缺少必填项被拒绝 | 标题/正文过短 → 400 | ✅ |
| 46 | 回复限流生效 | 连续回复 → 429 | ✅ |
| 47 | 并发回复不会产生重复楼层号 | 5 个并发 POST → 楼层号集合无重复（唯一索引 + 原子计数器） | ✅ |

## 4. 覆盖对照（需求项 → 用例）

| 需求项 | 覆盖用例 |
|---|---|
| 注册登录及退出 | 1, 3, 4, 5, 6 |
| 账户权限 | 8, 17, 19, 20, 23, 24, 39 |
| 创建节点（管理员） | 18, 21, 22 |
| 创建主题 | 40, 45 |
| 编辑和管理主题 | ⚠️ 未实现（见第 6 节） |
| 回复主题 | 41, 42, 43, 44, 47 |
| 分页 | 25, 26, 27, 28, 29, 30 |
| 收藏 | 9, 10, 11, 13 |
| 通知 | 12 |
| 搜索 | 14, 15, 16 |
| 用户信息更新 | 23, 24 |
| 管理审核 | 19, 20 |
| 并发操作 | 47 |
| 异常输入 | 3, 17, 21, 36, 37, 43, 45 |
| CSRF | ⚠️ 部分（SameSite=Lax + 写操作要求会话；未实现显式 token，见第 6 节） |
| XSS | 31, 32, 33 |
| 越权 | 36, 39 |
| 速率限制 | 7, 46 |

## 5. 视觉验证

见 `docs/VISUAL_DIFF_REPORT.md`。核心结论：

- 10 个页面在**完全相同的对照条件**下截图比对
- 关键布局元素（顶栏 / Logo / 主栏 / 侧栏 / 内容容器）几何偏差 **Δ = 0**
- 像素差异：signin **10.01%**（最低）~ topic_detail 48.48%（最高，差异全部来自内容数据不同）

## 6. 已知未覆盖 / 未实现项（如实记录）

| 项目 | 状态 | 原因 |
|---|---|---|
| 主题编辑与删除 | **未实现** | 本轮未实现该功能，因此无对应用例；`topics.status='deleted'` 的软删除字段与后台可见性已就绪 |
| CSRF 显式 token | **部分实现** | 采用 `SameSite=Lax` Cookie + 写接口强制校验会话态；未实现双提交 token 机制 |
| 投票（顶/踩） | **未实现 UI** | `votes` 表与 `topics.votes` 汇总字段已建，箭头 UI 已按原站渲染，但未接交互 |
| 回复感谢（❤️） | **未实现 UI** | `thanks` 表与 `replies.thanks` 已建，计数展示已实现，点击交互未接 |
| 关注用户 / 关注流 | **未实现** | `follows` 表已建，首页无「关注」tab |
| 每日登录加积分 / 积分排行榜 | **未实现** | `users.balance` 字段与发帖 +10 已实现 |
| 节点 RSS / JSON Feed 生成 | **未实现** | 仅复刻原站的入口链接位置 |
| 第三方登录（Google / Solana） | **未实现** | 需外部 OAuth 凭据与钱包签名，且无可用测试账号；UI 以禁用态呈现 |
| 邮件通知 / 找回密码流程 | **未实现** | 原站 `/forgot` 页面已复刻入口，未实现后端流程 |
| Redis 实际运行 | **降级** | 本机未安装 Redis，自动使用 PostgreSQL 降级实现（语义等价） |
| Docker Compose 实际运行 | **未验证** | 本机未安装 Docker，配置文件已按官方镜像编写但未实际启动验证 |

## 7. 复现命令

```bash
# 1. 准备数据库
export PATH="/path/to/node-v22.23.4/bin:$PATH"
cp .env.example .env.local      # 填入 DATABASE_URL / SESSION_SECRET
npm run db:migrate
npm run db:seed

# 2. 构建并启动
npm run build
npm run start

# 3. 运行 E2E（另开终端）
LOCAL_BASE=http://localhost:3000 npx playwright test --reporter=list

# 4. 视觉对比
node tools/visual/capture.mjs
node tools/visual/diff.mjs
node tools/visual/measure.mjs
```

> 测试环境（`.env.test`）使用 `APP_RUNTIME_ENV=test` + `TEST_ENV_ISOLATED=1`。
> 只有在这个**隔离测试环境**中，`DISABLE_CAPTCHA=1` 才会生效；
> 生产/预发环境即使误配该变量也**强制启用验证码**。
> `ENABLE_DEBUG_ENDPOINTS=1` 仍需配合 `DEBUG_ENDPOINT_TOKEN` 才能访问。
>
> 生产行为另有**独立实例**验证（`APP_RUNTIME_ENV=production`，端口 3040）：
> 登录页仍渲染验证码、缺失 captchaId 的登录返回 400、未配令牌的调试端点返回 404。

## 8. 测试过程中发现并修复的真实缺陷

以下缺陷是本次测试暴露并已修复的**产品代码问题**（非测试代码问题）：

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| 1 | `pgSql` 被当作 tagged template 使用 | 楼层分配、限流、验证码全部 500 | 改用 drizzle `sql` + `db.execute()` |
| 2 | `db.execute()` 返回结构误判 | 楼层恒为 1 → 唯一键冲突 | 新增 `extractRows()` 兼容不同 driver |
| 3 | `Date` 实例直接传给 drizzle `sql` | 在线人数查询 500 | 统一传 ISO 字符串 |
| 4 | `postgres.js` 不接受 `Date` 参数 | 限流计数全部失败 | 同上 |
| 5 | `PgKV.del` 未清理 `rate_limit_buckets` | 登录成功后限流计数不释放，用户被持续锁定 | 同时删除两张表 |
| 6 | 限流检查早于资源校验 | 对不存在主题的请求消耗限流配额，导致正常请求被 429 | 改为「参数 → 资源 → 限流」顺序 |
| 7 | 限流键只用 IP | 同一出口 IP 下不同用户互相影响 | 登录/注册改为 `IP + 用户名` 组合键 |
| 8 | 并发回复楼层冲突 | 高并发下 500 | 新增 `floor_counters` 原子分配表 |
| 9 | 主题正文用 `{contentHtml}` 渲染 | 显示原始 HTML 标签，Markdown 完全失效 | 改用 `dangerouslySetInnerHTML` |
| 10 | `body` 背景色错误 | 所有页面下方大片灰色，与原站不符 | 灰色只保留在 `#Wrapper` |
| 11 | 路由文件导出非 HTTP 方法 | 生产构建失败 | 抽出到独立模块 |
| 12 | `next-env.d.ts` 缺 CSS 模块声明 | 生产构建失败 | 补充 `global.d.ts` |
| 13 | `Pager` 含事件处理器却是 Server Component | 节点页/搜索页整页渲染失败 | 加 `'use client'` |
| 14 | 主题页原生表单无 CSRF token | UI 回复功能完全失效（500） | 表单注入 `csrfToken` 隐藏字段 |
| 15 | CSRF 校验与业务处理重复读取 body | `Body is unusable` → 500 | `WeakMap` 缓存 `FormData` |
| 16 | 节点页 `CollectButton` 在重构中丢失 | 节点收藏功能消失 | 恢复组件 |
| 17 | `PgKV.del` 未清理限流表 | 登录成功后被持续限流锁定 | 同时删除 `rate_limit_buckets` |
| 18 | 限流检查早于资源校验 | 正常请求被误判 429 | 改为「参数 → 资源 → 限流」 |
| 19 | 并发回复楼层冲突 | 高并发 500 | `floor_counters` 原子分配表 |
| 20 | `.env.test` 未被 gitignore | 测试口令会进 Git | 补充忽略规则 |
