# INSTALL — 安装手册

> **⚠️ 独立非官方项目**
>
> 本项目与 V2EX 官方**无任何关联**，是独立技术研究项目，**未获官方授权**，
> **不是** V2EX 官方产品，**不代表**任何形式的官方背书。
> "V2EX" 是 V2EX 及其权利人的商标，MIT 许可证**不授予**任何商标使用许可。
>
> **v0.0.1 是开发预览版（Pre-release）**，功能尚未完备，**不建议用于生产环境**。
> 界面与原站存在差异，**不保证与 V2EX 完全一致**。

本文档是 **v0.0.1** 的完整安装与运维手册，面向真实用户。

---

## 1. 概述

### 1.1 三种安装方式对比

| 维度 | **A. 一键安装包**（推荐） | **B. 手动 Docker Compose** | **C. 本地开发** |
|---|---|---|---|
| 适用对象 | 想快速跑起来看看 | 想自己掌控 compose 配置 | 想改代码 / 参与开发 |
| 前置条件 | Docker 20.10+、Compose v2 | 同左 | **Node.js ≥ 22.23.4**、PostgreSQL 17（Redis 可选） |
| 拉取镜像 | 拉预构建镜像 `ghcr.io/...:v0.0.1` | 同左 | 不需要 |
| 本地构建 | 不需要 | 不需要（仓库根的 compose 会本地构建） | `npm run build` |
| 安装命令 | `./install.sh` / `install.ps1` | `docker compose up -d` | `npm run dev` |
| 配置文件 | 脚本自动生成 `.env`（含随机口令） | 手工 `cp .env.example .env` 并填写 | 手工 `cp .env.example .env.local` |
| 数据持久化 | Docker 数据卷 | Docker 数据卷 | 本地 PostgreSQL 实例 |
| 难度 | ★☆☆ | ★★☆ | ★★★ |
| 卸载 | `docker compose down -v` | 同左 | 删目录 + 删数据库 |

> **选哪个？**
> - 只想**体验一下** → 选 **A**
> - 想**长期运行**并自己改配置（域名、HTTPS、监控）→ 选 **A**，然后配合 [`DEPLOYMENT.md`](DEPLOYMENT.md) 加反向代理
> - 想**读代码 / 改代码 / 提 PR** → 选 **C**，参见仓库根的 [`README.md`](../README.md)

### 1.2 安装包内容

解压 `v2ex-clone-v0.0.1-deploy.zip` 后得到：

```
v2ex-clone-v0.0.1-deploy/
├── docker-compose.yml     # 发行版编排（拉预构建镜像，非本地构建）
├── .env.example           # 环境变量模板（无任何可用默认口令）
├── install.sh             # 一键安装（Linux / macOS）
├── install.ps1            # 一键安装（Windows）
├── start.sh               # 启动服务
├── stop.sh                # 停止服务（保留数据卷）
├── update.sh              # 升级
├── backup.sh              # 备份数据库与配置
├── restore.sh             # 恢复备份
├── README.md              # 安装包内快速说明
├── INSTALL.md             # 安装包内详细说明
├── VERSION                # 0.0.1
├── LICENSE                # MIT + 商标声明 + 第三方内容声明
└── .dockerignore
```

> 安装脚本运行后会**额外生成**两个文件（不在压缩包里）：
> `.env`（全部配置，含明文口令，权限 600）与
> `INSTALL_CREDENTIALS.txt`（管理员初始密码，权限 600）。

---

## 2. 系统要求

| 项 | 要求 | 验证命令 | 说明 |
|---|---|---|---|
| 操作系统 | Linux / macOS / Windows | — | Windows 走 PowerShell 脚本 |
| Docker Engine | **20.10+** | `docker --version` | 必需 |
| Docker Compose | **v2**（`docker compose` 子命令） | `docker compose version` | **必需**；不支持旧的 `docker-compose` v1 |
| Docker 守护进程 | 运行中且当前用户有权访问 | `docker info` | Linux 下需把用户加入 `docker` 组 |
| 可用磁盘 | **≥ 2 GB** | `df -h .` | 镜像约 400 MB，数据库与日志会持续增长 |
| 可用内存 | **≥ 2 GB** | — | PostgreSQL + Redis + 应用三容器同时运行 |
| 端口 | **3000** 空闲（或你指定的其它端口） | — | 唯一对外暴露的端口 |
| 网络 | 能访问 `ghcr.io` 与 `docker.io` | — | 拉取镜像用 |

**为什么必须是 Compose v2？**
本项目的 compose 文件使用了 Compose spec 语法（`depends_on.condition`、`healthcheck`、`env_file` 列表），
`docker-compose` v1 不支持，且子命令名也不同（`docker-compose` vs `docker compose`）。
安装脚本会**直接检测并报错退出**，不会静默降级。

---

## 3. 一键安装（推荐）

### 3.1 Linux / macOS

**第 1 步：下载并解压**

```bash
unzip v2ex-clone-v0.0.1-deploy.zip -d v2ex-clone-deploy
cd v2ex-clone-deploy
```

**第 2 步：赋予脚本执行权限**

```bash
chmod +x install.sh start.sh stop.sh update.sh backup.sh restore.sh
```

**第 3 步：运行安装脚本**

```bash
./install.sh
```

> 如果你的系统禁止直接执行，也可显式用 `bash install.sh`。

**预期输出**（`[信息]` / `[成功]` / `[警告]` / `[错误]` 是脚本自己的输出前缀）：

