# DEPLOYMENT — 部署文档

> **⚠️ 独立非官方项目**
>
> 本项目与 V2EX 官方**无任何关联**，是独立技术研究项目，未获官方授权，
> 不是 V2EX 官方产品，不代表任何形式的官方背书。
>
> **v0.0.2 是开发预览版（Pre-release）**，功能尚未完备，**未经生产环境验证**，
> **不建议用于生产环境**。界面与原站存在差异，**不保证与 V2EX 完全一致**。

本文档面向 **v0.0.2** 发布版的部署。
只想**跑起来看看**请直接看 [`INSTALL.md`](INSTALL.md)；
想**长期运维**请继续往下读。

> **从 v0.0.1 升级？** 请看 [`UPGRADE-v0.0.2.md`](UPGRADE-v0.0.2.md) ——
> 它专门覆盖升级步骤、回滚说明与已知问题。
>
> **镜像地址**：`ghcr.io/alicia1030su/v2ex-clone:v0.0.2`
> （v0.0.1 的镜像 `...:v0.0.1` 仍可拉取，**不会被覆盖**）

---

## 1. 环境要求

| 组件 | 版本 | 说明 |
|---|---|---|
| Node.js | `^22.23.4` \| `^24.22.1` \| `>=26.12.1` | 本地开发与自建镜像构建时需要 |
| PostgreSQL | 17+ | 必需 |
| Redis | 7+ | **可选**。缺失时自动降级到 PostgreSQL（语义等价，性能略低） |
| Docker / Docker Compose | Engine 20.10+ / Compose **v2** | 用于一键部署；compose 文件使用 Compose spec 语法，**不支持 v1** |
| 可用磁盘 | ≥ 2 GB | 镜像约 400 MB，数据库与日志持续增长 |
| 可用内存 | ≥ 2 GB | 三个容器同时运行 |

---

## 2. 环境分层

不同运行时环境下，**安全开关的生效范围不同**。
这是本项目最容易被误配、也最需要说清楚的一块。

判定逻辑集中在 `src/lib/runtime-flags.ts`。

### 2.1 四种环境

| `APP_RUNTIME_ENV` | 用途 | 验证码 | `DISABLE_CAPTCHA` | 调试端点 | `TEST_ENV_ISOLATED` |
|---|---|---|---|---|---|
| `production` | 生产 | **强制启用** | **忽略** | 需显式开启 + 令牌 | 忽略 |
| `staging` | 预发 | **强制启用** | **忽略** | 需显式开启 + 令牌 | 忽略 |
| `test` | 测试 | 可被跳过 | 仅当 `TEST_ENV_ISOLATED=1` 时生效 | 需显式开启 + 令牌 | 生效 |
| `development` | 本地开发 | 默认启用 | **忽略** | 需显式开启 + 令牌 | 忽略 |

### 2.2 各环境**允许**的开关

| 开关 | `development` | `test`（+ `TEST_ENV_ISOLATED=1`） | `staging` | `production` |
|---|---|---|---|---|
| `DISABLE_CAPTCHA=1` | ❌ 忽略 | ✅ 生效 | ❌ 忽略 | ❌ 忽略 |
| `ENABLE_DEBUG_ENDPOINTS=1` | ✅ 生效 | ✅ 生效 | ✅ 生效 | ✅ 生效（**但发行包的 compose 强制写死为 `'0'`**） |
| `TEST_ENV_ISOLATED=1` | ❌ 无效 | ✅ 生效 | ❌ 忽略 | ❌ 忽略 |
| `DEBUG_ENDPOINT_TOKEN` | 可选 | 调试端点必需 | 调试端点必需 | 调试端点必需 |

### 2.3 各环境**禁止**的开关

**在 `production` 与 `staging` 下，以下配置一律无效**（即使误配也不会降级安全性）：

- `DISABLE_CAPTCHA=1` —— 验证码**仍然强制**渲染与校验。
  这不是靠文档约定，而是代码里 `isCaptchaDisabled()` 先判 `getRuntimeEnv() !== 'test'` 就返回 `false`。
  已通过**独立的生产模式实例**实测验证：
  `APP_RUNTIME_ENV=production` 且故意保留 `DISABLE_CAPTCHA=1` 时，
  缺失验证码的登录仍被 **400** 拒绝。
- `TEST_ENV_ISOLATED=1` —— 隔离测试环境的标记在非 `test` 环境无意义。
- `DEBUG_ENDPOINT_TOKEN` 未配置 —— 调试端点**一律返回 404**，
  即使 `ENABLE_DEBUG_ENDPOINTS=1`。（令牌用恒定时间比较。）

### 2.4 发行包的实际行为

