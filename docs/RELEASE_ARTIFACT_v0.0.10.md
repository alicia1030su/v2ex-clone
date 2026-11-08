# v0.0.10 发布候选产物报告

> 生成时间：2026-11-08
> 源码 SHA：**`23a88cf54abda28b0e677079707c71de52ce269b`**（master，PR #34 + #35 合并后）
> 状态：**候选就绪，未发布**（Tag / 镜像 / Release 均未创建）

---

## 一、产物

| 项 | 值 |
|---|---|
| 文件名 | `v2ex-clone-v0.0.10-deploy.zip` |
| 大小 | 143,345 字节 |
| **SHA256** | `2d10957fa2bffacccb443ad6a6e879184764a236557865d4025355bec5dbb2cf` |
| 文件数 | 15（顶层目录 `deploy/`） |
| 生成方式 | `node scripts/release/package-deploy-zip.mjs --version 0.0.10 --out dist` |

## 二、产物字节级核验（全部实测）

| 判据 | 结果 |
|---|---|
| 顶层目录 | `deploy/` ✅ |
| 包内 `VERSION` | `0.0.10` ✅ |
| 包内 `docker-compose.yml` 引用 | `:v0.0.10` ✅ |
| 包内 `install.sh` 的 `APP_VERSION` | `"0.0.10"` ✅ |
| 7 个 `.sh` 的 Unix mode（读 ZIP 中央目录） | 全部 `0o100755` ✅ |
| 7 个 `.sh` 是否含 CRLF | **0 个** ✅ |
| 全部 15 个文本文件是否含 CRLF | **0 个** ✅ |
| 必需文件 15 项齐全 | ✅ |
| 包内 `.env` / 凭据 / 私钥 / backups | **无** ✅ |
| 包内原站素材（ref-/diff-/combo.*） | **无** ✅ |
| 全部 `.sh` 通过 `bash -n` | ✅ |
| `SHA256SUMS` 可复算 | ✅ |

> 上述每一项都由 `scripts/release/verify-release-consistency.sh` 断言，
> 当前 **PASS=30 FAIL=0**。任一不满足即 `exit 1` 拒绝出包。

## 三、两次「产物字节与仓库不一致」的教训（本版本的核心价值）

v0.0.10 在**产物层**抓到两个同类缺陷，方向相反但根因相同：

| 缺陷 | 现象 | 为什么 CI 抓不到 |
|---|---|---|
| **V10-05 / V9-09**（脚本权限） | Git 里 `100644` → ZIP 里 `0644` → Linux 上 `./install.sh` Permission denied | CI 的安装验证用的是**工作区文件**（有 0755），从不经过 ZIP 这一段 |
| **V10-11**（换行，本轮新发现） | 本机 `core.autocrlf=true` → 工作区 CRLF → ZIP 里 CRLF → Linux 上 `/usr/bin/env: 'bash\r'` | CI 在 ubuntu runner 上检出即 LF，**永远构建不出坏包** |

两者的共性：**「发布物的字节 ≠ 仓库的权威字节」，而验证脚本用的是工作区文件。**

因此 v0.0.10 的打包器与门禁都改为**看产物本身**：

- 权限：读 ZIP **中央目录**的 Unix mode（不是解压后的磁盘位 —— Windows NTFS 没有 exec 位，
  用 `[ -x ]` 判断会永久假绿）；
- 换行：解压后逐文件检查 `\r\n`（不是信 `core.autocrlf` 的配置）；
- 版本：包内三处载体（VERSION / compose / install.sh）逐一比对。

## 四、这个产物尚未证明什么（如实披露）

| 项 | 状态 |
|---|---|
| 在真实 Linux + Docker 上 `./install.sh` 跑通 | **未在本机证明**（Docker 守护进程不可用）。CI 的 `install-verify.yml` 在 ubuntu runner 上跑工作区版本并通过；**对这份 ZIP 字节的端到端安装**需在候选环境执行 |
| GHCR 镜像 | 未构建、未推送（需 Tag 与授权） |
| 匿名下载复验 | 待 Release 后 |

**因此本报告只声称「产物字节满足全部可静态检验的判据」，**
**不声称「已在真实环境安装成功」。** 后者需要候选环境实跑，见 `RELEASE_GATE.md` K 组。

## 五、如何独立复核

```bash
# 1. 下载后先核 SHA256（不信任本文件里的数字，自己算）
sha256sum v2ex-clone-v0.0.10-deploy.zip
# 期望：2d10957fa2bffacccb443ad6a6e879184764a236557865d4025355bec5dbb2cf

# 2. 看包内权限（解压**之前**就能看）
unzip -Z v2ex-clone-v0.0.10-deploy.zip | grep '\.sh$'
# 期望每行以 -rwxr-xr-x 开头

# 3. 解压后确认**没有预先 chmod**
unzip -q v2ex-clone-v0.0.10-deploy.zip -d /tmp/v0010 && ls -l /tmp/v0010/deploy/*.sh
# 期望全部 -rwxr-xr-x

# 4. 确认无 CRLF
grep -lU $'\r' /tmp/v0010/deploy/* 2>/dev/null || echo "无 CRLF"

# 5. 版本载体
cat /tmp/v0010/deploy/VERSION                     # 0.0.10
grep -n 'APP_VERSION=' /tmp/v0010/deploy/install.sh   # APP_VERSION="0.0.10"
grep -n 'image:' /tmp/v0010/deploy/docker-compose.yml # ...:v0.0.10
```