```
[信息] Docker Compose 版本：2.29.1
[成功] 磁盘可用空间：15230MB
[成功] 端口 3000 可用
[成功] 已生成 .env（权限 600）与随机口令
[信息] 管理员凭据已写入：/path/to/v2ex-clone-deploy/INSTALL_CREDENTIALS.txt（权限 600）
[信息] 拉取镜像（首次需要下载，请耐心等待）...
[成功] 镜像拉取完成
[信息] 启动容器...
[成功] 容器已启动
[信息] 等待服务就绪（最长 120 秒）...
[信息] 健康检查地址：http://localhost:3000
[成功] 容器健康检查通过

安装完成
  访问地址   : http://localhost:3000
  管理员账号 : admin
  管理员邮箱 : admin@example.com
  管理员密码 : K7mQx2wR9tLpZ4nV

请立即登录并修改管理员密码。
凭据也已保存到：/path/to/v2ex-clone-deploy/INSTALL_CREDENTIALS.txt（权限 600，妥善保管）

常用命令（在本目录执行）：
  ./start.sh          启动服务
  ./stop.sh           停止服务（保留数据卷）
  ./update.sh         升级到新版本
  ./backup.sh         备份数据库与配置
  docker compose logs -f app   查看应用日志
```

> **说明**
> - `Docker Compose 版本` 与 `磁盘可用空间` 的具体数值取决于你的机器。
> - `管理员密码` 是脚本生成的 **16 位**随机口令（含大写、小写、数字，去掉了 `I`/`O`/`l`/`0`/`1` 等易混淆字符）。
>   它**只**写入 `.env` 与 `INSTALL_CREDENTIALS.txt`，不会进入镜像，也不会打印到 CI 日志。
> - 若 `.env` **已存在**（重复安装），脚本**不会覆盖**，此时输出变为：
>   ```
>   [成功] .env 已存在，**未覆盖**（幂等）
>   [信息] 沿用 .env 中的现有配置与口令
>   ```
>   并且**不显示**管理员密码那一行（改为提示沿用已有 `.env` 中的密码）。

**第 4 步：访问**

浏览器打开 **http://localhost:3000**。

### 3.2 Windows（PowerShell）

**第 1 步：下载并解压**

用 PowerShell：

```powershell
Expand-Archive -Path .\v2ex-clone-v0.0.1-deploy.zip -DestinationPath .\v2ex-clone-deploy
Set-Location .\v2ex-clone-deploy
```

**第 2 步：运行安装脚本**

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

> `ExecutionPolicy Bypass` **只对这一次调用生效**，不修改系统策略。
> 若你的机器策略更严格，可改用 `powershell -ExecutionPolicy RemoteSigned`。

**预期输出**（Windows 版前缀相同，文案略有差异）：

```
[信息] Docker Compose 版本：2.29.1
[成功] 磁盘可用空间：15230MB
[成功] 端口 3000 可用
[成功] 已生成 .env 与随机口令
[信息] 管理员凭据已写入：C:\path\to\v2ex-clone-deploy\INSTALL_CREDENTIALS.txt
[警告] Windows 上的 .env 无法用 chmod 限制权限，请确保该目录只有管理员可访问。
[信息] 拉取镜像（首次需要下载，请耐心等待）...
[成功] 镜像拉取完成
[信息] 启动容器...
[成功] 容器已启动
[信息] 等待服务就绪（最长 120 秒）...
[信息] 健康检查地址：http://localhost:3000
[成功] 健康检查通过

安装完成
  访问地址   : http://localhost:3000
  管理员账号 : admin
  管理员邮箱 : admin@example.com
  管理员密码 : K7mQx2wR9tLpZ4nV

请立即登录并修改管理员密码。
凭据也已保存到：C:\path\to\v2ex-clone-deploy\INSTALL_CREDENTIALS.txt（请妥善保管）

常用命令（在本目录执行）：
  docker compose up -d       启动服务
  docker compose stop        停止服务（保留数据卷）
  docker compose pull && docker compose up -d   升级到新版本
  docker compose logs -f app 查看应用日志
```

### 3.3 安装脚本做了什么

| 阶段 | 动作 | 失败时 |
|---|---|---|
| 0.1 | 检查 `docker` 命令 | 报错退出，附各平台安装指引 |
| 0.2 | 检查 Docker 守护进程 | 报错退出（提示启动 Docker Desktop / 加入 `docker` 组） |
| 0.3 | 检查 Compose v2 | 报错退出，附安装指引 |
| 0.4 | 检查磁盘 ≥ 2 GB | 报错退出 |
| 0.5 | 检查端口（`APP_PORT`，默认 3000）是否空闲 | 报错退出（**不自动杀进程**） |
| 1 | 生成 `.env`（已存在则**不覆盖**） | 报错退出 |
| 2 | `docker compose pull` | 报错退出，**已运行的容器不受影响** |
| 3 | `docker compose up -d` | 报错退出，**并打印最近 100 行日志** |
| 4 | 等待健康检查（≤ 120 秒） | 超时则打印日志并退出 |
| 5 | 输出访问地址与管理员凭据 | — |

### 3.4 安装过程中生成的文件

| 文件 | 权限 | 内容 | 可否删除 |
|---|---|---|---|
| `.env` | 600（Linux/macOS） | 全部环境变量，**含明文口令** | **不可**（服务依赖它） |
| `INSTALL_CREDENTIALS.txt` | 600（Linux/macOS） | 管理员初始密码 | 改完密码后可删 |
| `backups/` | 700 | 备份产物（运行 `./backup.sh` 后才出现） | 可（确认备份已另存后） |

> **Windows 注意**：NTFS 没有 POSIX 的 `chmod 600`。
> 脚本会提示你确保 `.env` 所在目录仅管理员可访问。

### 3.5 幂等性

`install.sh` / `install.ps1` 可以**重复运行**：

- `.env` 已存在 → **不覆盖**，沿用原有口令（不会出现「重装把密码改了」的坑）
- `.env` 不存在 → 从 `.env.example` 复制并填入新的随机口令
- 容器已存在 → `docker compose up -d` 是幂等操作，会复用现有容器

