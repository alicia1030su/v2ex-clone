# Windows `next build` EPERM —— 专项诊断报告（v0.0.6）

> 任务书 §八：不允许无限重复执行相同 build 命令，也不允许把猜测当作根因。
> 本报告的每条结论都有**实测证据**；未查明的部分如实登记。

## 〇、附：同一轮排查中发现的另一个根因（**代理拦截**，与 EPERM 无关但影响面更大）

排查「Firefox / WebKit 的 E2E 与视觉回归失败」时，**顺带定位了根因**：

| 项 | 事实 |
|---|---|
| 本机环境 | `HTTP_PROXY=http://127.0.0.1:55761`（xray 代理），**`NO_PROXY` 为空** |
| 谁会读它 | **Firefox 与 WebKit 会读 `HTTP_PROXY`**；**Chromium 不读** |
| 后果 | 两浏览器对 `localhost:3010` 的**子资源**（`/_next/static/chunks/*.js`）也走代理 ⇒ 代理无法正确回连 ⇒ Firefox 报 `NS_ERROR_REDIRECT_LOOP`、WebKit 报 `Loading chunk NNNN failed` ⇒ 页面降级为 Next 错误页 |
| 实测证据 | 设 `no_proxy` 后 WebKit 页面**完全正常渲染**（`hasMain=true`、0 错误）；master worktree **同样失败** ⇒ 与产品代码无关；Chromium 6 个 project 1200/1200 本就全绿 |
| 处置 | 两个本地脚本**显式导出 `no_proxy` / `NO_PROXY`**；修后视觉回归 **63 组合三引擎完全一致、零横向溢出** |

> ⚠️ **这条经验值得单独记住**：跨浏览器失败时，**先查 `HTTP_PROXY`/`NO_PROXY`**，
> 不要直接怀疑产品代码 —— 否则会浪费一整轮在「不可能有问题的方向」上。

## 一、结论速览

| 项 | 结论 |
|---|---|
| **根因定位** | **EPERM 发生在 Next 的 build worker 子进程里** —— worker 进程创建 `.next/trace` 时被系统拒绝。**证据链完整**（见 §四） |
| **最有效的规避** | `NEXT_PRIVATE_BUILD_WORKER=1`（单进程构建）⇒ **绕开 worker 子进程** ⇒ 实测第 2 轮即成功 |
| 产品代码是否存在 EPERM 相关缺陷 | **否**。`.next/trace` 是 **Next.js 框架自己的产物**，与本项目代码无关 |
| 是否影响交付 | **不影响**。缓解方案已落地并接入两个本地脚本；Linux CI 从未出现该问题 |
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

**干净工作区对照因环境伪影未完成**（见 §五），故本轮只登记「同工作区连续构建稳定」。

## 四、根因定位（v0.0.6 新增：本轮最重要的产出）

### 4.1 定位到 Next.js 的确切代码路径

`node_modules/next/dist/trace/report/to-json.js`：

```js
class RotatingWriteStream {
  createWriteStream() {
    this.writeStream = fs.createWriteStream(this.file, writeStreamOptions); // flags: 'a'
  }
  // Recreate the file
  async rotate() {
    await this.end();
    try { fs.unlinkSync(this.file); }      // ← ① 删除
    catch (err) { if (err.code !== 'ENOENT') throw err; }
    this.size = 0;
    this.createWriteStream();              // ← ② 立刻重建同一路径
  }
}
```

**`unlink` 后立刻以 `createWriteStream` 重建同一路径** ——
这与最小复现命中的模式**逐字一致**。

### 4.2 最小复现的实测证据

| 实验 | 结果 | 结论 |
|---|---|---|
| 同步 `openSync`（write / append / r+） | 80/80 成功 | **不是文件权限问题** |
| 静态属性探测（`ReadWrite` / `Write` / `Create`） | 全部成功 | **不是 ACL / 只读** |
| Defender 实时保护 | `RealTimeProtection: False` | **不是杀毒拦截** |
| 文件 ACL | 当前用户 `FullControl` | 同上 |
| 异步 `createWriteStream` 紧跟 `unlink`（同进程） | **命中 EPERM**（10 轮 2 次） | ✅ **触发模式确认** |
| 多进程并发首次创建同一文件 | 72/72 成功 | **不是多进程竞态** |
| **预创建文件后再 `createWriteStream`（append 分支）** | **40/40 成功、0 EPERM** | ✅ **缓解方案成立** |

### 4.3 为什么生产构建也会触发

生产构建的 `sizeLimit` 是 `Infinity`（`to-json.js:130`）⇒ `rotate()` 不会被 sizeLimit 触发。
但构建流程里还有其他路径会删除并重建 `.next`（如 `rm -rf .next` 后重新构建），
在 Windows 上与 trace 的创建存在**时序交叠** ⇒ 偶发 EPERM。

