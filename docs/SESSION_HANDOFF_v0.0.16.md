# v0.0.16 会话交接

> **最后更新**：2026-11-11（GMT+8）
> **分支**：已合并到 `master`（PR **#57** squash 合并 → `0d9c46e`）
> **基线**：v0.0.15 已公开发布（Tag `v0.0.15` → `66c5ab4`，Release `440363070`）
> **本版状态**：**开发中，未同步版本号、未打 Tag、未发布**
> **R-01**：维持 **DEFERRED / A3 保留 + 披露**，本轮不授权任何远端历史改写

---

## 0. 一句话状态

v0.0.15 的发布链路已验证可用（11/11 + 13 项匿名验收）。
本轮（v0.0.16）聚焦「普通人真正用得顺」：已修掉 **7 类真实缺陷**，
全部带负向对照与回归测试；已建立**官方包四角色验收流水线**（P0）；
已建立**视觉几何 + 结构探针 + 性能基线**三套可复跑测量工具。

---

## 1. 本轮已完成的真实修复（全部有实测证据）

| # | 缺陷 | 类型 | 证据 | 回归 |
|---|---|---|---|---|
| ① | 主题页回复头 `.box > .cell > .cell` 嵌套：匿名访客看到空 21px cell，回复头被拆成三段 | A（布局） | 结构探针 `badNesting` 命中；数据库无关 | `v016-structure-guards` 2 例 |
| ② | 「最热」tab 与标签页的「最后回复来自 X」**是假的**（硬编码 null + 组件用作者兜底） | 数据错误 | 实测 6 条里 **5 条**错；例：`群晖 NAS…` 楼主 lisi，真实最后回复者 admin | `v016-last-replier` 5 例（真库） |
| ③ | FAQ 的 `/member/` 缺用户名 ⇒ 点击必然 404 | 死链 | 静态断言 | `v016-structure-guards` 2 例 |
| ④ | 「最后回复者」读放大：读 20 个主题的**全部**回复（实测 rows=3190） | 性能 | `EXPLAIN ANALYZE`：3190 → **20** 行 | 同上（含 id 兜底确定性） |
| ⑤ | 收藏按钮：点了「已收藏」，1~2 秒后自己变回「收藏」（异步校准覆盖新状态） | 交互竞态 | 实测修复后 2.5s 仍稳定、刷新保持 | `v016-structure-guards` 2 例 |
| ⑥ | 节点页 N+1：每个分类查一次节点（实测 17 个 DB 事务） | 性能 | 17 → **2** 个事务（与分类数无关） | 结构探针 + 性能基线 |
| ⑦ | `TopicActions` / `FollowButton` 返回 null 时外层 cell 仍渲染 ⇒ 空 20px 盒子 | A（布局） | 探针：topic_detail `770x20`、member `270x20` → 现在 **0** | `v016-structure-guards` 2 例 |
| ⑧ | 第三方登录按钮：图标在上/文案在下的方块 → 参考站的整行横向（250×44） | B（样式） | 截图对比 | 视觉证据 |
| ⑨ | 登录/注册输入框 `width:100%`（616px）→ 参考站实测约 318px | B（样式） | 像素测量 | 视觉证据 |
| ⑩ | 回复框与编辑表单 textarea 同名（`name="content"`）⇒ 自动化可能填错控件 | 隐患 | 验收脚本实际踩到 | 唯一 `id="reply-content"` |
| ⑪ | **「积分流水」按钮点不动**（被签到区 `checkin-box` 覆盖下半部分，Playwright 报 `intercepts pointer events`） | **交互（真按钮点不动）** | 逐按钮点击扫描 | `.sepN` 改 `min-height` + 8 处占位块容器改 `.reply_row` |

---

## 2. 新增测量工具（全部可复跑，不依赖一次性人工判断）

| 工具 | 用途 | 关键指标 |
|---|---|---|
| `tools/visual/measure-page-geometry.mjs` | 按白盒边界测页面几何 | 内容宽 / 主栏 / 右栏 / 页头高 / 盒子数 |
| `tools/visual/measure-row-geometry.mjs` | 主题行内部几何 | 头像框、标题文字带、分隔线间距 |
| `tools/visual/probe-pages.mjs` | 真实浏览器结构探针 | 空 cell / 非法嵌套 / 横向溢出 / 失败请求 / 页面错误 |
| `tools/perf/collect-baseline.mjs` | 性能基线 | load / TTFB / FCP / LCP / CLS / JS·CSS 字节 / 请求数 / DB 事务 |

