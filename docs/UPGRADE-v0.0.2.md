# 从 v0.0.1 升级到 v0.0.2

> **⚠️ 独立非官方项目**
>
> 本项目与 V2EX 官方**无任何关联**，是独立技术研究项目，未获官方授权，
> 不是 V2EX 官方产品。
>
> **v0.0.2 仍是开发预览版（Pre-release）**，功能尚未完备，**未经生产环境验证**，
> **不建议用于生产环境**。

本文档覆盖 **v0.0.1 → v0.0.2** 的升级。

> **先读这一段**：v0.0.2 的镜像 **tag 不可移动**（见 §5）。
> 也就是说 `v0.0.2` 一旦发布就固定了。如果 v0.0.2 有问题，
> 修复方式是**发 v0.0.3**，而不是重推 `v0.0.2`。
> 请据此规划你的升级节奏。

---

## 1. 本次升级到底改了什么（对运维的影响）

### 1.1 影响你操作的部分

| 变化 | 对你的影响 |
|---|---|
| **镜像 tag 从 `v0.0.1` 变为 `v0.0.2`** | 需要改 `.env` 里的 `V2EX_IMAGE` |
| **生产镜像不再包含 devDependencies** | 镜像变小；**不影响**你的操作 —— 迁移与初始化脚本仍可用（见 §1.2） |
| **依赖树漏洞从 4 个 moderate 降到 0** | 无需操作 |
| **CI / 发布流水线修复** | 无需操作（但如果你手动跑流水线，`dry_run` 现在**真的**不发布了） |

### 1.2 不会影响你操作的部分

- **数据库结构未变** —— v0.0.2 **没有新增数据库迁移**。
  容器启动时的 `drizzle-kit migrate` 会发现「无新迁移」并直接跳过。
- **数据格式未变** —— 你的用户、主题、回复、收藏、通知数据原样保留。
- **`.env` 格式未变** —— 变量名、语义、必需性全部未变，**旧的 `.env` 可以直接沿用**。
- **管理员口令不会被重置** —— seed 的「只初始化、不修改」语义未变。

### 1.3 镜像内部的变化（供好奇者）

v0.0.1 的 Dockerfile 在运行层直接 `COPY --from=builder /app/node_modules`，
把**包含全部 devDependencies 的完整 `node_modules`**（本机实测 530 MB）打进了生产镜像 ——
其中包括 `@playwright/test`、`vitest`、`typescript`、`@types/*` 这些**只在测试期用**的工具。

v0.0.2 改为在运行层执行 `npm ci --omit=dev`，按依赖图只装生产依赖。
为此 `drizzle-kit` 与 `tsx` 从 `devDependencies` **上移到了 `dependencies`** ——
因为它们不是测试工具，而是容器启动时真实要用的：

| 包 | 谁在用 | 用途 |
|---|---|---|
| `drizzle-kit` | entrypoint 阶段 1 | 执行数据库迁移 |
| `tsx` | entrypoint 阶段 2 | 跑 `scripts/seed.ts`（首次初始化） |

> 换句话说：**这两个包以前就装在镜像里，位置没变，只是从「dev 分类」挪到了「prod 分类」。**
> 你的容器启动流程不会有任何变化。

---

## 2. 升级前检查

```bash
cd v2ex-clone-deploy      # 你的部署目录
```

- [ ] **磁盘空间** ≥ 2 GB 可用（旧镜像 + 新镜像会同时存在一段时间）
- [ ] **当前服务正常**：`curl -sS -o /dev/null -w '%{http_code}' http://localhost:3000/` 返回 200
- [ ] **已备份**：`./backup.sh` 成功产出 `backups/v2ex-<时间戳>.sql.gz`
- [ ] **备份已异地**：备份文件已复制到另一台机器或对象存储
      —— **同盘备份不是备份**，这是回滚能力的唯一依据
- [ ] 记录当前镜像 digest（回滚要用）：
      ```bash
      docker image inspect --format='{{index .RepoDigests 0}}' \
        ghcr.io/alicia1030su/v2ex-clone:v0.0.1 | tee /tmp/old-digest.txt
      ```
- [ ] 记录当前状态（便于升级后比对）：
      ```bash
      docker compose ps
      docker compose exec -T postgres psql -U v2ex -d v2ex \
        -c "select count(*) from users; select count(*) from topics; select count(*) from replies;"
      ```

---

## 3. 升级步骤

### 3.1 Linux / macOS

