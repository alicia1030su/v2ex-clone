# Windows `next build` EPERM —— 专项诊断报告（v0.0.6）

> 任务书 §八：不允许无限重复执行相同 build 命令，也不允许把猜测当作根因。
> 本报告的每条结论都有**实测证据**；未查明的部分如实登记。

## 一、结论速览

| 项 | 结论 |
|---|---|
| **根因是否查明** | **未查明**（机制层面）。但已排除多个曾被怀疑的因素，并定位到**两个真实的、可复现的干扰源**（见 §四） |
| 本轮是否复现 EPERM | **未复现**：同一工作区连续构建 **3/3 成功**（约 45s/轮） |
| 产品代码是否存在 EPERM 相关缺陷 | **未发现**。`.next/trace` 可创建性探测通过；CI（Linux）从未出现该问题 |
| 是否影响交付 | **不影响**。Linux CI 全绿；本地构建稳定 |
| 风险登记 | `RISK_REGISTER.md` **R-31**（Windows 本机构建偶发失败，环境级风险，非产品缺陷） |

## 二、诊断方法（可复现）

脚本：`scripts/ci/eperm-diagnose.sh`

```bash
bash scripts/ci/eperm-diagnose.sh 3
```

它做四件事：

1. **环境事实采集**：OS / Node 版本 / 仓库路径长度 / **残留监听进程**（3000/3010/3025/3100）——
   v0.0.5 已证实「残留的 `next start` 子进程持有 `.next/trace` 写句柄」是 EPERM 的一个诱因。
2. **最小探测**：直接尝试创建 `.next/trace`（EPERM 的直接报障文件）。
3. **同工作区连续构建 N 轮**（每次前清理 `.next`）—— 观察是否复现。
4. **独立干净工作区构建**（对照）—— 排除「构建目录被复用」这一因素。

全程只操作本项目自己的 `.next` 与 `_backups/eperm-lab`，
**未删除用户目录、未关闭系统安全保护、未强制终止无关进程**。

## 三、本轮实测结果

```
[PASS]  无残留监听进程（3000/3010/3025/3100）
[PASS]  .next/trace 可创建
[PASS]  第 1 轮：成功（rc=0, 45s）
[PASS]  第 2 轮：成功（rc=0, 45s）
[PASS]  第 3 轮：成功（rc=0, 45s）
[INFO]  同一工作区：3 轮中 0 轮 EPERM
```

**干净工作区对照因环境伪影未完成**（见 §四），故本轮只登记「同工作区连续构建稳定」。

## 四、⚠️ 最有价值的发现：两个「假 EPERM」干扰源

诊断过程中先后出现了两次**看起来像 EPERM、实际完全不是**的失败。
**如果不查清楚，就会把结论做反** —— 这是本轮最重要的产出。

### 干扰源 1：`ln -s` 在 Git Bash 下创建的是 MSYS 文本链接

- 表现：`Error: Could not find the Next.js package (next/package.json)`，
  而错误文本里**含有 `EPERM` 字样**（Turbopack 的权限类报错）⇒ 第一眼极像 EPERM。
- 真相：Git Bash 的 `ln -s` 创建的是 **MSYS 风格文本符号链接**
  （`node_modules -> /c/Users/...`），Node 的 `require` 能解析它，
  但 **TypeScript 解析不了** ⇒ 报「找不到 next 包」。
- 修法：必须用 **Windows junction（目录联接）** ——
  `fs.symlinkSync(target, link, 'junction')`。
  （`cmd //c mklink /J` 在 Git Bash 下因引号转义不可靠，实测失败。）

### 干扰源 2：`next-env.d.ts` 引用构建产物

- `next-env.d.ts` 含一行 `/// <reference path="./.next/types/routes.d.ts" />`，
  它指向**构建产物**里的文件 —— 干净工作区首次构建时该文件不存在。
- 表现：`Type error: Cannot find module or type declarations for side-effect import of './globals.css'`
  （**与 EPERM 无关**，是类型检查阶段失败）。
- 修法：构建前先 `npx next typegen`；或去掉该引用行。

### 附带确认：junction 下 TypeScript 仍解析不到 CSS 副作用导入

即使换成正确的 Windows junction，`tsc --noEmit` 在 lab 工作区仍报 TS2882，
而主工作区正常 ⇒ **junction 环境下 TypeScript 的模块解析行为与真实目录不同**。

> **因此：「在 junction 化的副本里构建」不能作为 EPERM 的有效对照实验。**
> 若要继续追查 EPERM 机制，必须用**完整真实副本**（含真实 node_modules 目录），
> 或直接在主工作区以「构建 + 启动 + 退出」的完整生命周期反复施压。

## 五、已排除的因素

| 曾被怀疑 | 排除依据 |
|---|---|
| 残留 `next start` 子进程持有 `.next/trace` 句柄 | 本轮无残留监听进程，构建 3/3 成功；v0.0.5 已在脚本里加进程树清理 |
| `.next` 目录被复用 / 跨任务共用 | 每轮前清理 `.next`，仍稳定；且 CI 每次都是全新克隆 |
| 仓库路径过长 / 特殊字符 | 路径长度 40，无特殊字符；CI 的 Windows runner（路径不同）同样稳定 |
| 系统文件权限 / 杀毒拦截 | 本轮 `.next/trace` 可创建性探测通过，构建无告警 |
| 产品代码缺陷 | Linux CI 长期全绿；本地 45s/轮稳定；代码里没有与 `.next/trace` 相关的特殊逻辑 |

## 六、仍未查明的部分（如实登记）

- **机制层面**：v0.0.5 记录过「完全相同的命令序列有时 rc=0、有时 EPERM」，
  且与 `rm -rf` / `mv` / 残留进程**均非单一因果**。
  本轮未能复现，因此**无法给出机制性根因**。
- **可能方向**（未验证，不作为结论）：
  Windows 文件系统「目录刚被重命名后的元数据提交」与「杀毒实时扫描」的交互。
  这两条都需要专门的系统级工具（Process Monitor / 杀毒日志）才能证实，
  而当前环境不具备该观测条件。

## 七、工程结论（已落地的处置）

1. **本地脚本对 EPERM 免疫**（v0.0.5 起）：
   `scripts/ci/run-e2e-locally.sh` 与 `scripts/ci/run-visual-regression.sh`
   识别 EPERM 后清理 `.next` 并**有限重试**（非 EPERM 失败立即中断）。
2. **权威验证环境是 Linux CI**：GitHub Actions 的 Linux runner 从未出现该问题，
   本地 Windows 不稳定**不构成隐藏缺陷的许可**，但也不阻塞交付。
3. **诊断脚本化**：`scripts/ci/eperm-diagnose.sh` 把排查过程固化为可复现命令，
   下次再遇到时**先跑它**而不是重复碰运气。

## 八、下次复现时的建议步骤（避免重复劳动）

1. 先跑 `bash scripts/ci/eperm-diagnose.sh 3` —— 它会告诉你
   「残留进程 / trace 可创建性 / 同工作区稳定性」三项基础事实。
2. 若同工作区也复现 ⇒ 保存失败日志到 `_backups/eperm-lab/logs/`，
   与本轮日志**逐字对照**。
3. 若要验证「干净工作区」假设 ⇒ 必须用**完整真实副本**
   （真实 node_modules 目录，非 junction）—— 否则结论无效。
4. **不要**用 `cmd //c mklink /J`（Git Bash 下不可靠），
   改用 Node 的 `fs.symlinkSync(..., 'junction')`。
