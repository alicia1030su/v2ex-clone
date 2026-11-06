# docs/SESSION_HANDOFF_v0.0.5.md —— v0.0.5 跨会话交接

> 本文件在上下文接近上限前**必须更新**，不允许丢失工作现场。
> 每完成一个重要阶段就更新一次。

---

# 第 1 轮状态快照（2026-11-05，主理人）—— 基线恢复 + 功能审计完成

## A. 基线核实（任务书 §一，全部实测）

| 项 | 实测值 |
|---|---|
| master 最新 SHA | `f2740c30d627681d6acedf95f89f8c519a3c05d4`（"fix(release): Notes 模板内置 P7 披露段 (#21)"） |
| v0.0.4 Tag | annotated `aed641db28d3f4fa82b1450063fa975702ca0e86` → commit `c0e7396c52d6a9c887c37788de533f6e4b8c1b1f`，**未移动** |
| v0.0.4 Release | id `434929894`，`draft=false`、`prerelease=true`、`published_at=2026-11-05T08:34:24Z`，资产 `SHA256SUMS` + `v2ex-clone-v0.0.4-deploy.zip` |
| PR #5 | MERGED → `c0e7396c` |
| PR #20 | MERGED → `344371d0` |
| PR #21 | MERGED → `f2740c30` |
| CI（`f2740c30`） | CI ✅ success（run `41997210047`）、Docker/Redis 隔离验证 ✅ success（run `41997210053`） |
| 本地工作区 | 干净（0 未提交） |
| 开发分支 | **`feat/v0.0.5-product-completion`**，从 `origin/master` 创建（**非**从 v0.0.4 Tag），HEAD `f2740c30` |

> ⚠️ 本地 `master` 与远端是 squash 后的不同历史（曾尝试 merge 产生 `SESSION_HANDOFF_v0.0.4.md`
> 冲突，已 `merge --abort`）。**本地 master 落后于远端，勿在其上直接开发。**

## B. 本轮已完成

1. 创建 14 个任务跟踪项（阶段 1~14）。
2. 派发工程盘点子智能体，完成只读全仓盘点（文档 7 份 + 代码结构 6 类 + 16 个重点核查项）。
3. **实测验证盘点报告的 5 个关键结论**（全部确认）：
   - 无 `src/app/api/reports/` ⇒ 用户端举报上报端**确实缺失**
   - `api/admin/` 有 config/logs/node-requests/pending/reports/stats/users，**无 credits**
   - `adminAdjustCredits` 仅在 `credit-service.ts:204` 定义，**无调用方**
   - 版主 UI 存在：`canModerate`（`t/[id]/page.tsx:174` → `TopicActions.tsx:38`）
   - AdminConsole 7 tab：概览/用户/举报/节点申请/节点管理/操作日志/系统配置
4. **创建 `FEATURE_AUDIT_v0.0.5.md`**（13 节，含 4 处 BROKEN、P0×6 + P1×6 任务清单）。
5. 创建本交接文档。

## C. 审计核心结论（详见 FEATURE_AUDIT_v0.0.5.md）

| 领域 | 结论 |
|---|---|
| **版主 moderator** | **不是没实现，而是零测试覆盖**。`/admin` 对 isStaff 开放；`TopicActions` 有锁定/置顶/恢复按钮；建节点进 pending。但 `MODERATOR` 全仓仅 2 处 API 断言，**无一条 moderator 身份 UI 点击流** |
| **管理员 admin** | 后台是**真实 CRUD**（非文本断言），但 **E2E 仅 2 条文本存在性断言**，封禁/角色/配置/审批零 UI 流 |
| **举报系统** | **处理端齐全、上报端完全缺失** —— 整个闭环是断的（无 `POST /api/reports`、无举报按钮、无防重复/防刷、无用户可见状态） |
| **管理员积分调整** | `adminAdjustCredits` **无调用方/无端点/无 UI** ⇒ FEATURE_MATRIX 的 ✅ 标注**不实** |
| **节点申请** | 完整闭环 VERIFIED |
| 感谢/投票/关注/收藏/签到/积分(用户侧)/通知(2/5 类型) | 全链路齐备 |
| **私信** | 完全 MISSING。**产品判断：V2EX 原站无私信，建议以 @ 提代替**（schema 已定义 `mention` 但从未写入） |
| **头像** | 校验/存储强；sharp 软依赖**未安装**（实际保存原图）；**EXIF 未处理**；无前端裁剪 |
| **邮件** | SMTP 客户端完整；**无 Mailpit 基建**；`.env.example` **无 SMTP 段**；真实投递未验证 |
| **搜索** | ILIKE + pg_trgm GIN 索引（0.064ms）；**中文质量未测** |
| **楼层号** | `floor.ts` UPSERT 算法 + 5 条严格 `1..n` 断言（v0.0.4 已补，ACCEPTANCE §7.1 该条**过时**） |

### 发现的 4 处 BROKEN

