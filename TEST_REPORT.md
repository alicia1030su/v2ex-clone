# 测试报告（TEST_REPORT）

> 本报告的每个数字都来自**真实运行**。
> 未执行的项明确标注为「未执行」并说明原因，不做推测性声明。

## 单元测试

| 项 | 值 |
|---|---|
| 套件数 | **14** |
| 用例总数 | **185** |
| 通过 | **185** |
| 失败 | **0** |
| 跳过 | **0** |
| v0.0.2 基线 | 117 条（全部保留，无删减） |
| v0.0.3 新增 | 68 条 |

### 新增测试文件

| 文件 | 用例 | 覆盖内容 |
|---|---|---|
| `tests/content-lifecycle.spec.ts` | 13 | 软删除不泄露、幂等（投票/感谢）、并发楼层唯一、编辑历史、权限矩阵实测 |
| `tests/password-reset.spec.ts` | 11 | 令牌哈希存储、过期/撤销/重放、并发消费、改密后会话失效、邮箱脱敏 |
| `tests/credits-concurrency.spec.ts` | 8 | 幂等键并发、30 并发扣费不产生负余额、账本自洽、签到并发 |
| `tests/admin-permissions.spec.ts` | 24 | 11 项权限 × 3 角色逐条比对、401/403 区分、危险操作不存在性扫描 |
| `tests/feed-search.spec.ts` | 12 | XML 结构有效性、特殊字符转义、RFC822/3339 格式、SQL 注入防护、分页上限 |

### 六类测试要求对照

| 要求 | 覆盖位置 |
|---|---|
| 正常流程测试 | 各测试文件的 happy path 用例 |
| 非法输入测试 | `admin-permissions`（非法角色）、`feed-search`（畸形输入）、`password-reset`（畸形令牌） |
| 越权测试 | `admin-permissions`（权限矩阵）、`content-lifecycle`（canModifyOwnContent） |
| 重复请求测试 | `content-lifecycle`（投票/感谢幂等）、`credits-concurrency`（幂等键） |
| 并发测试 | `content-lifecycle`（12 并发回复 / 8 并发感谢）、`credits-concurrency`（30 并发扣费） |
| 数据一致性测试 | `credits-concurrency`（账本自洽）、`content-lifecycle`（计数一致） |
| 页面交互测试 | E2E（见下） |

## 真实 HTTP 端到端验证

> 真实 `next start` + 真实 PostgreSQL + curl 发起真实请求（非 mock）。

| 验证项 | 结果 |
|---|---|
| 投票连发 3 次（幂等） | topics.votes=1、votes 表 1 行 ✅ |
| 感谢自己的回复 | HTTP 400「不能感谢自己的回复」✅ |
| 签到连发 3 次（幂等） | daily_checkins 1 行、余额只加一次（1000→1002）✅ |
| 未登录访问管理 API | HTTP 401 ✅ |
| 普通用户 POST /api/topics/1/lock | HTTP 403 权限不足 ✅ |
| 普通用户 POST /api/topics/1/pin | HTTP 403 权限不足 ✅ |
| 普通用户访问 5 个管理 API | 全部 HTTP 403 ✅ |
| 软删除主题 —— 未登录访问 | HTTP 404（不泄露）✅ |
| 软删除主题 —— 普通用户访问 | HTTP 404（不泄露）✅ |
| 登录后主题页渲染 | 操作栏/赞/锁定/置顶/删除 全部可见 ✅ |

## 并发压力验证

> 真实 `next start` + 真实 PostgreSQL，多个并发 curl 请求打同一端点，
> 结束后用 SQL 校验不变量。

| 场景 | 并发数 | 结果 |
|---|---|---|
| 并发回复（楼层号唯一性） | 30 | ✅ 25 条入库（5 条被限流拦），**重复楼层 0 组**，`topics.replies_count` 与实际一致 |
| 并发感谢同一回复 | 20 | ✅ `thanks` 表与 `replies.thanks` 字段一致 |
| 并发投票同一主题 | 20 | ✅ `votes` 表 1 行，`topics.votes` 汇总一致 |
| 并发签到 | 10 | ✅ 今日签到记录 **只 1 条**，余额不重复增加 |
| 负余额检查 | 全库 | ✅ 负余额用户数 **0** |
| 账本自洽检查 | 全库 | ✅ `balance_before + amount <> balance_after` 的行数 **0** |
| 孤儿流水检查 | 全库 | ✅ **0** |

> 说明：并发感谢场景因目标回复的作者就是操作者本人（不能感谢自己的回复），
> 故计数保持 0 —— 这本身是防滥用规则生效的表现。

## 数据库迁移与升级测试

| 项 | 结果 |
|---|---|
| v0.0.2 结构库（18 表）→ 应用 0001 | ✅ 升级后 26 表、8 个新表全部创建、枚举全部正确 |
| 升级前后数据指纹比对 | ✅ 完全一致（users/topics/replies/nodes/balance/管理员口令哈希均未变） |
| 迁移幂等性 | ✅ 连续应用 3 次全部 exit=0，最终 26 表 / 38 约束 |
| 全新库安装迁移 | ✅ `migrations applied successfully!` |
| 迁移脚本幂等保护 | ✅ `CREATE TABLE/INDEX/ADD COLUMN` 加 `IF NOT EXISTS`；`CREATE TYPE/ADD CONSTRAINT` 包入 `DO $$ ... EXCEPTION WHEN duplicate_object` |

## 视觉测试

| 视口 | 测量项 | Δx 一致率 | Δw 一致率 |
|---|---|---|---|
| 1280 × 900 | 64 | 96.9% | 90.6% |
| 1920 × 1080 | 64 | 96.9% | 90.6% |
| 375 × 812 | 64 | 34.4% | 56.2%（响应式重排，见 VISUAL_DIFF_REPORT） |

原始数据：`docs/evidence/visual/layout-measurements-*.json`

## 静态检查与构建

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npx next build` | ✅ Compiled successfully |
| `npm audit` | ✅ 0 漏洞（v0.0.2 修复后保持） |

## 未执行 / 如实标注

| 项 | 状态 | 原因 |
|---|---|---|
| 镜像漏洞扫描（Trivy/Grype） | ⚠️ 本机无 Docker | 需在 CI 的 Docker job 执行；本轮 CI 会跑 |
| 多浏览器视觉回归（Firefox/Safari） | ⚠️ 未执行 | 本机只装了 Chromium 与 Edge；CI 可扩展 |
| 基础负载测试（k6 等） | ⚠️ 未执行 | 本轮用并发单元测试与并发 HTTP 验证覆盖了正确性，但未做吞吐量压测 |
| 原站移动版比对 | ❌ 未做 | 无原站移动版证据；本项目为独立替代实现 |