发行包的 `docker-compose.yml` 在 app 服务的 `environment` 里**硬编码**：

```yaml
ENABLE_DEBUG_ENDPOINTS: '0'
DEBUG_ENDPOINT_TOKEN: ''
DISABLE_CAPTCHA: '0'
TEST_ENV_ISOLATED: '0'
```

也就是说 —— **即使你在 `.env` 里写了这些变量，也进不到容器**。
这是发行包与源码仓库 compose 的一处刻意差异：**发行包从设计上就不给调试开关留口子**。

> 如果你需要调试端点，只能用**源码仓库**的 compose 配置自行构建镜像，
> 并**只在隔离环境**这么做。

### 2.5 演示账号的环境约束

| `APP_RUNTIME_ENV` | `SEED_DEMO_USERS=1` 的效果 |
|---|---|
| `production` | **强制不创建**演示账号（`lisi` / `wangwu` / `zhaoliu` / `moderator`） |
| `staging` / `test` / `development` | 创建演示账号 |

发行包的 `.env.example` 默认 `SEED_DEMO_USERS=0` —— **保持它为 0**。

---

## 3. 快速开始（Docker Compose）

完整步骤见 [`INSTALL.md`](INSTALL.md)。这里只列最快路径。

### 3.1 用发行包（推荐）

```bash
unzip v2ex-clone-v0.0.2-deploy.zip -d v2ex-clone-deploy
cd v2ex-clone-deploy
chmod +x install.sh start.sh stop.sh update.sh backup.sh restore.sh
./install.sh
```

脚本会自动生成 `.env`（含随机口令，权限 600）、
拉取镜像 `ghcr.io/alicia1030su/v2ex-clone:v0.0.2`、启动容器并等待健康检查。

### 3.1.1 GHCR 可见性说明

发行包从 **GitHub Container Registry** 拉取预构建镜像。
镜像地址与可见性：

| 项 | 值 |
|---|---|
| 仓库 | `ghcr.io/alicia1030su/v2ex-clone` |
| v0.0.2 镜像 | `ghcr.io/alicia1030su/v2ex-clone:v0.0.2` |
| v0.0.1 镜像 | `ghcr.io/alicia1030su/v2ex-clone:v0.0.1`（**保留，不覆盖**） |
| 可见性 | **Public** —— 可匿名 `docker pull`，无需 GitHub 登录 |

**如果 `docker pull` 报 `denied` / `unauthorized`：**

```bash
docker pull ghcr.io/alicia1030su/v2ex-clone:v0.0.2
# Error response from daemon: denied: requested access to the resource is denied
```

说明该 GHCR 包**没有开放匿名拉取**。三种处理方式：

1. **（推荐）** 把该包设为 public：
   仓库 → **Packages** → 找到 `v2ex-clone` → **Package settings** →
   **Change visibility** → **Public**。
2. **登录后拉取**：`docker login ghcr.io`（需要对该包有读权限的账号）。
3. **完全绕开 GHCR**：用源码仓库本地构建，不需要访问 GHCR ——
   ```bash
   git clone https://github.com/alicia1030su/v2ex-clone.git
   cd v2ex-clone && cp .env.example .env
   # 填好 .env 后
   docker compose up -d --build
   ```

> **为什么可见性会变**：GHCR 包的可见性默认**链接**到所属仓库的可见性。
> 若仓库关联关系变化，或包被单独设为 private，匿名拉取会**静默失效**。
> 发布流水线的 `verify-release` job 内含**匿名 `docker pull` 实测**，
> 失败即让发布失败并回退为 draft —— 所以正式发布的版本一定是可匿名拉取的。

### 3.2 用源码仓库

```bash
git clone https://github.com/alicia1030su/v2ex-clone.git
cd v2ex-clone
cp .env.example .env
# 至少设置：POSTGRES_PASSWORD / REDIS_PASSWORD / SESSION_SECRET / SEED_ADMIN_PASSWORD
docker compose up -d --build
```

> `docker-compose.yml` 中所有凭据**无默认值** —— 未设置时容器会直接启动失败，
> 而不是带着弱口令运行。
> 源码仓库的 compose 用**本地构建**（`build:`），发行包的 compose 用**预构建镜像**（`image:`）。

### 3.3 容器启动的三个阶段

容器启动时会**自动执行三个阶段**（见 `scripts/docker-entrypoint.sh`）：

| 阶段 | 动作 | 幂等性 | 说明 |
|---|---|---|---|
| 1/3 | `drizzle-kit migrate` | ✅ 每次都执行 | 只做增量迁移，已应用的迁移不会重复执行 |
| 2/3 | 首次初始化（seed） | ✅ **仅执行一次** | 由 `kv_store` 的初始化标记守卫；已初始化的库直接跳过 |
| 3/3 | `next start` | — | 启动应用服务 |