1. `src/lib/content-service.ts:197` 错误文案「只有管理员可以恢复主题」与实际允许 moderator **矛盾**
2. `FEATURE_MATRIX.md`「管理员调整积分 ✅」**不实**（能力不可达）
3. `README.md`「节点申请前端入口 ❌ 未实现」**过时**（实际已实现）；「24 个页面」实测 **26 个**
4. `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md` §7.1 第 6 条「楼层连续性缺 1..n 断言」**过时**（v0.0.4 已补）

## D. v0.0.5 开发顺序（P0 优先）

1. **P0-1 用户端举报全链路**（最大缺口）
2. **P0-2 管理员积分调整**
3. **P0-3 四身份真实浏览器 E2E**
4. **P0-4 楼层规则文档化 + 100 并发**
5. **P0-5 BROKEN-1~4 修复**
6. **P0-6 安全复核补项**
7. P1：搜索实测 / 头像 sharp+EXIF / Mailpit / 多浏览器多视口 / @ 提及 / 性能压测

## E. 环境与本地纪律

- 数据库：隔离实例 `127.0.0.1:55440`（`bash tests/helpers/start-test-pg.sh start`）
- **PG 生命周期须在同一次 Bash 调用内**（工具回收进程树）
- `next build` 须清 `NODE_OPTIONS` 并关 `CODEBUDDY_SAFE_DELETE_ENABLED` / `CODEBUDDY_BROKERED_FS_HOOK_ENABLED`
- 输出不用管道（`bash x.sh | tail` 会让 postgres 继承 stdout 导致 SIGTERM）
- **bash 的 `/tmp` 与 Windows Python 路径不通**：需 `cygpath -w /tmp` 转换
- **shell 变量不跨 Bash 调用保持**：验证脚本要显式传参

## F. 下一步具体执行任务

按 §D 顺序从 **P0-1 用户端举报全链路** 开始：
1. 新建 `src/app/api/reports/route.ts`（POST 提交 + GET 我的举报）
2. `schema.ts` 的 `reports` 表已存在，需补「防重复」唯一约束迁移
3. 主题/回复页加举报按钮 + 原因选择 + 补充说明
4. `/reports` 或 `/settings` 下加「我的举报」列表与状态
5. 处理端补用户可见反馈 + 审计日志
6. E2E：游客/用户提交、重复防护、版主处理、身份不泄露

## G. 风险与授权边界

- **R-01 仍 DEFERRED**：禁止未授权改写远端历史 / force push / 删 Tag / 改 Release / 改仓库可见性
- v0.0.5 Pre-release 已获授权自主发布（任务书 §十四），**但 R-01 相关危险操作仍需单独授权**
- 不得向真实用户发测试邮件；不得用会产生额外付费的外部服务

---

# 第 2 轮状态快照（2026-11-05，主理人）—— P0-1/2/3/5 + P1-2/3 完成

> 本轮把 §D 开发顺序里的 **P0-1、P0-2、P0-3、P0-5** 与 **P1-2、P1-3** 做完。
> 累计提交 7 个（`3400c16` … `0db8418`），分支 `feat/v0.0.5-product-completion`。

## A. 已完成工作（按 §D 顺序）

| # | 任务 | 状态 | 关键产出 |
|---|---|---|---|
| P0-1 | 用户端举报全链路 | ✅ | `POST/GET /api/reports`、**部分唯一索引**防重复、`ReportButton`、`/reports` 我的举报页、处理时通知举报者、`REPORT_SUBMIT` 审计 |
| P0-2 | 管理员积分调整 | ✅ | `POST /api/admin/credits`（仅 admin）+ AdminConsole「积分」tab（二次确认 + 理由必填） |
| P0-3 | 四身份真实浏览器 E2E | ✅ | `e2e/v005-four-roles-deep.spec.ts` 11 条 + **修复 4 个真实缺陷** |
| P0-5 | 楼层规则文档化 + 100 并发 | ✅ | `docs/FLOOR_NUMBERING_v0.0.5.md` + `tests/v005-floor-concurrency.spec.ts` 6 条（调**真实** `allocateFloor`） |
| P1-2 | 头像与图片体验 | ✅ | 前端 Canvas 裁剪器（零依赖）+ 服务端 EXIF 校正/元数据剥离 + sharp 提为直接依赖 + **修复 3 个真实缺陷** |
| P1-3 | 邮件系统真实集成验证 | ✅ | `tests/v005-smtp-protocol.spec.ts` 6 条（**直测生产路径**）+ 忘记密码全链路 E2E 4 条 + **修复 4 个生产级缺陷 + 1 个环境缺陷** |
| — | BROKEN-1~4 修复 | ✅ | 见 §C |
| — | 楼层连续性文档 | ✅ | 验收清单 §5/§7.1 已更正 |

## B. 本轮发现并修复的**真实缺陷**（不是测试问题）

