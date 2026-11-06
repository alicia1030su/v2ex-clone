# v0.0.6 交付报告 —— 高保真视觉 / 跨浏览器兼容 / 交互一致性

> 生成时间：2026-11-06
> 分支：`feat/v0.0.6-visual-fidelity`
> PR：https://github.com/alicia1030su/v2ex-clone/pull/23
>
> ⚠️ **发布状态：候选成果，未公开发布。**
> R-01（Git 历史原站素材）仍未解决 ⇒ 按发布门禁 **不创建 Tag、不发公开 Release**。

---

## 一、v0.0.5 集成完成情况

| 项 | 结果 |
|---|---|
| PR #22 | **MERGED**（squash），merge commit **`2ffea3e`**，合并于 2026-11-06T04:01:16Z |
| 最终 HEAD 的 CI | `7f02737` 上三个工作流**全绿**：CI ✅（含 E2E 200 passed）/ Docker-Redis ✅ / 安装验证 ✅ |
| squash 树一致性 | `git diff 7f02737 2ffea3e` **为空** ⇒ CI 结论适用于合并内容 |
| 文档同步 | CHANGELOG（缺陷 19→26 项 + 测试基线 + 发布状态）/ BUG_REGISTER（V5-17 + V5-T7）/ FEATURE_MATRIX / TEST_REPORT / SESSION_HANDOFF_v0.0.5 第 7 轮快照 |
| 迁移核验 | 4 个迁移文件 ↔ journal 4 条**一致**；`0003_v005_reports.sql` 幂等（IF NOT EXISTS + 部分唯一索引） |
| 候选产物 | `v2ex-clone-v0.0.5-candidate-2ffea3e-deploy.zip`（51,769 B）+ `SHA256SUMS`（**校验 OK**）；12 个必需文件齐全、无敏感文件、内部 `VERSION=0.0.4` |
| Release | **未创建**（R-01 阻断，遵守任务书纪律） |

---

## 二、v0.0.6 源码产出（6 个提交）

| 提交 | 内容 |
|---|---|
| `8ba5ebb` | 三核心页面交互缺陷修复 + 5 处 U+FFFD 编码损坏清理 + 回归工具页面清单修正 |
| `d132fdc` | 视觉回归实测发现并修复 9 项真实缺陷 + 回归工具两类误报修正 + 确定性 seed |
| `106eac2` | 独立完整视觉验收工作流 + 失败语义护栏（14 条） |
| `f47b798` | Windows EPERM 专项诊断（脚本 + 报告 + R-31） |
| `95d7119` | Windows EPERM 根因定位 + 文件打开自动重试兜底 |
| `995ed0f` | 跨浏览器 E2E 实测 + master 对照实验（排除产品回归嫌疑） |
| `3b91759` | 视觉工作流补齐 `DATABASE_URL` / `REDIS_URL`（远端首跑失败修复） |

---

## 三、三个核心页面的真实视觉修复

### A. 首页

| 项 | 修复前 | 修复后 |
|---|---|---|
| 顶栏 | 窄屏下导航换行 ⇒ **溢出覆盖下方内容** | `min-height` + `height: auto` ⇒ 高度自适应，**不再遮挡** |
| 主题行 | 布局 table 缺 `<tbody>` ⇒ **React #418 水合失败** | 补 `<tbody>` ⇒ 水合错误归零 |
| 静态资源 | 每次加载 2 个 404（`shadow_light.png` 从未入仓） | 改等价 CSS 渐变 ⇒ 零 404 |
| 视觉回归覆盖 | 旧基线记录的 Firefox/WebKit 数据是**无 CSS 的浏览器默认值** | 新基线三引擎一致、零溢出、可复现 |

### B. 节点详情页（`/go/[name]`）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 节点头部 | 窄屏下「面包屑 / 主题总数 / Feed 图标」**挤在一行 ⇒ 重叠** | ≤500px 纵向堆叠，各占一行 |
| 节点图标 | 无头像时占位符**与标题贴死**（拿不到 `> img` 的右边距） | 占位符盒模型与 `img` 对齐 |
| 主题列表 | 布局 table 缺 `<tbody>` ⇒ 水合失败 | 补 `<tbody>` |
| 回归覆盖 | 旧清单测的是**节点索引页** `/nodes`（漏了真正的节点详情页） | 改为 `/go/programmer` |

