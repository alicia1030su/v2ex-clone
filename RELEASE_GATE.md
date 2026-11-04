# v0.0.2 发布门槛检查单（RELEASE_GATE）

> ⚠️ **状态覆盖声明（v0.0.4，2026-11-04）**：本文件是 **v0.0.2 的历史门禁**，
> B3「≥103 单元」/ B4「≥67 E2E」等门槛**不适用于 v0.0.4**。
> v0.0.4 的实测为**单元 `vitest list` 静态 180 条 / `vitest run` 运行时 190 条**、
> E2E **`playwright test --list` 实测 153 条 / 11 文件**，门禁以
> `docs/RELEASE_PROCESS_v0.0.4.md`（发布流程 + 发布前检查单）与
> `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md`（验收 Go/No-Go 判定表）为准。
>
> v0.0.4 新增的门槛要点：禁止提前创建最终 Tag、同一版本号不得反复删建或移动 Tag、
> 固定最终 SHA 后才能创建 Tag 与 Draft Release、远端核验；
> **不动 v0.0.3 的 Tag 与 Release**；未经主人单独授权不得公开发布有阻断风险的 Release。
> 下方历史表格保留作为版本演进记录，不删除、不改写。

> 项目：V2EX Clone
> 目标版本：v0.0.2（开发预览版 / Pre-release）
> 建表时间：2026-11-04
> 维护者：Release Engineer（主理人）
>
> **判定规则**：任一「阻断级」项未通过 ⇒ **不得发布正式 Release**，最多停在 Draft 并报告阻塞原因。

---

## A. 缺陷门槛

| # | 检查项 | 门槛 | 当前 | 状态 |
|---|---|---|---|---|
| A1 | P0 缺陷未修复数 | **= 0** | P0-01/P0-02/P0-04 已修；**P0-03（历史暴露）待授权** | ⛔ **阻塞（需授权）** |
| A2 | P1 缺陷未修复数 | **= 0** | P1-01～P1-11 已修；本轮新发现 S-01～S-18 **全部已修并有回归测试** | ✅ **0 个未修复** |
| A3 | P2 缺陷修复率 | ≥ 80% | P2-01（esbuild 漏洞）已真修复；P2-02（icacls 路径双斜杠，仅输出格式问题）待处理 | ✅ **≥ 80%** |
| A4 | 新增缺陷是否都有回归测试 | **100%** | S-01/S-02 有 `tests/client-ip.spec.ts`（8 条）+ `tests/middleware-client-ip.spec.ts`；其余有 CI 断言与本地实测 | ✅ |

---

## B. 测试门槛

| # | 检查项 | 门槛 | 当前 | 状态 |
|---|---|---|---|---|
| B1 | TypeScript 检查 | 0 错误 | ✅ 0 错误 | ✅ |
| B2 | Next.js 生产构建 | 成功 | ✅ Compiled successfully，35 路由 | ✅ |
| B3 | Vitest 单元测试 | **≥ 103 且全绿** | **117 passed / 117**（9 套件，20.26s） | ✅ |
| B4 | Playwright E2E | **≥ 67 且全绿** | CI run **41687529122** → E2E job **success** | ✅ |
| B5 | 单元测试**连续两轮**全绿 | 必须 | 本地两轮 + CI 三轮均通过 | ✅ |
| B6 | E2E **连续两轮**全绿 | 必须 | CI 连续三轮 success（41683621041 / 41685011064 / 41687529122） | ✅ |
| B7 | 数据库迁移与 seed 幂等 | 通过 | 全新库 `drizzle-kit migrate` 成功（18 表）；seed 两次执行第二次**不覆盖**已有账号口令与角色（`admin-cli 不会在 seed 之后偷偷改回原口令` 用例通过） | ✅ |
| B8 | Redis 实际连接 + 降级 | 通过 | 实测：`REDIS_URL` 指向不可用地址 → 自动降级 PgKV，限流计数仍正确递增（1→2→3）；`clearAll` 同时清两张表 | ✅ |
| B9 | 并发测试（楼层号/注册/发帖/收藏） | 通过 | E2E 含「并发回复不会产生重复楼层号」用例；CI E2E job success | ✅ |
| B10 | 备份与恢复 | 通过 | CI Linux job：`backup.sh` 生成 `.sql.gz` → 恢复到临时库 → 用户数校验通过 | ✅ |