| # | 缺陷 | 影响 |
|---|---|---|
| 1 | 软删除后**版主无法在 UI 恢复主题**（`t/[id]/page.tsx` 对 `status==='deleted'` 直接 `notFound()`） | 管理动作不可达 |
| 2 | 软删除后 **UI 不刷新**（`onDeleted` 回调从未被传入） | 用户必须手动刷新 |
| 3 | 重复举报返回 **500 而非 409**（Drizzle 把 pg 错误码放在 `err.cause.code`） | 用户看到「网络错误」 |
| 4 | 积分 tab 对版主**可见**（权限做成内容级而非入口级） | 权限边界无法断言 |
| 5 | **SMTP 超时完全失效**（Node 空闲超时在「服务器一个字节没发」时不启动） | 邮件发送可无限挂起 |
| 6 | `SMTP_TIMEOUT_MS` 在**模块加载时固化** | 超时行为无法测试 |
| 7 | 邮件日志写入**无限挂起** | **数据库故障时「忘记密码」永远不返回** |
| 8 | `src/lib/smtp-client.ts` 是**死代码**（无任何生产调用方） | 文档失实 + 生产 SMTP 零覆盖 |
| 9 | 删除主题用 `window.location.reload()` 引发**导航竞态** | E2E 间歇失败 |
| 10 | 后台「举报」tab 文本带数量（`举报（3）`），`exact: true` 匹配不到 | 单跑绿、全量红 |
| 11 | `AvatarCropper` 的 `onError` 导致**无限重渲染** | 页面卡死 |
| 12 | **生产环境头像上传后立刻 404**（Next 只服务构建时已存在的静态文件） | 头像功能在生产**完全不可用** |
| 13 | Docker compose **没给 `public/uploads` 挂卷** | 重建容器头像全丢 |
| 14 | `start-test-pg.sh` 稳态判定用 **UTF-8 字面量匹配 GBK 日志** ⇒ 永远匹配不到 | **每次启动 PG 死等 300 秒** ⇒ 伪装成「产品代码死锁」 |

## C. 本轮同步的文档

- `FEATURE_AUDIT_v0.0.5.md`（SMTP 条目更正为「协议级实测」）
- `FEATURE_MATRIX.md`（举报 6 行 + 积分调整 + SMTP 条目）
- `CHANGELOG.md` / `docs/SECURITY_EXCEPTIONS.md`（死代码引用更正）
- `docs/FLOOR_NUMBERING_v0.0.5.md`（**新增**：楼层编号规则）
- `README.md` / `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md`（BROKEN-3/4）

## D. 当前测试基线

| 项 | 结果 |
|---|---|
| 单元测试 | **248 passed / 248（20 文件）** |
| E2E | **175 passed / 0 failed（4.4m）** |
| 类型检查 | ✅ `npx tsc --noEmit` |

## E. 本地执行纪律（**重要 —— 本轮踩了很多坑**）

1. **PG 生命周期必须在同一次 Bash 调用内** —— 工具会回收进程树，
   跨调用 PG 必被杀掉（表现为 `ECONNREFUSED 127.0.0.1:55440` / 页面 500）。
2. **不要用管道输出脚本**（`bash x.sh | tail` 会让 postgres 继承 stdout ⇒ SIGTERM）。
3. `next build` 须清 `NODE_OPTIONS` 并关 `CODEBUDDY_SAFE_DELETE_ENABLED` / `CODEBUDDY_BROKERED_FS_HOOK_ENABLED`。
4. **bash 的 `/tmp` 与 Windows Python 路径不通** —— 需 `cygpath -w /tmp`。
5. **Git Bash 会把 heredoc 里的 `\s` 转成 `/s`** —— 正则要写 `[ \t]*` 或用 Edit 工具。
6. **Playwright 的 `getAttribute()` 带 auto-wait** —— 元素不存在时等满 30 秒；
   先 `count()` 再取。
7. **`waitForHydration` 只能用于客户端组件内部的节点** —— 服务端渲染的 input 不行。
8. **E2E 里不要反复 `register()`** —— 会触发注册限流；用 seed 用户。

## F. 下一步（§D 剩余）

| # | 任务 | 优先级 |
|---|---|---|
| P0-6 | 安全与社区治理完整复核（CSRF/XSS/SQLi/SSRF/开放重定向/上传/会话/提权/暴力登录/注册滥用/举报滥用/积分重复/并发扣费/管理员越权/日志脱敏）+ 补充频率限制与审计 | **P0** |
| P1-1 | 搜索能力升级（ILIKE vs pg_trgm vs FTS vs 中文分词） | P1 |
| P1-4 | 多浏览器（Chromium/Firefox/WebKit）× 5 视口 + 移动端专项 + 视觉回归基线 | P1 |
| P1-5 | 私信与其他社区能力评估 | P1 |
| P2 | 性能压测（继承 v0.0.4 规模，覆盖新增的搜索/通知/积分路径） | P2 |
| P3 | 部署与升级验证（Linux/Windows 全新装、v0.0.4→v0.0.5 原地升级、备份恢复、镜像拉取） | P3 |
| P4 | 最终集成：CI 全绿 → 固定 SHA → 安装包 + SHA256SUMS → GHCR 镜像 + Digest → Tag → **Pre-release** → 匿名下载校验 → 真实安装运行 | P4 |

## G. 风险与授权边界（不变）

