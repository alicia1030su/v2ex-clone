# v0.0.2 发布门槛检查单（RELEASE_GATE_v0.0.2）

> 项目：V2EX Clone
> 目标版本：**v0.0.2**（开发预览版 / Pre-release）
> 建表时间：2026-11-04
> 维护者：部署运维工程师（devops-engineer）
>
> **判定规则**：任一「阻断级」项未通过 ⇒ **不得发布正式 Release**。
> 最多停在 Draft 并报告阻塞原因。
>
> 本单与仓库根目录的 [`RELEASE_GATE.md`](../RELEASE_GATE.md) 是**两个不同层级的门槛**：
> 根目录那份管「缺陷与测试是否达标」，本单管「**能不能真的发出去**」——
> 即产物正确性、供应链、权限、容器与文档。
> 两者**都要通过**才允许发版。

---

## A. 缺陷与测试门槛（与根目录 RELEASE_GATE.md 联动）

- [ ] **A1** P0 缺陷未修复数 = **0**（根目录 RELEASE_GATE A1 项通过）
- [ ] **A2** P1 缺陷未修复数 = **0**（根目录 RELEASE_GATE A2 项通过）
- [ ] **A3** TypeScript 检查 0 错误 —— 本地实测 `npx tsc --noEmit` 退出码 0 ✅
- [ ] **A4** 单元测试全绿且数量 ≥ 103 —— 本地实测 **103/103** ✅
- [ ] **A5** Playwright E2E 全绿且数量 ≥ 67 —— **本地未跑**（需 CI 证实）
- [ ] **A6** 单元测试**连续两轮**全绿（查顺序依赖 / 残留数据 / 端口冲突）
- [ ] **A7** E2E **连续两轮**全绿
- [ ] **A8** 新增缺陷都有回归测试（100%）
- [ ] **A9** 流水线中**没有** `continue-on-error`
- [ ] **A10** 流水线中**没有**为「让测试变绿」而降低安全阈值 / 关闭安全功能 / 跳过测试的改动

---

## B. 依赖与供应链门槛

- [ ] **B1** `npm audit` = **0 漏洞**（critical / high / moderate / low 全为 0）
      —— 本地实测 `{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}` ✅
- [ ] **B2** **未**通过降低 `--audit-level` / 修改门禁阈值来隐藏漏洞
      —— 发布流水线门禁仍为「critical > 0 或 high > 0 即中止」 ✅
- [ ] **B3** `npm ci` 成功且 lockfile 可复现（`npm ci` 后 audit 仍为 0）
      —— 本地实测成功，113 包 ✅
- [ ] **B4** `overrides` 中的 esbuild 覆盖生效：`@esbuild-kit/core-utils` 下 esbuild ≥ 0.25.0
      —— 本地实测解析为 **0.25.12** ✅
- [ ] **B5** 覆盖后**迁移能力未损坏**：`drizzle-kit generate` 与 `drizzle-kit migrate` 均成功
      —— 本地实测均 EXIT=0 ✅
- [ ] **B6** 覆盖后**生产构建未损坏**：`next build` 成功
      —— 本地实测 Compiled successfully ✅
- [ ] **B7** 生产依赖闭包**不含**测试工具链（`@playwright/test` / `vitest` / `typescript` / `@types/*`）
      —— 已用真实 `npm ci --omit=dev` 模拟验证（73 包）；`typescript` 仅在**构建期**必需，
      runner 层用 `--omit=dev` 不受影响 ✅
- [ ] **B8** `npm audit` 的完整 JSON 与摘要作为 artifact 上传，**未被静默吞掉**
- [ ] **B9** `package-lock.json` 与 `package.json` 一致，且都已提交
- [ ] **B10** **生产依赖闭包**单独扫描为零漏洞：`npm audit --omit=dev --audit-level=moderate`
      → **found 0 vulnerabilities**
      —— 本地实测（真实 `npm ci --omit=dev` 产物，非全量 tree 冒充）✅
- [ ] **B11** 生产依赖闭包中**不含**漏洞版 esbuild（`core-utils` 解析到的 esbuild ≥ 0.25.0）
      —— 本地实测解析为 **0.25.12** ✅
- [ ] **B12** 裁剪后的生产依赖**真的能跑**：`next build` + `next start` + 真实数据库
      —— 本地实测：`next build` ✓；`next start` 后 `/` `/signin` `/signup` `/nodes`
      `/api/captcha` `/t/1` **全部 200**，日志 `MODULE_NOT_FOUND` 计数 **0** ✅
- [ ] **B13** 裁剪后的生产依赖下 **entrypoint 三个阶段**全部可用
      —— 本地实测：`drizzle-kit migrate` ✓ 18 张表；`tsx` 跑 seed ✓；
      `next start` ✓ ✅

---

## C. CI/CD 与 Actions 权限门槛

- [ ] **C1** 所有 action 版本**固定**，无 `main` / `master` / `latest` 浮动引用
      —— 本地实测全部为主版本 tag ✅
