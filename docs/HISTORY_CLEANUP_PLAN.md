# Git 历史清理方案（P0-6）

> **状态：方案已制定并完成演练验证，尚未对主仓库与远端执行。**
> 执行历史改写需要单独授权 —— 见文末「授权与执行清单」。
> 本文档只描述*怎么做*与*做了有什么影响*，不代表已经做过。

---

## 0. 演练验证结果（已完成）

方案已在**独立副本**（`/tmp/cleanup-dryrun/repo`，由本仓库 clone 而来）
中完整跑通，**主仓库与远端均未被触碰**。

| 指标 | 清理前 | 清理后 | 结论 |
|---|---|---|---|
| A 类：原站 HTML/CSS/JS 对象 | 34 | **0** | ✅ 完全清除 |
| B 类：原站参考截图对象 | 30 | **0** | ✅ 完全清除 |
| 我方本地截图（`local-*.png`） | 30 | **30** | ✅ 未误伤 |
| 源码文件数（src/scripts/e2e/tests） | 90 | **90** | ✅ 完好 |
| 提交数 | 4 | **4** | ✅ 保留 |
| `npm ci` | — | 117 包 | ✅ 通过 |
| `npx tsc --noEmit` | — | 零错误 | ✅ 通过 |
| `npx vitest run` | — | **28/28** | ✅ 通过 |
| 耗时 | — | 1.30 秒 | ✅ 可接受 |

清理后的提交 SHA（副本内，供比对）：

```
6d8111a docs: 记录 ENV_FILE 失效的发现过程与克隆副本独立验证
ec534bb 修复 ENV_FILE 从未生效导致测试环境失效的问题
9a4f4c9 发布前审计：修复 6 项 P0 安全缺陷 + 8 项 P1 功能缺陷
f797bfd V2EX 高保真全栈复刻：逆向调查 + 实现 + 视觉还原 + E2E 验收
```

> 注：副本缺少 `.env.test`（被 `.gitignore` 排除），需自行提供后才能跑测试。
> 这是预期行为 —— 隔离测试配置本就不该入库。

**演练中发现的两点修正**：

1. `git-filter-repo` 可能不在 `PATH` 上（Windows pip 安装到
   `<python>/Scripts`，不自动加入 Git Bash 的 PATH）。
   备用调用方式：`python -m git_filter_repo ...`。
2. `filter-repo` 会**移除 `origin` remote**（官方安全设计，防止误推）。
   推送前必须 `git remote add origin ...` 重新添加。
   本方案 §4.5 已包含该步骤。

---


## 1. 为什么要清理

本仓库的初始提交 `75c9508`（2026-11-03 02:29）包含**原站 V2EX 的受保护素材镜像**。
即使这些文件已从当前 `master` 的文件树移除，它们的 **blob 对象仍留在 Git 历史里**，
任何人都可以用 `git show 75c9508:docs/evidence/html/index.html` 完整取回。

这与「不复制未获授权的第三方私有源码/商标素材」的项目原则冲突。
`.gitignore` 只能阻止*新增*，无法移除已进入历史的对象。

---

## 2. 现状盘点（基于远端 HEAD `13a4848` 实测）

### 2.1 三类待处理素材

| 类别 | 数量 | 内容 | 是否仍在 HEAD 文件树 | 是否仅存在于历史 |
|---|---|---|---|---|
| **A 类** | 48 | 原站页面 HTML（46）+ 组合 CSS/JS（2） | ❌ 已移除 | ✅ **仅在 `75c9508`** |
| **B 类** | 30 | 原站参考截图 `ref-*.png` | ✅ 仍在 | ✅ 历史 + HEAD |
| **C 类** | 0 | 差异热力图 `diff-*.png` | — | 已在 `b6230fc` 移除 |

A 类明细（`docs/evidence/html/*.html` 46 个 + `docs/evidence/assets/combo.css`、`combo.js`）。
其中 `combo.css` 单文件 147,710 字节，是原站完整样式表。

B 类明细：`docs/evidence/screenshots/{desktop-1280,desktop-1920,mobile-375}/ref-*.png`，
是原站页面的**像素级截图**，属原站视觉内容的复制品。

### 2.2 各提交中的素材数量

```
75c9508（初始提交）      81 个 evidence 文件   ← A 类 48 + B 类 30 + 3 个其他
b6230fc（安全审计修复）  75 个 evidence 文件   ← A 类已移出，剩 B 类 30 + 本地截图 45
ae15715（ENV_FILE 修复） 75 个 evidence 文件
13a4848（文档，当前 HEAD）75 个 evidence 文件
```

