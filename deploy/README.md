# V2EX Clone v0.0.15 — 一键部署包

> **⚠️ 重要声明**
>
> **本项目与 V2EX 官方没有任何关联。**
> 这是一个**独立技术研究项目**，不是 V2EX 的官方产品，未获官方授权，
> 不代表任何形式的官方背书。"V2EX" 及其标识是 V2EX 及其权利人的商标，
> 本项目不授予也不主张任何商标使用权。
> 本项目仅供技术学习与研究用途，使用者需自行确保使用方式符合
> 所在地法律法规与平台服务条款。

---

## 这是什么

一个用 Next.js 15 + PostgreSQL + Redis 构建的社区论坛应用。
本安装包让你**一条命令**在本机跑起一个完整的实例：

- 用户注册 / 登录 / 会话管理
- 节点（Node）、主题（Topic）、回复（Reply）发帖与交互
- 收藏夹、通知、标签搜索
- 基于 Redis 的限流与验证码

## 版本状态

**v0.0.9 是早期开发预览版（Pre-release）。**

- 它**不是**稳定版，可能存在功能缺陷、UI 瑕疵与数据边界问题
- 数据库迁移脚本在预览阶段可能调整，升级时不保证向后兼容
- 仅建议在**本地开发 / 体验 / 测试**环境使用
- **请勿**直接用于生产环境，也不要导入重要数据
- 问题反馈请提交到项目仓库的 Issue

---

## 快速开始

### Linux / macOS

```bash
chmod +x install.sh
./install.sh
```

### Windows（PowerShell）

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装脚本会自动完成：

1. 检查 Docker / Compose v2 / 磁盘空间 / 端口占用
2. 生成 `.env`（**随机口令**，已存在则不覆盖，幂等）
3. 拉取镜像并启动容器
4. 等待健康检查通过

完成后打开：

**http://localhost:3000**

管理员账号：`admin`　初始密码：安装结束时会在终端显示，
同时保存在 `INSTALL_CREDENTIALS.txt`（请妥善保管，**登录后立即修改**）。

---

## 系统要求

| 项目 | 要求 |
|------|------|
| Docker Engine | 20.10 或更高 |
| Docker Compose | v2（`docker compose version` 可用） |
| 磁盘可用空间 | ≥ 2 GB |
| 内存 | ≥ 2 GB |
| 空闲端口 | 3000（或自定义的 `APP_PORT`） |
| 操作系统 | Linux / macOS / Windows（Windows 建议用 WSL2 或 Docker Desktop） |

> **Windows 用户注意**：请使用 **Docker Desktop**（自带 Compose v2 与 WSL2 后端）。
> 仅安装 Docker CE for Windows 的命令行版本通常不带 Compose v2。

---

## 目录结构

```
v2ex-clone-deploy/
├── install.sh                # Linux/macOS 一键安装
├── install.ps1               # Windows 一键安装
├── start.sh                  # 启动服务
├── stop.sh                   # 停止服务（保留数据卷）
├── update.sh                 # 升级到新版本
├── backup.sh                 # 备份数据库与配置
├── restore.sh                # 从备份恢复
├── docker-compose.yml        # 容器编排定义
├── .env.example              # 环境变量模板（安装脚本据此生成 .env）
├── .env                      # ← 安装后自动生成，含真实凭据，勿提交
├── INSTALL_CREDENTIALS.txt   # ← 安装后自动生成，管理员初始密码
├── backups/                  # ← 备份输出目录
├── README.md                 # 本文件
├── INSTALL.md                # 详细安装与运维文档
├── VERSION                   # 版本号
└── LICENSE                   # MIT 许可证 + 商标声明
```

---

## 常用命令

全部命令都在**本目录**下执行：

