# 视觉真实性整改报告（v0.0.9）

> **一句话结论**：README 里那张「没有样式」的首页截图**不是产品坏了**，而是
> **截图工具把失败当成了成功**。本轮把「截图是否真实有效」变成了可执行的机器判据
> （18 项页面健康门禁 + 5 个负向测试），并修掉了 7 项真实的版面/资源缺陷。
> 重新采集的 72 张截图**全部先过门禁再落盘**，任何一张不达标都会让任务失败。

- 仓库：`https://github.com/alicia1030su/v2ex-clone`
- 事故对象：`docs/evidence/screenshots/desktop-1280/local-home.png`（2026-11-05 提交 `29689fd`）
- 整改分支：`fix/visual-authenticity-v0.0.9`

---

## 第一阶段：问题出在截图，还是出在产品？

### 1.1 结论（先给答案）

| 问题 | 答案 | 判据 |
|---|---|---|
| **当前网站样式是否正常？** | **正常**。不是「基本正常」，是逐项可量化的正常 | 见 §1.2 的计算样式实测表 |
| **README 截图为什么没有样式？** | 截图里 **CSS 确实没加载**（像素指纹可证）；而截图工具**没有任何机制能发现这件事**，于是把它当成功结果提交了 | 见 §1.3 / §1.4 |
| **是不是「截图来自早期有缺陷的构建」？** | **不是**。截图提交时样式表已存在且完整 | 见 §1.5 |
| **是不是「代理导致 localhost 的 CSS 请求失败」？** | **代理不是本轮的复现条件**（强制全量代理仍然 200）。但工具**确实没有 bypass localhost**，在代理会拦截 localhost 的环境里必然失败且不会被发现 | 见 §1.6 |

### 1.2 当前站点的真实状态（生产构建，全新隔离环境）

采集方式：`node tools/visual/diagnose.mjs --base http://127.0.0.1:3210 --all`。
每一次采集都记录：最终 URL、HTML 响应状态、每个 CSS/JS 请求的状态、
`/_next/static/` 失败清单、控制台 error、`document.styleSheets`（含 `cssRules.length`）、
关键元素 `getComputedStyle()`、以及现场截图。

| 判据 | 期望（设计值） | 实测 | 结果 |
|---|---|---|---|
| HTML 响应 | 2xx | `200` | ✅ |
| 样式表请求 | 全部成功 | 1/1 成功 | ✅ |
| 脚本请求 | 全部成功 | 6/6 成功 | ✅ |
| `/_next/static/` 失败请求 | 0 | 0 | ✅ |
| 样式表解析出规则 | > 0 | `styleSheets=1`，含规则 1 个，`<link>` 未挂载 0 个 | ✅ |
| 控制台 error | 0 | 0 | ✅ |
| `#Wrapper` 背景 | `rgb(226, 226, 226)` | `rgb(226, 226, 226)` | ✅ |
| `body` 字体 | `"Helvetica Neue"` / 14px | `"Helvetica Neue", "Luxi Sans", "Segoe UI", "Hiragino Sans GB"` / 14px | ✅ |
| `.box` 白卡 | 白底 + 阴影 + 3px 圆角 | `rgb(255,255,255)` + `rgba(0,0,0,0.1) 0 2px 3px` + `3px` | ✅ |
| 浏览器默认蓝链接 | **0 个** | 13 个链接中 0 个（`#0000EE`） | ✅ |
| 内容区居中 | 1100px 居中 | `x=90, width=1100`，右留白 90 | ✅ |
| 桌面双栏 | `#Main` 770 + `#Rightbar` 270 | `#Main x=110 w=770 right=880`、`#Rightbar x=900 w=270` | ✅ |
| 横向溢出 | 0px | `scrollWidth - innerWidth = 0` | ✅ |
| 图片加载 | 全部成功 | 20/20 | ✅ |

**「默认蓝链接 0 个」是最硬的证据**：浏览器在**完全没有作者样式**时，
`a:link` 恒为 `#0000EE` 且带下划线。页面上一个默认蓝都没有，
说明 `globals.css` 不只是「请求到了」，而是**真的解析并生效了**。