**结论**：A 类（48 个原站源码镜像）**只存在于 `75c9508` 这一个提交**，
在 `b6230fc` 已被 `git rm --cached` 移出文件树。
B 类（30 个原站截图）**当前 HEAD 仍在文件树里**，是本轮需要一并处理的。

### 2.3 仓库当前的其他状态

| 项 | 值 |
|---|---|
| 远端 | `https://github.com/alicia1030su/v2ex-clone` |
| 可见性 | `private` |
| 分支 | 仅 `master`（4 个提交） |
| Release | 无 |
| Tag | 无 |
| Fork | 无 |
| 协作者 | 无（单人仓库） |

---

## 3. 影响分析

### 3.1 改写历史会改变什么

| 对象 | 改写前 | 改写后 |
|---|---|---|
| `master` 的 4 个提交 SHA | `75c9508` `b6230fc` `ae15715` `13a4848` | **全部变化** |
| 克隆方式 | `git clone` | 必须用 `git clone` + 强制推送或重新 clone |
| 已有的本地克隆 | 正常工作 | **需要重新 clone 或 `git fetch` + `reset --hard`** |
| GitHub 上的 PR / Issue 链接 | 指向旧 SHA | **失效** |
| CI 历史记录 | 保留 | **关联的旧 run 仍会显示，但引用的 SHA 需重建** |
| 仓库体积 | 含 A 类 blob | **略微减小**（A 类约 1.5MB 量级） |
| 贡献者统计 | 保留 | 保留（filter-repo 默认保留 author） |
| 提交信息与日期 | 保留 | 保留 |

### 3.2 不会受到影响的

- **数据库**：本方案完全不触碰数据库。`v2ex` / `v2ex_test` / `v2ex_verify` 库不受影响。
- **其他仓库**：只操作 `alicia1030su/v2ex-clone`。
- **本机备份**：`C:\Users\TYMO001\WorkBuddy\ai\_backups\` 下的 tar.gz 备份保留不动。
- **本机工作区**：`docs/evidence/` 下的文件保留在本机（仅从 Git 移除），
  可继续用于视觉比对分析。

### 3.3 风险与不可逆性

> ⚠️ **历史改写是不可逆操作。**
> 一旦 `git push --force` 覆盖远端，旧的提交对象在 GitHub 上会被
> 「unreachable object」回收（通常有 90 天宽限期，但**不可依赖**）。
> 唯一的恢复手段是本地的完整备份。

因此执行前必须：
1. 打出带 `.git` 的完整 tar.gz 备份；
2. 在**独立副本**中先演练一遍，验证结果符合预期；
3. 得到用户明确授权。

---

## 4. 清理方案

### 4.1 步骤 0 —— 备份（必须最先执行）

```bash
# 在仓库父目录执行，保留完整 .git 历史
cd /c/Users/TYMO001/WorkBuddy/ai/
tar czf _backups/v2ex-clone-pre-history-cleanup-$(date +%Y%m%d-%H%M%S).tar.gz \
    --exclude='v2ex-clone/node_modules' \
    --exclude='v2ex-clone/.next' \
    v2ex-clone

# 校验备份可读
tar tzf _backups/v2ex-clone-pre-history-cleanup-*.tar.gz | head -5
```

> 备份中**必须包含 `.git`**，否则历史无法恢复。
> 本机已有的 `_backups/v2ex-clone-20261103-080926/` 备份**不删除**。

### 4.2 步骤 1 —— 在副本中演练

```bash
# 复制一份，绝不在主仓库直接试错
cp -a v2ex-clone /tmp/v2ex-clone-cleanup-dryrun
cd /tmp/v2ex-clone-cleanup-dryrun
```

### 4.3 步骤 2 —— 用 git-filter-repo 移除 A 类与 B 类

```bash
pip install git-filter-repo

# 一次性移除：A 类（原站 HTML/CSS/JS 副本）+ B 类（原站参考截图）
git filter-repo --force \
  --path docs/evidence/html \
  --path docs/evidence/assets \
  --invert-paths \
  --path-glob 'docs/evidence/screenshots/*/ref-*.png' \
  --invert-paths
