# Git 历史清理 —— 隔离副本演练报告

> 生成时间：2026-11-04 15:02:04（v0.0.4 验收核查后补证据：2026-11-04）
> **本演练未触碰远端**：无 force push、无删远端 Tag、无改 Release、无改可见性。

> ⚠️ **产物位置勘误（v0.0.4 验收核查 D-11）**：本报告最初写的 `_backups/history-drill/`
> 是**相对仓库根**的路径，容易被误读为「仓库内目录」。实际产物在**仓库外**
> `C:/Users/TYMO001/WorkBuddy/ai/_backups/history-drill/`，因此**不会**被 git 跟踪、
> 也不会出现在 `docs/evidence/` 下 —— 这是刻意的：演练副本含完整改写后的历史，
> 不应进入主仓库。下方「产物位置」给出绝对路径与复核命令。

## 基线

| 项 | 值 |
|---|---|
| 全引用对象数（清理前） | 1118 |
| 含原站素材的提交数 | 0 |
| 受影响的远端引用 | master、v0.0.1、v0.0.2、v0.0.3、3 个分支（**全部**包含 75c9508） |

## 移除的路径

- `docs/evidence/assets/`（原站 combo.css / combo.js）
- `docs/evidence/html/`（原站完整 HTML 快照，46 个文件）

合计 **48 个受版权保护的第三方文件**。

## 执行方式

```
git filter-branch --force \
  --index-filter 'git rm -r --cached --ignore-unmatch docs/evidence/assets docs/evidence/html' \
  --prune-empty --tag-name-filter cat -- --all
```

随后清除 reflog 与悬空对象（`reflog expire` + `gc --prune=now`）。

## 结果

| 项 | 值 |
|---|---|
| 全引用对象数（清理后） | 1083 |
| 减少的对象数 | 35 |
| 仍引用原站素材的提交数 | **0** |
| 清理后 master 提交数 | 24 |
| 清理后 Tag | v0.0.1 v0.0.2 v0.0.3  |

## 产物位置与可复核证据（v0.0.4 补齐）

**绝对路径（仓库外）**：`C:/Users/TYMO001/WorkBuddy/ai/_backups/history-drill/`

| 产物 | 路径 | 用途 |
|---|---|---|
| 清理后的 bare 副本 | `.../history-drill/clean-repo/` | `git filter-branch` 的结果 |
| 演练时的工作副本 | `.../history-drill/work/` | 执行清理的临时裸克隆 |
| 构建验证副本 | `.../history-drill/build-test/` | 从 clean-repo clone 出工作树做 `tsc` |
| 原始演练报告 | `.../history-drill/REPORT.md` | 本文件的来源 |

### 实跑复核（2026-11-04，命令与真实输出）

| 复核项 | 命令 | 结果 |
|---|---|---|
| 原站素材文件数 | `git ls-tree -r --name-only 75c9508 \| grep -cE '^docs/evidence/(html\|assets)/'` | **48**（46 HTML + 2 assets：combo.css / combo.js） |
| 3 个 Tag 的 SHA 变化 | `git rev-parse <tag>^{}` 在两仓库分别执行 | v0.0.1 `94cc132`→`789d407`；v0.0.2 `4488e7f`→`40533d9`；v0.0.3 `9af3b89`→`4dbb1ac` |
| 清理后文件清单完整性 | `diff <(原仓库 ls-tree master) <(clean-repo ls-tree master)` | **差异 0 行**，298 个文件全部保留 |
| 清理后功能可用性 | `cd build-test && npx tsc --noEmit` | **exit=0，零错误** |
| 原站素材是否仍可达 | `git ls-tree -r --name-only master \| grep -cE 'docs/evidence/(html\|assets)/'` | **0** |

**关于文件数的口径**：历史提交 `75c9508` 里有 **46 个 HTML + 2 个 asset = 48**；
`RISK_REGISTER` 的 R-03 曾写 47、验收核查在当前工作区数到 47 HTML + 2 assets = 49，
差异来自后续新增/删除的快照文件。以**历史提交 `75c9508` 的 48** 为准
（清理针对的是历史对象，不是当前工作区）。

**关于「含原站素材的提交数」**：基线表的 `0` 指「清理**后**」；`RISK_REGISTER` R-01
的「2 → 0」指清理前有 **2 个提交**引入/修改了这些文件、清理后为 0。两者不矛盾。

## 若要真正执行（**需主人单独授权**）

在远端执行以下命令 —— **每一步都会改写远端历史**：

```bash
# 1. 备份（务必先做）
git clone --mirror git@github.com:alicia1030su/v2ex-clone.git ../v2ex-clone-backup.git

# 2. 改写
cd v2ex-clone.git
git filter-branch --force \
  --index-filter 'git rm -r --cached --ignore-unmatch docs/evidence/assets docs/evidence/html' \
  --prune-empty --tag-name-filter cat -- --all

# 3. 清理悬空对象
git for-each-ref --format='%(refname)' refs/original | xargs -n1 git update-ref -d
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 4. 强制推送所有引用（**不可逆**）
git push --force --mirror origin
```

## 重要提醒

1. **force push 会让所有已 clone 的副本失效** —— 其他贡献者需要重新克隆。
2. **已发布的 Release 会失效** —— v0.0.1 / v0.0.2 的 Release 指向的 commit
   会变成不可达，GitHub 的 Release 页面可能出现异常。**v0.0.3 的 Draft Release
   同理**（任务明确要求不动它）。
3. **GitHub 的「缓存」**：即使改写历史，已被缓存/被爬取的内容可能仍可访问
   （GitHub 会在一段时间后清理，但**不保证**立即生效）。
4. **PR #1～#4 的引用**：改写历史后，这些 PR 的 diff 会变化，需要确认。
5. 建议先在**演练副本**上完整验证（本次已做），再对远端执行。