> 因此：**升级用 `./update.sh`；重装请先删掉 `.env` 再跑 `./install.sh`。**

---

## 4. 手动 Docker Compose 安装

不使用安装包，或想自定义配置时使用。

### 4.1 拉取 compose 配置与镜像

```bash
# 方式一：从 Release 下载安装包，只取其中的 docker-compose.yml 与 .env.example
# 方式二：从源码仓库
git clone https://github.com/alicia1030su/v2ex-clone.git
cd v2ex-clone
```

### 4.2 生成 `.env`

```bash
cp .env.example .env
```

然后**必须**填写以下 4 个变量（其余保留默认值）：

```bash
# 生成三个随机口令
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
echo "REDIS_PASSWORD=$(openssl rand -hex 16)"
echo "SESSION_SECRET=$(openssl rand -hex 24)"

# 管理员口令：至少 12 位，含大小写与数字
echo "SEED_ADMIN_PASSWORD=<你的强口令>"
```

把上面的值填进 `.env`，并按需调整：

```bash
APP_PORT=3000
APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_RUNTIME_ENV=production
V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.1
SEED_DEMO_USERS=0
```

> **改端口必须同步改三处**：`APP_PORT`、`APP_URL`、`NEXT_PUBLIC_APP_URL`。
> 只改第一处会导致登录后被重定向回旧地址，表现为「登录成功又回到登录页」。

### 4.3 启动

```bash
docker compose pull        # 拉取镜像
docker compose up -d       # 启动
docker compose ps          # 查看状态
```

### 4.4 发行版 compose 配置（完整）