| 操作 | 命令 |
|------|------|
| 启动 | `./start.sh` |
| 停止（保留数据） | `./stop.sh` |
| 升级 | `./update.sh` |
| 备份 | `./backup.sh` |
| 恢复 | `./restore.sh backups/v2ex-20260101-120000.sql.gz` |
| 查看日志 | `docker compose logs -f app` |
| 查看状态 | `docker compose ps` |
| 进入数据库 | `docker compose exec postgres psql -U v2ex -d v2ex` |

---

## 故障排查

**1. 服务起不来 / 一直不健康**

```bash
docker compose ps          # 看容器状态
docker compose logs -f app # 看应用日志（最常见的入口）
docker compose logs -f postgres
```

**2. 端口被占用**

```
[错误] 端口 3000 已被占用。
```

改 `APP_PORT`（并同步改 `APP_URL` / `NEXT_PUBLIC_APP_URL`）：

```bash
sed -i 's/^APP_PORT=.*/APP_PORT=8080/' .env
sed -i 's|^APP_URL=.*|APP_URL=http://localhost:8080|' .env
sed -i 's|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=http://localhost:8080|' .env
./start.sh
```

**3. 拉取镜像失败（网络）**

镜像托管在 GitHub Container Registry。若所在网络无法直连 `ghcr.io`，
可自行配置镜像加速器，或手动拉取后改用本地镜像：

```bash
docker pull <你的镜像仓库>/v2ex-clone:v0.0.9
# 然后把 .env 里的 V2EX_IMAGE 改成该镜像名
```

**4. 忘记管理员密码**

重置为新的随机口令（容器内跑一次性命令，不改数据卷）：

```bash
docker compose exec app node node_modules/tsx/dist/cli.mjs scripts/admin-cli.ts reset-password --username admin
```

**5. 磁盘不足**

```bash
docker system df        # 查看占用
docker system prune -a  # 清理无用镜像与构建缓存（不影响数据卷）
```

---

## 卸载

卸载分两步，**第二步不可逆**：

```bash
# 第一步：停止并移除容器（保留数据卷）
docker compose down

# 第二步：删除数据卷（**永久删除所有数据，无法恢复**）
docker compose down -v
```

如果不确定是否还要保留数据，**只做第一步**即可 ——
数据卷仍在，日后 `docker compose up -d` 可完整恢复。

最后清理安装包残留：

```bash
rm -rf backups INSTALL_CREDENTIALS.txt .env
```

---

## 安全建议

- [ ] **立即修改管理员初始密码**（登录后 → 设置 → 密码）
- [ ] `.env` 与 `INSTALL_CREDENTIALS.txt` 切勿提交到版本库或上传到公开位置
- [ ] 对外提供服务前，在前置 Nginx / Caddy 上启用 HTTPS
- [ ] 定期运行 `./backup.sh` 并把备份**存到另一台机器**（同盘备份不算备份）
- [ ] 保持 `APP_RUNTIME_ENV=production`（否则验证码行为会改变）
- [ ] 数据库与 Redis **不对宿主机暴露端口**，请不要手动给它们加 `ports:` 映射

---

## 许可证与第三方声明

本项目采用 [MIT 许可证](LICENSE)，并附有独立的**商标声明**：

- 本项目**不是** V2EX 官方产品，与 V2EX 官方**无任何关联**
- "V2EX" 及其标识是 V2EX 及其权利人的商标
- MIT 许可证仅覆盖源代码与文档，**不授予**任何商标或品牌标识的使用许可
- 本项目**不包含** V2EX 官方站点的 HTML / CSS / JavaScript 副本、
  官方品牌图片或用户数据
- 仓库中的图标与 Logo 为独立绘制的等价实现

**第三方组件**：本项目使用了 Next.js、React、PostgreSQL、Redis、Drizzle ORM、
ioredis、bcryptjs、jose、marked、zod 等开源组件，各自遵循其原始许可证。

---

<div align="center">

**V2EX Clone v0.0.9** — 独立技术研究项目 · 早期开发预览版

*Not affiliated with, endorsed by, or associated with V2EX.*

</div>