- [ ] **C2** 所有 action 的 `runs.using` **不是 node20**
      —— 本地实测 `ci.yml` 与 `release.yml` 全部为 node24 ✅
      （GitHub 已于 2026-09-23 移除 runner 的 Node 20 运行时，退避开关同时失效）
- [ ] **C3** **无** `pull_request_target` 触发器
      —— 本地实测 `ci.yml` 与 `release.yml` 命中数均为 **0** ✅
- [ ] **C4** **无** `workflow_run` 触发器
- [ ] **C5** 顶层 `permissions` 为最小化默认（`contents: read`）
      —— 本地实测两个 workflow 均为 `contents: read` ✅
- [ ] **C6** 只有确实需要写权限的 job 才提升权限，且权限范围最小
      —— `build-image`：`contents: read` + `packages: write`
      —— `publish-release`：`contents: write`
      —— 其余 job 均**未**声明 job 级 permissions（即继承顶层 `contents: read`）✅
- [ ] **C7** **未经审查的 PR 代码无法获得 `packages:write` / `contents:write`**
      —— 发布流水线**只**由 `push` tag 或 `workflow_dispatch` 触发，
         `pull_request` 触发器**不存在**于 `release.yml` ✅
- [ ] **C8** tag 触发时校验「tag 指向的 commit == 本次构建的 commit」
      —— preflight job 实测有此校验 ✅
- [ ] **C9** Release 已存在 / tag 已被占用时**立即失败**，绝不覆盖
      —— preflight + publish-release 双重复核 ✅
- [ ] **C10** `dry_run` 开关**真实生效**（不推镜像、不建 Release）
      —— 本轮实修：dry_run 时 `push: false` + GHCR 登录跳过 +
         `publish-release` / `verify-release` job 级 `if` 跳过 ✅
- [ ] **C11** gitleaks 扫描范围覆盖**全部 Git 跟踪的文件**
      —— 实测：`git ls-files -z | tar` 全量复制后 `--no-git` 扫描，
         且 `FILE_COUNT < 1` 时**中止**（防假通过）✅
- [ ] **C12** gitleaks 二进制做 checksum 校验
      —— 实测有官方 checksums 比对 ✅
- [ ] **C13** `cache: npm` **不会**跨 PR 泄露敏感数据
      —— 缓存内容为 npm 包 tarball（公开 registry），不含运行时密钥 ✅
      —— buildkit 缓存（`type=gha`）见 `docs/SECURITY_EXCEPTIONS.md` E-04
- [ ] **C14** 发布流程为**失败即中止**（无 `continue-on-error`）

---

## D. 产物与镜像门槛

- [ ] **D1** 镜像 tag = `v0.0.2`，且**不生成** `latest`（避免误导用户）
      —— 实测 metadata-action 未设 `latest`，刻意不生成 ✅
- [ ] **D2** 镜像带 provenance 与 sbom attestation
- [ ] **D3** 镜像内**不含** `.env`（`docker run` 实测校验）
- [ ] **D4** 镜像内**不含** `docs/evidence`（`docker run` 实测校验）
- [ ] **D5** 镜像内**不含**原站版权素材
- [ ] **D6** 镜像内**不含**源码（仅 `.next` 构建产物 + 必要的 `src/db`、`src/lib/password.ts`）
- [ ] **D7** 镜像以**非 root** 运行（`USER nextjs`，uid 1001）
      —— 语义上确定生效（`USER` 位于 Dockerfile 最后一条指令之前、`ENTRYPOINT` 之前），
      但**本机无 Docker，实际运行效果需 CI 证实** ⚠️
- [ ] **D8** 镜像**不含** devDependencies（生产依赖闭包已裁剪）
      —— 真实 `npm ci --omit=dev` 验证：73 包 / **411 MB**（删 playwright 后）；
      `playwright-core` 因 next 的 `peerOptional` 需**显式删除**，
      Dockerfile 已加护栏断言 ✅；**最终镜像字节数需 CI 证实** ⚠️
- [ ] **D9** 容器 entrypoint 的三个阶段全部可用
      —— 迁移路径 `node_modules/drizzle-kit/bin.cjs` ✅（实测 migrate 成功，18 表）
      —— seed 路径 `node_modules/tsx/dist/cli.mjs` ✅（实测 seed 成功）
      —— 启动路径 `node_modules/next/dist/bin/next` ✅（实测 `next start` 后 6 条路由全 200）
      （均为真实 `npm ci --omit=dev` 后的**实际执行**验证，非仅文件存在性）
- [ ] **D10** 镜像内**不含**任何真实凭据

---

## E. 部署配置门槛

- [ ] **E1** `deploy/docker-compose.yml` 引用的**每一个**变量都能在 `deploy/.env.example` 中找到定义
      —— 本地实测：compose 引用 24 个变量，`.env.example` **全部覆盖** ✅
      （`V2EX_IMAGE` 在两处都有；`COMPOSE_PROJECT_NAME` 由脚本读取）