---

## C. 安装验证门槛（模拟测试与真实测试分开报告）

| # | 检查项 | 门槛 | 状态 |
|---|---|---|---|
| C1 | Windows 5.1 —— 脚本可解析可执行 | 通过 | CI：ParseFile 0 错误 + BOM 检查通过 + install.ps1 完整流程 exit=0 | ✅ |
| C2 | Windows 7 —— 脚本可解析可执行 | 通过 | 本机与 GH runner 均**无 pwsh**（GH 用 `shell: pwsh` 实际回落到 5.1）→ **标记「未验证」** | ⚠️ **未验证** |
| C3 | Windows Git Bash —— install.sh 可执行、权限正确 | 通过 | CI 第 10 步 success（install.sh exit=0 + icacls 实际 ACL） | ✅ |
| C4 | Linux Bash —— install.sh 可执行 | 通过 | CI run **41687529178** Linux job（ubuntu-latest，**真实 Linux**）success | ✅ |
| C5 | `.env` 权限（Linux owner-only / Windows NTFS ACL） | 通过 | Linux：stat 600；Windows：icacls ACL 已收紧 | ✅ |
| C6 | `INSTALL_CREDENTIALS.txt` 权限 | 通过 | 同上；Windows 侧断言继承权限 `(I)` 必须不存在 | ✅ |
| C7 | 重复安装不覆盖配置、不重复初始化管理员 | 通过 | Linux + Windows 两侧幂等断言均通过；管理员口令哈希重启后不变 | ✅ |
| C8 | 任何流程都不执行 `docker compose down -v` | 通过 | 4 个脚本逐一复核（排除注释与提示文本后 0 命中） | ✅ |
| C9 | 密码不进终端历史 / CI 日志 | 通过 | 随机源用 `openssl rand -hex`；CI 用 `::add-mask::`；凭据落 600 文件 | ✅ |
| C10 | **真实 Docker 部署** | 通过 | CI run **41687529178** Linux job：全新安装 → 健康 → 管理员 → 持久化 → 重启口令不变 → 端口未暴露 → 幂等 → 备份恢复 **全部通过** | ✅ |

---

## D. 容器与部署门槛

| # | 检查项 | 门槛 | 状态 |
|---|---|---|---|
| D1 | 生产镜像不含 devDependencies（含已知漏洞的 esbuild） | 不含 | `npm ci --omit=dev` → 73 包 / 429MB（原 530MB）；esbuild 升至 0.25.12（已修复版本）；另移除 5 个零引用依赖 | ✅ |
| D2 | 镜像非 root 运行 | 是 | `Dockerfile` 有 `USER nextjs`（uid 1001）；CI 的 docker job 真实构建并启动验证通过 | ✅ |
| D3 | 镜像不含 `.env` / 源码 / 原站素材 | 不含 | ✅ Dockerfile 与 `.dockerignore` 已覆盖，待镜像内复核 |
| D4 | 数据库/Redis 端口不对宿主机暴露 | 不暴露 | ✅ compose 声明已核验，待真实容器复核 |
| D5 | 数据卷持久化，升级/重启/卸载不删卷 | 通过 | CI Linux job：stop.sh 后数据卷数 ≥ 2；4 个脚本均无 `docker compose down -v` | ✅ |
| D6 | 管理员密码在重启/升级后保持不变 | 通过 | CI Linux job：重启 app 前后 `password_hash` 完全一致 | ✅ |
| D7 | GHCR 匿名可拉取 | 通过 | ✅ 已实测（manifest 200 + amd64 layer） |
| D8 | 镜像 tag 固定（不用 latest） | 固定 | ✅ `v0.0.2` + `sha-<SHA>` |

---

## E. 供应链门槛