> **重新部署不会污染数据。**
> 阶段 2 带初始化标记，只在数据库首次初始化时写入演示数据。
> 后续的 `docker compose up` / `restart` / 重新部署都只执行迁移，
> **不会**重置管理员口令，**不会**重复写入演示主题。

数据库与 Redis 均配置了 healthcheck，app 服务会等待两者健康后再启动。
发行包的 app 服务**额外**有 healthcheck（用镜像内的 `node` 探测 `/`），
`docker compose ps` 会显示 `Up (healthy)`。

### 3.4 端口暴露策略

发行包与源码仓库的 compose **默认都不向宿主机暴露** PostgreSQL 与 Redis 端口，
两者只在 compose 内部网络（`v2ex-net`）内可达：

```bash
# 验证：默认配置下 postgres / redis 段没有 published 字段
docker compose config | grep -A 20 '^  postgres:' | grep published   # 无输出
docker compose config | grep -A 20 '^  redis:' | grep published      # 无输出
```

需要本地直连数据库做调试时，**不要改生产用的 compose 文件**，用一次性容器：

```bash
docker run --rm -it --network v2ex_v2ex-net \
  -e PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2)" \
  postgres:17-alpine psql -h postgres -U v2ex -d v2ex
```

> 源码仓库另有 `docker-compose.debug.yml`，它会把端口绑定到 `127.0.0.1`（而非 `0.0.0.0`），
> 即使开启映射也只有本机能连。**严禁在生产环境使用该文件**，
> 且它**不在发行包内**。

停止 / 清理：

```bash
docker compose down            # 停止，保留数据卷
docker compose down -v         # 停止并删除数据卷（⚠️ 会丢失数据）
```

---

## 4. 本地开发（不使用 Docker）

### 4.1 启动依赖

```bash
# PostgreSQL（示例用 Docker 起一个）
docker run -d --name v2ex-pg \
  -e POSTGRES_USER=v2ex -e POSTGRES_PASSWORD=v2ex_password -e POSTGRES_DB=v2ex \
  -p 5432:5432 postgres:17-alpine

# Redis（可选）
docker run -d --name v2ex-redis \
  -p 6379:6379 redis:7-alpine redis-server --requirepass v2ex_redis_password
```

### 4.2 应用

```bash
npm install
cp .env.example .env.local        # 修改 DATABASE_URL / REDIS_URL / SESSION_SECRET

npm run db:generate               # 修改 schema.ts 后生成迁移
npm run db:migrate                # 应用迁移
npm run db:seed                   # 写入初始分类/节点/用户/主题

npm run dev                       # 开发模式 http://localhost:3000
```

### 4.3 生产构建

```bash
npm run build
npm run start                     # 生产模式
```

### 4.4 验证

```bash
./scripts/verify.sh               # 类型检查 → 构建 → 干净库迁移 → seed → 单元测试 → E2E
./scripts/verify.sh --skip-e2e    # 跳过 E2E
```

`verify.sh` 是**跨平台**的：数据库操作统一走 Node 脚本（不依赖 `psql` / `pg_dump`），
进程管理区分 Windows（`taskkill`）与 POSIX（`kill`）。
它只在**专用验证库**（默认 `v2ex_verify`）上操作，
并拒绝在非验证库（库名必须匹配 `*_verify` / `*_test` / `*_ci`）上执行破坏性操作。

---

## 5. 数据库迁移

```bash
npm run db:generate -- --name=add_xxx   # 生成迁移（写入 drizzle/）
npm run db:migrate                       # 应用未执行的迁移
```

迁移文件位于 `drizzle/`，由 `drizzle-kit` 按 `drizzle/meta/_journal.json` 顺序执行。
生产环境在容器启动时自动执行 `drizzle-kit migrate`（幂等）。

查看状态：

```bash
psql "$DATABASE_URL" -c "select id, hash, created_at from drizzle.__drizzle_migrations;"
```

> ⚠️ **v0.0.2 是预览版，迁移脚本不保证向后兼容。**
> 预览版本之间的升级请务必先备份（见第 8 节）。

---

## 6. 初始账号

`npm run db:seed` / 容器启动时的首次初始化会创建：

| 角色 | 用户名 | 密码 | 来源 |
|---|---|---|---|
| 管理员 | `admin` | `SEED_ADMIN_PASSWORD`（生产必填，≥12 位） | 环境变量 |
| 普通用户 | `lisi` | `SEED_DEMO_PASSWORD`（未设置则随机生成并打印） | 环境变量 |
| 普通用户 | `wangwu` | 同上 | 环境变量 |
| 普通用户 | `zhaoliu` | 同上 | 环境变量 |
| 版主 | `moderator` | 同上 | 环境变量 |