### 1.3 事故截图的像素指纹：它确实没有 CSS

同一视口（1280×900）、同一缩放、同一浏览器，对三张图做像素统计：

| 图像 | 灰底 `#e2e2e2` 占比 | 默认蓝 `#0000EE` 像素数 |
|---|---|---|
| README 里的旧 `local-home.png` | **0.00%** | **4524** |
| 人为拦截全部 `*.css` 后的对照图 | **0.00%** | **4573** |
| 当前站点 | 2.63%（当轮）/ 18.38%（本轮） | **0** |

旧图与「人为拦截 CSS」的指纹**几乎重合**（灰底同为 0%、默认蓝数量差 1%），
与「正常站点」**完全相反**。这不是「样式有点不一样」，是**样式表整个没生效**。

### 1.4 工具为什么会「假成功」（三个缺陷，缺一不可）

`tools/visual/capture-multi.mjs`（整改前）：

1. **代理施加到了整只浏览器**
   `chromium.launch({ proxy: { server: ... } })` 是**浏览器级**设置，
   连 `http://localhost` 的 CSS/JS 请求也走代理。只有加 `--local-only` 才跳过。
   而当时生成 README 图的那次运行**没有** `--local-only`。
2. **把「等待超时」吞掉后照常截图**
   ```js
   await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
   ```
   CSS 没加载时页面永远不会进入「无网络请求」状态，30 秒后抛错 → 被 `.catch` 吞掉
   → 继续 `screenshot()` → 写盘 → 记录 `localStatus: "ok"`。
3. **从不校验「截图里有没有样式」**
   工具只判断「页面对象存在」，从不检查 CSS 是否加载、布局是否双栏、
   有没有默认蓝链接。于是「成功」这个词在它嘴里没有任何含义。

仓库里 `docs/evidence/screenshots/capture-multi-index.json` 当时把这张图记成
`localStatus: "ok"` —— 这就是「假成功」的直接物证。

> **可以证实的**：截图确实无 CSS；工具确实无法发现；索引确实记了 ok。
> **不能证实（因此不写进结论）**：当天那一次运行里 CSS 究竟为什么没加载
> （代理拦了？超时了？）。旧索引没有留下失败请求清单，事后无法归因到唯一原因。
> 本轮不猜测、不编造，只把「工具必须能判死」这件事做掉。

### 1.5 排除「截图来自有缺陷的早期构建」

`git log` 显示截图提交 `29689fd`（2026-11-05 10:57）时，
`src/app/globals.css` 已是 1329 行的完整样式表，`layout.tsx` 正常 import 它。
**样式表在那一刻就存在**，所以「当时构建里没有 CSS」不成立。

### 1.6 「63/63 视觉回归全绿」为什么不算还原度证明

因为那套回归**拿同一批坏截图当基线**：基线本身无样式，被测产物也无样式，
像素差为 0 ⇒ 全绿。**基线未经审查**时，「和基线一致」只能证明「一样坏」。
本轮因此给基线更新加了人工审查凭据（见 §2.3）。

---

## 第二阶段：让「假成功」不可能发生

### 2.1 页面健康门禁（`tools/visual/lib/page-health.mjs`）

四层判据，共 **18 项**，任一项不过即判定该截图**无效**：

| 层 | 检查项 |
|---|---|
| **加载层** | `document.status`、`navigation.url`、`css.requests`、`js.requests`、`static.noFailures`、`resources.noFailures` |
| **应用层** | `css.parsed`（`styleSheets` 里真的解析出规则）、`js.noPageErrors`、`console.noErrors`、`browser.alive` |
| **设计层** | `design.wrapperBg`、`design.bodyFont`、`design.boxCard`、`design.noUaLinks`、`design.centered`、`design.twoColumn`、`layout.noHorizontalOverflow`、`images.allLoaded` |
| **稳定性** | `stability.networkIdle`、`stability.fontsReady`、`stability.layoutStable`（连续两次几何采样一致） |

设计值全部来自 `globals.css` 的实测常量（`DESIGN`），不是拍脑袋：