- **R-01 仍 DEFERRED**：禁止未授权改写远端历史 / force push / 删 Tag / 改 Release / 改仓库可见性。
- v0.0.5 Pre-release 已获授权自主发布，但 R-01 相关危险操作仍需单独授权。
- 不得向真实用户发测试邮件；不得用会产生额外付费的外部服务。
- **R-01 必须在 v0.0.5 Pre-release Notes 中继续披露。**

---

# 第 3 轮状态快照（2026-11-06，主理人）—— P0-6 / P1-1 / P1-4 / P1-5 完成

> 本轮把 §D 剩余的 **P0-6、P1-1、P1-4、P1-5** 做完。
> 累计提交 11 个（`3400c16` … `a1ba307`），分支 `feat/v0.0.5-product-completion`。
> **P0 全部完成**，P1 除 P1-5 外全部完成。

## A. 本轮完成的工作

| # | 任务 | 状态 | 关键产出 |
|---|---|---|---|
| P0-6 | 安全与社区治理完整复核 | ✅ | `src/lib/community-rate-limit.ts`（用户+IP 双维度）+ **21 条安全回归护栏** + 修复 4 个真实缺口 |
| P1-1 | 搜索能力升级 | ✅ | `src/lib/search-tokenize.ts`（CJK bigram，零扩展依赖）+ **两阶段搜索** + `docs/SEARCH_BENCHMARK_v0.0.5.md` |
| P1-4 | 多浏览器 × 多视口 | ✅ | `playwright.config.ts`（`E2E_CROSS=1` 展开 3 浏览器 × 5 视口 = 15 project）+ **160/160 通过** + 修复 3 个真实缺陷 |
| P1-5 | 私信与其他社区能力评估 | ✅ | `docs/COMMUNITY_FEATURES_EVALUATION_v0.0.5.md`（**实测：原站无私信功能**）+ 补齐 @ 提及这个**半成品** |

## B. 本轮发现的**真实缺陷**（累计 19 个）

| # | 缺陷 | 影响 |
|---|---|---|
| 15 | **13–32 字符的合法用户名 @ 提及静默失效**（mentions 的长度规则 3-20 vs 注册的 2-32） | 用户 @ 了但什么也没发生，且**无任何提示** |
| 16 | `body { min-width: 820px }` 从未被媒体查询覆盖 | **v0.0.4 声称的「移动端响应式重排」实际从未生效** |
| 17 | 响应式断点（600px）与桌面最小宽（820px）不匹配 | 768px 平板下主区只占 57% |
| 18 | **WebKit 在 HTTP 下拒绝存储带 `Secure` 的 Cookie** | 所有写操作 403（Chromium/Firefox 对 localhost 有放宽 ⇒ 只在 WebKit 复现） |
| 19 | `tests/v005-search-quality.spec.ts` 硬编码了本地连接串（55440） | 本地全绿 / CI 直接 ECONNREFUSED |

## C. 本轮**最重要**的教训：E2E 的三个「静默失效」陷阱

这三类问题的共同特征是：**报错完全指不到真正的原因**，且**CI 从不暴露**（CI 每次都是全新数据库 + 干净 env）。

### 陷阱 1：seed 账号的口令与当前 env 不一致 ⇒ `login()` 永远 401

- `scripts/seed.ts` 的设计是「**首次初始化**」—— 已存在的账号**只读不修改**
  （这是**正确**的生产语义：不能因重新部署就静默篡改管理员口令 / 把用户改密改回）
- 但本地 E2E 库是**历次 seed 累积**的 ⇒ `lisi` 的口令是**第一次 seed 时**的值
- 表现：`login()` 报「用户名或密码不正确」，**完全看不出**是口令来源问题
- **修法**：新增 `scripts/reset-test-credentials.ts`（**测试环境专用**，自带安全门：
  必须 `APP_RUNTIME_ENV=test` + `TEST_ENV_ISOLATED=1`；只改**种子账号**、**不改角色**），
  由 `e2e/global-setup.ts` 在启动前调用
- ⚠️ 顺带修正：`e2e/helpers.ts` 的 `clearRateLimits` 改为**多令牌回退**
  （进程 env 的令牌 + `.env.test` 的令牌都试）—— 因为 dotenv **不覆盖**已存在的变量，
  shell 里 export 的令牌会与 `.env.test` 的不同 ⇒ debug 端点 401 ⇒ **限流根本没被清**

### 陷阱 2：注册有 **IP 维度限流**（20 次 / 300 秒）

- 一次造 12 个用户 ⇒ 必然中途撞墙
- 表现：`register()` 里的 `page.waitForURL` 等满 30 秒抛 TimeoutError，
  **完全指不到「限流」**这个真正原因
- **修法**：每注册一个用户就 `clearRateLimits()` 一次（注册**前后**都清）

### 陷阱 3：`ENV_FILE=""`（空串）不等于「不设置」

- 空串 ⇒ `loadProductEnv` 走「无 ENV_FILE」分支 ⇒ 加载 `.env.local`
- `.env.local` 里**没有** `APP_RUNTIME_ENV` / `TEST_ENV_ISOLATED`
  ⇒ `isIsolatedTestEnv()` 为 false ⇒ **验证码启用** ⇒ 登录页渲染出验证码