> **生产环境不会创建演示账号**（`APP_RUNTIME_ENV=production` 时强制禁用），
> 也不会接受缺失或过弱的管理员口令 —— seed 会直接报错退出。
>
> **生产部署后请立即修改管理员密码**，并删除不需要的演示账号。

### 6.1 seed 只初始化、不修改

seed 采用**只创建、不修改**语义：账号已存在时**不会**覆盖它的口令与角色。
这是刻意的安全设计 —— 否则重新部署容器就会静默重置管理员口令、
用户自行改密的成果也会被抹掉。

口令与角色的变更必须走**独立的授权流程**：

```bash
# 需要先配置 ADMIN_CLI_TOKEN（运维专用的随机令牌）
export ADMIN_CLI_TOKEN=$(openssl rand -base64 32)

npm run admin -- set-password --username lisi \
  --password 'NewPassw0rd!' --reason '用户申诉后重置'

npm run admin -- set-role --username lisi \
  --role moderator --reason '任命为版主'

npm run admin -- list-admins        # 只读，列出管理员与版主
```

该流程的约束：

- 未配置 `ADMIN_CLI_TOKEN` 时**一律拒绝**执行变更；
- 令牌**只从环境变量读取**，不接受 `--token` 命令行参数
  （命令行参数会出现在进程列表与 shell 历史里）；
- `--reason` 必填，每次变更都写入 `moderation_logs` 审计表；
- 拒绝降级最后一个 admin（避免把系统锁死）；
- 生产环境禁止修改演示账号的角色；
- `set-password` 的口令长度下限是 **8 位**（与注册接口一致），
  注意这与 `SEED_ADMIN_PASSWORD` 的 **≥12 位** 阈值不同。

> 在发行包的容器里执行：
>
> ```bash
> docker compose exec -e ADMIN_CLI_TOKEN=<运维令牌> app \
>   node node_modules/tsx/dist/cli.mjs scripts/admin-cli.ts \
>   set-password --username admin --password '<新口令>' --reason '运维重置'
> ```

---

## 7. 反向代理（Nginx）

```nginx
server {
    listen 80;
    server_name forum.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
```

> **重要**：应用通过 `X-Forwarded-For` / `X-Real-IP` 识别客户端 IP，
> 限流依赖该值。**必须正确透传**，否则所有请求会共享同一限流配额。

启用 HTTPS（推荐）：

```bash
certbot --nginx -d forum.example.com
```

启用 HTTPS 后，把 `.env` 中的 `APP_URL` / `NEXT_PUBLIC_APP_URL` 改成
`https://forum.example.com` 并重启应用 —— 会话 Cookie 的 `secure` 标记依赖正确的主机名。

---

## 8. 密钥管理

### 8.1 原则

| 原则 | 说明 |
|---|---|
| **`.env` 不入库** | 仓库的 `.gitignore` 已排除 `.env` / `.env.local` / `.env.test` / `.env.*.local` / `.env.*.test` |
| **模板无凭据** | `.env.example` 不提供任何可用的默认口令；所有敏感项默认为空 |
| **缺失即失败** | `docker-compose.yml` 中必需变量用 `${VAR:?message}` 语法，缺失时容器直接启动失败，**而不是**带着弱口令运行 |
| **镜像不含密钥** | `.dockerignore` 排除 `.env*`；密钥只在运行时注入，不进镜像层 |
| **生产用 secrets manager** | 云上用 Secrets Manager / Vault / K8s Secret；裸机用权限 600 的 `.env` + 专用运维账号 |

### 8.2 密钥清单

| 变量 | 泄露后果 | 轮换方式 |
|---|---|---|
| `SESSION_SECRET` | **会话可被伪造** | 重置后所有会话失效，用户需重新登录 |
| `POSTGRES_PASSWORD` | 数据库完全失守 | `ALTER USER v2ex WITH PASSWORD '...'`；见下方注意事项 |
| `REDIS_PASSWORD` | 缓存与限流计数可被篡改 | 需删 Redis 卷重建（Redis 只是缓存，核心数据在 PostgreSQL） |
| `SEED_ADMIN_PASSWORD` | 初始管理员账号失守 | 只在**首次初始化**时生效；已存在的账号必须用 `admin-cli.ts` 改 |
| `ADMIN_CLI_TOKEN` | 可越权改密 / 改角色 | 重新生成即可（旧令牌立即失效） |
| `DEBUG_ENDPOINT_TOKEN` | 可访问调试端点（清限流、查楼层） | 重新生成即可 |

