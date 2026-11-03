# 安全例外登记表（SECURITY_EXCEPTIONS）

> 项目：V2EX Clone
> 本轮：全项目缺陷清零与安全加固（v0.0.2）
> 建表时间：2026-11-04
> 维护者：部署运维工程师（devops-engineer）
>
> **本表只登记「已评估、决定接受、且有到期日」的风险。**
> **已修复的问题不在这里** —— 修复记录见 [`../CHANGELOG.md`](../CHANGELOG.md) 与
> [`../RISK_REGISTER.md`](../RISK_REGISTER.md)。
>
> 判定规则：例外必须写明「为什么可接受」的**可复核证据**，
> 而不能只写「风险可接受」。到期日到期未复核 ⇒ **视为新的阻断项**。

---

## E-01 npm audit 曾残留的 4 个 moderate 漏洞 ✅ **已修复（非例外）**

> 本条目**已闭环**，保留在此是为了留痕：它证明这些漏洞不是被「降级扫描等级」藏起来的。

| 维度 | 内容 |
|---|---|
| **风险** | `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild@0.18.20`（GHSA-67mh-4wv8-2f99） |
| **原严重度** | moderate × 4（critical=0 / high=0） |
| **处置** | **实修** —— `overrides` 把 `@esbuild-kit/core-utils` 下的 `esbuild` 钉到 `^0.25.0`，实际解析为 **0.25.12**（> 0.24.2 即修复） |
| **当前状态** | `npm audit` = **0 漏洞**（critical / high / moderate / low 全为 0） |
| **扫描等级是否被降低** | ❌ **否**。发布流水线的门禁规则一个字未改（critical > 0 或 high > 0 即中止发布） |
| **状态** | **CLOSED —— 真修复** |

### 修复后的验证证据（2026-11-04 实测）

| 验证项 | 命令 | 结果 |
|---|---|---|
| 漏洞数归零 | `npm audit --json` | `{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}` |
| lockfile 可复现 | `npm ci` | 成功，113 包 |
| 迁移工具链未损坏 | `npx drizzle-kit generate` | 正常输出 18 张表，EXIT=0 |
| **迁移能力未损坏** | `npx drizzle-kit migrate` | 对本地库真实执行迁移成功，EXIT=0 |
| 类型检查 | `npx tsc --noEmit` | 0 错误 |
| 单元测试 | `npx vitest run` | **103/103 全绿** |
| 生产构建 | `npx next build` | Compiled successfully |
| 无探针残留 | `git status` / `drizzle/` | 仅 `0000_init.sql`，无 `devops_override_probe` |

---

## E-02 Git 历史中的原站版权素材 ⚠️ **待主人授权，非本轮可解**

| 维度 | 内容 |
|---|---|
| **风险** | 原站 V2EX 的 HTML / CSS / JS 完整副本与像素级参考截图，经 Git 历史对**所有匿名访问者**开放 |
| **为什么可接受（暂）** | 彻底清理需**改写全部 refs 历史**或**移动已发布的 `v0.0.1` tag** —— 二者均属明令禁止的操作，未获授权前不得执行 |
| **可复核证据** | 当前 HEAD 文件树中 A/B/C 三类原站素材对象计数**均为 0**（已逐目录核验）；`.dockerignore` 与 `.gitignore` 均已完整排除 `docs/evidence/{html,assets,screenshots,visual}/`；发布流水线的「发布包内容安全检查」会在打包前拦截任何原站素材 |
| **残余风险** | 历史对象仍可经 `raw.githubusercontent.com` 匿名取回。**已被实际下载过**（zip 3 次 / SHA256SUMS 4 次），匿名 raw 访问不产生计数 |
| **到期日** | **2026-12-04**（一个月内必须由主人裁决） |
| **到期未裁决的后果** | 视为 **v0.0.3 的阻断项**；且**不阻断 v0.0.2** —— v0.0.2 是新增版本，不会新增暴露面 |
| **责任人** | 仓库主人（需单独授权改写历史或移动 tag） |
| **状态** | **DEFERRED —— 等待授权** |

---

## E-03 未完成的长期运行验证 ⚠️ **持续有效**

| 维度 | 内容 |
|---|---|
| **风险** | v0.0.2 仍未做压力测试、长时间运行稳定性验证、备份恢复自动化演练 |
| **为什么可接受** | v0.0.2 定位为**开发预览版（Pre-release）**，文档已明确「不建议用于生产环境」；CI 每次发布都真实跑「构建 → 启动 → 健康检查 → 重启不污染数据」 |
| **可复核证据** | CI 的 `docker` job 与 `deploy-verify` job；`docs/DEPLOYMENT.md` §13「已知限制」逐条披露 |
| **到期日** | **2026-12-04**（与 E-02 同批复核） |
| **状态** | **ACCEPTED —— 预览版定位下可接受** |

