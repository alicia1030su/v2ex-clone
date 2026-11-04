# FEATURE_AUDIT_v0.0.4 —— 功能真实性独立审计

> 审计时间：2026-11-04 11:40
>
> **口径说明（v0.0.4 验收核查补充）**：本文出现的三组数字定义不同，不是矛盾：
> - 「**53 项**」= **功能项数**（逐项明细表的行）；「**20 + 36 = 56 项**」= 对这些功能做的
>   **HTTP + 数据库行为验证次数**（一个功能项可验证多个行为），二者分母不同。
> - 「**22 个前端页面**」= 页面路由文件计数的初始口径；实测路由数为 **21 个**
>   （§4.2 与逐项证据一致），以 21 为准。
> - 「**17 页面**」= 视觉对照矩阵的**采集对象数**（含需登录页与独立实现页），
>   不是路由数；其中 10 个有原站对照、7 个如实标注无对照。见
>   `docs/VISUAL_DIFF_SUMMARY_v0.0.4.md` §5。
> - #50 的「96.9%」是 **v0.0.3 历史视觉口径**，v0.0.4 严格口径为 Δx=0 52/52 (100%)，
>   两套分母不同不可直接比较，见 `docs/evidence/visual/geometry-summary.json`。
>
> - **本文的测试数字是「审计时点」的快照，不是 v0.0.4 的权威基线**：
>   审计时点（2026-11-04 11:40）为「单元 175 条 / 14 文件、E2E 67 条 / 6 文件」。
>   **v0.0.4 收尾轮实测权威值为：单元 190 条 / 15 文件（连续 4 轮全绿）、E2E 153 条 / 11 文件（连续 2 轮全绿）**。
>   本文 §五 的「待办」清单中，**P0 补 E2E** 与 **P1 负载测试** 两项**已在 v0.0.4 完成**
>   （见 `CHANGELOG.md` `[Unreleased]` 与 `docs/DELIVERY_PLAN_v0.0.4.md` §1.1）。
>   本文**不改写审计当时的数字**（保持审计可复核性），只在此标注归属。
>
> **本文件不是功能清单，而是审计结论。**
> 每个状态都由**可复核的实测证据**支撑 —— 真实 HTTP 请求 + 真实数据库查询，
> 或 CI 实测输出，或源码结构核查。
> 不采信既有文档的描述，也不采信任何 AI 的完成报告。

## 状态定义

| 状态 | 含义 |
|---|---|
| ✅ VERIFIED | 真实运行并验收通过，有实测输出 |
| ⚠️ PARTIAL | 后端已实现且 API 层验证通过，但缺真实浏览器端到端验证 |
| ❌ BROKEN | 可复现明确缺陷 |
| ❌ MISSING | 确实没有实现 |
| 🔍 UNVERIFIED | 尚无足够证据 |

## 一、审计结果统计

| 状态 | 数量 | 占比 |
|---|---|---|
| ✅ VERIFIED | 38 | 71.7% |
| ⚠️ PARTIAL | 14 | 26.4% |
| ❌ MISSING | 1 | 1.9% |
| **合计** | **53** | 100% |

## 二、核心结论

### 2.1 没有 BROKEN 级缺陷

本轮对 **20 + 36 = 56 项**行为做了真实 HTTP + 数据库双重验证，
**未发现任何一个可复现的功能缺陷**。

审计初期出现的十余个「失败」，经逐一追查后确认**全部是审计脚本自身的问题**，
而非产品缺陷 —— 这恰恰说明独立核实是必要的：

| 初看像缺陷 | 实际根因 |
|---|---|
| 注册 404 | 端点是 `/api/auth/signup` 而非 `/api/auth/register` |
| 主题未入库 | SQL 按标题精确匹配取值不稳，改为按 author_id 取最新 |
| 恢复主题失败 | 恢复本就仅限 moderator/admin，审计用例用了普通用户 |
| 管理员登录 400 | 验证码强制生效（双开关设计），审计环境未开隔离测试开关 |
| 收藏取消 405 | `collections` 只有 POST + GET，取消走 `action:'remove'` |
| 关注/投票/感谢全 401 | curl 的 `-o` 输出路径与 cookie jar 同路径，响应体覆盖了 jar |