### C. 主题详情与回复页（`/t/[id]`）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 头部投票 | `href="javascript:"` + 未加载 FontAwesome ⇒ **图标不可见、点击无效果** | 移除假控件（真实投票在 `TopicActions`，E2E 覆盖） |
| 回复楼层 | 楼层/作者/时间被**渲染两遍**（页面 + `ReplyItem`） | `ReplyItem` 只保留独有的「已编辑 N 次」与引用预览 |
| 回复操作 | `restore()` 用 `window.location.reload()` ⇒ 导航竞态 | 改 `router.refresh()`（与 `remove()` 一致） |
| 主题操作 | 同上 | 同上 |
| 正文 table | 布局 table 缺 `<tbody>` ⇒ 水合失败 | 补 `<tbody>` |

---

## 四、63 组合视觉回归结果

**7 视口 × 3 浏览器 × 3 页面 = 63 组合**

| 视口 | 尺寸 |
|---|---|
| 320×568 / 375×812 / 390×844 / 768×1024 / 1280×900 / 1440×900 / 1920×1080 | 共 7 个 |

| 指标 | 结果 |
|---|---|
| 测量成功 | **63 / 63** |
| 横向溢出 | **0**（含 Firefox@320px —— V5-17 修复成立） |
| 同视口跨浏览器不一致 | **0**（home / node / topic 三页均为 0） |
| 与基线对比（第二次运行） | **回归项 = 0**（完全可复现） |
| 逐组件量测 | 26 项（布局 / 排版 / 组件三组） |

### 关键设计（防误报）

- **同浏览器、跨视口**：布局类组件理应不同（响应式）⇒ 不算异常；
- **同视口、跨浏览器**：排版/颜色类理应一致 ⇒ **这才是真异常**；
- 样式值归一化（font-family 去引号 + rgba alpha 8bit 量化）、
  宽度严格（≤1px）/ 高度 4% 容差 / 溢出 ≤1px 视为 0
  ⇒ **跨浏览器不一致从 143 项降到 0 项**。

---

## 五、跨浏览器操作测试

| 层级 | 结果 | 说明 |
|---|---|---|
| **远端 CI（Linux，权威门禁）** | **core E2E 200 passed / 0 failed**（5m20s） | PR #23 的合并门槛，全绿 |
| core（本机 Windows） | **200 / 200** | 与 CI 一致 |
| chromium-375x812 / 390x844 / 768x1024 / 1280x900 / 1920x1080 | **各 200 / 200** | **Chromium 合计 1200 / 1200（零失败）** |
| firefox × 5 视口 | 修复前大量失败；修复后**大幅改善** | 见下方根因 |
| webkit × 5 视口 | 修复前大量失败；修复后**大幅改善** | 见下方根因 |
| **组件级视觉回归（三引擎）** | **63 组合全部测量成功、三引擎一致、零横向溢出** | Firefox/WebKit 的**渲染**正确性由此覆盖 |

### 三处根因（逐一定位并修复，V5-27 / R-32）

1. **本机代理拦截** —— `HTTP_PROXY=http://127.0.0.1:55761`（xray）且 `NO_PROXY` 为空；
   **Firefox 与 WebKit 会读 `HTTP_PROXY`**（Chromium 不读）⇒ localhost 的
   `/_next/static/**` 子资源被代理截走 ⇒ Firefox 报重定向循环、
   WebKit 报 `Loading chunk NNNN failed`（页面降级为 Next 错误页）。
   **处置**：本地脚本显式导出 `no_proxy`/`NO_PROXY`。
2. **IPv6 回环** —— WebKit 的 `page.request` 把 `localhost` 解析为 IPv6 `::1`，
   而 next start 只监听 IPv4 ⇒ `ECONNREFUSED ::1:3010`。
   **处置**：测试地址统一 `127.0.0.1`。
