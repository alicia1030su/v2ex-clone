# V2EX Clone v0.0.3 — 详细安装与运维文档

> **⚠️ 免责声明**
> 本项目与 V2EX 官方**无任何关联**，是独立技术研究项目，未获官方授权。
> "V2EX" 是 V2EX 及其权利人的商标，本项目不主张任何商标使用权。
> v0.0.3 为**早期开发预览版**，可能存在缺陷，不建议用于生产环境。

本文档比 `README.md` 更完整，覆盖前置条件、逐步安装、验证、配置说明、
端口、安全建议、升级、卸载与常见错误。

---

## 目录

1. [前置条件](#1-前置条件)
2. [逐步安装](#2-逐步安装)
3. [验证安装](#3-验证安装)
4. [配置项说明](#4-配置项说明)
5. [端口说明](#5-端口说明)
6. [安全建议](#6-安全建议)
7. [日常运维](#7-日常运维)
8. [升级流程](#8-升级流程)
9. [卸载流程](#9-卸载流程)
10. [常见错误与处理](#10-常见错误与处理)

---

## 1. 前置条件

### 1.1 Docker

| 平台 | 要求 | 安装方式 |
|------|------|----------|
| Linux | Docker Engine **20.10+** | `sudo apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin` |
| macOS | Docker Desktop **4.18+** | https://docs.docker.com/desktop/install/mac-install/ |
| Windows | Docker Desktop **4.18+** | https://docs.docker.com/desktop/install/windows-install/ |

验证：

```bash
docker --version     # >= 20.10
docker compose version   # v2.x.x
docker info          # 守护进程在运行
```

> **为什么必须是 Compose v2？**
> 本安装包使用 Compose spec 语法（`depends_on.condition`、`healthcheck`、
> `env_file` 列表等）。`docker-compose` v1 不支持这些写法，且子命令名也不同
> （`docker-compose` vs `docker compose`）。安装脚本会直接检测并报错。

### 1.2 资源

- **磁盘**：可用 ≥ 2 GB（镜像约 400MB，数据库与日志会持续增长）
- **内存**：≥ 2 GB
- **端口**：3000 空闲（或你打算使用的其它端口）

### 1.3 网络

需要能访问：

- `ghcr.io` —— 拉取应用镜像
- `docker.io` —— 拉取 `postgres:17-alpine` 与 `redis:7-alpine`

若处于受限网络，请先配置镜像加速器（Docker Desktop → Settings → Docker Engine
→ `registry-mirrors`），或预拉取镜像后改 `V2EX_IMAGE` 指向本地镜像。

---

## 2. 逐步安装

### 2.1 解压

```bash
unzip v2ex-clone-v0.0.3-deploy.zip -d v2ex-clone-deploy
cd v2ex-clone-deploy
```

### 2.2 运行安装脚本

**Linux / macOS**

```bash
chmod +x install.sh start.sh stop.sh update.sh backup.sh restore.sh
./install.sh
```

**Windows（PowerShell）**

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

> `ExecutionPolicy Bypass` 只对**这一次**调用生效，不修改系统策略。
> 如果你的机器策略更严格，可改用 `powershell -ExecutionPolicy RemoteSigned`。

### 2.3 安装脚本做了什么

| 阶段 | 动作 | 失败时 |
|------|------|--------|
| 0.1 | 检查 `docker` 命令 | 报错退出，附安装指引 |
| 0.2 | 检查 Docker 守护进程 | 报错退出 |
| 0.3 | 检查 Compose v2 | 报错退出，附安装指引 |
| 0.4 | 检查磁盘 ≥ 2GB | 报错退出 |
| 0.5 | 检查端口 3000 空闲 | 报错退出（**不自动杀进程**） |
| 1 | 生成 `.env`（已存在则**不覆盖**） | 报错退出 |
| 2 | `docker compose pull` | 报错退出，**已运行的容器不受影响** |
| 3 | `docker compose up -d` | 报错退出，**并打印最近 100 行日志** |
| 4 | 等待健康检查（≤120 秒） | 超时则打印日志并退出 |
| 5 | 输出访问地址与管理员凭据 | — |

### 2.4 安装过程中生成的文件

| 文件 | 权限 | 内容 | 是否可删 |
|------|------|------|----------|
| `.env` | 600（Linux/macOS） | 全部环境变量，含明文口令 | 不可（服务依赖） |
| `INSTALL_CREDENTIALS.txt` | 600（Linux/macOS） | 管理员初始密码 | 改完密码后可删 |

> **Windows 注意**：NTFS 没有 POSIX 的 `chmod 600`。脚本会提示你
> 确保 `.env` 所在目录仅管理员可访问。

### 2.5 幂等性

`install.sh` / `install.ps1` 可以**重复运行**：

- `.env` 已存在 → **不覆盖**，沿用原有口令（不会出现"重装把密码改了"的坑）
- `.env` 不存在 → 从 `.env.example` 复制并填入新随机口令
- 容器已存在 → `docker compose up -d` 是幂等操作，会复用现有容器

因此：**升级请用 `update.sh`，重装请先删掉 `.env` 再跑 `install.sh`**。

---

## 3. 验证安装

### 3.1 容器状态

```bash
docker compose ps
```

期望看到三个服务都是 `Up` / `healthy`：

```
NAME           IMAGE                                        STATUS
v2ex-app       ghcr.io/alicia1030su/v2ex-clone:v0.0.3        Up (healthy)
v2ex-postgres  postgres:17-alpine                           Up (healthy)
v2ex-redis     redis:7-alpine                               Up (healthy)
```

### 3.2 HTTP 访问

```bash
curl -I http://localhost:3000/
# HTTP/1.1 200 OK
```

或者浏览器打开 <http://localhost:3000>，应能看到首页。

### 3.3 数据库连通

```bash
docker compose exec postgres pg_isready -U v2ex -d v2ex
# /var/run/postgresql:5432 - accepting connections
```

### 3.4 Redis 连通

```bash
docker compose exec redis redis-cli -a "$(grep '^REDIS_PASSWORD=' .env | cut -d= -f2)" ping
# PONG
```

> 上面命令里的 `-a` 会让口令出现在 shell 历史中。生产环境建议用
> `redis-cli --askpass` 或通过 `REDISCLI_AUTH` 环境变量传入。

### 3.5 管理员可登录

1. 打开 <http://localhost:3000/signin>
2. 用 `admin` + `INSTALL_CREDENTIALS.txt` 里的密码登录
3. 登录成功 → 立刻去 **设置 → 密码** 改掉初始密码

---

## 4. 配置项说明

所有配置都在 `.env` 里，修改后执行 `./start.sh` 使其生效。

### 4.1 镜像与端口

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `V2EX_IMAGE` | `ghcr.io/alicia1030su/v2ex-clone:v0.0.3` | 应用镜像。改成本地镜像名可离线安装 |
| `COMPOSE_PROJECT_NAME` | `v2ex` | Compose 项目名。固定后数据卷名稳定，备份/恢复脚本能精确定位 |
| `APP_PORT` | `3000` | 宿主机映射端口。改端口**必须**同步改下面两项 |
| `APP_URL` | `http://localhost:3000` | 对外访问地址。会话 Cookie 的 `secure` 标记依赖正确的主机名 |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | 前端可见的公开地址。需与 `APP_URL` 保持一致 |

> ⚠️ **改端口的三处同步**：`APP_PORT`、`APP_URL`、`NEXT_PUBLIC_APP_URL`。
> 只改第一处会导致登录后被重定向回旧地址，表现为"登录成功又回到登录页"。

### 4.2 运行时

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `APP_RUNTIME_ENV` | `production` | `production` / `staging` / `test` / `development`。**保持 `production`**，否则验证码与调试端点的行为会改变 |

### 4.3 数据库

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `POSTGRES_USER` | `v2ex` | 数据库用户 |
| `POSTGRES_DB` | `v2ex` | 数据库名 |
| `POSTGRES_PASSWORD` | *（随机生成）* | 32 位随机十六进制串。**无默认值**，未设置时容器直接启动失败 |

### 4.4 Redis

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REDIS_PASSWORD` | *（随机生成）* | 32 位随机十六进制串。Redis 以 `--requirepass` 方式启用 |

### 4.5 应用

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SESSION_SECRET` | *（随机生成）* | 48 位随机串。会话签名密钥，**泄露等于会话可被伪造** |
| `SEED_ADMIN_USERNAME` | `admin` | 初始管理员用户名 |
| `SEED_ADMIN_EMAIL` | `admin@example.com` | 初始管理员邮箱 |
| `SEED_ADMIN_PASSWORD` | *（随机生成）* | 16 位混合口令。seed 阶段使用；已初始化的库不会被覆盖 |
| `SEED_DEMO_USERS` | `0` | `0` = 不创建演示账号（推荐）。生产环境会强制禁用 |

> **关于 `SEED_ADMIN_PASSWORD`**：它只在**首次**初始化时生效。
> 之后改这个变量**不会**改变已有管理员的密码 —— 这是刻意的设计，
> 避免重启时凭据被静默篡改。要改密码请在后台改，或用 `admin-cli.ts`。

### 4.6 限流

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RATE_LIMIT_LOGIN_MAX` | `10` | 同一 IP 每窗口最大登录尝试次数 |
| `RATE_LIMIT_POST_MAX` | `5` | 每窗口最大发帖数 |
| `RATE_LIMIT_REPLY_MAX` | `20` | 每窗口最大回复数 |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | 通用窗口（秒） |
| `RATE_LIMIT_REPLY_WINDOW_SECONDS` | `120` | 回复限流窗口（秒） |
| `RATE_LIMIT_CREATE_NODE_MAX` | `10` | 每窗口最大建节点数 |
| `RATE_LIMIT_CREATE_NODE_WINDOW_SECONDS` | `60` | 建节点限流窗口（秒） |
| `RATE_LIMIT_REGISTER_MAX` | `5` | 每窗口最大注册数 |
| `RATE_LIMIT_REGISTER_IP_MAX` | `20` | 每窗口每 IP 最大注册数 |
| `RATE_LIMIT_REGISTER_WINDOW_SECONDS` | `300` | 注册限流窗口（秒） |

> **注意**：Redis 不可用时限流会降级到 PostgreSQL 实现，
> 语义一致但性能较低。生产环境请保持 Redis 正常运行。

---

## 5. 端口说明

| 端口 | 暴露范围 | 说明 |
|------|----------|------|
| `APP_PORT`（默认 3000） | **宿主机** | 唯一对外暴露的端口。应用 HTTP 入口 |
| 5432（PostgreSQL） | **仅容器内网** | 刻意不映射到宿主机。宿主机进程无法直连 |
| 6379（Redis） | **仅容器内网** | 刻意不映射到宿主机。宿主机进程无法直连 |

所有服务都在内部 bridge 网络 `v2ex-net` 上互相通信。

**如果你需要直连数据库做调试**，不要改生产用的 `docker-compose.yml`，
而是临时用命令行覆盖：

```bash
docker compose run --rm --service-ports postgres
# 或者临时起一个一次性客户端容器走同一网络：
docker run --rm -it --network v2ex_v2ex-net \
  -e PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2)" \
  postgres:17-alpine psql -h postgres -U v2ex -d v2ex
```

> 仓库源码目录另有 `docker-compose.debug.yml`，那是给开发者用的，
> **不在发布包内**，也请不要在生产实例上启用它。

---

## 6. 安全建议

### 6.1 必做

- [ ] **登录后立即修改管理员密码**
- [ ] `.env`、`INSTALL_CREDENTIALS.txt`、`backups/` **不要**提交到版本库
- [ ] 对外提供服务前，在前置 Nginx / Caddy 上启用 **HTTPS**
- [ ] 定期 `./backup.sh`，并把备份**复制到另一台机器**（同盘备份不是备份）
- [ ] 确认 `APP_RUNTIME_ENV=production`、`ENABLE_DEBUG_ENDPOINTS=0`

### 6.2 加固

- [ ] 改用非默认端口（减少被扫描到的概率）
- [ ] 给 PostgreSQL / Redis 保持**不暴露端口**的默认配置
- [ ] 定期 `docker compose pull` 拿基础镜像安全更新
- [ ] 用最小权限用户运行 Docker（避免给日常账号 `docker` 组权限）
- [ ] 在宿主机上开启防火墙，只放行 80/443 与 SSH

### 6.3 关于口令强度

安装脚本生成的强度：

| 变量 | 生成方式 | 长度 | 字符集 |
|------|----------|------|--------|
| `POSTGRES_PASSWORD` | `openssl rand -hex 16` | 32 | 十六进制 |
| `REDIS_PASSWORD` | `openssl rand -hex 16` | 32 | 十六进制 |
| `SESSION_SECRET` | `openssl rand -hex 24` | 48 | 十六进制 |
| `SEED_ADMIN_PASSWORD` | 密码学随机 + Fisher-Yates 洗牌 | 16 | 大写 + 小写 + 数字（去掉 I/O/l/0/1 等易混淆字符） |

所有随机源都是 CSPRNG（`openssl rand` → `/dev/urandom` → `base64` 三级兜底）。

---

## 7. 日常运维

### 7.1 启动 / 停止

```bash
./start.sh    # up -d + 等健康
./stop.sh     # stop（**保留数据卷**）
```

> `stop.sh` 刻意使用 `docker compose stop` 而非 `down`。
> `down -v` 会删数据卷，用户数据不可恢复。

### 7.2 日志

```bash
docker compose logs -f app        # 应用日志
docker compose logs -f postgres   # 数据库日志
docker compose logs --tail=200 app
docker compose logs --since=1h app
```

### 7.3 备份

```bash
./backup.sh
```

产出（`backups/` 目录，权限 700）：

```
backups/
├── v2ex-20260101-120000.sql.gz      # 数据库逻辑备份
└── .env-20260101-120000              # 配置备份（权限 600）
```

### 7.4 恢复

```bash
# 先停服（避免写入竞争）
./stop.sh

# 恢复（会提示确认）
./restore.sh backups/v2ex-20260101-120000.sql.gz

# 再启动
./start.sh
```

恢复使用 `psql --single-transaction`，要么全成功要么全回滚。

### 7.5 磁盘管理

```bash
docker system df         # 查看占用
docker system prune -a   # 清理无用镜像与构建缓存（**不影响数据卷**）
```

---

## 8. 升级流程

```bash
./backup.sh     # 建议先备份
./update.sh
```

`update.sh` 的行为：

1. 记录当前镜像的 `RepoDigest` 与 `Image ID`
2. `docker compose pull` 拉取新镜像
3. `docker compose up -d` 重建容器（**不删数据卷**）
4. 打印升级前后的 digest 对比
5. 等待健康检查通过

容器启动时会自动执行数据库迁移（幂等，可重复运行）。

  **回滚**：把 `.env` 里的 `V2EX_IMAGE` 改回旧 tag，再跑 `./update.sh`。

  > ⚠️ **升级到新版本前，必须先修改 `.env` 里的 `V2EX_IMAGE`**（已知限制，v0.0.4 标注）
  >
  > `update.sh` 从 `.env` 读取 `V2EX_IMAGE`，随后执行 `docker compose pull`。
  > 它**不会自动把 tag 改成新版本** —— 如果 `.env` 仍是
  > `V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.3`，直接跑 `./update.sh`
  > 只会重新拉取 **v0.0.3** 镜像，看起来「升级成功」但版本根本没变。
  >
  > 正确做法：
  >
  > ```bash
  > ./backup.sh                       # 1. 先备份（务必）
  > # 2. 编辑 .env，把镜像 tag 改成目标版本，例如：
  > #    V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.4
  > ./update.sh                       # 3. 再升级
  > ```
  >
  > 升级后用 `docker image inspect` 的 digest 对比确认镜像确实变了
  > （`update.sh` 会打印升级前后的 digest 与 Image ID）。
  >
  > **状态**：`update.sh` 的自动 tag 同步逻辑尚未实装 —— 本机无 Docker，
  > 无法对改动后的升级脚本做真实容器验证，因此本轮**刻意不修改脚本行为**，
  > 只在此明确告知手工步骤。该缺口登记为 `RISK_REGISTER.md` R-18（OPEN），
  > 正式发布前必须在带 Docker 的环境补齐并实跑验证。

  > ⚠️ v0.0.3 / v0.0.4 均处于预览阶段，**迁移脚本不保证向后兼容**。
  > 预览版本之间的升级请务必先备份。

---

## 9. 卸载流程

### 9.1 仅移除容器（保留数据）

```bash
docker compose down
```

数据卷仍在，日后可 `docker compose up -d` 完整恢复。

### 9.2 彻底删除（**不可逆**）

```bash
# 建议先备份
./backup.sh

docker compose down -v
```

`down -v` 会删除 `postgres-data` 与 `redis-data` 两个数据卷，
**所有帖子、回复、账号、收藏永久丢失**。

### 9.3 清理安装包残留

```bash
rm -rf backups INSTALL_CREDENTIALS.txt .env
```

---

## 10. 常见错误与处理

| 错误信息 | 原因 | 处理 |
|----------|------|------|
| `未检测到 docker 命令` | Docker 未安装 | 按 §1.1 安装 Docker |
| `Docker 守护进程未运行` | Docker Desktop 未启动 / 无权限 | 启动 Docker；Linux 下把用户加入 `docker` 组后重新登录 |
| `未检测到 Docker Compose v2` | 只有旧版 `docker-compose` | 安装 `docker-compose-plugin` 或升级 Docker Desktop |
| `磁盘可用空间不足` | 空间 < 2GB | 清理磁盘，或清理 Docker 缓存：`docker system prune -a` |
| `端口 3000 已被占用` | 端口冲突 | 改 `APP_PORT` + 同步改 `APP_URL` / `NEXT_PUBLIC_APP_URL`（见 §4.1） |
| `.env 中的 XXX 为空` | 手工编辑 `.env` 时漏填 | 填上该值，或删掉 `.env` 重新跑 `install.sh` |
| `镜像拉取失败` | 网络无法访问 `ghcr.io` | 配置镜像加速器，或手动 `docker pull` 后改 `V2EX_IMAGE` |
| `container_name ... already in use` | 已有同名容器 | `docker compose down` 后重试；若来自别的项目，先 `docker rm -f v2ex-app` |
| `等待健康检查超时` | 迁移失败 / 端口不通 | `docker compose logs -f app` 看真实报错 |
| `Error [ERR_MODULE_NOT_FOUND]` | 镜像不完整 | `docker compose pull --force` 重新拉取 |
| `password authentication failed for user` | 改过 `.env` 里的 `POSTGRES_PASSWORD` 但卷已存在 | 见 §10.1 |
| 登录成功后又回到登录页 | `APP_URL` 与 `APP_PORT` 不一致 | 同步三个变量，见 §4.1 |

### 10.1 改了数据库口令后无法启动

PostgreSQL 的初始口令只对**空数据目录**生效。数据卷已存在时，
改 `.env` 不会改变数据库里的实际口令。

处理方式（选一）：

```bash
# 方案 A：把数据库里的口令改成新的
docker compose exec postgres psql -U v2ex -d postgres \
  -c "ALTER USER v2ex WITH PASSWORD '新口令';"

# 方案 B：删掉数据卷重新初始化（**数据全丢**）
docker compose down -v
./install.sh
```

### 10.2 管理员密码忘了

```bash
docker compose exec app node node_modules/tsx/dist/cli.mjs \
  scripts/admin-cli.ts reset-password --username admin
```

### 10.3 磁盘被数据库写满

```bash
docker compose exec postgres psql -U v2ex -d v2ex -c "\l+"
docker compose exec postgres du -sh /var/lib/postgresql/data
```

常见原因是日志表或限流桶表增长。确认数据量后再做清理，
**不要直接删系统表**。

---

## 附录：许可与声明

- **许可证**：MIT（见 `LICENSE`）
- **商标**："V2EX" 是 V2EX 及其权利人的商标。本项目**不是** V2EX 官方产品，
  与 V2EX 官方**无任何关联**，未获官方授权，不代表任何形式的官方背书。
  MIT 许可证仅覆盖源代码与文档，**不授予**任何商标、品牌标识或服务标记的使用许可。
- **第三方内容**：本项目**不包含** V2EX 官方站点的 HTML / CSS / JavaScript 副本、
  官方品牌图片或用户数据。仓库中的图标与 Logo 为独立绘制的等价实现。
- **第三方组件**：Next.js、React、PostgreSQL、Redis、Drizzle ORM、ioredis、
  bcryptjs、jose、marked、zod 等，各自遵循其原始许可证。
- **用途**：仅供技术学习与研究。使用者需自行确保使用方式符合
  所在地法律法规与平台服务条款。

*Not affiliated with, endorsed by, or associated with V2EX.*