```bash
cd v2ex-clone-deploy

# 1) 备份（再次确认已备份）
./backup.sh

# 2) 改镜像 tag
sed -i 's|^V2EX_IMAGE=.*|V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.2|' .env

# 3) 用发行包自带的升级脚本（它会记录新旧 digest、只重建容器不删卷）
./update.sh

# 4) 验证
docker compose ps          # app 应为 Up (healthy)
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # 应为 200
```

### 3.2 Windows（PowerShell）

> **注意**：发行包里的 PowerShell 脚本目前**只有 `install.ps1`** ——
> `backup.sh` / `restore.sh` / `update.sh` / `start.sh` / `stop.sh` 都是 **bash 脚本**，
> 没有对应的 `.ps1` 版本。
> Windows 用户请用下面的**手工步骤**（等价于 `update.sh` 做的事）。

```powershell
cd v2ex-clone-deploy\deploy

# 1) 备份（PowerShell 原生方式，等价于 backup.sh 的数据库逻辑备份）
#    前提：容器正在运行
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path backups | Out-Null
docker compose exec -T postgres pg_dump --username=v2ex --dbname=v2ex --no-owner --no-acl `
  | Out-File -Encoding utf8 "backups/v2ex-$stamp.sql"
# 同时单独备份 .env（它含全部凭据）
Copy-Item .env "backups/.env-$stamp"

# 2) 改镜像 tag
(Get-Content .env) -replace '^V2EX_IMAGE=.*$', 'V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.2' |
    Set-Content .env -Encoding utf8

# 3) 拉取并就地重建容器（数据卷保留）
docker compose pull
docker compose up -d

# 4) 验证
docker compose ps
Invoke-WebRequest -Uri http://localhost:3000/ -UseBasicParsing | Select-Object StatusCode
```

> 若你的 Windows 机器装有 WSL / Git Bash，也可以直接跑 `./update.sh`。
> **没有** `update.ps1` 这个文件，别去找了。

### 3.3 手工升级（不用脚本）

```bash
docker compose pull
docker compose up -d
```

> `docker compose up -d` 是**就地重建容器**，数据卷保留。
> **绝不要**用 `docker compose down -v` —— `-v` 会**永久删除**数据。

### 3.4 用源码仓库升级

```bash
git pull origin master
docker compose up -d --build
```

---

## 4. 升级后验证

### 4.1 必查项

```bash
# ① 三个容器都健康
docker compose ps
#   v2ex-app       ghcr.io/alicia1030su/v2ex-clone:v0.0.2   Up (healthy)
#   v2ex-postgres  postgres:17-alpine                      Up (healthy)
#   v2ex-redis     redis:7-alpine                          Up (healthy)

# ② 应用可访问
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # 200

# ③ 数据没丢（与升级前记录的比对）
docker compose exec -T postgres psql -U v2ex -d v2ex \
  -c "select count(*) from users; select count(*) from topics; select count(*) from replies;"

# ④ 管理员口令没被重置 —— 用你**记住的**口令登录，而不是 INSTALL_CREDENTIALS.txt 里的旧口令
#    （若被重置了，说明有异常，立刻查 backup.sh 的产出）

# ⑤ 迁移没有报错
docker compose logs app | grep -i "error\|migration" | tail -20

# ⑥ 数据库与 Redis 仍然没有暴露端口
docker compose config | grep -A 20 '^  postgres:' | grep published   # 无输出
docker compose config | grep -A 20 '^  redis:'    | grep published   # 无输出
```

### 4.2 升级后仍未生效的排查顺序

| 现象 | 排查 |
|---|---|
| 镜像拉不下来 | `docker pull ghcr.io/alicia1030su/v2ex-clone:v0.0.2` —— 报 `denied` 说明 GHCR 包可见性变了，见 [`DEPLOYMENT.md`](DEPLOYMENT.md) §13 |
| 容器反复重启 | `docker compose logs app --tail=100` —— 重点看迁移阶段报错 |
| 页面 500 | `docker compose logs app | grep -i error`，多半是数据库连接问题 |
| 限流异常 | 确认反向代理正确透传 `X-Forwarded-For`（见 [`DEPLOYMENT.md`](DEPLOYMENT.md) §7） |

---

## 5. 回滚说明

### 5.1 ⚠️ 前提：tag 不可移动

**同一个 tag 一旦发布就不应重新指向另一个镜像。**

- `v0.0.2` 发布后，它就**永久固定**指向那一个镜像；
- 如果把 `v0.0.2` 重新指向一个不同的镜像，回滚时会拉到**错误的镜像**，
  且问题排查会变得极其困难；
- 需要修正 v0.0.2 的缺陷时，**发 v0.0.3**，不要动 `v0.0.2`；
- 同样地，**`v0.0.1` 的 tag 与已发布资产保持不变** —— 本次升级**没有**、也**不会**
  覆盖 v0.0.1 的任何内容。

### 5.2 应用回滚（推荐）

```bash
cd v2ex-clone-deploy