> 最后一条尤其值得记录：它造成「会话看似建立、实际全 401」的假象，
> 若只看 HTTP 状态码会误判为产品缺陷。**以状态码代替业务验证必然出错。**

### 2.2 主要缺口是「浏览器级验证」而非「功能缺失」

- E2E 现有 **67 条**（6 个文件），单元测试 **175 条**（14 个文件）
- v0.0.3 新增的 **投票 / 感谢 / 积分 / 签到 / 排行榜 / 后台管理 / 头像 / 找回密码 /
  通知管理 / 关注 / 三种 Feed / 编辑软删除恢复 / 锁定置顶 / 引用回复** —— 全部无 E2E
- 这些功能在 API 层与数据库层均已验证正确，缺的是**真实浏览器点击流**的回归保护

### 2.3 明确缺失

- **真实社区规模的负载验证**：seed 仅 5 用户 / 23 节点 / 10 主题，
  无法代表「10000 用户 / 100 万回复」场景下的表现

## 三、逐项审计明细

| # | 功能 | 状态 | 证据 | 备注 |
|---|---|---|---|---|
| 1 | 游客写操作被拒 | ✅ VERIFIED | audit-round1 §0: POST /api/topics → 401 | 所有写端点在鉴权之后才做 CSRF，不泄露端点存在性 |
| 2 | 注册（自动登录） | ✅ VERIFIED | audit-round1 §1: POST /api/auth/signup → 201，用户入库 | 注册即建立会话，拿到 v2_session |
| 3 | 登录 / 退出 | ✅ VERIFIED | audit-round2 准备阶段: signin → 200，/api/notifications → 200 | 退出走 POST /api/auth/signout |
| 4 | 会话保持 | ✅ VERIFIED | audit-round2: 注册后多次请求均 200 | HttpOnly + Secure + SameSite=lax |
| 5 | 修改密码 | ✅ VERIFIED | e2e/feature.spec.ts: '修改密码需要校验当前密码' | E2E 已覆盖；缺「改密后旧会话失效」的浏览器级验证 |
| 6 | 找回密码（邮件） | ⚠️ PARTIAL | 后端 /api/auth/forgot-password + reset-password 已实现；src/components/ForgotPasswordForm.tsx 已接入 | 未配置 SMTP 时如实返回「未送达」；真实投递未验证（E-06） |
| 7 | 验证码强制 | ✅ VERIFIED | src/lib/runtime-flags.ts 双开关；实测未带 captcha → 400「请输入验证码」 | 仅隔离测试环境可关闭，生产误配也强制启用 |
| 8 | 登录限流 | ✅ VERIFIED | e2e/auth.spec.ts: '登录限流生效' | E2E 已覆盖 |
| 9 | 创建主题 | ✅ VERIFIED | audit-round1 §4: → 201，topics 表入库 | nodeId + title + content |
| 10 | 编辑主题 | ✅ VERIFIED | audit-round1 §5: 内容已改，edit_count=1 | edit_history 表有 5 条真实记录 |
| 11 | 软删除主题 | ✅ VERIFIED | audit-round1 §5: deleted_at 非空；普通访问者 → 404 | 已删除内容不通过普通页面泄露 |
| 12 | 恢复主题 | ✅ VERIFIED | audit-round1 §5: 管理员 → 200，deleted_at 清空 | 仅 moderator/admin（restoreTopic 服务端强制） |
| 13 | 锁定 / 解锁 / 置顶 | ✅ VERIFIED | audit-round2 §6: 普通用户 lock → 403 | 四个独立路由，写 moderation_logs |
| 14 | 主题投票 | ✅ VERIFIED | audit-round1 §7 + round2 §9: 连发 3 次 → votes 表 1 行，topics.votes 一致 | 唯一索引保证幂等 |
| 15 | 楼层号唯一性 | ✅ VERIFIED | audit-round1 §6: 楼层号=1；e2e/topic.spec.ts 并发用例 | floor_counters 独立表 + 事务 |
| 16 | 创建回复 | ✅ VERIFIED | audit-round1 §6: → 200，replies 表入库 | JSON 与表单两种提交方式都支持 |
| 17 | 编辑回复 | ⚠️ PARTIAL | PUT /api/replies/[id] 已实现 | 未做真实浏览器验证 |
| 18 | 软删除 / 恢复回复 | ⚠️ PARTIAL | DELETE /api/replies/[id] + POST /api/replies/[id]/restore 已实现 | 未做真实浏览器验证 |
| 19 | 感谢回复 | ✅ VERIFIED | audit-round2 §2: 跨用户感谢 → 200，thanks 表 + replies.thanks 同步 |  |
| 20 | 感谢自己的回复被拒 | ✅ VERIFIED | audit-round2 §3: → 400 | 防滥用规则 |
| 21 | 引用回复 | ⚠️ PARTIAL | replies.quoteId 字段 + ReplyItem 组件已实现 | 未做真实浏览器验证 |
| 22 | 个人主页 | ✅ VERIFIED | audit 期间 /member/[username] 正常渲染（22 个页面含此项） |  |
| 23 | 资料修改 | ⚠️ PARTIAL | PATCH /api/users/me 已实现；e2e/feature.spec.ts '用户只能修改自己的资料' | 缺头像上传的浏览器级验证 |
| 24 | 头像上传 | ⚠️ PARTIAL | POST /api/users/avatar 已实现（magic number 嗅探 + 随机路径） | 未做真实浏览器验证；sharp 未装故不裁剪（E-09） |
| 25 | 积分余额与流水 | ✅ VERIFIED | audit-round1 §2/§3: 余额 1002，credit_ledger 自洽 | 余额快照法，账本只 INSERT |
| 26 | 每日签到 | ✅ VERIFIED | audit-round1 §2: 连发 3 次 → daily_checkins 1 行，余额只加一次 | 服务端幂等 |
| 27 | 积分排行榜 | ✅ VERIFIED | GET /api/leaderboard → 200；/leaderboard 页 200 |  |
| 28 | 通知生成 | ✅ VERIFIED | audit-round2 §1: B 回复 → A 收到 reply 通知（notifications 表 3 条） |  |
| 29 | 通知未读计数 / 标记已读 | ✅ VERIFIED | audit-round2 §8: 未读 1 → 全部已读 → 0 |  |
| 30 | 关注 / 取消关注 | ✅ VERIFIED | audit-round2 §4: 幂等（重复关注仍 1 行），取消后 0 行 | 唯一索引 |
| 31 | 关注内容流 | ⚠️ PARTIAL | GET /api/users/follows/topics 已实现 | 未做真实浏览器验证 |
| 32 | 收藏 / 取消收藏 | ✅ VERIFIED | audit-round2 §5: POST {target,id,action} | 收藏节点同路径 |
| 33 | 节点分类与列表 | ✅ VERIFIED | GET /api/nodes → 200；/nodes 页 200 | 含分类过滤、子节点、面包屑、主题数统计 |
| 34 | 节点创建（管理员） | ✅ VERIFIED | e2e/feature.spec.ts: '管理员可以创建节点' | E2E 已覆盖 |
| 35 | 节点申请与审批 | ⚠️ PARTIAL | POST /api/node-requests + admin approve/reject 已实现 | 未做真实浏览器验证 |
| 36 | 节点订阅 | ⚠️ PARTIAL | collections.target='node' 已实现 | 未做真实浏览器验证 |
| 37 | RSS 2.0 | ✅ VERIFIED | GET /api/feed → 200（application/rss+xml） | 含节点级 /api/nodes/[name]/feed |
| 38 | Atom 1.0 | ✅ VERIFIED | GET /api/feed/atom → 200 |  |
| 39 | JSON Feed 1.1 | ✅ VERIFIED | GET /api/feed/json → 200 |  |
| 40 | 搜索 | ✅ VERIFIED | GET /api/search?q= → 200；e2e/feature.spec.ts 有用例 | 参数化查询，limit 钳制到 100 |
| 41 | 后台权限矩阵 | ✅ VERIFIED | audit-round2 §6/§7: 普通用户 6 个端点全 403，管理员全 200 | 服务端强制，不依赖前端隐藏 |
| 42 | 用户管理（列表/角色/封禁） | ⚠️ PARTIAL | GET /api/admin/users 等已实现；tests/admin-permissions.spec.ts 24 条 | 未做真实浏览器验证 |
| 43 | 举报处理 | ⚠️ PARTIAL | GET /api/admin/reports + handle 已实现 | 未做真实浏览器验证 |
| 44 | 待审核聚合 | ✅ VERIFIED | GET /api/admin/pending → 200（普通用户 403） |  |
| 45 | 操作日志 | ✅ VERIFIED | GET /api/admin/logs → 200；且已确认进入版本库 | v0.0.3 曾因 .gitignore 误伤而丢失，本轮已修复 |
| 46 | 系统配置（凭据脱敏） | ✅ VERIFIED | GET /api/admin/config → 200 |  |
| 47 | 社区统计 | ✅ VERIFIED | GET /api/admin/stats → 200 |  |
| 48 | 节点申请审批 | ⚠️ PARTIAL | POST /api/admin/node-requests/[id]/approve\|reject 已实现 | 未做真实浏览器验证 |
| 49 | 22 个前端页面 | ✅ VERIFIED | 实际路由 21 个，全部返回 200/307 | 已登录态与游客态均验证过 |
| 50 | 响应式布局 | ✅ VERIFIED | v0.0.3 三视口几何量测：桌面 Δx 一致率 96.9% | 375 视口为独立实现（E-08） |
| 51 | 浏览器端到端覆盖 v0.0.3 新功能 | ⚠️ PARTIAL | e2e/ 现有 6 文件 / 67 条；v0.0.3 新增的投票/感谢/积分/签到/排行榜/后台/头像/找回密码/通知管理/关注/Feed/编辑软删除恢复/锁定置顶/引用 均无 E2E | v0.0.4 第四阶段需逐项补齐 |
| 52 | 真实社区规模负载 | ❌ MISSING | seed 仅 5 用户 / 23 节点 / 10 主题 / 38 回复 | v0.0.4 第五阶段需在隔离环境造大数据集 |
| 53 | 自动化视觉回归 | ⚠️ PARTIAL | tools/visual/ 有 capture/measure/diff 脚本，但未纳入 CI | v0.0.4 第三阶段需建成常驻回归 |