```js
export const DESIGN = {
  wrapperBg: 'rgb(226, 226, 226)',
  boxBg: 'rgb(255, 255, 255)',
  boxRadius: '3px',
  rightbarWidth: 270,
  contentMaxWidth: 1100,
  bodyFontSize: '14px',
  bodyFontFamily: 'Helvetica Neue',
  uaLinkColor: 'rgb(0, 0, 238)',   // 出现即代表 CSS 没生效
  siteLinkColor: 'rgb(119, 128, 135)',
};
```

三条硬约束：

- `CONSOLE_ERROR_ALLOWLIST = []` —— **默认空**。不允许靠白名单把红变绿。
- 唯一被放行的失败是 `_rsc=` 预取被 `ERR_ABORTED`（Next.js App Router 的正常行为），
  其余一律计入失败。
- 导航失败**不抛异常**，而是返回一张全红门禁 —— 让调用方必须显式处理，
  而不是被 `try/catch` 静默跳过。

### 2.2 负向测试：门禁必须能判死（`tools/visual/negative-tests.mjs`）

每个场景同时断言两件事：**整体判红** + **指定的那条判据判红**
（防止「被无关失败掩盖」而误以为检测生效）。

| 场景 | 构造方式 | 期望判红的判据 | 实测 |
|---|---|---|---|
| `no-css` | `route.abort('**/*.css')` | `css.requests` / `css.parsed` / `design.wrapperBg` / `design.noUaLinks` | ✅ 拒绝 |
| `no-static` | 拦截 `**/_next/static/**` | `static.noFailures` / `js.requests` | ✅ 拒绝 |
| `wrong-route` | 302 到 `/signin` | `navigation.url` | ✅ 拒绝 |
| `site-404` | `route.fulfill(502)` | `navigation.load` | ✅ 拒绝 |
| `not-two-column` | 注入 `#Rightbar{float:none;width:auto}` | `design.twoColumn` | ✅ 拒绝 |

**实测结果：5 个坏页面场景，5 个被正确拒绝。**

### 2.3 出图与基线的双重闸门

- **出图**：`loadAndVerify()` 返回 `ok` 才写正式路径；
  否则只写 `docs/evidence/visual/health/<视口>-<页名>-INVALID.png`，
  并让进程 `exit(1)`。**没有「先把图存下来再说」这条路了。**
- **基线**：`tools/visual/regression.mjs` 保存基线必须带审查凭据：
  ```js
  const approval = (process.env.VISUAL_BASELINE_APPROVE ?? '').trim();
  if (approval.length < 8) {
    console.error('[regression] ✗ 拒绝保存基线：未提供审查凭据。');
    process.exit(2);
  }
  ```
  基线文件里落 `approvedBy` 字段 —— **谁能无声无息地刷新基线，答案是不能**。

### 2.4 静态护栏（`tests/static/v009-visual-capture-guards.spec.ts`）

把上面这些约束**钉进测试**，防止有人（包括我自己）日后改回去：

- 三个截图工具必须 `import { loadAndVerify }`
- 全仓禁止 `waitForLoadState(...).catch(() => {})` 这种吞错写法
- 出现 `--proxy-server` 必须同时出现 `bypass`
- 截图落盘必须受 `result.ok` 约束；`invalid > 0` 必须 `exit(1)`
- `VISUAL_BASELINE_APPROVE` + `process.exit(2)` 必须存在
- `CONSOLE_ERROR_ALLOWLIST = []` 必须保持为空

---

## 第三阶段：真实还原度验收

### 3.1 方法：同视口、同缩放、纯像素几何对照

原站参考图 `ref-home.png` 与本地 `local-home.png` 均为 1280×900、
`deviceScaleFactor=1`、`chromium`、`locale=zh-CN`。
在两张图上跑同一套**水平扫描线**（不读 DOM，纯像素），找白卡边界：

| 扫描线 | 原站参考图（白卡区间） | 本地截图（白卡区间） | 结论 |
|---|---|---|---|
| `y=300` | `[110, 879]`（宽 770） | `[110, 879]`（宽 770） | **Δx=0，Δw=0** |
| 右栏右边缘 | `1169` | `1169` | **Δx=0** |
| 灰底 `#e2e2e2` 占比 | 20.57% | 18.38% | 差 2.19pp，来自内容条数不同 |

