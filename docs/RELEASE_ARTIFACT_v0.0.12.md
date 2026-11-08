# v0.0.12 发布资产报告（已公开发布）

> 发布形态：**Pre-release（开发预览版）**
> 发布页：<https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.12>
> 源码基线 SHA：**`21102f2be4daa258415d21bbb49b340b38c3db8d`**
> 发布流水线：run `42476453152` —— **11/11 job 全部 success**

---

## 一、Release 资产

| 资产 | 大小 | SHA256 |
|---|---|---|
| `v2ex-clone-v0.0.12-deploy.zip` | 143,358 B | `852e2f0f54bf97160a75a9a35f3b6b36a1558ce72afba8b1a862fa75295037cd` |
| `SHA256SUMS` | 96 B | — |

**匿名下载实测**（不带任何凭据）：两个资产均 `HTTP 200`；下载后本地复算
SHA256 = `SHA256SUMS` 里的值，**逐字节一致**。

## 二、镜像

| 项 | 值 |
|---|---|
| 标签 | `ghcr.io/alicia1030su/v2ex-clone:v0.0.12` |
| **Digest** | `sha256:ebbe56451de6c8a16d88fc5f542337a6c6ce84df32c8cedad3686070cc3d76cd` |
| 匿名拉取 | 经 `ghcr.io/token` 换取匿名 token 后 `HTTP 200`（`Docker-Content-Digest` 响应头即上表值） |

> 说明：`curl https://ghcr.io/v2/.../manifests/v0.0.12` **裸访问会返回 401** ——
> 这是 OCI Distribution 规范要求先换取 token，不代表包不可匿名拉取。
> 已发布的 v0.0.4 / v0.0.9 裸访问同样是 401，换 token 后同样 200。

## 三、产物逐项核验（对**下载到的官方包**解压后实测）

| 判据 | 实测 |
|---|---|
| 顶层目录 | `deploy/` ✅ |
| `deploy/VERSION` | `0.0.12` ✅ |
| 7 个 `.sh` 解压后的磁盘权限（未预先 chmod） | 全部 `-rwxr-xr-x` ✅ |
| 全部文本文件是否含 CRLF | **0 个** ✅ |
| `deploy/README.md` 首行 | `# V2EX Clone v0.0.12 — 一键部署包` ✅ |
| `deploy/INSTALL.md` 首行 | `# V2EX Clone v0.0.12 — 详细安装与运维文档` ✅ |
| `deploy/install.sh` 的 `APP_VERSION` | `"0.0.12"` ✅ |
| `deploy/.env.example` 的 `V2EX_IMAGE` | `ghcr.io/alicia1030su/v2ex-clone:v0.0.12` ✅ |
| 包内 `# V2EX Clone vX.Y.Z` 头部注释 | **全部为 v0.0.12**（12 个文件） ✅ |

## 四、可复现构建（本轮修正后**真正成立**）

同一份 `deploy/` 内容，排序修复前后：

| 构建位置 | 修复前 | 修复后 |
|---|---|---|
| 本地 Windows | `935557e8…` | **`852e2f0f…`** |
| CI ubuntu | `852e2f0f…` | `852e2f0f…` |
| 是否逐字节相同 | ❌（条目顺序不同） | ✅ |

修复前「固定时间戳 ⇒ 可复现」的宣称**不成立** —— 固定时间戳只解决一半，
ZIP **条目顺序**也是字节的一部分，而 `readdirSync` 的顺序随文件系统而变。
`walk()` 加按名排序后，任何人在任何平台重打都能得到同一 SHA256。

## 五、发布流水线各 job 结果

| # | Job | 结果 |
|---|---|---|
| 1 | 解析版本锚点（tag → commit） | ✅ |
| 2 | 前置检查（版本冲突检测） | ✅ |
| 3 | 安全扫描（依赖 + 秘密） | ✅（走 API 备用通道，见 V10-18） |
| 4 | 代码检查（类型 + 构建） | ✅ |
| 5 | 单元测试 | ✅ |
| 6 | E2E 测试 | ✅ |
| 7 | 构建并推送镜像 | ✅ |
| 8 | 部署验证（启动 + 重启持久化） | ✅ |
| 9 | 生成安装包 | ✅ |
| 10 | 创建并发布 Release | ✅ |
| 11 | 远端核验（Release 与资产） | ✅ |

## 六、独立复核命令

```bash
# 1. 匿名下载并核 SHA256（不要信本文件里的数字，自己算）
curl -sSLO https://github.com/alicia1030su/v2ex-clone/releases/download/v0.0.12/SHA256SUMS
curl -sSLO https://github.com/alicia1030su/v2ex-clone/releases/download/v0.0.12/v2ex-clone-v0.0.12-deploy.zip
sha256sum -c SHA256SUMS

# 2. 解压前就能看权限
unzip -Z v2ex-clone-v0.0.12-deploy.zip | grep '\.sh$'
# 期望每行以 -rwxr-xr-x 开头

# 3. 解压后确认没有预先 chmod
unzip -q v2ex-clone-v0.0.12-deploy.zip -d /tmp/v12 && ls -l /tmp/v12/deploy/*.sh

# 4. 确认无 CRLF
grep -rlU $'\r' /tmp/v12/deploy/ || echo "无 CRLF"

# 5. 版本载体
cat /tmp/v12/deploy/VERSION                   # 0.0.12
head -1 /tmp/v12/deploy/README.md             # # V2EX Clone v0.0.12 — 一键部署包
grep -n 'APP_VERSION=' /tmp/v12/deploy/install.sh

# 6. 镜像匿名拉取（必须换 token，裸访问 401 是规范行为）
TOKEN=$(curl -s "https://ghcr.io/token?scope=repository:alicia1030su/v2ex-clone:pull" | jq -r .token)
curl -sS -D- -o /dev/null -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/vnd.oci.image.index.v1+json' \
  https://ghcr.io/v2/alicia1030su/v2ex-clone/manifests/v0.0.12 | grep -i docker-content-digest
```

## 七、本版**未**证明的事（如实披露）

| 项 | 状态 |
|---|---|
| 在真实 Linux + Docker 上 `./install.sh` 跑通 | CI 的 `Linux + 真实 Docker 安装` job **通过**（工作区版本）；对**这份 ZIP 字节**的端到端安装未单独复跑 |
| 24 小时持续运行 | **UNVERIFIED**（仅 1 小时分段通过） |
| 移动端 meta 换行、运营标识视觉影响 | **UNVERIFIED** |
| Windows 安装脚本在真实 Windows 上的执行 | CI `windows-latest` 覆盖语法与路径，未做完整交互式安装 |