- **修法**：跑 E2E 用 `ENV_FILE=".env.test"`

## D. 本地执行纪律（补充上轮的 8 条 ⇒ 11 条）

9. **服务端与测试进程必须用同一个 `DEBUG_ENDPOINT_TOKEN`** ——
   否则 `clearRateLimits` 静默失效 ⇒ 限流累积 ⇒ 各种莫名的 429 / 超时
10. **跑 E2E 用 `ENV_FILE=".env.test"`，不要用 `ENV_FILE=""`**
11. **一次要造多个用户时，每注册一个就清一次限流**

## E. 当前测试基线

| 项 | 结果 |
|---|---|
| 单元测试 | **322 passed / 322（24 文件）** |
| E2E（core） | 待本轮重跑确认（原 194 + 6 = 200） |
| 跨浏览器 × 跨视口 | **160 / 160 通过** |
| 类型检查 | ✅ `npx tsc --noEmit` |

## F. 下一步（§D 剩余）

| # | 任务 | 优先级 |
|---|---|---|
| P2 | 性能压测（继承 v0.0.4 规模，覆盖新增的搜索/通知/积分路径） | P2 |
| P3 | 部署与升级验证（Linux/Windows 全新装、v0.0.4→v0.0.5 原地升级、备份恢复、镜像拉取） | P3 |
| P4 | 最终集成：CI 全绿 → 固定 SHA → 安装包 + SHA256SUMS → GHCR 镜像 + Digest → Tag → **Pre-release** → 匿名下载校验 → 真实安装运行 | P4 |

## G. 风险与授权边界（不变）

- **R-01 仍 DEFERRED**：禁止未授权改写远端历史 / force push / 删 Tag / 改 Release / 改仓库可见性。
- v0.0.5 Pre-release 已获授权自主发布，但 R-01 相关危险操作仍需单独授权。
- 不得向真实用户发测试邮件；不得用会产生额外付费的外部服务。
- **R-01 必须在 v0.0.5 Pre-release Notes 中继续披露。**

---

# 第 4 轮状态快照（2026-11-06，主理人）—— P1-5 / P2 / P3 完成，P4 就绪

> 本轮完成 **P1-5、P2、P3**，并为 **P4** 清除了工程阻碍。
> 累计提交 **15 个**（`3400c16` … `6ca207a`），分支 `feat/v0.0.5-product-completion`。
> **PR #22 已 CLEAN（CI 全绿）。**

## A. 本轮完成的工作

| # | 任务 | 状态 | 关键产出 |
|---|---|---|---|
| P1-5 | 私信与其他社区能力评估 | ✅ | `docs/COMMUNITY_FEATURES_EVALUATION_v0.0.5.md`（**实测：原站无私信功能**）+ 补齐 @ 提及这个**半成品** |
| P2 | 性能压测（新增路径） | ✅ | `scripts/perf/v005-path-benchmark.ts` + `docs/PERF_BENCHMARK_v0.0.5.md` |
| P3 | 部署与升级验证 | ✅ | `scripts/release/verify-upgrade-v005.sh`（**PASS=17/FAIL=0**）+ `docs/UPGRADE_RECOVERY_v0.0.5.md` |
| — | 发布门禁参数化 | ✅ | `preflight.sh --target= / --dev-baseline=` ⇒ **FAIL=0** |

## B. 本轮发现的**真实缺陷**（累计 24 个）

| # | 缺陷 | 影响 |
|---|---|---|
| 15 | **13–32 字符的合法用户名 @ 提及静默失效**（mentions 3-20 vs 注册 2-32） | 用户 @ 了但什么也没发生，**无任何提示** |
| 16 | `body { min-width: 820px }` 从未被媒体查询覆盖 | **v0.0.4 声称的「移动端响应式重排」实际从未生效** |
| 17 | 响应式断点（600px）与桌面最小宽（820px）不匹配 | 768px 平板下主区只占 57% |
| 18 | **WebKit 在 HTTP 下拒绝存储带 `Secure` 的 Cookie** | 所有写操作 403 |
| 19 | 一个测试 spec 硬编码了本地连接串 | 本地全绿 / CI 直接 ECONNREFUSED |
| 20 | 发帖 / 回复 API 的响应**不含结构化 id** | 调用方只能解析 `redirect` 字符串 |
| 21 | 安全护栏与实现**漂移**（改了 `secure` 判定没同步护栏） | CI 立刻红 —— **这正是护栏的价值** |
| 22 | E2E 三个「静默失效」陷阱（seed 口令 / debug 令牌 / 注册限流） | 报错完全指不到真正原因 |
| 23 | 发布门禁**硬编码**目标版本与迁移条数 | v0.0.5 复用时必然 FAIL ×4 |
| 24 | **4 个 Windows 专属缺陷**（临时目录路径 / env 加载器 / psql GBK / schema 列名） | 验证脚本在 Windows 上根本跑不起来 |