**主栏卡片左边缘、右边缘、宽度、右栏右边缘四项与参考图逐像素一致。**
这不是「看起来差不多」，是同一坐标系下量出来的同一组数字。

### 3.2 差异必须分三类，不许混为一谈

| 类别 | 定义 | 本轮实例 |
|---|---|---|
| **A. 缺少 CSS** | 样式表没生效 | 事故截图（已修，且已不可能再出图） |
| **B. 设计本身不一致** | 样式生效了，但与原站设计不同 | 回复按钮被裁切、tab 无选中态、整页被渐变压暗、主题页缺右栏 —— **本轮全部修复** |
| **C. 内容数据不同** | 版式一致，数据不同 | 本地 10 条固定测试主题 vs 原站实时社区数据；头像为确定性 SVG 占位 |

只有 A/B 算缺陷，C 不算。**任何无法测量的差异一律标 `UNVERIFIED`，不编相似率。**

### 3.3 本轮修掉的 7 项真实缺陷

| # | 缺陷 | 根因 | 证据 |
|---|---|---|---|
| 1 | 回复卡片「感谢 / 编辑 / 删除 / 举报」按钮**被卡片下边缘裁掉** | `.sep5` 在原站是 **5px 高的空白块**，被当成内容容器用 ⇒ 行高被钉死 5px、内容溢出流外，外层 `.box{overflow:hidden}` 一裁了之 | 探针实测：卡片高 155px，按钮 `bottom=621` > 卡片 `bottom=606`（溢出 15px）。修复后 `clipped=[]` |
| 2 | 主题详情页**右侧 310px 纯灰空档**（缺右栏） | `t/[id]/page.tsx` 用的 `<Wrapper>` 没传 `rightbar` | 门禁抓到 `#Rightbar=缺失`；修复后 `#Main x=110 w=770 / #Rightbar x=900 w=270` |
| 3 | `/xna` 同类空档 | 无右栏时 `#Main` 没吃掉腾出的宽度 | `#Main` 恢复 1060 全宽（`#Main.no-rightbar{margin-right:20px}`） |
| 4 | **5 个 RSS 死链**（`/index.xml`、`/feed/vxna.xml`、`/feed/{node}.xml|json`、`/feed/search.*`） | 用的是**原站路径**，本站真实路由是 `/api/feed`、`/api/nodes/{name}/feed` | 实测全 404 → 修复后 `/api/nodes/claude/feed` 200（`application/rss+xml`）、`?format=json` 200（`application/feed+json`）。副产物：`/xna` 的 `networkidle` 超时随之消失（根因就是 404 预取重试） |
| 5 | 回复数徽章**白字从未生效**（一直是灰字） | 优先级：`a:link, a:visited`(0,1,1) 压过 `.count_livid`(0,1,0) | 实测 `color=rgb(255,255,255)`、`bg=rgb(170,176,198)`（= `#aab0c6`，与原站同值） |
| 6 | 首页导航**没有任何 tab 处于选中态** | 默认 `tabKey='home'` 不在 `HOME_TABS` 里 ⇒ 全部渲染成 `.tab` | 修复后首页「全部」为 `.tab_current`（深色圆角 + 白字，`#334`） |
| 7 | **整页被渐变压暗**（灰底实为 `rgb(220,220,220)`） | 顶部阴影用了 `linear-gradient` 却没给 `background-size` ⇒ 渐变铺满整个 `#Wrapper` 高度 | 实测左边缘中部由 `rgb(220,220,220)` 恢复为 `rgb(226,226,226)`；灰底占比 2.11% → 31.51% |

**附带修复（非视觉，但被视觉走查发现）**：

- **「最热」tab 恒 500**。`groupBy(nodes.name).orderBy(desc(topics.votes))` 在 PostgreSQL
  里是非法的（`column "topics.votes" must appear in the GROUP BY clause`）。
  因为首页默认 tab 不是它，这条死链一直没人踩到 —— 逐 tab 走查才暴露。
  改为 `orderBy(desc(sql\`sum(votes + replies_count)\`))`。
