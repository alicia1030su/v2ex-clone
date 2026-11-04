# 升级指南：v0.0.2 → v0.0.3

> 本文档描述从 **v0.0.2 原地升级**到 **v0.0.3** 的完整步骤。
> 升级**不删除数据库、不清空数据卷、不重置管理员口令、不覆盖头像与附件**。
>
> 升级前请务必完成**备份**（第 1 步）—— 本轮提供失败恢复方案（第 7 步）。

---

## 0. 升级内容概览

| 项 | v0.0.2 | v0.0.3 |
|---|---|---|
| 数据库表 | 18 | **26**（新增 8 张） |
| 数据库字段 | — | `topics`/`replies` 各新增 5 个 |
| 枚举类型 | 7 | **12**（新增 5 个） |
| 迁移文件 | `0000_init.sql` | `0000_init.sql` + `0001_striped_magdalene.sql` |
| API 路由 | 20 | **55** |
| 单元测试 | 117 | **185** |

**兼容性**：v0.0.3 的迁移**只做增量**（`ADD COLUMN` / `CREATE TABLE` / `CREATE TYPE`），
**不修改或删除任何已有列的数据**。因此升级后 v0.0.2 的全部功能与数据保持不变。

---

## 1. 升级前备份（必做）

### Linux / macOS（Docker Compose）

```bash
cd /path/to/v2ex-clone

# 1.1 备份数据库
docker compose exec -T postgres pg_dump -U v2ex v2ex \
  | gzip > "backup-v002-$(date +%Y%m%d-%H%M%S).sql.gz"

# 1.2 备份 .env（含有 SMTP 口令等配置）
cp .env "backup-env-$(date +%Y%m%d-%H%M%S)"

# 1.3 备份数据卷（含头像等上传文件）
docker run --rm \
  -v "$(docker volume ls -q | grep postgres-data)":/data:ro \
  -v "$(pwd)":/backup \
  alpine tar czf "/backup/backup-volumes-$(date +%Y%m%d-%H%M%S).tar.gz" -C /data .
```

### Windows（PowerShell）

```powershell
cd C:\path\to\v2ex-clone

# 1.1 备份数据库
docker compose exec -T postgres pg_dump -U v2ex v2ex `
  | Out-File -Encoding utf8 "backup-v002-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"

# 1.2 备份 .env
Copy-Item .env "backup-env-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

# 1.3 用项目自带的备份脚本（推荐，自动压缩 + 校验）
.\deploy\backup.sh
```

### 验证备份可用

```bash
# 检查备份文件非空且可解压
gunzip -t backup-v002-*.sql.gz && echo "备份文件完整"
```

---

## 2. 升级前检查

```bash
# 2.1 确认当前运行的是 v0.0.2
docker compose ps
docker compose exec -T app cat /app/deploy/VERSION

# 2.2 确认数据库可连接且表数为 18
docker compose exec -T postgres psql -U v2ex -d v2ex -c "\dt" | tail -3

# 2.3 确认磁盘有足够空间（镜像 + 备份）
df -h .
```

---

## 3. 执行升级（Linux / macOS）

```bash
cd /path/to/v2ex-clone

# 3.1 拉取新镜像
docker compose pull

# 3.2 启动新版本
#     容器 entrypoint 阶段 1 会**自动执行迁移**（幂等，每次启动都安全）
#     阶段 2 执行 seed（幂等，不会覆盖已有管理员口令）
docker compose up -d

# 3.3 观察迁移日志
docker compose logs -f app | grep -E "migrate|migration|seed|✅|error"
```

### Windows（PowerShell）

```powershell
cd C:\path\to\v2ex-clone

docker compose pull
docker compose up -d
docker compose logs -f app
```

> **重要**：**不要**执行 `docker compose down -v` —— `-v` 会删除数据卷，
> 导致数据丢失。`deploy/stop.sh` 与 `deploy/update.sh` 均**不含** `down -v`。

---

## 4. 升级后验证

### 4.1 数据库结构

```bash
# 表数应为 26
docker compose exec -T postgres psql -U v2ex -d v2ex -t -A \
  -c "select count(*) from information_schema.tables where table_schema='public';"

# 新表应存在
docker compose exec -T postgres psql -U v2ex -d v2ex -t -A \
  -c "select table_name from information_schema.tables
      where table_schema='public'
        and table_name in ('edit_history','password_reset_tokens','credit_ledger',
                           'daily_checkins','reports','node_requests','avatars','email_logs')
      order by table_name;"
```

期望输出（8 张表全部列出）：
```
avatars
credit_ledger
daily_checkins
edit_history
email_logs
node_requests
password_reset_tokens
reports
```

### 4.2 数据完整性（关键）

```bash
# 升级前后的用户数、主题数、回复数应完全一致
docker compose exec -T postgres psql -U v2ex -d v2ex -c "
  select 'users' t, count(*) from users
  union all select 'topics', count(*) from topics
  union all select 'replies', count(*) from replies
  union all select 'nodes', count(*) from nodes;
"

# 管理员口令哈希不应变化（升级不会重置口令）
docker compose exec -T postgres psql -U v2ex -d v2ex -t -A \
  -c "select substring(password_hash,1,24) from users where role='admin' limit 1;"
```

> 与升级前对比这两个输出：**数字应完全相同**，管理员哈希前缀应一致。

### 4.3 应用功能

```bash
# 首页
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/

# Feed（应返回 200 且 Content-Type 正确）
curl -sI http://localhost:3000/api/feed | grep -i content-type
#   期望：application/rss+xml; charset=utf-8

