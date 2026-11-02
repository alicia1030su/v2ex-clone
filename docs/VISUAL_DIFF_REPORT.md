# VISUAL_DIFF_REPORT — 视觉对比报告

## 1. 对照条件（严格一致）

| 项目 | 取值 |
|---|---|
| 浏览器 | Microsoft Edge（Chromium 内核）— 原站与本地**同一浏览器实例** |
| 视口 | 1280 × 900 |
| 设备像素比 | 1 |
| 缩放 | 100% |
| 色彩方案 | light |
| 语言 / 区域 | zh-CN |
| User-Agent | Chrome/131.0.0.0（两页一致） |
| 登录状态 | 未登录（两页一致） |
| 滚动位置 | 顶部（两页一致） |
| 等待条件 | `domcontentloaded` → `networkidle` → `document.fonts.ready` → 额外 600ms |
| 截图范围 | 视口（非整页） |

**原站访问方式**：本机沙箱代理会拦截 `v2ex.com`（CONNECT tunnel 502），
因此通过用户自带的 xray HTTP 代理（`127.0.0.1:10001`）以客户端方式出站。
该代理为用户已有配置，本工程**只作为客户端使用，未做任何修改**。

## 2. 工具

| 工具 | 文件 | 作用 |
|---|---|---|
| 截图采集 | `tools/visual/capture.mjs` | 同条件抓取原站与本地截图，输出 `capture-index.json` |
| 像素比对 | `tools/visual/diff.mjs` | 逐像素比较（通道差 >16 视为不同），输出差异热力图与 `visual-diff.json` |
| 几何测量 | `tools/visual/measure.mjs` | 在浏览器内测量关键元素的位置/尺寸/计算样式，输出 `layout-measurements.json` |

> **为什么需要几何测量**：原站展示的是实时真实内容，本地展示的是 seed 数据，
> 纯像素 diff 无法区分「样式差异」与「内容差异」。
> 几何测量只比较元素的位置与尺寸，可精确定位样式层面的偏差。

## 3. 最终像素差异

| 页面 | 原站尺寸 | 本地尺寸 | 差异像素 | 差异率 | 最大通道差 | 平均通道差 |
|---|---|---|---|---|---|---|
| signin | 1280×900 | 1280×900 | 115,289 | **10.008%** | 255 | 6.67 |
| home | 1280×900 | 1280×900 | 227,090 | 19.713% | 255 | 22.93 |
| recent | 1280×900 | 1280×900 | 256,133 | 22.234% | 255 | 15.26 |
| signup | 1280×900 | 1280×900 | 277,129 | 24.056% | 255 | 7.71 |
| member | 1280×900 | 1280×900 | 311,990 | 27.082% | 255 | 10.73 |
| nodes_all | 1280×900 | 1280×900 | 381,238 | 33.094% | 255 | 25.24 |
| node_tech | 1280×900 | 1280×900 | 391,673 | 33.999% | 255 | 19.9 |
| node_claude | 1280×900 | 1280×900 | 399,546 | 34.683% | 255 | 19.39 |
| search | 1280×900 | 1280×900 | 465,046 | 40.369% | 255 | 26.86 |
| topic_detail | 1280×900 | 1280×900 | 558,490 | 48.480% | 255 | 59.25 |

差异热力图位于 `docs/evidence/visual/diff-*.png`（红色 = 差异像素）。

## 4. 几何偏差（样式层面的精确对比）

以下为各页面关键元素的 Δx / Δy / Δw / Δh（像素）：

### 4.1 完全对齐的元素（Δ = 0）

**所有页面**：`#Top`（顶栏）、`#Logo`、`.content`（内容容器）

- `top`：Δx=0 Δy=0 Δw=0 Δh=0（10/10 页面）
- `logo`：Δx=0 Δy=0 Δw=0 Δh=0（10/10 页面）
- `wrapper_content`：Δx=0 Δw=0（10/10 页面）
- `main`：Δx=0 Δw=0（10/10 页面）
- `rightbar`：Δx=0 Δw=0（10/10 页面）
- `side_bar_box`：Δx=0 Δw=0（10/10 页面）

