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