# 改回旧 tag
sed -i 's|^V2EX_IMAGE=.*|V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.1|' .env

# 重建容器（数据卷保留）
docker compose pull && docker compose up -d
```

### 5.3 精确回滚：用 digest 而非 tag

tag 理论上可能被误操作移动。生产环境建议**直接固定到 digest**：

```bash
# 取出你升级前记录的 digest
cat /tmp/old-digest.txt
# ghcr.io/alicia1030su/v2ex-clone@sha256:xxxx...

# 写进 .env
sed -i 's|^V2EX_IMAGE=.*|V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone@sha256:xxxx...|' .env
docker compose pull && docker compose up -d
```

> 固定到 digest 后，无论 tag 怎么变，拉到的永远是同一个镜像。

### 5.4 数据回滚

**v0.0.2 没有新增数据库迁移**，所以绝大多数情况下应用回滚就够了 ——
v0.0.1 的代码能正常读 v0.0.2 留下的数据（因为结构没变）。

如果确实需要回滚数据（Linux / macOS）：

```bash
# 1. 先停服
./stop.sh

# 2. 用**升级前**的备份恢复
#    ⚠️ 恢复会覆盖备份之后写入的所有数据 —— 升级后新增的数据会丢失
./restore.sh backups/v2ex-<升级前时间戳>.sql.gz

# 3. 回到旧镜像
sed -i 's|^V2EX_IMAGE=.*|V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.1|' .env

# 4. 启动
./start.sh
```

Windows（无 `restore.sh`）的等价做法：

```powershell
docker compose down
$stamp = '<升级前备份的时间戳>'
Get-Content "backups/v2ex-$stamp.sql" -Raw | docker compose exec -T postgres psql `
    --username=v2ex --dbname=v2ex --single-transaction
(Get-Content .env) -replace '^V2EX_IMAGE=.*$', 'V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.1' |
    Set-Content .env -Encoding utf8
docker compose up -d
```

> **没有备份就没有数据回滚能力。** 这是 §2 里「备份已异地」那一项必须打勾的原因。

### 5.5 回滚前提

回滚方案的有效性**完全依赖于「升级前做了备份」**这个前提。
没有备份时，唯一能回滚的是应用代码，数据只能靠手工修。

---

## 6. 已知问题

### 6.1 v0.0.2 继承自 v0.0.1 的限制

v0.0.2 **没有**解决下列问题 —— 它们是预览版的固有限制，
完整清单见 [`DEPLOYMENT.md`](DEPLOYMENT.md) §13「已知限制」：

- 未做压力测试、长时间运行稳定性验证
- 没有内置监控端点与 Prometheus `/metrics` 导出
- 没有内置定时备份与自动化恢复演练
- Git 历史中仍可取回原站版权素材（需单独授权才能清理，见 `RISK_REGISTER.md` R-01）
- 预览版之间的迁移**不保证**向后兼容

### 6.2 本次升级新引入的限制

- **生产镜像不再包含测试工具链**。如果你**曾经**在容器里跑过
  `npx vitest` / `npx playwright` 之类的命令，现在会报「找不到模块」。
  这是**预期行为** —— 测试应该在源码仓库或 CI 里跑，不在生产容器里。
  确实需要在生产容器里跑某些脚本时，用源码仓库方式部署。
- **镜像 tag 只能新增，不能复用**。

### 6.3 尚未在本机验证的项

> 下面这些由 **CI 与发布流水线**负责验证，本地开发环境**没有 Docker** 无法实测：

- 镜像的实际体积（裁剪 devDependencies 后的确切数值）
- `USER nextjs` 非 root 运行在真实容器中的表现
- 裁剪后的生产依赖闭包是否遗漏了某个 entrypoint 需要的包

发布流水线会在真实 Docker 环境构建并启动该镜像 —— 构建失败或启动失败都会让发布失败。

---

## 7. 参见

| 文档 | 用途 |
|---|---|
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | 完整部署手册、密钥管理、备份策略、反向代理、监控 |
| [`INSTALL.md`](INSTALL.md) | 从零安装（不是升级）的完整步骤 |
| [`RELEASE_GATE_v0.0.2.md`](RELEASE_GATE_v0.0.2.md) | v0.0.2 的发布门槛检查单 |
| [`SECURITY_EXCEPTIONS.md`](SECURITY_EXCEPTIONS.md) | 已评估并接受的风险例外（含到期日） |
| [`../CHANGELOG.md`](../CHANGELOG.md) | 完整变更记录 |