# 登录（用升级前的管理员口令）
curl -s -X POST http://localhost:3000/api/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<你的管理员口令>"}'
```

浏览器中额外确认：
- [ ] 首页主题列表正常显示
- [ ] 打开任意主题，回复区正常
- [ ] `/leaderboard` 积分排行榜页可访问
- [ ] `/settings` 设置页可修改资料
- [ ] 头像正常显示（未被覆盖）

---

## 5. 新增环境变量（可选）

v0.0.3 新增以下环境变量，**全部有合理默认值，不配置也能正常运行**：

| 变量 | 默认 | 说明 |
|---|---|---|
| `TOPIC_EDIT_WINDOW_MINUTES` | `60` | 主题/回复的编辑时限（0 = 永久允许，上限 30 天） |
| `TRUST_PROXY_HEADERS` | `0` | 是否采信 `x-forwarded-for`（**默认关闭**） |
| `PASSWORD_RESET_TTL_MINUTES` | `60` | 重置令牌有效期 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 未配置 | 邮件服务；**未配置时找回密码会如实显示「未送达」** |
| `TOPIC_CREDITS` / `REPLY_CREDITS` / `CHECKIN_CREDITS` | `5` / `2` / `2` | 积分数额（独立实现，非原站确认值） |
| `CHECKIN_STREAK_BONUS` / `CHECKIN_STREAK_BONUS_MAX` | `1` / `10` | 连续签到额外奖励 |
| `AVATAR_MAX_BYTES` | `2097152`（2MB） | 头像大小上限 |
| `AVATAR_SIZE` | `256` | 头像目标边长 |

写入 `.env` 后需重启：`docker compose up -d`

---

## 6. 各平台的升级命令速查

| 平台 | 安装 | 升级 |
|---|---|---|
| **Linux / macOS** | `bash deploy/install.sh` | `bash deploy/update.sh` |
| **Windows（PowerShell）** | `powershell -ExecutionPolicy Bypass -File deploy\install.ps1` | `powershell -ExecutionPolicy Bypass -File deploy\update.ps1` |
| **Windows（Git Bash）** | `bash deploy/install.sh` | `bash deploy/update.sh` |

`deploy/update.sh` 与 `deploy/update.ps1` 会：
1. 备份数据库
2. 拉取新镜像
3. `docker compose up -d`（**不带 `-v`**）
4. 等待健康检查通过

---

## 7. 升级失败时的恢复

### 7.1 迁移失败（应用起不来）

迁移是**幂等**的且**只做增量**，因此最坏情况是「部分表已建、部分未建」。
重新执行迁移即可继续（已建的部分会被 `IF NOT EXISTS` 跳过）：

```bash
docker compose run --rm app node node_modules/drizzle-kit/bin.cjs migrate
docker compose up -d
```

### 7.2 需要完全回滚到 v0.0.2

```bash
# 7.2.1 停止服务
docker compose down          # 注意：不带 -v

# 7.2.2 恢复数据库
gunzip -c backup-v002-*.sql.gz \
  | docker compose exec -T postgres psql -U v2ex -d v2ex

# 7.2.3 恢复 .env
cp backup-env-* .env

# 7.2.4 回到 v0.0.2 镜像
#         在 .env 中把 V2EX_IMAGE 改回 ghcr.io/alicia1030su/v2ex-clone:v0.0.2
docker compose pull && docker compose up -d
```

### 7.3 数据卷损坏

```bash
docker run --rm \
  -v "$(docker volume ls -q | grep postgres-data)":/data:ro \
  -v "$(pwd)":/backup \
  alpine tar xzf /backup/backup-volumes-*.tar.gz -C /data
```

---

## 8. 升级失败的独立环境验证

本轮的升级验证在**独立环境**中完成（不触碰生产数据）：

| 验证项 | 方法 | 结果 |
|---|---|---|
| v0.0.2 结构 + 真实数据 → v0.0.3 | 独立 PostgreSQL 实例（端口 55433），建 18 表库 + seed 真实数据 → 应用 `0001` | ✅ 表数 18→26，数据指纹完全一致 |
| 迁移幂等性 | 连续应用 `0001` 三次 | ✅ 三次全部 `exit=0`，26 表 / 38 约束 |
| 全新库安装 | 空库 + `0000` + `0001` | ✅ `migrations applied successfully!` |
| 管理员口令不被重置 | 比对升级前后 `password_hash` | ✅ 完全一致 |
| 余额不被重置 | 比对升级前后 `sum(balance)` | ✅ 完全一致 |

> **未做**的事：没有在**生产数据卷**上实际执行过升级 ——
> 本环境不具备生产访问权限。上述验证均在等价结构的独立环境中完成。

---

## 9. 升级后的回滚点说明

| 项 | 状态 |
|---|---|
| 数据库结构 | 可回滚（`0001` 只做增量，回滚需手工 `DROP` 新表/列） |
| 数据内容 | **无需回滚** —— 升级不改写任何已有数据 |
| 管理员口令 | 未变更 |
| 头像与附件 | 未变更（存于数据卷，迁移不触碰） |
| 用户主题与回复 | 未变更 |

---

## 10. 已知问题

| 项 | 说明 |
|---|---|
| 邮件真实投递未验证 | SMTP 客户端已实现，但未在真实 SMTP 服务器上验证过送达 |
| 头像未自动裁剪 | 未安装 `sharp`，当前保存原图（降级路径可用，不影响功能） |
| 历史风险仍在 | Git 历史中原站素材仍可取回 —— 历史改写需单独授权，未执行。详见 `RISK_REGISTER.md` |