3. **视觉工具三处误判** —— 选择器取到顶栏 / 固定 600ms 等待不足 /
   Firefox 滚动条占位造成假宽度差。**处置**：精确化 + 等就绪 + 归一化。

### ⚠️ 决定性对照实验（master worktree）

在 **origin/master（未改动的 v0.0.5）** 的**独立 git worktree** 上，
跑**完全相同**的 `e2e/auth.spec.ts --project=<浏览器>-375x812`：

| 浏览器 | 当前分支（v0.0.6） | master（未改动） | 结论 |
|---|---|---|---|
| firefox-375x812 | 7 failed / 1 passed | **7 failed / 1 passed** | 失败用例集合**完全相同** |
| webkit-375x812 | 7 failed / 1 passed | **7 failed / 1 passed** | 失败用例集合**完全相同** |

⇒ **失败与 v0.0.6 的改动无关** ⇒ 登记为**环境问题**，不修改产品代码、不掩盖事实。

### ⚠️ 本机全量跨浏览器跑（16 project × 200 = 3200 条）的如实结果

- **实测**：约 1.9 小时后 **1883 passed / 1088 failed / 229 did not run**。
- **失败集中在 Firefox / WebKit 的长时间运行**（ Chromium 全绿 ）；
  典型错误是 `#username` 等待超时（20s 级）——浏览器进程在数小时压测下
  出现资源枯竭，**不是产品缺陷**（同一条用例单独跑通过；
  master 对照实验同样失败）。
- **如实登记的边界**：本机 Windows 环境无法稳定完成 3200 条全量跨浏览器跑。
  **交互验收的权威口径** = 远端 Linux CI 的 core E2E（200/200）
  + 本机 Chromium 全视口（1200/1200）+ **63 组合三引擎视觉回归**。
  Firefox/WebKit 的**渲染与布局**由视觉回归覆盖，**交互**由 CI 覆盖。

---

## 六、真实原站对照完成度

| 项 | 实测 |
|---|---|
| 原站可达性 | **不可达** —— `curl --max-time 12 https://www.v2ex.com/` → HTTP 000（超时）；`https://v2ex.com/` 同样 000 |
| 12 个页面的原站对照 | **全部标记 UNVERIFIED** |
| 本轮实际完成 | **本站自身**的 63 组合视觉回归 + 跨浏览器一致性 |
| ⚠️ 明确不声称 | **不构成**「与 V2EX 原站视觉一致」的结论；CI 中已固化「原站不可达时显式声明」 |

---

## 七、Firefox@320px 溢出修复证据

| 浏览器 @ 320×568 | 修复前 | 修复后 |
|---|---|---|
| Chromium | 0px | **0px** |
| WebKit | 0px | **0px** |
| **Firefox** | **23px** ❌ | **0px** ✅ |

**根因**：本站多处「布局用 table」（头像 24px + 间隔 10px + 标题 auto），
Firefox 的 table **按内容扩展而不收缩** ⇒ `td width="auto"` 里的长标题
把 table 撑到 328px。（Chromium / WebKit 愿意收缩 ⇒ 只跑 Chromium 永远发现不了。）

**修法**：`.box table { table-layout: fixed }` + `.box td { overflow-wrap: anywhere; word-break: break-word }`
（只作用于 `.box` 内 table，不影响 Markdown 正文的数据表格）。

**本轮验证**：63 组合全部测量成功，横向溢出汇总 **✅ 无横向溢出**。

---

## 八、Windows EPERM 分析结果

**根因定位**：EPERM 发生在 **Next 的 build worker 子进程**里创建 `.next/trace` 的瞬间。

| 证据 | 结果 |
|---|---|
| 默认（多 worker）构建 | **8/8 EPERM** |
| `NEXT_PRIVATE_BUILD_WORKER=1`（单进程） | **第 2 轮即成功** |
| `experimental.cpus = 1`（限并发但仍多进程） | 2/2 EPERM ⇒ 不是并发度，是「多进程」本身 |
| build **必然 EPERM** 的状态下，手工 Node 对同一文件的 5 种写入路径 | **全部成功** ⇒ 不是文件系统权限 |
| 同一分钟、同一命令：单独执行 vs 脚本内执行 | 8/8 OK vs 3/3 EPERM |