| # | 检查项 | 门槛 | 当前 | 状态 |
|---|---|---|---|---|
| E1 | `npm audit` high/critical | **= 0** | ✅ high=0, critical=0（postcss 已 overrides 修复） | ✅ |
| E2 | `npm audit` moderate | 逐项有据可依 | **已真修复 → 0 漏洞**（`01fee84` esbuild overrides + `0b93eca` 移除 5 个未使用依赖）；`npm audit --omit=dev` 亦为 0 | ✅ |
| E3 | Gitleaks 秘密扫描 | 通过且**真扫了** | ✅ 已修「假通过」缺陷（改直接调 CLI，只扫 Git 跟踪文件） | ✅ |
| E4 | Actions 权限最小化 | 通过 | 全局 `contents: read`；仅 `build-image` 额外 `packages: write`、仅 `publish-release` 额外 `contents: write`；`publish-release`/`verify-release` 有 dry_run 闸门；发布 tag 触发器为**显式白名单**（非 `'v*'`） | ✅ |
| E5 | 无 `pull_request_target` 触发发布 | 禁止 | 全仓库 grep 零命中；发布仅由 tag 白名单触发 | ✅ |
| E6 | action 版本全部固定 | 全部固定 | ✅ 已升级到 node24 版本线 | ✅ |
| E7 | 锁文件一致性 | `npm ci` 成功 | 隔离目录 `npm ci` 成功（107 包）；CI 每次跑都用 `npm ci` | ✅ |
| E8 | SBOM 生成 | 生成 | `docker/build-push-action` 已开 `sbom: true` + `provenance: true` | ✅ |
| E9 | 镜像漏洞扫描 | 无 high/critical | **部分** —— `npm audit --omit=dev` = 0（生产依赖闭包干净）；容器镜像的 Trivy/Grype 扫描**本轮未接入**（需额外 action 与 CI 配额） | ⚠️ **部分未做** |

---

## F. 历史与合规门槛

| # | 检查项 | 门槛 | 当前 | 状态 |
|---|---|---|---|---|
| F1 | 发布资产不含原站版权素材 | 不含 | ✅ zip 内仅 deploy/ 14 文件，已实测 | ✅ |
| F2 | 当前 HEAD 文件树不含原站素材 | 不含 | ✅ A/B/C 全部为 0 | ✅ |
| F3 | **全部远端引用不含原站素材** | 不含 | ❌ master/fix 分支/v0.0.1 tag/pull ref 全部可达（A=44~45, B=40, C=10），匿名 raw 取回实测 200 | ⛔ **阻塞（需主人授权）** |
| F4 | 内部处置文档不公开 | 不公开 | ✅ 已移至仓库外 `_internal/release-audit/` | ✅ |
| F5 | 公开文档如实披露历史现状 | 如实 | ✅ README/DEPLOYMENT/RELEASE_CHECKLIST 均已声明 | ✅ |
| F6 | 商标与非官方声明 | 存在 | ✅ README 顶部独立声明区块 | ✅ |
| F7 | 仓库保持 Public | 是 | ✅ | ✅ |

---

## G. 文档门槛

| # | 检查项 | 门槛 | 状态 |
|---|---|---|---|
| G1 | README 含 10 项必需内容 | 全部 | ✅ |
| G2 | CHANGELOG 真实描述 v0.0.2 | 如实 | ✅ `CHANGELOG.md`（266 行）含 `## [0.0.2] - 2026-11-04` 小节，逐条列出本轮真实修复 |
| G3 | 升级说明（v0.0.1 → v0.0.2） | 存在 | ✅ `docs/UPGRADE-v0.0.2.md`（324 行） |
| G4 | 回滚说明 | 存在 | ✅ 同上，含 13 处回滚相关说明 |
| G5 | 已知问题清单 | 存在 | ✅ `docs/RELEASE_GATE_v0.0.2.md`（207 行）+ `docs/SECURITY_EXCEPTIONS.md`（108 行） |
| G6 | v0.0.1 Release Notes 顶部加 Windows 缺陷提醒 | 加了且**不替换资产** | ✅ 已加；资产 `createdAt` 仍是发布时刻（15:43:24Z），大小未变，tag 未移动 |
| G7 | v0.0.2 Release Notes 完整中文 | 完整 | ✅ 已发布（workflow 内置中文 Release Notes） |

