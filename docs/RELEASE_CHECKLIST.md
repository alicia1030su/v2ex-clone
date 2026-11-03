# RELEASE_CHECKLIST — v0.0.1 发布检查清单

> **发布版本**：`v0.0.1`（开发预览版 / Pre-release）
> **发布日期**：2026-11-03
> **发布形式**：GitHub Release（prerelease，非 draft）+ GitHub Container Registry 镜像 + 一键部署安装包
>
> 本清单是**逐项人工确认表**。每一项都必须**实际执行过**并确认结果，
> 不允许「应该没问题」式的勾选。
> 任何一项为 `[ ]` 未勾选时，**不得**发布。

---

## 0. 发布前置条件

- [ ] 已获得**发布授权**（本次发布的明确许可）
- [ ] 已确认目标分支为 `master`，且工作区干净（`git status` 无未提交改动）
- [ ] 已确认 CI 在目标提交上**全绿**（类型检查 / 单元 / E2E / Docker 四个环节）
      —— `.github/workflows/ci.yml` 有 **3 个 job**：`unit`（类型检查 / 单元测试）、
      `e2e`（E2E 测试）、`docker`（Docker 构建与启动验证）
- [ ] 已确认 `package.json` 的 `version` 字段为 `0.0.1`
- [ ] 已确认 `deploy/VERSION` 内容为 `0.0.1`
- [ ] 已确认本次发布**不包含**任何未经授权的远端写操作

---

## 1. 代码质量

### 1.1 类型检查与构建

- [ ] `npx tsc --noEmit` **零错误**
- [ ] `npx next build` **成功**（生产构建，无警告阻断）
- [ ] 构建产物 `.next/` 已生成，且 `public/` 目录在镜像中存在（`COPY` 空目录会失败）

### 1.2 单元测试

- [ ] `npm run test:unit` → **Test Files 7 passed / Tests 103 passed**
- [ ] 单元测试覆盖服务端安全逻辑（验证码一次性、运行时开关限制、HTML 清洗、redirect 规范化），
      且**不依赖** `DISABLE_CAPTCHA` 等运行时开关
- [ ] `npm run test:unit` 的实际输出用例数与 README / CHANGELOG 中写的数字**一致**

### 1.3 E2E 测试

- [ ] `npx playwright test --list` → **Total: 67 tests in 6 files**
- [ ] `LOCAL_BASE=http://localhost:3000 npm run test:e2e` → **67/67 通过，零跳过**
- [ ] E2E 覆盖了关键路径：注册登录退出、权限、节点创建与审核、发帖、回复、分页、收藏、通知、搜索、越权、限流
- [ ] 并发回复用例通过（楼层号不重复）

### 1.4 完整验证流程

- [ ] `./scripts/verify.sh` 全绿（类型检查 → 构建 → 干净库迁移 → seed → 单元 → E2E）
- [ ] `./scripts/verify.sh` 在**全新克隆副本**中从零执行一遍也全绿
- [ ] 验证库隔离生效：脚本拒绝在非 `*_verify` / `*_test` / `*_ci` 库上执行破坏性操作

### 1.5 安全扫描

> ⚠️ **现状说明**：`.github/workflows/ci.yml` 目前只有 **3 个 job**
> （类型检查 / 单元测试、E2E 测试、Docker 构建与启动验证），
> **没有**专门的安全扫描 job（无 Trivy / Snyk / CodeQL）。
> 下面的安全扫描项**必须由发布人手工执行**。

- [ ] `npm audit --audit-level=high` 无 high / critical 级别未处理漏洞（或已记录并说明可接受性）
- [ ] 代码中**无硬编码密钥**（口令、token、API key、连接串）
- [ ] 调试端点默认关闭：`ENABLE_DEBUG_ENDPOINTS` 默认 `0`，`DEBUG_ENDPOINT_TOKEN` 默认空
- [ ] `DISABLE_CAPTCHA` / `TEST_ENV_ISOLATED` 在生产与预发环境下**确实被忽略**（已实测，不是靠推断）
- [ ] 发行包的 `docker-compose.yml` 中 `ENABLE_DEBUG_ENDPOINTS` / `DEBUG_ENDPOINT_TOKEN` /
      `DISABLE_CAPTCHA` / `TEST_ENV_ISOLATED` 已**硬编码为关闭状态**
      （即 `.env` 里的同名变量进不到容器）

---

## 2. 内容安全

> 目标：仓库中**不包含** V2EX 官方的受保护素材、任何真实凭据或个人信息。

### 2.1 原站素材

