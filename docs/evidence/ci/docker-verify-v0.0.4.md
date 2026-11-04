# Docker / Redis 隔离验证 —— 就绪状态与实跑证据

> **取证人**：严过关（Yan）· QA 工程师
> **文档时间**：2026-11-04T12:45Z（本地 2026-11-04 20:45 +0800）
> **基线**：`feat/v0.0.4-high-fidelity` @ `097c1b9`
> **关联风险**：R-16（Docker 全链路）、R-17（Redis 故障恢复）

---

## 0. 状态速览（**最重要的一行**）

> ## 🟡 部分已实跑 —— R-16 第 1、9 项已在**真实 CI** 上通过；第 2 项断言口径已修待重跑；其余项待取证。
>
> **时间线**：
> 1. **初始状态**：本机无 Docker（`docker: command not found`）+ 分支未推送
>    → 全部 12 项 🔴 DEFERRED，本文档只交付「已就绪的验证通道」。
> 2. **主理人推送后**：工作流在真实 GitHub Actions runner 上跑了起来，
>    **暴露了我交付物自身的 3 个缺陷**（三元式写进 `${{ }}`；`_journal.json` 路径写错；
>    app 健康断言口径不成立），前两个由主理人修复为 `2532f5f` / `930f29e`，
>    第三个由我在本轮修复（§5.1.1）。
> 3. **当前状态**：`[1/9]` ✅、`[9/9]` ✅ **已在真实 CI 确认通过**；
>    `[2/9]` 断言口径已修正，**需重新触发 CI 取证**；
>    `[4/9]`–`[8/9]` 与 R-17 三项**待重跑取证**。
>
> ⚠️ **仍然不能下结论说「R-16/R-17 已通过」** ——
> 9 项里只有 2 项有真实证据，其余 7 项 + R-17 三项必须等 run 跑完。
> **任何人不得把本文档当作 v0.0.4 已通过 Docker 验证的完整证据。**

本文档严格区分三类内容，每一段都标注了状态标记：

| 标记 | 含义 |
|---|---|
| ✅ **实测** | 真实执行过，有原始输出（本地或 CI） |
| 🟡 **静态** | 只做了静态分析（YAML 解析 / 源码审阅），未真实运行 |
| 🔴 **待 CI 实跑** | 已写成可执行的工作流，**等待真实 CI 出结果** |
| 🔄 **CI 执行中** | 真实 CI 正在跑，结果待回填 |

---

## 1. 本机 Docker 可用性核查（✅ 实测）

```
$ docker --version
bash: line 10: docker: command not found

$ docker compose version
（同样不存在）

$ where docker / which docker
（无输出）
```

**结论：本机不存在 Docker Engine，也不存在 Docker Compose。**
因此以下验证**在本机 100% 无法执行**，没有任何"部分验证"的可能性：

- 镜像构建（`docker build`）
- Compose 启动（`docker compose up`）
- 容器健康检查（`docker inspect --format '{{.State.Health.Status}}'`）
- 数据卷持久化（需要真实 volume）
- 容器重启（`docker compose restart`）
- Redis / PG 中断恢复（需要能停/启容器）
- 安装包实际部署（`install.sh` 依赖 `docker compose`）
- 容器资源观察（`docker stats`）
- 镜像内容与权限检查（`docker run --rm --entrypoint sh`）

**唯一的合法落地路径是 GitHub Actions 的 `ubuntu-latest` runner**（自带 Docker Engine + Compose v2）。

---

## 2. 新增工作流：`.github/workflows/docker-verify.yml`（✅ 已写入，🔴 待实跑）

### 2.1 设计要点

| 设计决策 | 理由 |
|---|---|
| **独立成工作流，而非塞进 `ci.yml`** | `ci.yml` 的 `docker` job 只覆盖 4 项（构建 / compose 起来 / 重启 / 不污染数据）。R-16 的 9 项 + R-17 的 3 项塞进去会让 `ci.yml` 变成一个超长工作流，且一旦某项失败会**连带**把类型检查/E2E 的绿灯一起拖红，丧失定位能力。独立工作流 = 失败只影响自己。 |
| **每项一个独立 step，step 名带 `[n/9]` 标记** | 推送后主理人只需按 step 名逐条打勾，不必读整篇日志。 |
| **任何一项不达标 → 立即 `exit 1`** | 不是"记录下来"，而是**红灯**。静默记录等于没验证。 |
| **PG / Redis 全部由本工作流自己用 compose 起** | 绝不连接任何外部数据库。数据落在 workflow 生命周期内的临时卷，job 结束即销毁。 |
| **绝不 push 镜像到 GHCR** | 只 `docker build` / `docker load`，不 `docker/login-action`，不 `push`。避免污染发行版仓库。 |
| **不创建 Tag / Release / 不改可见性** | 与本任务的硬性约束一致。 |
| **凭据全部随机、workflow 内生成** | `POSTGRES_PASSWORD` 等均为 `docker-verify-*-not-real` 这样的假值，`: `add-mask::` 屏蔽。 |
| **`timeout-minutes: 45`** | 安装包部署 + 9 项验证 + 多次容器重启，留足余量，同时防止 runner 挂死。 |
| **`concurrency` + `cancel-in-progress: true`** | 与 `ci.yml` 保持一致，新推送取消旧运行。 |
| **Action 版本全部 node24 系**（`checkout@v7` / `setup-node@v7` / `upload-artifact@v7`） | GitHub 已于 2026-09-23 移除 runner 的 Node 20 运行时，且 `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` 退避开关同时失效。仍声明 `runs.using: node20` 的 Action 会在**启动阶段**直接失败 —— CI 会「什么都没跑」就红灯。 |

### 2.2 触发器

```yaml
on:
  push:
    branches: [master, 'fix/**', 'feat/**']
  pull_request:
    branches: [master]
  workflow_dispatch:
```

`workflow_dispatch` 支持手��触发，便于主理人在推送后定点重跑失败项：

```bash
gh workflow run docker-verify.yml --ref feat/v0.0.4-high-fidelity
```

### 2.3 YAML + shell 语法自检（✅ 实测）

**YAML 解析**：PyYAML `safe_load` 通过 ✅（输出见下）。

**Shell 语法**：把 14 个含 `run:` 的 step 逐个抽出、把 GitHub 表达式
（`${{ ... }}`）与 shell 变量默认值（`${VAR:-default}`）替换成占位后，
逐个跑 `bash -n`：

```
bash -n: 14 OK, 0 FAILED  (共 14 个含 run 的 step)
```

> 这一步**不能替代实跑**，但能提前排掉「YAML 缩进错 / shell 引号错 / 括号不配对」
> 这类会让工作流在第一步就红、且毫无诊断信息的问题。
> 真正可能出错的仍是**运行时语义**（如 `docker stats --format` 的字段名、
> `docker inspect` 的模板），这些只能靠实跑暴露 —— 见 §7 残余风险。

**YAML 结构输出**：

```
YAML parse: OK
name     : Docker/Redis 隔离验证
triggers : ['push', 'pull_request', 'workflow_dispatch']
jobs     : ['verify']
  job verify: runs-on=ubuntu-latest timeout=45 steps=17
     - actions/checkout@v7
     - actions/setup-node@v7
     - 环境信息
     - [1/9] 镜像真实构建
     - [9/9] 镜像内容与权限检查
     - [2/9][3/9] Compose 启动 + PG/Redis 健康检查
     - [4/9] 数据卷持久化
     - [5/9] 容器重启（数据与口令不变）
     - [7/9] 安装包实际部署
     - [8/9] 容器资源观察（CPU / 内存）
     - [R-17a] Redis 中断与恢复
     - [R-17b] PostgreSQL 中断与恢复
     - [R-17c] 缓存失效与 Redis 内存观测
     - 生成验证汇总
     - 上传验证证据
     - compose 日志
     - 停止并清理