## C. 本轮的核心方法论：**「先测出来，再改」**

本轮最有价值的不是代码，而是**几条被实测打脸的方法论错误**：

1. **压测必须测生产 SQL 的形态** ——
   我一开始测 `count(*)`（125ms）就以为「搜索慢到不可接受」，
   而生产查询带 `LIMIT 50` ⇒ 走倒序索引 + 早停 ⇒ **0.92ms**。
   测「更严格」的变体会得出**错误结论**，并可能引发不必要的优化。
2. **静态审查永远发现不了 Windows 专属缺陷** ——
   4 个 Windows 陷阱（路径 / env / 编码 / 列名）在 Linux 上一个都不会出现，
   只有真机实跑才能暴露。
3. **「已声称完成」的东西必须真跑一遍** ——
   v0.0.4 的「移动端响应式」从未生效、「SMTP 客户端」是死代码、
   「头像上传」在生产 404 —— 三个都是**已写进文档的 ✅**，但都是假的。

## D. 当前测试基线

| 项 | 结果 |
|---|---|
| 单元测试 | **322 passed / 322（24 文件）** |
| E2E（core） | **200 passed / 0 failed（4.4m）** |
| 跨浏览器 × 跨视口 | **160 / 160 通过**（3 浏览器 × 5 视口） |
| 升级验证 | **PASS=17 / FAIL=0** |
| 性能压测（新增路径） | 搜索 P95 **6ms** / 通知 P95 **1ms** / 积分 P95 **1ms** |
| 发布门禁（dev, target=0.0.5） | **PASS=62 / FAIL=0 / BLOCK=1**（BLOCK = R-01 授权） |
| 类型检查 | ✅ `npx tsc --noEmit` |
| CI（PR #22） | ✅ **CLEAN** |

## E. 下一步：P4（最终集成）

流程（`docs/RELEASE_PROCESS_v0.0.4.md` §5）：

1. ✅ **CI 全绿**（PR #22 已 CLEAN）
2. ⏳ **合并 PR #22** → 得到最终 SHA
3. ⏳ **版本载体一次性同步**到 `0.0.5`
   （`package.json` / `deploy/VERSION` / `deploy/.env.example` /
   `install.sh` / `install.ps1` / `docker-compose.yml` / `update.sh` /
   `CHANGELOG.md` / `README.md` / `FEATURE_MATRIX.md` / `RELEASE_GATE.md` /
   `TEST_REPORT.md` / `release.yml` 的 tag 白名单）
4. ⏳ **构建 + 推送** GHCR 镜像 `v0.0.5` ⇒ 记录 Digest
5. ⏳ **创建 Tag** `v0.0.5`（annotated，**只创建一次，永不移动**）
6. ⏳ **创建 Draft Release** ⇒ 上传安装包 + `SHA256SUMS`
7. ⏳ **匿名下载校验**（不带凭据拉取资产，验证 SHA256）
8. ⏳ **转为 Pre-release**（**不是正式 release**）
9. ⏳ **真实安装运行**（拉镜像 → 起容器 → 跑通）

## F. ⚠️ 需要主理人单独授权的事项

### R-01（Git 历史原站素材）—— **仍 DEFERRED**

- **现状**：原站 V2EX 的 HTML/CSS/JS 完整副本经 Git 历史对**所有匿名访问者**开放
  （实测 `raw.githubusercontent.com/.../75c9508/docs/evidence/assets/combo.js` → HTTP 200）。
- **本轮动作**：**只读复核 + 门禁 BLOCK 报告**，**未执行任何历史改写 / tag 移动 / 仓库删除**。
- **发布影响**：**Release 只能停在 Draft**，除非主理人授权以下之一：
  - **方案 A（推荐）**：授权「改写全部 refs 历史 + 重建 v0.0.1 tag」
    —— v0.0.1 发布仅数小时、资产下载 3 次，重建的破坏可控
    （隔离演练已证明技术可行，见 `docs/HISTORY_CLEANUP_DRILL_v0.0.4.md`）
  - **方案 B**：授权「仅删除 v0.0.1 tag（不动历史）」—— 不解决 `75c9508` 可达性
  - **方案 C**：接受风险，在 README 显著位置声明
- **R-01 必须继续在 v0.0.5 Pre-release Notes 中披露。**

### 其他危险操作（明令禁止，未授权前一律不做）

禁止未授权改写远端历史 / force push / 删 Tag / 改 Release / 改仓库可见性。

## G. 风险与授权边界（不变）

- **R-01 仍 DEFERRED**。
- v0.0.5 Pre-release 已获授权自主发布，但 R-01 相关危险操作仍需单独授权。
- 不得向真实用户发测试邮件；不得用会产生额外付费的外部服务。

---

# 第 5 轮状态快照（2026-11-06，主理人）—— 远端 CI E2E 失败修复

> 本轮**唯一任务**：修复 PR #22 的远端 CI E2E 失败（run `42142762352`）。
> 从拿到失败日志到定位根因共 6 步，每一步都有实测证据。

## A. 失败现象