- [ ] `docs/evidence/html/` **不在** Git 文件树中
- [ ] `docs/evidence/assets/` **不在** Git 文件树中
- [ ] 原站参考截图 `ref-*.png`（30 个）**不在** Git 文件树中
- [ ] 差异热力图 `diff-*.png` **不在** Git 文件树中
- [ ] `.gitignore` 的规则使用 `**/` 前缀，能覆盖任意深度的视口子目录
      （gitignore 的 `*` **不跨越目录分隔符** —— 这是已修复过的真实缺陷，务必复查）
- [ ] README 与文档中引用的截图**全部是 `local-*.png`**（我方产出），无一处引用 `ref-*` 或 `diff-*`
- [ ] 已抽查 README 中每张引用图片的路径确实存在（`ls` 逐一确认）

### 2.2 凭据与配置

- [ ] `.env` **不在** Git 文件树中
- [ ] `.env.local` / `.env.test` / `.env.prod-verify` **不在** Git 文件树中
- [ ] `.env.example` 中**无任何可用的默认口令**（所有敏感项默认为空）
- [ ] `docker-compose.yml` 中必需变量缺失时**容器直接启动失败**，而不是带弱口令运行
- [ ] 仓库中**无真实凭据**（数据库口令、Redis 口令、session secret、管理员口令）
- [ ] CI 配置中的凭据均为**一次性临时值**（`ci-postgres-password-not-real` 之类），无真实价值

### 2.3 个人信息

- [ ] 仓库中**无个人信息**（真实姓名、邮箱、手机号、真实用户数据）
- [ ] 演示账号（`lisi` / `wangwu` / `zhaoliu` / `moderator`）为**虚构**账号，
      且只在非生产环境创建
- [ ] 截图 `local-*.png` 中不含真实用户数据（内容来自 seed 演示数据）

### 2.4 第三方代码

- [ ] 依赖清单（`package.json`）与 lockfile 一致，无来历不明的二进制依赖
- [ ] `LICENSE` 中的 `THIRD-PARTY CONTENT` 声明与**实际文件树状态一致**
      （不声称"历史中已移除"，除非历史清理确已执行 —— 见第 6 节）

---

## 3. 制品

### 3.1 一键部署安装包

- [ ] 产物文件名为 `v2ex-clone-v0.0.1-deploy.zip`
- [ ] 压缩包内文件清单完整（**13 个发布文件**）：

  ```
  v2ex-clone-v0.0.1-deploy/
  ├── docker-compose.yml
  ├── .env.example
  ├── install.sh          （可执行位已设置）
  ├── install.ps1
  ├── start.sh            （可执行位已设置）
  ├── stop.sh             （可执行位已设置）
  ├── update.sh           （可执行位已设置）
  ├── backup.sh           （可执行位已设置）
  ├── restore.sh          （可执行位已设置）
  ├── README.md
  ├── INSTALL.md
  ├── VERSION             （内容为 0.0.1）
  ├── LICENSE
  └── .dockerignore
  ```

- [ ] 压缩包内**不含**以下运行时产物与开发辅助文件：
      `.env`、`INSTALL_CREDENTIALS.txt`、`backups/`、`.test-shim-docker.sh`、
      `node_modules/`、`.git/`
- [ ] `install.sh` 具备**可执行位**（`chmod +x install.sh`，并确认 zip 保留了权限位）
- [ ] `bash -n install.sh` 语法检查通过
- [ ] `bash -n start.sh stop.sh update.sh backup.sh restore.sh` 语法检查通过
- [ ] `install.ps1` 通过 PowerShell 解析检查（`[System.Management.Automation.Language.Parser]::ParseFile` 无错误）
- [ ] `docker compose -f docker-compose.yml config` 渲染通过（不报缺变量）
- [ ] `docker-compose.yml` 中的镜像为 `ghcr.io/alicia1030su/v2ex-clone:v0.0.1`（或已确认本地构建路径）
- [ ] `.dockerignore` 存在且内容合理
- [ ] 安装包内的 `INSTALL.md` 中出现的**每条命令**都真实可用
      （特别核对：不得出现 `admin-cli.ts reset-password` 这类**不存在的子命令** ——
      实际可用的是 `set-password` / `set-role` / `list-admins`）

### 3.2 校验和

- [ ] 已生成安装包的 **SHA256** 校验和
- [ ] 校验和文件（`SHA256SUMS`）随 Release 一起上传
- [ ] 已**本地复核**：对下载回来的安装包执行 `sha256sum -c` 校验通过
- [ ] 校验和值已记录在发布记录中（便于事后核对）

### 3.3 容器镜像

- [ ] 镜像 `ghcr.io/alicia1030su/v2ex-clone:v0.0.1` 构建成功
- [ ] 已记录镜像 **digest**（`docker inspect --format='{{index .RepoDigests 0}}'`）
- [ ] digest 已写入发布记录
- [ ] 镜像内**不含** `.env`、源码里的敏感文件、`.git` 目录
- [ ] 镜像内 `public/` 目录存在
- [ ] 镜像以**非 root 用户**运行（`nextjs`）
- [ ] 镜像的 entrypoint 走三阶段启动（迁移 → 首次初始化 → 启动）