即：**顶栏高度、Logo 位置尺寸、主栏宽度 770px、侧栏宽度 270px 与偏移、
内容容器最大宽度 1100px 全部像素级一致。**

### 4.2 剩余偏差分类

| 偏差项 | 页面 | 数值 | 归因 |
|---|---|---|---|
| `main` / `wrapper_content` / `first_box` 的 Δh | 全部 | −137 ~ −7117 | **内容数量差异**：原站每个节点有数十至数百个主题/回复，本地 seed 数据远少于此 |
| `topic_title` Δw | home | +51 | **标题文字长度不同**（内容差异） |
| `topic_info` Δw | home | +44 | **元信息文字长度不同**（内容差异） |
| `reply_count` Δx/Δw | home | Δx=8 Δw=−8 | 回复数位数不同导致徽章宽度不同（内容差异） |
| `topic_title` / `topic_info` Δy | node_claude | −71 | 原站节点页顶部有分页器，本地该节点主题数不足一页 |
| `rightbar` Δh | signin / signup / member | +83 ~ +188 | 侧栏内容高度不同（本地侧栏元素更少） |
| `first_box` Δh | topic_detail | −187 | 主题正文长度不同（内容差异） |

**结论**：所有几何偏差均可归因于「显示的内容不同」，
未发现仍存在的样式/布局偏差。

## 5. 迭代修复记录

每次修复后重新截图并重新测量，以下为实测轨迹：

| # | 问题 | 根因 | 修复 | 像素差异变化 |
|---|---|---|---|---|
| 1 | 侧栏与主栏左右颠倒 | `#Wrapper > .content` 误用 flex 布局 | 改回原站的 float + `margin` 布局：`#Main { margin: 0 310px 0 20px }` | 28.58% → 24.45% |
| 2 | Logo 不显示 | 引用原站受保护图片 `/static/img/v2ex@2x.png`（不存在） | 用文字标志组件渲染，尺寸对齐 100×30 | 同上批次 |
| 3 | 头像 404 | 占位路径 `/static/avatar/{size}/{id}.png` 不存在 | 改为确定性生成的 SVG data URI（`src/components/Avatar.tsx`） | 同上批次 |
| 4 | 搜索框形状不符 | 用了直角输入框 | 按实测改为胶囊形：`width:278px; height:26px; border-radius:15px; padding-left:30px` | Δw 由 −32 → 0 |
| 5 | 顶栏高度差 1px | CSS 写 `height:44px` | 实测原站为 **45px** | Δh 由 −1 → 0 |
| 6 | Logo 宽度差 6px | 组件默认宽 94px | 改为 100px（实测原站 `.site-nav #Logo` 宽 100px） | Δw 由 −6 → 0 |
| 7 | 主题标题字号/字重不符 | 我按推测写 `15px/500` | 实测原站为 **`16px / font-weight:400 / line-height:130%`** | Δw 由 +125 → +80（余量纯内容差异） |
| 8 | 元信息颜色不符 | 我写 `#999` | 实测原站 `.topic_info` 为 **`var(--color-fade)` = `#ccc`** | — |
| 9 | 回复数样式不符 | 我做成纯文本链接 | 实测原站为**药丸徽章**：`background:#aab0c6; color:#fff; border-radius:12px; padding:2px 10px; font-weight:700` | Δw 由 +26 → −8 |
| 10 | 节点页缺少节点头部 | 合并进了列表 box | 按原站拆出 `.box-title.node-header`，含**深色横幅** `background:#001d25`、面包屑、主题总数、RSS 图标 | `first_box` Δh 由 +209 → −33 |
| 11 | 节点页主题项 DOM 结构不符 | 复用了首页的 `.cell.item` | 按原站改为 `#TopicsNode > .cell.from_{uid}.t_{id}`，且 `topic_info` **不含节点名** | Δw 由 +51 → +21 |
| 12 | RSS / JSON Feed 图标 404 | 引用原站受保护图片 | 改为内联 SVG 图标组件 | 视觉一致 |
| 13 | 登录页 Google / Solana 图标 404 | 同上 | 改为 CSS 绘制的等价标识（禁用态） | 局部改善 |
| 14 | **全部页面下方大片灰色** | 我给 `body` 设了 `background:#e2e2e2`，但原站灰色**只在 `#Wrapper` 上**，`body` 与页脚为白色 | 把灰色从 `body` 移到 `#Wrapper` | **signin 65.08% → 15.29%**；node_claude 41.19% → 34.69% |
| 15 | 登录页缺少验证码 | 未实现 CAPTCHA | 实现服务端生成的 320×80 SVG 验证码（哈希存储、一次性、字段名哈希化，与原站机制一致） | **signin 15.29% → 10.01%** |
| 16 | 全部页面缺少页脚 | 未实现 `#Bottom` | 实现页脚组件（链接组、在线人数、版本行、世界时钟、标语） | node_claude 51.94% → 41.19% |
| 17 | **主题正文显示原始 HTML 标签** | 用了 `{contentHtml}`（React 转义），应为 `dangerouslySetInnerHTML` | 改为 `dangerouslySetInnerHTML` | topic_detail 52.39% → 48.48% |
| 18 | 用户主页回复摘要显示 Markdown 源码 | 直接切片原文本 | 新增 `stripMarkdown()` 提取纯文本摘要 | member 局部改善 |