### 修掉的三处测量失真（重要）

这些如果不修，会得出**看起来很像结论的错误数字**：

1. **`wallMs` 被 LCP 观察窗口污染** —— 第一版把计时器一直量到 `vitals` 窗口
   结束（+1200ms），于是每页都稳定报 ~1300ms。那是**测量窗口**，不是页面耗时。
   现在在 `load` 那一瞬结算。
2. **`transferSize` 缓存命中为 0** —— 第二轮起所有资源都是 0 字节，
   看起来像「本站没有 JS」。改为 `transferSize → encodedBodySize → decodedBodySize`。
3. **FCP 在 `load` 当刻读不到** —— 实测 msedge 此时
   `performance.getEntriesByType('paint')` 返回 `[]`，约 500ms 后才可见。
   改为在 vitals 窗口结束后读。

---

## 3. 几何实测结论（1280×900，本站 vs 参考截图）

**布局骨架已经对齐，差异在组件细节：**

| 指标 | 参考 | 本站 | 差 |
|---|---|---|---|
| 内容宽（左边界→右边界） | 1060 | 1060 | **0** |
| 主栏宽 | 772（实测 770） | 770 | 0 |
| 右栏宽 | 272（实测 270） | 270 | 0 |
| 顶栏高 | 44 | 44 | **0** |
| 主题行高 | 71 | 71 | **0** |

> ⚠️ 差异分级中已登记：`ref-nodes_all.png` 的实际内容是 **Go 节点页**而非
> 「全部节点」页（索引里标 `no-auth-reference`）⇒ **该参考证据失效**，
> 不能拿它冒充对照。这属于 E 类（参考信息不足），不据此改代码。

---

## 4. 性能基线（本地 `v2ex_v016_visual`，3 轮取中位）

| 页面 | cold | warm | TTFB | FCP | LCP | CLS | JS | DB 事务 |
|---|---|---|---|---|---|---|---|---|
| 首页 | 310 | 78 | 24 | 92 | 92 | 0 | 105 kB | 13 |
| 节点页 | 71 | 63 | 20 | 76 | 76 | 0 | 107 kB | 9 |
| 主题详情 | 89 | 57 | 20 | 88 | 88 | 0 | 109 kB | 12 |
| 搜索 | 63 | 62 | 18 | 68 | 68 | 0 | 106 kB | 8 |
| 用户主页 | 70 | 54 | 16 | 68 | 68 | 0 | 106 kB | 11 |
| 全部节点 | 76 | 64 | 19 | 84 | 84 | 0 | 105 kB | **6**（原 17） |
| 最热 | 68 | 62 | 20 | 80 | 80 | 0 | 105 kB | 9 |

- CLS 全部 **0**（无布局抖动）。
- 首页 13 个事务里包含侧栏三个独立服务端组件（今日热议 / 最热节点 / 站点）、
  会话读取、列表 + count + 最后回复者。未发现可消除的重复查询。
- 「全部节点」从 17 → 6 是本轮唯一的 N+1 修复点。

---

## 5. P0：官方包四角色真实用户验收（新增，尚未在 CI 跑过）

`post-release-verify.yml` 已覆盖「匿名下载 → SHA256 → `install.sh` 全新安装 →
备份恢复 → 重启持久化」，但对**用户流程**只有单用户 API 探针，
通知写入路径记为 WARN。

新增：

- `.github/workflows/official-acceptance.yml`：`workflow_dispatch`，
  真实下载 **Release 资产** → 校验 SHA256 → 官方 `install.sh` 原样安装 →
  真实 Docker Compose → 真实浏览器跑四角色。**不改动已发布资产**。
- `scripts/release/acceptance-official.mjs`：验收主体，
  断言口径是「页面可见结果 + 数据库真实行」双证。

### 脚本里修掉的 4 个「必然失败」（选择器与实现不符）