### 3.4 镜像拉取实测

- [ ] 在**干净环境**（无本地镜像缓存）执行 `docker pull ghcr.io/alicia1030su/v2ex-clone:v0.0.1` 成功
- [ ] 拉取成功说明该 GHCR 包已可**匿名拉取**（即包可见性为 public）

---

## 4. 远端状态

> ⚠️ 本节涉及远端写操作，**每一项都必须在获得明确授权后才执行**。

### 4.1 Tag

- [ ] tag `v0.0.1` 已创建，指向**正确**的提交
- [ ] 已核对：`git rev-parse v0.0.1` 与预期的发布提交 SHA 一致
- [ ] tag 为**附注 tag**（annotated），包含变更说明
- [ ] tag **未**在任何发布后被移动或删除（tag 不可移动 —— 这是发布不可变性的基础）

### 4.2 Release

- [ ] Release **存在**，标题为 `v0.0.1`
- [ ] Release 的 `prerelease` 标志为 **true**（v0.0.1 是开发预览版，**不能**标记为正式发布）
- [ ] Release 的 `draft` 标志为 **false**（draft 的 Release 对外不可见）
- [ ] Release 正文包含：版本定位（开发预览版）、功能完成度、**未实现功能清单**、
      已知缺陷、**独立非官方声明**
- [ ] Release 正文**不含**「完全复刻」「100% 一致」「生产可用」等表述
- [ ] 资产（assets）已上传：`v2ex-clone-v0.0.1-deploy.zip`、`SHA256SUMS`
- [ ] 资产**可匿名下载**（未登录状态点击链接能成功下载）
- [ ] 安装包解压后 `install.sh` 权限位正确

### 4.3 仓库设置

- [ ] 仓库可见性已确认为 **public**（或已明确记录为 private 并同步调整安装说明）
- [ ] 仓库描述中包含"独立非官方项目"字样
- [ ] 仓库 About / README 首屏包含醒目的独立非官方声明
- [ ] 未设置任何指向 V2EX 官方的仓库链接、social preview 图或描述

---

## 5. 文档

### 5.1 README

- [ ] README 包含用户明确要求的 **10 项**内容：
  - [ ] ① 项目简介（一句话说清是什么）
  - [ ] ② 紧跟项目简介的**醒目独立非官方声明**
  - [ ] ③ 当前版本 **v0.0.1**，标注「开发预览版 / Pre-release」，
        并写明「不保证与 V2EX 完全一致」
  - [ ] ④ **已实现**功能表格（真实清单）
  - [ ] ⑤ **未实现**功能表格（明确写「本版本未实现」）
  - [ ] ⑥ 页面截图（4~6 张，**全部为 `local-*.png`**）
  - [ ] ⑦ 一键部署说明（Linux `./install.sh` / Windows `powershell -ExecutionPolicy Bypass -File .\install.ps1`）
        + 下载地址
  - [ ] ⑧ 系统要求（Docker 20.10+、Compose v2、2 GB 磁盘、3000 端口）
  - [ ] ⑨ 下载入口（Release 链接 + 安装包名 `v2ex-clone-v0.0.1-deploy.zip`）
  - [ ] ⑩ 许可证（MIT + 商标声明 + 第三方内容声明）
  - [ ] ⑪ 独立非官方项目声明（**独立区块**，不在页脚）
  - [ ] ⑫ 已知缺陷（**≥ 6 条**真实已知缺陷）
- [ ] README 保留了原有的技术栈、功能矩阵表、目录结构、开发命令、本地开发与测试说明
- [ ] README 中所有内部链接指向的文件**确实存在**（`docs/*.md` 逐个核对）
- [ ] README 中引用的每张截图**确实存在**（`ls` 逐一核对）
- [ ] README 未使用「完全复刻」「100% 一致」「生产可用」「已完全清理历史」等表述

### 5.2 CHANGELOG

- [ ] `CHANGELOG.md` 存在，采用 **Keep a Changelog** 格式，中文
- [ ] 遵循语义化版本，链接到 <https://semver.org/lang/zh-CN/>
- [ ] 含 `[0.0.1] - 2026-11-03` 条目
- [ ] 条目开头标注「早期开发预览版（Pre-release），不建议用于生产环境」
- [ ] 分节齐全：新增 / 修复 / 安全 / 已知限制 / 不包含
- [ ] 内容**真实反映**本项目实际做过的事（未夸大、未编造）
- [ ] 「不包含」小节明确列出全部未实现功能
- [ ] **不含**「完全复刻」「100% 一致」「生产可用」等表述

### 5.3 INSTALL

