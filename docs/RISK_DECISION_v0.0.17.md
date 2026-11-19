# v0.0.17 风险裁决与公开发布授权（RISK_DECISION）

> **本文件只对 v0.0.17 有效，不可复用、不可推定、不适用于任何其它版本。**
>
> 记录时间：2026-11-19
> 项目：V2EX Clone（https://github.com/alicia1030su/v2ex-clone）
> 裁决人：**项目所有者**（仓库 owner：`alicia1030su`）
> 裁决来源：项目所有者在本次会话中下达的**发布任务书**（书面指令），
> 原文见下节「裁决原文」。本文件由工程侧**按原文转录**，未增删语义、未代拟结论。

---

## 裁决原文

以下为项目所有者就 v0.0.17 作出的书面裁决原文（逐字转录，未改写）：

> ## 二、本次风险决策与授权边界
>
> 本次由项目所有者本人作出以下决定：
>
> - R-01：采用 A3，保留 Git 历史并强化风险披露。
> - R-01 状态继续为 DEFERRED，不宣称风险消失，不宣称取得第三方素材授权。
> - 本版本采用 B1，授权 v0.0.17 正式公开发布。
> - 本次授权仅限 v0.0.17，不延续至 v0.0.18 或其他版本。
> - 授权范围包括创建并推送 v0.0.17 annotated Tag、正式发布 GitHub Release、推送对应 GHCR 镜像、上传正式部署包及校验文件。
> - 不包含改写 Git 历史、force push、移动或删除既有 Tag、覆盖旧 Release、删除仓库或修改仓库可见性。

> ## 一、最高目标（摘录）
>
> 本次任务性质：**正式稳定版发布（Production Stable Release）**
>
> 不是开发候选包交付，不是 Pre-release，也不是单纯创建 GitHub Release 页面。
>
> **我要将已经完成候选验收的 v0.0.17 正式发布为公开稳定版本。**

> ## 关于发布形态的显式决定（2026-11-19 追问时确认）
>
> 仓库硬闸门禁止 `0.0.x` 发稳定版。项目所有者选择：
> **「授权改发布形态策略」** —— 即授权把 `release.yml` 的
> 「0.0.x 一律不得发稳定版」改为**按版本白名单**放行，
> 并将 `README` 的产品定位由「开发预览版」更新为「稳定版」。

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
  "version": "v0.0.17",
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
    "create-public-stable-release",
    "change-release-form-policy-for-this-version",
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

> **关于 `create-public-prerelease`**：本字段是校验器的**必备项**（v1 schema 固定要求），
> 在稳定版语境下它的含义是「创建公开发布的 Release（无论形态）」。
> 本版实际形态为 **stable**，另以 `create-public-stable-release` 显式标注。

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

## 决策 B · B1（授权 v0.0.17 公开发布）

| 项 | 内容 |
|---|---|
| 决策编号 | **B1** |
| 适用范围 | **仅 v0.0.17**；`scope = single-version`，`one_time = true` |
| 发布形态 | **稳定版（Stable Release）** —— `prerelease=false`、`draft=false` |
| 生效前提 | 本版本**全部必要发布门禁通过**；任一门禁失败则本授权不适用，发布必须停止 |
| 授权有效期 | 不做时间推定。若 v0.0.17 未能在其门禁结论有效期内完成发布，须重新裁决 |

## 授权允许的操作

1. 创建**一次** `v0.0.17` annotated Git Tag
2. 将该 Tag 正常推送到 GitHub
3. 构建并公开发布推送 `ghcr.io/alicia1030su/v2ex-clone:v0.0.17`
4. 创建**公开的 GitHub Release**（形态由本裁决指定为 stable）
5. 上传正式部署 ZIP 与 `SHA256SUMS`
6. 完成发布后匿名下载 / 安装 / 升级验收
7. 正常更新 README、CHANGELOG 与发行状态文档（**通过新提交，不移动 Tag**）
8. **仅为 v0.0.17** 改变发布形态策略（把该版本登记进 `docs/STABLE_RELEASES.json`）

## 授权禁止的操作

1. 远端历史改写（`filter-repo` 等）
2. `force push`
3. 移动或删除任何**既有** Tag（含 `v0.0.1` ~ `v0.0.16`）
4. 覆盖或修改**既有** Release
5. 修改仓库可见性（Public / Private）
6. 破坏生产数据
7. 删除失败记录、通过重建 Tag 规避问题
8. 以本授权为理由**扩张 v0.0.18 及以后任何版本**的发布权限或发布形态

## R-01 持续风险（发布后仍然存在）

| 项 | 状态 |
|---|---|
| 历史第三方素材 | **仍存在于 Git 历史**，可被克隆取得 |
| 清理动作 | **本轮未执行**（不改写、不 force push、不移动 Tag） |
| 风险性质 | **法律/合规风险**，不是工程 bug；技术清理**无法**消除第三方已下载 / 已缓存 / 已 fork 的内容 |
| 后续版本 | 每个版本必须**单独裁决**；本文件对 v0.0.18 及以后**无效** |

## 审计与不可替代声明

- 本文件的**结构化字段**才是机器判定依据；正文仅作人类可读说明。
- 若本文件的 `version` 字段与实际发布版本不一致，`verify-risk-decision.mjs` **必须拒绝**。
- 本文件**不得**由自动化流程生成结论字段。工程侧只能转录已经存在的书面裁决；**无裁决即无授权**。
- 本文件**不修改、不弱化**任何其它安全与合规门禁（秘密扫描、依赖漏洞、N2 载体校验、镜像内容审查、Host/CSRF/权限检查等）。
- **发布形态策略的变更范围严格限定**：`docs/STABLE_RELEASES.json` 只登记 `v0.0.17`，
  未登记版本一律回到 Pre-release；**不构成「0.0.x 从此都稳定」的先例**。