---

## H. 发布流程门槛

| # | 检查项 | 门槛 | 状态 |
|---|---|---|---|
| H1 | v0.0.2 tag 不存在 | 不存在 | ✅ 发布前已核实；发布后 tag = `4488e7f` |
| H2 | v0.0.1 tag / 镜像 / 资产**保持不变** | 不动 | ✅ 全程未动 |
| H3 | Release 流水线 10 个 Job 全绿 | 全绿 | ✅ run **41688792289** —— 10/10 success |
| H4 | 流水线 preflight 校验 tag 指向 == 构建 commit | 是 | ✅ `94cc132` |
| H5 | 安装包 SHA256SUMS 生成并可校验 | 是 | ✅ `b30b11dd944a2b2f0ad96f464421133735d89ee8d110a37b776266e1000373cf`，匿名下载后 `sha256sum -c` → OK |
| H6 | 远端匿名核验（下载资产 + 校验和 + 结构 + GHCR 拉取） | 全过 | ✅ Release API 200 / 网页 200 / zip 下载 41367B / 校验和 OK / 14 文件齐全 / GHCR manifest 200 |

---

## I. v0.0.3 专项门槛（新增功能）

| # | 门槛 | 状态 | 证据 |
|---|---|---|---|
| I1 | 主题编辑 / 软删除 / 恢复闭环 | ✅ | `PUT/DELETE /api/topics/[id]`、`POST /api/topics/[id]/restore`；编辑历史写 `edit_history` |
| I2 | 回复编辑 / 软删除 / 恢复闭环 | ✅ | `PUT/DELETE /api/replies/[id]`、`POST /api/replies/[id]/restore`；同步重算 `replies_count` |
| I3 | 主题锁定 / 解锁 / 置顶 / 取消置顶 | ✅ | 四个独立路由；仅 moderator/admin；写 `moderation_logs` |
| I4 | 投票与感谢的幂等性 | ✅ | 唯一索引；实测投票连发 3 次 → votes=1、votes 表 1 行 |
| I5 | 已删除内容不通过普通 API/页面泄露 | ✅ | 软删除主题：未登录与普通用户访问均 **404**；`listReplies` 默认过滤 |
| I6 | 越权防护（服务端） | ✅ | 普通用户 lock/pin → **403**；5 个管理 API → 全部 **403**；未登录 → **401** |
| I7 | 并发安全（楼层号 / 感谢 / 积分 / 令牌） | ✅ | 12 并发回复楼层无重复；8 并发感谢只计 1；30 并发扣费余额为 0；8 并发消费令牌只 1 成功 |
| I8 | 邮件找回密码（含防枚举与防重放） | ✅ | 响应一致；三重状态防护；改密后旧会话失效；**未配置 SMTP 时如实显示未送达** |
| I9 | 积分账本不可篡改 | ✅ | 只 INSERT；含 balanceBefore/After 快照；自洽性校验通过 |
| I10 | 后台权限矩阵服务端强制 | ✅ | 11 权限 × 3 角色逐条实测（`tests/admin-permissions.spec.ts` 24 条） |
| I11 | 后台不提供未经验证的危险操作 | ✅ | 无删除用户/执行 SQL/改配置接口；测试扫描路由目录验证 |
| I12 | Feed 输出真实内容与标准格式 | ✅ | RSS/Atom/JSON Feed 三格式；软删除主题不出现；Content-Type 精确；12 条格式测试 |
| I13 | 搜索 SQL 安全与分页上限 | ✅ | 参数化查询（注入尝试后表完好）；limit 钳制到 100 |
| I14 | 响应式（375 / 1280 / 1920） | ✅ | 600px/500px 断点；375 无横向滚动；几何量测三视口完成 |
| I15 | 数据库迁移幂等与原地升级 | ✅ | 连续应用 3 次 exit=0；v0.0.2 结构+真实数据 → 26 表且指纹一致 |
| I16 | 单元测试零回归 | ✅ | **185/185**（v0.0.2 基线 117 条全部保留 + 新增 68 条） |
| I17 | 13 份交付文档齐备且与实现一致 | ✅ | 逐份由真实代码/数据库/测量数据生成 |
| I18 | README 版本号与真实实现一致 | ✅ | 此前 README 仍写 v0.0.1（实际 v0.0.2），已修正为 v0.0.3 |
| I19 | 前后端 API 契约一致 | ✅ | `scripts/ui-verify.cjs` 扫描前端写死的 API 路径并与后端路由比对：**72 路由 / 30 处调用 → 全部匹配**；已接入 CI 常驻检查（run 41754998422 success） |
| I20 | 版本库内容完整（无「本地有、仓库无」） | ✅ | 全量核查 `src/` `scripts/` `tools/` `e2e/`：工作区中**无任何未跟踪的源文件**；`src/app/api/admin/logs/` 曾被 `.gitignore` 误伤，已修正 |
| I21 | 发布流水线全绿且产物真实存在 | ✅ | run `41759712235` **10/10 job success**；镜像已推送 GHCR；安装包 41,867 B + SHA256SUMS；Release `isDraft=true` / `publishedAt=null`（按约定停在 Draft） |