发行包的 `docker-compose.yml` 与仓库根目录的**关键差异**：
app 服务使用**预构建镜像**而非本地 `build:`，并且**多了 healthcheck**。

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: v2ex-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:?POSTGRES_USER must be set}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
      POSTGRES_DB: ${POSTGRES_DB:?POSTGRES_DB must be set}
      PGDATA: /var/lib/postgresql/data/pgdata
    networks: [v2ex-net]
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER:?} -d ${POSTGRES_DB:?}']
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s

  redis:
    image: redis:7-alpine
    container_name: v2ex-redis
    restart: unless-stopped
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
      --appendonly yes
    networks: [v2ex-net]
    volumes:
      - redis-data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', '-a', '${REDIS_PASSWORD:?}', 'ping']
      interval: 10s
      timeout: 5s
      retries: 10

  app:
    image: ${V2EX_IMAGE:-ghcr.io/alicia1030su/v2ex-clone:v0.0.1}
    container_name: v2ex-app
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file:
      - .env
    environment:
      NODE_ENV: production
      APP_RUNTIME_ENV: ${APP_RUNTIME_ENV:-production}
      DATABASE_URL: postgres://${POSTGRES_USER:?}:${POSTGRES_PASSWORD:?}@postgres:5432/${POSTGRES_DB:?}
      REDIS_URL: redis://:${REDIS_PASSWORD:?}@redis:6379
      SESSION_SECRET: ${SESSION_SECRET:?SESSION_SECRET must be set}
      APP_URL: ${APP_URL:-http://localhost:3000}
      NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
      SEED_ADMIN_USERNAME: ${SEED_ADMIN_USERNAME:-admin}
      SEED_ADMIN_EMAIL: ${SEED_ADMIN_EMAIL:-admin@example.com}
      SEED_ADMIN_PASSWORD: ${SEED_ADMIN_PASSWORD:?SEED_ADMIN_PASSWORD must be set}
      SEED_DEMO_USERS: ${SEED_DEMO_USERS:-0}
      ENABLE_DEBUG_ENDPOINTS: '0'
      DEBUG_ENDPOINT_TOKEN: ''
      DISABLE_CAPTCHA: '0'
      TEST_ENV_ISOLATED: '0'
    ports:
      - '${APP_PORT:-3000}:3000'
    networks: [v2ex-net]
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "const http=require('http');const r=http.get({host:'127.0.0.1',port:3000,path:'/',timeout:8000},res=>{res.resume();process.exit(res.statusCode&&res.statusCode<500?0:1)});r.on('error',()=>process.exit(1));r.on('timeout',()=>{r.destroy();process.exit(1)});"
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 90s

volumes:
  postgres-data:
  redis-data:

networks:
  v2ex-net:
    driver: bridge
```

> **注意**：PostgreSQL（5432）与 Redis（6379）**没有 `ports` 字段** ——
> 它们只在内部 bridge 网络 `v2ex-net` 上可达，**宿主机上的任何进程都无法直连**。
> 这是刻意的安全设计。

---

## 5. 安装后验证

### 5.1 容器状态

```bash
docker compose ps
```

预期三个服务都是 `Up (healthy)`：

```
NAME           IMAGE                                        STATUS
v2ex-app       ghcr.io/alicia1030su/v2ex-clone:v0.0.1        Up (healthy)
v2ex-postgres  postgres:17-alpine                           Up (healthy)
v2ex-redis     redis:7-alpine                               Up (healthy)
```

> app 的 healthcheck 用镜像自带的 `node` 探测 `/`（statusCode < 500 视为健康），
> 因此 `Up (healthy)` 同时意味着「Next.js 已就绪」且「数据库可查询」。

### 5.2 首页可访问

```bash
curl -I http://localhost:3000/
# HTTP/1.1 200 OK
```

浏览器打开 <http://localhost:3000>，应能看到首页（顶栏 + 节点 tab + 主题列表 + 右侧栏）。

### 5.3 数据库连通

```bash
docker compose exec postgres pg_isready -U v2ex -d v2ex
# /var/run/postgresql:5432 - accepting connections
```

### 5.4 Redis 连通

```bash
docker compose exec redis sh -c 'redis-cli -a "$REDIS_PASSWORD" ping'
# PONG
```

> 用 `sh -c` 让口令在容器内展开，**不进入宿主机 shell 历史**。
> 这是比 `redis-cli -a "$(grep ...)"` 更安全的写法。

### 5.5 注册一个普通账号

1. 打开 <http://localhost:3000/signup>
2. 填用户名（如 `tester001`）、邮箱、密码（≥8 位）
3. 填写页面上的**验证码**（服务端生成的 SVG 验证码，一次性）
4. 提交 → 自动登录并跳转到首页，右上角显示你的用户名

### 5.6 发一个主题

1. 点击顶栏任一节点 tab（如「程序员」）
2. 点「发布主题」→ 选择节点 → 填标题（4–128 字符）与正文（≥10 字符，Markdown）
3. 提交 → 跳转到主题详情页，**楼层号从 1 开始**
4. 在主题下回复一条 → 楼层号变为 2，首页与节点页的主题数 +1

### 5.7 登录管理后台

1. 打开 <http://localhost:3000/signin>
2. 用 `admin` + `INSTALL_CREDENTIALS.txt` 里的密码登录
3. 访问 <http://localhost:3000/admin> → 应能看到概览、待审列表与操作日志
4. **立刻**去「设置 → 密码」改掉初始密码

---

## 6. 配置项说明

所有配置都在 `.env` 里。修改后执行 `./start.sh`（或 `docker compose up -d`）生效。

### 6.1 镜像与端口

| 变量 | 默认值 | 必填 | 说明 | 安全建议 |
|---|---|---|---|---|
| `V2EX_IMAGE` | `ghcr.io/alicia1030su/v2ex-clone:v0.0.1` | 否 | 应用镜像。改成本地镜像名可离线安装 | 生产建议**固定到 digest**（`image@sha256:...`）而非 tag |
| `COMPOSE_PROJECT_NAME` | `v2ex` | 否 | Compose 项目名。固定后数据卷名稳定，备份/恢复脚本能精确定位 | 不要随意改，改了会找不到旧数据卷 |
| `APP_PORT` | `3000` | 否 | 宿主机映射端口。**改端口必须同步改下面两项** | 非默认端口可减少被扫描到的概率 |
| `APP_URL` | `http://localhost:3000` | 否 | 对外访问地址。会话 Cookie 的 `secure` 标记依赖正确的主机名 | 生产必须改成 `https://你的域名` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | 否 | 前端可见的公开地址 | **必须**与 `APP_URL` 一致 |

### 6.2 运行时

| 变量 | 默认值 | 必填 | 说明 | 安全建议 |
|---|---|---|---|---|
| `APP_RUNTIME_ENV` | `production` | 否 | `production` / `staging` / `test` / `development` | **保持 `production`**。其它环境下验证码与调试端点的行为会改变 |

### 6.3 数据库

| 变量 | 默认值 | 必填 | 说明 | 安全建议 |
|---|---|---|---|---|
| `POSTGRES_USER` | `v2ex` | 否 | 数据库用户 | — |
| `POSTGRES_DB` | `v2ex` | 否 | 数据库名 | — |
| `POSTGRES_PASSWORD` | *（随机生成）* | **是** | 32 位随机十六进制串。**无默认值**，未设置时容器直接启动失败 | 定期轮换；轮换后见 §11.9 |

### 6.4 Redis

| 变量 | 默认值 | 必填 | 说明 | 安全建议 |
|---|---|---|---|---|
| `REDIS_PASSWORD` | *（随机生成）* | **是** | 32 位随机十六进制串。Redis 以 `--requirepass` 启用 | 同上 |

### 6.5 应用与账号

| 变量 | 默认值 | 必填 | 说明 | 安全建议 |
|---|---|---|---|---|
| `SESSION_SECRET` | *（随机生成）* | **是** | 48 位随机串。会话签名密钥 | **泄露等于会话可被伪造**。生产务必用 secrets manager 注入 |
| `SEED_ADMIN_USERNAME` | `admin` | 否 | 初始管理员用户名 | 建议改成不易猜的名字 |
| `SEED_ADMIN_EMAIL` | `admin@example.com` | 否 | 初始管理员邮箱 | 改成真实可联系的邮箱 |
| `SEED_ADMIN_PASSWORD` | *（随机生成）* | **是** | 16 位混合口令。**只在首次初始化时生效** | 生产必须 ≥12 位。改它**不会**改变已有管理员的密码 |
| `SEED_DEMO_USERS` | `0` | 否 | `0` = 不创建演示账号 | **保持 `0`**。生产环境会自动禁用 |

> **关于 `SEED_ADMIN_PASSWORD`**：它只在**首次**初始化时生效。
> 之后改这个变量**不会**改变已有管理员的密码 —— 这是刻意的设计，
> 避免重启时凭据被静默篡改。要改密码请在后台改，或用 `admin-cli.ts`（见 §11.8）。

### 6.6 限流

| 变量 | 默认值 | 必填 | 说明 |
|---|---|---|---|
| `RATE_LIMIT_LOGIN_MAX` | `10` | 否 | 同一 IP 每窗口最大登录尝试次数 |
| `RATE_LIMIT_POST_MAX` | `5` | 否 | 每窗口最大发帖数 |
| `RATE_LIMIT_REPLY_MAX` | `20` | 否 | 每窗口最大回复数 |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | 否 | 通用窗口（秒） |
| `RATE_LIMIT_REPLY_WINDOW_SECONDS` | `120` | 否 | 回复限流窗口（秒） |
| `RATE_LIMIT_CREATE_NODE_MAX` | `10` | 否 | 每窗口最大建节点数 |
| `RATE_LIMIT_CREATE_NODE_WINDOW_SECONDS` | `60` | 否 | 建节点限流窗口（秒） |
| `RATE_LIMIT_REGISTER_MAX` | `5` | 否 | 每窗口最大注册数（按用户名） |
| `RATE_LIMIT_REGISTER_IP_MAX` | `20` | 否 | 每窗口每 IP 最大注册数 |
| `RATE_LIMIT_REGISTER_WINDOW_SECONDS` | `300` | 否 | 注册限流窗口（秒） |

> Redis 不可用时限流会降级到 PostgreSQL 实现，语义一致但性能较低。
> 生产环境请保持 Redis 正常运行。

---

## 7. 常用运维命令

> 以下命令均在**安装包目录**下执行。

| 操作 | 命令 | 说明 |
|---|---|---|
| 启动 | `./start.sh` | `docker compose up -d` + 等待健康检查（≤120 秒） |
| 停止 | `./stop.sh` | `docker compose stop`，**保留数据卷** |
| 升级 | `./update.sh` | 记录旧 digest → pull → `up -d` → 对比 digest |
| 备份 | `./backup.sh` | 数据库 `pg_dump` + `.env`，输出到 `backups/` |
| 恢复 | `./restore.sh [文件]` | 不带参数则恢复最新备份；**会交互确认 y/N** |
| 查看状态 | `docker compose ps` | 三个服务应为 `Up (healthy)` |
| 应用日志 | `docker compose logs -f app` | 实时日志 |
| 数据库日志 | `docker compose logs -f postgres` | 实时日志 |
| 最近日志 | `docker compose logs --tail=200 app` | 拉取最后 200 行 |
| 按时间过滤 | `docker compose logs --since=1h app` | 最近 1 小时 |
| 进入容器 | `docker compose exec app sh` | 进入应用容器 |
| 磁盘占用 | `docker system df` | 查看 Docker 整体占用 |
| 清理缓存 | `docker system prune -a` | 清理无用镜像与构建缓存（**不影响数据卷**） |

### 7.1 端口说明

| 端口 | 暴露范围 | 说明 |
|---|---|---|
| `APP_PORT`（默认 3000） | **宿主机** | 唯一对外暴露的端口。应用 HTTP 入口 |
| 5432（PostgreSQL） | **仅容器内网** | 刻意不映射到宿主机 |
| 6379（Redis） | **仅容器内网** | 刻意不映射到宿主机 |

> **需要直连数据库调试时**，不要改生产用的 `docker-compose.yml`，用一次性容器：

> ```bash
> docker run --rm -it --network v2ex_v2ex-net \
>   -e PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2)" \
>   postgres:17-alpine psql -h postgres -U v2ex -d v2ex
> ```

> 仓库源码目录另有 `docker-compose.debug.yml`，那是给开发者用的，**不在发布包内**，
> **请不要在生产实例上启用它**。

---

## 8. 升级流程

```bash
./backup.sh     # 建议先备份
./update.sh
```

`update.sh` 的行为：

1. 记录当前镜像的 `RepoDigest` 与 `Image ID`
2. `docker compose pull` 拉取新镜像
3. `docker compose up -d` 重建容器 —— **绝不执行 `down -v`，数据卷原样保留**
4. 打印升级前后的 digest 对比
5. 等待健康检查通过（≤180 秒）

预期输出：

```
升级 V2EX Clone
[信息] 目标镜像：ghcr.io/alicia1030su/v2ex-clone:v0.0.1
[信息] 升级前 digest：ghcr.io/alicia1030su/v2ex-clone@sha256:...
[信息] 拉取新镜像...
[信息] 升级后 digest：ghcr.io/alicia1030su/v2ex-clone@sha256:...
[信息] 重建容器（**不删除数据卷**）...
[信息] 等待服务就绪（最长 180 秒）...

镜像对比
  升级前 digest : ghcr.io/alicia1030su/v2ex-clone@sha256:...
  升级前 imageId: sha256:...
  升级后 digest : ghcr.io/alicia1030su/v2ex-clone@sha256:...
  升级后 imageId: sha256:...
  结果          : 镜像已更新

[成功] 升级完成，服务已就绪
  访问地址: http://localhost:3000
```

### 8.1 ⚠️ 不要删数据卷

升级过程中**绝不能**执行：

```bash
docker compose down -v      # ❌ 会删除 postgres-data 与 redis-data 数据卷
```

正确做法就是 `./update.sh`（内部只用 `up -d`），或手动：

```bash
docker compose pull
docker compose up -d        # ✅ 就地重建容器，数据卷保留
```

### 8.2 回滚

把 `.env` 里的 `V2EX_IMAGE` 改回旧 tag，再跑 `./update.sh`：

```bash
sed -i 's|^V2EX_IMAGE=.*|V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.0|' .env
./update.sh
```

> ⚠️ **注意**：
> - **容器 tag 不可移动**。同一个 tag 一旦发布就不应重新指向另一个镜像，
>   否则回滚会拉到错误的镜像。回滚请用**更早的 tag**，或用 digest 精确锁定。
> - v0.0.1 处于预览阶段，**迁移脚本不保证向后兼容**。
>   预览版本之间的升级请务必先备份。

---

## 9. 数据备份与恢复

### 9.1 备份

```bash
./backup.sh
```

产出（`backups/` 目录，权限 700）：

```
backups/
├── v2ex-20261103-120000.sql.gz      # 数据库逻辑备份（gzip -9）
└── .env-20261103-120000              # 配置备份（权限 600，含凭据）
```

预期输出：

```
[信息] 备份 PostgreSQL 数据库（v2ex@v2ex）...
[成功] 数据库备份完成：./backups/v2ex-20261103-120000.sql.gz
[信息] 备份 .env 配置...
[成功] 配置备份完成：./backups/.env-20261103-120000（权限 600）

备份完成
  数据库备份 : ./backups/v2ex-20261103-120000.sql.gz (1.2MB)
  配置备份   : ./backups/.env-20261103-120000 (612B)

[信息] 恢复方法：./restore.sh ./backups/v2ex-20261103-120000.sql.gz
[信息] 提醒：备份目录含明文凭据，请勿提交到版本库或上传到公开位置。
```

### 9.2 恢复

```bash
# 1. 先停服（避免写入竞争）
./stop.sh

# 2. 恢复（会交互确认 y/N）
./restore.sh backups/v2ex-20261103-120000.sql.gz
#    不带参数则自动选最新的备份

# 3. 再启动
./start.sh
```

预期输出：

```
[信息] 恢复到数据库...
[成功] 恢复完成

[信息] 重启应用以加载恢复后的数据：./start.sh
```

恢复使用 `psql --single-transaction` —— **要么全成功，要么全回滚**，
不会留下「恢复到一半」的数据库。

### 9.3 手动备份（不依赖脚本）

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

### 9.4 备份策略建议

| 项 | 建议 |
|---|---|
| 频率 | 每天一次自动备份 + 升级/迁移前手动备份 |
| 保留 | 至少保留 7 个日备份 + 4 个周备份 |
| **异地** | **必须**把备份复制到另一台机器或对象存储。同盘备份不是备份 |
| **演练** | 定期做**恢复演练**（在一个临时库里跑一遍 `restore.sh`），确认备份真的可用 |
| 加密 | 备份含用户数据与凭据，异地存放前应加密 |
| 凭据 | `backups/` 目录含明文凭据，**不要**提交到版本库或上传到公开位置 |

> **本项目的已知限制**：v0.0.1 **没有**内置的定时备份任务，也没有自动化的恢复演练。
> 这需要你自己用 cron / Windows 计划任务来补。

---

## 10. 卸载流程

### 10.1 仅移除容器（保留数据）

```bash
docker compose down
```

数据卷仍在，日后可 `docker compose up -d` 完整恢复。

> 也可以用 `./stop.sh` —— 它用的是 `docker compose stop`，连容器都保留，更保守。

### 10.2 彻底删除（**不可逆**）

```bash
# 建议先备份
./backup.sh

docker compose down -v
```

> ⚠️ **警告**
> `down -v` 会删除 `postgres-data` 与 `redis-data` 两个数据卷，
> **所有帖子、回复、账号、收藏永久丢失，且无法通过任何脚本找回**。
> 这是**唯一**会删数据的命令，请务必确认已备份后再执行。

### 10.3 清理安装包残留

```bash
rm -rf backups INSTALL_CREDENTIALS.txt .env
```

---

## 11. 故障排查

### 11.1 端口 3000 已被占用

**症状**

```
[错误] 端口 3000 已被占用。
请先停止占用该端口的程序，或修改 .env 中的 APP_PORT（同时同步修改
APP_URL 与 NEXT_PUBLIC_APP_URL），然后重新运行本脚本。
```

**原因**：宿主机上已有进程监听 3000（常见于另一个 Node 服务或旧的容器）。

**解决**

```bash
# 查是谁占着
lsof -nP -iTCP:3000 -sTCP:LISTEN      # macOS / Linux
netstat -ano | findstr :3000            # Windows

# 或直接改端口（注意三处同步）
sed -i 's|^APP_PORT=.*|APP_PORT=8080|' .env
sed -i 's|^APP_URL=.*|APP_URL=http://localhost:8080|' .env
sed -i 's|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=http://localhost:8080|' .env
./install.sh
```

### 11.2 镜像拉取失败

**症状**

```
[警告] docker compose pull 失败。
[错误] 镜像拉取失败，安装中止。
```

**原因**：网络无法访问 `ghcr.io` 或 `docker.io`（常见于国内网络、代理未配置到 Docker）。

**解决**

```bash
# 方案 A：配置镜像加速器
# Docker Desktop → Settings → Docker Engine → registry-mirrors
# Linux：/etc/docker/daemon.json

# 方案 B：手动拉取，看真实报错
docker pull ghcr.io/alicia1030su/v2ex-clone:v0.0.1
docker pull postgres:17-alpine
docker pull redis:7-alpine

# 方案 C：用代理（Linux）
sudo systemctl edit docker
# [Service]
# Environment="HTTP_PROXY=http://127.0.0.1:7890"
# Environment="HTTPS_PROXY=http://127.0.0.1:7890"
sudo systemctl restart docker
```

### 11.3 健康检查超时

**症状**

```
[警告] 等待健康检查超时（120 秒）。最近的日志：
...
[错误] 服务未在预期时间内就绪。
```

**原因**：常见于① 数据库迁移失败；② 首次启动要跑迁移 + 初始化，冷启动超过 120 秒；③ 磁盘慢。

**解决**

```bash
# 看真实报错
docker compose logs -f app

# 手动看三个阶段是否都跑完
docker compose logs app | grep -E "阶段|entrypoint"

# 若是磁盘慢，调大超时后重跑
# （install.sh 的 HEALTH_TIMEOUT 是常量，可直接先 up 再等）
docker compose up -d
docker compose ps        # 等到 Up (healthy)
```

### 11.4 数据库连接失败

**症状**：应用日志出现 `ECONNREFUSED` / `password authentication failed for user "v2ex"` / `database "v2ex" does not exist`。

**原因**：
- PostgreSQL 容器未 healthy 就被拉起（compose 的 `depends_on.condition` 已保证，但健康检查本身可能失败）；
- **改了 `.env` 里的 `POSTGRES_PASSWORD`，但数据卷已存在** —— PostgreSQL 的初始口令只对**空数据目录**生效。

**解决**

```bash
# 先确认容器状态
docker compose ps
docker compose logs --tail=50 postgres

# 若口令不一致：改数据库里的口令
docker compose exec postgres psql -U v2ex -d postgres \
  -c "ALTER USER v2ex WITH PASSWORD '你 .env 里的新口令';"

# 或删卷重初始化（⚠️ 数据全丢）
docker compose down -v
./install.sh
```

### 11.5 Redis 认证失败

**症状**：日志出现 `NOAUTH Authentication required` 或 `WRONGPASS`。

**原因**：`REDIS_PASSWORD` 与 Redis 容器内实际生效的口令不一致
（Redis 的 `--requirepass` 在**容器首次创建时**由环境变量注入；已存在的容器不会因为 `.env` 变化而改口令）。

**解决**

```bash
# 确认 .env 里的值
grep '^REDIS_PASSWORD=' .env

# 直接用容器内口令测
docker compose exec redis sh -c 'redis-cli -a "$REDIS_PASSWORD" ping'
# PONG 说明正常；NOAUTH 说明容器内外不一致

# 不一致时：删掉 redis 卷重建（⚠️ 会清空 Redis 数据，
# 但 Redis 只是缓存与限流计数，核心数据在 PostgreSQL 里）
docker compose down -v
./install.sh
```

### 11.6 忘记管理员密码

**症状**：无法用 `admin` 登录。

**原因**：初始密码在 `INSTALL_CREDENTIALS.txt` 里；改过后就只存在于你的记忆里。

**解决**

```bash
# 方案 A：还没改过初始密码 → 看凭据文件
cat INSTALL_CREDENTIALS.txt

# 方案 B：改过了 → 用运维 CLI 重置
#      需要 --password、--reason，以及 ADMIN_CLI_TOKEN 环境变量
docker compose exec -e ADMIN_CLI_TOKEN=<运维令牌> app \
  node node_modules/tsx/dist/cli.mjs scripts/admin-cli.ts \
  set-password --username admin --password '<新口令>' --reason '管理员忘记密码后重置'
```

> `set-password` 的口令长度下限是 **8 位**（与注册接口一致）；
> 而 `SEED_ADMIN_PASSWORD` 的生产要求是 **≥12 位** —— 两者阈值不同。
> `ADMIN_CLI_TOKEN` 只从**环境变量**读取，不接受命令行参数
> （命令行参数会出现在进程列表与 shell 历史里）。
> 未配置 `ADMIN_CLI_TOKEN` 时会**一律拒绝**执行变更。

### 11.7 磁盘空间不足

**症状**

```
[错误] 磁盘可用空间不足：需要 ≥ 2048MB，当前约 812MB。
```

或运行一段时间后数据库容器频繁重启。

**解决**

```bash
# 查占用
docker system df
docker compose exec postgres du -sh /var/lib/postgresql/data

# 清理无用镜像与构建缓存（不影响数据卷）
docker system prune -a

# 检查数据库体积
docker compose exec postgres psql -U v2ex -d v2ex -c "\l+"
```

> 限流桶表（`rate_limit_buckets`）与通知表会随时间增长。
> 确认数据量后再做清理，**不要直接删系统表**。

### 11.8 容器反复重启

**症状**：`docker compose ps` 里 app 的 STATUS 是 `Restarting` 或不停变化。

**解决**

```bash
# 看退出原因
docker compose logs --tail=100 app

# 看重启次数与退出码
docker inspect v2ex-app --format '{{.RestartCount}} {{.State.ExitCode}} {{.State.Error}}'

# 常见原因与对策：
#   exit 1 + "DATABASE_URL 未设置"   → .env 缺失或变量名写错
#   exit 1 + "Error [ERR_MODULE_NOT_FOUND]" → 镜像不完整，重新拉取
docker compose pull --force
docker compose up -d
```

### 11.9 登录成功后又回到登录页

**症状**：输入正确账号密码，页面刷新后仍显示「登录」。

**原因**：`APP_URL` / `NEXT_PUBLIC_APP_URL` 与实际访问地址不一致
（最常见是改了 `APP_PORT` 但忘了同步另外两个）。

**解决**

```bash
# 三个变量必须一致
grep -E '^(APP_PORT|APP_URL|NEXT_PUBLIC_APP_URL)=' .env
```

改完后重启：

```bash
docker compose up -d
```

### 11.10 `container_name ... already in use`

**症状**：`docker compose up -d` 报容器名冲突。

**解决**

```bash
# 如果是本项目残留
docker compose down

# 如果是别的项目用了同名容器
docker rm -f v2ex-app
docker compose up -d
```

---

## 12. 部署后安全清单

> 上线前**逐项确认**。这 5 项是**必做**的。

- [ ] **登录后立即修改管理员密码**（`admin` → 设置 → 密码）
- [ ] **确认 `.env`、`INSTALL_CREDENTIALS.txt`、`backups/` 都不在版本库中**，
      且所在目录权限仅管理员可访问（Linux/macOS 上应为 `600` / `700`）
- [ ] **对外提供服务前启用 HTTPS**（Nginx / Caddy 反向代理 + 证书），
      并把 `.env` 中的 `APP_URL` / `NEXT_PUBLIC_APP_URL` 改成 `https://你的域名`
- [ ] **确认 `APP_RUNTIME_ENV=production`**、`SEED_DEMO_USERS=0`
      （演示账号不应出现在生产实例中）
- [ ] **已跑过一次 `./backup.sh` 并把备份复制到另一台机器**，
      且**验证过备份可以恢复**

### 12.1 额外加固建议

- [ ] PostgreSQL / Redis 保持**不暴露端口**的默认配置
- [ ] 反向代理正确透传 `X-Forwarded-For` / `X-Real-IP`
      （**必须**正确 —— 限流依赖该值，透传错误会导致所有用户共享同一份限流配额）
- [ ] 宿主机防火墙只放行 80/443 与 SSH
- [ ] 定期 `docker compose pull` 拉取基础镜像安全更新
- [ ] 镜像固定到 **digest**（`V2EX_IMAGE=ghcr.io/...@sha256:...`）而非 tag
- [ ] 用最小权限用户运行 Docker，避免给日常账号 `docker` 组权限

### 12.2 关于口令强度

安装脚本生成的强度：

| 变量 | 生成方式 | 长度 | 字符集 |
|---|---|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 16` | 32 | 十六进制 |
| `REDIS_PASSWORD` | `openssl rand -hex 16` | 32 | 十六进制 |
| `SESSION_SECRET` | `openssl rand -hex 24` | 48 | 十六进制 |
| `SEED_ADMIN_PASSWORD` | 密码学随机 + Fisher-Yates 洗牌 | 16 | 大写 + 小写 + 数字（去掉 `I`/`O`/`l`/`0`/`1` 等易混淆字符） |

所有随机源都是 CSPRNG（`openssl rand` → `/dev/urandom` → `base64` 三级兜底）。

---

## 13. 常见问题 FAQ

### Q1：需要账号密码才能用吗？

安装后**立即可用**。`admin` 是管理员账号（用于后台管理与建节点审核），
普通用户用「注册」自己创建即可。生产环境默认 `SEED_DEMO_USERS=0`，
**不会**创建 `lisi` / `wangwu` 等演示账号。

### Q2：v0.0.1 有哪些功能还没做？

主题编辑与删除、感谢（thank）、关注用户、积分排行榜、RSS 输出、
邮件找回密码、主题标签、附件上传、私信、头像上传、投票、第三方登录 ——
**全部未实现**，且**不提供任何假实现**（没有占位按钮、没有假接口）。
完整清单见 [`../README.md`](../README.md) 与 [`../CHANGELOG.md`](../CHANGELOG.md)。

### Q3：它和 V2EX 官方有关系吗？

**没有任何关系**。本项目是独立技术研究项目，未获官方授权，不是官方产品，
不代表官方背书。详见仓库根 [`README.md`](../README.md) 的「独立非官方项目声明」。

### Q4：可以用于生产环境吗？

**不建议**。v0.0.1 是开发预览版，**未经生产环境验证**，未做压力测试与长时间稳定性验证。
详见 [`../README.md`](../README.md) 的「已知缺陷与限制」。

### Q5：不用 Docker 能跑吗？

可以，但需要自己准备 PostgreSQL 17（Redis 可选）并用 Node.js 开发模式运行。
参见仓库根 [`README.md`](../README.md) 的「开发 → 本地开发」。

### Q6：Redis 可以不装吗？

可以。应用在 Redis 不可用时**自动降级**到 PostgreSQL 实现（限流计数存 `rate_limit_buckets` 表），
功能不受影响，只是性能略低。发行包的 compose 默认**会**启动 Redis。

### Q7：能改端口吗？

可以，但**必须三处同步**：`APP_PORT`、`APP_URL`、`NEXT_PUBLIC_APP_URL`（见 §6.1）。

### Q8：数据存在哪？怎么不丢？

数据存在 Docker 数据卷 `postgres-data`（PostgreSQL）与 `redis-data`（Redis）里。
`./stop.sh` 与 `docker compose down` **都保留**数据卷。
只有 `docker compose down -v` 会删除数据 —— **千万别随手执行**。
详见 §8.1 与 §10.2。

### Q9：升级会不会把我的数据冲掉？

**不会**。`./update.sh` 只用 `docker compose up -d` 就地重建容器，
**从不执行 `down -v`**，数据卷原样保留。
另外 seed 是「只初始化、不修改」语义 —— 重新部署**不会**重置管理员口令，
**不会**重复写入演示数据。

### Q10：安装包里的 `.env` 我能直接改吗？

可以，**改完执行 `./start.sh` 生效**。但注意两个坑：
1. 改 `POSTGRES_PASSWORD` 不会改变已存在的数据库里的口令（见 §11.4）；
2. 改 `SEED_ADMIN_PASSWORD` 不会改变已存在的管理员的密码（见 §6.5）。

### Q11：日志在哪？怎么看？

```bash
docker compose logs -f app        # 应用
docker compose logs -f postgres   # 数据库
docker compose logs --since=1h app   # 最近 1 小时
```

### Q12：怎么彻底删掉，不留痕迹？

```bash
./backup.sh                 # 先备份
docker compose down -v      # ⚠️ 删除数据卷，帖子/回复/账号全部丢失
rm -rf backups INSTALL_CREDENTIALS.txt .env
```

---

## 附录：许可与声明

- **许可证**：MIT（见安装包内的 `LICENSE`）
- **商标**："V2EX" 是 V2EX 及其权利人的商标。本项目**不是** V2EX 官方产品，
  与 V2EX 官方**无任何关联**，未获官方授权，不代表任何形式的官方背书。
  MIT 许可证仅覆盖源代码与文档，**不授予**任何商标、品牌标识或服务标记的使用许可。
- **第三方内容**：本项目**不包含** V2EX 官方站点的 HTML / CSS / JavaScript 副本、
  官方品牌图片或用户数据。仓库中的图标与 Logo 为独立绘制的等价实现。
- **第三方组件**：Next.js、React、PostgreSQL、Redis、Drizzle ORM、ioredis、
  bcryptjs、jose、marked、sanitize-html、zod 等，各自遵循其原始许可证。
- **用途**：仅供技术学习与研究。使用者需自行确保其使用方式符合
  所在地法律法规与平台服务条款。

*Not affiliated with, endorsed by, or associated with V2EX.*