| # | 脚本原本 | 实际 | 后果 |
|---|---|---|---|
| 1 | `/new` | `/go/new` | 404 |
| 2 | `#tags` | `#topic-tags-add-${id}` | 永远找不到 ⇒ 误判「编辑入口缺失」 |
| 3 | 「保存」 | 「保存修改」 | 点不到 |
| 4 | `has-text("编辑")` | 会同时匹配「编辑 (1)」 | 用 `aria-label` 精确锚定 |

### 仍待完成

- [ ] **合并到 master 后**才能 `workflow_dispatch`（GitHub 要求工作流先存在于默认分支）
- [ ] 首次真实运行并记录结果（四角色 + 双用户通知）

---

## 6. 当前测试基线

| 套件 | 结果 |
|---|---|
| `tsc --noEmit` | **0 错误** |
| 静态护栏（`vitest.static.config.ts`） | **26 文件 / 331 用例全通过** |
| 完整单元（`vitest run`） | **69 文件 / 875 用例全通过**（隔离实例 :55440） |
| 真库 `v016-last-replier` | **5 / 5** |
| **E2E 通知双用户全链路**（`e2e/v015-notifications.spec.ts`） | **11 / 11 通过**（38.4s）—— 回复 / 提及 / 感谢 / 未读·已读·刷新保留 / 并发 / 软删 / 封禁边界 / hidden 节点不泄露 / 系统通知不被过滤 |
| **E2E 核心套件**（`topic.spec.ts` + `feature.spec.ts`） | **25 / 25 通过**（38.8s），含本轮新增的「最后回复者双用户」用例（4.0s） |
| 结构探针（**21 页** × 1280×900） | **0 空 cell / 0 非法嵌套 / 0 横向溢出 / 0 失败请求**（原 14 页，本轮补 7 页） |
| 六视口横向溢出（320/375/390/768/1280/1920） | **全部 ok** |
| **PR #57 CI（合并前最后一轮）** | **30 pass / 0 fail / 1 skipping**（唯一 skip 是诊断用工作流，非门禁） |
| └ 跨浏览器 × 视口矩阵 | chromium / firefox / webkit × 5 视口（375/390/768/1280/1920）**15/15 pass** |
| └ Docker 真实安装 / Docker 构建启动 | **pass** |
| └ 组件级视觉回归（7 视口 × 3 浏览器 × 3 页面） | **pass** |
| └ 安全（Host Header 攻击矩阵 / R-16·R-17 九项） | **pass** |
| └ SMTP 连续稳定性（30 次全流程） | **pass** |
| └ 类型检查 / 单元测试（CI） | **pass** |
| 重复提交（双击「提交回复」） | 只发出 **1 个 POST（303）**，数据库 **1 条** —— 原生 form 导航天然防重 |

### 本地 E2E 环境的一个**必须注意的坑**

Playwright 的配置会按 `ENV_FILE → .env.test → .env.local → .env` 加载环境，
而 `.env.test` 里的 `DATABASE_URL` 指向隔离实例 `:55440`。
如果被测应用跑在 `:55433`（视觉测量库）而 E2E 从 `.env.test` 取 `:55440`，
则 `global-setup` 的「同步 seed 口令」会写到**另一个库**，表现为
「管理员登录一直超时」——**不是权限问题、也不是验证码问题**。

正确做法：跑 E2E 时显式把 `DATABASE_URL` 指到**被测应用实际连的那个库**：

```bash
LOCAL_BASE=http://127.0.0.1:3211 ENV_FILE=.env.test \
DATABASE_URL="postgres://…:55433/v2ex_v016_visual" \
CODEBUDDY_SAFE_DELETE_ENABLED=0 npx playwright test e2e/topic.spec.ts
```

另有两个本机专属坑（与 CI 无关）：
- **`CODEBUDDY_SAFE_DELETE_ENABLED=1` 会让 Playwright 清理 `test-results/` 失败**
  （安全删除 shim 在批量删除时抛错，整个 run 直接退出）⇒ 跑 E2E 必须置 `0`；
- 测试实例必须是 `APP_RUNTIME_ENV=test` + `TEST_ENV_ISOLATED=1` +
  `DISABLE_CAPTCHA=1`，否则管理员登录被强制验证码拦住（**这是正确行为**）。

### 负向对照（全部实测判红后恢复）