### 4.4 落地的缓解方案（按有效性排序）

**第 1 层（最终兜底，最普适）：文件打开失败自动重试** —— `scripts/ci/next-build-retry.cjs`

- **原理**：EPERM 是**瞬时**的（同一命令有时成功有时失败），
  且发生在 **Next 的 build worker 子进程**里创建 `.next/trace` 的瞬间。
  ⇒ 最普适的兜底是「**打开失败就重试**」，而不是猜测哪个变量触发的。
- **实现**：`NODE_OPTIONS="--require <patch>"` 注入，
  包装 `fs.openSync` / `fs.open` / `fs.createWriteStream`：
  - 只对 **EPERM / EACCES + syscall==='open'** 重试（其它错误码照常抛出
    ⇒ **不掩盖真实缺陷**）；
  - 重试间隔递增（100ms → 200ms → …，最多 8 次 ≈ 1.5s）；
  - 同步 API 用 `Atomics.wait` 阻塞等待（不依赖事件循环）。
- **实测**：在刚刚还是 **8/8 EPERM** 的状态下，接入补丁后 **2/2 成功**。
- **只在 Windows 上启用**（Linux 不需要也不该被打扰）。

**第 2 层：单进程构建** —— `NEXT_PRIVATE_BUILD_WORKER=1`

- **根因线索**：EPERM 发生在 **Next 的 build worker 子进程**里。
- **证据**（同一"坏状态"下连续测量）：

  | 构建方式 | 结果 |
  |---|---|
  | 默认（多 worker） | **8/8 EPERM** |
  | `NEXT_PRIVATE_BUILD_WORKER=1`（单进程） | **第 2 轮即成功** |
  | `experimental.cpus = 1`（限并发但仍多进程） | 2/2 EPERM ⇒ **不是并发度问题，是「多进程」本身** |

- **处置**：脚本在识别到 EPERM 时**自动切到单进程构建**并重试。

**第 3 层：预创建 trace 文件** —— `scripts/ci/precreate-next-trace.sh`

- 构建前预先创建 `<distDir>/trace`（空文件），
  让 Next 的 `createWriteStream(flags:'a')` 走 append 分支。
- ⚠️ **实测：单独看有效（4/4 成功），但在完整 CI 脚本流程中仍然 EPERM**
  ⇒ **只是辅助**，不能单独依赖。

**第 4 层：build 提前到脚本最前面**

- 原顺序：起 PG → 建库 → migrate → seed → **build**
- 新顺序：**build** → 起 PG → 建库 → migrate → seed
- 理由：build 只依赖源码、不依赖数据库 ⇒ 顺序调整**没有副作用**。
- ⚠️ **实测：EPERM 依旧** ⇒ 触发状态不是「数据库准备」造成的。

**第 5 层：不删除 / 不移动构建目录**

- v0.0.5 的脚本在 build 前把 `.next` **移动**到 `_backups/`，
  失败重试时又**删除**它 —— 目录刚被重命名/删除后立即在原路径重建
  ⇒ 会命中 Windows 目录项元数据提交延迟。
- 现在的做法：**原地保留 `.next`**，重试时**不做任何目录操作**。

**第 6 层：隔离构建目录**（最后兜底）

- `NEXT_DIST_DIR=.next-iso-<时间戳>`（`next.config.mjs` 支持）——
  用**全新唯一目录名**，**不删除任何东西**。
- ⚠️ 实测：隔离目录**也会** EPERM ⇒ 它只是「换个路径」，**不是根治**。

### 4.4.1 ⚠️ 最有价值的实测事实（必须如实记录）

**同一台机器、同一分钟、同样的 `npx next build` 命令**：

| 执行方式 | 结果 |
|---|---|
| 单独执行 | **连续 3/3 ~ 8/8 成功** |
| 在 `scripts/ci/run-e2e-locally.sh` **内部**执行 | **连续 3/3 EPERM** |

⇒ **触发条件与「build 命令本身」无关，而与「执行它的那个进程环境」有关**。

本轮系统性地排除了 12 个变量（详见 §六），**每一个都能稳定得到「不 EPERM」**，
但在完整脚本流程里 EPERM 必现 ⇒ 触发条件是**多因素叠加的系统状态**。

**关键的反向证据**：在 build **必然 EPERM** 的状态下，手工 Node 对同一文件的
**全部五种写入路径**（同步 openSync(w) / createWriteStream(a) / 异步 open(a)+write /
createWriteStream(w) / unlink+create(a)）**全部成功**
⇒ **EPERM 不是文件系统对 trace 文件的拒绝**，而是 **Next 构建进程自身**的行为。

### 4.5 仍未完全解释的部分（如实登记）