---

## E-04 Actions 缓存中的构建产物 ⚠️ **持续有效**

| 维度 | 内容 |
|---|---|
| **风险** | GitHub Actions 缓存中可能残留 buildkit 中间层（builder 阶段的 `COPY . .` 上下文） |
| **为什么可接受** | 实测镜像最终层只拷 `.next` / `node_modules` / `drizzle` / `scripts` / `src/db` / `src/lib/password.ts`，**不含 `docs/`**；根 `.dockerignore` 已完整排除 `docs/evidence/*`、`*.tar.gz`、`*.zip`、`*.sql`、`_backups`、`.git`、`.env*` |
| **可复核证据** | `git ls-files docs/evidence` 的 45 个受版本控制的文件，**100%** 落在 `.dockerignore` 的四条 evidence 排除规则内（未覆盖数 = 0，已实测） |
| **残余风险** | buildkit 中间层缓存理论上含完整工作区；清理需 `gh cache delete`，属**远端写操作**，本轮禁止 |
| **到期日** | **2026-12-04** |
| **状态** | **MONITORED** |

---

## E-05 镜像体积与 USER 的本机不可验证项 ⚠️ **已声明**（2026-11-04 已大幅缩小范围）

| 维度 | 内容 |
|---|---|
| **风险** | Dockerfile 的「非 root 运行（`USER nextjs`）」与「**最终镜像**字节数」**本机无法实测** —— 开发机上**没有 Docker** |
| **为什么可接受** | `USER nextjs` 位于 Dockerfile 的**最后一条指令**之前、`ENTRYPOINT` 之前，语义上确定生效；CI 的 `docker` job 会在真实 Docker 环境构建并启动该镜像，构建失败或启动失败都会让流水线红灯 |
| **可复核证据** | CI `docker` job 的「构建镜像」+「compose 真实启动 + 健康检查」两步；发布流水线 `build-image` job 的「核验镜像不含敏感文件」会真实 `docker run` 该镜像 |
| **本轮已把残余风险大幅缩小**（2026-11-04 实测） | 此前「若 `npm ci --omit=dev` 裁掉了 entrypoint 需要的包，本机发现不了」这一条**已不再成立** —— 本机用**真实 `npm ci --omit=dev`** 装出生产闭包后，**实际执行**了：<br>· `drizzle-kit migrate` ✓ 18 张表<br>· `tsx` 跑 `scripts/seed.ts` ✓ 完成（9 分类 / 1 用户 / 23 节点 / 10 主题）<br>· `next build` ✓ Compiled successfully<br>· `next start` + 真实数据库：`/` `/signin` `/signup` `/nodes` `/api/captcha` `/t/1` **全部 200**，日志 `MODULE_NOT_FOUND` 计数 **0**<br>· `npm audit --omit=dev` → **found 0 vulnerabilities**<br>· 依赖体积 429 MB →（删 playwright-core 后）**411 MB** |
| **仍未验证的残余** | ① **最终镜像的字节数**（含 `.next` 112 MB + base 层 + alpine 基础镜像）<br>② **容器内 `USER nextjs` 的实际运行效果**（本机无 Docker）<br>③ `playwright-core` 被显式删除后，**若 next 将来把它变成运行时必需**，会在启动时炸 —— 已加**防回归护栏**（Dockerfile 断言三个 entrypoint 路径，失败则构建当场红灯） |
| **到期日** | **2026-11-11**（v0.0.2 发布前，CI 必须绿） |
| **状态** | **DEFERRED TO CI —— 必须在 v0.0.2 发布前由 CI 证实**（范围已缩小到「镜像字节数」与「容器内 USER 实测」两项） |

---

## 复核指引

到期日到期时，本表任一条目若仍为 `DEFERRED` / `ACCEPTED`：

1. 重新执行该条目的「可复核证据」列出的核验命令；
2. 证据仍成立 → 续期，并把到期日往后推一个周期，在本表记录续期理由；
3. 证据不再成立 → 转为**阻断项**，加入 `RISK_REGISTER.md` 并阻塞发布。

**新增例外的门槛**：必须同时具备 ① 可复核证据（命令 + 实测输出）② 明确到期日 ③ 责任人。
三者缺一，不得登记。