> **轮换 `POSTGRES_PASSWORD` 的注意事项**：PostgreSQL 的初始口令只对**空数据目录**生效。
> 数据卷已存在时，改 `.env` 不会改变数据库里的实际口令，必须显式 `ALTER USER`：

> ```bash
> docker compose exec postgres psql -U v2ex -d postgres \
>   -c "ALTER USER v2ex WITH PASSWORD '新口令';"
> ```

### 8.3 不要做的事

- ❌ 不要把 `.env` 提交到 Git（哪怕是 private 仓库 —— 密钥会进 Git 历史）
- ❌ 不要把 `.env` 写进 Dockerfile 或 `docker-compose.yml` 的默认值
- ❌ 不要在命令行里传口令（`docker exec ... --password xxx` 会进 shell 历史与进程列表）
- ❌ 不要把 `ADMIN_CLI_TOKEN` 当成密码用 —— 它是**授权令牌**，不是用户口令
- ❌ 不要在 CI 日志里 `echo` 任何密钥

---

## 9. 数据库备份策略与恢复演练

### 9.1 备份策略

| 项 | 建议 |
|---|---|
| 频率 | 每天一次自动备份；升级 / 迁移前额外手动备份一次 |
| 保留 | 至少 7 个日备份 + 4 个周备份 |
| **异地** | **必须**把备份复制到另一台机器或对象存储。**同盘备份不是备份** |
| 加密 | 备份含用户数据与凭据，异地存放前应加密 |
| 权限 | 备份目录 `700`，`.env` 备份 `600` |
| 监控 | 备份任务失败要**告警**，不是靠人肉发现 |

发行包提供的脚本：

```bash
./backup.sh
# 产出：backups/v2ex-20261103-120000.sql.gz（数据库逻辑备份）
#       backups/.env-20261103-120000（配置备份，权限 600）
```

### 9.2 恢复演练

**没有演练过的备份不算备份。** 建议每季度做一次完整演练：

```bash
# 1. 在一台一次性机器上（或临时目录）准备环境
cp .env.example .env       # 填入与生产不同的口令

# 2. 只起数据库（不起 app），避免写入竞争
docker compose up -d postgres

# 3. 恢复演练
./restore.sh backups/v2ex-20261103-120000.sql.gz

# 4. 核对关键数据量
docker compose exec postgres psql -U v2ex -d v2ex -c \
  "select count(*) from users; select count(*) from topics; select count(*) from replies;"
```

演练要确认：

- [ ] 恢复过程**无报错**退出（`psql --single-transaction`，要么全成功要么全回滚）
- [ ] 表数量 = 18
- [ ] `users` / `topics` / `replies` 的行数与备份时一致
- [ ] 恢复后应用能正常启动并登录

### 9.3 手动备份 / 恢复

```bash
# 备份
docker compose exec -T postgres pg_dump \
  --username=v2ex --dbname=v2ex --no-owner --no-acl \
  | gzip -9 > v2ex-$(date +%F).sql.gz

# 恢复
gunzip -c v2ex-2026-11-03.sql.gz \
  | docker compose exec -T postgres psql \
      --username=v2ex --dbname=v2ex --single-transaction
```

---

## 10. 监控与日志

### 10.1 日志

```bash
docker compose logs -f app            # 应用实时日志
docker compose logs -f postgres       # 数据库实时日志
docker compose logs --tail=200 app     # 最后 200 行
docker compose logs --since=1h app     # 最近 1 小时
docker compose logs --since="2026-11-03T00:00:00" app   # 指定时间点之后
```

### 10.2 健康检查

| 服务 | 检查方式 | 预期状态 |
|---|---|---|
| `postgres` | `pg_isready -U <user> -d <db>` | `Up (healthy)` |
| `redis` | `redis-cli -a <pass> ping` | `Up (healthy)` |
| `app`（仅发行包） | 镜像内 `node` 探测 `/`，statusCode < 500 视为健康 | `Up (healthy)` |

```bash
docker compose ps                          # 一次性查看
docker inspect v2ex-app --format '{{.State.Health.Status}}'
```

### 10.3 建议监控的指标

| 指标 | 来源 | 告警建议 |
|---|---|---|
| HTTP 429 比例 | 应用日志 | 突增说明可能被撞库 |
| PostgreSQL 连接数 | `pg_stat_activity` | 接近 `max_connections` 时扩容连接池 |
| `rate_limit_buckets` 行数 | 数据库 | 持续增长说明有大量唯一键被限流 |
| `login_attempts` 失败率 | 数据库 | 失败率突增说明存在爆破尝试 |
| `floor_counters` 与 `replies` 一致性 | 数据库 | 不一致说明楼层分配器异常 |
| 容器重启次数 | `docker inspect --format '{{.RestartCount}}'` | 持续增长说明应用崩溃循环 |
| 数据卷磁盘占用 | `docker system df` | 接近上限时告警 |