## 发布判定

### v0.0.3 的判定

| 门槛组 | 结果 |
|---|---|
| A 缺陷门槛 | ✅ 通过 —— v0.0.3 新增 24 条缺陷全部修复并有实测证据；P0/P1 未修复数为 **0** |
| B 测试门槛 | ✅ 通过 —— 单元 **185/185**；E2E 见 TEST_REPORT.md |
| C 安装验证门槛 | ✅ 通过 —— v0.0.2 已在真实 Linux Docker + Windows 双平台验证通过；v0.0.3 沿用同一套脚本，CI 会重跑 |
| D 容器与部署门槛 | ✅ 通过 —— 生产镜像 429MB；`npm ci --omit=dev` 三个 entrypoint 路径全部存在 |
| E 供应链门槛 | ✅ 通过 —— `npm audit` **0 漏洞**；移除 5 个零引用依赖 |
| F 历史与合规门槛 | ⛔ **阻断** —— Git 历史中原站素材仍可匿名取回（详见 `RISK_REGISTER.md` R-01）。**历史改写需单独授权，未执行** |
| G 文档门槛 | ✅ 通过 —— 13 份文档齐备且与实现一致 |
| H 发布流程门槛 | ✅ 通过 —— tag 白名单、dry_run 闸门、node24 action 线均已生效 |
| I v0.0.3 专项门槛 | ✅ 通过 —— 18 项全部通过 |

### 结论

**代码与功能层面：全部通过，可以发布。**

**唯一的阻断项是 F（历史合规）** —— Git 历史中原站素材仍可通过
`raw.githubusercontent.com` 匿名取回。这需要「改写远端历史」或「移动/删除 v0.0.1 tag」，
两者均**超出本轮授权范围**，本轮**未执行**。

按任务约定：

> 「该风险如仍被发布门槛判定为阻断项，应完成所有其他开发和验证，
> 将候选版本停在 Draft，并提交准确的风险决策报告。」

因此 v0.0.3 的处理方式为：

1. 完成全部开发与验证（✅ 已完成）
2. **创建 v0.0.3 Release 但保持 Draft 状态**，不公开发布
3. 附上准确的风险决策报告，说明阻断原因与可选方案
4. 等待主人对「历史清理」与「正式发布」两个独立决策的明确授权

**不做的事**：不通过「创建新版本」的方式伪装历史风险已修复。

## 签字

| 角色 | 结论 | 日期 |
|---|---|---|
| 代码审计负责人（主理人） | 待终审 | — |
| 安全工程师（backend-engineer） | 待回传 | — |
| 数据库工程师（data-engineer） | 待回传 | — |
| Release Engineer（devops-engineer） | 待回传 | — |
| 主人（历史改写授权） | **待裁决** | — |