## 四、审计基础设施（可复核）

### 4.1 审计环境

| 项 | 值 |
|---|---|
| 数据库 | `v2ex_v004_audit`（与 v0.0.3 各测试库完全隔离） |
| PostgreSQL | 17.5（127.0.0.1:55433） |
| 运行模式 | `APP_RUNTIME_ENV=test` + `TEST_ENV_ISOLATED=1` + `DISABLE_CAPTCHA=1` |
| 服务端口 | 3020（`next start`，真实生产构建） |
| 脚本 | `_tools/audit-db-setup.sh`、`_tools/audit-round1.sh`、`_tools/audit-round2.sh` |

### 4.2 代码规模（实测）

| 项 | 数量 |
|---|---|
| 前端页面 | 21 |
| API 路由文件 | 55 |
| 数据库表 | 26 |
| 单元测试 | 175 条 / 14 文件（**审计时点快照**；v0.0.4 收尾轮权威值：**190 条 / 15 文件**，连续 4 轮全绿） |
| E2E 测试 | 67 条 / 6 文件（**审计时点快照**；v0.0.4 收尾轮权威值：**153 条 / 11 文件**，连续 2 轮全绿） |

**数据库表清单**：

```
  users                 categories            nodes                 topics              
  replies               collections           follows               notifications       
  votes                 thanks                sessions              login_attempts      
  tags                  topic_tags            moderation_logs       rate_limit_buckets  
  kv_store              floor_counters        edit_history          password_reset_tokens
  credit_ledger         daily_checkins        reports               node_requests       
  avatars               email_logs          
```