- [ ] `docs/INSTALL.md` 存在，章节完整：
  - [ ] 概述与两种安装方式对比表
  - [ ] 系统要求表格
  - [ ] 一键安装（Linux/macOS 与 Windows 各一步骤 + **预期输出示例**）
  - [ ] 手动 Docker Compose 安装（完整 YAML + `.env` 生成命令）
  - [ ] 安装后验证
  - [ ] 配置项说明表（变量名 / 默认值 / 是否必填 / 说明 / 安全建议）
  - [ ] 常用运维命令
  - [ ] 升级流程（**强调不删数据卷**）
  - [ ] 数据备份与恢复（含实际命令）
  - [ ] 卸载流程（**明确警告 `down -v` 会删卷**）
  - [ ] 故障排查（**≥ 8 个**真实场景，每个给症状 + 原因 + 解决命令）
  - [ ] 安全清单（部署后必做 5 项）
  - [ ] FAQ
- [ ] INSTALL 中的**每一条命令**都在实际环境中跑过（或与 `deploy/` 中的脚本真实行为一致）
- [ ] 预期输出示例与 `install.sh` / `install.ps1` 的**实际输出文案一致**

### 5.4 DEPLOYMENT

- [ ] `docs/DEPLOYMENT.md` 已更新为 v0.0.1 发布版
- [ ] 写明镜像地址 `ghcr.io/alicia1030su/v2ex-clone:v0.0.1`
- [ ] 含环境分层（development / test / staging / production）与各自允许/禁用的开关
- [ ] 含生产部署检查清单
- [ ] 含密钥管理说明（`.env` 不入库、secrets manager）
- [ ] 含数据库备份策略与**恢复演练**要求
- [ ] 含监控与日志（`docker compose logs`、healthcheck）
- [ ] 含回滚方案，且**明确说明 tag 不可移动**
- [ ] 已知限制中写明 GHCR 匿名拉取需包为 public

---

## 6. 授权边界确认

> ⚠️ **本节中的项若未获授权，一律标记为「待授权」，绝不能勾选为已完成。**

### 6.1 Git 历史改写

- [ ] **【待授权 · 本次未执行】** Git 历史改写（`git filter-repo` / `filter-branch`）**未执行**
- [ ] **【待授权 · 本次未执行】** 未使用任何 `--force` / `--force-with-lease` 推送
- [ ] **【待授权 · 本次未执行】** 未删除任何远端分支或 tag
- [ ] 已在文档中如实说明当前状态：
      **当前 HEAD 的文件树中已无原站素材，但 Git 历史中仍可取回**
      （清理方案与演练记录属仓库维护者的内部记录，未随本版本公开）
- [ ] 确认文档中**没有**任何「已完成历史清理」「原站素材已从历史移除」的表述

> **事实记录**：本次发布**未执行**任何历史改写。历史改写是不可逆的高风险操作，
> 需要单独授权。方案已制定并在副本上完整演练验证，但**未在主仓库执行**。

### 6.2 远端写操作授权

- [ ] 已获得**创建 tag** 的授权
- [ ] 已获得**创建 GitHub Release** 的授权
- [ ] 已获得**推送镜像到 GHCR** 的授权
- [ ] 已获得**推送到 `master`** 的授权
- [ ] 若本次仅做本地提交（不推送），已确认所有远端项标记为「待执行」

### 6.3 制品与素材边界

- [ ] 安装包内**不含**原站 HTML / CSS / JS
- [ ] 安装包内**不含** `ref-*.png` / `diff-*.png`
- [ ] 安装包内**不含** `.env`、`.git`、本地测试产物
- [ ] 镜像层中同样**不含**上述内容（已用 `docker history` / 解包检查确认）

---

## 7. 发布后验证

- [ ] 匿名用户可访问 Release 页面并下载安装包
- [ ] 匿名用户可 `docker pull` 到镜像
- [ ] 在**全新机器 / 全新目录**按 `docs/INSTALL.md` 的步骤走一遍，部署成功
- [ ] 部署后访问首页、注册账号、发帖、回复、登录管理后台，全部正常
- [ ] `docker compose restart app` 后数据未被污染（管理员口令未变、主题数未变）
- [ ] `docker compose down`（**不带 `-v`**）后 `docker compose up -d` 数据仍在
- [ ] 已将本次发布的版本号、提交 SHA、镜像 digest、SHA256、发布时间记录到发布记录中

---

## 8. 签署

| 角色 | 姓名 | 日期 | 确认 |
|---|---|---|---|
| 文档 | | | ☐ |
| 开发 | | | ☐ |
| 运维 / 发布 | | | ☐ |

> **只有当第 1～7 节的所有项都已勾选（或明确标注为「待授权」且已获得对应授权）时，
> 才允许执行发布操作。**