### 10.4 v0.0.2 的监控限制

**本版本没有内置监控端点、指标导出（Prometheus）或告警集成。**
上面的指标都需要你自己通过 `docker compose logs` + 数据库查询 + 宿主机监控来采集。
健康检查端点可用（`docker compose ps`），但没有 Prometheus 格式的 `/metrics`。

---

## 11. 回滚方案

### 11.1 应用版本回滚

把 `.env` 里的 `V2EX_IMAGE` 改回**上一个** tag，然后：

```bash
docker compose pull
docker compose up -d          # 就地重建容器，数据卷保留
```

发行包提供了封装好的版本：

```bash
sed -i 's|^V2EX_IMAGE=.*|V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.1|' .env
./update.sh
```

> 从 v0.0.2 回滚到 v0.0.1 的完整步骤（含备份、验证、Windows 版本）见
> [`UPGRADE-v0.0.2.md`](UPGRADE-v0.0.2.md) §5。

### 11.2 ⚠️ 容器 tag 不可移动

**同一个 tag 一旦发布就不应重新指向另一个镜像。**

- tag 是**不可变**的，这是容器生态的基本约定；
- 如果把 `v0.0.2` 重新指向一个不同的镜像，回滚时会拉到**错误的镜像**，
  且问题排查会变得极其困难；
- **本项目已发布版本的 tag 与资产一律不覆盖**：
  `v0.0.1` 与 `v0.0.2` 都保持原样。修正缺陷的路径是**发布下一个版本**
  （如 `v0.0.3`），而不是重推既有 tag；
- 需要精确回滚时，用 **digest** 而非 tag：

```bash
docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/alicia1030su/v2ex-clone:v0.0.2
# ghcr.io/alicia1030su/v2ex-clone@sha256:abcd1234...

# 把 .env 改成 digest 形式
sed -i 's|^V2EX_IMAGE=.*|V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone@sha256:abcd1234...|' .env
docker compose pull && docker compose up -d
```

> 生产环境建议**直接固定到 digest**：`V2EX_IMAGE=ghcr.io/...@sha256:...`。
> 这样无论 tag 怎么变，拉到的永远是同一个镜像。

### 11.3 数据回滚

应用版本回滚**不会**回滚数据库结构。如果新版本执行了不兼容的迁移：

```bash
# 1. 先停服
./stop.sh

# 2. 用迁移前的备份恢复
./restore.sh backups/v2ex-<升级前时间戳>.sql.gz

# 3. 回到旧镜像
sed -i 's|^V2EX_IMAGE=.*|V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.0|' .env

# 4. 启动
./start.sh
```

> ⚠️ 恢复会**覆盖**备份之后写入的所有数据。
> 这就是为什么升级前必须先备份 —— **没有备份就没有数据回滚能力**。

### 11.4 ⚠️ 回滚的前提

**回滚方案的有效性依赖于「升级前做了备份」这个前提。**
没有备份时，唯一能回滚的是**应用代码**，数据只能靠手工修。

---

## 12. 生产部署检查清单

上线前逐项确认：

### 12.1 配置

- [ ] `APP_RUNTIME_ENV=production`
- [ ] `SEED_DEMO_USERS=0`（不创建演示账号）
- [ ] `SESSION_SECRET` 已改为随机强密钥（≥32 字符）
- [ ] `SEED_ADMIN_PASSWORD` 已修改（≥12 位）
- [ ] `SEED_ADMIN_EMAIL` 已改为真实邮箱
- [ ] `SEED_ADMIN_USERNAME` 已改为不易猜的名字（可选）
- [ ] `APP_URL` / `NEXT_PUBLIC_APP_URL` 已改为 `https://你的域名`
- [ ] `APP_PORT` 若非默认，三处已同步

### 12.2 安全开关

- [ ] `DISABLE_CAPTCHA` 未设置或为 `0`
- [ ] `ENABLE_DEBUG_ENDPOINTS` 未设置或为 `0`（发行包已硬编码为 `'0'`）
- [ ] `TEST_ENV_ISOLATED` 未设置或为 `0`
- [ ] `DEBUG_ENDPOINT_TOKEN` 未设置（未设置时调试端点一律 404）
- [ ] 容器内实际生效值已用 `docker compose exec app env | grep -E 'DISABLE_CAPTCHA|ENABLE_DEBUG'` 复核