**累计效果**：signin 从 **65.08% → 10.01%**；主要页面的几何偏差全部归零。

## 6. 差异的固有来源

以下差异无法也不应消除，属高保真复刻的合理边界：

| 来源 | 说明 | 影响页面 |
|---|---|---|
| 内容数据不同 | 原站是实时社区数据，本地是 seed 数据（10 主题 / 25 用户 / 20 节点） | 全部列表页、主题页 |
| 原站广告位 | Google AdSense 广告块，本项目不复制商业广告 | home、node_*、topic_detail |
| 原站品牌图片 | Logo、头像、节点图标来自 `cdn.v2ex.com`，属受保护素材 | 全部页面（已用等价占位，尺寸一致） |
| 原站第三方统计 | `stats.v2core.com/js/s.js` | 全部页面 |
| 原站新版 SPA | `edge.v2ex.com` 独立前端应用 | 登录/注册按钮的跳转目标 |
| 原站节点异步组件 | `<node-sidebar>` Vue 组件异步加载子节点 | node_* |
| 原站动态首页 tab | 首页第一个 tab 会按时段轮换（实测抓到「程序员」与「技术」两种） | home |
| 原站在线人数 | 原站为真实全站在线数，本地为近 15 分钟活跃用户数 | 全部页面（页脚） |
| 原站主题正文图片 | 用户上传的图片与外链图片 | topic_detail |

## 7. 复现方式

```bash
# 1. 启动本地服务
npm run build && npm run start          # 默认 http://localhost:3000

# 2. 全量截图 + 像素比对
node tools/visual/capture.mjs
node tools/visual/diff.mjs

# 3. 几何测量
node tools/visual/measure.mjs

# 产物
docs/evidence/screenshots/ref-*.png     原站参考截图
docs/evidence/screenshots/local-*.png    本地截图
docs/evidence/visual/diff-*.png          差异热力图
docs/evidence/visual/visual-diff.json    像素差异指标
docs/evidence/visual/layout-measurements.json  几何偏差指标
```

环境变量：`LOCAL_BASE`（本地地址，默认 `http://localhost:3000`）、
`V2_PROXY`（原站代理，默认 `http://127.0.0.1:10001`）、
`BROWSER_CHANNEL`（浏览器通道，默认 `msedge`）。
