# v0.0.16 风险裁决与公开发布授权（RISK_DECISION）

> ⚠️ **本文件是给【人工审计】读的裁决记录，不是构建输入。**
> 依据：`.dockerignore` 未排除 `docs/`，且 `Dockerfile` 有 `COPY . .`
> ⇒ 本文件会进入**构建上下文**（builder 阶段），但 v0.0.16 之前如此、
> 本文件亦如此，**不构成新增的发行面变化**；最终 runner 层只 `COPY`
> 白名单（`public/` `.next` `package.json` `drizzle` 5 个运行期脚本），
> **不含 `docs/`**。此证用于说明「新增本文件不会把素材或凭据带进镜像」。
>
> **本文件只对 v0.0.16 有效，不可复用、不可推定、不适用于任何其它版本。**
>
> 记录时间：2026-11-19
> 项目：V2EX Clone（https://github.com/alicia1030su/v2ex-clone）
> 裁决人：**项目所有者**（仓库 owner：`alicia1030su`）
> 裁决来源：项目所有者在本次交付会话中以**书面指令**作出的明确决定，原文见下节
> 「裁决原文」。本文件由工程侧**按原文转录**，未增删语义、未代拟结论。

---

## 裁决原文

以下为项目所有者就 v0.0.16 作出的书面裁决原文（逐字转录，未改写）：

> ## 一、本版本专项裁决
>
> 我作为项目所有者，对 v0.0.16 单独作出如下决定：
>
> **决策 A：A3，保留现有 Git 历史并继续强化披露。**
>
> 我知悉 R-01 历史版权风险仍然存在，早期第三方素材可能继续通过 Git 历史、旧引用或缓存访问。
>
> 我接受本版在该风险尚未解决的情况下发布，但该决定不代表素材已经获得授权，不代表风险已修复，也不适用于未来版本。
>
> **决策 B：B1，授权 v0.0.16 公开发布。**
>
> 在本版本所有必要发布门禁通过的前提下，我明确授权：
>
> - 创建一次 v0.0.16 annotated Git Tag。
> - 将该 Tag 正常推送到 GitHub。
> - 构建并公开推送 v0.0.16 GHCR 镜像。
> - 创建公开的 GitHub v0.0.16 Pre-release。
> - 上传正式部署 ZIP 和 SHA256 校验文件。
> - 完成发布后匿名下载、安装和升级验收。
> - 正常更新 README、CHANGELOG 与发行状态文档。
>
> 以上是仅限 v0.0.16 的一次性授权。
>
> 继续禁止远端历史改写、force push、移动或删除既有 Tag、覆盖旧 Release、修改仓库可见性，以及破坏生产数据。

---

## 机器可校验的结构化裁决

> ⚠️ 下面这段 JSON 是**唯一**的机器事实来源。
> `scripts/release/verify-risk-decision.mjs` 只读它，**不**从上面的正文里
> 用关键词猜结论 —— 「正文里出现 B1」与「B1 是有效授权」是两件事。
> 反向句、引述、假设、历史说明都可能让正文出现 B1，但它们都不是授权。

<!-- RISK-DECISION-FIELDS -->

```json
{
  "schema": "v2ex-clone-risk-decision/v1",
  "version": "v0.0.16",
  "decision_a": "A3",
  "decision_b": "B1",
  "public_release_authorized": true,
  "scope": "single-version",
  "one_time": true,
  "authorized_by": "project-owner:alicia1030su",
  "authorized_at": "2026-11-19",
  "r01_status": "DEFERRED",
  "allowed_operations": [
    "create-annotated-tag",
    "push-tag",
    "push-ghcr-image",
    "create-public-prerelease",
    "upload-deploy-zip-and-sha256",
    "post-release-anonymous-verification",
    "update-release-docs"
  ],
  "forbidden_operations": [
    "rewrite-remote-history",
    "force-push",
    "move-or-delete-existing-tag",
    "overwrite-existing-release",
    "change-repository-visibility",
    "destroy-production-data"
  ]
}
```

---

