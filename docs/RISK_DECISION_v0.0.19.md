# v0.0.19 风险裁决与公开发布授权（RISK_DECISION）

> **本文件只对 v0.0.19 有效，不可复用、不可推定、不适用于任何其它版本。**
>
> 记录时间：2026-11-21（GMT+8）
> 项目：V2EX Clone（https://github.com/alicia1030su/v2ex-clone）
> 裁决人：**项目所有者**（仓库 owner：`alicia1030su`）
> 裁决来源：项目所有者在本次会话中下达的**正式稳定版全自主发布总任务书**（书面指令）。
> 本文件由工程侧按原文转录，未增删结论、未代拟授权。

---

## 裁决原文（关键节选）

> ### 决策 A：A3
>
> 保留历史，持续强化披露。R-01 维持 DEFERRED。
>
> 我知悉历史第三方素材风险仍然存在，本版接受该风险尚未消除的事实。
> A3 不代表取得第三方素材使用许可，不允许把历史风险写成 FIXED。

> ### 决策 B：B1
>
> 我明确授权 v0.0.19 公开发布为 Stable Release。
>
> 在通过全部必要门禁后，允许创建一次 annotated `v0.0.19` Tag、推送正式 GHCR 镜像、
> 创建非预发布的 GitHub Release、上传正式 ZIP 和 SHA256SUMS，并完成发布后独立验收。
>
> 本次授权仅限 v0.0.19，不延续到后续版本。

---

## 机器可校验的结构化裁决

> ⚠️ 下面这段 JSON 是**唯一**的机器事实来源。
> `scripts/release/verify-risk-decision.mjs` 只读它，不从正文关键词猜结论。

<!-- RISK-DECISION-FIELDS -->

```json
{
  "schema": "v2ex-clone-risk-decision/v1",
  "version": "v0.0.19",
  "decision_a": "A3",
  "decision_b": "B1",
  "public_release_authorized": true,
  "scope": "single-version",
  "one_time": true,
  "authorized_by": "project-owner:alicia1030su",
  "authorized_at": "2026-11-21",
  "r01_status": "DEFERRED",
  "allowed_operations": [
    "create-annotated-tag",
    "push-tag",
    "push-ghcr-image",
    "create-public-release",
    "create-public-stable-release",
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
    "destroy-production-data",
    "bypass-branch-protection",
    "lower-security-or-test-thresholds"
  ]
}
```

## 决策 A · A3（保留历史 + 强化披露）

| 项 | 内容 |
|---|---|
| 决策编号 | **A3** |
| 含义 | 保留现有 Git 历史并继续强化披露；不改写、不 force push、不移动或删除既有 Tag |
| 已知风险 | R-01：早期 Git 历史中仍可访问的第三方素材风险 |
| 当前状态 | **DEFERRED（未修复）** |
| 明确不成立的说法 | 保留 + 披露不构成素材授权，不等于 R-01 已修复，也不等于取得任何素材使用许可 |

## 决策 B · B1（授权 v0.0.19 公开发布）

| 项 | 内容 |
|---|---|
| 决策编号 | **B1** |
| 适用范围 | **仅 v0.0.19**；`scope = single-version`，`one_time = true` |
| 发布形态 | **稳定版（Stable Release）** —— `prerelease=false`、`draft=false` |
| 生效前提 | 本版本全部必要发布门禁通过；任一门禁失败则本授权不适用，发布必须停止 |
| 不延伸范围 | 不授权 v0.0.20 或任何后续版本；不授权链上充值、钱包登录、代币交易等排除功能 |

## 授权允许的操作

1. 创建**一次** `v0.0.19` annotated Git Tag。
2. 将该 Tag 正常推送到 GitHub。
3. 构建并公开发布推送 `ghcr.io/alicia1030su/v2ex-clone:v0.0.19`。
4. 创建**公开的 GitHub Stable Release**（`prerelease=false`、`draft=false`）。
5. 上传正式部署 ZIP 与 `SHA256SUMS`。
6. 完成发布后匿名下载、安装、升级与业务验收。
7. 正常更新 README、CHANGELOG 与发行状态文档（通过新提交，不移动 Tag）。

## 授权禁止的操作

1. 远端历史改写。
2. `force push`。
3. 移动或删除任何既有 Tag。
4. 覆盖或修改既有 Release。
5. 修改仓库可见性。
6. 破坏生产数据。
7. 绕过分支保护。
8. 降低安全扫描和测试阈值。
9. 以本授权为理由扩张到 v0.0.19 以外的任何版本。

## R-01 持续风险（发布后仍然存在）

| 项 | 状态 |
|---|---|
| 历史第三方素材 | **仍存在于 Git 历史**，可被克隆取得 |
| 清理动作 | **本轮未执行** |
| 风险性质 | 法律/合规风险，不是工程 bug；技术清理无法消除第三方已下载、已缓存或已 fork 的内容 |
| 后续版本 | 每个版本必须单独裁决；本文件对 v0.0.20 及以后无效 |

## 审计与不可替代声明

- 本文件的结构化字段才是机器判定依据；正文仅作人类可读说明。
- 若 `version` 字段与实际发布版本不一致，`verify-risk-decision.mjs` 必须拒绝。
- 本文件不得由自动化流程补写结论；工程侧只能转录已经存在的书面裁决。
- 本文件不修改、不弱化任何其它安全与合规门禁。
- **当前发行源码和产物仍须独立通过素材、敏感信息和安全扫描；发现新的重大合规阻断必须停止公开分发。**