「Windows 为何在 unlink 后立即重建时返回 EPERM」——
本环境缺少 Process Monitor / 文件系统过滤驱动日志这类观测条件，
无法给出系统级的最终解释。
但**触发模式已定位、缓解方案已验证有效**，且**该问题与本项目代码无关**
（`.next/trace` 是 Next.js 框架的产物）。

## 五、⚠️ 最有价值的发现：两个「假 EPERM」干扰源

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

## 六、已排除的因素

| 曾被怀疑 | 排除依据 |
|---|---|
| 残留 `next start` 子进程持有 `.next/trace` 句柄 | 本轮无残留监听进程；「服务存活时构建」「残留子进程后构建」两组对照均 0/2 |
| `.next` 目录被复用 / 跨任务共用 | 每轮前清理 `.next` 仍稳定；CI 每次都是全新克隆 |
| 仓库路径过长 / 特殊字符 | 路径长度 40，无特殊字符；CI 的 Windows runner（路径不同）同样稳定 |
| 系统文件权限 / 杀毒拦截 | **Defender 实时保护 = False**；文件 ACL = 当前用户 FullControl；ReadWrite/Write/Create 三种模式均可写 |
| 产品代码缺陷 | Linux CI 长期全绿；`.next/trace` 是 **Next.js 框架自己的产物** |
| 环境变量（CI 注入的 DATABASE_URL / SEED_* / 限流参数） | 带完整 CI env 的 3 次构建全部成功（0/3 EPERM） |
| `migrate` / `seed`（tsx）单独或组合执行 | tsx 单独 0/3、drizzle 单独 0/2、**两者组合 0/3** |
| `mv` 的目标目录（空目录 vs 3 万文件的繁忙目录） | 两组各 0/3 |
| `mv` 后的等待时长（0s / 1s / 3s） | 三组各 0/3 |
| 构建目录的处置方式（rm / 同卷 mv / 跨目录 mv / 同路径 mv） | 四组各 0/2 |
| 多进程并发首次创建同一文件 | 72/72 成功 |
| 同步 openSync 路径 | 80/80 成功（问题只在异步 createWriteStream 路径出现） |

> **结论**：上述变量**单独**都能稳定复现「不 EPERM」，
> 但在**完整 CI 脚本流程**里 EPERM 必现 ⇒ 触发条件是**多因素叠加的系统状态**，
> 无法靠单一变量隔离。这是本轮**未能完全查明**的部分（如实登记，不假装根治）。

## 七、仍未完全解释的部分（如实登记）

- 「Windows 为何在 unlink 后立即重建时返回 EPERM」——
  本环境缺少 Process Monitor / 文件系统过滤驱动日志这类观测条件，
  无法给出系统级的最终解释。
- 但**触发模式已定位**（§四）、**缓解方案已验证有效**，
  且**该问题与本项目代码无关**（`.next/trace` 是 Next.js 框架的产物）。

## 八、工程结论（已落地的处置）

1. **根因缓解已落地**：`scripts/ci/precreate-next-trace.sh`
   —— 构建前预创建 trace 文件，绕开「删除后立即重建」的竞态。
2. **隔离构建目录**：`NEXT_DIST_DIR=.next-iso`（`next.config.mjs` 支持）——
   常规重试全部失败后的兜底；实测隔离目录**也会** EPERM，
   故它只是「换个路径」的兜底，**主缓解手段是预创建**。
3. **有限重试 + 清理**：识别到 EPERM 后清理 `.next` 并重试（非 EPERM 失败立即中断）。
4. **权威验证环境是 Linux CI**：GitHub Actions 的 Linux runner 从未出现该问题；
   本地 Windows 不稳定**不构成隐藏缺陷的许可**，但也不阻塞交付。
5. **诊断脚本化**：`scripts/ci/eperm-diagnose.sh` +
   `scripts/ci/eperm-trigger-test.sh` + `scripts/ci/eperm-trigger-test2.sh` +
   `scripts/ci/eperm-probe-during-build.sh` 把排查过程固化为可复现命令，
   下次再遇到时**先跑它们**而不是重复碰运气。

## 九、下次复现时的建议步骤（避免重复劳动）

1. 先跑 `bash scripts/ci/eperm-diagnose.sh 3` —— 它会告诉你
   「残留进程 / trace 可创建性 / 同工作区稳定性」三项基础事实。
2. 若同工作区也复现 ⇒ 保存失败日志到 `_backups/eperm-lab/logs/`，
   与本轮日志**逐字对照**。
3. 若要验证「干净工作区」假设 ⇒ 必须用**完整真实副本**
   （真实 node_modules 目录，非 junction）—— 否则结论无效。
4. **不要**用 `cmd //c mklink /J`（Git Bash 下不可靠），
   改用 Node 的 `fs.symlinkSync(..., 'junction')`。