```

说明：
- `--invert-paths` 表示「**排除**这些路径」，而不是保留。
- `--path-glob 'docs/evidence/screenshots/*/ref-*.png'` 匹配三种视口下的 ref 截图。
- `git filter-repo` 默认保留提交信息、作者、日期，并清理 `origin` remote
  （防止误 push 到未备份的远端 —— 这是它的安全设计，**必须先备份**）。

**若只想先处理 A 类、保留 B 类**（分两步走，降低单次影响面）：

```bash
# 第一步：移除原站源码副本
git filter-repo --force --path docs/evidence/html --path docs/evidence/assets --invert-paths

# 第二步（另起一次）：移除原站截图
git filter-repo --force --path-glob 'docs/evidence/screenshots/*/ref-*.png' --invert-paths
```

### 4.4 步骤 3 —— 验证清理结果

```bash
cd /tmp/v2ex-clone-cleanup-dryrun

# 1) 确认历史中已无 A 类对象
git log --all --oneline -- docs/evidence/html docs/evidence/assets | head
git rev-list --all --objects | grep -E "docs/evidence/(html|assets)/" | head
#    期望：两条命令都无输出

# 2) 确认历史中已无 B 类对象
git rev-list --all --objects | grep -E "docs/evidence/screenshots/.*/ref-" | head
#    期望：无输出

# 3) 确认本地截图（我们的产出）仍然保留
git rev-list --all --objects | grep -E "docs/evidence/screenshots/.*/local-" | wc -l
#    期望：> 0

# 4) 确认代码完好
git ls-tree -r HEAD --name-only | grep -E "^(src|scripts|e2e|tests)/" | wc -l
npx tsc --noEmit && npx next build && npx vitest run
```

### 4.5 步骤 4 —— 备份并推送

```bash
# 重新加回远端（filter-repo 会移除 origin remote）
git remote add origin https://github.com/alicia1030su/v2ex-clone.git

# 再次确认远端 URL 与备份都已就绪
git remote -v
ls -la /c/Users/TYMO001/WorkBuddy/ai/_backups/

# 强制推送（**不可逆** —— 需用户明确授权后才执行）
git push --force-with-lease origin master
```

> `--force-with-lease` 比 `--force` 安全：若远端有你不知道的新提交，
> 它会拒绝推送而不是覆盖。

### 4.6 步骤 5 —— 清理后重新验证

```bash
# 干净克隆验证
cd /tmp && rm -rf v2ex-clone-verify && git clone https://github.com/alicia1030su/v2ex-clone.git v2ex-clone-verify
cd v2ex-clone-verify
git rev-list --all --objects | grep -E "docs/evidence/(html|assets)/|screenshots/.*/ref-" | head
#    期望：无输出

npm ci && npx tsc --noEmit && npx next build && npx vitest run
```

---

## 5. 授权与执行清单

| # | 动作 | 需要的授权 | 当前状态 |
|---|---|---|---|
| 1 | 创建带 `.git` 的完整备份 | 无（纯新增，安全） | ⬜ 待执行 |
| 2 | 在副本中演练 filter-repo | 无（不触碰远端） | ⬜ 待执行 |
| 3 | 验证演练结果 | 无 | ⬜ 待执行 |
| 4 | 改写**主仓库**历史 | **需单独授权** | ⬜ 待授权 |
| 5 | `push --force-with-lease` 到远端 | **需单独授权** | ⬜ 待授权 |
| 6 | 把仓库可见性改为 public | **需单独授权** | ⬜ 待授权 |

> **本次 PR 不执行第 4~6 项。** 改写远端历史与改变仓库公开状态
> 都属于不可逆 / 面向外部的操作，必须由你逐项确认。

---

## 6. 附：为什么不能只删文件

| 手段 | 能否清除历史对象 |
|---|---|
| `.gitignore` | ❌ 只阻止新增 |
| `git rm --cached` + commit | ❌ 对象仍在历史里 |
| `git checkout --orphan` | ❌ 旧提交仍可达（直到 gc） |
| **`git filter-repo --invert-paths`** | ✅ **彻底重写所有提交** |
| `git filter-branch` | ⚠️ 可行但已被官方弃用，且更慢更易错 |

补充说明：即使不重写历史，对 `git gc --prune=now --aggressive` 也不可靠 ——
只要旧提交还被 `origin/master` 或 `reflog` 引用，blob 就不会回收。
而强制推送后远端不再引用它们，GitHub 才会把它们标记为待回收。

---

## 7. 相关文档

- `docs/AUDIT_REPORT.md` 第 7.1 节 —— 早期版本的初步说明（本文档是其展开）
- `.gitignore` —— 当前阻止新增原站素材的规则
- `tools/recon/fetch.sh` —— 重新采集原站一手证据的脚本（本机分析用，不入库）