### 12.3 网络

- [ ] PostgreSQL 端口未暴露到公网（仅内部网络）
- [ ] Redis 已设置密码，且未暴露到公网
- [ ] 已启用 HTTPS
- [ ] `X-Forwarded-For` / `X-Real-IP` 正确透传
- [ ] 宿主机防火墙只放行 80/443 与 SSH

### 12.4 数据

- [ ] 已完成一次 `./backup.sh`
- [ ] 备份已**复制到另一台机器或对象存储**
- [ ] 已核对备份可以恢复（至少做过一次恢复演练）

### 12.5 账号

- [ ] 管理员初始密码已在登录后立即修改
- [ ] 不需要的演示账号已删除
- [ ] `INSTALL_CREDENTIALS.txt` 已妥善保管或删除

### 12.6 可观测性

- [ ] 日志采集已接入（`docker compose logs -f app`）
- [ ] 容器重启次数有监控
- [ ] 磁盘占用有告警阈值

---

## 13. 已知限制

| # | 限制 | 说明 | 应对 |
|---|---|---|---|
| 1 | **GHCR 匿名拉取需包为 public** | 若 `docker pull ghcr.io/alicia1030su/v2ex-clone:v0.0.2` 报 `denied` / `unauthorized`，说明该 GHCR 包**未开放匿名拉取** | 把该包设为 public；或改用「源码仓库 + 本地构建」方式（`docker compose up -d --build`），不需要访问 GHCR |
| 2 | **未经生产环境验证** | v0.0.2 仅在开发机与 CI 隔离容器中验证过。**未做**压力测试、**未做**长时间运行稳定性验证 | 先在预发环境跑一段时间，监控到位后再上生产 |
| 3 | **Redis 路径未做长期观测** | CI 用真实 Redis 验证了清空限流路径，但未观测长时间运行的内存增长与键空间膨胀 | 保持 Redis 运行，监控其内存占用 |
| 4 | **Docker Compose 未做长时间运行验证** | CI 验证了「构建 → 启动 → 健康检查 → 重启不污染数据」，但未验证长期运行的资源占用与日志膨胀 | 监控容器内存与日志大小 |
| 5 | **没有内置监控与指标导出** | 无 Prometheus `/metrics`、无告警集成 | 用宿主机监控 + 日志采集自行补齐 |
| 6 | **没有内置定时备份** | 备份脚本是手工触发的 | 用 cron / Windows 计划任务定时调用 `./backup.sh`，并对失败告警 |
| 7 | **没有自动化恢复演练** | 恢复流程是手工的 | 定期按 §9.2 演练 |
| 8 | **预览版迁移不保证向后兼容** | v0.0.x 之间的迁移可能破坏数据兼容性 | 升级前必备份；生产建议固定 digest，回滚前先确认迁移兼容性 |
| 9 | **未实现的功能较多** | 见 [`README.md`](../README.md) 的「未实现」表 | 按需在源码分支自行补齐 |
| 10 | **原站素材的 Git 历史清理未执行** | 当前 HEAD 的文件树中已无原站 HTML / CSS / JS 与参考截图，**但 Git 历史中仍可取回** | 历史改写不可逆，**尚未获授权执行**；方案与演练记录为仓库维护者内部记录，未公开 |
| 11 | **生产镜像不含测试工具链** | v0.0.2 起，生产镜像按 `npm ci --omit=dev` 安装依赖，**不包含** `vitest` / `@playwright/test` / `typescript` / `@types/*` | 这是**预期行为**。测试请在源码仓库或 CI 里跑，不要在生产容器里跑 |
| 12 | **镜像体积与非 root 运行本机未实测** | 开发环境**没有 Docker**，镜像体积数值与 `USER nextjs` 的实际运行效果无法在本地验证。**体积**已通过「裁剪后的依赖树 + 真实 `next start`」间接验证（见 §13.1），但**最终镜像字节数**与容器内 `USER` 仍需真实 Docker | 由 CI 的 `docker` job 与发布流水线的 `build-image` job 在真实 Docker 环境构建并启动时验证；发布门槛见 [`RELEASE_GATE_v0.0.2.md`](RELEASE_GATE_v0.0.2.md) D7 / D8 |
| 13 | **Windows 只有 `install.ps1`** | 发行包中 `backup.sh` / `restore.sh` / `update.sh` / `start.sh` / `stop.sh` **均无** `.ps1` 对应版本 | Windows 用户按 [`UPGRADE-v0.0.2.md`](UPGRADE-v0.0.2.md) §3.2 / §5.4 的手工步骤操作，或使用 WSL / Git Bash |
| 14 | **生产镜像含 `@esbuild` / `@esbuild-kit`（约 23 MB）** | `tsx` 与 `drizzle-kit` 的运行时依赖（entrypoint 阶段 2 用 tsx 跑 seed），**必须**保留 | **无风险**：esbuild 在此仅用于**本地 TS 转译**，**不启动任何监听端口**。GHSA-67mh-4wv8-2f99 的攻击前提是「esbuild dev server 正在监听 + 恶意网站跨域读取响应」—— 生产运行时**该前提不成立**。且 esbuild 版本已被 override 提升到 `0.25.12`（受影响范围 `<=0.24.2`） |