- **首页首个 tab 标签写错**：原站是「技术」，本项目写成「程序员」，且与二级 tab 行首项重复。

### 3.4 逐页验收（先首页，再其余）

| 页面 | 桌面双栏 | 卡片/阴影 | 默认蓝链接 | 备注 |
|---|---|---|---|---|
| 首页 `/` | ✅ 770 + 270 | ✅ | 0 | 与参考图逐像素对齐 |
| 全部节点 `/nodes` | ✅ | ✅ | 0 | 按分类分组 |
| 节点详情 `/go/claude` | ✅ | ✅ | 0 | 头图/面包屑/Feed 图标正常 |
| 主题详情 `/t/1` | ✅ | ✅ | 0 | 右栏为「今日热议主题」（**有意的设计替换**，见 §3.5） |
| 用户主页 `/member/admin` | ✅ | ✅ | 0 | 资料卡 + 发帖 + 回复 |
| 登录 `/signin` | —（单栏表单） | ✅ | 0 | 服务端生成 SVG 验证码 |

### 3.5 有意的设计替换（不是缺陷，必须写明）

| 位置 | 原站 | 本项目 | 理由 |
|---|---|---|---|
| 右栏第 2 个盒位 | 广告（`rdvcc` 等投放位） | 「今日热议主题」 | 本项目**无广告系统**。保留同一栏位、同一宽度、同一卡片样式，只是填充物换成站内真实数据 |
| 头像 | `cdn.v2ex.com` 受保护资源 | 确定性生成的 SVG 占位（同用户恒同色同首字，尺寸 24/48/64/73 与原站一致） | **不可复制**未授权素材；尺寸一致 ⇒ 布局与像素占位仍可比对 |
| 顶栏 Logo | 位图 Logo | 文字 Logo（按原站 Logo 像素基线对齐，上移 5px） | 商标素材不可复制 |

---

## 第四阶段：重新采集 README 截图

- 采集脚本：`tools/visual/capture-multi.mjs --local-only`（**原站与本地是两个独立
  browser context**，只有原站那个带代理，且 `bypass: 'localhost,127.0.0.1,::1,0.0.0.0'`）
- 视口：`desktop-1280` / `desktop-1920` / `tablet-768` / `mobile-375`
- 结果：**72 张，全部通过健康门禁**（`✓ 多视口截图完成，共 72 张，全部通过健康门禁`）
- 数据：固定视觉数据集（10 条主题 / 6 个用户 / 32 条回复），
  保证同一页面每次截图内容一致，便于逐像素比较；作者分散到多个用户，
  以便验证头像与作者名渲染真的生效
- README 引用 8 张：首页 1280、首页 1920、全部节点、节点详情、主题详情、
  用户主页、登录页、移动端首页

> 采集完成后再用**纯像素**复核一遍：
> `#0000EE` 出现 0 次、灰底占比 > 15%、页面无横向溢出。

---

## 第五阶段：长期防回归（CI）

`.github/workflows/visual-regression.yml` 在原有「视觉回归」之前插入两步：

1. **页面健康门禁（截图真实性）** —— `node tools/visual/diagnose.mjs --all`
2. **门禁负向测试** —— `node tools/visual/negative-tests.mjs`（5 个坏场景必须全被拒绝）

并把 `docs/evidence/visual/health/` 与负向测试产物加入 artifact 上传，
失败时可直接下载诊断现场。

基线更新走 `workflow_dispatch` 的 `update_baseline` 输入，
`VISUAL_BASELINE_APPROVE` 由它传入 —— 没有值就 `exit(2)`。

---

## 第六阶段：尚未解决的差异（如实列出）

