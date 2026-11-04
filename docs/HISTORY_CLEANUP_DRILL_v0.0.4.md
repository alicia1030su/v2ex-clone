# Git 历史清理 —— 隔离副本演练报告

> 生成时间：2026-11-04 15:02:04
> **本演练未触碰远端**：无 force push、无删远端 Tag、无改 Release、无改可见性。

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

## 产物位置

- 清理后的隔离副本：`_backups/history-drill/clean-repo/`
- 本报告：`_backups/history-drill/REPORT.md`

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
