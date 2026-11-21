## __VERSION____FORM_SUFFIX__

__FORM_NOTICE__

### 关于本项目

本项目是对 `https://www.v2ex.com/` 的**技术研究与高保真界面还原实验**，
与 V2EX 官方**无任何关联**、**未获官方授权**、**不是** V2EX 官方产品。
MIT 许可证**不授予** V2EX 商标使用许可。

### __VERSION__ 更新内容

__CHANGELOG_SECTION__

### 功能清单

- **账号**：注册、登录、退出、会话保持（HttpOnly / SameSite=Lax /
  Secure 条件启用）、修改密码、邮箱找回密码（链接仅取可信配置 Origin）
- **用户**：个人主页、头像上传（magic number 校验 / 服务端生成路径 /
  2MB 上限 / sharp 像素上限）、关注、收藏
- **节点**：列表、详情、子节点树、创建（管理员直生效 / 版主待审）、审核
- **主题**：发布、列表、详情、浏览计数、Markdown 渲染、标签、
  投票（顶/踩）、软删除、锁定、置顶
- **回复**：无刷新发布、草稿保护、Ctrl/Cmd+Enter、真实父子回复关联、
  经典平铺 / 引用条 / 角标预览 / 楼中楼 / 树形缩进 / 对话连线 / 引用楼层七种阅读模式、
  跨页按需父链、图片选择 / 拖拽 / 粘贴插入
- **主题**：Light / Dark / System 三态，登录用户服务端保存，游客本地保存
- **互动**：感谢（thank）、收藏、通知、关注
- **积分**：签到、积分流水账本、排行榜
- **搜索**：主题搜索
- **RSS**：节点 / 首页 Feed
- **后台管理**：概览、待审、日志、节点审批、举报处理、封禁、角色变更
- **权限**：user / moderator / admin 三级角色
- **安全**：CSRF 防护、XSS 清洗、限流（登录 / 发帖 / 回复 / 创建节点 /
  上传）、开放重定向防护、安全响应头、Host Header 不可信
  （`fail-closed`，邮件链接只信 `PUBLIC_BASE_URL` / `APP_URL`）、
  服务端 SVG 验证码（哈希存储、一次性）
- **可观测性**：结构化 JSON 日志（stdout，敏感字段脱敏）、
  进程内指标窗口（真实状态码分布 / 5xx、4xx 按路由聚合 / 慢请求）、
  `/api/admin/ops` 运维端点
- **存储**：PostgreSQL 17 持久化（Drizzle 迁移），Redis 可选
  （缺失自动降级为 PgKV）
- **部署**：Docker 多阶段镜像 + Compose 三阶段启动
  （迁移 → 首次初始化 → 启动），含备份 / 恢复 / 更新脚本

### 已知限制（如实标注；不影响安装，但使用前请阅读）

- **私信**：未实现
- **真实 SMTP 邮件投递**：未在发布流程中实测（需运维配置 SMTP）
- **多浏览器视觉回归**：常规 CI 只跑 Chromium；Firefox / WebKit 由
  `e2e-matrix.yml` 专项矩阵覆盖。**WebKit 是移植构建，不等同真实 Safari**，
  结论不得外推
- **原站需登录页面对照**：无权访问他人账号，未拿游客态冒充登录态
- **指标窗口为进程内聚合**：多实例部署各进程一份，需集中式日志系统
  才能跨实例聚合
- **版主 / 管理员的部分操作为 API 层验证**，UI 点击流覆盖不完整
- **原站旧版 API**：不宣称完全兼容；已下线 / 无法验证的端点在
  `docs/LEGACY_API_MATRIX_v0.0.13.md` 逐项披露

### 安装

**Linux / macOS**
```bash
unzip v2ex-clone-__VERSION__-deploy.zip -d v2ex-clone-__VERSION__-deploy
cd v2ex-clone-__VERSION__-deploy/deploy
chmod +x install.sh
./install.sh
```