| # | 差异 | 类别 | 状态 |
|---|---|---|---|
| 1 | 顶栏 Logo 为文字而非位图 Logo | 有意替换 | 不修（商标素材不可复制） |
| 2 | 头像为 SVG 占位而非真实 CDN 头像 | 有意替换 | 不修（未授权素材不可复制） |
| 3 | 右栏第 2 盒位为「今日热议主题」而非广告 | 有意替换 | 不修（无广告系统） |
| 4 | 无 PRO 徽章、金币图标等运营标识 | 功能未实现 | **UNVERIFIED 视觉影响**（未测量） |
| 5 | 主题/回复内容为固定测试数据 | 内容数据不同 | 不算缺陷 |
| 6 | 原站「VXNA」tab 带下拉图标 | 设计不一致 | 未修（**UNVERIFIED**：图标为原站图标字体，未做替代方案） |
| 7 | 移动端 meta 行换行位置与原站不同 | 内容数据不同（标题长度不同） | 无法测量，标 **UNVERIFIED** |
| 8 | 深色模式 | 未实现（原站也没有） | 不适用 |
| 9 | 24 小时持续运行下的视觉稳定性 | 未验证 | **UNVERIFIED**（soak 未完成） |

---

## 附：证据索引

| 证据 | 路径 |
|---|---|
| 门禁判据与全量诊断输出 | `docs/evidence/visual/health/diagnose-final.json` |
| 无效截图的现场图（不会进 README） | `docs/evidence/visual/health/*-INVALID.png` |
| 负向测试产物 | `docs/evidence/visual/negative/` |
| 多视口截图索引（含每页门禁结论） | `docs/evidence/screenshots/capture-multi-index.json` |
| 几何/像素差异明细 | `docs/VISUAL_DIFF_REPORT.md` |
| 门禁实现 | `tools/visual/lib/page-health.mjs` |
| 门禁静态护栏 | `tests/static/v009-visual-capture-guards.spec.ts` |

---

## 附：视觉基线的更新（人工审查记录）

完成整改后第一次跑视觉回归时，工具报出 **87 个回归项**。按纪律，**不自动更新基线**，
而是先逐条核对；核对过程中还发现工具本身有两处**假回归**。

### 1. 先修工具：两处「假回归」

主题页补上右栏后，`img.avatar` 与 `.gray, .fade` 的**第一个匹配**变成了右栏元素
（24px 头像、`#ccc` 文字），于是报出 `头像 73×73 → 24×24`、`次要信息 #999 → #ccc`。

这不是视觉回归，是取值方式错了。两种直觉写法都无效（都实测过）：

| 写法 | 结果 |
|---|---|
| `querySelector('#Main img.avatar, img.avatar')` | 选择器**列表**按文档序取首个匹配，与列表顺序无关 ⇒ 仍命中右栏（`inMain=false`） |
| `querySelector('#Main .gray, .fade')` | scope 只约束列表第一项，`.fade` 仍全文档匹配 |

正确做法：`scope` 元素**内部** `querySelector`，找不到再全局回退。
修完实测：`/t/1` 头像 73px、灰色 `#999` 且都在 `#Main` 内；首页 48px。

### 2. 再更新基线：35 项差异，逐条有解释

用 `workflow_dispatch(update_baseline=true)` 重新生成 Linux 基线（run `42438706625`），
然后**逐组合对比新旧 JSON**：

| 差异 | 组合数 | 结论 |
|---|---|---|
| `home` 的 `avatar` 24→48 | 14（768 及以上视口） | 取值口径修正的结果（原基线取到右栏头像）。**不是视觉变化**；320/375/390 因移动端 CSS 就是 24px，无差异 |
| `topic` 的 `wrapper/content/main` 高度增加 | 21 | 桌面 `main 624→660`（+36）＝ **本次要修的问题**（按钮不再被裁）；320/375/390 的 `content +625/+580` ＝ 主题页补右栏后窄屏堆叠，与首页/节点页行为一致 |

**没有一项无法解释。** 基线文件的 `approvedBy` 字段记录了审批来源：
`alicia1030su 42438706625 workflow_dispatch 显式请求更新基线`。

> 这正是「基线必须经过审查才能更新」的落地形态：不是「测试红了就刷基线」，
> 而是**先证明差异都是预期的，再由人签字**。签发凭据缺失时 `regression.mjs` 直接 `exit(2)`。