| 对照 | 判红 |
|---|---|
| 把最热 tab 的 `lastReplier` 改回 `null` | ✅ |
| 静态：代码里出现 `lastReplier: null` | ✅ |
| 静态：组件用 `?? author.username` 兜底 | ✅ |
| 静态：FAQ 出现裸 `/member/` | ✅（2 例同时红） |
| 静态：`TopicActions` 裸包 cell | ✅ |
| 静态：`FollowButton` 裸包 cell | ✅ |
| 静态：去掉 `userActedRef` 检查 | ✅ |
| 静态：去掉 `if (pending) return` | ✅ |
| 静态：`.sep5` 改回固定 `height` | ✅（4 条中对应那条判红） |
| 静态：把按钮塞回 `.sep5` 容器 | ✅ |

---

## 7. 环境事实（本机）

- **Docker 守护进程不可用**（WSL2 后端被安全策略阻止）⇒ 任何需要真实 Docker
  的验证**必须走 GitHub Actions 的 ubuntu runner**。
- PostgreSQL 17.5 便携版：
  - `:55433` 开发 / 视觉测量库（`v2ex_v016_visual`）
  - `:55440` 隔离单元测试实例（`bash tests/helpers/start-test-pg.sh daemon`）
- **单元测试必须连 `:55440`**：`test-db-guard.ts` 允许的端点只有
  `127.0.0.1:55440`、`127.0.0.1:5432`、`localhost:5432`。
  连开发库会被**拒绝**（这是设计意图，不是故障）。
- 测试库名必须以 `v2ex_test_` 开头或在 `ALLOWED_DB_NAMES` 白名单内。
- 本地服务：`npx next start -p 3210`（需先 `npm run build`）。

### 一个会误导人的工具现象（已确认原因）

`npx vitest run` 若因**护栏拒绝**而失败，报错栈会崩在
`extractInlineSourceMap` 的 `TypeError: code.charCodeAt is not a function`
（vite 8.3.5 / vitest 5.0.5），**把真实错误完全盖住**。
真实原因是「数据库名不在白名单」或「端点不在白名单」。
排查方法：直接 `npx tsx -e "import('./tests/helpers/global-setup.ts').then(m=>m.setup())"`
即可看到真正的 `[db-guard]` 消息。

---

## 8. 授权边界（本轮实际执行 / 未执行）

**已执行**：代码修改、测试补充、测量工具、验收流水线、文档、分支推送、PR 创建。

**未执行（需单独授权）**：

- 创建 / 推送 `v0.0.16` Tag
- 推送 `ghcr.io/…:v0.0.16` 镜像
- 创建任何 v0.0.16 Release
- 改写远端历史 / force push / 移动或删除任何既有 Tag
- 修改已发布 Release（含 v0.0.14 Notes 勘误）
- 变更仓库可见性（**保持 Public**）
- 同步版本号到 `0.0.16`（按 G-VER-01，**开发收口后**才做）

---

## 9. 下一步动作（按优先级）

1. **等 PR #57 CI 全绿 → 合并到 master**
2. **合并后触发官方包四角色验收**：
   `gh workflow run official-acceptance.yml -f version=v0.0.15`
   记录四角色 + 双用户通知的真实结果
3. **补 v0.0.16 的 Four-role E2E**（在仓库内，用双 BrowserContext + 真库）
   —— 与官方包验收互补，不重复
4. **同步文档**：`FEATURE_MATRIX` / `PAGE_INVENTORY` / `BUG_REGISTER` /
   `RISK_REGISTER` / `CHANGELOG` / `RELEASE_GATE`
5. **功能矩阵真实性审查**（第六阶段）：逐项确认
   「页面入口 → 操作 → API → 权限 → 数据库 → 测试证据」
6. **性能优化第二批**（基于基线，不凭感觉）
7. **收口后**按 G-VER-01 同步 `0.0.16`，构建候选包，停在发布门禁

---

## 10. 未完成 / 明确不做的

| 项 | 状态 |
|---|---|
| 24 小时单实例连续运行 | **未完成**（`docs/release-facts.json` 的 `soak.twentyFourHour` 保持 `not-completed`） |
| 官方包四角色验收首次运行 | **待合并后触发** |
| v0.0.14 已发布 Notes 勘误 | **未执行**（不修改已发布 Release） |
| R-01 历史清理 | **未执行**（A3 保留 + 披露） |
| 视觉基线更新 | 保留差异证据后再审查，**未擅自改基线** |