**Windows（PowerShell）**
```powershell
Expand-Archive -Path v2ex-clone-__VERSION__-deploy.zip -DestinationPath v2ex-clone-__VERSION__-deploy
cd v2ex-clone-__VERSION__-deploy\deploy
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装完成后访问 <http://localhost:3000>。
安装脚本会生成随机的数据库口令、Redis 口令与会话密钥，
并把管理员凭据写入 `INSTALL_CREDENTIALS.txt`（权限 600）。

**从上一已发布版本升级**（在**现有安装目录**执行；新解压的发行包没有 `.env`）：

```bash
cd <你现有的 V2EX Clone 部署目录>
./backup.sh
./update.sh --version __VERSION__
```

`update.sh` 会保留数据卷、自动改写 `.env` 的 `V2EX_IMAGE`、拉取目标镜像并在失败时回滚。
升级 / 备份 / 恢复的**本版本实测口径**见 `docs/release-facts.json`
的 `upgrade` 段、本版本 CI 产物与发布后官方资产升级验收；历史版本的迁移数与指纹数只是当时的记录，
**不得冒充本版结论**。

**回滚**：

```bash
cd <你现有的 V2EX Clone 部署目录>
./restore.sh <备份文件>   # 先恢复数据
./update.sh --version <回滚目标版本>
```
回滚到更早版本需配合对应版本的部署包；数据卷不随 `stop` / `update.sh`
删除，但 `docker compose down -v` 会**永久删除**数据，操作前必须备份。

### 系统要求

- Docker 20.10 或更高
- Docker Compose v2
- 至少 2 GB 可用磁盘
- 端口 3000 未被占用

### 镜像

```
ghcr.io/alicia1030su/v2ex-clone:__VERSION__
```
匿名可直接拉取（Public 包）。本次发布流水线实测的镜像 Digest：

```
__DIGEST__
```

可用 `docker image inspect ghcr.io/alicia1030su/v2ex-clone:__VERSION__`
或匿名 Registry V2 的 `Docker-Content-Digest` 响应头独立复核。

### 稳定性验证的真实状态（不冒充、不夸大）

| 项目 | 状态 | 说明 |
|---|---|---|
| 单元测试 | ✅ 通过 | 由**本次发布流水线**的「运行单元测试」步骤实跑；结果见本 run 的 `unit-test-results` artifact，数量以该报告为准 |
| E2E | ✅ 通过 | 由**本次发布流水线**的「运行 E2E」步骤实跑（Chromium）；结果见本 run 的 E2E 日志，数量以该报告为准 |
| 安全审计（Host Header / 依赖 / 秘密扫描） | ✅ 通过 | high/critical 阻断门禁 |
| 候选安装链路（Docker 真实安装） | ✅ 通过 | ubuntu runner 实跑 |
| 上一已发布版本 → __VERSION__ 原地升级 | ✅ 通过 | 由本版本候选 CI 的双基线升级 job 实跑；基线与真实断言数见 `docs/release-facts.json` 的 `upgrade` 段，不沿用历史版本数字 |
| 备份 → 恢复 | ✅ 通过 | 与双基线升级同一 job 内完成恢复库指纹比对；失败原子性另由候选四角色验收覆盖 |
| **1 小时持续运行** | ✅ **通过** | 真实运行 3600 秒 = 目标 |
| **24 小时持续运行** | ⬜ **未完成** | 见下方说明 |

**关于 24 小时持续运行的如实说明**：

GitHub-hosted runner 的**单个 job 最长只能运行 6 小时**，
「单 job 跑 24 小时」在架构上不可能完成。v0.0.9 已将长跑改为
**串行分段**（每段 ≤ 5 小时，累计真实运行时长由 artifact 传递），
并为每段与汇总设置**时长诚实性闸门**（实际秒数达不到目标即判红）。

本版本发布时，24 小时分段验证**尚未完成** —— 它被明确列为
**后续稳定性验证项**，不构成本次发布的技术阻断（已如实记录为
一次性发布门禁例外）。任何「24 小时验证通过」的声称都必须引用
**累计实际运行秒数**，配置时长不等于实际时长。
已真实完成的是上表所列的 **1 小时持续运行**验证。

### ⚠️ R-01 授权遗留项披露（历史合规风险，尚未根治）

| 项 | 说明 | 状态 |
|----|------|------|
| **原站第三方素材曾进入历史提交** | 早期开发阶段为做界面还原，从 `v2ex.com` 抓取的 HTML / CSS / JS / 截图进入了 **Git 历史**，**共 68 个**（`assets` 2 / `html` 46 / `ref-*` 10 / `diff-*` 10）。历史报告中「81 个」是**证据文件总数**（含本站自有的 `local-*.png` 与测量 JSON），不是第三方素材数 | 已核实 |
| **当前主分支已不再包含相应素材** | 实测当前 `master` 树中 `ref-*.png` / `diff-*.png` / `combo.css` / `combo.js` **零命中** | 已核实 |
| **旧 Tag 和部分历史引用仍可能使它们可访问** | 匿名实测：**分支 6/39、Tag 4/9、PR ref 8/53** 仍指向含素材的提交；用**完整 commit SHA** 可匿名取回（200），用 Tag 名取同一文件返回 404 ⇒ **删 Tag 不能消除可达性**；克隆仓库即可取得；**改写历史也无法消除已下载 / 已缓存的副本** | **仍然存在** |
| **历史风险尚未根治** | 清理需改写远端历史（`filter-repo` + force push），属高风险不可逆操作，且会让 9 个 Tag 的 SHA 全部改变（其中 6 个已发布）；且改写**无法消除**第三方已下载 / 已缓存的内容。本版裁决为**保留历史 + 强化披露**（不改写、不移动 Tag） | **DEFERRED** |
| **本轮没有执行历史改写或 force push** | 未执行任何远端历史改写、force push、Tag 删除或重建、Release 修改、仓库可见性变更；`refs/pull/N/head` 是 GitHub 只读衍生引用，**仓库方无法删除** | 已核实 |
| **本版本的新代码、安装包及镜像经过独立扫描** | gitleaks 秘密扫描 + npm audit（high/critical 阻断）+ 镜像内容审查：安装包只含 `deploy/`（15 个文件），镜像 runner 层的 `COPY` 白名单不含 `docs/` 且只含 5 个运行期脚本，均不含受影响素材与测试凭据 | 已核实 |
| **风险接受按版本单独作出** | 此前某版本的一次性风险接受**不构成 __VERSION__ 的授权**；本版本公开发布须在完整披露 R-01 的前提下单独确认 | 本版本已单独确认（见下条） |
| **本版本是否已获授权** | 发布前须由项目所有者对**本版本**单独作出风险决策与公开发布授权（决策 A3 保留+披露 / 决策 B1 授权发布），裁决记录入库为 `docs/RISK_DECISION___VERSION__.md`。⚠️ **本表不预写结论**：授权状态由 preflight 的「授权文件存在性」步骤按实际文件判定 —— 若文件不存在，preflight 直接中止，本 Notes 不会被生成 | 见 preflight 校验结果 |
| **保留与披露不等于风险消失** | 本声明**不构成**素材版权证明，**不视为** R-01 已修复，**也不等于**取得任何素材使用许可；后续版本仍需单独裁决 | **DEFERRED** |

> 最近一次完整审计报告（v0.0.15）见仓库 `docs/R01_COMPLIANCE_REVIEW_v0.0.15.md`；
> 长期风险登记见 `RISK_REGISTER.md` 的 R-01 条目；
> 本版本裁决记录见 `docs/RISK_DECISION___VERSION__.md`。
> 本声明**不试图**通过文字取得素材版权或实现清除。

### 安全提示

- **安装后请立即登录并修改管理员密码。**
- 不要在公网环境使用默认端口 3000，建议通过反向代理并启用 HTTPS。
- 调试端点（`/api/debug/*`）在生产部署中默认关闭
  （`ENABLE_DEBUG_ENDPOINTS=0`），且需要独立令牌才能访问。
- `docker compose stop` 与 `update.sh` **不会**删除数据卷；
  `docker compose down -v` 会**永久删除**数据，请务必先备份。

### 灰度期观测与回滚判定

> 适用条件：本版本对外分发 / 部署后启用。观测基线与回滚触发条件见
> `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md` §8（端点 5xx 率、搜索 / 节点
> 列表 API 延迟 p95、写路径错误率、楼层号连续性、积分账本自洽、
> 鉴权边界、会话与封禁、镜像可拉取性、远端状态共 9 项）。

### 许可证

MIT（附商标声明与第三方内容声明），详见安装包内的 `LICENSE`。