远端 `E2E 测试` job 失败，1 个用例：

```
✘  188 [core] › e2e/v005-password-reset-flow.spec.ts:57:1
      › 游客：未登录也能打开「忘记密码」页
Error: listen EADDRINUSE: address already in use 127.0.0.1:3025
```

## B. 根因（两层，第一层是表象，第二层才是真正原因）

### 表层：CI 与 spec 抢同一个端口

`.github/workflows/ci.yml` 有一个「启动 fake SMTP server」步骤，
而 `e2e/v005-password-reset-flow.spec.ts` 的 `beforeAll` **自己也会起一个**
—— 两者都监听 3025 ⇒ EADDRINUSE。

fake server **必须**跑在测试进程里（测试要直接断言收到的邮件），
所以 CI 那一步是**纯冗余**。

**修法**：删掉 CI 的启动/停止步骤（只保留服务端要用的 SMTP env）。

### 深层：删掉端口冲突后，又暴露了第二个缺陷

本地以 CI 一致的环境复现，端口冲突没了，但**全链路用例返回 429**。

逐层下钻的证据链：

```
rate_limit_buckets 表实测：
  ratelimit:forgot_password_ip:127.0.0.1 | count=12 | window_start=09:45
  ratelimit:signup_ip:127.0.0.1         | count=3  | window_start=09:50
                                    ↑ 时间戳对不上 —— forgot 的计数是**旧窗口残留**
```

⇒ `clearRateLimits()` **根本没生效**。

再下钻，打印 Playwright worker 与服务端各自看到的令牌：

```
SHELL_TOKEN=ci-debug-token-not-for-production      ← shell 注入
DIAG_WORKER_TOKEN="test-debug-token-local-only"    ← worker 实际拿到的
```

**根因**：`e2e/global-setup.ts` 用 `loadEnv({ override: true })` 加载 `.env.test`
⇒ **ENV_FILE 文件覆盖了 shell 注入**。

而服务端（`next start`）继承 shell ⇒ 用 `ci-debug-token-not-for-production`。

⇒ **两边令牌不一致** ⇒ debug 端点 401 ⇒ **限流静默失效** ⇒ 429。

这与 `src/lib/env-loader.mjs` 的语义（shell > ENV_FILE > .env.local > .env）
**正好相反** —— `drizzle.config.ts` 顶部的长注释早已明确
「父进程注入的变量 → 子进程**原样**使用（最高优先级）」，
global-setup 是同一个道理的另一个实例，只是**从来没被对齐过**。

## C. 修法（两层，缺一不可）

### ① 根本修复：global-setup 的 env 语义对齐 env-loader

`loadEnv({ override: f === process.env.ENV_FILE })` → `loadEnv({ override: false })`

### ② 防御修复：`clearRateLimits` 失败时**抛错**而非静默返回

原实现失败时静默 `return` ⇒ 限流没清 ⇒ 429 ⇒
**而 429 的报错完全指不到「限流没被清」这个真正原因**。

现在：所有令牌都失败时立刻抛出，并带上每个令牌尝试过的状态码
与「测试进程与服务端令牌不一致」的排查指引。

> 这一条是本轮**最重要的工程教训**：
> **静默失效是最危险的问题形态** ——
> 它把「配置错误」伪装成「业务逻辑失败」，
> 让排查者沿着完全错误的方向花掉整轮时间。

## D. 新增回归护栏（5 条）

`tests/v005-e2e-fixtures.spec.ts`：

| # | 断言 | 挡住什么 |
|---|---|---|
| 1 | 没有两个 E2E spec 声明同一个固定端口 | 将来再加一个 spec 起 3025 |
| 2 | `FakeSmtpServer` 只通过 `start()` 的 options 指定端口 | 绕过 `start()` 的错误处理 |
| 3 | fake SMTP server 由 spec 自己的 `beforeAll` 启动 | 依赖外部启动方 |
| 4 | CI workflow 没有真实的 fake SMTP 启动命令 | **历史上真实踩过的坑** |
| 5 | `FakeSmtpServer.start` 对 EADDRINUSE 给出清晰错误 | 裸错误指不到真正原因 |

## E. 本轮实测

| 项 | 结果 |
|---|---|
| 单元测试 | **327 passed / 327（25 文件）**（原 322 + 5） |
| 密码重置 E2E（CI 一致 env） | **4 / 4 通过** |
| 全量 E2E（CI 一致 env） | 见下（本轮重跑确认） |
| 类型检查 | ✅ `npx tsc --noEmit` |

---

# 第 6 轮状态快照（2026-11-06，主理人）—— 远端 CI E2E 失败已修复

> 本轮**唯一任务**（任务书 §一）：修复 PR #22 的远端 CI E2E 失败。
> 远端 run：`42142762352`。修复提交：`ff18c1d` / `3ae22ed` / `d480f02` / `5b9f8e3`。

## A. 远端失败现象

```
E2E 测试 job FAILED
✘ 188 [core] › e2e/v005-password-reset-flow.spec.ts:57:1
      › 游客：未登录也能打开「忘记密码」页
Error: listen EADDRINUSE: address already in use 127.0.0.1:3025
```