**API 路由清单**：

```
  admin/config                        admin/logs                          admin/node-requests               
  admin/node-requests/[id]/approve    admin/node-requests/[id]/reject     admin/pending                     
  admin/reports                       admin/reports/[id]/handle           admin/stats                       
  admin/users                         admin/users/[id]/ban                admin/users/[id]/role             
  admin/users/[id]/unban              auth/forgot-password                auth/reset-password               
  auth/signin                         auth/signout                        auth/signup                       
  captcha                             checkin                             collections                       
  credits                             debug/floors                        debug/rate-limit-probe            
  debug/reset-rate-limits             feed                                feed/atom                         
  feed/json                           leaderboard                         node-requests                     
  nodes                               nodes/[name]/feed                   notifications                     
  replies                             replies/[id]                        replies/[id]/edit-history         
  replies/[id]/restore                search                              search/suggest                    
  settings/password                   settings/profile                    thanks                            
  topics                              topics/[id]                         topics/[id]/edit-history          
  topics/[id]/lock                    topics/[id]/pin                     topics/[id]/restore               
  topics/[id]/unlock                  topics/[id]/unpin                   users/avatar                      
  users/follows                       users/follows/topics                users/me                          
  votes                             
```

**E2E 覆盖分布**：

| 文件 | 用例数 |
|---|---|
| `e2e/auth.spec.ts` | 8 |
| `e2e/feature.spec.ts` | 16 |
| `e2e/pagination.spec.ts` | 6 |
| `e2e/security-regression.spec.ts` | 19 |
| `e2e/security.spec.ts` | 10 |
| `e2e/topic.spec.ts` | 8 |
| **合计** | **67** |