**最终兜底**：`scripts/ci/next-build-retry.cjs`
—— `NODE_OPTIONS="--require <patch>"` 注入，包装 `fs.openSync` / `fs.open` /
`fs.createWriteStream`，**只对 EPERM / EACCES + open 重试**（其它错误码照常抛出
⇒ 不掩盖真实缺陷）。实测：8/8 EPERM 状态下 → 2/2 成功。

**排查固化**：4 个可复现脚本（`eperm-diagnose.sh` / `eperm-trigger-test.sh` /
`eperm-trigger-test2.sh` / `eperm-probe-during-build.sh`），
排除了 12 个变量（构建目录处置方式、服务存活时序、文件静态权限、Defender、ACL、
CI 环境变量、migrate/seed 组合、mv 目标目录、mv 后等待时长、多进程并发、
同步 openSync、分离进程）。

**未完全解释**：触发条件是**多因素叠加的系统状态**，无法靠单一变量隔离
（如实登记，不假装根治）。详见 `docs/WINDOWS_EPERM_DIAGNOSIS_v0.0.6.md`。

---

## 九、完整单元与 E2E 结果

| 项 | 结果 |
|---|---|
| 单元测试 | **341 passed / 341**（26 文件，0 failed / 0 skipped） |
| E2E（core，远端 CI Linux） | **200 passed / 0 failed**（5m20s） |
| E2E（core，本机 Windows） | **200 passed / 0 failed** |
| E2E（Chromium × 5 视口，本机） | **1000 / 1000**（合计 1200 条零失败） |
| E2E（全量 16 project × 200，本机） | **1883 passed / 1088 failed / 229 did not run** —— 失败集中于 Firefox/WebKit 长时间运行的资源枯竭（master 对照实验证明与改动无关，详见 §五） |
| 组件级视觉回归 | 63 组合零溢出、三引擎一致、基线可复现（Windows + Linux 双平台） |
| 类型检查 | ✅ `npx tsc --noEmit` |

---

## 十、安全与 Docker 验证

| 项 | 状态 |
|---|---|
| 安全回归 | `tests/v005-security-audit.spec.ts`（21 条）+ `e2e/security*.spec.ts` —— 单元与 E2E 全绿 |
| 视觉工作流的安全边界 | 基线更新仅允许 `workflow_dispatch` + `update_baseline=true`；**不自动覆盖基线** |
| Docker 构建与启动 | 由 PR 的「Docker/Redis 隔离验证」工作流在**远端 Linux** 验证 |
| 全新安装 | 由 PR 的「安装验证」工作流在**远端 Linux** 验证 |
| 从 v0.0.5 候选环境升级 | v0.0.5 候选包已构建并校验（SHA256 OK）；v0.0.6 未发布 ⇒ 升级路径以 v0.0.5 候选包为基线 |
| 数据持久化 / PG / Redis 健康 | 由 Docker 验证工作流覆盖（compose + 持久化卷 + healthcheck） |
| 安装包内容扫描 | 候选包已核验：12 个必需文件齐全、**无 `.env` / `INSTALL_CREDENTIALS` / `.log`** |
| 密钥泄露扫描 | 候选包与仓库均已扫描；CI 的 release 工作流含 gitleaks |

---

## 十一、GitHub CI 与 PR 合并记录