### 13.1 生产依赖闭包的自验方法

不需要 Docker 也能验证「生产镜像的依赖够用」：

```bash
# 1) 复现 Dockerfile 运行层装的依赖
mkdir /tmp/proddeps && cd /tmp/proddeps
cp <仓库>/package.json <仓库>/package-lock.json .
npm ci --omit=dev --no-audit --no-fund
rm -rf node_modules/playwright-core node_modules/playwright node_modules/@playwright

# 2) 校验 entrypoint 的三个必需路径
test -f node_modules/drizzle-kit/bin.cjs   # 阶段 1 迁移
test -f node_modules/tsx/dist/cli.mjs      # 阶段 2 首次初始化
test -f node_modules/next/dist/bin/next    # 阶段 3 启动

# 3) 校验生产面零漏洞
npm audit --omit=dev --audit-level=moderate   # → found 0 vulnerabilities
```

2026-11-04 实测结果（真实 `npm ci --omit=dev`，73 packages）：

| 项 | 结果 |
|---|---|
| 依赖体积 | 429 MB →（删 playwright 后）**411 MB** |
| `npm audit --omit=dev` | **found 0 vulnerabilities** |
| `core-utils` 解析到的 esbuild | **0.25.12**（漏洞版本 0.18.20 **已不在镜像内**） |
| 裁剪后 `next build` | ✓ Compiled successfully |
| 裁剪后 `next start` + 真实数据库 | `/`→200 `/signin`→200 `/signup`→200 `/nodes`→200 `/api/captcha`→200 `/t/1`→200，日志中 `MODULE_NOT_FOUND` 计数 **0** |
| 裁剪后 `drizzle-kit migrate` | ✓ migrations applied successfully（18 张表） |
| 裁剪后 `tsx` 跑 seed | ✓ seed 完成（9 分类 / 1 用户 / 23 节点 / 10 主题） |

> **注意**：`typescript` 在**构建期**是必需的（Next.js 用它解析 tsconfig 的 `paths` 别名，
> 缺了会导致 `@/...` 全部解析失败）。但它是**构建期**依赖 —— Dockerfile 的
> `builder` 层有完整依赖，`runner` 层用 `--omit=dev` 装，**不影响运行时**。
> 别在 builder 层也用 `--omit=dev`，否则构建会失败。

---

## 14. 常见问题

**Q: 启动报 `DATABASE_URL is not set`**
A: 未创建 `.env`（发行包）或 `.env.local`（源码仓库）。执行 `cp .env.example .env` 并确认变量已填写。
发行包直接跑 `./install.sh` 即可 —— 脚本会生成 `.env`。

**Q: 页面能打开但提示 500**
A: 检查数据库连接：`docker compose logs app | grep -i error`。
首次启动需等待 `drizzle-kit migrate` 完成。

**Q: 限流太严格，多个用户被一起拦**
A: 确认反向代理正确透传 `X-Forwarded-For`。登录/注册限流键为 `IP + 用户名`，
若 IP 识别错误会退化为按 IP 限流。

**Q: Redis 未安装会怎样**
A: 正常使用。`src/lib/kv.ts` 会自动降级到 PostgreSQL 的 `kv_store` / `rate_limit_buckets`，
限流与验证码功能不受影响，仅性能略有损失。发行包的 compose 默认**会**启动 Redis。

**Q: 如何重置某个用户的限流**
A: 直接删数据库表（仅在**未配置 Redis** 时有效）：

```sql
DELETE FROM rate_limit_buckets WHERE key LIKE 'ratelimit:%';
```

配了 Redis 时必须清 Redis 的键空间 —— 用调试端点（需 `ENABLE_DEBUG_ENDPOINTS=1`
与 `DEBUG_ENDPOINT_TOKEN`）。发行包硬编码关闭了调试端点，
所以生产实例上只能重启 Redis 容器（会清空限流计数，但不影响业务数据）：

```bash
docker compose restart redis
```

**Q: 改 `.env` 后需要重启吗**
A: 需要。`./stop.sh && ./start.sh`，或 `docker compose up -d --force-recreate`。