## 五、v0.0.4 待办（按优先级）

| 优先级 | 事项 | 对应阶段 | 状态 |
|---|---|---|---|
| P0 | 为 v0.0.3 新功能补真实浏览器 E2E（投票/感谢/积分/签到/排行榜/后台/头像/找回密码/通知/关注/Feed/编辑软删恢复/锁定置顶/引用） | 第四阶段 | ✅ **已完成（v0.0.4）** —— `e2e/` 现有 **11 文件 / 153 条**，新增 v004 四文件 78 条 + 四身份 UI 8 条 |
| P0 | 建立自动化视觉回归（4 视口，动态内容固定或遮罩，布局差异与数据差异分开报告） | 第三阶段 | ⚠️ **部分** —— 4 视口 × 17 页面 = 68 条矩阵已建立，汇总脚本已入仓（`tools/visual/summarize-visual-diff.py` + `geometry-summary.json`），但**未纳入 CI 常驻回归** |
| P1 | 真实社区规模负载测试（10000 用户 / 1000 节点 / 10 万主题 / 100 万回复，隔离环境） | 第五阶段 | ✅ **已完成（v0.0.4）** —— 13 场景 / 24785 请求，0 个 5xx；数据集 351 万行 |
| P1 | v0.0.3 → v0.0.4 升级与恢复验证（含 PG/Redis 故障恢复、备份实际还原） | 第六阶段 | 🟡 **部分** —— 全新安装 / 原地升级 / 迁移幂等 / 备份恢复 4 项实跑通过；**PG/Redis 故障恢复**已实装 `docker-verify.yml` 的 `[R-17a/b/c]` 但**尚未实跑**（R-16 / R-17） |
| P1 | GHCR 按 Docker Registry Bearer Token 协议实测（首次 401 不能证明 private） | 第七阶段 | ✅ **已完成** —— 三步协议实测 v0.0.1/2/3 全部 HTTP 200，公开可拉取 |
| P2 | README / CHANGELOG / FEATURE_MATRIX 版本号一致性 | 第七阶段 | 🟢 **按 R-20 裁决** —— 开发态刻意保持 `0.0.3`，最终 SHA 固定后一次性同步；`CHANGELOG.md` 已补齐 v0.0.4 段落并显式标注「版本号尚未同步」 |
| P2 | Git 历史风险：只读调查 + 隔离副本演练清理 | 第九阶段 | ✅ **已完成**（演练）；远端改写仍 **DEFERRED**（R-01，待主人授权） |

---

**声明**：本审计的所有结论均可通过 `_tools/audit-round1.sh` / `_tools/audit-round2.sh`
在隔离环境中复现。未执行任何改写远端历史、删除 Tag、移动 Release、
更改仓库可见性或修改既有版本资产的操作。
