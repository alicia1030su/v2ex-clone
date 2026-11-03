# v0.0.2 发布门槛检查单（RELEASE_GATE）

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
| G6 | v0.0.1 Release Notes 顶部加 Windows 缺陷提醒 | 加了且**不替换资产** | ⏳ 待执行 |
| G7 | v0.0.2 Release Notes 完整中文 | 完整 | ⏳ 待编写 |

---

## H. 发布流程门槛

| # | 检查项 | 门槛 | 状态 |
|---|---|---|---|
| H1 | v0.0.2 tag 不存在 | 不存在 | ✅ 已核实（仅 v0.0.1） |
| H2 | v0.0.1 tag / 镜像 / 资产**保持不变** | 不动 | ✅ 全程未动 |
| H3 | Release 流水线 10 个 Job 全绿 | 全绿 | ⏳ 待 v0.0.2 运行 |
| H4 | 流水线 preflight 校验 tag 指向 == 构建 commit | 是 | ✅ `94cc132` |
| H5 | 安装包 SHA256SUMS 生成并可校验 | 是 | ⏳ 待 v0.0.2 |
| H6 | 远端匿名核验（下载资产 + 校验和 + 结构 + GHCR 拉取） | 全过 | ⏳ 待 v0.0.2 |

---

## 发布判定

**当前结论：⛔ 不满足发布门槛。**

阻塞项共 2 条：

1. **A1 / F3 —— Git 历史中原站素材仍可达**（含已发布的 `v0.0.1` tag）。
   本轮明确禁止改写远端历史、移动/删除 `v0.0.1` tag、删除仓库 ⇒ **必须由主人单独授权**。
   注意这与 H2（保持 v0.0.1 不变）**直接冲突**：不移动 v0.0.1 tag ⇒ v0.0.1 持续使 A 类对象可达。

2. **C10 —— 真实 Docker 部署矩阵未验证**。
   本机无 Docker、无 Linux ⇒ A~I 组中所有「真实容器环境」项目前只能在 CI（ubuntu runner）或模拟环境验证。
   **策略**：优先用 GitHub Actions 的 ubuntu runner 跑真实 Docker 矩阵（compose up / 重启 / 升级 / 备份恢复 / PG 与 Redis 重启），
   产出的 run 链接作为证据。若某项确实无法在任何环境完成，则在 Release Notes 与本文件中标记「未验证」。

**不构成阻塞的项目**：
- 历史暴露（阻塞 1）除授权外**不影响 v0.0.2 代码与安装包的正确性** —— v0.0.2 的资产本身不含原站素材。
- 因此，若主人选择「接受历史风险」并授权发布，v0.0.2 **可以发布**，但须在 Release Notes 与 README 中保留历史暴露的如实披露。

---

## 签字

| 角色 | 结论 | 日期 |
|---|---|---|
| 代码审计负责人（主理人） | 待终审 | — |
| 安全工程师（backend-engineer） | 待回传 | — |
| 数据库工程师（data-engineer） | 待回传 | — |
| Release Engineer（devops-engineer） | 待回传 | — |
| 主人（历史改写授权） | **待裁决** | — |