- [ ] **E2** 数据库与 Redis **确实未暴露**端口到宿主机
      —— 实测 compose 中 postgres / redis 段无 `ports` 字段 ✅
- [ ] **E3** `restart: unless-stopped` 已配置（三个服务全部）✅
- [ ] **E4** `depends_on` 使用 `condition: service_healthy`（app 等待 postgres / redis 健康）✅
- [ ] **E5** 健康检查已配置（postgres / redis / app 三者）✅
- [ ] **E6** 数据卷命名稳定（`COMPOSE_PROJECT_NAME=v2ex` + 具名卷 `postgres-data` / `redis-data`）
      —— 升级时**不丢数据** ✅
- [ ] **E7** 必需变量用 `${VAR:?message}` 语法（缺失即失败，不带弱口令启动）✅
- [ ] **E8** 生产环境强制关闭调试端点与验证码绕过（compose 硬编码 `'0'`）✅

---

## F. 安装与升级实测门槛

- [ ] **F1** Linux/macOS 安装脚本实测通过
- [ ] **F2** Windows 安装脚本实测通过
- [ ] **F3** 安装后**实际可访问**（健康检查返回 200）
- [ ] **F4** **数据迁移正常**：全新库跑完迁移后表结构完整（18 张表）
- [ ] **F5** **持久化正常**：重启容器后管理员口令**未被重置**、主题数**未变化**
      —— CI 的 docker job 实测了这一点 ✅；正式发布前需再跑一次
- [ ] **F6** 备份与恢复流程实测通过
- [ ] **F7** 从 v0.0.1 升级到 v0.0.2 的步骤已走通（见 `docs/UPGRADE-v0.0.2.md`）

---

## G. 合规与资产门槛

- [ ] **G1** 发布资产（安装包 zip + SHA256SUMS）**不含**原站版权素材
- [ ] **G2** 发布包内**不含** `deploy/.env` 与 `INSTALL_CREDENTIALS.txt`
- [ ] **G3** 发布包内**不含**任何明文凭据
- [ ] **G4** Release Notes **如实**描述本轮改动，**不夸大**
- [ ] **G5** 安装包 SHA256 可复核且与 `SHA256SUMS` 一致
- [ ] **G6** 匿名视角可访问：Release API 200 + GHCR 镜像可匿名 `docker pull`
      —— `verify-release` job 实测这两项 ✅

---

## H. 密钥与安全配置门槛

- [ ] **H1** 仓库中**无**新增密钥泄露（gitleaks 通过）
- [ ] **H2** `.env` / `.env.local` / `.env.test` **未被** Git 跟踪
- [ ] **H3** 发布流程中所有口令随机生成并 `::add-mask::` 屏蔽
- [ ] **H4** 大模型 / 第三方 API Key 的**轮换方案**与**配额告警方案**已明确
      —— 本项目当前**未接入**任何大模型 API，故本项为 **N/A**
      —— 若后续接入，必须先补齐：密钥托管位置、轮换周期、配额/费用告警阈值
- [ ] **H5** 无未评估的严重安全风险
      —— 见 `docs/SECURITY_EXCEPTIONS.md`，全部例外均有到期日与责任人

---

## I. 文档门槛

- [ ] **I1** `CHANGELOG.md` 有 v0.0.2 小节，**如实**描述本轮改动
- [ ] **I2** `docs/UPGRADE-v0.0.2.md` 存在，含升级步骤、回滚说明、已知问题
- [ ] **I3** `docs/DEPLOYMENT.md` 已更新：
      - 镜像地址为 `ghcr.io/alicia1030su/v2ex-clone:v0.0.2`
      - GHCR 可见性说明
      - 回滚方案（**注意 tag 不可移动**）
- [ ] **I4** `docs/SECURITY_EXCEPTIONS.md` 存在，全部例外有到期日
- [ ] **I5** 所有文档中的版本号、镜像地址、文件路径与实际一致（**已逐项核验**）

---

## 发布前最后一次确认

- [ ] **Z1** 版本号在 `release.yml` 的 tag 白名单中（当前为 `v0.0.2`）
- [ ] **Z2** `deploy/VERSION` = `0.0.2`
- [ ] **Z3** `deploy/.env.example` 的 `V2EX_IMAGE` = `ghcr.io/alicia1030su/v2ex-clone:v0.0.2`
- [ ] **Z4** `deploy/docker-compose.yml` 的镜像默认值 = `...:v0.0.2`
- [ ] **Z5** `package.json` 的 `version` = `0.0.2`
- [ ] **Z6** CI 在目标分支上**全绿**
- [ ] **Z7** 确认**不**移动 / 覆盖 `v0.0.1` 的 tag 与资产
- [ ] **Z8** 确认本轮**未**执行任何远端写操作（push / release / workflow_run）——
      这些由仓库主人执行