## B. 根因（两层）

### 表层：CI 与 spec 抢同一个端口

CI 有「启动 fake SMTP server」步骤，spec 的 `beforeAll` 也起一个 —— 都监听 3025。
fake server **必须**跑在测试进程里 ⇒ CI 那步是**纯冗余且有害**。

**修法**：删掉 CI 的启动/停止步骤。

### 深层：删掉端口冲突后，又暴露了第二个缺陷

以 CI 一致环境本地复现，端口冲突没了，但**全链路用例返回 429**。

证据链：
```
rate_limit_buckets 实测：
  ratelimit:forgot_password_ip:127.0.0.1 | count=12 | window_start=09:45
  ratelimit:signup_ip:127.0.0.1         | count=3  | window_start=09:50
```
⇒ `clearRateLimits()` 根本没生效。

再下钻：
```
SHELL_TOKEN=ci-debug-token-not-for-production      ← shell 注入
DIAG_WORKER_TOKEN="test-debug-token-local-only"    ← worker 实际拿到的
```

**根因**：`e2e/global-setup.ts` 用 `loadEnv({ override: true })`
⇒ **ENV_FILE 文件覆盖了 shell 注入**，而服务端（next start）继承 shell
⇒ 两边令牌不一致 ⇒ debug 端点 401 ⇒ **限流静默失效** ⇒ 429。

这与 `src/lib/env-loader.mjs` 的语义（shell > ENV_FILE > …）**正好相反**
—— `drizzle.config.ts` 顶部的长注释早已明确「父进程注入的变量最高优先级」，
global-setup 是同一个道理的另一个实例，只是**从来没被对齐过**。

## C. 修法（两层，缺一不可）

1. **根本**：`global-setup` 的 `override` 改为恒 `false`，对齐 env-loader
2. **防御**：`clearRateLimits` 失败时**抛错**而非静默返回
   （原实现静默 ⇒ 限流没清 ⇒ 429 ⇒ 而 429 完全指不到真正原因）

> **本轮最重要的工程教训**：
> **静默失效是最危险的问题形态** ——
> 它把「配置错误」伪装成「业务逻辑失败」，
> 让排查者沿着完全错误的方向花掉整轮时间。

## D. 新增回归护栏（`tests/v005-e2e-fixtures.spec.ts`，5 条）

固定端口唯一性 / `FakeSmtpServer` 只走 `start()` / fake server 由 spec 自己起 /
CI 不得有 fake SMTP 启动命令 / `FakeSmtpServer.start` 对 EADDRINUSE 给出清晰错误。

## E. 新增 `scripts/ci/run-e2e-locally.sh`

把 CI 的 e2e job 固化成脚本（建全新库 → migrate → seed → build → 启动 → E2E → 收尾）。
**为什么需要**：用超长一行 shell 命令复现 CI 时，某一步失败会让后续 `export` 不执行
⇒ `LOCAL_BASE` 没设上 ⇒ **175 个用例一起挂**，而报错指不到「export 没执行」。

## F. ⚠️ 本机 Windows 的 build EPERM 问题（**未根治，如实记录**）

`next build` 报 `EPERM: operation not permitted, open '.next\trace'`。

实测结论：
- **不是确定性缺陷** —— 完全相同的命令序列有时 rc=0、有时 EPERM
- 与 `rm -rf` / `mv` / 残留进程都**不是**单一因果关系（逐一验证过）
- 机制疑与 Windows 文件系统「目录刚被重命名后的元数据提交 / 杀毒扫描」有关，**未能查明**

**当前处理**：
- 脚本对 EPERM **免疫**（识别后清理 + 有限重试，非 EPERM 失败立即中断）
- 脚本支持 `SKIP_BUILD=1` 复用已有 `.next`
- **CI（Linux）上不存在此问题** —— 远端 CI 是更权威的验证环境

⚠️ 这不是「盲目重跑碰运气」：重试只针对**已识别的 EPERM**、次数有限、每次有明确日志。

## G. 本轮实测

| 项 | 结果 |
|---|---|
| 单元测试 | **327 passed / 327（25 文件）** |
| 密码重置 E2E（本地 CI 等价：全新库 + CI env） | **4 / 4 通过** |
| 本地 CI 等价复现自检 | **PASS=8 / FAIL=0**（含 debug 端点可用性自检） |
| 全量 E2E（本地） | 见下（受 Windows build 偶发问题影响） |
| 远端 CI | ⏳ **待确认**（已推送 4 个修复提交） |

## H. 下一步

等远端 CI 结果。若全绿 ⇒ 按任务书 §二 进入 v0.0.5 发布准备
（代码审查 → CHANGELOG/FEATURE_MATRIX/BUG_REGISTER/RISK_REGISTER/SESSION_HANDOFF 检查 →
发布门禁 → 固定 SHA 构建 → 真实安装验证 → SHA256SUMS → 候选镜像 → Digest 核验）。

**R-01 未解决前不建正式 Tag、不发公开 Pre-release。**