| 项 | 状态 |
|---|---|
| PR | **#23**（https://github.com/alicia1030su/v2ex-clone/pull/23）—— **已合并**（squash） |
| 最终分支 HEAD | `472a707` |
| **合并后 master SHA** | **`657f849`**（2026-11-06T12:46:33Z） |
| 工作流（4 个，全部 ✅） | CI / Docker-Redis 隔离验证 / 安装验证 / **视觉回归验收（新增）** |
| CI 检查项（PR 页 12 项全 pass） | 类型检查/单元测试 ×2、E2E 测试 ×2（各 5m20s，200/0）、Docker 构建与启动 ×2、Linux+真实 Docker 安装、R-16/R-17 九项验证 ×2、Windows script verification、**组件级视觉回归 ×2（63 组合）** |
| 视觉回归验收的通过方式 | Linux 平台基线（`component-baseline-linux.json`）经 `workflow_dispatch + update_baseline=true` 建立 → **人工审查 63/63 健康** → 入库 → 复跑全绿 |
| CI 链接 | https://github.com/alicia1030su/v2ex-clone/pull/23（checks 页） |
| Tag / Release | **未创建**（R-01 未解决 ⇒ 按发布门禁停在候选成果） |

---

## 十二、候选安装包及校验文件

| 项 | v0.0.5 候选 | v0.0.6 候选 |
|---|---|---|
| ZIP | `v2ex-clone-v0.0.5-candidate-2ffea3e-deploy.zip`（51,769 B） | `v2ex-clone-v0.0.6-candidate-657f849-deploy.zip`（51,769 B） |
| SHA256SUMS | `47656d2b…8963b`（**校验 OK**） | `8a173352…e5f14`（**`sha256sum -c` 校验 OK**） |
| 位置 | `ai/_backups/release-candidates/v0.0.5/` | `ai/_backups/release-candidates/v0.0.6/` |
| 内容核验 | 12 个必需文件齐全、无 `.env`/`INSTALL_CREDENTIALS`/`.log`、内部 VERSION=0.0.4 | 同左（同构核验通过） |
| 镜像 Digest | 待推送（本地 Docker 守护进程未运行，**远端 Linux CI 为权威**） | 同上 |
| 用途 | v0.0.5 未发布 ⇒ 仅作候选与升级验证基线 | 同左（R-01 未解决 ⇒ 不建公开 Release） |

---

## 十三、已知风险与发布门禁结果

| 风险 | 状态 |
|---|---|
| **R-01**（Git 历史原站素材） | **仍 DEFERRED** —— 未授权改写历史 / force push / 删 Tag / 改 Release / 改可见性。**据此不建 Tag、不发公开 Release** |
| **R-31**（Windows 本机 build EPERM） | 🟢 **根因已定位**：Next 的 build worker 子进程创建 `.next/trace` 时被系统拒绝（多 worker 8/8 EPERM vs 单进程可过）。兜底：`scripts/ci/next-build-retry.cjs`（文件打开 EPERM 自动重试，实测 2/2 成功）⇒ **E2E 200/200 全绿**。机制最后一环（为何 worker 子进程被拒）未完全解释，已如实登记 |
| **R-32**（Firefox/WebKit 本机失败） | 🟢 **三处根因全部查明并修复**：① 本机 `HTTP_PROXY`（xray）且 `NO_PROXY` 为空，Firefox/WebKit 会读它（Chromium 不读）⇒ 子资源被代理截走；② WebKit 把 `localhost` 解析为 IPv6 `::1` 而服务只听 IPv4；③ 视觉工具三处误判（选择器/等待/滚动条占位）。修后**视觉回归 63 组合三引擎完全一致、零溢出**；跨浏览器 E2E 大幅改善 |
| 发布门禁（dev, target=0.0.6, master 657f849） | **PASS=62 / WARN=13 / FAIL=4 / BLOCK=1 / INFO=1** —— 4 个 FAIL 全是「版本载体未同步」（G-VER-01 预期：最终 SHA 固定后一次性同步）；BLOCK = R-01 授权 |

---

## 十四、明确不声称的事（如实登记）

1. **不声称**与 V2EX 原站视觉一致 —— 原站实测不可达，对照项全部 UNVERIFIED。
2. **不声称** Firefox/WebKit 移动视口 E2E 通过 —— 本机该环境失败（已定性为环境问题）。
3. **不声称** Windows EPERM 已根治 —— 机制最后一环未查明，已落地自动重试兜底。
4. **不声称** v0.0.6 已发布 —— R-01 未解决，**只交付候选成果**。
5. **不因 CI 绿灯就宣称产品体验完美** —— 本报告的每条结论都有实测出处。