## 决策 A · A3（保留历史 + 强化披露）

| 项 | 内容 |
|---|---|
| 决策编号 | **A3** |
| 含义 | **保留现有 Git 历史，继续强化披露**；不改写、不清理、不 force push |
| 已知风险 | R-01：早期为界面还原从 `v2ex.com` 抓取的 HTML / CSS / JS / 截图曾进入 Git 历史（**68 个**第三方素材；「81」是含本站自有证据文件的总数） |
| 可达面 | 匿名实测：分支 6/39、Tag 4/9、PR ref 8/53 仍指向含素材的提交；**完整 commit SHA 取文件返回 200**，用 Tag 名取同一文件返回 404（⇒ **删 Tag 解决不了可达性**）；`refs/pull/N/head` 是 GitHub 只读衍生引用，仓库方无法删除 |
| 当前发行产物 | 正式部署 ZIP 只含 `deploy/`；GHCR 镜像构建上下文不含 `docs/`，`COPY` 白名单只含 5 个运行期脚本 ⇒ **两者均不含受影响素材** |
| 状态 | **DEFERRED（未修复）** |
| 明确不成立的说法 | 保留 + 披露 **不构成** 素材授权，**不等于** R-01 已修复，**不等于**取得任何素材使用许可 |

## 决策 B · B1（授权 v0.0.16 公开发布）

| 项 | 内容 |
|---|---|
| 决策编号 | **B1** |
| 适用范围 | **仅 v0.0.16**；`scope = single-version`，`one_time = true` |
| 生效前提 | 本版本**全部必要发布门禁通过**；任一门禁失败则本授权不适用，发布必须停止 |
| 授权有效期 | 不做时间推定。若 v0.0.16 未能在其门禁结论有效期内完成发布，须重新裁决 |

## 授权允许的操作

1. 创建**一次** `v0.0.16` annotated Git Tag
2. 将该 Tag 正常推送到 GitHub
3. 构建并公开发布推送 `ghcr.io/alicia1030su/v2ex-clone:v0.0.16`
4. 创建公开的 GitHub `v0.0.16` **Pre-release**（非稳定版）
5. 上传正式部署 ZIP 与 `SHA256SUMS`
6. 完成发布后匿名下载 / 安装 / 升级验收
7. 正常更新 README、CHANGELOG 与发行状态文档（**通过新提交，不移动 Tag**）

## 授权禁止的操作

1. 远端历史改写（`filter-repo` 等）
2. `force push`
3. 移动或删除任何**既有** Tag（含 `v0.0.1` ~ `v0.0.15`）
4. 覆盖或修改**既有** Release
5. 修改仓库可见性（Public / Private）
6. 破坏生产数据
7. 删除失败记录、通过重建 Tag 规避问题
8. 以本授权为理由**扩张 v0.0.17 及以后任何版本**的发布权限

## R-01 持续风险（发布后仍然存在）

| 项 | 状态 |
|---|---|
| 历史第三方素材 | **仍存在于 Git 历史**，可被克隆取得 |
| 清理动作 | **本轮未执行**（不改写、不 force push、不移动 Tag） |
| 风险性质 | **法律/合规风险**，不是工程 bug；技术清理**无法**消除第三方已下载 / 已缓存 / 已 fork 的内容 |
| 后续版本 | 每个版本必须**单独裁决**；本文件对 v0.0.17 及以后**无效** |

## 审计与不可替代声明

- 本文件的**结构化字段**才是机器判定依据；正文仅作人类可读说明。
- 若本文件的 `version` 字段与实际发布版本不一致，`verify-risk-decision.mjs` **必须拒绝**（防止把上一版的裁决挪用到新版本）。
- 本文件**不得**由自动化流程生成结论字段。工程侧只能转录已经存在的书面裁决；**无裁决即无授权**，缺文件时必须中止发布，绝不允许「补写一份」。
- 本文件**不修改、不弱化**任何其它安全与合规门禁（秘密扫描、依赖漏洞、N2 载体校验、镜像内容审查、Host/CSRF/权限检查等），它们照常独立生效。
