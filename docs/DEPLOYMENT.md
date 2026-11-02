# DEPLOYMENT — 部署文档

## 1. 环境要求

| 组件 | 版本 | 说明 |
|---|---|---|
| Node.js | `^22.23.4` \| `^24.22.1` \| `>=26.12.1` | 与 REA（`rea-agents`）的 engines 要求一致 |
| PostgreSQL | 17+ | |
| Redis | 7+ | **可选**。缺失时自动降级到 PostgreSQL（语义等价） |
| Docker / Docker Compose | v2 | 用于一键部署 |

## 2. 快速开始（Docker Compose）

```bash
# 1. 克隆并进入目录
cd v2ex-clone

# 2. 准备环境变量
cp .env.example .env
```

编辑 `.env`，**至少修改**以下两项：

```bash
# 必改：会话签名密钥，至少 32 位随机字符
SESSION_SECRET=$(openssl rand -base64 48)

# 必改：初始管理员密码
SEED_ADMIN_PASSWORD=<你的强密码>
```

完整 `.env` 可用变量：

```bash
POSTGRES_USER=v2ex
POSTGRES_PASSWORD=v2ex_password
POSTGRES_DB=v2ex
POSTGRES_PORT=5432

REDIS_PASSWORD=v2ex_redis_password
REDIS_PORT=6379

APP_PORT=3000
APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

SESSION_SECRET=change-me-to-a-long-random-string-at-least-32-chars

SEED_ADMIN_USERNAME=admin
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=admin12345

RATE_LIMIT_LOGIN_MAX=10
RATE_LIMIT_POST_MAX=5
RATE_LIMIT_REPLY_MAX=20
RATE_LIMIT_WINDOW_SECONDS=60
```

```bash
# 3. 构建并启动
docker compose up -d --build

# 4. 查看状态
docker compose ps
docker compose logs -f app

# 5. 访问
open http://localhost:3000
```

容器启动时会自动执行：`drizzle-kit migrate` → `seed` → `next start`。
数据库与 Redis 均配置了 healthcheck，app 服务会等待两者健康后再启动。

停止 / 清理：

```bash
docker compose down            # 停止，保留数据卷
docker compose down -v         # 停止并删除数据卷（会丢失数据）
```

## 3. 本地开发（不使用 Docker）

### 3.1 启动依赖

```bash
# PostgreSQL（示例用 Docker 起一个）
docker run -d --name v2ex-pg \
  -e POSTGRES_USER=v2ex -e POSTGRES_PASSWORD=v2ex_password -e POSTGRES_DB=v2ex \
  -p 5432:5432 postgres:17-alpine

# Redis（可选）
docker run -d --name v2ex-redis \
  -p 6379:6379 redis:7-alpine redis-server --requirepass v2ex_redis_password
```

### 3.2 应用

```bash
npm install
cp .env.example .env.local        # 修改 DATABASE_URL / REDIS_URL / SESSION_SECRET

npm run db:generate               # 修改 schema.ts 后生成迁移
npm run db:migrate                # 应用迁移
npm run db:seed                   # 写入初始分类/节点/用户/主题

npm run dev                       # 开发模式 http://localhost:3000
```

### 3.3 生产构建

```bash
npm run build
npm run start                     # 生产模式
```

## 4. 数据库迁移

```bash
npm run db:generate -- --name=add_xxx   # 生成迁移（写入 drizzle/）
npm run db:migrate                       # 应用未执行的迁移
```

迁移文件位于 `drizzle/`，由 `drizzle-kit` 按 `drizzle/meta/_journal.json` 顺序执行。
生产环境在容器启动时自动执行 `drizzle-kit migrate`。

查看状态：

```bash
psql "$DATABASE_URL" -c "select id, hash, created_at from drizzle.__drizzle_migrations;"
```

## 5. 初始账号

`npm run db:seed` / 容器启动时自动创建：

| 角色 | 用户名 | 密码 | 来源 |
|---|---|---|---|
| 管理员 | `admin` | `SEED_ADMIN_PASSWORD`（默认 `admin12345`） | 环境变量 |
| 普通用户 | `lisi` | `password123` | seed 脚本 |
| 普通用户 | `wangwu` | `password123` | seed 脚本 |
| 普通用户 | `zhaoliu` | `password123` | seed 脚本 |
| 版主 | `moderator` | `password123` | seed 脚本 |

> **生产部署后请立即修改这些密码**，并删除不需要的演示账号。

## 6. 反向代理（Nginx）

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

## 7. 安全检查清单

上线前逐项确认：

- [ ] `SESSION_SECRET` 已改为随机强密钥（≥32 字符）
- [ ] `SEED_ADMIN_PASSWORD` 已修改
- [ ] `SEED_ADMIN_EMAIL` 已改为真实邮箱
- [ ] `.env.local` 中的 `DISABLE_CAPTCHA=1` **已删除**（生产必须启用验证码）
- [ ] `.env.local` 中的 `ENABLE_DEBUG_ENDPOINTS=1` **已删除**（调试端点必须关闭）
- [ ] PostgreSQL 端口未暴露到公网（仅内部网络）
- [ ] Redis 已设置密码，且未暴露到公网
- [ ] 已启用 HTTPS
- [ ] `X-Forwarded-For` 正确透传
- [ ] 已定期备份数据库（`pg_dump`）

## 8. 备份与恢复

```bash
# 备份
docker compose exec postgres pg_dump -U v2ex v2ex | gzip > v2ex-$(date +%F).sql.gz

# 恢复
gunzip -c v2ex-2026-11-02.sql.gz | docker compose exec -T postgres psql -U v2ex -d v2ex
```

## 9. 监控要点

| 指标 | 来源 | 告警建议 |
|---|---|---|
| HTTP 429 比例 | 应用日志 | 突增说明可能被撞库 |
| PostgreSQL 连接数 | `pg_stat_activity` | 接近 `max_connections` 时扩容连接池 |
| `rate_limit_buckets` 行数 | 数据库 | 持续增长说明有大量唯一键被限流 |
| `login_attempts` 失败率 | 数据库 | 失败率突增说明存在爆破尝试 |
| `floor_counters` 与 `replies` 一致性 | 数据库 | 不一致说明楼层分配器异常 |

## 10. 常见问题

**Q: 启动报 `DATABASE_URL is not set`**
A: 未创建 `.env.local` 或未安装 `dotenv` 的环境加载。执行 `cp .env.example .env.local` 并确认变量已填写。

**Q: 页面能打开但提示 500**
A: 检查数据库连接：`docker compose logs app | grep -i error`。首次启动需等待 `drizzle-kit migrate` 完成。

**Q: 限流太严格，多个用户被一起拦**
A: 确认反向代理正确透传 `X-Forwarded-For`。登录/注册限流键为 `IP + 用户名`，若 IP 识别错误会退化为按 IP 限流。

**Q: Redis 未安装会怎样**
A: 正常使用。`src/lib/kv.ts` 会自动降级到 PostgreSQL 的 `kv_store` / `rate_limit_buckets`，限流与验证码功能不受影响，仅性能略有损失。

**Q: 如何重置某个用户的限流**
A: `DELETE FROM rate_limit_buckets WHERE key LIKE 'ratelimit:%';`