```

### 2.4 R-16 九项 → 工作流步骤映射表

| R-16 项 | 验证内容 | 对应 step | 断言方式 | 状态 |
|---|---|---|---|---|
| **1** | 镜像真实构建 | `[1/9] 镜像真实构建` | `docker build` 退出码 0 + `docker images` 输出镜像尺寸；同时把 `IMAGE_SIZE_BYTES` / `IMAGE_ID` 写入 `$GITHUB_OUTPUT` 供后续引用 | 🔴 待 CI 实跑 |
| **2** | Compose 启动 | `[2/9][3/9] Compose 启动 + PG/Redis 健康检查` | `docker compose up -d --build` 成功 + 三容器 `State.Health.Status == healthy` | 🔴 待 CI 实跑 |
| **3** | PG / Redis 健康检查 | 同上 | compose healthcheck 定义本身（`pg_isready` / `redis-cli ping`）+ **实查**：`psql -c "select version()"` 与 `redis-cli ping` 返回 `PONG` | 🔴 待 CI 实跑 |
| **4** | 数据卷持久化 | `[4/9] 数据卷持久化` | 写入 PG 探针行 + Redis 探针键 → `docker compose down`（**不带 `-v`**，卷保留）→ `up -d` → 断言两者**都还在** | 🔴 待 CI 实跑 |
| **5** | 容器重启 | `[5/9] 容器重启（数据与口令不变）` | `docker compose restart` 后断言管理员 `password_hash` **逐字节不变** 且 `topics` 计数**不变** | 🔴 待 CI 实跑 |
| **6** | Redis 中断与恢复 | `[R-17a] Redis 中断与恢复` | `stop redis` → 断言 `/`、`/nodes`、`/api/nodes` **均不返回 5xx**（应用须降级而非崩溃）→ `start redis` → 断言回到 200 且 `PING` = `PONG` | 🔴 待 CI 实跑 |
| **6′** | PG 中断与恢复 | `[R-17b] PostgreSQL 中断与恢复` | `stop postgres` → 记录首页行为 → `start postgres` → **断言应用自动回到 200（不需重启容器）** | 🔴 待 CI 实跑 |
| **7** | 安装包实际部署 | `[7/9] 安装包实际部署` | ① **先停根 compose**（避端口 3000 + 容器名冲突，见 §5.1.0）→ ② `tar` 打包 `deploy/` → 解包到全新目录 → `bash -n` 全部脚本 → ③ 预置 `.env`（`APP_PORT=3100`）并 **真实执行 `install.sh`**（`V2EX_IMAGE=v2ex-clone:dv`）→ ④ 断言 `.env` 权限 = **600**、凭据文件权限 = **600**、4 个口令长度 ≥ 16、**`V2EX_IMAGE` 不是外部仓库** → ⑤ 断言发行版 compose 的 app healthy + 管理员账号存在 → ⑥ **停掉安装包容器并恢复根 compose**（供 `[8/9]` 与 R-17 用） | 🔴 待 CI 实跑 |
| **8** | 容器资源观察 | `[8/9] 容器资源观察（CPU / 内存）` | `docker stats --no-stream` 输出三容器 CPU%/MEM/MEM% + **连续 5 次采样**观察波动 + 镜像体积 + `SizeRw`（可写层）+ 容器内 `/proc/1/status` 的 `VmRSS`/`VmHWM` | 🔴 待 CI 实跑 |
| **9** | 镜像内容与权限检查 | `[9/9] 镜像内容与权限检查` | 见 §2.5 展开 | 🔴 待 CI 实跑 |

**附加覆盖（R-17c，缓存失效）**：`[R-17c] 缓存失效与 Redis 内存观测` ——
`info memory` / `info keyspace` / `dbsize` 观测 → 连续 40 次请求触发缓存写入 → 再观测 →
`FLUSHDB` → 断言 `dbsize == 0` → 断言首页仍 200（缓存清空不得导致 5xx）。

### 2.5 第 9 项「镜像内容与权限检查」的 6 个子断言（展开）

| 子项 | 断言 | 为什么重要 |
|---|---|---|
| 9a | `Config.User` 非空且 ≠ `root`/`0`；且**容器内实际 `id -u` ≠ 0** | 只查镜像元数据不够 —— 必须进容器实跑一次 `id -u`，防止 `USER` 指令被后续层覆盖 |
| 9b | 打印 `/app`、`/app/public`、`/app/.next`、`/app/node_modules` 的属主与权限 | 确认 `COPY --chown=nextjs:nodejs` 真的生效 |
| 9c | 镜像内**不存在** `playwright` / `playwright-core` / `vitest` / `typescript` / `@playwright/test` / `pixelmatch` / `pngjs` / `@types/node`；同时**必须存在** `drizzle-kit/bin.cjs`、`tsx/dist/cli.mjs`、`next/dist/bin/next` | 前者证明 devDependencies 没被带进生产镜像（Dockerfile 里 `rm -rf node_modules/playwright-core ...` 的回归护栏）；后者证明 entrypoint 三个阶段仍能跑 —— **这两组断言必须同时成立**，只查前者会漏掉「删过头导致容器起不来」 |
| 9d | 镜像内**不存在** `.env` / `.env.local` / `.env.test` / `.env.production` / `INSTALL_CREDENTIALS.txt`；且 `find /app -maxdepth 2 -name '*.env*' -o -name '*CREDENTIAL*'` 结果为空 | 凭据泄漏是最高危项。`Dockerfile` 根目录**没有** `.dockerignore`（只有 `deploy/.dockerignore`），所以这一项必须实测，不能靠假设 |
| 9e | `/app/drizzle/0000_init.sql`、`0001_striped_magdalene.sql`、`0002_v004_perf_indexes.sql`、`/app/drizzle/meta/_journal.json` 均在镜像内 | 缺 `0002` 会导致升级时性能索引不生效（`deploy/.dockerignore` 里有 `!drizzle/*.sql` 白名单，但根目录构建不走那个文件） |
| 9f | 打印镜像体积 | 体积回归的哨兵 |

---

## 3. 本地可做的静态/逻辑复核（✅ 实测 / 🟡 静态）

### 3.1 Compose 配置静态校验（🟡 静态 —— 用 YAML 解析替代 `docker compose config`）

> **说明**：本机无 Docker，**无法执行 `docker compose config`**（它需要 Docker CLI）。
> 下面用 Python + PyYAML（6.0.3）做等价解析，逐服务提取关键字段并做断言。

#### 3.1.1 `docker-compose.yml`（仓库根）

```
YAML parse: OK
  services : postgres, redis, app
  volumes  : postgres-data, redis-data
  networks : v2ex-net
   - postgres  image=postgres:17-alpine   ports=NONE   healthcheck=yes  restart=unless-stopped
     OK: postgres does not expose host ports
     healthcheck test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER:?} -d ${POSTGRES_DB:?}']
   - redis    image=redis:7-alpine       ports=NONE   healthcheck=yes  restart=unless-stopped
     OK: redis does not expose host ports
     healthcheck test: ['CMD', 'redis-cli', '-a', '${REDIS_PASSWORD:?}', 'ping']
   - app      image=build:Dockerfile     ports=['${APP_PORT:-3000}:3000']  healthcheck=NO  restart=unless-stopped
```

**必填环境变量（缺一即容器启动失败 —— 这是有意的「快速失败」设计）**：

```
POSTGRES_USER        POSTGRES_PASSWORD     POSTGRES_DB
REDIS_PASSWORD       SESSION_SECRET        SEED_ADMIN_PASSWORD
```

#### 3.1.2 `deploy/docker-compose.yml`（发行版）

```
YAML parse: OK
  services : postgres, redis, app
   - postgres  image=postgres:17-alpine   ports=NONE   healthcheck=yes  restart=unless-stopped
   - redis    image=redis:7-alpine       ports=NONE   healthcheck=yes  restart=unless-stopped
   - app      image=${V2EX_IMAGE:-ghcr.io/alicia1030su/v2ex-clone:v0.0.3}
              ports=['${APP_PORT:-3000}:3000']  healthcheck=YES  restart=unless-stopped
     healthcheck test: ['CMD','node','-e', "const http=require('http');...探 / 的状态码 <500 则 exit 0"]
```

#### 3.1.3 根 compose 与发行版 compose 的**差异清单**（`diff` 实测）

| 维度 | 根 `docker-compose.yml` | `deploy/docker-compose.yml` | 判定 |
|---|---|---|---|
| app 镜像来源 | `build: {context: ., dockerfile: Dockerfile}`（本地构建） | `image: ${V2EX_IMAGE:-ghcr.io/...:v0.0.3}`（拉预构建） | ✅ 有意区分 |
| app healthcheck | **无** | **有**（`node -e` 探 `/`，`start_period: 90s`） | ✅ 发行版需要给 install/start/update 脚本等待就绪的信号 |
| `env_file` | 无 | `- .env` | ✅ 一次性加载 install.sh 生成的凭据 |
| `TRUST_PROXY_HEADERS` | 无 | `'${TRUST_PROXY_HEADERS:-0}'`（默认**不信任**） | ✅ 默认安全 |
| PG / Redis 端口暴露 | 无 | 无 | ✅ 两边一致 |
| PG / Redis healthcheck | 有 | 有 | ✅ 一致 |
| 网络 | `v2ex-net` | `v2ex-net` | ✅ 一致 |
| 数据卷 | `postgres-data` / `redis-data` | `postgres-data` / `redis-data` | ✅ 一致 |

#### 3.1.4 `docker-compose.debug.yml`（本地调试 override）

```
  - postgres  ports=['127.0.0.1:${POSTGRES_PORT:-5432}:5432']
  - redis    ports=['127.0.0.1:${REDIS_PORT:-6379}:6379']
```

**判定：✅ 安全**。虽然暴露端口，但绑定在 `127.0.0.1` 而非 `0.0.0.0` ——
只有本机能连，局域网/公网不可达。文件头已写明「严禁在生产环境使用」。
且它**只是 override 文件**，不与根 compose 同时生效（必须显式 `-f` 指定）。

### 3.2 `scripts/release/preflight.sh` 覆盖度复核（✅ 实测运行）

```
$ bash scripts/release/preflight.sh --phase=dev
```

脚本自我承诺「只读、不写、不联网」，实测确认它**确实只读**：
全程仅用 `git status/rev-parse/branch/tag -l/ls-files`、`grep`、`sed`、`cut`、`tr`、`od`、`cat`、
`node -p`、`bash -n`。**没有** `git fetch/push/tag/commit`、`gh`、`curl`、`docker`、`npm install`。

对 v0.0.4 发布前置的覆盖矩阵：

| v0.0.4 发布前置条件 | preflight 是否覆盖 | 覆盖方式 / 实测结果 |
|---|---|---|
| 工作区干净 | ✅ | §1 `git status --porcelain` 为空 → PASS |
| 分支可确定（非 detached HEAD） | ✅ | §1 `git branch --show-current` |
| **最终 Tag 不被提前创建** | ✅ | §1 本地存在 `v0.0.4` → **BLOCK**（阻断发布） |
| v0.0.3 Tag 保持不动 | ✅ | §1 只读列出 `v0.0.3*` 本地 tag |
| 版本载体同步（package.json / deploy/VERSION / .env.example / 10 个 deploy 文件） | ✅ 双模式 | §2 `check_carrier`，dev 阶段判 INFO、release 阶段判 FAIL |
| **`release.yml` tag 白名单含 v0.0.4** | ✅ | §3：release 阶段 → **FAIL**（"否则推 tag 不触发任何 job"）；dev 阶段 → INFO |
| `publish` 输入默认 false（Release 保持 Draft） | ✅ | §3 `grep -A4 'publish:' \| default: false` |
| `dry_run` 输入默认 true | ✅ | §3 |
| Release Notes 用动态版本（`__VERSION__` + sed） | ✅ | §3 三重判定（无 v0.0.1 硬编码 + 有占位符 + 有 sed 注入） |
| release concurrency 不取消进行中的发布 | ✅ | §3 `cancel-in-progress: false` |
| 迁移物完整性（journal 3 条 + 3 个 SQL 文件） | ✅ | §4 |
| **0002 幂等性**（所有 CREATE INDEX 带 `IF NOT EXISTS`） | ✅ | §4：`IDX_TOTAL` 与 `IDX_SAFE` 必须相等，否则 FAIL |
| pg_trgm 扩展带 `IF NOT EXISTS` 且在异常捕获块 | ✅ | §4 |
| 0002 无破坏性 DDL/DML | ✅ | §4 正则扫 `DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ALTER TABLE...DROP` |
| 安装包 13 个必需文件齐全 | ✅ | §5 |
| `install.ps1` 带 UTF-8 BOM（EF BB BF） | ✅ | §5 `od -An -tx1 -N3` |
| `deploy/*.sh` 语法 | ✅ | §5 逐个 `bash -n` |
| Git 跟踪文件中无 `.env` 系列（仅 `.env.example`） | ✅ | §5 `git ls-files \| grep -E '(^\|/)\.env' \| grep -v '\.env\.example$'` |
| `.dockerignore` 白名单保留 `drizzle/*.sql` | ✅ | §5 |
| entrypoint 阶段 1 执行迁移 | ✅ | §5 `grep 'drizzle-kit/bin.cjs migrate'` |
| **R-01 授权阻断** | ✅ | §6：`RISK_REGISTER.md` 含 `DEFERRED` → **BLOCK**（Release 只能停在 Draft） |
| 测试记录存在 | ✅ | §6 `TEST_REPORT.md` 存在性检查（**不解析通过数**，避免替测试判定背书） |
| 远端 Tag / Release / 镜像状态 | ❌ **不覆盖** | 脚本**明确声明**「远端状态需人工授权后核验，脚本绝不访问网络」→ 由本轮 §`ci-status-v0.0.4.md` 补齐 |
| **Docker / Redis 运行时行为** | ❌ **不覆盖** | preflight 是**纯静态**检查（脚本自述「不启动容器」）→ 由 `docker-verify.yml` 补齐 |

**结论：preflight 对 v0.0.4 发布前置的静态覆盖是充分的，无缺口需要补代码。**
两个不在其范围内的项（远端状态、容器运行时）已分别由本文档 §`ci-status-v0.0.4.md`
和 `docker-verify.yml` 覆盖。

> ✅ **preflight 的「单元基线 185 条」硬编码 —— 已由部署工程师修复**（`scripts/release/preflight.sh` 第 293–310 行）。
>
> **修复方式**（比我建议的「改成 190」更根治）：**动态统计文件数 + 明确标注条数口径来源**。
>
> ```bash
> UNIT_SPEC_FILES="$(find tests -maxdepth 1 -name '*.spec.ts' | wc -l)"   # → 15
> E2E_SPEC_FILES="$(find e2e   -maxdepth 1 -name '*.spec.ts' | wc -l)"   # → 11
> ```
>
> 实测输出：
> ```
> 单元测试用例文件数：15 个（用例条数以 docs/evidence/ci/test-baseline-v0.0.4.md 的 vitest JSON reporter 实测为准）
> E2E 用例文件数：11 个（用例条数以 playwright test --list 实测为准）
> 历史基线参考：v0.0.3 为 185 条 / 14 文件（master @ 37710fb4）；当前实测 190 条 / 15 文件
> ```
>
> **为什么只给文件数、不在 preflight 里给条数** —— 这个判断是对的：
> preflight 是**只读发布前检查**，它自己的硬性约束就是「不跑测试」；
> 而跑一次 vitest 要 **4m51s** 且必须连库，放进发布闸门不合适。
> 加上**条数的唯一可靠来源是运行时的 `numTotalTests`**（静态 grep `it(` 得 180 ≠ 190）——
> 所以「文件数」静态可确定（preflight 直接动态数），「条数」需运行时（指向本目录的 JSON reporter 实测）。
>
> **结果**：以后加测试文件，preflight 的数字**自动跟着变**，不会再过时。
> 部署工程师已独立复跑验证（`numTotalTests = 190`，4m51s，exit=0），与我的结论一致。
> （`preflight.sh` 与 `verify-update-script.sh` 归 `software-engineer-deploy`，非我所有。）

### 3.3 Dockerfile 生产依赖闭包复核（🟡 静态源码审阅）

`Dockerfile` 的 `runner` 层用的是 **`npm ci --omit=dev`**，而不是 `COPY --from=builder /app/node_modules`。
源码中已写明原因（修复前整个 node_modules 530 MB 被搬进最终镜像，含测试工具链与
GHSA-67mh-4wv8-2f99 受影响版本）。

**残留处理**（`playwright-core` 14 MB）：

```dockerfile
RUN npm ci --omit=dev --no-audit --no-fund \
 && rm -rf node_modules/playwright-core node_modules/playwright node_modules/@playwright \
 && npm cache clean --force \
 && rm -rf /root/.npm \
 && test -f node_modules/drizzle-kit/bin.cjs \
 && test -f node_modules/tsx/dist/cli.mjs \
 && test -f node_modules/next/dist/bin/next \
 && echo "✓ 生产依赖闭包校验通过（entrypoint 三个必需路径均在）"
```

**判定**：D层自带「防回归护栏」—— 若将来 next 把 playwright 变成运行时必需，
构建会**当场失败**而不是等容器启动才炸。这三条 `test -f` 断言与
`docker-verify.yml` 的 9c 断言**互为补充**（一个在构建期、一个在验证期）。

**非 root 运行**：`Dockerfile` 有 `USER nextjs`（uid 1001），
且 `RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs`。
`docker-verify.yml` 的 9a 会**实跑** `id -u` 复核（不能只信元数据）。

---

## 4. 推送后如何拿到真实证据

### 4.1 触发

```bash
# 方式 A：推送分支后自动触发（push / PR）
git push origin feat/v0.0.4-high-fidelity

# 方式 B：手动定点重跑
gh workflow run docker-verify.yml --ref feat/v0.0.4-high-fidelity

# 查看 run
gh run list --workflow=docker-verify.yml --limit 5 \
  --json databaseId,headSha,conclusion,url,createdAt
```

### 4.2 取证

```bash
# 下载完整日志
gh run view <RUN_ID> --log > /tmp/docker-verify.log

# 逐项打勾（每项都必须能找到对应 step 的输出）
grep -nE '\[1/9\]|\[2/9\]|\[3/9\]|\[4/9\]|\[5/9\]|\[7/9\]|\[8/9\]|\[9/9\]|\[R-17' /tmp/docker-verify.log

# 关键断言的实证
grep -nE '容器内实际用户|✓ 不含 |✓ /app/drizzle/|down/up 后|重启后 主题数|app health|redis ping|\.env 权限' /tmp/docker-verify.log

# 下载 artifact
gh run download <RUN_ID> -n docker-verify-evidence -D ./docker-verify-evidence
```

### 4.3 证据回填

实跑后，把 Run URL、`gh run view --log` 的原始输出、`docker-verify-evidence` artifact
内的 `summary.md` **原样**追加到本文档的 §5「实跑结果」段，
并把 §0 的 🔴 标记改为 ✅。**在实跑之前，本文档保持 🔴。**

---

## 5. 实跑结果

### 5.1 🔴 **本工作流在真实 CI 上暴露了我交付物的 3 个缺陷**

诚实记录：**我交付的工作流自身有 bug，全部是真实 CI 跑出来的，不是纸面推演。**

| Run | 症状 | 根因 | 修复 |
|---|---|---|---|
| `41836244258` | **0 秒失败、`total_count=0`、无任何 job 被创建**，只报一句「This run likely failed because of a workflow file issue」 | 我把三元式写进了 `${{ }}` 表达式上下文 —— **GitHub Actions 的表达式不支持 `&&`/`||` 三元运算**（`||` 取默认值支持，三元不支持） | `2532f5f`（主理人）—— 三元判断下沉到 `run:` 的 shell 层：`$([ "${{ job.status }}" = 'success' ] && echo PASS \|\| echo FAIL)` |
| `41836588637` | 第 9 项红灯：`✗ 镜像内缺少迁移文件: _journal.json` | **验证脚本自身的路径错误**：`drizzle` 的迁移 SQL 在 `/app/drizzle/` 根目录，而 `_journal.json` 与 snapshot 在 `/app/drizzle/meta/` 子目录 —— 我把两者混在同一列表用同一路径断言 | `930f29e`（主理人）—— SQL 与 meta 元数据分成两段断言，meta 段覆盖 3 个 snapshot + journal（**覆盖面反而更严**） |
| `41837202602` | 第 2 项红灯：`✗ app 未达 healthy（none）` | **断言口径本身不可能成立**：根目录 `docker-compose.yml` 的 **app 服务没有定义 healthcheck**（只有 `deploy/docker-compose.yml` 才有）。所以 `docker inspect '{{.State.Health.Status}}' v2ex-app` **永远返回 `none`** | **本轮由我修复**（见 §5.1.1） |

#### 5.1.0 我在复核第 4 项时**主动发现的第 4 个缺陷**（尚未被 CI 触发，但一定会红）

主理人让我「补齐其余项覆盖」时，我逐项复核了 `[7/9]` 的执行上下文，
发现**它必然失败**（不是「可能」）：

> **冲突 1 —— 端口占用**：`install.sh` 第 163 行有硬性端口检查：
> ```bash
> if port_in_use "$APP_PORT"; then
>   die "端口 ${APP_PORT} 已被占用。请先停止占用该端口的程序…"
> ```
> 而此时根 compose 的 app 容器**仍在运行**，映射着宿主机 `${APP_PORT:-3000}` = **3000**。
> → `install.sh` 会**直接 `die`**。
>
> **冲突 2 —— 容器名冲突**：两份 compose 都硬编码了
> `container_name: v2ex-postgres` / `v2ex-redis` / `v2ex-app`
> → `docker compose up -d` 会因容器名已存在而失败。
>
> **冲突 3 —— 步骤顺序**：修好前两个之后，`[7/9]` 结束时根 compose 处于停止状态，
> 而后续 `[8/9]`（`docker stats` / `docker exec v2ex-app`）与 **R-17 三项**
> 都依赖 `v2ex-app` 正在运行 → 会连带失败。

**修复（三处一起改，缺一不可）**：

1. **`[7/9]` 开头先停根 compose**（`stop` + `rm -f`，**保留卷**，不影响前面已取证的数据卷状态）
2. **改用 3100 端口**并预置 `.env`（`install.sh` 对 `.env` 是幂等的 —— 第 170 行注释
   「准备 .env（幂等：已存在则不覆盖）」，且 `set_env_value` 只写 4 个凭据变量 + `V2EX_IMAGE`，
   **不会覆盖** `APP_PORT`）
3. **`[7/9]` 结尾停掉安装包容器并恢复根 compose**，供 `[8/9]` 与 R-17 三项使用

**另外加了一条防呆断言**（防止未来有人把 `V2EX_IMAGE` 改成外部仓库）：

```bash
IMG=$(grep -E '^V2EX_IMAGE=' .env | cut -d= -f2-)
case "${IMG}" in
  ghcr.io/*|docker.io/*|quay.io|registry.*)
    echo "  ✗ 安装包指向了外部镜像仓库 —— 本工作流必须只用本地构建镜像"; exit 1 ;;
esac
[ "${IMG}" = "v2ex-clone:dv" ] || { echo "  ✗ V2EX_IMAGE 应为 v2ex-clone:dv"; exit 1; }
```

**为什么绝不会 push / 绝不会拉外部镜像**：
`install.sh` 第 332 行会先试 `docker compose pull`，但 `v2ex-clone:dv` 这个 tag
**只存在于本工作流本地构建的镜像里**，pull 必然失败 → 脚本走
「拉取失败但本机已存在该镜像 → 继续使用本地镜像」的分支（`deploy/install.sh` 第 337–341 行）。
本工作流**没有任何 `docker login` / `docker push`**，也**不设置 registry 凭据**。

> 📌 **这一条也回答了主理人的第 3 个问题**：是的，`[7/9]` 用的是本地构建的 `v2ex-clone:dv`，
> 且现在**多了一条断言来保证它不会变成外部镜像**。

#### 5.1.1 第 3 个缺陷的详细诊断（run `41837202602`）

**真实 CI 日志证明 app 其实是完全健康的**：

```
v2ex-app | [entrypoint] 等待数据库就绪...
v2ex-app | [entrypoint] 数据库就绪。
v2ex-app | [entrypoint] 阶段 1/3：执行数据库迁移...
v2ex-app | [✓] migrations applied successfully!
v2ex-app | [entrypoint] 阶段 2/3：检查是否需要首次初始化...
v2ex-app | [entrypoint] 首次初始化阶段完成。
v2ex-app | [entrypoint] 阶段 3/3：启动应用服务...
v2ex-app |  ✓ Ready in 414ms          ← 应用确实起来了
```

但我的断言读到的是 `app=none`：

```
  [27s] postgres=healthy redis=healthy app=none
  ...
  [60s] postgres=healthy redis=healthy app=none
  ✗ app 未达 healthy（none）
```

**根因（静态复核确认）**：

```
docker-compose.yml        : app.healthcheck = *** NONE ***
deploy/docker-compose.yml : app.healthcheck = YES  (node -e 探 /, start_period 90s)
```

发行版 compose 才有 app healthcheck（因为 `install.sh`/`start.sh`/`update.sh` 需要等就绪信号），
**仓库根 compose 没有** —— 我在写工作流时把两者当成了同一份。

**修复（已落地到 `docker-verify.yml`）**：把 app 的就绪判定从
「读 `State.Health.Status`」改为「**容器状态 + HTTP 探活**」，
而 PG / Redis 继续用 health 状态（它们**确实有** healthcheck）：

```bash
PG=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' v2ex-postgres ...)
RD=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' v2ex-redis ...)
APP_STATE=$(docker inspect --format '{{.State.Status}}' v2ex-app ...)
APP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000/ ...)
if [ "$PG" = "healthy" ] && [ "$RD" = "healthy" ] \
   && [ "$APP_STATE" = "running" ] && [ "$APP_CODE" = "200" ]; then ...
```

**HTTP 探活是更强的证据** —— 它不只证明容器活着，而是证明 **Next.js 真的在服务请求**
（且 `/` 是 force-dynamic 的 Server Component，会同时打到数据库）。

**修复逻辑已用桩程序对照验证**：

```
新逻辑（container state + HTTP 200）:
  [1s] postgres=healthy redis=healthy app_state=running http=200
  ✓ PG/Redis healthy，app 容器 running 且 HTTP 200
  ✓ 三个服务全部就绪
  EXIT=0                                        ← 通过

旧逻辑（读 State.Health.Status）:
  [1s] postgres=healthy redis=healthy app=none
  ...
  ✗ app 未达 healthy（none）
  EXIT=1                                        ← 这正是 CI 的失败
```

**同时修掉了 `[4/9]` 与 `[5/9]` 里同样的错误模式**
（这两步也用了根 compose 的 `v2ex-app` health 状态），现在三处统一用
「容器状态 + HTTP 200」。

> ⚠️ **`[7/9]` 安装包那一步保留 `State.Health.Status` 断言是正确的** ——
> 它用的是 `deploy/docker-compose.yml`（发行版），**那里 app 确实有 healthcheck**。
> 已复核确认，不属于同类缺陷。

> ⚠️ **连带影响值得记录**：`[9/9]` 排在第 2 项**之前**，所以它一红，
> **第 2–8 项与全部 R-17 三项都被连带 skip** —— 这在 run `41836588637` 的 step 列表里清晰可见。
> **教训**：在一个「逐项断言」的工作流里，**任何一项失败都会遮蔽后续所有项的取证**。
> 理想做法是各项互不依赖（用 `if: always()` + 汇总判定），
> 或至少把「最可能失败、最容易被遮蔽」的项目排在最后。当前顺序是「先便宜后昂贵」，
> 在修掉三个 bug 后已可接受，但**结构上的脆弱性仍存在**，记为已知局限。

### 5.2 ✅ 已被真实 CI 确认通过的部分

**Run** `41836588637` / `41836706240`（`2532f5f9`）与 `41837202602` / `41837212362`（`930f29e`）：

| 步骤 | 结论 | 说明 |
|---|---|---|
| 环境信息 | ✅ success | Docker / Compose 版本、磁盘可用量 |
| `[1/9] 镜像真实构建` | ✅ **success** | `docker build` 真实成功 |
| `[9/9] 镜像内容与权限检查` | ✅ **success**（`930f29e` 修复路径后） | 见下方明细 |
| `[2/9][3/9]` Compose 启动 + 健康检查 | 🔄 **真实执行中** | |
| `[4/9]`–`[8/9]`、`[R-17a-c]` | 🔄 排队中 | |
| 生成验证汇总 / 上传验证证据 / compose 日志 / 停止并清理 | ✅ success | `if: always()` 生效，失败时也能留证据 |

**`[9/9] 镜像内容与权限检查` —— 真实 CI 已确认通过的子断言**（从 run `41836588637` 日志）：

- ✓ **`Config.User` 非 root，容器内 `id -u` ≠ 0**
- ✓ **镜像不含 devDependencies**（playwright / playwright-core / vitest / typescript / `@playwright/test` / pixelmatch / pngjs / `@types/node` —— **8 项全不含**）
- ✓ **镜像含运行时必需文件**（`drizzle-kit/bin.cjs`、`tsx/dist/cli.mjs`、`next/dist/bin/next`）—— 证明 entrypoint 三个阶段仍能跑
- ✓ **镜像不含** `.env` / `.env.local` / `.env.test` / `.env.production` / `INSTALL_CREDENTIALS.txt`
- ✓ **无凭据文件**（`find` 全盘扫 `.env*` 与 `*CREDENTIAL*` 结果为空）
- ✓ **迁移物 `0000`/`0001`/`0002` 三个 SQL 均在镜像内**
- ✓ **`meta/` 下 `_journal.json` + 3 个 snapshot 均在镜像内**（`930f29e` 补齐）

> 📌 **这一项是整个 R-16 里安全价值最高的部分**：
> 它用**真实镜像**证明了「生产镜像不含测试工具链、不含凭据、以非 root 运行、
> 但保留了 entrypoint 必需的运行时依赖」——
> **删过头导致容器起不来**与**删不够导致漏洞版本进生产**这两个方向都被覆盖了。

### 5.3 🔄 仍待真实 CI 出结果的部分

`[4/9]` 数据卷持久化、`[5/9]` 容器重启、`[7/9]` 安装包实际部署、`[8/9]` 容器资源观察、
`[R-17a]` Redis 中断恢复、`[R-17b]` PG 中断恢复、`[R-17c]` 缓存失效观测 ——
**本轮修复了第 2 项的断言口径后，需重新触发一次 CI 才能取证**，完成后回填本节。

> ⚠️ 在结果出来之前，**这些项一律保持 🔴 待取证**。
> 「工作流已就绪」与「验证已通过」是两件事 —— 本文档严格区分。
>
> 📌 **注意**：第 7 项「安装包实际部署」的**核心内容已被另一条工作流独立证明** ——
> `install-verify.yml` 的 `Linux + 真实 Docker 安装` job 在 run `41836706277` / `41837212635` 上
> **success**（真实 Docker 上跑 `install.sh`、`.env` 权限 600、凭据 600、口令强度、
> 容器 healthy、管理员创建、数据持久化、重启后口令不变）。
> 但 `docker-verify` 里的第 7 项走的是**「打成 tar.gz → 全新目录解包 → 安装」**路径，
> 与 install-verify 的路径**不同**，仍需独立取证。

---

## 6. 与 `ci.yml` / `install-verify.yml` 的职责边界（避免重复劳动与误判）

| 验证项 | `ci.yml` 的 docker job | `install-verify.yml` | **`docker-verify.yml`（新）** |
|---|---|---|---|
| 镜像构建 | ✅ | ✅ | ✅（并记录体积/ID） |
| Compose 启动 | ✅ | ✅ | ✅ |
| PG/Redis 健康检查 | ⚠️ 仅靠 `depends_on: service_healthy` | ✅ | ✅ **三容器** health + psql/redis-cli 实查 |
| 数据卷持久化 | ❌ | ✅（重启后探针用户） | ✅ **跨 `down`（不带 `-v`）+ `up`** |
| 容器重启 | ✅ | ✅ | ✅（含管理员 hash 不变） |
| Redis 中断/恢复 | ❌ | ❌ | ✅ **新增** |
| PG 中断/恢复 | ❌ | ❌ | ✅ **新增** |
| 缓存失效 / 内存观测 | ❌ | ❌ | ✅ **新增** |
| 安装包部署 | ❌ | ✅（Windows 脚本 + Linux） | ✅（**打成 tar.gz 后全新目录解包安装**） |
| 容器资源观察 | ❌ | ❌ | ✅ **新增** |
| 镜像内容与权限 | ⚠️ 仅查 `/app/public` 存在 | ❌ | ✅ **新增（6 个子断言）** |

**结论：R-16 / R-17 的每一个子项都有且仅有一个明确的负责工作流，无重复、无遗漏。**

---

## 7. 风险与残余项

| ID | 残余风险 | 说明 | 缓解 |
|---|---|---|---|
| **R-16** | Docker 全链路未实跑 | 见 §0 | `docker-verify.yml` 已就绪；推送后自动跑 |
| **R-17** | Redis 故障恢复未实跑 | 同上 | 同上 |
| **新增** | `docker-verify.yml` 本身**从未被执行过一次**，可能有 YAML/脚本层面的低级错误 | 任何未跑过的工作流都有这个风险 | ①YAML 已用 PyYAML 解析通过；②每个 step 的 shell 片段已在编写时逐条审过变量引用；③推送后第一次跑若在 shell 语法处红，**step 名带 `[n/9]` 标记**，定位成本很低 |
| **新增** | `install.sh` 在 CI 里可能因 `V2EX_IMAGE` 指向本地 tag 而走不同分支 | `install.sh` 正常路径是拉 GHCR 镜像 | `install-verify.yml` 已覆盖**拉 GHCR** 的路径；本工作流用本地 tag 验证脚本逻辑。**两条路径互补**，不冲突 |
| **新增** | `docker compose down`（不带 `-v`）后再 `up -d`，`app` 服务会**重新构建镜像** | 可能显著拉长运行时间 | 已用 `timeout-minutes: 45` 兜底；若超时，主理人可把该 step 拆成两个 run 定点排查 |
| **说明** | `docker-verify.yml` 会占用一次 Actions runner 的配额 | 单次约 10–20 分钟 | 与 `ci.yml` / `install-verify.yml` 并行触发，不额外串行占用总时长 |

---

## 8. 自我声明

- ❌ **未执行** `git push` / `git commit`
- ❌ **未创建/删除/移动** 任何 Tag
- ❌ **未创建/修改/发布/删除** 任何 Release
- ❌ **未修改** `release.yml` 的 tag 白名单
- ❌ **未修改** 仓库可见性
- ❌ **未 DROP** 任何非隔离测试库（`v2ex_loadtest` / `v2ex_v002_baseline` / `v2ex_e2e` 均未动）
- ❌ **未伪造**任何运行结果 —— 所有 🔴 项都保持为待实跑
- ✅ **唯一新增的仓库文件**：`.github/workflows/docker-verify.yml` 与 `docs/evidence/ci/**`
